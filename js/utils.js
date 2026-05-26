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
    'rao': {
        label: 'GreenVeg',
        stops: [
            [0,   [115, 44,  2]],
            [40,  [184, 82, 18]],
            [60,  [227,145, 49]],
            [80,  [237,195, 83]],
            [100, [255,255,190]],
            [120, [186,228,140]],
            [140, [105,189, 69]],
            [160, [ 40,150, 40]],
            [200, [  0, 97, 18]],
        ]
    },
    'rdylbu': {
        label: 'Red–Yellow–Blue',
        stops: [
            [0,   [165,  0, 38]],
            [40,  [215, 48, 39]],
            [60,  [244,109, 67]],
            [80,  [253,174, 97]],
            [100, [255,255,191]],
            [120, [171,217,233]],
            [140, [116,173,209]],
            [160, [ 69,117,180]],
            [200, [ 49, 54,149]],
        ]
    },
    'turbo': {
        label: 'Turbo',
        stops: [
            [0,   [ 48,  18, 59]],
            [30,  [ 70, 108,205]],
            [60,  [ 32,186,175]],
            [90,  [121,209, 81]],
            [120, [219,210, 56]],
            [150, [250,142, 35]],
            [180, [219, 58, 27]],
            [200, [122,  4,  3]],
        ]
    },
    'viridis': {
        label: 'Viridis',
        stops: [
            [0,   [ 68,  1, 84]],
            [30,  [ 72, 36,117]],
            [60,  [ 56, 88,140]],
            [90,  [ 39,126,142]],
            [120, [ 31,161,135]],
            [150, [ 74,194,109]],
            [180, [159,218, 58]],
            [200, [253,231, 37]],
        ]
    },
};

EV.lfmcColormap = 'rao';   // default

EV.LFMC_STOPS = EV.LFMC_COLORMAPS[EV.lfmcColormap].stops;

/**
 * Switch the active LFMC colormap.
 */
EV.setLfmcColormap = function (name) {
    if (!EV.LFMC_COLORMAPS[name]) return;
    EV.lfmcColormap = name;
    EV.LFMC_STOPS = EV.LFMC_COLORMAPS[name].stops;
    EV.emit('lfmc:colormapChanged', { colormap: name });
};

/**
 * Map an LFMC value (%) to [R, G, B, A] (0-255).
 * Values below 0 or equal to nodata → transparent.
 */
EV.lfmcColor = function (val, nodata) {
    if (val === nodata || val < 0 || isNaN(val)) return [0, 0, 0, 0];
    var stops = EV.LFMC_STOPS;
    if (val <= stops[0][0]) return stops[0][1].concat([255]);
    if (val >= stops[stops.length - 1][0])
        return stops[stops.length - 1][1].concat([255]);
    for (var i = 1; i < stops.length; i++) {
        if (val <= stops[i][0]) {
            var t = (val - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
            var a = stops[i - 1][1], b = stops[i][1];
            return [
                Math.round(a[0] + t * (b[0] - a[0])),
                Math.round(a[1] + t * (b[1] - a[1])),
                Math.round(a[2] + t * (b[2] - a[2])),
                255
            ];
        }
    }
    return stops[stops.length - 1][1].concat([255]);
};

/**
 * Build a CSS linear-gradient string for the LFMC legend.
 */
EV.lfmcGradientCSS = function () {
    var parts = [];
    var stops = EV.LFMC_STOPS;
    var lo = stops[0][0], hi = stops[stops.length - 1][0];
    for (var i = 0; i < stops.length; i++) {
        var pct = ((stops[i][0] - lo) / (hi - lo) * 100).toFixed(1);
        var c = stops[i][1];
        parts.push('rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ') ' + pct + '%');
    }
    return 'linear-gradient(to right, ' + parts.join(', ') + ')';
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
