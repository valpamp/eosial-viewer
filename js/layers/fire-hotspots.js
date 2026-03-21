/**
 * EOSIAL Viewer — Fire Hotspots layer (placeholder)
 *
 * Stub for future migration of the SFIDE fire map.
 * Loads GeoJSON point data and renders as clustered markers.
 *
 * TODO: migrate filtering, FRP color scale, pixel footprint, etc. from SFIDE_web.html
 */
(function () {

    var clusterGroup = null;
    var visible      = false;  // off by default (LFMC is primary)
    var data         = null;

    /* ── Sidebar controls ──────────────────────────────────────── */

    function buildControls(map) {
        var container = document.getElementById('layer-controls');
        var section = document.createElement('div');
        section.id = 'fire-controls';
        section.className = 'border-t pt-4 mt-4 hidden';
        section.innerHTML =
            '<h2 class="text-sm font-semibold text-gray-700 mb-2">Fire Hotspots (SFIDE)</h2>' +
            '<p class="text-xs text-gray-500 mb-2">Near-real-time fire detections from MSG/MTG satellites.</p>' +
            '<div class="mb-3">' +
            '  <label class="block text-xs font-medium text-gray-600 mb-1">Time Window</label>' +
            '  <div class="grid grid-cols-4 gap-1">' +
            '    <button class="fire-time-btn px-2 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200" data-hours="6">6h</button>' +
            '    <button class="fire-time-btn px-2 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200" data-hours="12">12h</button>' +
            '    <button class="fire-time-btn px-2 py-1.5 text-xs font-medium text-blue-700 bg-blue-100 rounded hover:bg-blue-200" data-hours="24">24h</button>' +
            '    <button class="fire-time-btn px-2 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200" data-hours="72">72h</button>' +
            '  </div>' +
            '</div>' +
            '<p class="text-xs text-gray-400">Full filtering will be added when migrating from the SFIDE app.</p>';

        container.appendChild(section);
    }

    /* ── Data loading ──────────────────────────────────────────── */

    function loadData(url) {
        EV.showLoading('Loading fire hotspots...');
        return fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (geojson) {
                data = geojson;
                EV.hideLoading();
                return geojson;
            })
            .catch(function (err) {
                console.warn('[FIRE] data load error:', err);
                EV.hideLoading();
            });
    }

    /* ── Rendering ─────────────────────────────────────────────── */

    function render(geojson, map) {
        if (clusterGroup) map.removeLayer(clusterGroup);
        clusterGroup = L.markerClusterGroup({
            maxClusterRadius: 40,
            disableClusteringAtZoom: 12,
        });

        L.geoJSON(geojson, {
            pointToLayer: function (feature, latlng) {
                return L.circleMarker(latlng, {
                    radius: 5,
                    fillColor: '#e63946',
                    color: '#fff',
                    weight: 1,
                    fillOpacity: 0.85,
                });
            },
            onEachFeature: function (feature, layer) {
                var p = feature.properties || {};
                layer.bindPopup(
                    '<h3>Fire Hotspot</h3>' +
                    '<table>' +
                    '<tr><th>Time (UTC)</th><td>' + (p.DATETIME || '—') + '</td></tr>' +
                    '<tr><th>Satellite</th><td>' + (p.SATELLITE || '—') + '</td></tr>' +
                    '<tr><th>Confidence</th><td>' + (p.CONFIDENCE || '—') + '%</td></tr>' +
                    '<tr><th>FRP</th><td>' + (p.FRP_WOOSTER || p.FRP_MODIS || '—') + ' MW</td></tr>' +
                    '</table>'
                );
            }
        }).addTo(clusterGroup);

        if (visible) clusterGroup.addTo(map);
    }

    /* ── Visibility ────────────────────────────────────────────── */

    function setVisible(v, map) {
        visible = v;
        var ctrl = document.getElementById('fire-controls');
        if (v) {
            ctrl.classList.remove('hidden');
            if (clusterGroup) clusterGroup.addTo(map);
        } else {
            ctrl.classList.add('hidden');
            if (clusterGroup) map.removeLayer(clusterGroup);
        }
    }

    /* ── Public API ────────────────────────────────────────────── */

    EV.fireHotspots = {
        id: 'fire',
        name: 'Fire Hotspots',
        type: 'point',
        defaultVisible: false,

        init: function (map, dataBaseUrl) {
            buildControls(map);
            return loadData(dataBaseUrl + '/fire/sfide_aggregate_72h.geojson')
                .then(function (geojson) {
                    if (geojson) render(geojson, map);
                })
                .catch(function () {
                    // Fire data may not be available yet — that's fine
                    console.info('[FIRE] No fire data available (this is OK if not yet set up).');
                });
        },

        setVisible: setVisible,
    };

})();
