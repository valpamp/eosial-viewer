/**
 * EOSIAL Active Fire Viewer — shared utilities
 */
var EV = window.EV || {};
window.EV = EV;

/* Shared UI helpers */
EV.showLoading = function (msg) {
    var el = document.getElementById('loading-indicator');
    var text = document.getElementById('loading-text');
    if (text) text.textContent = msg || 'Loading...';
    if (el) el.classList.remove('hidden');
};

EV.hideLoading = function () {
    var el = document.getElementById('loading-indicator');
    if (el) el.classList.add('hidden');
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
