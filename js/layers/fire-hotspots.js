/**
 * EOSIAL Viewer — Fire Hotspots layer
 *
 * Loads SFIDE GeoJSON fire detections and renders as clustered markers
 * with full filtering: time window, satellite, fire type, confidence, FRP.
 * FRP-based color scale (yellow → orange → red → deep red) with log/linear toggle.
 */
(function () {

    /* ── Configuration ─────────────────────────────────────────── */

    var FIRE_TYPE_CONFIG = {
        0: { label: 'Vegetation Fire', path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z' },
        1: { label: 'Active Volcano',  path: 'M12 2L2 22h20L12 2z' },
        2: { label: 'Static Land Source', path: 'M3 3h18v18H3V3z' },
        3: { label: 'Offshore',        path: 'M12 2L22 12 12 22 2 12 12 2z' }
    };

    var DEFAULT_MIN_FRP = {
        'MTG-1': 3,
        'MET-11': 40,
        'MET-10': 40,
        'MET-09': 40
    };

    var FRP_SCALE_MIN = 1;
    var FRP_SCALE_MAX = 1000;
    var useLogScale = true;

    var COLOR_STOPS = [
        { t: 0.0,  c: [255, 255, 178] },
        { t: 0.25, c: [254, 204,  92] },
        { t: 0.5,  c: [253, 141,  60] },
        { t: 0.75, c: [240,  59,  32] },
        { t: 1.0,  c: [189,   0,  38] }
    ];

    /* ── State ─────────────────────────────────────────────────── */

    var clusterGroup  = null;
    var visible       = false;
    var allFeatures   = [];
    var yearLoaded    = false;
    var mapRef        = null;
    var dataBaseUrl   = '';
    var legendControl = null;

    /* ── FRP color ─────────────────────────────────────────────── */

    function getFRPColor(frp) {
        var val = Math.max(frp, FRP_SCALE_MIN);
        val = Math.min(val, FRP_SCALE_MAX);
        var t;
        if (useLogScale) {
            var minLog = Math.log(FRP_SCALE_MIN);
            var maxLog = Math.log(FRP_SCALE_MAX);
            t = (Math.log(val) - minLog) / (maxLog - minLog);
        } else {
            t = (val - FRP_SCALE_MIN) / (FRP_SCALE_MAX - FRP_SCALE_MIN);
        }
        // interpolate
        var lower = COLOR_STOPS[0], upper = COLOR_STOPS[COLOR_STOPS.length - 1];
        for (var i = 0; i < COLOR_STOPS.length - 1; i++) {
            if (t >= COLOR_STOPS[i].t && t <= COLOR_STOPS[i + 1].t) {
                lower = COLOR_STOPS[i];
                upper = COLOR_STOPS[i + 1];
                break;
            }
        }
        var range = upper.t - lower.t;
        var lt = (t - lower.t) / range;
        var r = Math.round(lower.c[0] + (upper.c[0] - lower.c[0]) * lt);
        var g = Math.round(lower.c[1] + (upper.c[1] - lower.c[1]) * lt);
        var b = Math.round(lower.c[2] + (upper.c[2] - lower.c[2]) * lt);
        return 'rgba(' + r + ',' + g + ',' + b + ',0.9)';
    }

    function frpGradientCSS() {
        var parts = [];
        for (var i = 0; i < COLOR_STOPS.length; i++) {
            var c = COLOR_STOPS[i].c;
            var pct = (COLOR_STOPS[i].t * 100).toFixed(0);
            parts.push('rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ') ' + pct + '%');
        }
        return 'linear-gradient(to right, ' + parts.join(', ') + ')';
    }

    /* ── Date parsing ──────────────────────────────────────────── */

    function parseFeatureDate(props) {
        try {
            var dt = props.DATETIME;
            // Format: "YYYY/MM/DD HH:MM"
            var year   = parseInt(dt.substring(0, 4));
            var month  = parseInt(dt.substring(5, 7)) - 1;
            var day    = parseInt(dt.substring(8, 10));
            var hour   = parseInt(dt.substring(11, 13));
            var minute = parseInt(dt.substring(14, 16));
            return new Date(Date.UTC(year, month, day, hour, minute));
        } catch (e) {
            return null;
        }
    }

    function formatUTC(date) {
        if (!date) return 'N/A';
        return date.toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
    }

    /* ── Data loading ──────────────────────────────────────────── */

    function load72h() {
        EV.showLoading('Loading fire hotspots (72h)...');
        return fetch(dataBaseUrl + '/fire/sfide_aggregate_72h.geojson')
            .then(function (r) {
                if (!r.ok) throw new Error(r.status);
                return r.json();
            })
            .then(function (geojson) {
                allFeatures = (geojson.features || []);
                EV.hideLoading();
                return allFeatures;
            })
            .catch(function () {
                console.info('[FIRE] 72h file not available, trying archive...');
                return loadArchive();
            });
    }

    function loadArchive() {
        if (yearLoaded) return Promise.resolve(allFeatures);
        EV.showLoading('Loading fire archive...');
        return fetch(dataBaseUrl + '/fire/sfide_aggregate_1Y.geojson')
            .then(function (r) {
                if (!r.ok) throw new Error(r.status);
                return r.json();
            })
            .then(function (geojson) {
                allFeatures = (geojson.features || []);
                yearLoaded = true;
                EV.hideLoading();
                return allFeatures;
            })
            .catch(function (err) {
                console.warn('[FIRE] Archive load error:', err);
                EV.hideLoading();
                return [];
            });
    }

    /* ── Filtering ─────────────────────────────────────────────── */

    function applyFilters() {
        var range = getTimeRange();

        // If requesting beyond 72h and archive not loaded, load it first
        var hours72ago = new Date(Date.now() - 72 * 3600000);
        if (range.start < hours72ago && !yearLoaded) {
            loadArchive().then(function () {
                populateSatelliteFilters();
                applyFilters();
            });
            return;
        }

        var activeSats = getCheckedValues('.fire-sat-filter');
        var activeTypes = getCheckedValues('.fire-type-filter').map(Number);
        var minConf = parseFloat(document.getElementById('fire-min-conf').value) || 0;
        var minFrpStr = document.getElementById('fire-min-frp').value;

        var filtered = allFeatures.filter(function (f) {
            var p = f.properties;

            // Time
            var d = parseFeatureDate(p);
            if (!d || d < range.start || d > range.end) return false;

            // Satellite
            if (activeSats.length > 0 && activeSats.indexOf(p.SATELLITE) === -1) return false;

            // Fire type
            if (activeTypes.length > 0 && activeTypes.indexOf(p.TYPE) === -1) return false;

            // Confidence
            if ((p.CONFIDENCE || 0) < minConf) return false;

            // FRP
            var frp = p.FRP_WOOSTER || 0;
            if (minFrpStr === '' || minFrpStr === undefined) {
                var defMin = DEFAULT_MIN_FRP[p.SATELLITE] || 0;
                if (frp < defMin) return false;
            } else {
                if (frp < parseFloat(minFrpStr)) return false;
            }

            return true;
        });

        displayFeatures(filtered);

        // Update count
        var countEl = document.getElementById('fire-count');
        if (countEl) countEl.textContent = filtered.length + ' hotspot' + (filtered.length !== 1 ? 's' : '');
    }

    function getCheckedValues(selector) {
        var cbs = document.querySelectorAll(selector + ':checked');
        var vals = [];
        for (var i = 0; i < cbs.length; i++) vals.push(cbs[i].value);
        return vals;
    }

    /* ── Display ───────────────────────────────────────────────── */

    function displayFeatures(features) {
        clusterGroup.clearLayers();
        if (!features.length) return;

        var markers = [];
        for (var i = 0; i < features.length; i++) {
            var p = features[i].properties;
            var latlng = [p.LATITUDE, p.LONGITUDE];

            var typeConf = FIRE_TYPE_CONFIG[p.TYPE] || FIRE_TYPE_CONFIG[0];
            var frp = p.FRP_WOOSTER || 0;
            var color = getFRPColor(frp);

            var iconHtml =
                '<svg width="12" height="12" viewBox="0 0 24 24" style="opacity:0.85;stroke:#000;stroke-width:1.5;fill:' + color + ';">' +
                '<path d="' + typeConf.path + '"/></svg>';

            var icon = L.divIcon({
                html: iconHtml,
                className: 'fire-marker-icon',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            });

            var marker = L.marker(latlng, { icon: icon });
            marker.bindPopup(buildPopup(p));
            markers.push(marker);
        }

        clusterGroup.addLayers(markers);
    }

    function buildPopup(p) {
        var typeConf = FIRE_TYPE_CONFIG[p.TYPE] || FIRE_TYPE_CONFIG[0];
        var date = parseFeatureDate(p);
        var frp = p.FRP_WOOSTER;
        var html = '<h3>' + (p.SATELLITE || 'Fire') + ' Hotspot</h3><table>';
        html += '<tr><th>Time (UTC)</th><td>' + formatUTC(date) + '</td></tr>';
        html += '<tr><th>Fire Type</th><td>' + typeConf.label + '</td></tr>';
        html += '<tr><th>FRP</th><td>' + (frp != null ? frp.toFixed(1) + ' MW' : 'N/A') + '</td></tr>';
        html += '<tr><th>Confidence</th><td>' + (p.CONFIDENCE != null ? p.CONFIDENCE + '%' : 'N/A') + '</td></tr>';
        html += '<tr><th>Instrument</th><td>' + (p.INSTRUMENT || 'N/A') + '</td></tr>';
        html += '<tr><th>Day/Night</th><td>' + (p.DAYNIGHT || 'N/A') + '</td></tr>';
        html += '<tr><th>Bright MIR</th><td>' + (p.BRIGHT_MIR != null ? p.BRIGHT_MIR.toFixed(1) + ' K' : 'N/A') + '</td></tr>';
        html += '<tr><th>Bright TIR</th><td>' + (p.BRIGHT_TIR != null ? p.BRIGHT_TIR.toFixed(1) + ' K' : 'N/A') + '</td></tr>';
        html += '<tr><th>Lat, Lon</th><td>' + p.LATITUDE.toFixed(4) + ', ' + p.LONGITUDE.toFixed(4) + '</td></tr>';
        html += '</table>';
        html += '<div style="text-align:center;margin-top:6px;">' +
                '<a href="#" class="fire-ts-link text-xs" style="color:#2563eb;cursor:pointer;" ' +
                'data-lat="' + p.LATITUDE + '" data-lon="' + p.LONGITUDE + '">' +
                'Show FRP timeseries at this location</a></div>';
        return html;
    }

    /**
     * Collect all detections at a given lat/lon and show an FRP timeseries chart.
     */
    function showFRPTimeseries(lat, lon) {
        var tolerance = 0.001; // ~100m for geostationary pixel matching
        var colocated = allFeatures.filter(function (f) {
            var p = f.properties;
            return Math.abs(p.LATITUDE - lat) < tolerance &&
                   Math.abs(p.LONGITUDE - lon) < tolerance;
        });

        // Build series sorted by date
        var series = colocated.map(function (f) {
            var p = f.properties;
            var d = parseFeatureDate(p);
            return { date: d, value: p.FRP_WOOSTER || 0, sat: p.SATELLITE };
        }).filter(function (s) { return s.date !== null; })
          .sort(function (a, b) { return a.date - b.date; });

        if (!series.length) {
            alert('No FRP data at this location.');
            return;
        }

        var infoHtml = 'Lat: ' + lat.toFixed(4) + ', Lon: ' + lon.toFixed(4) +
                       '<br>Detections: ' + series.length;
        EV.showTimeseries(
            'FRP Timeseries',
            series,
            { unit: 'MW', label: 'FRP (MW)', color: '#dc2626', info: infoHtml, timeUnit: 'hour' }
        );
    }

    /* ── Dynamic satellite filter population ───────────────────── */

    function populateSatelliteFilters() {
        var container = document.getElementById('fire-sat-list');
        if (!container) return;
        container.innerHTML = '';

        var sats = {};
        for (var i = 0; i < allFeatures.length; i++) {
            sats[allFeatures[i].properties.SATELLITE] = true;
        }
        var sorted = Object.keys(sats).sort();

        sorted.forEach(function (sat) {
            var div = document.createElement('label');
            div.className = 'flex items-center gap-2 text-xs';
            div.innerHTML =
                '<input type="checkbox" value="' + sat + '" class="fire-sat-filter h-3.5 w-3.5" checked>' +
                '<span>' + sat + '</span>';
            container.appendChild(div);
        });

        container.querySelectorAll('.fire-sat-filter').forEach(function (cb) {
            cb.addEventListener('change', applyFilters);
        });
    }

    /* ── Sidebar controls ──────────────────────────────────────── */

    function buildControls(map) {
        var container = document.getElementById('layer-controls');
        var section = document.createElement('div');
        section.id = 'fire-controls';
        section.className = 'border-t pt-4 mt-4 hidden';
        section.innerHTML =
            '<h2 class="text-sm font-semibold text-gray-700 mb-2">Fire Hotspots (SFIDE)</h2>' +
            '<p class="text-xs text-gray-500 mb-3">Near-real-time fire detections from MSG/MTG satellites.</p>' +

            /* Time presets */
            '<div class="mb-3">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Time Window</label>' +
            '  <div class="grid grid-cols-5 gap-1">' +
            '    <button class="fire-time-btn px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200" data-hours="6">6h</button>' +
            '    <button class="fire-time-btn px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200" data-hours="12">12h</button>' +
            '    <button class="fire-time-btn px-2 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded hover:bg-blue-200 active" data-hours="24">24h</button>' +
            '    <button class="fire-time-btn px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200" data-hours="72">72h</button>' +
            '    <button class="fire-time-btn px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200" data-hours="0">All</button>' +
            '  </div>' +
            '</div>' +

            /* Custom date range */
            '<div class="mb-3">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Custom Range</label>' +
            '  <div class="flex gap-1 mb-1">' +
            '    <input type="datetime-local" id="fire-start-time" class="flex-1 px-2 py-1 text-xs border border-gray-300 rounded">' +
            '    <input type="datetime-local" id="fire-end-time" class="flex-1 px-2 py-1 text-xs border border-gray-300 rounded">' +
            '  </div>' +
            '  <button id="fire-apply-custom" class="w-full px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200">Apply Custom Range</button>' +
            '</div>' +

            /* Satellite filters */
            '<div class="mb-3">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Satellites</label>' +
            '  <div id="fire-sat-list" class="space-y-1 max-h-24 overflow-y-auto">' +
            '    <span class="text-xs text-gray-400">Loading...</span>' +
            '  </div>' +
            '</div>' +

            /* Fire type filters */
            '<div class="mb-3">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Fire Type</label>' +
            '  <div id="fire-type-list" class="space-y-1"></div>' +
            '</div>' +

            /* Advanced: confidence + FRP */
            '<div class="mb-3">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Min. Confidence (%)</label>' +
            '  <input type="number" id="fire-min-conf" min="0" max="100" value="0" class="w-full px-2 py-1 text-xs border border-gray-300 rounded">' +
            '</div>' +
            '<div class="mb-3">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Min. FRP (MW) <span class="text-gray-400">— blank = per-satellite default</span></label>' +
            '  <input type="number" id="fire-min-frp" min="0" step="0.1" value="" placeholder="auto" class="w-full px-2 py-1 text-xs border border-gray-300 rounded">' +
            '</div>' +

            /* Count display */
            '<div class="text-xs text-gray-500 mb-1" id="fire-count">—</div>';

        container.appendChild(section);

        // Wire time preset buttons
        section.querySelectorAll('.fire-time-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                section.querySelectorAll('.fire-time-btn').forEach(function (b) {
                    b.classList.remove('active', 'bg-blue-100', 'text-blue-700');
                    b.classList.add('bg-gray-100', 'text-gray-700');
                });
                var hours = parseInt(btn.getAttribute('data-hours'));
                if (hours > 0) {
                    btn.classList.add('active', 'bg-blue-100', 'text-blue-700');
                    btn.classList.remove('bg-gray-100', 'text-gray-700');
                } else {
                    // "All" — clear presets, load archive
                    btn.classList.add('active', 'bg-blue-100', 'text-blue-700');
                    btn.classList.remove('bg-gray-100', 'text-gray-700');
                }
                applyFilters();
            });
        });

        // Custom date apply
        document.getElementById('fire-apply-custom').addEventListener('click', function () {
            // Deactivate preset buttons
            section.querySelectorAll('.fire-time-btn').forEach(function (b) {
                b.classList.remove('active', 'bg-blue-100', 'text-blue-700');
                b.classList.add('bg-gray-100', 'text-gray-700');
            });
            applyFilters();
        });

        // Fire type checkboxes
        var typeList = document.getElementById('fire-type-list');
        Object.keys(FIRE_TYPE_CONFIG).forEach(function (type) {
            var conf = FIRE_TYPE_CONFIG[type];
            var div = document.createElement('label');
            div.className = 'flex items-center gap-2 text-xs';
            div.innerHTML =
                '<input type="checkbox" value="' + type + '" class="fire-type-filter h-3.5 w-3.5" checked>' +
                '<svg width="12" height="12" viewBox="0 0 24 24" style="fill:#777;stroke:#000;stroke-width:2;"><path d="' + conf.path + '"/></svg>' +
                '<span>' + conf.label + '</span>';
            typeList.appendChild(div);
        });
        typeList.querySelectorAll('.fire-type-filter').forEach(function (cb) {
            cb.addEventListener('change', applyFilters);
        });

        // Advanced filter inputs
        document.getElementById('fire-min-conf').addEventListener('change', applyFilters);
        document.getElementById('fire-min-frp').addEventListener('change', applyFilters);
    }

    /* ── "All" time — handle as full archive ───────────────────── */

    function getTimeRange() {
        var activeBtn = document.querySelector('.fire-time-btn.active');
        if (activeBtn) {
            var hours = parseInt(activeBtn.getAttribute('data-hours'));
            if (hours === 0) {
                // "All" — no time restriction
                return { start: new Date(Date.UTC(2000, 0, 1)), end: new Date() };
            }
            var end = new Date();
            var start = new Date(end.getTime() - hours * 3600000);
            return { start: start, end: end };
        }
        // Custom dates — parse as UTC to match feature dates
        var s = document.getElementById('fire-start-time');
        var e = document.getElementById('fire-end-time');
        if (s && e && s.value && e.value) {
            return {
                start: new Date(s.value + 'Z'),
                end:   new Date(e.value + 'Z')
            };
        }
        var now = new Date();
        return { start: new Date(now.getTime() - 24 * 3600000), end: now };
    }

    /* ── Legend ─────────────────────────────────────────────────── */

    function buildLegend(map) {
        legendControl = L.control({ position: 'bottomright' });
        legendControl.onAdd = function () {
            var div = L.DomUtil.create('div', 'legend fire-legend');
            div.id = 'fire-legend';
            div.style.display = 'none';
            updateLegendContent(div);
            L.DomEvent.disableClickPropagation(div);
            return div;
        };
        legendControl.addTo(map);
    }

    function updateLegendContent(div) {
        div.innerHTML =
            '<h4>FRP (MW)</h4>' +
            '<div class="legend-gradient" style="background:' + frpGradientCSS() + ';"></div>' +
            '<div class="legend-labels">' +
            '  <span>' + FRP_SCALE_MIN + '</span>' +
            '  <span>' + (useLogScale ? 'log' : 'lin') + '</span>' +
            '  <span>' + FRP_SCALE_MAX + '</span>' +
            '</div>' +
            '<button id="fire-frp-scale-toggle" class="text-xs text-blue-600 mt-1 hover:underline" style="cursor:pointer;background:none;border:none;padding:0;">Toggle log/linear</button>';

        var toggleBtn = div.querySelector('#fire-frp-scale-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function () {
                useLogScale = !useLogScale;
                updateLegendContent(div);
                applyFilters(); // re-render with new colors
            });
        }
    }

    /* ── Visibility ────────────────────────────────────────────── */

    function setVisible(v, map) {
        visible = v;
        var ctrl = document.getElementById('fire-controls');
        var leg  = document.getElementById('fire-legend');
        if (v) {
            ctrl.classList.remove('hidden');
            if (leg) leg.style.display = '';
            if (clusterGroup) clusterGroup.addTo(map);
        } else {
            ctrl.classList.add('hidden');
            if (leg) leg.style.display = 'none';
            if (clusterGroup) map.removeLayer(clusterGroup);
        }
    }

    /* ── Public API ────────────────────────────────────────────── */

    EV.fireHotspots = {
        id: 'fire',
        name: 'Fire Hotspots',
        type: 'point',
        defaultVisible: false,

        init: function (map, baseUrl) {
            mapRef = map;
            dataBaseUrl = baseUrl;
            buildControls(map);
            buildLegend(map);

            clusterGroup = L.markerClusterGroup({
                maxClusterRadius: 40,
                spiderfyOnMaxZoom: true,
                zoomToBoundsOnClick: true,
                spiderfyDistanceMultiplier: 1.5,
            });

            // Delegate clicks on FRP timeseries links inside popups
            document.addEventListener('click', function (e) {
                var link = e.target.closest('.fire-ts-link');
                if (!link) return;
                e.preventDefault();
                var lat = parseFloat(link.getAttribute('data-lat'));
                var lon = parseFloat(link.getAttribute('data-lon'));
                if (!isNaN(lat) && !isNaN(lon)) showFRPTimeseries(lat, lon);
            });

            return load72h().then(function () {
                if (allFeatures.length === 0 && !yearLoaded) {
                    return loadArchive();
                }
            }).then(function () {
                // If archive was loaded (72h empty), switch default to "All"
                if (yearLoaded) {
                    var btns = document.querySelectorAll('.fire-time-btn');
                    btns.forEach(function (b) {
                        b.classList.remove('active', 'bg-blue-100', 'text-blue-700');
                        b.classList.add('bg-gray-100', 'text-gray-700');
                    });
                    var allBtn = document.querySelector('.fire-time-btn[data-hours="0"]');
                    if (allBtn) {
                        allBtn.classList.add('active', 'bg-blue-100', 'text-blue-700');
                        allBtn.classList.remove('bg-gray-100', 'text-gray-700');
                    }
                }
                populateSatelliteFilters();
                applyFilters();
            }).catch(function () {
                console.info('[FIRE] No fire data available.');
            });
        },

        setVisible: setVisible,
    };

})();
