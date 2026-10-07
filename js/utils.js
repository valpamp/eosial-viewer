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

/* Strict UTC inputs shared by map filters and animation. */
EV.parseUTCInput = function (value) {
    var m = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    var date = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]));
    return date.getUTCFullYear() === +m[3] && date.getUTCMonth() === +m[2] - 1 &&
        date.getUTCDate() === +m[1] && date.getUTCHours() === +m[4] &&
        date.getUTCMinutes() === +m[5] ? date : null;
};

EV.escapeHtml = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
};

/* Complete all tasks with bounded concurrency, preserving individual failures. */
EV.mapSettledLimit = async function (items, limit, task) {
    var results = new Array(items.length);
    var next = 0;
    async function worker() {
        while (next < items.length) {
            var index = next++;
            try { results[index] = { status: 'fulfilled', value: await task(items[index], index) }; }
            catch (error) { results[index] = { status: 'rejected', reason: error }; }
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
};

/* Explicit geocoder searches: cache, serialize, and discard superseded results. */
EV.createLocationSearch = function (options) {
    options = options || {};
    var request = options.fetch || window.fetch.bind(window);
    var now = options.now || Date.now;
    var wait = options.delay || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
    var cache = new Map();
    var version = 0;
    var lastStart = -Infinity;
    var queue = Promise.resolve();
    return {
        cancel: function () { version++; },
        search: function (query) {
            query = String(query || '').trim();
            var current = ++version;
            var task = queue.then(async function () {
                if (current !== version || query.length < 3) return null;
                var key = query.toLowerCase();
                if (cache.has(key)) return cache.get(key);
                await wait(Math.max(0, 1100 - (now() - lastStart)));
                if (current !== version) return null;
                lastStart = now();
                try {
                    var response = await request('https://nominatim.openstreetmap.org/search?format=json&limit=5&q=' + encodeURIComponent(query));
                    if (!response.ok) throw new Error('Search HTTP ' + response.status);
                    var data = await response.json();
                    if (!Array.isArray(data)) throw new Error('Invalid search response');
                    if (cache.size >= 50) cache.delete(cache.keys().next().value);
                    cache.set(key, data);
                    return current === version ? data : null;
                } catch (error) {
                    if (current !== version) return null;
                    throw error;
                }
            });
            queue = task.catch(function () {});
            return task;
        }
    };
};
