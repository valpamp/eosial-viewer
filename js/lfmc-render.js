/* Raster tile renderer shared by the browser worker and its single-threaded fallback. */
(function (scope) {
    'use strict';

    function renderer(GeoTIFF, palettes) {
        const datasets = new Map();
        const lookup = Object.fromEntries(Object.entries(palettes).map(([name, palette]) =>
            [name, new Uint32Array(new Uint8Array(palette.flatMap(rgb => [...rgb, 255])).buffer)]));
        function dataset(url, retry) {
            const key = retry ? `retry:${url}` : url;
            if (datasets.has(key)) {
                const entry = datasets.get(key);
                datasets.delete(key);
                datasets.set(key, entry);
                return entry;
            }
            const tiff = GeoTIFF.fromUrl(url, {
                allowFullFile: false,
                blockSize: retry ? 32768 : 16384,
                cacheSize: retry ? 128 : 64,
                cache: true
            });
            const images = new Map();
            const entry = {
                image(index) {
                    if (!images.has(index)) images.set(index, tiff.then(file => file.getImage(index)));
                    return images.get(index);
                },
                count: () => tiff.then(file => file.getImageCount())
            };
            tiff.catch(() => { if (datasets.get(key) === entry) datasets.delete(key); });
            datasets.set(key, entry);
            if (datasets.size > 2) datasets.delete(datasets.keys().next().value);
            return entry;
        }

        function latitude(tileY, zoom) {
            const radians = Math.PI * (1 - 2 * tileY / (2 ** zoom));
            return Math.atan(Math.sinh(radians)) * 180 / Math.PI;
        }

        async function render({ url, bounds, x, y, z, size, minimum, scheme }, isCurrent, retry) {
            const colors = lookup[scheme];
            const [west, south, east, north] = bounds;
            const stepX = 360 / (2 ** z);
            const westTile = x * stepX - 180;
            const northTile = latitude(y, z);
            const southTile = latitude(y + 1, z);
            const left = Math.max(west, westTile);
            const right = Math.min(east, westTile + stepX);
            const bottom = Math.max(south, southTile);
            const top = Math.min(north, northTile);
            if (left >= right || bottom >= top) return null;

            const raster = dataset(url, retry);
            const image = await raster.image(0);
            if (!isCurrent()) return null;
            const [dx, dySigned] = image.getResolution();
            const dy = Math.abs(dySigned);
            const pixelX = stepX / size;
            const pixelY = (northTile - southTile) / size;
            const imageCount = await raster.count();
            let index = 0;
            while (index + 1 < imageCount && dx * 2 ** (index + 1) <= pixelX
                   && dy * 2 ** (index + 1) <= pixelY) index++;
            const overview = index ? await raster.image(index) : image;
            if (!isCurrent()) return null;
            const resX = dx * 2 ** index;
            const resY = dy * 2 ** index;
            const firstCol = Math.max(0, Math.floor((left - west) / resX));
            const lastCol = Math.min(overview.getWidth(), Math.ceil((right - west) / resX));
            const firstRow = Math.max(0, Math.floor((north - top) / resY));
            const lastRow = Math.min(overview.getHeight(), Math.ceil((north - bottom) / resY));
            if (lastCol <= firstCol || lastRow <= firstRow) return null;
            const values = await overview.readRasters({
                window: [firstCol, firstRow, lastCol, lastRow], samples: [0], interleave: true
            });
            if (!isCurrent()) return null;

            const buffer = new Uint32Array(size * size);
            const columns = new Int32Array(size);
            for (let col = 0; col < size; col++) {
                const lon = westTile + (col + 0.5) * pixelX;
                const source = Math.floor((lon - west) / resX) - firstCol;
                columns[col] = lon >= west && lon < east && source >= 0 && source < lastCol - firstCol ? source : -1;
            }
            for (let row = 0; row < size; row++) {
                const lat = latitude(y + (row + 0.5) / size, z);
                const sourceRow = Math.floor((north - lat) / resY);
                if (lat > north || lat < south || sourceRow < firstRow || sourceRow >= lastRow) continue;
                const sourceOffset = (sourceRow - firstRow) * (lastCol - firstCol);
                const targetOffset = row * size;
                for (let col = 0; col < size; col++) {
                    const source = columns[col];
                    if (source === -1) continue;
                    const value = values[sourceOffset + source];
                    if (value !== 65535) {
                        buffer[targetOffset + col] = colors[Math.max(0, Math.min(colors.length - 1, value - minimum))];
                    }
                }
            }
            return buffer.buffer;
        }

        return async (tile, isCurrent) => {
            try {
                return await render(tile, isCurrent, false);
            } catch {
                if (!isCurrent()) return null;
                // Use a separate range cache for recovery so failed data reads are not reused.
                return render(tile, isCurrent, true);
            }
        };
    }

    if (typeof document !== 'undefined') {
        scope.EV.createLfmcRenderer = renderer;
        return;
    }

    let render;
    const current = new Set();
    scope.onmessage = async ({ data }) => {
        if (data.init) {
            importScripts(data.init);
            render = renderer(scope.GeoTIFF, data.palettes);
            return;
        }
        if (data.cancel) {
            current.delete(data.id);
            return;
        }
        current.add(data.id);
        try {
            const buffer = await render(data.tile, () => current.has(data.id));
            scope.postMessage({ id: data.id, buffer }, buffer ? [buffer] : []);
        } catch (error) {
            scope.postMessage({ id: data.id, error: error.message });
        } finally {
            current.delete(data.id);
        }
    };
})(self);
