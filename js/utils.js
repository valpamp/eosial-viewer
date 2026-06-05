/**
 * EOSIAL Viewer — shared utilities
 */
var EV = window.EV || {};
window.EV = EV;

/* ── Loading indicator ─────────────────────────────────────────── */
EV.showLoading = function (msg) {
    var el = document.getElementById('loading-indicator');
    document.getElementById('loading-text').textContent = msg || 'Loading...';
    el.classList.remove('hidden');
};

EV.hideLoading = function () {
    document.getElementById('loading-indicator').classList.add('hidden');
};

EV.updateProductToolbarVisibility = function () {
    var toolbar = document.getElementById('product-toolbar');
    if (!toolbar) return;
    var sections = toolbar.querySelectorAll('.product-toolbar-section');
    var anyVisible = false;
    for (var i = 0; i < sections.length; i++) {
        if (!sections[i].classList.contains('hidden')) {
            anyVisible = true;
            break;
        }
    }
    toolbar.classList.toggle('hidden', !anyVisible);
};

/* ── LFMC colormaps ───────────────────────────────────────────── */

EV.LFMC_COLORMAPS = {
    'fire_status': {
        label: 'Fire-spread status',
        stops: [
            [0,   [ 84,  28,  12]],
            [30,  [127,  39,   4]],
            [50,  [217,  95,  14]],
            [80,  [254, 196,  79]],
            [100, [217, 240, 163]],
            [120, [120, 198, 121]],
            [150, [ 35, 132,  67]],
            [400, [ 35, 132,  67]]
        ]
    },
    'rao': {
        label: 'Legacy GreenVeg',
        stops: [
            [0,   [115, 44,  2]],
            [40,  [184, 82, 18]],
            [60,  [227,145, 49]],
            [80,  [237,195, 83]],
            [100, [255,255,190]],
            [120, [186,228,140]],
            [140, [105,189, 69]],
            [160, [ 40,150, 40]],
            [400, [  0, 97, 18]]
        ]
    },
    'rdylbu': {
        label: 'Legacy Red-Yellow-Blue',
        stops: [
            [0,   [165,  0, 38]],
            [40,  [215, 48, 39]],
            [60,  [244,109, 67]],
            [80,  [253,174, 97]],
            [100, [255,255,191]],
            [120, [171,217,233]],
            [140, [116,173,209]],
            [160, [ 69,117,180]],
            [400, [ 49, 54,149]]
        ]
    },
    'turbo': {
        label: 'Legacy Turbo',
        stops: [
            [0,   [ 48,  18, 59]],
            [30,  [ 70, 108,205]],
            [60,  [ 32,186,175]],
            [90,  [121,209, 81]],
            [120, [219,210, 56]],
            [150, [250,142, 35]],
            [180, [219, 58, 27]],
            [400, [122,  4,  3]]
        ]
    },
    'viridis': {
        label: 'Legacy Viridis',
        stops: [
            [0,   [ 68,  1, 84]],
            [30,  [ 72, 36,117]],
            [60,  [ 56, 88,140]],
            [90,  [ 39,126,142]],
            [120, [ 31,161,135]],
            [150, [ 74,194,109]],
            [180, [159,218, 58]],
            [400, [253,231, 37]]
        ]
    }
};

EV.LFMC_RANGES = {
    'shrub_tree': {
        label: 'Shrub/Tree (30-250%)',
        min: 30,
        max: 250,
        ticks: [30, 50, 80, 100, 120, 150, 250]
    },
    'grass': {
        label: 'Grass (0-400%)',
        min: 0,
        max: 400,
        ticks: [0, 30, 50, 80, 100, 120, 150, 400]
    }
};

EV.lfmcColormap = 'fire_status';
EV.lfmcRange = 'shrub_tree';
EV.LFMC_STOPS = EV.LFMC_COLORMAPS[EV.lfmcColormap].stops;

EV.setLfmcColormap = function (name) {
    if (!EV.LFMC_COLORMAPS[name]) return;
    EV.lfmcColormap = name;
    EV.LFMC_STOPS = EV.LFMC_COLORMAPS[name].stops;
    EV.emit('lfmc:colormapChanged', { colormap: name });
};

EV.setLfmcRange = function (name) {
    if (!EV.LFMC_RANGES[name]) return;
    EV.lfmcRange = name;
    EV.emit('lfmc:rangeChanged', { range: name });
};

EV.getLfmcRange = function () {
    return EV.LFMC_RANGES[EV.lfmcRange] || EV.LFMC_RANGES.shrub_tree;
};

EV._lfmcColorAt = function (val, stops) {
    stops = stops || EV.LFMC_STOPS;
    if (val <= stops[0][0]) return stops[0][1];
    if (val >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
    for (var i = 1; i < stops.length; i++) {
        if (val <= stops[i][0]) {
            var t = (val - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
            var a = stops[i - 1][1], b = stops[i][1];
            return [
                Math.round(a[0] + t * (b[0] - a[0])),
                Math.round(a[1] + t * (b[1] - a[1])),
                Math.round(a[2] + t * (b[2] - a[2]))
            ];
        }
    }
    return stops[stops.length - 1][1];
};

EV.lfmcColor = function (val, nodata) {
    if (val === nodata || val < 0 || isNaN(val)) return [0, 0, 0, 0];
    return EV._lfmcColorAt(val, EV.LFMC_STOPS).concat([255]);
};

EV.lfmcGradientCSS = function () {
    var parts = [];
    var stops = EV.LFMC_STOPS;
    var range = EV.getLfmcRange();
    var lo = range.min, hi = range.max;
    var values = [lo, hi];
    for (var i = 0; i < stops.length; i++) {
        if (stops[i][0] > lo && stops[i][0] < hi) values.push(stops[i][0]);
    }
    values.sort(function (a, b) { return a - b; });
    values = values.filter(function (v, idx) { return idx === 0 || v !== values[idx - 1]; });
    for (var j = 0; j < values.length; j++) {
        var pct = ((values[j] - lo) / (hi - lo) * 100).toFixed(1);
        var c = EV._lfmcColorAt(values[j], stops);
        parts.push('rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ') ' + pct + '%');
    }
    return 'linear-gradient(to right, ' + parts.join(', ') + ')';
};

EV.lfmcLegendTicks = function () {
    return EV.getLfmcRange().ticks || [];
};

/* ── Simple pub/sub ────────────────────────────────────────────── */
EV._events = {};
EV.on = function (name, fn) {
    (EV._events[name] = EV._events[name] || []).push(fn);
};
EV.emit = function (name, data) {
    (EV._events[name] || []).forEach(function (fn) { fn(data); });
};

/* ── Debounce helper ───────────────────────────────────────────── */
EV.debounce = function (fn, ms) {
    var timer;
    return function () {
        var args = arguments, ctx = this;
        clearTimeout(timer);
        timer = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
};
