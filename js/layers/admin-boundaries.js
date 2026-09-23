/**
 * EOSIAL Active Fire Viewer - administrative boundary overlays.
 *
 * Natural Earth 1:10m supplies worldwide level-0 boundaries. ISTAT 2026
 * supplies Italian regions (level 1) and provinces (level 2). Each layer is
 * fetched only when selected; detailed layers render only at useful zooms.
 */
(function () {
    var PANE = 'adminPane';
    var mapRef = null;

    function ensurePane(map) {
        if (!map.getPane(PANE)) {
            var pane = map.createPane(PANE);
            pane.style.zIndex = 450;
            pane.style.pointerEvents = 'none';
        }
    }

    function loadFlatGeobuf(url) {
        return fetch(url).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
            return response.arrayBuffer();
        }).then(function (buffer) {
            var iterator = flatgeobuf.deserialize(new Uint8Array(buffer));
            if (iterator && iterator[Symbol.asyncIterator]) {
                return (async function () {
                    var features = [];
                    for await (var feature of iterator) features.push(feature);
                    return features;
                })();
            }
            return Array.from(iterator || []);
        });
    }

    function createBoundaryLayer(config) {
        var leafletLayer = null;
        var loaded = false;
        var loading = null;
        var visible = false;

        function shouldRender() {
            return visible && mapRef && mapRef.getZoom() >= config.minZoom;
        }

        function sync() {
            if (!leafletLayer || !mapRef) return;
            if (shouldRender()) {
                if (!mapRef.hasLayer(leafletLayer)) leafletLayer.addTo(mapRef);
            } else if (mapRef.hasLayer(leafletLayer)) {
                mapRef.removeLayer(leafletLayer);
            }
        }

        function load() {
            if (loaded) {
                sync();
                return Promise.resolve();
            }
            if (loading) return loading;
            EV.showLoading('Loading ' + config.loadingLabel + '...');
            loading = loadFlatGeobuf(config.url).then(function (features) {
                leafletLayer = L.geoJSON({ type: 'FeatureCollection', features: features }, {
                    pane: PANE,
                    interactive: false,
                    style: config.style
                });
                loaded = true;
                loading = null;
                EV.hideLoading();
                sync();
            }).catch(function (error) {
                loading = null;
                EV.hideLoading();
                console.error('[ADMIN ' + config.level + ']', error);
            });
            return loading;
        }

        return {
            id: config.id,
            name: config.name,
            type: 'line',
            defaultVisible: false,
            init: function (map, dataBase) {
                mapRef = map;
                ensurePane(map);
                config.url = dataBase + '/boundaries/' + config.file;
                map.on('zoomend', sync);
                return Promise.resolve();
            },
            setVisible: function (value) {
                visible = value;
                if (visible && !loaded) load();
                else sync();
            }
        };
    }

    EV.adminL0 = createBoundaryLayer({
        id: 'admin-l0', name: 'Countries (Level 0)', level: 0,
        file: 'admin0_countries_10m.fgb', loadingLabel: 'country boundaries', minZoom: 3,
        style: { color: '#5f1724', weight: 1.35, fill: false, opacity: 0.82 }
    });
    EV.adminL1 = createBoundaryLayer({
        id: 'admin-l1', name: 'Italian Regions (Level 1)', level: 1,
        file: 'admin1_italy_regions_2026.fgb', loadingLabel: 'Italian regional boundaries', minZoom: 5,
        style: { color: '#822433', weight: 1.25, fill: false, opacity: 0.82 }
    });
    EV.adminL2 = createBoundaryLayer({
        id: 'admin-l2', name: 'Italian Provinces (Level 2)', level: 2,
        file: 'admin2_italy_provinces_2026.fgb', loadingLabel: 'Italian provincial boundaries', minZoom: 7,
        style: { color: '#a67c32', weight: 0.9, fill: false, opacity: 0.72, dashArray: '4 3' }
    });
})();