/**
 * EOSIAL Active Fire Viewer — Administrative Boundaries (L0)
 *
 * EV.adminL0 — country outlines (world-atlas 50m TopoJSON via jsDelivr)
 *
 * Renders in a custom 'adminPane' (z-index 450) below fire hotspot markers (~600).
 * Data is lazy-loaded on first toggle.
 *
 * For higher-resolution borders, download ne_10m_admin_0_countries.shp
 * from naturalearthdata.com, convert to GeoJSON, place in data/boundaries/,
 * and change COUNTRIES_URL to 'data/boundaries/countries-10m.geojson'.
 */
(function () {

    var COUNTRIES_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';

    var PANE = 'adminPane';

    var L0_STYLE = { color: '#555', weight: 1.2, fill: false, opacity: 0.75 };

    /* ── Shared pane ───────────────────────────────────────────── */

    function ensurePane(map) {
        if (!map.getPane(PANE)) {
            var p = map.createPane(PANE);
            p.style.zIndex = 450;
            p.style.pointerEvents = 'none';
        }
    }

    /* ── L0 — Countries ────────────────────────────────────────── */

    var l0Layer   = null;
    var l0Loaded  = false;
    var l0Visible = false;

    function loadL0(map) {
        EV.showLoading('Loading country boundaries...');
        fetch(COUNTRIES_URL)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (world) {
                var fc = topojson.feature(world, world.objects.countries);
                l0Layer  = L.geoJSON(fc, { style: L0_STYLE, pane: PANE });
                l0Loaded = true;
                EV.hideLoading();
                if (l0Visible) l0Layer.addTo(map);
            })
            .catch(function (err) {
                console.error('[ADMIN L0]', err);
                EV.hideLoading();
            });
    }

    /* ── Public API ────────────────────────────────────────────── */

    EV.adminL0 = {
        id: 'admin-l0',
        name: 'Country Borders',
        defaultVisible: false,
        init: function (map) {
            ensurePane(map);
            return Promise.resolve();
        },
        setVisible: function (v, map) {
            l0Visible = v;
            if (v && !l0Loaded) { loadL0(map); return; }
            if (l0Loaded && l0Layer) {
                if (v) l0Layer.addTo(map);
                else    map.removeLayer(l0Layer);
            }
        }
    };

})();
