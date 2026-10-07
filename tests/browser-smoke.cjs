/* Optional real-browser smoke test. Uses synthetic fire data and live CDN libraries. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const executable = process.env.EOSIAL_TEST_BROWSER || 'C:\\Program Files\\Chromium\\Application\\chrome.exe';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = Date.now() + 55000;
let browser, server, socket, profile;
let failFirmsArchive = true;
const errors = [];
const now = new Date().toISOString();
const time = now.slice(0, 16).replace(/-/g, '/').replace('T', ' ');
function record(dataset, satellite, frp) { return { type: 'Feature', geometry: { type: 'Point', coordinates: [12, 42] }, properties: { DATASET: dataset, SATELLITE: satellite, DATETIME: time, LATITUDE: 42, LONGITUDE: 12, TYPE: 0, FRP_WOOSTER: frp, CONFIDENCE: 80, fire_result: 1, fire_probability: 80 } }; }
function json(response, value, status = 200) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); }
async function until(fn, label) {
    while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(100); }
    throw Error('Timed out: ' + label + '\n' + JSON.stringify(errors));
}
(async () => {
    if (!fs.existsSync(executable)) throw Error('Set EOSIAL_TEST_BROWSER to a Chromium executable.');
    server = http.createServer((request, response) => {
        const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if (name.startsWith('/data/fire/')) {
            if (name.endsWith('firms_archive_manifest.json') && failFirmsArchive) return json(response, {}, 503);
            if (name.endsWith('_archive_manifest.json')) return json(response, { chunks: [], months: [] });
            if (name.endsWith('_manifest.json')) {
                const dataset = name.includes('mtg_fir') ? 'mtg' : name.includes('firms') ? 'firms' : 's3';
                return json(response, { files: dataset === 's3' ? [] : [{ path: dataset + '.geojson' }] });
            }
            if (name.endsWith('.geojson')) {
                const dataset = name.includes('sfide') ? 'SFIDE' : name.includes('firms') ? 'FIRMS' : 'MTG_FIR';
                const f = record(dataset, dataset === 'SFIDE' ? 'MET-10' : dataset === 'FIRMS' ? 'FIRMS-NPP' : 'MTG-FIR', dataset === 'MTG_FIR' ? null : 25);
                if (dataset === 'FIRMS') Object.assign(f.properties, { acq_date: now.slice(0,10), acq_time: now.slice(11,16).replace(':',''), product: 'suomi-npp-viirs-c2', satellite: 'N', latitude: 42, longitude: 12, frp: 25 });
                return json(response, { type: 'FeatureCollection', features: [f] });
            }
            response.writeHead(404); return response.end();
        }
        const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
        if (!file.startsWith(root + path.sep)) { response.writeHead(403); return response.end(); }
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); return response.end(); }
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
        response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        if (name === '/js/app.js') response.end('L.Map.addInitHook(function(){window.__smokeMap=this;});\n' + fs.readFileSync(file, 'utf8'));
        else fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'eosial-viewer-smoke-'));
    browser = spawn(executable, ['--headless', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    const portFile = path.join(profile, 'DevToolsActivePort');
    await until(() => fs.existsSync(portFile), 'browser startup');
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0; const pending = new Map();
    socket.onmessage = event => {
        const value = JSON.parse(event.data);
        if (value.id) { const task = pending.get(value.id); pending.delete(value.id); if (task) value.error ? task.reject(Error(value.error.message)) : task.resolve(value.result); }
        if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails);
    };
    function cdp(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
    async function evaluate(expression) {
        const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    }
    await cdp('Runtime.enable'); await cdp('Page.enable');
    await cdp('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
    await until(() => evaluate("!!(window.EV && EV.fireHotspots && document.getElementById('fire-count') && document.getElementById('fire-count').textContent.includes('hotspot') && !EV.fireHotspots.isLoading())"), 'viewer initialization');
    assert.equal(await evaluate("document.getElementById('fire-count').textContent"), '1 hotspot');
    await evaluate("document.getElementById('fire-start-time').value='31/02/2026 12:00'; document.getElementById('fire-end-time').value='07/10/2026 12:00'; document.getElementById('fire-apply-custom').click()");
    assert.match(await evaluate("document.getElementById('fire-range-error').textContent"), /valid UTC/);
    assert.equal(await evaluate("document.querySelector('.fire-time-btn.active').dataset.hours"), '6');
    await evaluate("document.querySelector('.fire-source-toggle[data-source=SFIDE]').click(); document.querySelector('.fire-source-toggle[data-source=MTG_FIR]').click()");
    await until(() => evaluate("!EV.fireHotspots.isLoading() && document.getElementById('fire-count').textContent==='1 hotspot'"), 'MTG-FIR activation');
    await evaluate("__smokeMap.fire(L.Draw.Event.CREATED,{layer:L.rectangle([[41,11],[43,13]])});void 0");
    assert.equal(await evaluate("document.getElementById('fire-animation-controls').classList.contains('hidden')"), false);
    assert.match(await evaluate("document.getElementById('ts-info').textContent"), /FRP is unavailable/);
    await evaluate("document.getElementById('fire-animation-show-table').click()");
    assert.equal(await evaluate("document.querySelectorAll('#ts-table tbody tr').length"), 1);
    await evaluate("document.getElementById('ts-modal-close').click(); EV.fireAnimation.close(); document.querySelector('.fire-source-toggle[data-source=FIRMS]').click()");
    await until(() => evaluate("!EV.fireHotspots.isLoading() && EV.fireHotspots.getLoadWarnings().length>0"), 'failed archive warning');
    assert.match(await evaluate("document.getElementById('fire-count').textContent"), /incomplete/);
    failFirmsArchive = false;
    await evaluate("document.getElementById('fire-retry-loads').click()");
    await until(() => evaluate("!EV.fireHotspots.isLoading() && !document.getElementById('fire-retry-loads').disabled && EV.fireHotspots.getLoadWarnings().length===0"), 'retry success');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate("document.querySelector('[data-mobile-panel=time]').click(); document.getElementById('fire-apply-custom').click()");
    assert.equal(await evaluate("getComputedStyle(document.getElementById('fire-range-error')).display !== 'none'"), true);
    assert.equal(await evaluate("document.getElementById('mobile-control-sheet').contains(document.getElementById('fire-range-error'))"), true);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    console.log('Browser smoke passed: startup, invalid dates, MTG-FIR table/animation, incomplete coverage, retry and mobile controls.');
    await cdp('Browser.close');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    if (socket) socket.close();
    if (browser) { browser.kill(); await delay(400); }
    if (server) server.close();
    // Only remove the uniquely created profile beneath the system temporary directory.
    if (profile && path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('eosial-viewer-smoke-')) {
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* browser cleanup may still hold a file */ }
    }
});
