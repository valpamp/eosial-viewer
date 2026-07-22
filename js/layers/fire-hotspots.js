/**
 * EOSIAL Active Fire Viewer — Fire Hotspots layer
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
        'MTG-1': 20,
        'MET-11': 20,
        'MET-10': 20,
        'MET-09': 20,
        'FIRMS-MODIS-AQUA': 0,
        'FIRMS-MODIS-TERRA': 0,
        'FIRMS-NPP': 0,
        'FIRMS-NOAA20': 0,
        'FIRMS-NOAA21': 0,
        'S3A': 0,
        'S3B': 0,
        'MTG-FIR': 20
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
        'FIRMS-NOAA21': 'NASA FIRMS NOAA-21 VIIRS C2',
        'S3A': 'Sentinel-3A SLSTR',
        'S3B': 'Sentinel-3B SLSTR',
        'MTG-FIR': 'Official EUMETSAT MTG-FIR'
    };

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
            { t: 0.0,  c: [253, 242, 248] },
            { t: 0.25, c: [249, 168, 212] },
            { t: 0.5,  c: [236,  72, 153] },
            { t: 0.75, c: [190,  24,  93] },
            { t: 1.0,  c: [131,  24,  67] }
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
        ],
        'S3A': [
            { t: 0.0,  c: [207, 250, 254] },
            { t: 0.25, c: [103, 232, 249] },
            { t: 0.5,  c: [  6, 182, 212] },
            { t: 0.75, c: [ 14, 116, 144] },
            { t: 1.0,  c: [ 22,  78,  99] }
        ],
        'S3B': [
            { t: 0.0,  c: [254, 249, 195] },
            { t: 0.25, c: [253, 224,  71] },
            { t: 0.5,  c: [234, 179,   8] },
            { t: 0.75, c: [161,  98,   7] },
            { t: 1.0,  c: [113,  63,  18] }
        ],
        'MTG-FIR': [
            { t: 0.0,  c: [253, 242, 248] },
            { t: 0.25, c: [249, 168, 212] },
            { t: 0.5,  c: [236,  72, 153] },
            { t: 0.75, c: [190,  24,  93] },
            { t: 1.0,  c: [131,  24,  67] }
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
    var s3Visible     = false;
    var mtgFirVisible = false;
    var activeFireSourceTab = 'SFIDE';
    var allFeatures   = [];
    var featureIds    = {};
    var yearLoaded    = false;
    var archiveManifest = null;
    var loadedArchiveMonths = {};
    var archiveLoadInProgressKey = null;
    var archiveLoadFailedKey = null;
    var externalArchiveManifests = {};
    var loadedExternalArchiveChunks = {};
    var externalArchiveLoads = {};
    var externalArchiveReady = {};
    var mapRef        = null;
    var dataBaseUrl   = '';
    var legendControl = null;
    var pendingSharedSatellites = null;

    /* ── FRP color ─────────────────────────────────────────────── */

    function getPalette(satellite) {
        return FRP_PALETTES[satellite] || FALLBACK_COLOR_STOPS;
    }

    function getSatelliteLabel(satellite) {
        var product = SATELLITE_PRODUCTS[satellite];
        return product ? satellite + ' (' + product + ')' : satellite;
    }

    function getS3ProductLabel(satellite) {
        return satellite === 'S3B' ? 'S3B SLSTR Level 2 FRP' : 'S3A SLSTR Level 2 FRP';
    }

    function isDefaultSatelliteSelected(satellite, availableSatellites) {
        if (satellite === 'MTG-FIR') return true;
        if (satellite === 'S3A' || satellite === 'S3B') return true;
        if (satellite && satellite.indexOf('FIRMS-') === 0) return true;
        if (satellite && satellite.indexOf('MTG') === 0) return true;
        return !availableSatellites.some(function (sat) { return sat && sat.indexOf('MTG') === 0; });
    }

    function getDatasetLabel(dataset) {
        if (dataset === 'FIRMS') return 'NASA FIRMS NRT (external)';
        if (dataset === 'S3') return 'Sentinel-3 NRT (external)';
        if (dataset === 'MTG_FIR') return 'EUMETSAT MTG-FIR (external)';
        return 'SFIDE';
    }

    function isFirmsFeature(props) {
        return props && props.DATASET === 'FIRMS';
    }

    function isS3Feature(props) {
        return props && props.DATASET === 'S3';
    }

    function isMtgFirFeature(props) {
        return props && props.DATASET === 'MTG_FIR';
    }

    function isPolarTimeseriesSource(dataset) {
        return dataset === 'FIRMS' || dataset === 'S3';
    }

    function isSourceVisible(props) {
        if (isFirmsFeature(props)) return firmsVisible;
        if (isS3Feature(props)) return s3Visible;
        if (isMtgFirFeature(props)) return mtgFirVisible;
        return sfideVisible;
    }

    function anySourceVisible() {
        return sfideVisible || firmsVisible || s3Visible || mtgFirVisible;
    }

    function paletteSample(satellite) {
        var stops = getPalette(satellite);
        var c = stops[Math.min(2, stops.length - 1)].c;
        return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    }
    function getFRPMarkerSize(frp) {
        if (frp == null || !isFinite(Number(frp))) return 12;
        frp = Number(frp);
        if (frp < 20) return 12;
        if (frp < 100) return 16;
        if (frp < 500) return 21;
        return 28;
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
        if (raw === 'A' || raw === 'AQUA') return 'FIRMS-MODIS-AQUA';
        if (raw === 'T' || raw === 'TERRA') return 'FIRMS-MODIS-TERRA';
        if (product.indexOf('modis') !== -1) return 'FIRMS-MODIS';
        return 'FIRMS-' + (raw || 'UNKNOWN');
    }

    function normalizeFirmsFeature(feature) {
        var p = feature.properties;
        var rawDate = firstProp(p, ['acq_date', 'ACQ_DATE']);
        var date = rawDate instanceof Date ? rawDate.toISOString().substring(0, 10) : String(rawDate || '').trim();
        var dateMatch = date.match(/^(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) date = dateMatch[1];
        var time = String(firstProp(p, ['acq_time', 'ACQ_TIME']) || '').trim();
        if (/^\d{4}$/.test(time)) time = time.substring(0, 2) + ':' + time.substring(2, 4);
        if (/^\d{1,2}:\d{2}$/.test(time)) time = time.padStart(5, '0');

        p.DATASET = 'FIRMS';
        p.DATASET_LABEL = getDatasetLabel('FIRMS');
        p.PRODUCT = firstProp(p, ['product', 'PRODUCT', 'version', 'VERSION']) || '';
        p.SOURCE_FILE = p.source_file || '';
        p.SATELLITE = normalizeFirmsSatellite(firstProp(p, ['satellite', 'SATELLITE']), p.PRODUCT);
        p.LATITUDE = Number(firstProp(p, ['latitude', 'LATITUDE']));
        p.LONGITUDE = Number(firstProp(p, ['longitude', 'LONGITUDE']));
        p.DATETIME = date && time ? date.replace(/-/g, '/') + ' ' + time : '';
        p.TYPE = 0;
        p.FRP_WOOSTER = Number(firstProp(p, ['frp', 'FRP']) || 0);
        p.CONFIDENCE_RAW = firstProp(p, ['confidence', 'CONFIDENCE']);
        p.CONFIDENCE = /^\d+(\.\d+)?$/.test(String(p.CONFIDENCE_RAW || '')) ? Number(p.CONFIDENCE_RAW) : null;
        var viirsConfidence = String(p.CONFIDENCE_RAW || '').toLowerCase();
        p.VIIRS_CONFIDENCE = p.CONFIDENCE === null ? ({ l: 'low', n: 'nominal', h: 'high' }[viirsConfidence] || viirsConfidence) : '';
        p.INSTRUMENT = firstProp(p, ['instrument', 'INSTRUMENT']) ||
            (String(p.PRODUCT || '').toLowerCase().indexOf('modis') !== -1 ? 'MODIS' : 'VIIRS');
        p.DAYNIGHT = firstProp(p, ['daynight', 'DAYNIGHT']) || '';
        p.BRIGHT_MIR = Number(firstProp(p, ['brightness', 'BRIGHTNESS', 'bright_ti4', 'BRIGHT_TI4']));
        p.BRIGHT_TIR = Number(firstProp(p, ['bright_t31', 'BRIGHT_T31', 'bright_ti5', 'BRIGHT_TI5']));
        if (!isFinite(p.BRIGHT_MIR)) p.BRIGHT_MIR = null;
        if (!isFinite(p.BRIGHT_TIR)) p.BRIGHT_TIR = null;
        return feature;
    }

    function firstProp(props, names) {
        for (var i = 0; i < names.length; i++) {
            if (props[names[i]] != null && props[names[i]] !== '') return props[names[i]];
        }
        var keys = Object.keys(props);
        for (var j = 0; j < names.length; j++) {
            var wanted = names[j].toLowerCase();
            for (var k = 0; k < keys.length; k++) {
                if (keys[k].toLowerCase() === wanted && props[keys[k]] != null && props[keys[k]] !== '') return props[keys[k]];
            }
        }
        return null;
    }

    function normalizeS3Satellite(value, fallbackName) {
        var text = String(value || fallbackName || '').toUpperCase();
        if (text.indexOf('S3B') !== -1 || text.indexOf('SENTINEL-3B') !== -1) return 'S3B';
        return 'S3A';
    }

    function normalizeS3DateTime(dateValue, timeValue, isoValue) {
        if (isoValue) {
            var isoText = String(isoValue).trim().replace('T', ' ').replace('Z', '');
            return isoText.replace(/-/g, '/').substring(0, 16);
        }
        if (!dateValue) return '';
        var dateText = String(dateValue).trim().replace(/-/g, '/');
        var timeText = String(timeValue || '00:00').trim();
        if (/^\d{4}$/.test(timeText)) timeText = timeText.substring(0, 2) + ':' + timeText.substring(2, 4);
        if (/^\d{1,2}:\d{2}/.test(timeText)) timeText = timeText.padStart(5, '0').substring(0, 5);
        return (dateText + ' ' + timeText).substring(0, 16);
    }

    function normalizeCompactDateTime(value) {
        var text = String(value || '').trim();
        var m = text.match(/^(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
        if (m) return m[1] + '/' + m[2] + '/' + m[3] + ' ' + m[4] + ':' + m[5];
        return text.replace(/-/g, '/').replace('T', ' ').substring(0, 16);
    }

    function numberOrNull(value) {
        if (value == null || value === '') return null;
        var n = Number(value);
        return isFinite(n) ? n : null;
    }

    function normalizeS3Feature(feature, sourceName) {
        var p = feature.properties || {};
        var coords = feature.geometry && feature.geometry.type === 'Point' ? feature.geometry.coordinates : null;
        p.DATASET = 'S3';
        p.DATASET_LABEL = getDatasetLabel('S3');
        p.SOURCE_FILE = p.SOURCE_FILE || p.source_file || p.source || sourceName || '';
        p.SATELLITE = normalizeS3Satellite(firstProp(p, ['SATELLITE', 'satellite', 'platform', 'mission', 'spacecraft']), sourceName);
        p.RAW_PRODUCT = firstProp(p, ['PRODUCT', 'product']);
        p.PRODUCT = getS3ProductLabel(p.SATELLITE);
        p.INSTRUMENT = firstProp(p, ['INSTRUMENT', 'instrument', 'sensor']) || 'SLSTR';
        var lon = numberOrNull(firstProp(p, ['LONGITUDE', 'longitude', 'lon', 'x']));
        var lat = numberOrNull(firstProp(p, ['LATITUDE', 'latitude', 'lat', 'y']));
        p.LONGITUDE = lon != null ? lon : Number(coords ? coords[0] : NaN);
        p.LATITUDE = lat != null ? lat : Number(coords ? coords[1] : NaN);
        p.DATETIME = normalizeS3DateTime(
            firstProp(p, ['OBS_DATE', 'obs_date', 'DATE', 'date', 'acq_date', 'ACQ_DATE']),
            firstProp(p, ['OBS_TIME', 'obs_time', 'TIME', 'time', 'acq_time', 'ACQ_TIME']),
            firstProp(p, ['DATETIME', 'datetime', 'acq_datetime', 'ACQ_DATETIME', 'timestamp', 'TIMESTAMP'])
        );
        p.TYPE = 0;
        var frp = numberOrNull(firstProp(p, ['FRP_WOOSTER', 'FRP', 'frp', 'FRP_MW', 'frp_mw']));
        p.FRP_WOOSTER = frp != null ? frp : 0;
        p.CONFIDENCE_RAW = firstProp(p, ['CONFIDENCE_RAW', 'confidence', 'CONFIDENCE', 'confid']);
        p.CONFIDENCE = numberOrNull(p.CONFIDENCE_RAW);
        p.BRIGHT_MIR = numberOrNull(firstProp(p, ['BRIGHT_MIR', 'bright_mir', 'BT_MIR', 'bt_mir', 'mwir_bt_k', 'MWIR_BT_K', 'S7_BT']));
        p.BRIGHT_TIR = numberOrNull(firstProp(p, ['BRIGHT_TIR', 'bright_tir', 'BT_TIR', 'bt_tir', 'S8_BT']));
        p.DAYNIGHT = firstProp(p, ['DAYNIGHT', 'daynight', 'day_night']) || '';
        feature.properties = p;
        return feature;
    }

    function normalizeMtgFirFeature(feature, sourceName) {
        var p = feature.properties || {};
        var coords = feature.geometry && feature.geometry.type === 'Point' ? feature.geometry.coordinates : null;
        p.DATASET = 'MTG_FIR';
        p.DATASET_LABEL = getDatasetLabel('MTG_FIR');
        p.SOURCE_FILE = p.SOURCE_FILE || p.source_file || p.source_fgb || sourceName || '';
        p.SATELLITE = 'MTG-FIR';
        p.PRODUCT = 'MTG-FIR Fire Detection and Monitoring';
        p.INSTRUMENT = 'MTG-I FCI';
        p.LONGITUDE = Number(coords ? coords[0] : firstProp(p, ['LONGITUDE', 'longitude', 'lon', 'x']));
        p.LATITUDE = Number(coords ? coords[1] : firstProp(p, ['LATITUDE', 'latitude', 'lat', 'y']));
        p.DATETIME = normalizeCompactDateTime(firstProp(p, ['start_time', 'START_TIME', 'DATETIME', 'datetime']));
        p.TYPE = 0;
        p.FRP_WOOSTER = null;
        p.CONFIDENCE_RAW = firstProp(p, ['fire_probability', 'FIRE_PROBABILITY', 'confidence', 'CONFIDENCE']);
        p.CONFIDENCE = numberOrNull(p.CONFIDENCE_RAW);
        p.FIRE_RESULT = firstProp(p, ['fire_result', 'FIRE_RESULT']);
        p.PROD_QUALITY = numberOrNull(firstProp(p, ['prod_quality', 'PROD_QUALITY']));
        p.PROD_COMPLETE = numberOrNull(firstProp(p, ['prod_complete', 'PROD_COMPLETE']));
        p.PROD_TIMELY = numberOrNull(firstProp(p, ['prod_timely', 'PROD_TIMELY']));
        p.DAYNIGHT = '';
        p.BRIGHT_MIR = null;
        p.BRIGHT_TIR = null;
        feature.properties = p;
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

    function getLatestHotspotDateForDataset(dataset) {
        var latest = null;
        for (var i = 0; i < allFeatures.length; i++) {
            var props = allFeatures[i].properties || {};
            if (dataset === 'SFIDE') {
                if (isFirmsFeature(props) || isS3Feature(props) || isMtgFirFeature(props)) continue;
            } else if ((props.DATASET || 'SFIDE') !== dataset) {
                continue;
            }
            var d = parseFeatureDate(props);
            if (d && (!latest || d > latest)) latest = d;
        }
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

    function loadByFormat(url, ext, normalizer) {
        switch (ext) {
            case '.fgb':    return loadFlatGeobuf(url, normalizer);
            case '.zip':    return loadShapefile(url, normalizer);
            case '.gpkg':   return loadGeoPackage(url, normalizer);
            case '.geojson':
            case '.json':   return loadGeoJSON(url, normalizer);
            default:        return Promise.reject(new Error('Unknown extension: ' + ext));
        }
    }

    function normalizeLoadedFeatures(features, normalizer) {
        var fn = normalizer || normalizeFeature;
        return (features || []).map(fn).filter(Boolean);
    }

    function loadFlatGeobuf(url, normalizer) {
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
                        return normalizeLoadedFeatures(features, normalizer);
                    })();
                }
                for (var f of iterator) {
                    features.push(f);
                }
                return normalizeLoadedFeatures(features, normalizer);
            });
    }

    function loadShapefile(url, normalizer) {
        return shp(url) // eslint-disable-line no-undef
            .then(function (fc) {
                if (!fc) { var e = new Error('404'); e.notFound = true; throw e; }
                // shpjs may return a FeatureCollection or array of FeatureCollections
                if (Array.isArray(fc)) {
                    return fc.reduce(function (acc, c) { return acc.concat(c.features || []); }, [])
                        .map(normalizer || normalizeFeature).filter(Boolean);
                }
                return normalizeLoadedFeatures(fc.features || [], normalizer);
            })
            .catch(function (err) {
                if (!err.notFound) { var e = new Error('404'); e.notFound = true; throw e; }
                throw err;
            });
    }

    function loadGeoPackage(url, normalizer) {
        return fetch(url)
            .then(function (r) {
                if (r.status === 404) { var e = new Error('404'); e.notFound = true; throw e; }
                if (!r.ok) throw new Error(r.status);
                return r.arrayBuffer();
            })
            .then(function (buf) {
                return loadSqlJs().then(function (SQL) {
                    var db = new SQL.Database(new Uint8Array(buf));
                    return normalizeLoadedFeatures(parseGpkg(db), normalizer);
                });
            });
    }

    function loadGeoJSON(url, normalizer) {
        return fetch(url)
            .then(function (r) {
                if (r.status === 404) { var e = new Error('404'); e.notFound = true; throw e; }
                if (!r.ok) throw new Error(r.status);
                return r.json();
            })
            .then(function (fc) { return normalizeLoadedFeatures(fc.features || [], normalizer); });
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
        if (p.DATASET === 'S3') {
            p.DATASET_LABEL = getDatasetLabel('S3');
        } else if (p.DATASET === 'MTG_FIR') {
            p.DATASET_LABEL = getDatasetLabel('MTG_FIR');
        } else if (p.acq_date && p.acq_time && p.product) {
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

    function loadS3Nrt() {
        function loadListed(files) {
            if (!files || !files.length) return Promise.resolve([]);
            EV.showLoading('Loading Sentinel-3 NRT hotspots...');
            return Promise.all(files.map(function (file) {
                return loadByFormat(file.url, file.ext || '.fgb', function (feature) {
                    return normalizeFeature(normalizeS3Feature(feature, file.label || file.url));
                })
                    .catch(function (err) {
                        console.warn('[S3] External hotspot load error:', file.url, err);
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

        return fetch(dataBaseUrl + '/fire/s3_manifest.json?v=' + Date.now())
            .then(function (r) {
                if (!r.ok) throw new Error('No Sentinel-3 manifest');
                return r.json();
            })
            .then(function (manifest) {
                var files = (manifest.files || []).map(function (item) {
                    var path = typeof item === 'string' ? item : item.path;
                    var ext = path && path.match(/\.[^.]+$/) ? path.match(/\.[^.]+$/)[0].toLowerCase() : '.fgb';
                    return { url: dataBaseUrl + '/fire/' + path, ext: ext, label: item.label || path };
                }).filter(function (item) { return !!item.url; });
                return loadListed(files);
            })
            .catch(function () {
                return [];
            });
    }

    function loadMtgFirNrt() {
        function loadListed(files) {
            if (!files || !files.length) return Promise.resolve([]);
            EV.showLoading('Loading EUMETSAT MTG-FIR hotspots...');
            return Promise.all(files.map(function (file) {
                return loadByFormat(file.url, file.ext || '.fgb', function (feature) {
                    return normalizeFeature(normalizeMtgFirFeature(feature, file.label || file.url));
                })
                    .catch(function (err) {
                        console.warn('[MTG-FIR] External hotspot load error:', file.url, err);
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

        return fetch(dataBaseUrl + '/fire/mtg_fir_manifest.json?v=' + Date.now())
            .then(function (r) {
                if (!r.ok) throw new Error('No MTG-FIR manifest');
                return r.json();
            })
            .then(function (manifest) {
                var files = (manifest.files || []).map(function (item) {
                    var path = typeof item === 'string' ? item : item.path;
                    var ext = path && path.match(/\.[^.]+$/) ? path.match(/\.[^.]+$/)[0].toLowerCase() : '.fgb';
                    return { url: dataBaseUrl + '/fire/' + path, ext: ext, label: item.label || path };
                }).filter(function (item) { return !!item.url; });
                return loadListed(files);
            })
            .catch(function () {
                return [];
            });
    }

    function loadExternalArchive(dataset, range) {
        if (!range) return Promise.resolve([]);
        var name = dataset === 'FIRMS' ? 'firms' : 's3';
        var key = name + ':' + range.start.toISOString() + '|' + range.end.toISOString();
        if (externalArchiveLoads[key]) return externalArchiveLoads[key];
        externalArchiveLoads[key] = (externalArchiveManifests[name] ? Promise.resolve(externalArchiveManifests[name]) : fetch(dataBaseUrl + '/fire/' + name + '_archive_manifest.json?v=' + Date.now()).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (manifest) { externalArchiveManifests[name] = manifest; return manifest; })).then(function (manifest) {
            var chunks = (manifest.chunks || []).filter(function (chunk) { return new Date(chunk.end) >= range.start && new Date(chunk.start) <= range.end && !loadedExternalArchiveChunks[name + ':' + chunk.key]; });
            if (!chunks.length) return [];
            return Promise.all(chunks.map(function (chunk) {
                var normalizer = dataset === 'S3' ? function (feature) { return normalizeFeature(normalizeS3Feature(feature, chunk.path)); } : normalizeFeature;
                return loadByFormat(dataBaseUrl + '/fire/' + chunk.path, '.fgb', normalizer).then(function (features) { loadedExternalArchiveChunks[name + ':' + chunk.key] = true; mergeFeatures(features); return features; });
            }));
        }).finally(function () { delete externalArchiveLoads[key]; });
        return externalArchiveLoads[key];
    }

    function externalArchiveRangeKey(dataset, range) {
        return dataset + ':' + range.start.toISOString() + '|' + range.end.toISOString();
    }

    function loadNeededExternalArchives(range) {
        var loads = [];
        ['FIRMS', 'S3'].forEach(function (dataset) {
            var visible = dataset === 'FIRMS' ? firmsVisible : s3Visible;
            var readyKey = externalArchiveRangeKey(dataset, range);
            if (!visible || externalArchiveReady[readyKey]) return;
            loads.push(loadExternalArchive(dataset, range).then(function (features) {
                externalArchiveReady[readyKey] = true;
                return features;
            }).catch(function (err) {
                console.warn('[FIRE] ' + dataset + ' archive load failed:', err);
                externalArchiveReady[readyKey] = true;
                return [];
            }));
        });
        return Promise.all(loads);
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

    function archiveRangeKey(range) {
        var activeBtn = document.querySelector('.fire-time-btn.active');
        if (activeBtn) {
            return 'preset:' + activeBtn.getAttribute('data-hours');
        }
        return range.start.toISOString() + '|' + range.end.toISOString();
    }

    function getSfideArchiveLoadKey(range) {
        if (!sfideVisible || !range || yearLoaded) return null;

        var key = archiveRangeKey(range);
        if (archiveLoadInProgressKey === key || archiveLoadFailedKey === key) return null;

        var activeBtn = document.querySelector('.fire-time-btn.active');
        if (activeBtn) {
            var hours = parseInt(activeBtn.getAttribute('data-hours'));
            if (hours > 0 && hours <= 72) return null;
        }

        var latestSfide = getLatestHotspotDateForDataset('SFIDE');
        if (!latestSfide) return null;

        var sfideRecentStart = new Date(latestSfide.getTime() - 72 * 3600000);
        if (range.start >= sfideRecentStart) return null;
        return archiveRangeLoaded(range) ? null : key;
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
                EV.showLoading('Loading fire archive (' + pending.length + ' chunk' + (pending.length !== 1 ? 's' : '') + ')...');
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

    function numberInputValue(id, fallback) {
        var el = document.getElementById(id);
        if (!el) return fallback;
        var value = parseFloat(el.value);
        return isFinite(value) ? value : fallback;
    }

    function textInputValue(id) {
        var el = document.getElementById(id);
        return el ? el.value : '';
    }

    function getCurrentFilterState(range) {
        return {
            range: range,
            activeSats: getCheckedValues('.fire-sat-filter'),
            activeTypes: getCheckedValues('.fire-type-filter').map(Number),
            activeViirsConf: getCheckedValues('.fire-viirs-conf-filter'),
            activeMtgFirResults: getCheckedValues('.fire-mtg-fir-result-filter'),
            viirsConfFilterCount: document.querySelectorAll('.fire-viirs-conf-filter').length,
            mtgFirResultFilterCount: document.querySelectorAll('.fire-mtg-fir-result-filter').length,
            sfideMinConf: numberInputValue('fire-sfide-min-conf', 0),
            firmsModisMinConf: numberInputValue('fire-firms-modis-min-conf', 0),
            s3MinConf: numberInputValue('fire-s3-min-conf', 0),
            mtgFirMinProb: numberInputValue('fire-mtg-fir-min-prob', 0),
            sfideMinFrpStr: textInputValue('fire-sfide-min-frp'),
            firmsMinFrpStr: textInputValue('fire-firms-min-frp'),
            s3MinFrpStr: textInputValue('fire-s3-min-frp')
        };
    }

    function featurePassesFireFilters(feature, state) {
        var p = feature.properties || {};
        var isFirms = isFirmsFeature(p);
        var isS3 = isS3Feature(p);
        var isMtgFir = isMtgFirFeature(p);

        if (!isSourceVisible(p)) return false;

        var d = parseFeatureDate(p);
        if (!d || d < state.range.start || d > state.range.end) return false;

        if (state.activeSats.length > 0 && state.activeSats.indexOf(p.SATELLITE) === -1) return false;

        if (!isFirms && !isS3 && !isMtgFir && (state.activeTypes.length === 0 || state.activeTypes.indexOf(p.TYPE) === -1)) return false;

        if (isFirms && p.VIIRS_CONFIDENCE) {
            if (state.viirsConfFilterCount > 0 && state.activeViirsConf.length === 0) return false;
            if (state.activeViirsConf.length > 0 && state.activeViirsConf.indexOf(p.VIIRS_CONFIDENCE) === -1) return false;
        } else if (isFirms) {
            if ((p.CONFIDENCE || 0) < state.firmsModisMinConf) return false;
        } else if (isS3) {
            if (p.CONFIDENCE != null && (p.CONFIDENCE || 0) < state.s3MinConf) return false;
        } else if (isMtgFir) {
            if (state.mtgFirResultFilterCount > 0 && state.activeMtgFirResults.length === 0) return false;
            if (state.activeMtgFirResults.length > 0 && state.activeMtgFirResults.indexOf(String(p.FIRE_RESULT || '')) === -1) return false;
            if (p.CONFIDENCE != null && (p.CONFIDENCE || 0) < state.mtgFirMinProb) return false;
        } else if ((p.CONFIDENCE || 0) < state.sfideMinConf) {
            return false;
        }

        if (isMtgFir) return true;

        var frp = p.FRP_WOOSTER || 0;
        var minFrpStr = isS3 ? state.s3MinFrpStr : (isFirms ? state.firmsMinFrpStr : state.sfideMinFrpStr);
        if (minFrpStr === '' || minFrpStr === undefined) {
            var defMin = DEFAULT_MIN_FRP[p.SATELLITE] || 0;
            return frp >= defMin;
        }

        var minFrp = parseFloat(minFrpStr);
        return !isFinite(minFrp) || frp >= minFrp;
    }

    function applyFilters() {
        if (!clusterGroup) return;

        var range = getTimeRange();

        // External polar-orbiting archives are fetched only for the requested interval.
        var firmsArchivePending = firmsVisible && !externalArchiveReady[externalArchiveRangeKey('FIRMS', range)];
        var s3ArchivePending = s3Visible && !externalArchiveReady[externalArchiveRangeKey('S3', range)];
        if (firmsArchivePending || s3ArchivePending) {
            loadNeededExternalArchives(range).then(function () { applyFilters(); });
            return;
        }
        // SFIDE archive data is separate from the recent FIRMS/S3 files.
        var archiveKey = getSfideArchiveLoadKey(range);
        if (archiveKey) {
            archiveLoadInProgressKey = archiveKey;
            loadArchive(range).then(function () {
                archiveLoadInProgressKey = null;
                if (!yearLoaded && !archiveRangeLoaded(range)) archiveLoadFailedKey = archiveKey;
                populateSatelliteFilters();
                applyFilters();
            }).catch(function (err) {
                archiveLoadInProgressKey = null;
                archiveLoadFailedKey = archiveKey;
                console.warn('[FIRE] Archive load failed:', err);
                applyFilters();
            });
            return;
        }

        if (!anySourceVisible()) {
            displayFeatures([]);
            var noSourceCountEl = document.getElementById('fire-count');
            if (noSourceCountEl) noSourceCountEl.textContent = '0 hotspots';
            return;
        }

        var state = getCurrentFilterState(range);
        var filtered = allFeatures.filter(function (f) { return featurePassesFireFilters(f, state); });

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
            var color = paletteSample(p.SATELLITE);
            var markerSize = getFRPMarkerSize(p.FRP_WOOSTER);

            var iconHtml =
                '<svg width="' + markerSize + '" height="' + markerSize + '" viewBox="0 0 24 24" style="opacity:0.92;stroke:#fff;stroke-width:1.7;fill:' + color + ';filter:drop-shadow(0 0 2px rgba(255,255,255,0.95)) drop-shadow(0 2px 2px rgba(15,23,42,0.8));">' +
                '<path d="' + typeConf.path + '"/></svg>';

            var icon = L.divIcon({
                html: iconHtml,
                className: 'fire-marker-icon',
                iconSize: [markerSize, markerSize],
                iconAnchor: [markerSize / 2, markerSize / 2]
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
        if (!isFirmsFeature(p) && !isS3Feature(p) && !isMtgFirFeature(p)) html += '<tr><th>Fire Type</th><td>' + typeConf.label + '</td></tr>';
        if (!isMtgFirFeature(p)) html += '<tr><th>FRP</th><td>' + (frp != null ? frp.toFixed(1) + ' MW' : 'N/A') + '</td></tr>';
        var confidenceText = p.CONFIDENCE_RAW != null ? p.CONFIDENCE_RAW : (p.CONFIDENCE != null ? p.CONFIDENCE + '%' : 'N/A');
        if (isMtgFirFeature(p) && p.CONFIDENCE != null) confidenceText = p.CONFIDENCE + '%';
        html += '<tr><th>' + (isMtgFirFeature(p) ? 'Fire Probability' : 'Confidence') + '</th><td>' + confidenceText + '</td></tr>';
        if (isMtgFirFeature(p)) html += '<tr><th>Fire Result</th><td>' + (p.FIRE_RESULT != null ? p.FIRE_RESULT : 'N/A') + '</td></tr>';
        if (p.PRODUCT) html += '<tr><th>Product</th><td>' + p.PRODUCT + '</td></tr>';
        html += '<tr><th>Instrument</th><td>' + (p.INSTRUMENT || 'N/A') + '</td></tr>';
        if (!isMtgFirFeature(p)) html += '<tr><th>Day/Night</th><td>' + (p.DAYNIGHT || 'N/A') + '</td></tr>';
        if (!isMtgFirFeature(p)) html += '<tr><th>Bright MIR</th><td>' + (p.BRIGHT_MIR != null ? p.BRIGHT_MIR.toFixed(1) + ' K' : 'N/A') + '</td></tr>';
        if (!isMtgFirFeature(p)) html += '<tr><th>Bright TIR</th><td>' + (p.BRIGHT_TIR != null ? p.BRIGHT_TIR.toFixed(1) + ' K' : 'N/A') + '</td></tr>';
        if (isMtgFirFeature(p)) html += '<tr><th>Completeness</th><td>' + (p.PROD_COMPLETE != null ? p.PROD_COMPLETE + '%' : 'N/A') + '</td></tr>';
        if (isMtgFirFeature(p)) html += '<tr><th>Timeliness</th><td>' + (p.PROD_TIMELY != null ? p.PROD_TIMELY + '%' : 'N/A') + '</td></tr>';
        html += '<tr><th>Lat, Lon</th><td>' + p.LATITUDE.toFixed(4) + ', ' + p.LONGITUDE.toFixed(4) + '</td></tr>';
        html += '</table>';
        if (!isMtgFirFeature(p)) html += '<div style="text-align:center;margin-top:6px;">' +
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
            if (p.FRP_WOOSTER == null) return null;
            return { date: d, value: p.FRP_WOOSTER || 0, sat: p.SATELLITE };
        }).filter(function (s) { return s && s.date !== null; })
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
        var s3Container = document.getElementById('fire-s3-sat-list');
        var mtgFirContainer = document.getElementById('fire-mtg-fir-sat-list');
        var fallbackContainer = document.getElementById('fire-sat-list');
        if (!sfideContainer && !firmsContainer && !s3Container && !mtgFirContainer && !fallbackContainer) return;
        if (sfideContainer) sfideContainer.innerHTML = '';
        if (firmsContainer) firmsContainer.innerHTML = '';
        if (s3Container) s3Container.innerHTML = '';
        if (mtgFirContainer) mtgFirContainer.innerHTML = '';
        if (fallbackContainer) fallbackContainer.innerHTML = '';

        var sats = {};
        for (var i = 0; i < allFeatures.length; i++) {
            sats[allFeatures[i].properties.SATELLITE] = true;
        }
        var sorted = Object.keys(sats).sort();

        sorted.forEach(function (sat) {
            var target = sat.indexOf('FIRMS-') === 0 ? firmsContainer :
                         (sat === 'S3A' || sat === 'S3B' ? s3Container :
                         (sat === 'MTG-FIR' ? mtgFirContainer : sfideContainer));
            if (!target) target = fallbackContainer;
            if (!target) return;
            var div = document.createElement('label');
            div.className = 'toolbar-pill';
            var selected = pendingSharedSatellites !== null ?
                pendingSharedSatellites.indexOf(sat) !== -1 : isDefaultSatelliteSelected(sat, sorted);
            var checked = selected ? ' checked' : '';
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

    function getSourceVisible(source) {
        if (source === 'FIRMS') return firmsVisible;
        if (source === 'S3') return s3Visible;
        if (source === 'MTG_FIR') return mtgFirVisible;
        return sfideVisible;
    }

    function sourceLayerId(source) {
        if (source === 'FIRMS') return 'firms-fire';
        if (source === 'S3') return 's3-fire';
        if (source === 'MTG_FIR') return 'mtg-fir-fire';
        return 'sfide-fire';
    }

    function syncSidebarLayerToggle(source, visible) {
        var cb = document.querySelector('.layer-toggle input[data-layer-id="' + sourceLayerId(source) + '"]');
        if (cb) cb.checked = visible;
    }

    function firstVisibleSource() {
        var order = ['SFIDE', 'FIRMS', 'S3', 'MTG_FIR'];
        for (var i = 0; i < order.length; i++) {
            if (getSourceVisible(order[i])) return order[i];
        }
        return 'SFIDE';
    }

    function selectFireSourceTab(source) {
        activeFireSourceTab = source || firstVisibleSource();
        updateFireControlVisibility();
    }

    function updateSourceTabState() {
        document.querySelectorAll('.fire-source-tab').forEach(function (tab) {
            var source = tab.getAttribute('data-source');
            var visible = getSourceVisible(source);
            var active = source === activeFireSourceTab;
            tab.classList.toggle('active', active);
            tab.classList.toggle('off', !visible);
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
            tab.setAttribute('aria-pressed', visible ? 'true' : 'false');
            var cb = tab.querySelector('.fire-source-toggle');
            if (cb) cb.checked = visible;
        });
    }

    function buildControls(map) {
        var container = document.getElementById('product-toolbar-content') || document.getElementById('layer-controls');
        var section = document.createElement('div');
        section.id = 'fire-controls';
        section.className = 'product-toolbar-section fire-toolbar-window fire-toolbar-unified';
        section.innerHTML =
            '<div class="fire-toolbar-topline">' +
            '  <div class="product-toolbar-title">Active Fire Window</div>' +
            '  <div class="toolbar-divider"></div>' +
            '  <div class="product-toolbar-group">' +
            '    <span class="product-toolbar-label">Time</span>' +
            '    <div class="toolbar-pill-list">' +
            '      <button class="fire-time-btn toolbar-btn-compact active" data-hours="6">6h</button>' +
            '      <button class="fire-time-btn toolbar-btn-compact" data-hours="12">12h</button>' +
            '      <button class="fire-time-btn toolbar-btn-compact" data-hours="24">24h</button>' +
            '      <button class="fire-time-btn toolbar-btn-compact" data-hours="72">72h</button>' +
            '      <button class="fire-time-btn toolbar-btn-compact" data-hours="168">7d</button>' +
            '      <button class="fire-time-btn toolbar-btn-compact" data-hours="0">All</button>' +
            '    </div>' +
            '  </div>' +
            '  <div class="product-toolbar-group">' +
            '    <span class="product-toolbar-label">Range</span>' +
            '    <span class="toolbar-field"><input type="text" id="fire-start-time" placeholder="dd/mm/yyyy hh:mm"></span>' +
            '    <span class="toolbar-field"><input type="text" id="fire-end-time" placeholder="dd/mm/yyyy hh:mm"></span>' +
            '    <button id="fire-apply-custom" class="toolbar-btn-compact">Apply</button>' +
            '  </div>' +
            '  <div class="toolbar-status"><span id="fire-count">-</span><br><span id="fire-last-update">Loading...</span></div>' +
            '</div>' +
            '<div class="fire-source-tabs" role="tablist" aria-label="Hotspot source filters">' +
            '  <div class="fire-source-tab active" data-source="SFIDE" role="tab" tabindex="0"><input type="checkbox" class="fire-source-toggle" data-source="SFIDE" checked><span class="fire-source-dot sfide"></span><span>SFIDE</span></div>' +
            '  <div class="fire-source-tab" data-source="FIRMS" role="tab" tabindex="0"><input type="checkbox" class="fire-source-toggle" data-source="FIRMS"><span class="fire-source-dot firms"></span><span>NASA FIRMS</span><small>external</small></div>' +
            '  <div class="fire-source-tab" data-source="S3" role="tab" tabindex="0"><input type="checkbox" class="fire-source-toggle" data-source="S3"><span class="fire-source-dot s3"></span><span>Sentinel-3</span><small>external</small></div>' +
            '  <div class="fire-source-tab" data-source="MTG_FIR" role="tab" tabindex="0"><input type="checkbox" class="fire-source-toggle" data-source="MTG_FIR"><span class="fire-source-dot mtg-fir"></span><span>MTG-FIR</span><small>EUMETSAT</small></div>' +
            '</div>' +
            '<div id="fire-source-panels" class="fire-source-panels"></div>';

        container.appendChild(section);
        var panelWrap = section.querySelector('#fire-source-panels');

        var sfideSection = document.createElement('div');
        sfideSection.id = 'fire-sfide-controls';
        sfideSection.className = 'fire-source-panel fire-source-toolbar fire-source-toolbar-sfide';
        sfideSection.innerHTML =
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
            '  <span class="toolbar-field"><span class="product-toolbar-label">FRP</span><input type="number" id="fire-sfide-min-frp" min="0" step="0.1" value="20" title="Minimum SFIDE FRP (MW)"></span>' +
            '</div>';
        panelWrap.appendChild(sfideSection);

        var firmsSection = document.createElement('div');
        firmsSection.id = 'fire-firms-controls';
        firmsSection.className = 'fire-source-panel fire-source-toolbar fire-source-toolbar-firms hidden';
        firmsSection.innerHTML =
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
        panelWrap.appendChild(firmsSection);

        var s3Section = document.createElement('div');
        s3Section.id = 'fire-s3-controls';
        s3Section.className = 'fire-source-panel fire-source-toolbar fire-source-toolbar-s3 hidden';
        s3Section.innerHTML =
            '<div class="product-toolbar-group">' +
            '  <span class="product-toolbar-label">Satellites</span>' +
            '  <div id="fire-s3-sat-list" class="toolbar-pill-list"><span class="toolbar-status">Loading...</span></div>' +
            '</div>' +
            '<div class="product-toolbar-group">' +
            '  <span class="toolbar-field"><span class="product-toolbar-label">Min conf</span><input type="number" id="fire-s3-min-conf" min="0" max="100" value="0" title="Minimum Sentinel-3 confidence, when available"></span>' +
            '  <span class="toolbar-field"><span class="product-toolbar-label">FRP</span><input type="number" id="fire-s3-min-frp" min="0" step="0.1" value="0" title="Minimum Sentinel-3 FRP (MW)"></span>' +
            '</div>';
        panelWrap.appendChild(s3Section);

        var mtgFirSection = document.createElement('div');
        mtgFirSection.id = 'fire-mtg-fir-controls';
        mtgFirSection.className = 'fire-source-panel fire-source-toolbar fire-source-toolbar-mtg-fir hidden';
        mtgFirSection.innerHTML =
            '<div class="product-toolbar-group">' +
            '  <span class="product-toolbar-label">Satellites</span>' +
            '  <div id="fire-mtg-fir-sat-list" class="toolbar-pill-list"><span class="toolbar-status">Loading...</span></div>' +
            '</div>' +
            '<div class="product-toolbar-group">' +
            '  <span class="product-toolbar-label">Result</span>' +
            '  <div class="toolbar-pill-list">' +
            '    <label class="toolbar-pill"><input type="checkbox" value="1" class="fire-mtg-fir-result-filter" checked><span>1</span></label>' +
            '    <label class="toolbar-pill"><input type="checkbox" value="2" class="fire-mtg-fir-result-filter" checked><span>2</span></label>' +
            '    <label class="toolbar-pill"><input type="checkbox" value="3" class="fire-mtg-fir-result-filter" checked><span>3</span></label>' +
            '  </div>' +
            '</div>' +
            '<div class="product-toolbar-group">' +
            '  <span class="toolbar-field"><span class="product-toolbar-label">Min prob</span><input type="number" id="fire-mtg-fir-min-prob" min="0" max="100" value="0" title="Minimum MTG-FIR fire probability (%)"></span>' +
            '</div>';
        panelWrap.appendChild(mtgFirSection);

        EV.updateProductToolbarVisibility();
        setDefaultCustomRange();

        section.querySelectorAll('.fire-source-tab').forEach(function (tab) {
            tab.addEventListener('click', function (e) {
                var source = tab.getAttribute('data-source');
                if (e.target && e.target.classList.contains('fire-source-toggle')) return;
                selectFireSourceTab(source);
            });
            tab.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectFireSourceTab(tab.getAttribute('data-source'));
                }
            });
        });
        section.querySelectorAll('.fire-source-toggle').forEach(function (cb) {
            cb.addEventListener('click', function (e) { e.stopPropagation(); });
            cb.addEventListener('change', function () {
                var source = cb.getAttribute('data-source');
                setSourceVisible(source, cb.checked, map);
            });
        });

        section.querySelectorAll('.fire-time-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                section.querySelectorAll('.fire-time-btn').forEach(function (b) {
                    b.classList.remove('active', 'bg-blue-100', 'text-blue-700');
                    b.classList.add('bg-gray-100', 'text-gray-700');
                });
                btn.classList.add('active', 'bg-blue-100', 'text-blue-700');
                btn.classList.remove('bg-gray-100', 'text-gray-700');
                applyFilters();
            });
        });

        document.getElementById('fire-apply-custom').addEventListener('click', function () {
            section.querySelectorAll('.fire-time-btn').forEach(function (b) {
                b.classList.remove('active', 'bg-blue-100', 'text-blue-700');
                b.classList.add('bg-gray-100', 'text-gray-700');
            });
            applyFilters();
        });

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

        document.getElementById('fire-sfide-min-conf').addEventListener('change', applyFilters);
        document.getElementById('fire-sfide-min-frp').addEventListener('change', applyFilters);
        document.getElementById('fire-firms-modis-min-conf').addEventListener('change', applyFilters);
        document.getElementById('fire-firms-min-frp').addEventListener('change', applyFilters);
        document.getElementById('fire-s3-min-conf').addEventListener('change', applyFilters);
        document.getElementById('fire-s3-min-frp').addEventListener('change', applyFilters);
        document.getElementById('fire-mtg-fir-min-prob').addEventListener('change', applyFilters);
        firmsSection.querySelectorAll('.fire-viirs-conf-filter').forEach(function (cb) {
            cb.addEventListener('change', applyFilters);
        });
        mtgFirSection.querySelectorAll('.fire-mtg-fir-result-filter').forEach(function (cb) {
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
        return { start: new Date(now.getTime() - 6 * 3600000), end: now };
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
        var start = new Date(end.getTime() - 6 * 3600000);
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
            if (sat.indexOf('FIRMS-') === 0) return firmsVisible;
            if (sat === 'S3A' || sat === 'S3B') return s3Visible;
            if (sat === 'MTG-FIR') return mtgFirVisible;
            return sfideVisible;
        });
        if (!activeSats.length) {
            var visibleSats = {};
            allFeatures.forEach(function (f) {
                var p = f.properties || {};
                if (isSourceVisible(p) && p.SATELLITE) visibleSats[p.SATELLITE] = true;
            });
            activeSats = Object.keys(visibleSats).sort();
        }

        var satelliteRows = activeSats.map(function (sat) {
            return '<span class="fire-legend-item"><i class="fire-legend-satellite" style="background:' +
                   paletteSample(sat) + '"></i>' + sat + '</span>';
        }).join('');
        var fireTypeSection = sfideVisible ?
            '<div class="fire-legend-section"><h4>Fire type</h4>' +
            '<span class="fire-legend-shape fire-legend-circle">Vegetation</span>' +
            '<span class="fire-legend-shape fire-legend-triangle">Volcano</span>' +
            '<span class="fire-legend-shape fire-legend-square">Static source</span>' +
            '<span class="fire-legend-shape fire-legend-diamond">Offshore</span></div>' : '';

        div.innerHTML =
            '<div class="fire-legend-section"><h4>Satellite</h4>' + satelliteRows + '</div>' +
            fireTypeSection +
            '<div class="fire-legend-section"><h4>FRP [MW]</h4>' +
            '<div class="fire-legend-sizes">' +
            '<span><i style="width:12px;height:12px"></i>&lt;20</span>' +
            '<span><i style="width:16px;height:16px"></i>20-100</span>' +
            '<span><i style="width:21px;height:21px"></i>100-500</span>' +
            '<span><i style="width:28px;height:28px"></i>&ge;500</span>' +
            '</div></div>';
    }
    /* ── Visibility ────────────────────────────────────────────── */

    function updateFireControlVisibility() {
        var common = document.getElementById('fire-controls');
        var panels = {
            SFIDE: document.getElementById('fire-sfide-controls'),
            FIRMS: document.getElementById('fire-firms-controls'),
            S3: document.getElementById('fire-s3-controls'),
            MTG_FIR: document.getElementById('fire-mtg-fir-controls')
        };
        var leg  = document.getElementById('fire-legend');
        if (common) common.classList.remove('hidden');
        Object.keys(panels).forEach(function (source) {
            if (panels[source]) {
                panels[source].classList.toggle('hidden', source !== activeFireSourceTab);
            }
        });
        updateSourceTabState();
        if (leg) leg.style.display = anySourceVisible() ? '' : 'none';
        EV.updateProductToolbarVisibility();
    }

    function setSourceVisible(source, v, map) {
        if (source === 'FIRMS') {
            firmsVisible = v;
        } else if (source === 'S3') {
            s3Visible = v;
        } else if (source === 'MTG_FIR') {
            mtgFirVisible = v;
        } else {
            sfideVisible = v;
        }

        if (v) activeFireSourceTab = source;
        syncSidebarLayerToggle(source, v);

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
        var state = getCurrentFilterState(range);

        if (!anySourceVisible()) return [];

        var filtered = inside.filter(function (f) { return featurePassesFireFilters(f, state); });

        var animationPoints = filtered.map(function (f) {
            var p = f.properties || {};
            var date = parseFeatureDate(p);
            if (!date) return null;
            var typeConf = FIRE_TYPE_CONFIG[p.TYPE] || FIRE_TYPE_CONFIG[0];
            return {
                time: date.getTime(),
                latitude: p.LATITUDE,
                longitude: p.LONGITUDE,
                satellite: p.SATELLITE || 'Unknown',
                satelliteLabel: getSatelliteLabel(p.SATELLITE || 'Unknown'),
                color: paletteSample(p.SATELLITE || 'Unknown'),
                typePath: typeConf.path,
                fireType: Number(p.TYPE) || 0,
                fireTypeLabel: typeConf.label,
                hasFireClass: !isFirmsFeature(p) && !isS3Feature(p) && !isMtgFirFeature(p),
                frp: p.FRP_WOOSTER != null ? p.FRP_WOOSTER : null
            };
        }).filter(function (point) { return point !== null; })
          .sort(function (a, b) { return a.time - b.time; });

        var byTime = {};
        var bySatellite = {};
        var satelliteDatasets = {};
        var satelliteTotals = {};
        var tableRows = filtered.map(function (f) {
            var p = f.properties || {};
            var date = parseFeatureDate(p);
            var typeConf = FIRE_TYPE_CONFIG[p.TYPE] || FIRE_TYPE_CONFIG[0];
            return {
                _sortTime: date ? date.getTime() : 0,
                datetime: date ? formatUTC(date) : '',
                source: p.DATASET_LABEL || getDatasetLabel(p.DATASET || 'SFIDE'),
                satellite: p.SATELLITE || '',
                sensor: p.INSTRUMENT || SATELLITE_PRODUCTS[p.SATELLITE] || p.PRODUCT || '',
                product: p.PRODUCT || SATELLITE_PRODUCTS[p.SATELLITE] || '',
                fireType: (isFirmsFeature(p) || isS3Feature(p) || isMtgFirFeature(p)) ? '' : typeConf.label,
                frp: p.FRP_WOOSTER != null ? Math.round(p.FRP_WOOSTER * 10) / 10 : '',
                confidence: p.CONFIDENCE_RAW != null ? p.CONFIDENCE_RAW : (p.CONFIDENCE != null ? p.CONFIDENCE : ''),
                fireResult: p.FIRE_RESULT != null ? p.FIRE_RESULT : '',
                brightMir: p.BRIGHT_MIR != null ? Math.round(p.BRIGHT_MIR * 10) / 10 : '',
                brightTir: p.BRIGHT_TIR != null ? Math.round(p.BRIGHT_TIR * 10) / 10 : '',
                dayNight: p.DAYNIGHT || '',
                latitude: p.LATITUDE != null ? Number(p.LATITUDE).toFixed(5) : '',
                longitude: p.LONGITUDE != null ? Number(p.LONGITUDE).toFixed(5) : '',
                sourceFile: p.SOURCE_FILE || ''
            };
        }).sort(function (a, b) {
            return a._sortTime - b._sortTime;
        });
        filtered.forEach(function (f) {
            var p = f.properties;
            var date = parseFeatureDate(p);
            if (!date) return;
            if (p.FRP_WOOSTER == null) return;
            var key = date.toISOString().substring(0, 16);
            var sat = p.SATELLITE || 'Unknown';
            var dataset = p.DATASET || 'SFIDE';
            var frp = p.FRP_WOOSTER || 0;
            if (!byTime[key]) byTime[key] = { date: date, value: 0, detections: 0 };
            byTime[key].value += frp;
            byTime[key].detections += 1;
            if (!bySatellite[sat]) bySatellite[sat] = {};
            if (!bySatellite[sat][key]) bySatellite[sat][key] = { value: 0, detections: 0 };
            bySatellite[sat][key].value += frp;
            bySatellite[sat][key].detections += 1;
            satelliteDatasets[sat] = dataset;
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

        var satellites = Object.keys(bySatellite).sort();
        series.datasets = satellites.map(function (sat) {
            var color = paletteSample(sat);
            var satKeys = Object.keys(bySatellite[sat]).sort();
            var isPolar = isPolarTimeseriesSource(satelliteDatasets[sat]);
            var points = satKeys.map(function (key) {
                var item = bySatellite[sat][key];
                return {
                    x: new Date(key + ':00Z'),
                    y: Math.round(item.value * 10) / 10
                };
            });
            if (isPolar) {
                return {
                    type: 'scatter',
                    label: getSatelliteLabel(sat),
                    data: points,
                    borderColor: color,
                    backgroundColor: color,
                    fill: false,
                    showLine: false,
                    pointStyle: 'circle',
                    pointRadius: 6,
                    pointHoverRadius: 9,
                    pointBackgroundColor: color,
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2,
                    borderWidth: 0
                };
            }
            return {
                label: getSatelliteLabel(sat),
                data: points,
                borderColor: color,
                backgroundColor: color.replace('rgb', 'rgba').replace(')', ',0.16)'),
                fill: false,
                tension: 0.24,
                pointRadius: 3.5,
                pointHoverRadius: 7,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: color,
                pointBorderWidth: 2,
                borderWidth: 2.75,
                spanGaps: true
            };
        });
        series.satelliteDetections = satelliteTotals;
        series.tableRows = tableRows;
        series.tableColumns = [
            { key: 'datetime', label: 'Datetime', defaultVisible: true },
            { key: 'satellite', label: 'Satellite', defaultVisible: true },
            { key: 'sensor', label: 'Sensor', defaultVisible: true },
            { key: 'frp', label: 'FRP [MW]', defaultVisible: true },
            { key: 'source', label: 'Source', defaultVisible: false },
            { key: 'product', label: 'Product', defaultVisible: false },
            { key: 'fireType', label: 'Fire Type', defaultVisible: false },
            { key: 'confidence', label: 'Confidence', defaultVisible: false },
            { key: 'fireResult', label: 'MTG-FIR Result', defaultVisible: false },
            { key: 'brightMir', label: 'Bright MIR [K]', defaultVisible: false },
            { key: 'brightTir', label: 'Bright TIR [K]', defaultVisible: false },
            { key: 'dayNight', label: 'Day/Night', defaultVisible: false },
            { key: 'latitude', label: 'Latitude', defaultVisible: false },
            { key: 'longitude', label: 'Longitude', defaultVisible: false },
            { key: 'sourceFile', label: 'Source File', defaultVisible: false }
        ];
        series.animation = {
            points: animationPoints,
            start: range.start.getTime(),
            end: range.end.getTime(),
            bounds: {
                south: sw.lat,
                west: sw.lng,
                north: ne.lat,
                east: ne.lng
            }
        };
        return series;
    }

    /* Shareable viewer state */

    function csvValues(selector) {
        return getCheckedValues(selector).join(',');
    }

    function setCheckedValues(selector, csv) {
        if (csv === null || csv === undefined) return;
        var values = String(csv).split(',').filter(Boolean);
        document.querySelectorAll(selector).forEach(function (cb) {
            cb.checked = values.indexOf(cb.value) !== -1;
        });
    }

    function setInputFromParam(params, param, id) {
        if (!params.has(param)) return;
        var input = document.getElementById(id);
        if (input) input.value = params.get(param);
    }

    function getShareParams() {
        var result = {};
        var activeTime = document.querySelector('.fire-time-btn.active');
        if (activeTime) {
            result.fh = activeTime.getAttribute('data-hours');
        } else {
            var range = getTimeRange();
            result.fstart = range.start.toISOString();
            result.fend = range.end.toISOString();
        }
        result.src = ['SFIDE', 'FIRMS', 'S3', 'MTG_FIR'].filter(getSourceVisible).join(',');
        result.ftab = activeFireSourceTab;
        result.sat = csvValues('.fire-sat-filter');
        result.type = csvValues('.fire-type-filter');
        result.viirs = csvValues('.fire-viirs-conf-filter');
        result.mtgr = csvValues('.fire-mtg-fir-result-filter');
        result.sfconf = textInputValue('fire-sfide-min-conf');
        result.sffrp = textInputValue('fire-sfide-min-frp');
        result.fmconf = textInputValue('fire-firms-modis-min-conf');
        result.fmfrp = textInputValue('fire-firms-min-frp');
        result.s3conf = textInputValue('fire-s3-min-conf');
        result.s3frp = textInputValue('fire-s3-min-frp');
        result.mtgprob = textInputValue('fire-mtg-fir-min-prob');
        return result;
    }

    function applyShareParams(params) {
        if (!params || !params.has('src')) return;

        var allowedSources = ['SFIDE', 'FIRMS', 'S3', 'MTG_FIR'];
        var sources = String(params.get('src') || '').split(',').filter(function (source) {
            return allowedSources.indexOf(source) !== -1;
        });
        sfideVisible = sources.indexOf('SFIDE') !== -1;
        firmsVisible = sources.indexOf('FIRMS') !== -1;
        s3Visible = sources.indexOf('S3') !== -1;
        mtgFirVisible = sources.indexOf('MTG_FIR') !== -1;
        allowedSources.forEach(function (source) {
            syncSidebarLayerToggle(source, getSourceVisible(source));
        });

        var requestedTab = params.get('ftab');
        activeFireSourceTab = allowedSources.indexOf(requestedTab) !== -1 ? requestedTab : firstVisibleSource();

        var timeButtons = document.querySelectorAll('.fire-time-btn');
        timeButtons.forEach(function (button) {
            button.classList.remove('active', 'bg-blue-100', 'text-blue-700');
            button.classList.add('bg-gray-100', 'text-gray-700');
        });
        if (params.has('fh')) {
            var preset = document.querySelector('.fire-time-btn[data-hours="' + params.get('fh') + '"]');
            if (preset) {
                preset.classList.add('active', 'bg-blue-100', 'text-blue-700');
                preset.classList.remove('bg-gray-100', 'text-gray-700');
            }
        } else if (params.has('fstart') && params.has('fend')) {
            var start = new Date(params.get('fstart'));
            var end = new Date(params.get('fend'));
            if (isFinite(start.getTime()) && isFinite(end.getTime()) && start < end) {
                document.getElementById('fire-start-time').value = formatEuropeanDateTime(start);
                document.getElementById('fire-end-time').value = formatEuropeanDateTime(end);
            }
        }

        setInputFromParam(params, 'sfconf', 'fire-sfide-min-conf');
        setInputFromParam(params, 'sffrp', 'fire-sfide-min-frp');
        setInputFromParam(params, 'fmconf', 'fire-firms-modis-min-conf');
        setInputFromParam(params, 'fmfrp', 'fire-firms-min-frp');
        setInputFromParam(params, 's3conf', 'fire-s3-min-conf');
        setInputFromParam(params, 's3frp', 'fire-s3-min-frp');
        setInputFromParam(params, 'mtgprob', 'fire-mtg-fir-min-prob');
        setCheckedValues('.fire-type-filter', params.has('type') ? params.get('type') : null);
        setCheckedValues('.fire-viirs-conf-filter', params.has('viirs') ? params.get('viirs') : null);
        setCheckedValues('.fire-mtg-fir-result-filter', params.has('mtgr') ? params.get('mtgr') : null);

        if (params.has('sat')) {
            pendingSharedSatellites = String(params.get('sat') || '').split(',').filter(Boolean);
            setCheckedValues('.fire-sat-filter', params.get('sat'));
        }

        var targetMap = mapRef;
        if (clusterGroup && targetMap) {
            if (anySourceVisible()) clusterGroup.addTo(targetMap);
            else targetMap.removeLayer(clusterGroup);
        }
        updateFireControlVisibility();
        updateDatabaseLastUpdate();
        applyFilters();
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
                return loadS3Nrt();
            }).then(function () {
                return loadMtgFirNrt();
            }).then(function () {
                // If archive was loaded because recent data was empty, keep the default 6h view.
                if (yearLoaded) {
                    var btns = document.querySelectorAll('.fire-time-btn');
                    btns.forEach(function (b) {
                        b.classList.remove('active', 'bg-blue-100', 'text-blue-700');
                        b.classList.add('bg-gray-100', 'text-gray-700');
                    });
                    var dayBtn = document.querySelector('.fire-time-btn[data-hours="6"]');
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
        getShareParams: getShareParams,
        applyShareParams: applyShareParams,
        setAnimationMode: function (active) {
            if (!clusterGroup || !mapRef) return;
            if (active) {
                if (mapRef.hasLayer(clusterGroup)) mapRef.removeLayer(clusterGroup);
            } else {
                if (anySourceVisible() && !mapRef.hasLayer(clusterGroup)) clusterGroup.addTo(mapRef);
                applyFilters();
            }
        },
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

    EV.s3Hotspots = {
        id: 's3-fire',
        name: 'Sentinel-3 Hotspots',
        type: 'point',
        defaultVisible: false,
        setVisible: function (v, map) {
            setSourceVisible('S3', v, map);
        }
    };

    EV.mtgFirHotspots = {
        id: 'mtg-fir-fire',
        name: 'MTG-FIR Hotspots',
        type: 'point',
        defaultVisible: false,
        setVisible: function (v, map) {
            setSourceVisible('MTG_FIR', v, map);
        }
    };

})();
