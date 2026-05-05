/**
 * EOSIAL Viewer — Fire Hotspots layer
 *
 * Loads SFIDE GeoJSON fire detections and renders as clustered markers
 * with full filtering: time window, satellite, fire type, confidence, FRP.
 * FRP-based color scales with log/linear toggle.
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
        'MTG-1': 10,
        'MET-11': 10,
        'MET-10': 10,
        'MET-09': 10
    };

    var SATELLITE_PRODUCTS = {
        'MTG-1': 'MTG-FCI',
        'MET-11': 'MSG-RSS',
        'MET-10': 'MSG-HRIT',
        'MET-09': 'MSG-IODC',
        'MET-08': 'MSG-HRIT'
    };

    var FRP_SCALE_MIN = 1;
    var FRP_SCALE_MAX = 1000;
    var useLogScale = true;

    var MTG_COLOR_STOPS = [
        { t: 0.0,  c: [255, 255, 178] },
        { t: 0.25, c: [254, 204,  92] },
        { t: 0.5,  c: [253, 141,  60] },
        { t: 0.75, c: [240,  59,  32] },
        { t: 1.0,  c: [189,   0,  38] }
    ];

    var FRP_PALETTES = {
        'MTG-1': MTG_COLOR_STOPS,
        'MET-11': [
            { t: 0.0,  c: [239, 246, 255] },
            { t: 0.25, c: [191, 219, 254] },
            { t: 0.5,  c: [ 96, 165, 250] },
            { t: 0.75, c: [ 37,  99, 235] },
            { t: 1.0,  c: [ 30,  64, 175] }
        ],
        'MET-10': [
            { t: 0.0,  c: [236, 253, 245] },
            { t: 0.25, c: [167, 243, 208] },
            { t: 0.5,  c: [ 45, 212, 191] },
            { t: 0.75, c: [ 13, 148, 136] },
            { t: 1.0,  c: [ 17,  94,  89] }
        ],
        'MET-09': [
            { t: 0.0,  c: [250, 245, 255] },
            { t: 0.25, c: [221, 214, 254] },
            { t: 0.5,  c: [167, 139, 250] },
            { t: 0.75, c: [124,  58, 237] },
            { t: 1.0,  c: [ 91,  33, 182] }
        ],
        'MET-08': [
            { t: 0.0,  c: [240, 249, 255] },
            { t: 0.25, c: [186, 230, 253] },
            { t: 0.5,  c: [ 56, 189, 248] },
            { t: 0.75, c: [  2, 132, 199] },
            { t: 1.0,  c: [ 12,  74, 110] }
        ]
    };

    var FALLBACK_COLOR_STOPS = [
        { t: 0.0,  c: [245, 245, 245] },
        { t: 0.25, c: [209, 213, 219] },
        { t: 0.5,  c: [156, 163, 175] },
        { t: 0.75, c: [ 75,  85,  99] },
        { t: 1.0,  c: [ 31,  41,  55] }
    ];

    /* ── State ─────────────────────────────────────────────────── */

    var clusterGroup  = null;
    var visible       = true;
    var allFeatures   = [];
    var featureIds    = {};
    var yearLoaded    = false;
    var archiveManifest = null;
    var loadedArchiveMonths = {};
    var mapRef        = null;
    var dataBaseUrl   = '';
    var legendControl = null;

    /* ── FRP color ─────────────────────────────────────────────── */

    function getPalette(satellite) {
        return FRP_PALETTES[satellite] || FALLBACK_COLOR_STOPS;
    }

    function getSatelliteLabel(satellite) {
        var product = SATELLITE_PRODUCTS[satellite];
        return product ? satellite + ' (' + product + ')' : satellite;
    }

    function isDefaultSatelliteSelected(satellite, availableSatellites) {
        if (satellite && satellite.indexOf('MTG') === 0) return true;
        return !availableSatellites.some(function (sat) { return sat && sat.indexOf('MTG') === 0; });
    }

    function getFRPColor(frp, satellite) {
        var val = Math.max(frp, FRP_SCALE_MIN);
        val = Math.min(val, FRP_SCALE_MAX);
        var stops = getPalette(satellite);
        var t;
        if (useLogScale) {
            var minLog = Math.log(FRP_SCALE_MIN);
            var maxLog = Math.log(FRP_SCALE_MAX);
            t = (Math.log(val) - minLog) / (maxLog - minLog);
        } else {
            t = (val - FRP_SCALE_MIN) / (FRP_SCALE_MAX - FRP_SCALE_MIN);
        }
        // interpolate
        var lower = stops[0], upper = stops[stops.length - 1];
        for (var i = 0; i < stops.length - 1; i++) {
            if (t >= stops[i].t && t <= stops[i + 1].t) {
                lower = stops[i];
                upper = stops[i + 1];
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

    function frpGradientCSS(stops) {
        var parts = [];
        stops = stops || MTG_COLOR_STOPS;
        for (var i = 0; i < stops.length; i++) {
            var c = stops[i].c;
            var pct = (stops[i].t * 100).toFixed(0);
            parts.push('rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ') ' + pct + '%');
        }
        return 'linear-gradient(to right, ' + parts.join(', ') + ')';
    }

    function paletteSample(satellite) {
        var stops = getPalette(satellite);
        var c = stops[Math.min(3, stops.length - 1)].c;
        return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    }

    function clusterIconCreate(cluster) {
        var markers = cluster.getAllChildMarkers();
        var counts = {};
        markers.forEach(function (marker) {
            var sat = marker.options.satellite || 'Unknown';
            counts[sat] = (counts[sat] || 0) + 1;
        });

        var total = markers.length;
        var start = 0;
        var satellites = Object.keys(counts).sort();
        var segments = satellites.map(function (sat) {
            var pct = counts[sat] / total * 100;
            var end = start + pct;
            var color = paletteSample(sat);
            var segment = color + ' ' + start.toFixed(2) + '% ' + end.toFixed(2) + '%';
            start = end;
            return segment;
        });

        var size = total < 10 ? 34 : total < 100 ? 40 : 48;
        var bg = segments.length > 1 ? 'conic-gradient(' + segments.join(',') + ')' : paletteSample(satellites[0]);
        var html =
            '<div style="' +
            'width:' + size + 'px;height:' + size + 'px;border-radius:50%;' +
            'background:' + bg + ';border:2px solid rgba(17,24,39,0.8);' +
            'box-shadow:0 2px 8px rgba(0,0,0,0.28);display:flex;align-items:center;justify-content:center;' +
            '">' +
            '<span style="' +
            'min-width:22px;height:22px;border-radius:999px;background:rgba(255,255,255,0.88);' +
            'display:flex;align-items:center;justify-content:center;padding:0 4px;' +
            'font-size:11px;font-weight:700;color:#111827;line-height:1;' +
            '">' + total + '</span>' +
            '</div>';

        return L.divIcon({
            html: html,
            className: 'fire-cluster-icon',
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
        });
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

    /* ── Multi-format data loading ─────────────────────────────── */

    // Preferred format order: FlatGeobuf → zipped Shapefile → GeoPackage → GeoJSON
    var FORMAT_EXTS = ['.fgb', '.zip', '.gpkg', '.geojson', '.json'];

    function detectAndLoad(baseName, label) {
        EV.showLoading('Loading ' + label + '...');
        function tryNext(i) {
            if (i >= FORMAT_EXTS.length) return Promise.reject(new Error('No file found for ' + baseName));
            var url = dataBaseUrl + '/fire/' + baseName + FORMAT_EXTS[i];
            return loadByFormat(url, FORMAT_EXTS[i])
                .catch(function (err) {
                    if (err && err.notFound) return tryNext(i + 1);
                    throw err; // real parse error — don't silently skip
                });
        }
        return tryNext(0).then(function (features) {
            EV.hideLoading();
            return features;
        }).catch(function (err) {
            EV.hideLoading();
            throw err;
        });
    }

    function loadByFormat(url, ext) {
        switch (ext) {
            case '.fgb':    return loadFlatGeobuf(url);
            case '.zip':    return loadShapefile(url);
            case '.gpkg':   return loadGeoPackage(url);
            case '.geojson':
            case '.json':   return loadGeoJSON(url);
            default:        return Promise.reject(new Error('Unknown extension: ' + ext));
        }
    }

    function loadFlatGeobuf(url) {
        return fetch(url)
            .then(function (r) {
                if (r.status === 404) { var e = new Error('404'); e.notFound = true; throw e; }
                if (!r.ok) throw new Error(r.status);
                return r.arrayBuffer();
            })
            .then(function (buf) {
                var features = [];
                var iterator = flatgeobuf.deserialize(new Uint8Array(buf)); // eslint-disable-line no-undef
                if (iterator && iterator[Symbol.asyncIterator]) {
                    return (async function () {
                        for await (var feature of iterator) features.push(feature);
                        return features.map(normalizeFeature).filter(Boolean);
                    })();
                }
                for (var f of iterator) {
                    features.push(f);
                }
                return features.map(normalizeFeature).filter(Boolean);
            });
    }

    function loadShapefile(url) {
        return shp(url) // eslint-disable-line no-undef
            .then(function (fc) {
                if (!fc) { var e = new Error('404'); e.notFound = true; throw e; }
                // shpjs may return a FeatureCollection or array of FeatureCollections
                if (Array.isArray(fc)) {
                    return fc.reduce(function (acc, c) { return acc.concat(c.features || []); }, [])
                        .map(normalizeFeature).filter(Boolean);
                }
                return (fc.features || []).map(normalizeFeature).filter(Boolean);
            })
            .catch(function (err) {
                if (!err.notFound) { var e = new Error('404'); e.notFound = true; throw e; }
                throw err;
            });
    }

    function loadGeoPackage(url) {
        return fetch(url)
            .then(function (r) {
                if (r.status === 404) { var e = new Error('404'); e.notFound = true; throw e; }
                if (!r.ok) throw new Error(r.status);
                return r.arrayBuffer();
            })
            .then(function (buf) {
                return loadSqlJs().then(function (SQL) {
                    var db = new SQL.Database(new Uint8Array(buf));
                    return parseGpkg(db).map(normalizeFeature).filter(Boolean);
                });
            });
    }

    function loadGeoJSON(url) {
        return fetch(url)
            .then(function (r) {
                if (r.status === 404) { var e = new Error('404'); e.notFound = true; throw e; }
                if (!r.ok) throw new Error(r.status);
                return r.json();
            })
            .then(function (fc) { return (fc.features || []).map(normalizeFeature).filter(Boolean); });
    }

    // Lazy-load sql.js (WASM) only when a .gpkg file is actually needed
    var _sqlJsPromise = null;
    function loadSqlJs() {
        if (_sqlJsPromise) return _sqlJsPromise;
        _sqlJsPromise = new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/sql.js@1.14.1/dist/sql-wasm.min.js';
            script.onload = function () {
                initSqlJs({ locateFile: function (f) { // eslint-disable-line no-undef
                    return 'https://cdn.jsdelivr.net/npm/sql.js@1.14.1/dist/' + f;
                }}).then(resolve).catch(reject);
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
        return _sqlJsPromise;
    }

    // Minimal GPKG parser — points only; properties come straight from DBF columns
    function parseGpkg(db) {
        var contents = db.exec("SELECT table_name FROM gpkg_contents WHERE data_type='features'");
        if (!contents.length || !contents[0].values.length) return [];
        var table = contents[0].values[0][0];

        var geomCols = db.exec("SELECT column_name FROM gpkg_geometry_columns WHERE table_name='" + table + "'");
        if (!geomCols.length) return [];
        var geomCol = geomCols[0].values[0][0];

        var result = db.exec('SELECT * FROM "' + table + '"');
        if (!result.length) return [];

        var cols = result[0].columns;
        var rows = result[0].values;
        var features = [];

        for (var i = 0; i < rows.length; i++) {
            var props = {};
            var geomBytes = null;
            for (var j = 0; j < cols.length; j++) {
                if (cols[j] === geomCol) geomBytes = rows[i][j];
                else props[cols[j]] = rows[i][j];
            }
            var geom = geomBytes ? parseGpkgPoint(geomBytes) : null;
            if (geom) features.push({ type: 'Feature', geometry: geom, properties: props });
        }
        return features;
    }

    function normalizeFeature(feature) {
        if (!feature || !feature.properties) return null;
        var p = feature.properties;
        var coords = feature.geometry && feature.geometry.type === 'Point'
            ? feature.geometry.coordinates
            : null;
        if ((p.LATITUDE == null || p.LONGITUDE == null) && coords && coords.length >= 2) {
            p.LONGITUDE = Number(coords[0]);
            p.LATITUDE = Number(coords[1]);
        }
        if (p.TYPE != null) p.TYPE = Number(p.TYPE);
        ['LATITUDE', 'LONGITUDE', 'CONFIDENCE', 'FRP_WOOSTER', 'FRP_MODIS', 'BRIGHT_MIR', 'BRIGHT_TIR'].forEach(function (key) {
            if (p[key] != null && p[key] !== '') p[key] = Number(p[key]);
        });
        return (isFinite(p.LATITUDE) && isFinite(p.LONGITUDE)) ? feature : null;
    }

    function featureKey(feature) {
        var p = feature.properties || {};
        return [
            p.SATELLITE || '',
            Number(p.LATITUDE || 0).toFixed(6),
            Number(p.LONGITUDE || 0).toFixed(6),
            p.DATETIME || '',
            p.FRP_WOOSTER || p.FRP_MODIS || '',
            p.TYPE || ''
        ].join('|');
    }

    function mergeFeatures(features) {
        for (var i = 0; i < features.length; i++) {
            var key = featureKey(features[i]);
            if (!featureIds[key]) {
                allFeatures.push(features[i]);
                featureIds[key] = true;
            }
        }
        allFeatures.sort(function (a, b) {
            return (parseFeatureDate(a.properties) || 0) - (parseFeatureDate(b.properties) || 0);
        });
    }

    // Parse GPKG geometry header + WKB point geometry
    function parseGpkgPoint(bytes) {
        if (!bytes || bytes.length < 9) return null;
        if (bytes[0] !== 0x47 || bytes[1] !== 0x50) return null; // magic 'GP'
        var flags = bytes[3];
        var envSizes = [0, 32, 48, 48, 64];
        var envSize = envSizes[(flags >> 1) & 7] || 0;
        var wkb = bytes.subarray ? bytes.subarray(8 + envSize) : bytes.slice(8 + envSize);
        if (wkb.length < 21) return null;
        var le = wkb[0] === 1;
        var view = new DataView(wkb.buffer, wkb.byteOffset + 1);
        if (view.getUint32(0, le) !== 1) return null; // must be Point (type 1)
        return {
            type: 'Point',
            coordinates: [view.getFloat64(4, le), view.getFloat64(12, le)]
        };
    }

    function load72h() {
        return detectAndLoad('sfide_aggregate_72h', 'fire hotspots (72h)')
            .then(function (features) {
                allFeatures = [];
                featureIds = {};
                mergeFeatures(features);
                return features;
            })
            .catch(function () {
                console.info('[FIRE] 72h file not available, trying archive...');
                return loadArchive(getTimeRange());
            });
    }

    function loadArchiveManifest() {
        if (archiveManifest) return Promise.resolve(archiveManifest);
        return fetch(dataBaseUrl + '/fire/sfide_archive_manifest.json?v=' + Date.now())
            .then(function (r) {
                if (!r.ok) throw new Error(r.status);
                return r.json();
            })
            .then(function (manifest) {
                archiveManifest = manifest;
                return manifest;
            });
    }

    function archiveMonthsForRange(manifest, range) {
        var months = manifest.months || [];
        if (!range) return months;
        return months.filter(function (month) {
            var start = month.start ? new Date(month.start) : null;
            var end = month.end ? new Date(month.end) : null;
            if (!start || !end) return true;
            return end >= range.start && start <= range.end;
        });
    }

    function archiveRangeLoaded(range) {
        if (!archiveManifest) return false;
        var months = archiveMonthsForRange(archiveManifest, range);
        return months.every(function (month) { return loadedArchiveMonths[month.key]; });
    }

    function loadArchiveMonth(month) {
        if (loadedArchiveMonths[month.key]) return Promise.resolve([]);
        var files = month.files || {};
        var ext = files.fgb ? '.fgb' :
                  files.zip ? '.zip' :
                  files.gpkg ? '.gpkg' :
                  files.geojson ? '.geojson' :
                  files.json ? '.json' : null;
        if (!ext) return Promise.resolve([]);
        var rel = files[ext.substring(1)];
        var url = dataBaseUrl + '/fire/' + rel;
        return loadByFormat(url, ext).then(function (features) {
            loadedArchiveMonths[month.key] = true;
            mergeFeatures(features);
            return features;
        });
    }

    function loadArchive(range) {
        return loadArchiveManifest()
            .then(function (manifest) {
                var months = archiveMonthsForRange(manifest, range);
                var pending = months.filter(function (m) { return !loadedArchiveMonths[m.key]; });
                if (!pending.length) return allFeatures;
                EV.showLoading('Loading fire archive (' + pending.length + ' month' + (pending.length !== 1 ? 's' : '') + ')...');
                return Promise.all(pending.map(loadArchiveMonth)).then(function () {
                    EV.hideLoading();
                    yearLoaded = (Object.keys(loadedArchiveMonths).length >= (manifest.months || []).length);
                    return allFeatures;
                }).catch(function (err) {
                    EV.hideLoading();
                    throw err;
                });
            })
            .catch(function (err) {
                console.warn('[FIRE] Monthly archive load error:', err);
                console.info('[FIRE] Trying legacy one-year archive...');
                return detectAndLoad('sfide_aggregate_1Y', 'legacy fire archive')
                    .then(function (features) {
                        mergeFeatures(features);
                        yearLoaded = true;
                        return allFeatures;
                    })
                    .catch(function (legacyErr) {
                        console.warn('[FIRE] Archive load error:', legacyErr);
                        return [];
                    });
            });
    }

    /* ── Filtering ─────────────────────────────────────────────── */

    function applyFilters() {
        var range = getTimeRange();

        // If requesting beyond 72h and archive not loaded, load it first
        var hours72ago = new Date(Date.now() - 72 * 3600000);
        if (range.start < hours72ago && !archiveRangeLoaded(range)) {
            loadArchive(range).then(function () {
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
        var legend = document.getElementById('fire-legend');
        if (legend) updateLegendContent(legend);

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
            var color = getFRPColor(frp, p.SATELLITE);

            var iconHtml =
                '<svg width="12" height="12" viewBox="0 0 24 24" style="opacity:0.85;stroke:#000;stroke-width:1.5;fill:' + color + ';">' +
                '<path d="' + typeConf.path + '"/></svg>';

            var icon = L.divIcon({
                html: iconHtml,
                className: 'fire-marker-icon',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            });

            var marker = L.marker(latlng, { icon: icon, satellite: p.SATELLITE });
            marker.bindPopup(buildPopup(p));
            markers.push(marker);
        }

        clusterGroup.addLayers(markers);
    }

    function buildPopup(p) {
        var typeConf = FIRE_TYPE_CONFIG[p.TYPE] || FIRE_TYPE_CONFIG[0];
        var date = parseFeatureDate(p);
        var frp = p.FRP_WOOSTER;
        var html = '<h3>' + (p.SATELLITE ? getSatelliteLabel(p.SATELLITE) : 'Fire') + ' Hotspot</h3><table>';
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
            var checked = isDefaultSatelliteSelected(sat, sorted) ? ' checked' : '';
            div.innerHTML =
                '<input type="checkbox" value="' + sat + '" class="fire-sat-filter h-3.5 w-3.5"' + checked + '>' +
                '<span>' + getSatelliteLabel(sat) + '</span>';
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
        section.className = 'border-t pt-4 mt-4';
        section.innerHTML =
            '<h2 class="text-sm font-semibold text-gray-700 mb-2">Fire Hotspots (SFIDE)</h2>' +
            '<p class="text-xs text-gray-500 mb-3">Near-real-time fire detections from MSG/MTG satellites.</p>' +

            /* Time presets */
            '<div class="mb-3">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Time Window</label>' +
            '  <div class="grid grid-cols-3 gap-1">' +
            '    <button class="fire-time-btn px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200" data-hours="6">6h</button>' +
            '    <button class="fire-time-btn px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200" data-hours="12">12h</button>' +
            '    <button class="fire-time-btn px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200" data-hours="24">24h</button>' +
            '    <button class="fire-time-btn px-2 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded hover:bg-blue-200 active" data-hours="72">72h</button>' +
            '    <button class="fire-time-btn px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200" data-hours="168">7d</button>' +
            '    <button class="fire-time-btn px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200" data-hours="0">All</button>' +
            '  </div>' +
            '</div>' +

            /* Custom date range */
            '<div class="mb-3">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Custom Range</label>' +
            '  <div class="space-y-1 mb-1">' +
            '    <input type="text" id="fire-start-time" class="w-full px-2 py-1 text-xs border border-gray-300 rounded" placeholder="dd/mm/yyyy hh:mm">' +
            '    <input type="text" id="fire-end-time" class="w-full px-2 py-1 text-xs border border-gray-300 rounded" placeholder="dd/mm/yyyy hh:mm">' +
            '  </div>' +
            '  <button id="fire-apply-custom" class="w-full px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200">Apply Range</button>' +
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
            '  <input type="number" id="fire-min-conf" min="0" max="100" value="40" class="w-full px-2 py-1 text-xs border border-gray-300 rounded">' +
            '</div>' +
            '<div class="mb-3">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Min. FRP (MW)</label>' +
            '  <input type="number" id="fire-min-frp" min="0" step="0.1" value="10" class="w-full px-2 py-1 text-xs border border-gray-300 rounded">' +
            '</div>' +

            /* Count display */
            '<div class="text-xs text-gray-500 mb-1" id="fire-count">—</div>';

        container.appendChild(section);
        setDefaultCustomRange();

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
        // Custom dates — parse European UTC inputs (dd/mm/yyyy hh:mm)
        var s = document.getElementById('fire-start-time');
        var e = document.getElementById('fire-end-time');
        if (s && e && s.value && e.value) {
            var start = parseEuropeanDateTime(s.value);
            var end = parseEuropeanDateTime(e.value);
            if (start && end) return { start: start, end: end };
        }
        var now = new Date();
        return { start: new Date(now.getTime() - 72 * 3600000), end: now };
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function formatEuropeanDateTime(date) {
        return pad2(date.getUTCDate()) + '/' +
               pad2(date.getUTCMonth() + 1) + '/' +
               date.getUTCFullYear() + ' ' +
               pad2(date.getUTCHours()) + ':' +
               pad2(date.getUTCMinutes());
    }

    function parseEuropeanDateTime(value) {
        var m = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
        if (!m) return null;
        return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]));
    }

    function setDefaultCustomRange() {
        var end = new Date();
        var start = new Date(end.getTime() - 168 * 3600000);
        var s = document.getElementById('fire-start-time');
        var e = document.getElementById('fire-end-time');
        if (s) s.value = formatEuropeanDateTime(start);
        if (e) e.value = formatEuropeanDateTime(end);
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
        var activeSats = getCheckedValues('.fire-sat-filter');
        if (!activeSats.length) activeSats = ['MTG-1'];

        var paletteRows = activeSats.map(function (sat) {
            return '<div class="mt-1">' +
                   '  <div class="flex justify-between gap-2 leading-tight" style="font-size:10px;">' +
                   '    <span>' + getSatelliteLabel(sat) + '</span>' +
                   '    <span>' + FRP_SCALE_MIN + '-' + FRP_SCALE_MAX + '</span>' +
                   '  </div>' +
                   '  <div class="legend-gradient" style="height:6px;background:' + frpGradientCSS(getPalette(sat)) + ';"></div>' +
                   '</div>';
        }).join('');

        div.innerHTML =
            '<h4>FRP (MW)</h4>' +
            '<div class="legend-labels">' +
            '  <span>' + FRP_SCALE_MIN + '</span>' +
            '  <span>' + (useLogScale ? 'log' : 'lin') + '</span>' +
            '  <span>' + FRP_SCALE_MAX + '</span>' +
            '</div>' +
            paletteRows +
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

    /**
     * Query all fire detections within a bounding box and show FRP timeseries.
     */
    function queryPolygon(bounds) {
        var sw = bounds.getSouthWest();
        var ne = bounds.getNorthEast();
        var inside = allFeatures.filter(function (f) {
            var p = f.properties;
            return p.LATITUDE >= sw.lat && p.LATITUDE <= ne.lat &&
                   p.LONGITUDE >= sw.lng && p.LONGITUDE <= ne.lng;
        });

        // Also apply current filters (time, satellite, type, confidence, FRP)
        var range = getTimeRange();
        var activeSats = getCheckedValues('.fire-sat-filter');
        var activeTypes = getCheckedValues('.fire-type-filter').map(Number);
        var minConf = parseFloat(document.getElementById('fire-min-conf').value) || 0;
        var minFrpStr = document.getElementById('fire-min-frp').value;

        var filtered = inside.filter(function (f) {
            var p = f.properties;
            var d = parseFeatureDate(p);
            if (!d || d < range.start || d > range.end) return false;
            if (activeSats.length > 0 && activeSats.indexOf(p.SATELLITE) === -1) return false;
            if (activeTypes.length > 0 && activeTypes.indexOf(p.TYPE) === -1) return false;
            if ((p.CONFIDENCE || 0) < minConf) return false;
            var frp = p.FRP_WOOSTER || 0;
            if (minFrpStr === '' || minFrpStr === undefined) {
                var defMin = DEFAULT_MIN_FRP[p.SATELLITE] || 0;
                if (frp < defMin) return false;
            } else {
                if (frp < parseFloat(minFrpStr)) return false;
            }
            return true;
        });

        var byTime = {};
        var bySatellite = {};
        var satelliteTotals = {};
        filtered.forEach(function (f) {
            var p = f.properties;
            var date = parseFeatureDate(p);
            if (!date) return;
            var key = date.toISOString().substring(0, 16);
            var sat = p.SATELLITE || 'Unknown';
            var frp = p.FRP_WOOSTER || 0;
            if (!byTime[key]) byTime[key] = { date: date, value: 0, detections: 0 };
            byTime[key].value += frp;
            byTime[key].detections += 1;
            if (!bySatellite[sat]) bySatellite[sat] = {};
            if (!bySatellite[sat][key]) bySatellite[sat][key] = { value: 0, detections: 0 };
            bySatellite[sat][key].value += frp;
            bySatellite[sat][key].detections += 1;
            satelliteTotals[sat] = (satelliteTotals[sat] || 0) + 1;
        });

        var series = Object.keys(byTime).map(function (key) {
            var item = byTime[key];
            return {
                date: item.date,
                value: Math.round(item.value * 10) / 10,
                detections: item.detections
            };
        }).sort(function (a, b) { return a.date - b.date; });

        var timeKeys = series.map(function (item) {
            return item.date.toISOString().substring(0, 16);
        });
        var satellites = Object.keys(bySatellite).sort();
        series.datasets = satellites.map(function (sat) {
            var color = paletteSample(sat);
            return {
                label: getSatelliteLabel(sat),
                data: timeKeys.map(function (key) {
                    var item = bySatellite[sat][key];
                    return item ? Math.round(item.value * 10) / 10 : null;
                }),
                borderColor: color,
                backgroundColor: color.replace('rgb', 'rgba').replace(')', ',0.16)'),
                fill: false,
                tension: 0.18,
                pointRadius: 3,
                pointHoverRadius: 6,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: color,
                pointBorderWidth: 2,
                borderWidth: 2.25,
                spanGaps: false
            };
        });
        series.satelliteDetections = satelliteTotals;

        return series;
    }

    /* ── Public API ────────────────────────────────────────────── */

    EV.fireHotspots = {
        id: 'fire',
        name: 'Fire Hotspots',
        type: 'point',
        defaultVisible: true,

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
                iconCreateFunction: clusterIconCreate
            });
            clusterGroup.addTo(map);

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
                    return loadArchive(getTimeRange());
                }
            }).then(function () {
                // If archive was loaded because 72h was empty, keep the default last-week view.
                if (yearLoaded) {
                    var btns = document.querySelectorAll('.fire-time-btn');
                    btns.forEach(function (b) {
                        b.classList.remove('active', 'bg-blue-100', 'text-blue-700');
                        b.classList.add('bg-gray-100', 'text-gray-700');
                    });
                    var weekBtn = document.querySelector('.fire-time-btn[data-hours="168"]');
                    if (weekBtn) {
                        weekBtn.classList.add('active', 'bg-blue-100', 'text-blue-700');
                        weekBtn.classList.remove('bg-gray-100', 'text-gray-700');
                    }
                }
                populateSatelliteFilters();
                applyFilters();
            }).catch(function () {
                console.info('[FIRE] No fire data available.');
            });
        },

        setVisible: setVisible,
        queryPolygon: queryPolygon,
    };

})();
