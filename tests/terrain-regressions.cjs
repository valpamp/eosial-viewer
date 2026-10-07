const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function renderer() {
    const context = { window: {}, EV: {}, console };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/fire-3d.js'), 'utf8'), context);
    return context.EV.fire3D;
}
const footprint = { key: 'native:1:2', corners: [[42, 12], [42, 12.1], [42.1, 12.1], [42.1, 12]] };
const feature = (frp, retrieval) => ({ properties: { SATELLITE: 'MTG-1', DATASET: retrieval ? 'S3' : 'SFIDE', S3_RETRIEVAL: retrieval, FRP_WOOSTER: frp, LATITUDE: 42, LONGITUDE: 12 } });
const style = () => ({ footprint, color: '#f00', opacity: 0.5 });
test('native footprints use longitude/latitude and a closed GeoJSON ring', () => {
    const result = renderer().buildFireCollection([feature(25)], style);
    const ring = result.collection.features[0].geometry.coordinates[0];
    assert.deepEqual(Array.from(ring[0]), [12, 42]);
    assert.deepEqual(Array.from(ring.at(-1)), [12, 42]);
    assert.equal(ring.length, 5); assert.equal(result.detectionCount, 1);
});
test('repeated observations share a footprint without changing detection count or FRP', () => {
    const records = [feature(25), feature(70), feature(40)];
    const result = renderer().buildFireCollection(records, style);
    assert.equal(result.collection.features.length, 1); assert.equal(result.detectionCount, 3);
    assert.equal(result.lookup[0].count, 3); assert.equal(result.lookup[0].feature.properties.FRP_WOOSTER, 70);
    assert.deepEqual(records.map(f => f.properties.FRP_WOOSTER), [25, 70, 40]);
});
test('Sentinel-3 retrieval streams remain separate', () => {
    const result = renderer().buildFireCollection([feature(25, 'standard'), feature(40, 'alternative')], style);
    assert.equal(result.collection.features.length, 2);
});
test('unavailable or invalid native grids fall back to points', () => {
    for (const grid of [null, { key: 'bad', corners: [[NaN, 12], [42, 12], [43, 13]] }]) {
        const result = renderer().buildFireCollection([feature(25)], () => ({ footprint: grid, color: '#f00', opacity: 0.5 }));
        assert.equal(result.collection.features[0].geometry.type, 'Point');
        assert.deepEqual(Array.from(result.collection.features[0].geometry.coordinates), [12, 42]);
    }
});
test('approximate footprints retain their scientific qualification in popup lookup', () => {
    const result = renderer().buildFireCollection([feature(25)], () => ({ footprint: { ...footprint, approximate: true }, color: '#f00', opacity: 0.5 }));
    assert.equal(result.lookup[0].style.footprint.approximate, true);
});
