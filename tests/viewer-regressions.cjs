const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function element(value = '') {
    const classes = new Set();
    return { value, textContent: '', disabled: false, classList: {
        toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
        add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains(name) { return classes.has(name); }
    } };
}
function fixture({ fetch = async () => ({ ok: true, json: async () => ({ chunks: [] }) }), preset = '6' } = {}) {
    let tick = Date.parse('2026-10-07T12:00:00Z');
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : [tick++])); } }
    const elements = Object.fromEntries(['fire-count', 'fire-range-error', 'fire-load-status', 'fire-load-message', 'fire-retry-loads', 'fire-start-time', 'fire-end-time'].map(id => [id, element()]));
    const renders = [];
    const context = { window: {}, Date: Clock, console: { warn() {}, info() {} }, fetch, setTimeout, clearTimeout };
    context.document = {
        getElementById(id) { return elements[id] || null; },
        querySelector(selector) { return selector === '.fire-time-btn.active' && preset !== null ? { getAttribute() { return preset; } } : null; },
        querySelectorAll(selector) {
            if (selector === '.fire-sat-filter:checked') return ['MET-10', 'FIRMS-NPP', 'MTG-FIR'].map(value => ({ value }));
            if (selector === '.fire-type-filter:checked') return [{ value: '0' }];
            if (selector === '.fire-s3-stream-filter:checked') return [{ value: 'standard|S3A' }];
            return [];
        }
    };
    vm.createContext(context);
    vm.runInContext(read('js/utils.js'), context);
    let source = read('js/layers/fire-hotspots.js');
    // Expose private boundaries only in this isolated test VM; production API is unchanged.
    source = source.replace('    EV.fireHotspots = {', `
    EV.test = {
        applyFilters, buildPopup, queryPolygon, load72h, loadFirmsNrt, loadS3Nrt, loadMtgFirNrt, retryFailedLoads,
        resolveTimeRange, getTimeRange, parseEuropeanDateTime, isDefaultSatelliteSelected,
        configure: function (options) {
            clusterGroup = {};
            sfideVisible = !!options.sfide; firmsVisible = !!options.firms;
            s3Visible = !!options.s3; mtgFirVisible = !!options.mtg;
            displayFeatures = options.render;
            dataBaseUrl = 'data';
        },
        setLoader: function (loader) { loadByFormat = loader; },
        addFeatures: mergeFeatures,
        state: function () { return { ready: Object.keys(externalArchiveReady), issues: Object.keys(loadIssues), loading: filtersLoading, features: allFeatures.length }; }
    };
    EV.fireHotspots = {`);
    vm.runInContext(source, context);
    const api = context.EV.test;
    api.configure({ firms: true, render: features => renders.push(Array.from(features)) });
    return { api, EV: context.EV, elements, renders, setPreset(value) { preset = value; } };
}
function feature(dataset = 'FIRMS', frp = 25, datetime = '2026/10/07 11:00') {
    return { geometry: { type: 'Point', coordinates: [12, 42] }, properties: {
        DATASET: dataset, SATELLITE: dataset === 'MTG_FIR' ? 'MTG-FIR' : dataset === 'SFIDE' ? 'MET-10' : 'FIRMS-NPP',
        DATETIME: datetime, LATITUDE: 42, LONGITUDE: 12, FRP_WOOSTER: frp, CONFIDENCE: 80, TYPE: 0
    } };
}
const bounds = { getSouthWest() { return { lat: 41, lng: 11 }; }, getNorthEast() { return { lat: 43, lng: 13 }; } };
const chunk = (key = 'day1', start = '2026-10-07T00:00:00Z', end = '2026-10-07T23:59:59Z') => ({ key, path: key + '.fgb', start, end });

test('moving 6h and All presets complete once, keeping one time snapshot', async () => {
    for (const preset of ['6', '0']) {
        let requests = 0;
        const f = fixture({ preset, fetch: async () => { requests++; return { ok: true, json: async () => ({ chunks: [chunk()] }) }; } });
        let downloads = 0;
        f.api.setLoader(async () => { downloads++; await turn(); return [feature()]; });
        await f.api.applyFilters();
        assert.equal(requests, 1); assert.equal(downloads, 1);
        assert.equal(f.api.state().loading, false);
        assert.equal(f.renders.at(-1).length, 1);
        assert.equal(f.api.state().ready.length, 1);
        assert.equal(f.api.getTimeRange().end.getTime(), f.api.getTimeRange().end.getTime());
    }
});

test('failed archive remains incomplete and retry reloads only failed chunks', async () => {
    const f = fixture({ fetch: async () => ({ ok: true, json: async () => ({ chunks: [chunk('good'), chunk('bad')] }) }) });
    let fail = true; const calls = [];
    f.api.setLoader(async url => { calls.push(url); if (fail && url.includes('bad')) throw Error('offline'); return [feature()]; });
    await f.api.applyFilters();
    assert.equal(f.api.state().ready.length, 0);
    assert.equal(f.api.state().issues.length, 1);
    assert.match(f.elements['fire-count'].textContent, /incomplete/);
    assert.match(f.elements['fire-load-message'].textContent, /exports may be incomplete/);
    fail = false; await f.api.retryFailedLoads();
    assert.equal(calls.filter(url => url.includes('good')).length, 1);
    assert.equal(calls.filter(url => url.includes('bad')).length, 2);
    assert.equal(f.api.state().ready.length, 1);
    assert.equal(f.api.state().issues.length, 0);
    assert.equal(f.elements['fire-load-status'].classList.contains('hidden'), true);
});

test('archive manifest failures do not cause recursive loads and can be retried', async () => {
    let fail = true, calls = 0;
    const f = fixture({ fetch: async () => { calls++; if (fail) throw Error('offline'); return { ok: true, json: async () => ({ chunks: [] }) }; } });
    await f.api.applyFilters();
    assert.equal(calls, 1); assert.equal(f.api.state().ready.length, 0);
    fail = false; await f.api.retryFailedLoads();
    assert.equal(calls, 2); assert.equal(f.api.state().issues.length, 0);
});

test('older selections cannot replace a newer completed result', async () => {
    const old = deferred(), newer = deferred();
    const f = fixture({ preset: null, fetch: async () => ({ ok: true, json: async () => ({ chunks: [
        chunk('old', '2026-10-05T00:00:00Z', '2026-10-05T23:59:59Z'), chunk('new')
    ] }) }) });
    f.api.setLoader(url => url.includes('old') ? old.promise : newer.promise);
    f.elements['fire-start-time'].value = '05/10/2026 00:00'; f.elements['fire-end-time'].value = '05/10/2026 23:59';
    const first = f.api.applyFilters(); await turn();
    f.elements['fire-start-time'].value = '07/10/2026 00:00'; f.elements['fire-end-time'].value = '07/10/2026 23:59';
    const second = f.api.applyFilters(); await turn();
    newer.resolve([feature()]); await second;
    const completedRenders = f.renders.length;
    old.resolve([feature('FIRMS', 99, '2026/10/05 11:00')]); await first;
    assert.equal(f.renders.length, completedRenders);
    assert.equal(f.renders.at(-1)[0].properties.FRP_WOOSTER, 25);
});

test('overlapping filter actions share downloads and both await completion', async () => {
    const pending = deferred(); let downloads = 0;
    const f = fixture({ fetch: async () => ({ ok: true, json: async () => ({ chunks: [chunk()] }) }) });
    f.api.setLoader(() => { downloads++; return pending.promise; });
    const first = f.api.applyFilters(); await turn();
    const second = f.api.applyFilters(); await turn();
    assert.equal(downloads, 1); assert.equal(f.api.state().loading, true);
    pending.resolve([feature()]); await Promise.all([first, second]);
    assert.equal(f.renders.at(-1).length, 1); assert.equal(f.api.state().loading, false);
});

test('SFIDE failures produce visible warnings and remain retryable', async () => {
    let fail = true;
    const f = fixture({ preset: '0', fetch: async () => ({ ok: true, json: async () => ({ months: [{ key: 'week1', start: '2026-10-01', end: '2026-10-08', files: { fgb: 'week1.fgb' } }] }) }) });
    f.api.configure({ sfide: true, render: features => f.renders.push(Array.from(features)) });
    f.api.setLoader(async () => { if (fail) throw Error('offline'); return [feature('SFIDE')]; });
    await f.api.applyFilters(); assert.equal(f.api.state().issues.length, 1);
    fail = false; await f.api.retryFailedLoads();
    assert.equal(f.api.state().issues.length, 0); assert.equal(f.renders.at(-1).length, 1);
});

test('recent data failures are visible and retry without a hardcoded fallback', async () => {
    let fail = true; const urls = [];
    const f = fixture({ fetch: async url => { urls.push(url); return { ok: true, json: async () => ({ files: [{ path: 'firms/today.fgb' }] }) }; } });
    f.api.setLoader(async url => { urls.push(url); if (fail) throw Error('offline'); return [feature()]; });
    await f.api.loadFirmsNrt(); assert.equal(f.api.state().issues.length, 1);
    fail = false; await f.api.retryFailedLoads();
    assert.equal(f.api.state().issues.length, 0); assert.equal(f.api.state().features, 1);
    assert.equal(urls.some(url => url.includes('2026147')), false);
});

test('MTG-FIR queries keep table/animation and count all mixed-source detections', async () => {
    const f = fixture();
    f.api.configure({ mtg: true, render: () => {} });
    f.api.addFeatures([feature('MTG_FIR', null)]); await f.api.applyFilters();
    let result = f.api.queryPolygon(bounds);
    assert.equal(result.length, 0); assert.equal(result.tableRows.length, 1); assert.equal(result.animation.points.length, 1);
    assert.equal(Object.values(result.satelliteDetections).reduce((a, b) => a + b, 0), 1);
    f.api.configure({ mtg: true, firms: true, render: () => {} });
    f.api.addFeatures([feature()]); await f.api.applyFilters(); result = f.api.queryPolygon(bounds);
    assert.equal(result.length, 1); assert.equal(result.tableRows.length, 2);
    assert.equal(Object.values(result.satelliteDetections).reduce((a, b) => a + b, 0), 2);
});

test('invalid dates and reversed intervals preserve the previous valid selection', async () => {
    const f = fixture(); await f.api.applyFilters(); const previous = f.api.getTimeRange();
    for (const value of ['31/02/2026 12:00', '07/10/2026 25:90', '29/02/2025 10:00', '00/10/2026 11:00', 'bad']) assert.equal(f.api.parseEuropeanDateTime(value), null);
    assert.equal(f.EV.parseUTCInput('29/02/2024 10:00').toISOString(), '2024-02-29T10:00:00.000Z');
    f.setPreset(null); f.elements['fire-start-time'].value = '08/10/2026 12:00'; f.elements['fire-end-time'].value = '07/10/2026 12:00';
    await f.api.applyFilters(); assert.equal(f.api.getTimeRange(), previous);
    assert.match(f.elements['fire-range-error'].textContent, /valid UTC/);
});

test('popup metadata is escaped while numeric fields remain usable', () => {
    const f = fixture(); const p = feature('MTG_FIR', null).properties;
    for (const key of ['PRODUCT', 'INSTRUMENT', 'DATASET_LABEL', 'CONFIDENCE_RAW', 'FIRE_RESULT', 'PROD_COMPLETE']) p[key] = '<img src=x onerror="alert(1)">';
    const html = f.api.buildPopup(p, 1);
    assert.equal(html.includes('<img'), false); assert.ok(html.includes('&lt;img'));
    assert.ok(html.includes('42.0000')); assert.equal(p.PRODUCT.startsWith('<img'), true);
});

test('bounded archive work completes other chunks after individual failures', async () => {
    const f = fixture(); let active = 0, maximum = 0, calls = 0;
    const result = await f.EV.mapSettledLimit(Array.from({ length: 17 }, (_, i) => i), 4, async i => {
        active++; calls++; maximum = Math.max(maximum, active); await turn(); active--;
        if (i === 3) throw Error('bad tile'); return i;
    });
    assert.equal(maximum, 4); assert.equal(calls, 17); assert.equal(result[3].status, 'rejected'); assert.equal(result[16].value, 16);
});

test('explicit search caches results, spaces requests and ignores stale responses', async () => {
    const f = fixture(); let now = 0; const starts = []; const old = deferred();
    const search = f.EV.createLocationSearch({ now: () => now, delay: async ms => { now += ms; }, fetch: async url => {
        starts.push(now); if (url.includes('Old')) return old.promise;
        return { ok: true, json: async () => [{ display_name: 'Rome' }] };
    } });
    const first = search.search('Old'); await turn(); search.cancel();
    const second = search.search('Rome'); old.resolve({ ok: true, json: async () => [{ display_name: 'Old' }] });
    assert.equal(await first, null); assert.equal((await second)[0].display_name, 'Rome');
    assert.ok(starts[1] - starts[0] >= 1000);
    await search.search('Rome'); assert.equal(starts.length, 2);
});

test('geocoder rejects HTTP errors and permits a subsequent retry', async () => {
    const f = fixture(); let ok = false;
    const search = f.EV.createLocationSearch({ delay: async () => {}, fetch: async () => ({ ok, status: 503, json: async () => [] }) });
    await assert.rejects(search.search('Rome'), /503/); ok = true;
    assert.equal((await search.search('Rome')).length, 0);
});

test('disabled MTG-FIR comparison data do not deselect default SFIDE MSG satellites', () => {
    const f = fixture();
    assert.equal(f.api.isDefaultSatelliteSelected('MET-10', ['MET-10', 'MTG-FIR']), true);
    assert.equal(f.api.isDefaultSatelliteSelected('MET-10', ['MET-10', 'MTG-1', 'MTG-FIR']), false);
});

test('repeated SFIDE recent-load failures retain their warning after retry', async () => {
    const f = fixture({ fetch: async () => ({ ok: true, json: async () => ({ months: [] }) }) });
    f.api.configure({ sfide: true, render: () => {} });
    f.api.setLoader(async () => { throw Error('offline'); });
    await f.api.load72h();
    assert.ok(f.api.state().issues.includes('SFIDE:recent'));
    await f.api.retryFailedLoads();
    assert.ok(f.api.state().issues.includes('SFIDE:recent'));
});

test('superseded archive failures do not mark the current selection incomplete', async () => {
    const old = deferred();
    const f = fixture({ preset: null, fetch: async () => ({ ok: true, json: async () => ({ chunks: [
        chunk('old', '2026-10-05T00:00:00Z', '2026-10-05T23:59:59Z'), chunk('new')
    ] }) }) });
    f.api.setLoader(url => url.includes('old') ? old.promise : Promise.resolve([feature()]));
    f.elements['fire-start-time'].value = '05/10/2026 00:00'; f.elements['fire-end-time'].value = '05/10/2026 23:59';
    const first = f.api.applyFilters(); await turn();
    f.elements['fire-start-time'].value = '07/10/2026 00:00'; f.elements['fire-end-time'].value = '07/10/2026 23:59';
    await f.api.applyFilters(); old.reject(Error('old request failed')); await first;
    assert.equal(f.EV.fireHotspots.getLoadWarnings().length, 0);
    assert.equal(f.elements['fire-count'].textContent, '1 hotspot');
});
