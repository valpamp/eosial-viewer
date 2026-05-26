/**
 * EOSIAL Viewer — LFMC raster layer
 *
 * Loads Cloud Optimized GeoTIFFs via georaster-layer-for-leaflet.
 * Reads a manifest.json that lists available AOIs, polygons, and dates with COG URLs.
 *
 * manifest.json structure:
 * {
 *   "aois": {
 *     "BA-ESP-AUG25": {
 *       "label": "Badajoz, Spain — Aug 2025",
 *       "polygons": {
 *         "15": {
 *           "dates": {
 *             "2025-06-01": "cogs/BA-ESP-AUG25/15/2025-06-01.tif",
 *             "2025-06-07": "cogs/BA-ESP-AUG25/15/2025-06-07.tif"
 *           }
 *         }
 *       }
 *     }
 *   }
 * }
 */
(function () {

    var NODATA = -9999;
    var NODATA_U8 = 255;

    // State
    var manifest          = null;   // loaded manifest object
    var precomputedStats  = null;   // loaded stats.json {aoi: {poly: {date: {mean,median,q25,q75}}}}
    var currentAoi        = null;
    var currentPoly       = null;
    var currentDate       = null;
    var currentUrl        = null;   // URL of the currently displayed COG
    var rasterLayer       = null;   // active GeoRasterLayer on the map
    var activeGeoraster   = null;   // georaster for hover/query; populated lazily
    var georasterCache    = {};     // url → fully-parsed georaster (for point queries on small AOIs)
    var currentAbort      = null;   // AbortController for the in-flight display COG fetch
    var showGeneration    = 0;      // incremented each showDate call; guards against stale renders
    var opacity           = 1.0;
    var visible           = false;

    /* ── Manifest + stats loading ─────────────────────────────── */

    function loadManifest(url) {
        EV.showLoading('Loading LFMC manifest...');
        // Cache-bust the manifest so stale CDN copies are never used
        var bust = url + '?v=' + Date.now();
        return fetch(bust)
            .then(function (r) {
                if (!r.ok) throw new Error('Manifest fetch failed: ' + r.status);
                return r.json();
            })
            .then(function (data) {
                manifest = data;
                EV.hideLoading();
                return data;
            })
            .catch(function (err) {
                console.error('[LFMC] manifest error:', err);
                EV.hideLoading();
            });
    }

    // stats.json is optional — silently ignored if absent (small/legacy AOIs use COG fallback)
    function loadStats(url) {
        var bust = url + '?v=' + Date.now();
        return fetch(bust)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) { precomputedStats = data; return data; })
            .catch(function () { precomputedStats = null; });
    }

    /* ── COG loading ───────────────────────────────────────────── */

    // Full download — used only for point timeseries queries on small AOIs.
    // Results are cached so repeat queries on the same date are instant,
    // and hover tooltip becomes available for any date that has been queried.
    function loadCOG(url, signal) {
        if (georasterCache[url]) return Promise.resolve(georasterCache[url]);
        EV.showLoading('Loading LFMC raster...');
        return fetch(url, signal ? { signal: signal } : {})
            .then(function (r) { return r.arrayBuffer(); })
            .then(function (buf) { return parseGeoraster(buf); })
            .then(function (gr) {
                georasterCache[url] = gr;
                EV.hideLoading();
                if (url === currentUrl) activeGeoraster = gr;
                return gr;
            })
            .catch(function (err) {
                if (err.name === 'AbortError') { EV.hideLoading(); return null; }
                console.error('[LFMC] COG load error:', err);
                EV.hideLoading();
                throw err;
            });
    }

    /* ── Pixel-value color function (shared) ──────────────────── */

    function _pixelToColor(vals) {
        var v = vals[0];
        if (v === NODATA || v === NODATA_U8 || v === null || v === undefined) return null;
        var rgba = EV.lfmcColor(v, NODATA);
        return 'rgba(' + rgba[0] + ',' + rgba[1] + ',' + rgba[2] + ',' + (rgba[3] / 255) + ')';
    }

    /* ── Switch date ───────────────────────────────────────────── */

    function showDate(dateStr, map, fitBounds) {
        if (!manifest || !currentAoi || currentPoly === null) return;
        var aoi = manifest.aois[currentAoi];
        if (!aoi) return;
        var poly = aoi.polygons[currentPoly];
        if (!poly || !poly.dates[dateStr]) return;

        currentDate = dateStr;
        var url = poly.dates[dateStr];
        if (url && !url.match(/^https?:\/\//)) url = EV.dataBaseUrl + '/' + url;
        currentUrl = url;

        // Update UI immediately — don't wait for the async tile load
        updateDateLabel();
        EV.emit('lfmc:dateChanged', { date: dateStr });

        if (!visible) {
            if (rasterLayer) { map.removeLayer(rasterLayer); rasterLayer = null; }
            activeGeoraster = null;
            if (currentAbort) { currentAbort.abort(); currentAbort = null; }
            return;
        }

        // Cancel any in-flight COG download and guard against stale renders
        if (currentAbort) { currentAbort.abort(); }
        currentAbort = new AbortController();
        var signal = currentAbort.signal;
        var myGen = ++showGeneration;

        if (rasterLayer) { map.removeLayer(rasterLayer); rasterLayer = null; }
        activeGeoraster = null;

        loadCOG(url, signal).then(function (gr) {
            if (myGen !== showGeneration) return; // a newer showDate already ran
            if (!gr) return; // aborted
            currentAbort = null;
            activeGeoraster = gr;
            // Remove any layer added by a racing callback since the sync removal above
            if (rasterLayer) { map.removeLayer(rasterLayer); rasterLayer = null; }
            rasterLayer = new GeoRasterLayer({   // eslint-disable-line no-undef
                georaster: gr,
                opacity: opacity,
                resolution: 256,
                pixelValuesToColorFn: _pixelToColor
            });
            if (visible) rasterLayer.addTo(map);
            if (fitBounds) {
                var b = rasterLayer.getBounds();
                if (b && b.isValid()) map.fitBounds(b, { padding: [30, 30] });
            }
        }).catch(function (err) {
            console.error('[LFMC] COG load error:', err);
        });
    }

    /* ── Pixel query ───────────────────────────────────────────── */

    /**
     * Query the LFMC value at a point for every available date.
     * Returns array of { date, value }.
     */
    function queryPoint(latlng, map) {
        if (!manifest || !currentAoi || currentPoly === null) return Promise.resolve([]);
        var aoi = manifest.aois[currentAoi];
        var poly = aoi.polygons[currentPoly];
        if (!poly) return Promise.resolve([]);

        var dates = Object.keys(poly.dates).sort();
        EV.showLoading('Querying ' + dates.length + ' dates...');

        var promises = dates.map(function (d) {
            var url = poly.dates[d];
            if (url && !url.match(/^https?:\/\//)) url = EV.dataBaseUrl + '/' + url;
            return loadCOG(url).then(function (gr) {
                var val = getPixelValue(gr, latlng);
                return { date: new Date(d), value: val };
            }).catch(function () {
                return { date: new Date(d), value: null };
            });
        });

        return Promise.all(promises).then(function (results) {
            EV.hideLoading();
            return results.filter(function (r) { return r.value !== null && r.value !== NODATA && r.value !== NODATA_U8; });
        });
    }

    /**
     * Query LFMC statistics within a polygon for every available date.
     *
     * If stats.json was loaded, returns whole-AOI pre-computed stats instantly.
     * Falls back to sampling a grid of pixels from downloaded COGs for small AOIs.
     */
    function queryPolygon(bounds, map) {
        if (!manifest || !currentAoi || currentPoly === null) return Promise.resolve([]);
        var aoi = manifest.aois[currentAoi];
        var poly = aoi.polygons[currentPoly];
        if (!poly) return Promise.resolve([]);

        var dates = Object.keys(poly.dates).sort();

        // Fast path: use pre-computed whole-AOI statistics
        if (precomputedStats &&
            precomputedStats[currentAoi] &&
            precomputedStats[currentAoi][currentPoly]) {
            var aoiStats = precomputedStats[currentAoi][currentPoly];
            var series = dates.map(function (d) {
                var s = aoiStats[d];
                if (!s) return null;
                return {
                    date:   new Date(d),
                    mean:   Math.round(s.mean   * 10) / 10,
                    median: Math.round(s.median * 10) / 10,
                    q25:    Math.round(s.q25    * 10) / 10,
                    q75:    Math.round(s.q75    * 10) / 10
                };
            }).filter(Boolean);
            return Promise.resolve(series);
        }

        // Fallback: sample a grid of pixels from downloaded COGs (small AOIs only)
        var sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
        var nLat = 20, nLng = 20;
        var dLat = (ne.lat - sw.lat) / nLat;
        var dLng = (ne.lng - sw.lng) / nLng;
        var samplePts = [];
        for (var i = 0; i <= nLat; i++) {
            for (var j = 0; j <= nLng; j++) {
                samplePts.push(L.latLng(sw.lat + i * dLat, sw.lng + j * dLng));
            }
        }

        EV.showLoading('Querying polygon (' + dates.length + ' dates)...');

        var promises = dates.map(function (d) {
            var url = poly.dates[d];
            if (url && !url.match(/^https?:\/\//)) url = EV.dataBaseUrl + '/' + url;
            return loadCOG(url).then(function (gr) {
                var vals = [];
                for (var k = 0; k < samplePts.length; k++) {
                    var v = getPixelValue(gr, samplePts[k]);
                    if (v !== null && v !== NODATA && v !== NODATA_U8 && !isNaN(v)) vals.push(v);
                }
                if (vals.length === 0) return { date: new Date(d), mean: null, median: null, q25: null, q75: null };
                vals.sort(function (a, b) { return a - b; });
                var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
                var median = vals.length % 2 === 0
                    ? (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2
                    : vals[Math.floor(vals.length / 2)];
                var q25 = vals[Math.floor(vals.length * 0.25)];
                var q75 = vals[Math.floor(vals.length * 0.75)];
                return {
                    date:   new Date(d),
                    mean:   Math.round(mean   * 10) / 10,
                    median: Math.round(median * 10) / 10,
                    q25:    Math.round(q25    * 10) / 10,
                    q75:    Math.round(q75    * 10) / 10
                };
            }).catch(function () {
                return { date: new Date(d), mean: null, median: null, q25: null, q75: null };
            });
        });

        return Promise.all(promises).then(function (results) {
            EV.hideLoading();
            return results.filter(function (r) { return r.mean !== null; });
        });
    }

    /* ── Pixel value extraction ────────────────────────────────── */

    function getPixelValue(georaster, latlng) {
        // georaster may come from URL-based loading and not have values pre-loaded
        if (!georaster || !georaster.values || !georaster.values[0]) return null;
        var x = Math.floor((latlng.lng - georaster.xmin) / georaster.pixelWidth);
        var y = Math.floor((georaster.ymax - latlng.lat) / georaster.pixelHeight);
        if (x < 0 || y < 0 || x >= georaster.width || y >= georaster.height) return null;
        return georaster.values[0][y][x];
    }

    /* ── Sidebar controls ──────────────────────────────────────── */

    function buildControls(map) {
        var container = document.getElementById('product-toolbar-content') || document.getElementById('layer-controls');

        var section = document.createElement('div');
        section.id = 'lfmc-controls';
        section.className = 'product-toolbar-section hidden';
        section.innerHTML =
            '<h2 class="text-sm font-semibold text-gray-700 mb-2">LFMC — Live Fuel Moisture</h2>' +

            /* AOI selector */
            '<div class="mb-3">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Area of Interest</label>' +
            '  <select id="lfmc-aoi-select" class="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md">' +
            '    <option value="">— loading —</option>' +
            '  </select>' +
            '</div>' +

            /* Polygon selector (hidden for single-polygon AOIs) */
            '<div id="lfmc-poly-wrap" class="mb-3 hidden">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Polygon</label>' +
            '  <select id="lfmc-poly-select" class="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md"></select>' +
            '</div>' +

            /* Date selector + slider */
            '<div class="mb-3">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Date</label>' +
            '  <select id="lfmc-date-select" class="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md mb-2"></select>' +
            '  <input type="range" id="lfmc-date-slider" min="0" max="0" value="0" class="w-full">' +
            '</div>' +

            /* Previous / Play / Next buttons */
            '<div class="flex gap-2 mb-3">' +
            '  <button id="lfmc-prev" class="flex-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">&laquo; Prev</button>' +
            '  <button id="lfmc-play" class="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200" title="Animate through dates">&#9654;</button>' +
            '  <button id="lfmc-next" class="flex-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Next &raquo;</button>' +
            '</div>' +

            /* Colormap selector */
            '<div class="mb-3">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Colormap</label>' +
            '  <select id="lfmc-cmap-select" class="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md"></select>' +
            '</div>' +

            /* Opacity */
            '<div class="mb-2">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Opacity</label>' +
            '  <input type="range" id="lfmc-opacity" min="0" max="100" value="100" class="opacity-slider">' +
            '</div>';

        section.innerHTML =
            '<div class="product-toolbar-title">Live Fuel Moisture Content</div>' +
            '<div class="toolbar-divider"></div>' +
            '<div class="product-toolbar-group">' +
            '  <span class="product-toolbar-label">AOI</span>' +
            '  <span class="toolbar-field"><select id="lfmc-aoi-select"><option value="">Loading...</option></select></span>' +
            '</div>' +
            '<div id="lfmc-poly-wrap" class="product-toolbar-group hidden">' +
            '  <span class="product-toolbar-label">Polygon</span>' +
            '  <span class="toolbar-field"><select id="lfmc-poly-select"></select></span>' +
            '</div>' +
            '<div class="product-toolbar-group">' +
            '  <span class="product-toolbar-label">Date</span>' +
            '  <span class="toolbar-field"><select id="lfmc-date-select"></select></span>' +
            '  <span class="toolbar-field"><input type="range" id="lfmc-date-slider" min="0" max="0" value="0"></span>' +
            '</div>' +
            '<div class="product-toolbar-group">' +
            '  <button id="lfmc-prev" class="toolbar-btn-compact" title="Previous date">&laquo;</button>' +
            '  <button id="lfmc-play" class="toolbar-btn-compact" title="Animate through dates">&#9654;</button>' +
            '  <button id="lfmc-next" class="toolbar-btn-compact" title="Next date">&raquo;</button>' +
            '</div>' +
            '<div class="product-toolbar-group">' +
            '  <span class="product-toolbar-label">Color</span>' +
            '  <span class="toolbar-field"><select id="lfmc-cmap-select"></select></span>' +
            '</div>' +
            '<div class="product-toolbar-group">' +
            '  <span class="product-toolbar-label">Opacity</span>' +
            '  <span class="toolbar-field"><input type="range" id="lfmc-opacity" min="0" max="100" value="100"></span>' +
            '</div>';

        container.appendChild(section);
        EV.updateProductToolbarVisibility();

        // Wire events
        document.getElementById('lfmc-aoi-select').addEventListener('change', function () {
            selectAoi(this.value, map, true);
        });
        document.getElementById('lfmc-poly-select').addEventListener('change', function () {
            selectPolygon(this.value, map, true);
        });
        document.getElementById('lfmc-date-select').addEventListener('change', function () {
            var idx = +this.value;
            var dates = getDates();
            if (!dates.length) return;
            document.getElementById('lfmc-date-slider').value = idx;
            showDate(dates[idx], map, false);
        });
        document.getElementById('lfmc-date-slider').addEventListener('input', function () {
            var dates = getDates();
            if (!dates.length) return;
            document.getElementById('lfmc-date-select').value = this.value;
            showDate(dates[+this.value], map, false);
        });
        document.getElementById('lfmc-prev').addEventListener('click', function () {
            stepDate(-1, map);
        });
        document.getElementById('lfmc-next').addEventListener('click', function () {
            stepDate(1, map);
        });
        document.getElementById('lfmc-opacity').addEventListener('input', function () {
            opacity = +this.value / 100;
            if (rasterLayer) rasterLayer.setOpacity(opacity);
        });

        // Playback
        var playTimer = null;
        var playBtn = document.getElementById('lfmc-play');

        function startPlayTimer() {
            playTimer = setInterval(function () {
                var slider = document.getElementById('lfmc-date-slider');
                var next = +slider.value + 1;
                if (next > +slider.max) next = 0;
                slider.value = next;
                document.getElementById('lfmc-date-select').value = String(next);
                var dates = getDates();
                if (dates.length) showDate(dates[next], map, false);
            }, 1000);
        }

        function stopPlay() {
            clearInterval(playTimer);
            playTimer = null;
            playBtn.innerHTML = '&#9654;';
            playBtn.classList.remove('bg-blue-100', 'text-blue-700');
        }

        playBtn.addEventListener('click', function () {
            if (playTimer) { stopPlay(); return; }

            playBtn.innerHTML = '&#9646;&#9646;';
            playBtn.classList.add('bg-blue-100', 'text-blue-700');

            // Pre-load all dates sequentially so animation plays from cache
            var dates = getDates();
            var poly = manifest.aois[currentAoi].polygons[currentPoly];
            var i = 0;
            function loadNext() {
                if (!playTimer && i > 0) return; // stopped before preload finished
                if (i >= dates.length) { startPlayTimer(); return; }
                var url = poly.dates[dates[i]];
                if (url && !url.match(/^https?:\/\//)) url = EV.dataBaseUrl + '/' + url;
                i++;
                EV.showLoading('Pre-loading ' + i + ' / ' + dates.length + '...');
                // Skip abort signal so preload fetches aren't cancelled by showDate
                var p = georasterCache[url]
                    ? Promise.resolve(georasterCache[url])
                    : fetch(url).then(function (r) { return r.arrayBuffer(); })
                               .then(function (buf) { return parseGeoraster(buf); })
                               .then(function (gr) { georasterCache[url] = gr; return gr; });
                p.then(loadNext).catch(loadNext); // skip errors, keep going
            }

            // If already preloaded (all in cache), start immediately
            var allCached = dates.every(function (d) {
                var u = poly.dates[d];
                if (u && !u.match(/^https?:\/\//)) u = EV.dataBaseUrl + '/' + u;
                return !!georasterCache[u];
            });
            if (allCached) { EV.hideLoading(); startPlayTimer(); }
            else { playTimer = true; loadNext(); } // set truthy so stopPlay check works
        });

        // Populate colormap dropdown
        var cmapSel = document.getElementById('lfmc-cmap-select');
        Object.keys(EV.LFMC_COLORMAPS).forEach(function (key) {
            var opt = document.createElement('option');
            opt.value = key;
            opt.textContent = EV.LFMC_COLORMAPS[key].label;
            if (key === EV.lfmcColormap) opt.selected = true;
            cmapSel.appendChild(opt);
        });
        cmapSel.addEventListener('change', function () {
            EV.setLfmcColormap(this.value);
            // Re-render the current raster with new colors
            if (currentDate) showDate(currentDate, map, false);
        });
    }

    function populateAoiSelect() {
        var sel = document.getElementById('lfmc-aoi-select');
        sel.innerHTML = '';
        if (!manifest) return;
        var aois = Object.keys(manifest.aois);
        aois.forEach(function (key) {
            var opt = document.createElement('option');
            opt.value = key;
            opt.textContent = manifest.aois[key].label || key;
            sel.appendChild(opt);
        });
        return aois[0] || null;
    }

    function selectAoi(aoiKey, map, fit) {
        currentAoi = aoiKey;
        var aoi = manifest.aois[aoiKey];
        var polyKeys = Object.keys(aoi.polygons);

        var polyWrap = document.getElementById('lfmc-poly-wrap');
        var polySel  = document.getElementById('lfmc-poly-select');
        polySel.innerHTML = '';

        if (polyKeys.length > 1) {
            polyWrap.classList.remove('hidden');
            polyKeys.forEach(function (k) {
                var opt = document.createElement('option');
                opt.value = k;
                opt.textContent = k || 'single';
                polySel.appendChild(opt);
            });
        } else {
            polyWrap.classList.add('hidden');
        }
        selectPolygon(polyKeys[0], map, fit);
    }

    function selectPolygon(polyKey, map, fit) {
        currentPoly = polyKey;
        var dates = getDates();

        // Populate date dropdown
        var sel = document.getElementById('lfmc-date-select');
        sel.innerHTML = '';
        dates.forEach(function (d, i) {
            var opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = d;
            sel.appendChild(opt);
        });

        var slider = document.getElementById('lfmc-date-slider');
        slider.max = Math.max(0, dates.length - 1);
        slider.value = dates.length - 1;
        if (sel.options.length) sel.value = String(dates.length - 1);

        if (dates.length) showDate(dates[dates.length - 1], map, fit);
    }

    function getDates() {
        if (!manifest || !currentAoi || currentPoly === null) return [];
        var aoi = manifest.aois[currentAoi];
        if (!aoi) return [];
        var poly = aoi.polygons[currentPoly];
        if (!poly) return [];
        return Object.keys(poly.dates).sort();
    }

    function stepDate(delta, map) {
        var slider = document.getElementById('lfmc-date-slider');
        var newVal = Math.max(0, Math.min(+slider.max, +slider.value + delta));
        slider.value = newVal;
        var dates = getDates();
        if (dates.length) showDate(dates[newVal], map, false);
    }

    function updateDateLabel() {
        var dates = getDates();
        var idx = currentDate ? dates.indexOf(currentDate) : -1;
        // Sync dropdown
        var sel = document.getElementById('lfmc-date-select');
        if (sel && idx >= 0) sel.value = String(idx);
        // Sync slider
        var slider = document.getElementById('lfmc-date-slider');
        if (slider && idx >= 0) slider.value = String(idx);
    }

    /* ── Legend ─────────────────────────────────────────────────── */

    function buildLegend(map) {
        var legend = L.control({ position: 'bottomright' });
        legend.onAdd = function () {
            var div = L.DomUtil.create('div', 'legend');
            div.id = 'lfmc-legend';
            div.style.display = visible ? '' : 'none';
            updateLegendContent(div);
            return div;
        };
        legend.addTo(map);

        // Re-paint legend when colormap changes
        EV.on('lfmc:colormapChanged', function () {
            var div = document.getElementById('lfmc-legend');
            if (div) updateLegendContent(div);
        });

        return legend;
    }

    function updateLegendContent(div) {
        div.innerHTML =
            '<h4>LFMC (%)</h4>' +
            '<div class="legend-gradient" style="background:' + EV.lfmcGradientCSS() + ';"></div>' +
            '<div class="legend-labels">' +
            '  <span>0</span><span>50</span><span>100</span><span>150</span><span>200</span>' +
            '</div>';
    }

    /* ── Visibility toggle ─────────────────────────────────────── */

    function setVisible(v, map) {
        visible = v;
        var ctrl = document.getElementById('lfmc-controls');
        var leg  = document.getElementById('lfmc-legend');
        if (ctrl) ctrl.classList.toggle('hidden', !v);
        if (leg) leg.style.display = v ? '' : 'none';
        if (rasterLayer) {
            if (v) rasterLayer.addTo(map);
            else map.removeLayer(rasterLayer);
        } else if (v && currentDate) {
            showDate(currentDate, map, false);
        }
        EV.updateProductToolbarVisibility();
    }

    /* ── Public API ────────────────────────────────────────────── */

    EV.lfmc = {
        id: 'lfmc',
        name: 'Live Fuel Moisture Content',
        type: 'raster',
        defaultVisible: false,

        init: function (map, dataBaseUrl) {
            EV.dataBaseUrl = dataBaseUrl;
            buildControls(map);
            buildLegend(map);

            return Promise.all([
                loadManifest(dataBaseUrl + '/lfmc/manifest.json'),
                loadStats(dataBaseUrl + '/lfmc/stats.json')
            ]).then(function () {
                if (!manifest) return;
                var firstAoi = populateAoiSelect();
                // Restore AOI from URL if valid
                var urlAoi = EV._urlAoi;
                var targetAoi = (urlAoi && manifest.aois[urlAoi]) ? urlAoi : firstAoi;
                if (targetAoi) {
                    var sel = document.getElementById('lfmc-aoi-select');
                    sel.value = targetAoi;
                    selectAoi(targetAoi, map, !urlAoi);
                }
                // Restore date from URL
                var urlDate = EV._urlDate;
                if (urlDate && getDates().indexOf(urlDate) !== -1) {
                    var slider = document.getElementById('lfmc-date-slider');
                    var dates = getDates();
                    slider.value = dates.indexOf(urlDate);
                    showDate(urlDate, map, false);
                }
            });
        },

        setVisible: setVisible,
        showDate: showDate,
        queryPoint: queryPoint,
        queryPolygon: queryPolygon,
        getCurrentDate: function () { return currentDate; },
        getDates: getDates,
        getValueAt: function (latlng) {
            if (!activeGeoraster) return null;
            var v = getPixelValue(activeGeoraster, latlng);
            if (v === null || v === NODATA || v === NODATA_U8 || isNaN(v)) return null;
            return v;
        },
    };

})();
