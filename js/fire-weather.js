/* Public Western USA VIIRS composites. GeoTIFF reads use HTTP byte ranges. */
(async function () {
    'use strict';

    const element = (id) => document.getElementById(id);
    const status = element('weather-status');
    const selector = element('composite');
    const opacity = element('opacity');
    const colorScheme = element('color-scheme');
    const history = element('history');
    const feedback = element('tool-status');
    const map = L.map('weather-map', { zoomControl: false }).setView([40, -114], 5);
    const basemaps = EV.mapBasemaps();
    basemaps['USGS Topographic (grayscale)'].addTo(map);
    map.createPane('lfmcRaster').style.zIndex = '350';

    const fieldSites = element('field-sites');
    const fieldSiteSource = element('field-site-source');
    const fieldSiteStatus = element('field-site-status');
    let fieldSiteLayer;
    fieldSites.addEventListener('change', async () => {
        fieldSiteSource.hidden = !fieldSites.checked;
        fieldSiteStatus.textContent = '';
        if (!fieldSites.checked) {
            if (fieldSiteLayer) (await fieldSiteLayer.catch(() => null))?.remove();
            return;
        }
        if (!fieldSiteLayer) {
            fieldSiteLayer = fetch('globe-lfmc-sites.geojson').then(async response => {
                if (!response.ok) throw new Error(`Field sites HTTP ${response.status}`);
                return L.geoJSON(await response.json(), {
                    pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
                        radius: 4, color: '#fff', weight: 1.5, fillColor: '#174c9e', fillOpacity: 1,
                        bubblingMouseEvents: false
                    }),
                    onEachFeature: ({ properties }, marker) => {
                        const popup = document.createElement('div');
                        const name = document.createElement('strong');
                        name.textContent = properties.name;
                        popup.append(name, document.createElement('br'), `${properties.state} · Globe-LFMC 2.0`);
                        marker.bindPopup(popup);
                    }
                });
            }).catch(error => {
                fieldSiteLayer = null;
                throw error;
            });
        }
        try {
            const sites = await fieldSiteLayer;
            if (fieldSites.checked) sites.addTo(map);
        } catch (error) {
            if (fieldSites.checked) {
                fieldSites.checked = false;
                fieldSiteSource.hidden = true;
                fieldSiteStatus.textContent = 'Could not load the sampling sites. Select the layer to try again.';
            }
            console.error(error);
        }
    });

    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const preview = local && new URLSearchParams(location.search).get('data');
    const base = new URL(preview || window.EOSIAL_LFMC_DATA_URL, location.href);
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    const asset = (path) => {
        const url = new URL(path, base);
        if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
            throw new Error('Invalid asset URL');
        }
        return url.href;
    };
    const cache = new Map();
    const noData = 65535;
    const minimum = 30;
    const maximum = 250;
    const scale = colors => colors.map((color, index) =>
        [minimum + (maximum - minimum) * index / (colors.length - 1), color]);
    // RdYlGn and RdYlBu use the standard 11 ColorBrewer stops.
    const schemes = {
        rdylgn: scale(['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b', '#ffffbf',
            '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837']),
        rdylbu: scale(['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee090', '#ffffbf',
            '#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#313695']),
        desert: [[30, '#642809'], [55, '#b86129'], [80, '#e7af57'],
            [95, '#d4ca76'], [100, '#a1d99b'], [130, '#83c888'], [160, '#60ad71'],
            [190, '#449359'], [220, '#24723e'], [250, '#00441b']]
    };
    try {
        const saved = localStorage.getItem('eosial-lfmc-palette');
        if (Object.hasOwn(schemes, saved)) colorScheme.value = saved;
    } catch { /* Preferences may be unavailable in private browsing. */ }
    const ratio = (value) => (value - minimum) / (maximum - minimum);
    const ticks = [[30, '≤30'], [60, '60'], [100, '100'], [150, '150'], [200, '200'], [250, '≥250']];
    function interpolate(stops) {
        const channels = stops.map(([, color]) => color.slice(1).match(/.{2}/g).map(hex => parseInt(hex, 16)));
        return Array.from({ length: maximum - minimum + 1 }, (_, i) => {
            const value = minimum + i;
            const right = stops.findIndex(([at]) => value <= at);
            if (right === 0) return channels[0];
            const weight = (value - stops[right - 1][0]) / (stops[right][0] - stops[right - 1][0]);
            return channels[right - 1].map((channel, j) => Math.round(channel +
                (channels[right][j] - channel) * weight));
        });
    }
    const palettes = Object.fromEntries(Object.entries(schemes).map(([name, stops]) => [name, interpolate(stops)]));
    function updateLegend() {
        document.querySelector('.weather-gradient').style.backgroundImage = 'linear-gradient(90deg in srgb, ' +
            schemes[colorScheme.value].map(([value, color]) => `${color} ${100 * ratio(value)}%`).join(', ') + ')';
    }
    updateLegend();
    const tickBar = document.querySelector('.weather-ticks');
    for (const [value, text] of ticks) {
        const tick = document.createElement('span');
        tick.textContent = text;
        tick.style.left = `${100 * ratio(value)}%`;
        tickBar.append(tick);
    }

    function reader(record, retry) {
        if (cache.has(record.raster)) return cache.get(record.raster);
        // Keep the chart's range reads separate from map tiles and full downloads in the HTTP cache.
        const url = new URL(asset(record.raster));
        url.searchParams.set('lfmc', retry ? 'analysis-retry' : 'analysis');
        const pending = GeoTIFF.fromUrl(url.href, {
            allowFullFile: false, blockSize: 65536, cacheSize: 32
        }).then(file => file.getImage());
        cache.set(record.raster, pending);
        if (cache.size > 8) cache.delete(cache.keys().next().value);
        return pending;
    }

    async function readSelection(record, read, isCurrent) {
        for (let attempt = 0; attempt < 2 && isCurrent(); attempt++) {
            const image = reader(record, attempt > 0);
            try {
                const raster = await image;
                return isCurrent() ? await read(raster) : null;
            } catch (error) {
                if (cache.get(record.raster) === image) cache.delete(record.raster);
                if (attempt === 1) throw error;
            }
        }
        return null;
    }

    const displaySize = new URLSearchParams(location.search).get('detail') === 'low' ? 128 : 256;
    const localRender = EV.createLfmcRenderer(GeoTIFF, palettes);
    const waiting = [];
    const active = new Map();
    let nextJob = 0;
    let worker;
    try {
        const background = new Worker(new URL('lfmc-render.js?v=20261120.7', document.currentScript.src));
        worker = background;
        background.onmessage = ({ data }) => {
            complete(data.id, data.buffer, data.error && new Error(data.error));
        };
        background.onerror = (event) => {
            event.preventDefault();
            if (worker !== background) return;
            background.terminate();
            worker = null;
            waiting.unshift(...active.values());
            active.clear();
            pump();
        };
        worker.postMessage({ init: element('geotiff-library').src, palettes });
    } catch {
        worker = null;
    }

    function complete(id, buffer, error) {
        const task = active.get(id);
        if (!task) return;
        active.delete(id);
        if (!task.cancelled) {
            if (error) task.reject(error);
            else task.resolve(buffer);
        }
        pump();
    }

    function pump() {
        const capacity = worker ? 2 : 1;
        while (waiting.length && active.size < capacity) {
            const task = waiting.shift();
            if (task.cancelled) continue;
            active.set(task.id, task);
            if (worker) worker.postMessage({ id: task.id, tile: task.tile });
            else localRender(task.tile, () => !task.cancelled).then(
                buffer => complete(task.id, buffer),
                error => complete(task.id, null, error)
            );
        }
    }

    function queueTile(tile) {
        const task = { id: ++nextJob, tile };
        task.promise = new Promise((resolve, reject) => Object.assign(task, { resolve, reject }));
        task.cancel = () => {
            task.cancelled = true;
            task.resolve(null);
            if (worker && active.has(task.id)) worker.postMessage({ id: task.id, cancel: true });
        };
        waiting.push(task);
        pump();
        return task;
    }

    const tileJobs = new WeakMap();
    const RasterLayer = L.GridLayer.extend({
        createTile(coords, done) {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = displaySize;
            if (displaySize < 256) canvas.style.imageRendering = 'pixelated';
            const { record } = this.options;
            const job = queueTile({
                url: asset(record.raster), bounds: record.bounds, x: coords.x, y: coords.y,
                z: coords.z, size: displaySize, minimum, scheme: colorScheme.value
            });
            tileJobs.set(canvas, job);
            job.promise.then(buffer => {
                if (job.cancelled) return;
                if (buffer) {
                    const pixels = new ImageData(new Uint8ClampedArray(buffer), displaySize, displaySize);
                    canvas.getContext('2d').putImageData(pixels, 0, 0);
                }
                done(null, canvas);
            }).catch(error => { if (!job.cancelled) done(error, canvas); });
            return canvas;
        }
    });

    async function pixel(image, record, { lat, lng }) {
        const [west, south, east, north] = record.bounds;
        if (lng < west || lng >= east || lat <= south || lat > north) return null;
        const [dx, dy] = image.getResolution();
        const x = Math.floor((lng - west) / dx);
        const y = Math.floor((lat - north) / dy);
        const [value] = await image.readRasters({
            window: [x, y, x + 1, y + 1], samples: [0], interleave: true, signal: AbortSignal.timeout(20000)
        });
        return value === noData ? null : value;
    }

    async function summarize(image, record, area, isCurrent) {
        const [west, , , north] = record.bounds;
        const [dx, dy] = image.getResolution();
        const firstCol = Math.max(0, Math.ceil((area.getWest() - west) / dx - 0.5));
        const lastCol = Math.min(image.getWidth(), 1 + Math.floor((area.getEast() - west) / dx - 0.5));
        const firstRow = Math.max(0, Math.ceil((area.getNorth() - north) / dy - 0.5));
        const lastRow = Math.min(image.getHeight(), 1 + Math.floor((area.getSouth() - north) / dy - 0.5));
        if (firstCol >= lastCol || firstRow >= lastRow) return null;

        const counts = new Uint32Array(noData);
        const tileHeight = image.getTileHeight();
        let count = 0;
        let sum = 0;
        for (let row = firstRow; row < lastRow;) {
            if (row > firstRow) await new Promise(resolve => setTimeout(resolve, 0));
            if (!isCurrent()) return null;
            const nextRow = Math.min((Math.floor(row / tileHeight) + 1) * tileHeight, lastRow);
            const values = await image.readRasters({
                window: [firstCol, row, lastCol, nextRow], samples: [0], interleave: true,
                signal: AbortSignal.timeout(20000)
            });
            for (const value of values) {
                if (value === noData) continue;
                counts[value]++;
                count++;
                sum += value;
            }
            row = nextRow;
        }
        if (!count) return null;
        // Linear percentiles over valid pixels at their native display resolution.
        const positions = [0.25, 0.5, 0.75].map(q => q * (count - 1));
        const ranks = [...new Set(positions.flatMap(k => [Math.floor(k), Math.ceil(k)]))].sort((a, b) => a - b);
        const samples = new Map();
        let cumulative = 0;
        let rank = 0;
        for (let value = 0; rank < ranks.length; value++) {
            cumulative += counts[value];
            while (rank < ranks.length && ranks[rank] < cumulative) samples.set(ranks[rank++], value);
        }
        const [q25, median, q75] = positions.map(k => {
            const lower = Math.floor(k);
            const first = samples.get(lower);
            return first + (k - lower) * (samples.get(Math.ceil(k)) - first);
        });
        return { count, mean: sum / count, median, q25, q75 };
    }

    const dayLabel = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
    function label(record) {
        const start = new Date(record.start);
        const last = new Date(Date.parse(record.end_exclusive) - 86400000);
        return dayLabel.formatRange(start, last);
    }

    let current, layer, point, marker, composites, area, areaLayer;
    let clickVersion = 0;
    let historyVersion = 0;
    let selectionChart;
    let readingHistory = false;
    async function inspect() {
        if ((!point && !area) || !current) return;
        const version = ++clickVersion;
        const field = element('pixel');
        const record = current;
        const selectedArea = area;
        const location = point;
        const isCurrent = () => version === clickVersion;
        field.textContent = selectedArea ? 'Reading area…' : 'Reading pixel…';
        try {
            const value = await readSelection(record, image => selectedArea ?
                summarize(image, record, selectedArea, isCurrent) : pixel(image, record, location), isCurrent);
            if (version === clickVersion) {
                if (value === null) field.textContent = 'No LFMC estimate here for this composite.';
                else if (selectedArea) field.textContent = `Median ${value.median}% · Mean ${value.mean.toFixed(1)}% · ${value.count.toLocaleString()} valid pixels`;
                else field.textContent = `${value}% LFMC at ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
            }
        } catch (error) {
            if (version === clickVersion) field.textContent = 'The selection could not be read.';
            console.error(error);
        }
    }

    function show(record, fit = false) {
        if (layer) layer.remove();
        current = record;
        layer = new RasterLayer({
            record, opacity: Number(opacity.value), noWrap: true, pane: 'lfmcRaster',
            updateWhenIdle: true, updateWhenZooming: false
        });
        layer.on('tileunload', ({ tile }) => tileJobs.get(tile)?.cancel());
        layer.on('tileerror', () => {
            if (current === record) status.textContent = 'Some map tiles could not be read.';
        });
        layer.addTo(map);
        if (fit) {
            const [west, south, east, north] = record.bounds;
            map.fitBounds([[south, west], [north, east]], { animate: false });
        }
        status.textContent = `Model ${record.model_version}`;
        const stats = record.stats;
        element('coverage').textContent = `Map coverage: ${stats.valid_pixels.toLocaleString()} valid pixels · median ${stats.median}% LFMC`;
        for (const [id, path] of [['download', record.raster], ['provenance', record.provenance]]) {
            const link = element(id);
            link.href = asset(path);
            if (id === 'download') link.download = new URL(link.href).pathname.split('/').pop();
            link.hidden = false;
        }
        inspect();
    }

    function newSelection() {
        historyVersion++;
        selectionChart = null;
        if (readingHistory) feedback.textContent = '';
        readingHistory = false;
        history.disabled = !current;
        element('query-heading').textContent = area ? 'Area summary' : 'Inspect a pixel';
        inspect();
    }
    async function loadHistory() {
        if (!composites || (!point && !area) || readingHistory) return;
        if (selectionChart) {
            EV.showTimeseries(...selectionChart);
            return;
        }
        const version = ++historyVersion;
        const location = point;
        const selectedArea = area;
        const isCurrent = () => version === historyVersion;
        const dates = composites.slice().reverse();
        let checked = 0;
        const showProgress = () => {
            feedback.textContent = `Reading LFMC time series · ${checked} of ${dates.length} composites checked`;
        };
        readingHistory = true;
        showProgress();
        history.disabled = true;
        const entries = await EV.mapSettledLimit(dates, selectedArea ? 2 : 4, async record => {
            try {
                return await readSelection(record, image => selectedArea ?
                    summarize(image, record, selectedArea, isCurrent) : pixel(image, record, location), isCurrent);
            } catch (error) {
                if (isCurrent()) console.warn(`Could not read LFMC composite ${record.start}`, error);
                throw error;
            } finally {
                checked++;
                if (isCurrent()) showProgress();
            }
        });
        if (!isCurrent()) return;
        readingHistory = false;
        history.disabled = false;
        const values = entries.map(entry => entry.status === 'fulfilled' ? entry.value : null);
        const series = values.map((value, i) => {
            const date = new Date(dates[i].start);
            return selectedArea ? { date, mean: value?.mean ?? null, q25: value?.q25 ?? null, q75: value?.q75 ?? null } :
                { date, value };
        });
        const valid = values.filter(value => value !== null).length;
        const failed = entries.filter(entry => entry.status === 'rejected').length;
        const locationLabel = selectedArea ? 'Shaded band shows the 25th–75th percentiles of valid pixels in the selected area.' :
            `Pixel at ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}.`;
        const coverage = valid ? `${valid} of ${series.length} composites have an estimate.` : 'No valid LFMC estimates in this selection.';
        const skipped = failed ? ` ${failed} composite${failed === 1 ? '' : 's'} could not be read.` : '';
        const options = {
            label: 'LFMC', yLabel: 'LFMC (% dry mass)', unit: '%', xLabel: 'Composite start (UTC)',
            info: `${locationLabel} ${coverage}${skipped}`, color: '#822433',
            showMedian: false, fill: false, tension: 0, tickSource: 'data'
        };
        const chart = [selectedArea ? 'LFMC area time series' : 'LFMC point time series', series, options];
        try {
            EV.showTimeseries(...chart);
            if (!failed) selectionChart = chart;
            feedback.textContent = '';
        } catch (error) {
            EV.closeTimeseries();
            feedback.textContent = 'The time-series chart could not be opened.';
            console.error(error);
        }
    }
    history.addEventListener('click', loadHistory);

    const measurements = L.layerGroup().addTo(map);
    const measurePoints = [];
    let measureLine;
    let measureTotal = 0;
    let activeTool;
    let tool;
    const mapElement = map.getContainer();
    const selectionStyle = { color: '#5f1724', weight: 2, fillOpacity: 0.1, interactive: false };
    let firstCorner;
    let gesture;
    let previewRectangle;
    let ignoreAreaClick = false;

    function setTool(button, mode, text = '') {
        if (tool === 'area') {
            if (gesture && mapElement.hasPointerCapture(gesture.id)) mapElement.releasePointerCapture(gesture.id);
            gesture = firstCorner = null;
            previewRectangle?.remove();
            previewRectangle = null;
            map.dragging.enable();
        }
        if (activeTool) {
            activeTool.classList.remove('active');
            activeTool.setAttribute('aria-pressed', 'false');
        }
        activeTool = button;
        tool = mode;
        if (button) {
            button.classList.add('active');
            button.setAttribute('aria-pressed', 'true');
        }
        if (mode === 'area') map.dragging.disable();
        if (mode === 'measure' || mode === 'area') map.doubleClickZoom.disable();
        else map.doubleClickZoom.enable();
        document.body.classList.toggle('querying', Boolean(mode));
        mapElement.classList.toggle('drawing-area', mode === 'area');
        feedback.textContent = text;
    }

    function selectArea(bounds) {
        setTool();
        marker?.remove();
        marker = point = null;
        areaLayer?.remove();
        areaLayer = L.rectangle(bounds, selectionStyle).addTo(map);
        area = bounds;
        newSelection();
        loadHistory();
    }

    function movedFromStart(event) {
        return Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 4;
    }

    mapElement.addEventListener('pointerdown', event => {
        ignoreAreaClick = false;
        if (tool !== 'area' || !event.isPrimary || event.button !== 0 ||
            event.target.closest('.leaflet-control, .leaflet-popup')) return;
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, start: map.mouseEventToLatLng(event) };
        mapElement.setPointerCapture(event.pointerId);
        event.preventDefault();
    }, true);
    mapElement.addEventListener('pointermove', event => {
        if (tool !== 'area' || !event.isPrimary || (gesture && gesture.id !== event.pointerId)) return;
        const start = firstCorner || (gesture && movedFromStart(event) && gesture.start);
        if (!start) return;
        const bounds = L.latLngBounds(start, map.mouseEventToLatLng(event));
        if (previewRectangle) previewRectangle.setBounds(bounds);
        else previewRectangle = L.rectangle(bounds, selectionStyle).addTo(map);
    });
    mapElement.addEventListener('pointerup', event => {
        if (gesture?.id !== event.pointerId) return;
        const start = firstCorner || gesture.start;
        const end = map.mouseEventToLatLng(event);
        const dragged = movedFromStart(event);
        gesture = null;
        ignoreAreaClick = true;
        if ((firstCorner || dragged) && start.lat !== end.lat && start.lng !== end.lng) {
            selectArea(L.latLngBounds(start, end));
        } else {
            firstCorner = start;
            feedback.textContent = 'Select the opposite corner to finish the rectangle.';
        }
    });
    mapElement.addEventListener('pointercancel', event => {
        if (gesture?.id === event.pointerId) setTool();
    });
    mapElement.addEventListener('click', event => {
        // A release that finishes a rectangle can also generate a click on the map.
        if (ignoreAreaClick && event.detail && !event.target.closest('.leaflet-control, .leaflet-popup')) {
            ignoreAreaClick = false;
            event.stopImmediatePropagation();
        }
    }, true);

    function selectPoint(latlng) {
        area = null;
        if (areaLayer) {
            areaLayer.remove();
            areaLayer = null;
        }
        point = latlng;
        if (marker) marker.setLatLng(point);
        else marker = L.circleMarker(point, { radius: 5, color: '#5f1724', fillOpacity: 0.7 }).addTo(map);
        newSelection();
    }

    function addMeasurement(latlng) {
        const prior = measurePoints.at(-1);
        if (prior) {
            const segment = map.distance(prior, latlng);
            if (segment < 0.1) return;
            measureTotal += segment;
            const label = measureTotal >= 1000 ? `${(measureTotal / 1000).toFixed(2)} km` :
                `${Math.round(measureTotal)} m`;
            feedback.textContent = `Total distance ${label} · Double-click to finish`;
        }
        measurePoints.push(latlng);
        L.circleMarker(latlng, { radius: 4, color: '#2563eb', fillOpacity: 1 }).addTo(measurements);
        measureLine.addLatLng(latlng);
    }

    async function screenshot(button) {
        if (!current) return;
        if (layer.isLoading()) {
            feedback.textContent = 'Wait for the map tiles to load before saving.';
            return;
        }
        button.disabled = true;
        const composite = current;
        const stops = schemes[colorScheme.value];
        feedback.textContent = 'Preparing map image…';
        try {
            const captured = await EV.captureMap(map);
            const output = document.createElement('canvas');
            output.width = captured.width;
            output.height = captured.height + 76;
            const context = output.getContext('2d');
            context.fillStyle = '#fff';
            context.fillRect(0, 0, output.width, output.height);
            context.drawImage(captured, 0, 0);
            const left = 14;
            const width = Math.min(320, output.width - 28);
            const top = captured.height + 42;
            context.fillStyle = '#171517';
            context.font = '14px sans-serif';
            context.fillText('EOSIAL Fire Weather Viewer · ' + label(composite), left, top - 21, output.width - 28);
            context.font = '12px sans-serif';
            context.fillText('LFMC (% dry mass)', left, top - 5);
            const gradient = context.createLinearGradient(left, 0, left + width, 0);
            for (const [value, color] of stops) gradient.addColorStop(ratio(value), color);
            context.fillStyle = gradient;
            context.fillRect(left, top, width, 9);
            context.fillStyle = '#171517';
            for (const [value, text] of ticks) {
                context.textAlign = value === minimum ? 'left' : value === maximum ? 'right' : 'center';
                context.fillText(text, left + width * ratio(value), top + 25);
            }
            const link = document.createElement('a');
            link.href = output.toDataURL('image/png');
            link.download = `eosial-lfmc-${composite.start}.png`;
            link.click();
            feedback.textContent = '';
        } catch (error) {
            feedback.textContent = 'Could not save the map image.';
            console.error(error);
        } finally {
            button.disabled = false;
        }
    }

    const toolbar = L.control({ position: 'topright' });
    toolbar.onAdd = () => {
        const wrap = L.DomUtil.create('div', 'map-toolbar leaflet-bar');
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', 'Map tools');
        const closeMenus = EV.addMapToolbarBase(map, wrap, basemaps);
        const pointButton = EV.mapToolButton(wrap, 'point', 'Query point time series');
        const areaButton = EV.mapToolButton(wrap, 'area', 'Query area time series');
        const dark = EV.mapToolButton(wrap, 'dark', 'Toggle dark mode');
        const ruler = EV.mapToolButton(wrap, 'measure', 'Measure distance');
        const camera = EV.mapToolButton(wrap, 'camera', 'Download map image');
        for (const button of [pointButton, areaButton, dark, ruler]) button.setAttribute('aria-pressed', 'false');
        pointButton.onclick = () => {
            closeMenus();
            if (tool === 'point') return setTool();
            setTool(pointButton, 'point', 'Click a pixel to load its time series.');
        };
        areaButton.onclick = () => {
            closeMenus();
            if (tool === 'area') return setTool();
            setTool(areaButton, 'area', 'Drag and release, or select two opposite corners.');
        };
        dark.onclick = () => {
            closeMenus();
            const enabled = document.body.classList.toggle('dark');
            dark.classList.toggle('active', enabled);
            dark.setAttribute('aria-pressed', String(enabled));
        };
        ruler.onclick = () => {
            closeMenus();
            if (tool === 'measure') return setTool();
            measurements.clearLayers();
            measurePoints.length = 0;
            measureTotal = 0;
            measureLine = L.polyline([], { color: '#2563eb', weight: 2.5, dashArray: '6,6' }).addTo(measurements);
            setTool(ruler, 'measure', 'Click points along the map · Double-click to finish');
        };
        camera.onclick = () => {
            closeMenus();
            screenshot(camera);
        };
        return wrap;
    };
    toolbar.addTo(map);
    map.on('click', ({ latlng }) => {
        if (tool === 'measure') return addMeasurement(latlng);
        if (tool === 'area') return;
        const query = tool === 'point';
        if (query) setTool();
        selectPoint(latlng);
        if (query) loadHistory();
    });
    map.on('dblclick', () => {
        if (tool === 'measure') setTool(null, null, feedback.textContent.split(' · ')[0]);
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && tool) setTool();
    });

    opacity.addEventListener('input', () => layer?.setOpacity(Number(opacity.value)));
    colorScheme.addEventListener('change', () => {
        updateLegend();
        layer?.redraw();
        try { localStorage.setItem('eosial-lfmc-palette', colorScheme.value); } catch { /* Optional preference. */ }
    });
    selector.addEventListener('change', () => show(composites[Number(selector.value)]));

    try {
        const response = await fetch(asset('manifest.json'), { cache: 'no-cache' });
        if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
        const manifest = await response.json();
        if (manifest.schema !== 'eosial-lfmc-v1') throw new Error('Unsupported LFMC manifest');
        composites = manifest.composites.filter(record => record.encoding === 'uint16-nearest-v1').reverse();
        if (!composites.length) {
            status.textContent = 'No LFMC composites have been published yet.';
            return;
        }
        composites.forEach((record, i) => selector.add(new Option(label(record), i)));
        selector.disabled = false;
        history.disabled = !point && !area;
        show(composites[0], true);
    } catch (error) {
        status.textContent = 'The LFMC archive is currently unavailable.';
        console.error(error);
    }
})();
