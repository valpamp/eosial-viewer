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
function record(dataset, satellite, frp) { return { type: 'Feature', geometry: { type: 'Point', coordinates: [13.56, 42.45] }, properties: { DATASET: dataset, SATELLITE: satellite, DATETIME: time, LATITUDE: 42.45, LONGITUDE: 13.56, TYPE: 0, FRP_WOOSTER: frp, CONFIDENCE: 80, fire_result: 1, fire_probability: 80 } }; }
function json(response, value, status = 200) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); }
async function until(fn, label) {
    while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(100); }
    throw Error('Timed out: ' + label + '\n' + JSON.stringify(errors));
}
(async () => {
    if (!fs.existsSync(executable)) throw Error('Set EOSIAL_TEST_BROWSER to a Chromium executable.');
    server = http.createServer((request, response) => {
        const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if (name === '/test-basemap.png') {
            response.writeHead(200, { 'Content-Type': 'image/png' });
            return response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4dOsEAAT2AnXsxf/1AAAAAElFTkSuQmCC', 'base64'));
        }
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
                if (dataset === 'FIRMS') Object.assign(f.properties, { acq_date: now.slice(0,10), acq_time: now.slice(11,16).replace(':',''), product: 'suomi-npp-viirs-c2', satellite: 'N', latitude: 42.45, longitude: 13.56, frp: 25 });
                return json(response, { type: 'FeatureCollection', features: [f] });
            }
            response.writeHead(404); return response.end();
        }
        const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
        if (!file.startsWith(root + path.sep)) { response.writeHead(403); return response.end(); }
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); return response.end(); }
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
        response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        if (name === '/js/fire-3d.js') response.end(fs.readFileSync(file, 'utf8').replace('map3D = new maplibregl.Map({', 'map3D = window.__smoke3DMap = new maplibregl.Map({').replace('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', process.env.EOSIAL_TEST_LIVE_BASEMAP ? 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}' : '/test-basemap.png?z={z}&x={x}&y={y}').replace('https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}', process.env.EOSIAL_TEST_LIVE_BASEMAP ? 'https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}' : '/test-basemap.png?labels=1&z={z}&x={x}&y={y}'));
        else if (name === '/js/app.js') response.end('L.Map.addInitHook(function(){window.__smokeMap=this;});\n' + fs.readFileSync(file, 'utf8'));
        else fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'eosial-viewer-smoke-'));
    browser = spawn(executable, ['--headless', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
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
        if (value.method === 'Runtime.consoleAPICalled' && value.params.type === 'warning' && value.params.args.some(arg => arg.value === '[3D]')) errors.push({ terrainWarning: value.params.args.map(arg => arg.value || arg.description).join(' ') });
        if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails);
        if (value.method === 'Page.javascriptDialogOpening') {
            errors.push({ dialog: value.params.message });
            cdp('Page.handleJavaScriptDialog', { accept: true }).catch(function () {});
        }
    };
    function cdp(method, params = {}) { return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => { pending.delete(id); reject(Error('Browser command timed out: ' + method)); }, 12000);
        pending.set(id, { resolve(value) { clearTimeout(timeout); resolve(value); }, reject(error) { clearTimeout(timeout); reject(error); } });
        socket.send(JSON.stringify({ id, method, params }));
    }); }
    async function evaluate(expression) {
        const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    }
    await cdp('Runtime.enable'); await cdp('Page.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('eosial-viewer-tour-v1','complete');" });
    await cdp('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
    await until(() => evaluate("!!(window.EV && EV.fireHotspots && document.getElementById('fire-count') && document.getElementById('fire-count').textContent.includes('hotspot') && !EV.fireHotspots.isLoading())"), 'viewer initialization');
    assert.equal(await evaluate("document.getElementById('fire-count').textContent"), '1 hotspot');
    await evaluate("document.getElementById('fire-start-time').value='31/02/2026 12:00'; document.getElementById('fire-end-time').value='07/10/2026 12:00'; document.getElementById('fire-apply-custom').click()");
    assert.match(await evaluate("document.getElementById('fire-range-error').textContent"), /valid UTC/);
    assert.equal(await evaluate("document.querySelector('.fire-time-btn.active').dataset.hours"), '6');
    await evaluate("document.querySelector('.fire-source-toggle[data-source=SFIDE]').click(); document.querySelector('.fire-source-toggle[data-source=MTG_FIR]').click()");
    await until(() => evaluate("!EV.fireHotspots.isLoading() && document.getElementById('fire-count').textContent==='1 hotspot'"), 'MTG-FIR activation');
    await evaluate("__smokeMap.fire(L.Draw.Event.CREATED,{layer:L.rectangle([[41,11],[43,14]])});void 0");
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
    await evaluate("document.getElementById('btn-toggle-3d').click()");
    await until(() => evaluate("!!window.__smoke3DMap"), '3D renderer creation');
    await until(() => evaluate("!!(__smoke3DMap.getTerrain() && document.getElementById('terrain3d-count').textContent.includes('selected detections'))"), '3D terrain initialization');
    assert.equal(await evaluate("EV.fire3D.isActive()"), true);
    assert.match(await evaluate("document.getElementById('terrain3d-count').textContent"), /2 selected detections/);
    assert.equal(await evaluate("__smoke3DMap.getTerrain().exaggeration"), 1);
    assert.match(await evaluate("__smoke3DMap.getStyle().sources.basemap.attribution"), /Google/);
    assert.equal(await evaluate("document.getElementById('terrain3d-labels').checked"), false);
    assert.equal(await evaluate("!!__smoke3DMap.getSource('place-labels')"), false);
    await evaluate("document.getElementById('terrain3d-labels').click()");
    await until(() => evaluate("__smoke3DMap.isSourceLoaded('place-labels')"), 'labels overlay loaded');
    assert.equal(await evaluate("__smoke3DMap.getLayoutProperty('place-labels','visibility')"), 'visible');
    assert.ok(await evaluate("(()=>{const ids=__smoke3DMap.getStyle().layers.map(l=>l.id);return ids.indexOf('place-labels')<ids.indexOf('fire-fill');})()"));
    await evaluate("document.getElementById('terrain3d-labels').click()");
    assert.equal(await evaluate("__smoke3DMap.getLayoutProperty('place-labels','visibility')"), 'none');
    await evaluate("document.getElementById('terrain3d-labels').click()");
    await evaluate("document.querySelector('[data-terrain-place=etna]').click()");
    await until(() => evaluate("!__smoke3DMap.isMoving() && __smoke3DMap.areTilesLoaded() && __smoke3DMap.queryTerrainElevation([15.004,37.751]) > 2500"), 'Etna summit relief');
    assert.ok(await evaluate("Math.abs(__smoke3DMap.getCenter().lng-15.004)<0.001 && Math.abs(__smoke3DMap.getCenter().lat-37.751)<0.001"));
    if (process.env.EOSIAL_TEST_SCREENSHOT && process.env.EOSIAL_TEST_LIVE_BASEMAP) {
        const shot = await cdp('Page.captureScreenshot', { format:'png' });
        fs.mkdirSync(path.join(root,'tmp'), { recursive:true });
        fs.writeFileSync(path.join(root,'tmp/etna-satellite.png'), Buffer.from(shot.data,'base64'));
    }
    await evaluate("document.querySelector('[data-terrain-place=gran-sasso]').click()");
    await until(() => evaluate("!__smoke3DMap.isMoving() && __smoke3DMap.areTilesLoaded() && __smoke3DMap.queryTerrainElevation([13.56,42.45]) > 500"), 'real Gran Sasso relief');
    await evaluate("document.getElementById('terrain3d-exaggeration').value='2';document.getElementById('terrain3d-exaggeration').dispatchEvent(new Event('change'))");
    assert.equal(await evaluate("__smoke3DMap.getTerrain().exaggeration"), 2);
    await evaluate("document.querySelector('.fire-source-toggle[data-source=FIRMS]').click()");
    await until(() => evaluate("document.getElementById('terrain3d-count').textContent.includes('1 selected detections')"), 'shared 3D filtering');
    await until(() => evaluate("__smoke3DMap.isSourceLoaded('fire-pixels') && __smoke3DMap.queryRenderedFeatures(undefined,{layers:['fire-fill','fire-points']}).length>0"), 'visible terrain footprints');
    await evaluate("(()=>{const c=__smoke3DMap.getCanvas();for(let y=0;y<c.clientHeight;y+=8){for(let x=0;x<c.clientWidth;x+=8){if(__smoke3DMap.queryRenderedFeatures([x,y],{layers:['fire-fill','fire-points']}).length){__smoke3DMap.fire('click',{point:{x,y},lngLat:__smoke3DMap.unproject([x,y])});return;}}}throw Error('No clickable fire footprint');})()");
    assert.match(await evaluate("document.querySelector('#terrain3d-map .maplibregl-popup-content').textContent"), /MTG-FIR/);
    if (process.env.EOSIAL_TEST_SCREENSHOT) {
        const shot = await cdp('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync(path.join(root,'tmp'), { recursive:true });
        fs.writeFileSync(path.join(root,'tmp/terrain-3d.png'), Buffer.from(shot.data,'base64'));
    }
    await evaluate("document.getElementById('terrain3d-close').click()");
    assert.equal(await evaluate("EV.fire3D.isActive()"), false);
    assert.equal(await evaluate("document.getElementById('terrain3d-panel').classList.contains('hidden')"), true);
    assert.ok(await evaluate("Math.abs(__smokeMap.getCenter().lng-13.56)<0.01"));
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate("document.querySelector('[data-mobile-panel=time]').click(); document.getElementById('fire-apply-custom').click()");
    assert.equal(await evaluate("getComputedStyle(document.getElementById('fire-range-error')).display !== 'none'"), true);
    assert.equal(await evaluate("document.getElementById('mobile-control-sheet').contains(document.getElementById('fire-range-error'))"), true);
    await evaluate("document.querySelector('[data-mobile-panel=filters]').click()");
    await delay(250);
    for (const [width,height] of [[320,568],[360,800],[390,844],[430,932],[667,375],[760,844]]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
        for (const source of ['SFIDE', 'FIRMS', 'S3', 'MTG_FIR']) {
            await evaluate("document.querySelector('.fire-source-tab[data-source=" + source + "] .fire-source-select').click()");
            const layout = await evaluate("(()=>{const body=document.getElementById('mobile-sheet-body'); const tabs=[...document.querySelectorAll('.fire-source-tab')].map(t=>t.getBoundingClientRect());return {viewport:document.documentElement.scrollWidth,bodyWidth:body.clientWidth,contentWidth:body.scrollWidth,rows:tabs.map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})),target:[...document.querySelectorAll('.fire-source-visibility, .fire-source-select')].every(e=>{const r=e.getBoundingClientRect();return r.height>=44 && r.width>=44;})};})()");
            assert.ok(layout.viewport <= width, JSON.stringify({width,source,layout}));
            assert.ok(layout.contentWidth <= layout.bodyWidth + 1, JSON.stringify({width,source,layout}));
            assert.ok(layout.rows.every(r=>r.left>=0 && r.right<=width), JSON.stringify({width,source,layout}));
            assert.ok(layout.rows.every((r,i)=>i===0 || r.top>=layout.rows[i-1].bottom), 'Datasets must stack vertically');
            assert.ok(layout.target, 'Source selection and visibility targets must be at least 44px');
        }
    }
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate("document.querySelector('.fire-source-tab[data-source=SFIDE] .fire-source-select').click()");
    assert.equal(await evaluate("document.querySelector('.fire-source-tab.active').dataset.source"), 'SFIDE');
    assert.equal(await evaluate("document.querySelector('.fire-source-toggle[data-source=SFIDE]').checked"), false);
    const activeBefore = await evaluate("document.querySelector('.fire-source-tab.active').dataset.source");
    // Click the checkbox label padding to exercise the full touch target.
    await evaluate("document.querySelector('.fire-source-tab[data-source=FIRMS]').scrollIntoView({block:'center'})");
    await delay(100);
    const target = await evaluate("(()=>{const r=document.querySelector('.fire-source-tab[data-source=FIRMS] .fire-source-visibility').getBoundingClientRect();return {x:r.left+3,y:r.top+r.height/2};})()");
    await cdp('Input.dispatchMouseEvent', { type:'mousePressed', ...target, button:'left', clickCount:1 });
    await cdp('Input.dispatchMouseEvent', { type:'mouseReleased', ...target, button:'left', clickCount:1 });
    assert.equal(await evaluate("document.querySelector('.fire-source-toggle[data-source=FIRMS]').checked"), true);
    assert.equal(await evaluate("document.querySelector('.fire-source-tab.active').dataset.source"), activeBefore);
    await until(() => evaluate("!EV.fireHotspots.isLoading()"), 'mobile dataset toggle');
    await evaluate("document.querySelector('.fire-source-toggle[data-source=FIRMS]').focus()");
    await cdp('Input.dispatchKeyEvent', { type:'keyDown', key:' ', code:'Space', windowsVirtualKeyCode:32 });
    await cdp('Input.dispatchKeyEvent', { type:'keyUp', key:' ', code:'Space', windowsVirtualKeyCode:32 });
    assert.equal(await evaluate("document.querySelector('.fire-source-toggle[data-source=FIRMS]').checked"), false);
    assert.equal(await evaluate("document.querySelector('.fire-source-tab.active').dataset.source"), activeBefore);
    await evaluate("document.querySelector('.fire-source-tab[data-source=S3] .fire-source-select').focus()");
    await cdp('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', text:'\r', windowsVirtualKeyCode:13 });
    await cdp('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
    assert.equal(await evaluate("document.querySelector('.fire-source-tab.active').dataset.source"), 'S3');
    assert.equal(await evaluate("document.querySelector('.fire-source-toggle[data-source=S3]').checked"), false);
    await evaluate("document.querySelector('.fire-source-tab[data-source=SFIDE] .fire-source-select').click(); document.activeElement.blur()");
    if (process.env.EOSIAL_TEST_SCREENSHOT) {
        await evaluate("document.getElementById('mobile-sheet-body').scrollTop=0");
        const shot = await cdp('Page.captureScreenshot', { format:'png' });
        fs.writeFileSync(path.join(root,'tmp/mobile-dataset-filters.png'), Buffer.from(shot.data,'base64'));
    }
    await evaluate("document.getElementById('mobile-sheet-close').click(); EV.fire3D.open(); EV.fire3D.close(); EV.fire3D.open(); void 0");
    await until(() => evaluate("!!(__smoke3DMap.getStyle() && __smoke3DMap.getTerrain() && __smoke3DMap.areTilesLoaded())"), 'mobile terrain view');
    assert.equal(await evaluate("document.getElementById('terrain3d-labels').checked"), true);
    assert.equal(await evaluate("__smoke3DMap.getLayoutProperty('place-labels','visibility')"), 'visible');
    for (const width of [320,390]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height:844, deviceScaleFactor:1, mobile:true });
        await delay(100);
        assert.ok(await evaluate("(()=>{const t=document.querySelector('.terrain3d-label-toggle').getBoundingClientRect();const bar=document.querySelector('.terrain3d-toolbar').getBoundingClientRect();const info=document.querySelector('.terrain3d-info').getBoundingClientRect();return t.left>=0 && t.right<=innerWidth && t.height>=44 && info.top>=bar.bottom;})()"));
    }
    assert.ok(await evaluate("(()=>{const r=document.getElementById('terrain3d-close').getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.bottom<innerHeight;})()"));
    if (process.env.EOSIAL_TEST_SCREENSHOT) {
        const shot = await cdp('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(root,'tmp/terrain-3d-mobile.png'), Buffer.from(shot.data,'base64'));
    }
    await evaluate("EV.fire3D.close()");
    await cdp('Emulation.setDeviceMetricsOverride', { width:1280, height:900, deviceScaleFactor:1, mobile:false });
    await delay(100);
    assert.equal(await evaluate("document.body.classList.contains('mobile-sheet-open')"), false);
    assert.equal(await evaluate("document.getElementById('mobile-control-sheet').contains(document.getElementById('fire-controls'))"), false);
    assert.equal(await evaluate("document.querySelector('.fire-source-tabs').getAttribute('aria-orientation')"), 'horizontal');
    assert.ok(await evaluate("(()=>{const r=[...document.querySelectorAll('.fire-source-tab')].map(e=>e.getBoundingClientRect()); return r.every(e=>Math.abs(e.top-r[0].top)<1) && r.every(e=>e.right<=innerWidth);})()"));
    assert.equal(errors.length, 0, JSON.stringify(errors));
    console.log('Browser smoke passed: startup, invalid dates, MTG-FIR table/animation, incomplete coverage, retry, real GLO-90 relief at Etna/Gran Sasso, Google attribution and labels toggle, 3D filtering, mode return, mobile dataset touch/keyboard controls and overflow at 320-760px.');
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
