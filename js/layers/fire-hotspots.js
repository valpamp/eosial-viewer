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
        'MET-09': 10,
        'FIRMS-MODIS-AQUA': 0,
        'FIRMS-MODIS-TERRA': 0,
        'FIRMS-NPP': 0,
        'FIRMS-NOAA20': 0,
        'FIRMS-NOAA21': 0
    };

    var SATELLITE_PRODUCTS = {
        'MTG-1': 'MTG-FCI',
        'MET-11': 'MSG-RSS',
        'MET-10': 'MSG-HRIT',
        'MET-09': 'MSG-IODC',
        'MET-08': 'MSG-HRIT',
        'FIRMS-MODIS-AQUA': 'NASA FIRMS MODIS/Aqua C6.1',
        'FIRMS-MODIS-TERRA': 'NASA FIRMS MODIS/Terra C6.1',
        'FIRMS-NPP': 'NASA FIRMS Suomi-NPP VIIRS C2',
        'FIRMS-NOAA20': 'NASA FIRMS NOAA-20 VIIRS C2',
        'FIRMS-NOAA21': 'NASA FIRMS NOAA-21 VIIRS C2'
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
            { t: 0.0,  c: [219, 234, 254] },
            { t: 0.25, c: [147, 197, 253] },
            { t: 0.5,  c: [ 59, 130, 246] },
            { t: 0.75, c: [ 29,  78, 216] },
            { t: 1.0,  c: [ 30,  64, 175] }
        ],
        'MET-10': [
            { t: 0.0,  c: [204, 251, 241] },
            { t: 0.25, c: [ 94, 234, 212] },
            { t: 0.5,  c: [ 20, 184, 166] },
            { t: 0.75, c: [ 15, 118, 110] },
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
        ],
        'FIRMS-MODIS-AQUA': [
            { t: 0.0,  c: [255, 237, 213] },
            { t: 0.25, c: [253, 186, 116] },
            { t: 0.5,  c: [249, 115,  22] },
            { t: 0.75, c: [194,  65,  12] },
            { t: 1.0,  c: [124,  45,  18] }
        ],
        'FIRMS-MODIS-TERRA': [
            { t: 0.0,  c: [254, 226, 226] },
            { t: 0.25, c: [252, 165, 165] },
            { t: 0.5,  c: [239,  68,  68] },
            { t: 0.75, c: [185,  28,  28] },
            { t: 1.0,  c: [127,  29,  29] }
        ],
        'FIRMS-NPP': [
            { t: 0.0,  c: [220, 252, 231] },
            { t: 0.25, c: [134, 239, 172] },
            { t: 0.5,  c: [ 34, 197,  94] },
            { t: 0.75, c: [ 21, 128,  61] },
            { t: 1.0,  c: [ 20,  83,  45] }
        ],
        'FIRMS-NOAA20': [
            { t: 0.0,  c: [219, 234, 254] },
            { t: 0.25, c: [165, 180, 252] },
            { t: 0.5,  c: [ 99, 102, 241] },
            { t: 0.75, c: [ 67,  56, 202] },
            { t: 1.0,  c: [ 49,  46, 129] }
        ],
        'FIRMS-NOAA21': [
            { t: 0.0,  c: [243, 232, 255] },
            { t: 0.25, c: [216, 180, 254] },
            { t: 0.5,  c: [168,  85, 247] },
            { t: 0.75, c: [126,  34, 206] },
            { t: 1.0,  c: [ 88,  28, 135] }
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
    var sfideVisible  = true;
    var firmsVisible  = false;
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
        if (satellite && satellite.indexOf('FIRMS-') === 0) return true;
        if (satellite && satellite.indexOf('MTG') === 0) return true;
        return !availableSatellites.some(function (sat) { return sat && sat.indexOf('MTG') === 0; });
    }

    function getDatasetLabel(dataset) {
        return dataset === 'FIRMS' ? 'NASA FIRMS NRT (external)' : 'SFIDE';
    }

    function isFirmsFeature(props) {
        return props && props.DATASET === 'FIRMS';
    }

    function isSourceVisible(props) {
        return isFirmsFeature(props) ? firmsVisible : sfideVisible;
    }

    function anySourceVisible() {
        return sfideVisible || firmsVisible;
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
        var c = stops[Math.min(2, stops.length - 1)].c;
        return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    }

    function clusterShapeCSS(fireType) {
        switch (Number(fireType)) {
            case 1:
                return 'clip-path:polygon(50% 4%,96% 96%,4% 96%);';
            case 2:
                return 'border-radius:5px;';
            case 3:
                return 'clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);';
            case 0:
            default:
                return 'border-radius:50%;';
        }
    }

    function majorityFireType(markers) {
        var counts = {};
        markers.forEach(function (marker) {
            var type = marker.options.fireType;
            if (FIRE_TYPE_CONFIG[type] === undefined) type = 0;
            counts[type] = (counts[type] || 0) + 1;
        });

        var winner = 0;
        var best = -1;
        Object.keys(counts).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (type) {
            if (counts[type] > best) {
                winner = Number(type);
                best = counts[type];
            }
        });
        return winner;
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
        var fireType = majorityFireType(markers);
        var shape = clusterShapeCSS(fireType);
        var typeConf = FIRE_TYPE_CONFIG[fireType] || FIRE_TYPE_CONFIG[0];
        var html =
            '<div style="' +
            'position:relative;width:' + size + 'px;height:' + size + 'px;' +
            'background:rgba(17,24,39,0.86);' + shape +
            'box-shadow:0 2px 8px rgba(0,0,0,0.28);' +
            '" title="' + typeConf.label + ' majority">' +
            '<div style="' +
            'position:absolute;inset:2px;background:' + bg + ';' + shape +
            '">' +
            '</div>' +
            '<span style="' +
            'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
            'min-width:22px;height:22px;border-radius:999px;background:rgba(255,255,255,0.9);' +
            'display:flex;align-items:center;justify-content:center;padding:0 5px;' +
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

    function normalizeFirmsSatellite(raw, product) {
        raw = String(raw || '').toUpperCase();
        product = String(product || '').toLowerCase();
        if (product.indexOf('noaa-21') !== -1 || raw === 'N21') return 'FIRMS-NOAA21';
        if (product.indexOf('noaa-20') !== -1 || raw === 'N20') return 'FIRMS-NOAA20';
        if (product.indexOf('suomi') !== -1 || raw === 'N') return 'FIRMS-NPP';
        if (raw === 'A') return 'FIRMS-MODIS-AQUA';
        if (raw === 'T') return 'FIRMS-MODIS-TERRA';
        if (product.indexOf('modis') !== -1) return 'FIRMS-MODIS';
        return 'FIRMS-' + (raw || 'UNKNOWN');
    }

    function normalizeFirmsFeature(feature) {
        var p = feature.properties;
        var date = String(p.acq_date || '').trim();
        var time = String(p.acq_time || '').trim();
        if (/^\d{4}$/.test(time)) time = time.substring(0, 2) + ':' + time.substring(2, 4);
        if (/^\d{1,2}:\d{2}$/.test(time)) time = time.padStart(5, '0');

        p.DATASET = 'FIRMS';
        p.DATASET_LABEL = getDatasetLabel('FIRMS');
        p.PRODUCT = p.product || '';
        p.SOURCE_FILE = p.source_file || '';
        p.SATELLITE = normalizeFirmsSatellite(p.satellite, p.product);
        p.LATITUDE = Number(p.latitude);
        p.LONGITUDE = Number(p.longitude);
        p.DATETIME = date && time ? date.replace(/-/g, '/') + ' ' + time : '';
        p.TYPE = 0;
        p.FRP_WOOSTER = Number(p.frp || 0);
        p.CONFIDENCE_RAW = p.confidence;
        p.CONFIDENCE = /^\d+(\.\d+)?$/.test(String(p.confidence || '')) ? Number(p.confidence) : null;
        p.VIIRS_CONFIDENCE = p.CONFIDENCE === null ? String(p.confidence || '').toLowerCase() : '';
        p.INSTRUMENT = String(p.product || '').indexOf('modis') !== -1 ? 'MODIS' : 'VIIRS';
        p.DAYNIGHT = p.daynight || '';
        p.BRIGHT_MIR = Number(p.brightness != null ? p.brightness : p.bright_ti4);
        p.BRIGHT_TIR = Number(p.bright_t31 != null ? p.bright_t31 : p.bright_ti5);
        if (!isFinite(p.BRIGHT_MIR)) p.BRIGHT_MIR = null;
        if (!isFinite(p.BRIGHT_TIR)) p.BRIGHT_TIR = null;
        return feature;
    }

    function formatUTC(date) {
        if (!date) return 'N/A';
        return date.toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
    }

    function formatSidebarUTC(date) {
        if (!date) return 'Not available';
        return pad2(date.getUTCDate()) + '/' +
               pad2(date.getUTCMonth() + 1) + '/' +
               date.getUTCFullYear() + ' ' +
               pad2(date.getUTCHours()) + ':' +
               pad2(date.getUTCMinutes()) + ' UTC';
    }

    function getLatestHotspotDate(includeHiddenSources) {
        var latest = null;
        for (var i = 0; i < allFeatures.length; i++) {
            var props = allFeatures[i].properties || {};
            if (!includeHiddenSources && !isSourceVisible(props)) continue;
            var d = parseFeatureDate(props);
            if (d && (!latest || d > latest)) latest = d;
        }
        if (!latest && !includeHiddenSources) return getLatestHotspotDate(true);
        return latest;
    }

    function updateDatabaseLastUpdate() {
        var el = document.getElementById('fire-last-update');
        if (!el) return;
        el.textContent = 'Updated: ' + formatSidebarUTC(getLatestHotspotDate());
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
        if (p.acq_date && p.acq_time && p.product) {
            feature = normalizeFirmsFeature(feature);
            p = feature.properties;
        } else {
            p.DATASET = p.DATASET || 'SFIDE';
            p.DATASET_LABEL = getDatasetLabel('SFIDE');
        }
        var coords = feature.geometry && feature.geometry.type === 'Point'
            ? feature.geometry.coordinates
            : null;
        if ((p.LATITUDE == null || p.LONGITUDE == null) && coords && coords.length >= 2) {
            p.LONGITUDE = Number(coords[0]);
            p.LATITUDE = Number(coords[1]);
        }
        if (p.TYPE != null) p.TYPE = Number(p.TYPE);
        ['LATITUDE', 'LONGITUDE', 'FRP_WOOSTER', 'FRP_MODIS', 'BRIGHT_MIR', 'BRIGHT_TIR'].forEach(function (key) {
            if (p[key] != null && p[key] !== '') p[key] = Number(p[key]);
        });
        if (p.CONFIDENCE != null && p.CONFIDENCE !== '') {
            var conf = Number(p.CONFIDENCE);
            p.CONFIDENCE = isFinite(conf) ? conf : null;
        }
        return (isFinite(p.LATITUDE) && isFinite(p.LONGITUDE)) ? feature : null;
    }

    function featureKey(feature) {
        var p = feature.properties || {};
        return [
            p.DATASET || '',
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
        updateDatabaseLastUpdate();
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

    function loadFirmsNrt() {
        function loadListed(files) {
            if (!files || !files.length) return Promise.resolve([]);
            EV.showLoading('Loading NASA FIRMS NRT hotspots...');
            return Promise.all(files.map(function (file) {
                return loadByFormat(file.url, file.ext || '.fgb').catch(function (err) {
                    console.warn('[FIRMS] External hotspot load error:', file.url, err);
                    return [];
                });
            })).then(function (groups) {
                EV.hideLoading();
                var merged = [];
                groups.forEach(function (features) { merged = merged.concat(features || []); });
                mergeFeatures(merged);
                return merged;
            }).catch(function (err) {
                EV.hideLoading();
                throw err;
            });
        }

        return fetch(dataBaseUrl + '/fire/firms_manifest.json?v=' + Date.now())
            .then(function (r) {
                if (!r.ok) throw new Error('No FIRMS manifest');
                return r.json();
            })
            .then(function (manifest) {
                var files = (manifest.files || []).map(function (item) {
                    var path = typeof item === 'string' ? item : item.path;
                    var ext = path && path.match(/\.[^.]+$/) ? path.match(/\.[^.]+$/)[0].toLowerCase() : '.fgb';
                    return { url: dataBaseUrl + '/fire/' + path, ext: ext };
                }).filter(function (item) { return !!item.url; });
                return loadListed(files);
            })
            .catch(function () {
                return loadListed([{ url: 'FIRMS_ITA_2026147.fgb?v=' + Date.now(), ext: '.fgb' }]);
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
        var activeViirsConf = getCheckedValues('.fire-viirs-conf-filter');
        var viirsConfFilterCount = document.querySelectorAll('.fire-viirs-conf-filter').length;
        var sfideMinConf = parseFloat(document.getElementById('fire-sfide-min-conf').value) || 0;
        var firmsModisMinConf = parseFloat(document.getElementById('fire-firms-modis-min-conf').value) || 0;
        var sfideMinFrpStr = document.getElementById('fire-sfide-min-frp').value;
        var firmsMinFrpStr = document.getElementById('fire-firms-min-frp').value;

        if (!anySourceVisible()) {
            displayFeatures([]);
            var noSourceCountEl = document.getElementById('fire-count');
            if (noSourceCountEl) noSourceCountEl.textContent = '0 hotspots';
            return;
        }

        var filtered = allFeatures.filter(function (f) {
            var p = f.properties;
            var isFirms = isFirmsFeature(p);

            if (!isSourceVisible(p)) return false;

            // Time
            var d = parseFeatureDate(p);
            if (!d || d < range.start || d > range.end) return false;

            // Satellite
            if (activeSats.length > 0 && activeSats.indexOf(p.SATELLITE) === -1) return false;

            // SFIDE fire type
            if (!isFirms && (activeTypes.length === 0 || activeTypes.indexOf(p.TYPE) === -1)) return false;

            // Confidence
            if (isFirms && p.VIIRS_CONFIDENCE) {
                if (viirsConfFilterCount > 0 && activeViirsConf.length === 0) return false;
                if (activeViirsConf.length > 0 && activeViirsConf.indexOf(p.VIIRS_CONFIDENCE) === -1) return false;
            } else if (isFirms) {
                if ((p.CONFIDENCE || 0) < firmsModisMinConf) return false;
            } else if ((p.CONFIDENCE || 0) < sfideMinConf) return false;

            // FRP
            var frp = p.FRP_WOOSTER || 0;
            var minFrpStr = isFirms ? firmsMinFrpStr : sfideMinFrpStr;
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

            var marker = L.marker(latlng, { icon: icon, satellite: p.SATELLITE, fireType: p.TYPE });
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
        html += '<tr><th>Source</th><td>' + (p.DATASET_LABEL || getDatasetLabel(p.DATASET || 'SFIDE')) + '</td></tr>';
        html += '<tr><th>Time (UTC)</th><td>' + formatUTC(date) + '</td></tr>';
        if (!isFirmsFeature(p)) html += '<tr><th>Fire Type</th><td>' + typeConf.label + '</td></tr>';
        html += '<tr><th>FRP</th><td>' + (frp != null ? frp.toFixed(1) + ' MW' : 'N/A') + '</td></tr>';
        html += '<tr><th>Confidence</th><td>' + (p.CONFIDENCE_RAW != null ? p.CONFIDENCE_RAW : (p.CONFIDENCE != null ? p.CONFIDENCE + '%' : 'N/A')) + '</td></tr>';
        if (p.PRODUCT) html += '<tr><th>Product</th><td>' + p.PRODUCT + '</td></tr>';
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
            if (!isSourceVisible(p)) return false;
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
        var sfideContainer = document.getElementById('fire-sfide-sat-list');
        var firmsContainer = document.getElementById('fire-firms-sat-list');
        var fallbackContainer = document.getElementById('fire-sat-list');
        if (!sfideContainer && !firmsContainer && !fallbackContainer) return;
        if (sfideContainer) sfideContainer.innerHTML = '';
        if (firmsContainer) firmsContainer.innerHTML = '';
        if (fallbackContainer) fallbackContainer.innerHTML = '';

        var sats = {};
        for (var i = 0; i < allFeatures.length; i++) {
            sats[allFeatures[i].properties.SATELLITE] = true;
        }
        var sorted = Object.keys(sats).sort();

        sorted.forEach(function (sat) {
            var target = sat.indexOf('FIRMS-') === 0 ? firmsContainer : sfideContainer;
            if (!target) target = fallbackContainer;
            if (!target) return;
            var div = document.createElement('label');
            div.className = 'toolbar-pill';
            var checked = isDefaultSatelliteSelected(sat, sorted) ? ' checked' : '';
            var swatchColor = paletteSample(sat);
            div.innerHTML =
                '<input type="checkbox" value="' + sat + '" class="fire-sat-filter"' + checked + '>' +
                '<span class="toolbar-sat-swatch" style="background-color:' + swatchColor + ';"></span>' +
                '<span>' + getSatelliteLabel(sat) + '</span>';
            target.appendChild(div);
        });

        document.querySelectorAll('.fire-sat-filter').forEach(function (cb) {
            cb.addEventListener('change', applyFilters);
        });
    }

    /* ── Sidebar controls ──────────────────────────────────────── */

    function buildControls(map) {
        var container = document.getElementById('product-toolbar-content') || document.getElementById('layer-controls');
        var section = document.createElement('div');
        section.id = 'fire-controls';
        section.className = 'product-toolbar-section fire-toolbar-window';
        section.innerHTML =
            '<div class="product-toolbar-title">Hotspot Window</div>' +
            '<div class="toolbar-divider"></div>' +

            /* Time presets */
            '<div class="product-toolbar-group">' +
            '  <span class="product-toolbar-label">Time</span>' +
            '  <div class="toolbar-pill-list">' +
            '    <button class="fire-time-btn toolbar-btn-compact" data-hours="6">6h</button>' +
            '    <button class="fire-time-btn toolbar-btn-compact" data-hours="12">12h</button>' +
            '    <button class="fire-time-btn toolbar-btn-compact active" data-hours="24">24h</button>' +
            '    <button class="fire-time-btn toolbar-btn-compact" data-hours="72">72h</button>' +
            '    <button class="fire-time-btn toolbar-btn-compact" data-hours="168">7d</button>' +
            '    <button class="fire-time-btn toolbar-btn-compact" data-hours="0">All</button>' +
            '  </div>' +
            '</div>' +

            /* Custom date range */
            '<div class="product-toolbar-group">' +
            '  <span class="product-toolbar-label">Range</span>' +
            '  <span class="toolbar-field"><input type="text" id="fire-start-time" placeholder="dd/mm/yyyy hh:mm"></span>' +
            '  <span class="toolbar-field"><input type="text" id="fire-end-time" placeholder="dd/mm/yyyy hh:mm"></span>' +
            '  <button id="fire-apply-custom" class="toolbar-btn-compact">Apply</button>' +
            '</div>' +

            /* Count display */
            '<div class="toolbar-status"><span id="fire-count">-</span><br><span id="fire-last-update">Loading...</span></div>';

        container.appendChild(section);

        var sfideSection = document.createElement('div');
        sfideSection.id = 'fire-sfide-controls';
        sfideSection.className = 'product-toolbar-section fire-source-toolbar fire-source-toolbar-sfide';
        sfideSection.innerHTML =
            '<div class="product-toolbar-title toolbar-source-title">SFIDE Hotspots</div>' +
            '<div class="toolbar-divider"></div>' +
            '<div class="product-toolbar-group">' +
            '  <span class="product-toolbar-label">Satellites</span>' +
            '  <div id="fire-sfide-sat-list" class="toolbar-pill-list"><span class="toolbar-status">Loading...</span></div>' +
            '</div>' +
            '<div class="product-toolbar-group">' +
            '  <span class="product-toolbar-label">Fire type</span>' +
            '  <div id="fire-type-list" class="toolbar-pill-list"></div>' +
            '</div>' +
            '<div class="product-toolbar-group">' +
            '  <span class="toolbar-field"><span class="product-toolbar-label">Min conf</span><input type="number" id="fire-sfide-min-conf" min="0" max="100" value="40" title="Minimum SFIDE confidence (%)"></span>' +
            '  <span class="toolbar-field"><span class="product-toolbar-label">FRP</span><input type="number" id="fire-sfide-min-frp" min="0" step="0.1" value="10" title="Minimum SFIDE FRP (MW)"></span>' +
            '</div>';
        container.appendChild(sfideSection);

        var firmsSection = document.createElement('div');
        firmsSection.id = 'fire-firms-controls';
        firmsSection.className = 'product-toolbar-section fire-source-toolbar fire-source-toolbar-firms hidden';
        firmsSection.innerHTML =
            '<div class="product-toolbar-title toolbar-source-title firms-title">FIRMS Hotspots <span class="toolbar-source-badge">NASA external</span></div>' +
            '<div class="toolbar-divider"></div>' +
            '<div class="product-toolbar-group">' +
            '  <span class="product-toolbar-label">Satellites</span>' +
            '  <div id="fire-firms-sat-list" class="toolbar-pill-list"><span class="toolbar-status">Loading...</span></div>' +
            '</div>' +
            '<div class="product-toolbar-group">' +
            '  <span class="product-toolbar-label">VIIRS conf</span>' +
            '  <div class="toolbar-pill-list">' +
            '    <label class="toolbar-pill"><input type="checkbox" value="low" class="fire-viirs-conf-filter" checked><span>Low</span></label>' +
            '    <label class="toolbar-pill"><input type="checkbox" value="nominal" class="fire-viirs-conf-filter" checked><span>Nominal</span></label>' +
            '    <label class="toolbar-pill"><input type="checkbox" value="high" class="fire-viirs-conf-filter" checked><span>High</span></label>' +
            '  </div>' +
            '</div>' +
            '<div class="product-toolbar-group">' +
            '  <span class="toolbar-field"><span class="product-toolbar-label">MODIS conf</span><input type="number" id="fire-firms-modis-min-conf" min="0" max="100" value="0" title="Minimum NASA FIRMS MODIS confidence (%)"></span>' +
            '  <span class="toolbar-field"><span class="product-toolbar-label">FRP</span><input type="number" id="fire-firms-min-frp" min="0" step="0.1" value="0" title="Minimum NASA FIRMS FRP (MW)"></span>' +
            '</div>';
        container.appendChild(firmsSection);

        EV.updateProductToolbarVisibility();
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
            div.className = 'toolbar-pill';
            div.innerHTML =
                '<input type="checkbox" value="' + type + '" class="fire-type-filter" checked>' +
                '<svg width="12" height="12" viewBox="0 0 24 24" style="fill:#777;stroke:#000;stroke-width:2;"><path d="' + conf.path + '"/></svg>' +
                '<span>' + conf.label + '</span>';
            typeList.appendChild(div);
        });
        typeList.querySelectorAll('.fire-type-filter').forEach(function (cb) {
            cb.addEventListener('change', applyFilters);
        });

        // Advanced filter inputs
        document.getElementById('fire-sfide-min-conf').addEventListener('change', applyFilters);
        document.getElementById('fire-sfide-min-frp').addEventListener('change', applyFilters);
        document.getElementById('fire-firms-modis-min-conf').addEventListener('change', applyFilters);
        document.getElementById('fire-firms-min-frp').addEventListener('change', applyFilters);
        firmsSection.querySelectorAll('.fire-viirs-conf-filter').forEach(function (cb) {
            cb.addEventListener('change', applyFilters);
        });
        updateFireControlVisibility();
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
            var end = getLatestHotspotDate() || new Date();
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
        var now = getLatestHotspotDate() || new Date();
        return { start: new Date(now.getTime() - 24 * 3600000), end: now };
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
        var end = getLatestHotspotDate() || new Date();
        var start = new Date(end.getTime() - 24 * 3600000);
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
        activeSats = activeSats.filter(function (sat) {
            return sat.indexOf('FIRMS-') === 0 ? firmsVisible : sfideVisible;
        });
        if (!activeSats.length) {
            var visibleSats = {};
            allFeatures.forEach(function (f) {
                var p = f.properties || {};
                if (isSourceVisible(p) && p.SATELLITE) visibleSats[p.SATELLITE] = true;
            });
            activeSats = Object.keys(visibleSats).sort().slice(0, 1);
        }

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

    function updateFireControlVisibility() {
        var common = document.getElementById('fire-controls');
        var sfide = document.getElementById('fire-sfide-controls');
        var firms = document.getElementById('fire-firms-controls');
        var leg  = document.getElementById('fire-legend');
        if (common) common.classList.toggle('hidden', !anySourceVisible());
        if (sfide) sfide.classList.toggle('hidden', !sfideVisible);
        if (firms) firms.classList.toggle('hidden', !firmsVisible);
        if (leg) leg.style.display = anySourceVisible() ? '' : 'none';
        EV.updateProductToolbarVisibility();
    }

    function setSourceVisible(source, v, map) {
        if (source === 'FIRMS') {
            firmsVisible = v;
        } else {
            sfideVisible = v;
        }

        var targetMap = map || mapRef;
        if (clusterGroup && targetMap) {
            if (anySourceVisible()) clusterGroup.addTo(targetMap);
            else targetMap.removeLayer(clusterGroup);
        }

        updateFireControlVisibility();
        updateDatabaseLastUpdate();
        applyFilters();
    }

    function setVisible(v, map) {
        setSourceVisible('SFIDE', v, map);
        EV.updateProductToolbarVisibility();
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
        var activeViirsConf = getCheckedValues('.fire-viirs-conf-filter');
        var viirsConfFilterCount = document.querySelectorAll('.fire-viirs-conf-filter').length;
        var sfideMinConf = parseFloat(document.getElementById('fire-sfide-min-conf').value) || 0;
        var firmsModisMinConf = parseFloat(document.getElementById('fire-firms-modis-min-conf').value) || 0;
        var sfideMinFrpStr = document.getElementById('fire-sfide-min-frp').value;
        var firmsMinFrpStr = document.getElementById('fire-firms-min-frp').value;

        if (!anySourceVisible()) return [];

        var filtered = inside.filter(function (f) {
            var p = f.properties;
            var isFirms = isFirmsFeature(p);
            var d = parseFeatureDate(p);
            if (!isSourceVisible(p)) return false;
            if (!d || d < range.start || d > range.end) return false;
            if (activeSats.length > 0 && activeSats.indexOf(p.SATELLITE) === -1) return false;
            if (!isFirms && (activeTypes.length === 0 || activeTypes.indexOf(p.TYPE) === -1)) return false;
            if (isFirms && p.VIIRS_CONFIDENCE) {
                if (viirsConfFilterCount > 0 && activeViirsConf.length === 0) return false;
                if (activeViirsConf.length > 0 && activeViirsConf.indexOf(p.VIIRS_CONFIDENCE) === -1) return false;
            } else if (isFirms) {
                if ((p.CONFIDENCE || 0) < firmsModisMinConf) return false;
            } else if ((p.CONFIDENCE || 0) < sfideMinConf) return false;
            var frp = p.FRP_WOOSTER || 0;
            var minFrpStr = isFirms ? firmsMinFrpStr : sfideMinFrpStr;
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
                return loadFirmsNrt();
            }).then(function () {
                // If archive was loaded because 72h was empty, keep the default 24h view.
                if (yearLoaded) {
                    var btns = document.querySelectorAll('.fire-time-btn');
                    btns.forEach(function (b) {
                        b.classList.remove('active', 'bg-blue-100', 'text-blue-700');
                        b.classList.add('bg-gray-100', 'text-gray-700');
                    });
                    var dayBtn = document.querySelector('.fire-time-btn[data-hours="24"]');
                    if (dayBtn) {
                        dayBtn.classList.add('active', 'bg-blue-100', 'text-blue-700');
                        dayBtn.classList.remove('bg-gray-100', 'text-gray-700');
                    }
                }
                setDefaultCustomRange();
                populateSatelliteFilters();
                updateFireControlVisibility();
                applyFilters();
            }).catch(function () {
                console.info('[FIRE] No fire data available.');
                updateDatabaseLastUpdate();
            });
        },

        setVisible: setVisible,
        queryPolygon: queryPolygon,
    };

    EV.sfideHotspots = {
        id: 'sfide-fire',
        name: 'SFIDE Hotspots',
        type: 'point',
        defaultVisible: true,
        setVisible: function (v, map) {
            setSourceVisible('SFIDE', v, map);
        }
    };

    EV.firmsHotspots = {
        id: 'firms-fire',
        name: 'FIRMS Hotspots',
        type: 'point',
        defaultVisible: false,
        setVisible: function (v, map) {
            setSourceVisible('FIRMS', v, map);
        }
    };

})();
