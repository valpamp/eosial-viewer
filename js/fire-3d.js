(function () {
    'use strict';
    var leafletMap, dataBase, map3D, popup, libraryLoad, active = false, opening = false;
    var lastView = null;
    var openVersion = 0;
    var representatives = Object.create(null);
    var elements = {};
    var resizeObserver;

    function emptyCollection() { return { type: 'FeatureCollection', features: [] }; }

    function loadLibrary() {
        if (window.maplibregl) return Promise.resolve();
        if (libraryLoad) return libraryLoad;
        libraryLoad = new Promise(function (resolve, reject) {
            var css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = 'https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.css';
            document.head.appendChild(css);
            var script = document.createElement('script');
            script.src = 'https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.js';
            script.onload = function () { resolve(); };
            script.onerror = function () { script.remove(); css.remove(); libraryLoad = null; reject(new Error('Could not load the 3D library.')); };
            document.head.appendChild(script);
        });
        return libraryLoad;
    }

    /* Geometry is shared with 2D; one polygon may represent several observations. */
    function buildFireCollection(features, presentation) {
        var buckets = Object.create(null);
        var points = [];
        features.forEach(function (feature) {
            var p = feature.properties;
            var style = presentation(p);
            var footprint = style.footprint;
            if (!footprint || footprint.corners.some(function (c) { return !c.every(Number.isFinite); })) {
                points.push({ feature: feature, style: style, count: 1 });
                return;
            }
            var key = footprint.key + ':' + (p.DATASET === 'S3' ? p.S3_RETRIEVAL || 'standard' : '');
            var bucket = buckets[key];
            if (!bucket) bucket = buckets[key] = { feature: feature, style: style, count: 0 };
            bucket.count++;
            if (Number(p.FRP_WOOSTER) > Number(bucket.feature.properties.FRP_WOOSTER)) {
                bucket.feature = feature; bucket.style = style;
            }
        });
        var lookup = Object.create(null);
        var collection = emptyCollection();
        Object.keys(buckets).map(function (key) { return buckets[key]; }).concat(points).forEach(function (bucket, id) {
            var p = bucket.feature.properties;
            var footprint = bucket.style.footprint;
            var geometry;
            if (footprint && footprint.corners.every(function (c) { return c.every(Number.isFinite); })) {
                var ring = footprint.corners.map(function (c) { return [c[1], c[0]]; });
                ring.push(ring[0].slice());
                geometry = { type: 'Polygon', coordinates: [ring] };
            } else {
                geometry = { type: 'Point', coordinates: [p.LONGITUDE, p.LATITUDE] };
            }
            lookup[id] = bucket;
            collection.features.push({ type: 'Feature', id: id, geometry: geometry,
                properties: { pixelId: id, color: bucket.style.color, opacity: bucket.style.opacity } });
        });
        return { collection: collection, lookup: lookup, detectionCount: features.length };
    }

    function setStatus(message, error) {
        elements.status.textContent = message;
        elements.status.classList.toggle('terrain-error', !!error);
    }

    function syncFeatures() {
        if (!map3D || !map3D.getSource('fire-pixels')) return;
        if (popup) { popup.remove(); popup = null; }
        var features = EV.fireHotspots.getDisplayedFeatures();
        var result = buildFireCollection(features, EV.fireHotspots.getPresentation);
        representatives = result.lookup;
        map3D.getSource('fire-pixels').setData(result.collection);
        elements.count.textContent = (EV.fireHotspots.isLoading() ? 'Loading fire detections... ' : '') + result.detectionCount + ' selected detections · ' + result.collection.features.length + ' displayed footprints/points';
        var sources = {};
        features.forEach(function (feature) {
            var p = feature.properties;
            sources[p.SATELLITE] = EV.fireHotspots.getPresentation(p).color;
        });
        elements.legend.replaceChildren();
        Object.keys(sources).sort().forEach(function (satellite) {
            var item = document.createElement('span');
            var swatch = document.createElement('i');
            swatch.style.background = sources[satellite];
            item.appendChild(swatch);
            item.appendChild(document.createTextNode(satellite));
            elements.legend.appendChild(item);
        });
        var warnings = EV.fireHotspots.getLoadWarnings();
        elements.coverage.textContent = warnings.length ? warnings.join(' ') + ' Detections may be incomplete.' : '';
    }

    function resetView() {
        if (map3D) map3D.easeTo({ pitch: 55, bearing: 0, duration: 400 });
    }

    async function open() {
        if (opening || active) return;
        if (EV.fireAnimation && EV.fireAnimation.isExporting()) {
            alert('Wait for the animation export to finish before switching to 3D.');
            return;
        }
        if (EV.fireAnimation && EV.fireAnimation.isActive && EV.fireAnimation.isActive()) EV.fireAnimation.close();
        var version = ++openVersion;
        opening = true;
        elements.toggle.disabled = true;
        elements.toggle.textContent = 'Loading 3D...';
        elements.panel.classList.remove('hidden');
        elements.panel.setAttribute('aria-hidden', 'false');
        document.body.classList.add('terrain-3d-active');
        setStatus('Loading 90 m terrain view...');
        try {
            await loadLibrary();
            if (!opening || version !== openVersion) return;
            if (typeof maplibregl.supported === 'function' && !maplibregl.supported()) throw new Error('This browser cannot display WebGL terrain.');
            var response = await fetch((window.EOSIAL_TERRAIN_URL || dataBase + '/terrain/glo90').replace(/\/$/, '') + '/tiles.json');
            if (!response.ok) throw new Error('The 90 m terrain tiles could not be loaded.');
            var metadata = await response.json();
            if (!opening || version !== openVersion) return;
            var terrainBase = new URL((window.EOSIAL_TERRAIN_URL || dataBase + '/terrain/glo90').replace(/\/$/, '') + '/', location.href).href;
            var center = leafletMap.getCenter();
            map3D = new maplibregl.Map({
                container: 'terrain3d-map', center: [center.lng, center.lat], zoom: Math.max(3, leafletMap.getZoom() - 1),
                pitch: lastView ? lastView.pitch : 55, bearing: lastView ? lastView.bearing : 0,
                maxPitch: 75, maxZoom: 17, maxBounds: [[6, 35], [20, 48]], renderWorldCopies: false,
                style: { version: 8, sources: {
                    basemap: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256,
                        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxzoom: 19 },
                    elevation: { type: 'raster-dem', tiles: [terrainBase + '{z}/{x}/{y}.png'], tileSize: 256,
                        encoding: 'terrarium', bounds: metadata.bounds, minzoom: metadata.minzoom, maxzoom: metadata.maxzoom,
                        attribution: EV.escapeHtml(metadata.attribution) },
                    relief: { type: 'raster-dem', tiles: [terrainBase + '{z}/{x}/{y}.png'], tileSize: 256,
                        encoding: 'terrarium', bounds: metadata.bounds, minzoom: metadata.minzoom, maxzoom: metadata.maxzoom },
                    'fire-pixels': { type: 'geojson', data: emptyCollection() }
                }, layers: [
                    { id: 'basemap', type: 'raster', source: 'basemap' },
                    { id: 'relief', type: 'hillshade', source: 'relief', paint: { 'hillshade-exaggeration': 0.45 } },

                    { id: 'fire-fill', type: 'fill', source: 'fire-pixels', filter: ['==', ['geometry-type'], 'Polygon'],
                        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] } },
                    { id: 'fire-outline', type: 'line', source: 'fire-pixels', filter: ['==', ['geometry-type'], 'Polygon'],
                        paint: { 'line-color': ['get', 'color'], 'line-width': 2 } },
                    { id: 'fire-points', type: 'circle', source: 'fire-pixels', filter: ['==', ['geometry-type'], 'Point'],
                        paint: { 'circle-color': ['get', 'color'], 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } }
                ] },
                attributionControl: true
            });
            active = true;
            map3D.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
            map3D.addControl(new maplibregl.ScaleControl({ unit: 'metric' }));
            map3D.on('load', function () {
                map3D.setTerrain({ source: 'elevation', exaggeration: Number(elements.exaggeration.value) });
                syncFeatures();
                setStatus('Drag to pan. Right-drag or use two fingers to rotate and tilt.');
                EV.pixelGrids.preloadHotspotGrids().then(syncFeatures).catch(function () {
                    setStatus('Some native pixel grids are unavailable; their detections are shown as points.', true);
                });
            });
            map3D.on('error', function (event) {
                console.warn('[3D]', event.error);
                setStatus('Some map or terrain tiles could not be loaded. Return to 2D and reopen to retry.', true);
            });
            map3D.on('click', function (event) {
                var picked = map3D.queryRenderedFeatures(event.point, { layers: ['fire-fill', 'fire-outline', 'fire-points'] });
                if (!picked.length) return;
                var bucket = representatives[picked[0].properties.pixelId];
                if (!bucket) return;
                var content = document.createElement('div');
                content.innerHTML = EV.fireHotspots.getPopup(bucket.feature.properties, bucket.count);
                // Location timeseries and analysis remain owned by the 2D tools.
                var timeseriesLink = content.querySelector('.fire-ts-link');
                if (timeseriesLink) timeseriesLink.remove();
                if (bucket.style.footprint && bucket.style.footprint.approximate) {
                    var note = document.createElement('p');
                    note.textContent = 'Approximate sensor footprint; terrain does not improve detection geolocation.';
                    content.appendChild(note);
                }
                if (popup) popup.remove();
                popup = new maplibregl.Popup({ maxWidth: '340px' }).setLngLat(event.lngLat).setDOMContent(content).addTo(map3D);
            });
            resizeObserver = new ResizeObserver(function () { if (map3D) map3D.resize(); });
            resizeObserver.observe(elements.panel);
            elements.toggle.textContent = '3D';
        } catch (error) {
            console.warn('[3D]', error);
            close();
            elements.toggle.title = error.message + ' Click to retry.';
            alert(error.message + ' The 2D viewer remains available.');
        } finally {
            opening = false;
            elements.toggle.disabled = false;
            elements.toggle.textContent = '3D';
        }
    }

    function close() {
        opening = false;
        if (map3D) {
            var center = map3D.getCenter();
            lastView = { pitch: map3D.getPitch(), bearing: map3D.getBearing() };
            leafletMap.setView([center.lat, center.lng], map3D.getZoom() + 1, { animate: false });
            if (popup) { popup.remove(); popup = null; }
            map3D.remove(); map3D = null;
        }
        if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
        active = false;
        elements.panel.classList.add('hidden');
        elements.panel.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('terrain-3d-active');
        elements.toggle.disabled = false;
        elements.toggle.textContent = '3D';
        leafletMap.invalidateSize();
        elements.toggle.focus();
    }

    EV.fire3D = {
        init: function (map, baseUrl) {
            leafletMap = map; dataBase = baseUrl;
            ['panel', 'status', 'count', 'legend', 'coverage', 'exaggeration'].forEach(function (name) {
                elements[name] = document.getElementById('terrain3d-' + name);
            });
            elements.toggle = document.getElementById('btn-toggle-3d');
            elements.toggle.addEventListener('click', open);
            document.getElementById('terrain3d-close').addEventListener('click', close);
            document.getElementById('terrain3d-reset').addEventListener('click', resetView);
            elements.exaggeration.addEventListener('change', function () {
                if (map3D) map3D.setTerrain({ source: 'elevation', exaggeration: Number(elements.exaggeration.value) });
            });
            document.querySelectorAll('[data-terrain-place]').forEach(function (button) {
                button.addEventListener('click', function () {
                    if (!map3D) return;
                    var place = button.dataset.terrainPlace === 'vesuvius' ? [14.43, 40.82] : [13.56, 42.45];
                    map3D.flyTo({ center: place, zoom: 11, pitch: 60, bearing: -20, duration: 1000 });
                });
            });
            document.addEventListener('keydown', function (event) {
                if (event.key === 'Escape' && (active || opening)) close();
            });
            EV.on('fire:display', syncFeatures);
        },
        open: open, close: close,
        isActive: function () { return active || opening; },
        buildFireCollection: buildFireCollection
    };
})();
