/**
 * EOSIAL Viewer — main application
 *
 * Initialises the Leaflet map, registers layers, wires sidebar and query tools.
 */
(function () {

    /* ── Configuration ─────────────────────────────────────────── */

    // Base URL for data files.  When hosted on GitHub Pages this is just 'data'.
    // Override by setting window.EOSIAL_DATA_URL before this script loads.
    var DATA_BASE = window.EOSIAL_DATA_URL || 'data';

    // Registered layers (populated below)
    var layers = [];

    /* ── Map setup ─────────────────────────────────────────────── */

    var map = L.map('map', {
        center: [42.0, 12.5],   // default: Italy
        zoom: 6,
        zoomControl: false,
    });

    // Basemaps
    var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
    });
    var googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        attribution: '&copy; Google',
        maxZoom: 20,
    });
    var topoMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenTopoMap',
        maxZoom: 17,
    });
    var cartoDark = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO',
        maxZoom: 20,
    });
    var cartoLight = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO',
        maxZoom: 20,
    });

    // Default basemap
    cartoLight.addTo(map);

    var basemaps = {
        'Light (CartoDB)': cartoLight,
        'OpenStreetMap': osm,
        'Satellite (Google)': googleHybrid,
        'Topographic': topoMap,
        'Dark (CartoDB)': cartoDark,
    };

    // Unified toolbar (replaces separate zoom / layers / geocoder controls)
    var toolbar = L.control({ position: 'topright' });
    toolbar.onAdd = function () {
        var wrap = L.DomUtil.create('div', 'map-toolbar leaflet-bar');
        L.DomEvent.disableClickPropagation(wrap);
        L.DomEvent.disableScrollPropagation(wrap);

        // ── Zoom In
        var btnZoomIn = _tbBtn(wrap, '+',
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 12h14"/></svg>',
            'Zoom in');
        btnZoomIn.addEventListener('click', function () { map.zoomIn(); });

        // ── Zoom Out
        var btnZoomOut = _tbBtn(wrap, '\u2212',
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14"/></svg>',
            'Zoom out');
        btnZoomOut.addEventListener('click', function () { map.zoomOut(); });

        // ── Basemap picker
        var basemapWrap = document.createElement('div');
        basemapWrap.style.position = 'relative';
        wrap.appendChild(basemapWrap);

        var btnLayers = _tbBtn(basemapWrap, '',
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>',
            'Basemaps');

        var dropdown = document.createElement('div');
        dropdown.className = 'basemap-dropdown';
        basemapWrap.appendChild(dropdown);

        var activeBasemap = 'Light (CartoDB)';
        Object.keys(basemaps).forEach(function (name) {
            var opt = document.createElement('button');
            opt.className = 'basemap-option' + (name === activeBasemap ? ' active' : '');
            opt.textContent = name;
            opt.addEventListener('click', function () {
                Object.keys(basemaps).forEach(function (k) { map.removeLayer(basemaps[k]); });
                basemaps[name].addTo(map);
                activeBasemap = name;
                dropdown.querySelectorAll('.basemap-option').forEach(function (el) {
                    el.classList.toggle('active', el.textContent === name);
                });
                dropdown.classList.remove('open');
            });
            dropdown.appendChild(opt);
        });

        btnLayers.addEventListener('click', function () {
            dropdown.classList.toggle('open');
            geocoderWrap.classList.remove('open');
        });

        // ── Search (geocoder)
        var searchWrap = document.createElement('div');
        searchWrap.style.position = 'relative';
        wrap.appendChild(searchWrap);

        var btnSearch = _tbBtn(searchWrap, '',
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>',
            'Search location');

        var geocoderWrap = document.createElement('div');
        geocoderWrap.className = 'toolbar-geocoder';
        searchWrap.appendChild(geocoderWrap);

        var searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search location...';
        geocoderWrap.appendChild(searchInput);

        var resultsDiv = document.createElement('div');
        resultsDiv.className = 'geocoder-results';
        geocoderWrap.appendChild(resultsDiv);

        var searchTimeout = null;

        searchInput.addEventListener('input', function () {
            var q = this.value.trim();
            clearTimeout(searchTimeout);
            resultsDiv.innerHTML = '';
            if (q.length < 3) return;
            searchTimeout = setTimeout(function () {
                fetch('https://nominatim.openstreetmap.org/search?format=json&limit=5&q=' + encodeURIComponent(q))
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        resultsDiv.innerHTML = '';
                        (data || []).forEach(function (r) {
                            var item = document.createElement('div');
                            item.className = 'geocoder-result';
                            item.textContent = r.display_name;
                            item.addEventListener('click', function () {
                                var bbox = [
                                    [parseFloat(r.boundingbox[0]), parseFloat(r.boundingbox[2])],
                                    [parseFloat(r.boundingbox[1]), parseFloat(r.boundingbox[3])]
                                ];
                                map.fitBounds(bbox);
                                geocoderWrap.classList.remove('open');
                                searchInput.value = '';
                                resultsDiv.innerHTML = '';
                            });
                            resultsDiv.appendChild(item);
                        });
                    })
                    .catch(function (err) { console.warn('[Search]', err); });
            }, 400);
        });

        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                geocoderWrap.classList.remove('open');
                searchInput.value = '';
                resultsDiv.innerHTML = '';
            }
        });

        btnSearch.addEventListener('click', function () {
            geocoderWrap.classList.toggle('open');
            dropdown.classList.remove('open');
            if (geocoderWrap.classList.contains('open')) {
                setTimeout(function () { searchInput.focus(); }, 50);
            }
        });

        // ── Query Point
        var btnQueryPt = _tbBtn(wrap, '',
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3" stroke-width="2"/></svg>',
            'Query point timeseries');
        btnQueryPt.id = 'btn-draw-point';
        btnQueryPt.addEventListener('click', function () {
            dropdown.classList.remove('open');
            geocoderWrap.classList.remove('open');
        });

        // ── Query Polygon
        var btnQueryPoly = _tbBtn(wrap, '',
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4h16v16H4z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9h6v6H9z" stroke-dasharray="2,2"/></svg>',
            'Query polygon timeseries');
        btnQueryPoly.id = 'btn-draw-polygon';
        btnQueryPoly.addEventListener('click', function () {
            dropdown.classList.remove('open');
            geocoderWrap.classList.remove('open');
        });

        // ── Dark mode toggle
        var btnDark = _tbBtn(wrap, '',
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/></svg>',
            'Toggle dark mode');
        btnDark.addEventListener('click', function () {
            document.body.classList.toggle('dark');
            btnDark.classList.toggle('active', document.body.classList.contains('dark'));
            dropdown.classList.remove('open');
            geocoderWrap.classList.remove('open');
        });

        // ── Measure distance
        var btnMeasure = _tbBtn(wrap, '',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="1" y="6" width="22" height="12" rx="1" transform="rotate(-45 12 12)"/>' +
            '<line x1="6.5" y1="10" x2="6.5" y2="14" transform="rotate(-45 12 12)"/>' +
            '<line x1="10" y1="10" x2="10" y2="12.5" transform="rotate(-45 12 12)"/>' +
            '<line x1="13.5" y1="10" x2="13.5" y2="14" transform="rotate(-45 12 12)"/>' +
            '<line x1="17" y1="10" x2="17" y2="12.5" transform="rotate(-45 12 12)"/>' +
            '</svg>',
            'Measure distance');

        btnMeasure.addEventListener('click', function () {
            toggleMeasure(btnMeasure);
            dropdown.classList.remove('open');
            geocoderWrap.classList.remove('open');
        });

        // Close dropdowns when clicking elsewhere on the map
        map.on('click', function () {
            dropdown.classList.remove('open');
            geocoderWrap.classList.remove('open');
        });

        return wrap;
    };
    toolbar.addTo(map);

    function _tbBtn(parent, text, svgHtml, title) {
        var btn = document.createElement('button');
        btn.className = 'toolbar-btn';
        btn.title = title || '';
        btn.innerHTML = svgHtml || text;
        parent.appendChild(btn);
        return btn;
    }

    /* ── Measure distance tool ─────────────────────────────────── */

    var measureActive = false;
    var measurePoints = [];
    var measureMarkers = [];
    var measureLines = null;
    var measureTooltips = [];

    function toggleMeasure(btn) {
        measureActive = !measureActive;
        btn.classList.toggle('active', measureActive);
        document.body.classList.toggle('querying', measureActive);

        if (measureActive) {
            // Cancel point query if active
            pointQueryActive = false;
            document.getElementById('btn-draw-point').classList.remove('active');
            // Cancel polygon mode if active
            if (drawControl) {
                map.removeControl(drawControl);
                drawControl = null;
                document.getElementById('btn-draw-polygon').classList.remove('active');
            }
            map.doubleClickZoom.disable();
            clearMeasure();
        } else {
            map.doubleClickZoom.enable();
        }
    }

    function clearMeasure() {
        measurePoints = [];
        measureMarkers.forEach(function (m) { map.removeLayer(m); });
        measureMarkers = [];
        if (measureLines) { map.removeLayer(measureLines); measureLines = null; }
        measureTooltips.forEach(function (t) { map.removeLayer(t); });
        measureTooltips = [];
    }

    function formatDistance(meters) {
        if (meters >= 1000) return (meters / 1000).toFixed(2) + ' km';
        return Math.round(meters) + ' m';
    }

    map.on('click', function (e) {
        if (!measureActive) return;

        measurePoints.push(e.latlng);

        // Add a small circle marker at the click point
        var marker = L.circleMarker(e.latlng, {
            radius: 4, color: '#2563eb', fillColor: '#2563eb',
            fillOpacity: 1, weight: 2
        }).addTo(map);
        measureMarkers.push(marker);

        // Update polyline
        if (measureLines) map.removeLayer(measureLines);
        measureLines = L.polyline(measurePoints, {
            color: '#2563eb', weight: 2.5, dashArray: '6,6'
        }).addTo(map);

        // Show segment distance
        if (measurePoints.length >= 2) {
            var prev = measurePoints[measurePoints.length - 2];
            var curr = measurePoints[measurePoints.length - 1];
            var segDist = prev.distanceTo(curr);

            // Total distance
            var totalDist = 0;
            for (var i = 1; i < measurePoints.length; i++) {
                totalDist += measurePoints[i - 1].distanceTo(measurePoints[i]);
            }

            var midLat = (prev.lat + curr.lat) / 2;
            var midLng = (prev.lng + curr.lng) / 2;

            var label = formatDistance(segDist);
            if (measurePoints.length > 2) {
                label += '  (total: ' + formatDistance(totalDist) + ')';
            }

            var tooltip = L.marker([midLat, midLng], {
                icon: L.divIcon({
                    className: 'measure-tooltip',
                    html: label,
                    iconSize: null,
                    iconAnchor: [0, -10]
                })
            }).addTo(map);
            measureTooltips.push(tooltip);
        }
    });

    // Double-click finishes the measurement
    map.on('dblclick', function () {
        if (!measureActive) return;
        measureActive = false;
        map.doubleClickZoom.enable();
        document.body.classList.remove('querying');
        var btn = document.querySelector('.map-toolbar .toolbar-btn.active');
        if (btn) btn.classList.remove('active');
    });

    /* ── Layer registration ────────────────────────────────────── */

    function registerLayer(layerDef) {
        layers.push(layerDef);
    }

    function buildLayerToggles() {
        var container = document.getElementById('layer-toggles');
        container.innerHTML = '';
        layers.forEach(function (lyr) {
            var label = document.createElement('label');
            label.className = 'layer-toggle';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = lyr.defaultVisible;
            cb.addEventListener('change', function () {
                lyr.setVisible(this.checked, map);
            });
            var span = document.createElement('span');
            span.className = 'layer-name';
            span.textContent = lyr.name;
            label.appendChild(cb);
            label.appendChild(span);
            container.appendChild(label);
        });
    }

    /* ── Query tools (point + polygon) ─────────────────────────── */

    var drawControl = null;
    var drawnItems  = new L.FeatureGroup();
    map.addLayer(drawnItems);

    // Point query
    var pointQueryActive = false;

    document.getElementById('btn-draw-point').addEventListener('click', function () {
        pointQueryActive = !pointQueryActive;
        this.classList.toggle('active', pointQueryActive);
        document.body.classList.toggle('querying', pointQueryActive);
        // Cancel polygon mode
        if (pointQueryActive && drawControl) {
            map.removeControl(drawControl);
            drawControl = null;
            document.getElementById('btn-draw-polygon').classList.remove('active');
        }
        // Cancel measure mode
        if (pointQueryActive && measureActive) {
            measureActive = false;
            document.querySelector('#btn-measure, .map-toolbar .toolbar-btn.active') &&
                document.querySelectorAll('.map-toolbar .toolbar-btn.active').forEach(function (b) {
                    if (b.id !== 'btn-draw-point') b.classList.remove('active');
                });
        }
    });

    map.on('click', function (e) {
        if (!pointQueryActive || measureActive) return;
        pointQueryActive = false;
        document.getElementById('btn-draw-point').classList.remove('active');
        document.body.classList.remove('querying');

        // Query the active raster layer
        if (EV.lfmc && EV.lfmc.getDates().length) {
            var marker = L.marker(e.latlng).addTo(drawnItems);
            EV.lfmc.queryPoint(e.latlng, map).then(function (series) {
                drawnItems.removeLayer(marker);
                if (!series.length) {
                    alert('No LFMC data at this location.');
                    return;
                }
                var infoHtml = 'Lat: ' + e.latlng.lat.toFixed(5) +
                               ', Lon: ' + e.latlng.lng.toFixed(5) +
                               '<br>Dates with data: ' + series.length;
                EV.showTimeseries(
                    'LFMC at Point',
                    series,
                    { unit: '%', label: 'LFMC (%)', color: '#2563eb', info: infoHtml }
                );
            });
        }
    });

    // Polygon query (rectangle)
    document.getElementById('btn-draw-polygon').addEventListener('click', function () {
        if (pointQueryActive) {
            pointQueryActive = false;
            document.getElementById('btn-draw-point').classList.remove('active');
        }
        // Cancel measure mode
        if (measureActive) {
            measureActive = false;
            document.querySelectorAll('.map-toolbar .toolbar-btn.active').forEach(function (b) {
                if (b.id !== 'btn-draw-polygon') b.classList.remove('active');
            });
        }

        if (drawControl) {
            map.removeControl(drawControl);
            drawControl = null;
            this.classList.remove('active');
            document.body.classList.remove('querying');
            return;
        }

        this.classList.add('active');
        document.body.classList.add('querying');

        drawControl = new L.Control.Draw({
            draw: {
                rectangle: true,
                polygon: false, polyline: false, circle: false,
                circlemarker: false, marker: false,
            },
            edit: false,
        });
        map.addControl(drawControl);
        // Programmatically activate the rectangle tool
        new L.Draw.Rectangle(map, drawControl.options.draw.rectangle).enable();
    });

    map.on(L.Draw.Event.CREATED, function (e) {
        if (drawControl) {
            map.removeControl(drawControl);
            drawControl = null;
        }
        document.getElementById('btn-draw-polygon').classList.remove('active');
        document.body.classList.remove('querying');

        var bounds = e.layer.getBounds();
        drawnItems.addLayer(e.layer);

        if (EV.lfmc && EV.lfmc.getDates().length) {
            EV.lfmc.queryPolygon(bounds, map).then(function (series) {
                drawnItems.removeLayer(e.layer);
                if (!series.length) {
                    alert('No LFMC data in this area.');
                    return;
                }
                var area = bounds.getSouthWest().distanceTo(bounds.getSouthEast()) *
                           bounds.getSouthWest().distanceTo(bounds.getNorthWest()) / 1e6;
                var infoHtml = 'Area: ~' + area.toFixed(2) + ' km&sup2;' +
                               '<br>Dates with data: ' + series.length;
                EV.showTimeseries(
                    'LFMC — Polygon Mean',
                    series,
                    { unit: '%', label: 'LFMC (%)', color: '#059669', info: infoHtml }
                );
            });
        }
    });

    /* ── Copy shareable link ───────────────────────────────────── */

    document.getElementById('btn-copy-link').addEventListener('click', function () {
        var c = map.getCenter();
        var url = location.origin + location.pathname +
                  '?lat=' + c.lat.toFixed(5) + '&lng=' + c.lng.toFixed(5) +
                  '&z=' + map.getZoom();
        // Include current LFMC state
        var curDate = EV.lfmc.getCurrentDate && EV.lfmc.getCurrentDate();
        if (curDate) url += '&date=' + curDate;
        var aoiSel = document.getElementById('lfmc-aoi-select');
        if (aoiSel && aoiSel.value) url += '&aoi=' + encodeURIComponent(aoiSel.value);
        navigator.clipboard.writeText(url).then(function () {
            alert('Link copied to clipboard!');
        });
    });

    /* ── About modal ───────────────────────────────────────────── */

    document.getElementById('btn-about').addEventListener('click', function () {
        document.getElementById('about-modal').classList.remove('hidden');
    });
    document.getElementById('about-modal-close').addEventListener('click', function () {
        document.getElementById('about-modal').classList.add('hidden');
    });
    document.getElementById('about-modal').addEventListener('click', function (e) {
        if (e.target === this) this.classList.add('hidden');
    });

    /* ── URL params ────────────────────────────────────────────── */

    function applyUrlParams() {
        var params = new URLSearchParams(location.search);
        var lat = parseFloat(params.get('lat'));
        var lng = parseFloat(params.get('lng'));
        var z   = parseInt(params.get('z'));
        if (!isNaN(lat) && !isNaN(lng)) map.setView([lat, lng], isNaN(z) ? 10 : z);

        // Store for later use after LFMC init
        EV._urlAoi  = params.get('aoi')  || null;
        EV._urlDate = params.get('date') || null;
    }

    /* ── Cursor info (coords + hover value) ───────────────────── */

    var coordsEl = document.getElementById('cursor-coords');
    var valueEl  = document.getElementById('cursor-value');

    map.on('mousemove', EV.debounce(function (e) {
        coordsEl.textContent = e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5);

        if (EV.lfmc && EV.lfmc.getValueAt) {
            var v = EV.lfmc.getValueAt(e.latlng);
            valueEl.textContent = v !== null ? 'LFMC: ' + Math.round(v) + ' %' : '';
        }
    }, 30));

    map.on('mouseout', function () {
        coordsEl.textContent = '—';
        valueEl.textContent = '';
    });

    /* ── Loading skeleton ──────────────────────────────────────── */

    var skeletonEl = document.getElementById('loading-skeleton');
    EV._showLoadingOrig = EV.showLoading;
    EV.showLoading = function (msg) {
        EV._showLoadingOrig(msg);
        if (msg && msg.indexOf('raster') !== -1) {
            skeletonEl.classList.remove('hidden');
        }
    };
    EV._hideLoadingOrig = EV.hideLoading;
    EV.hideLoading = function () {
        EV._hideLoadingOrig();
        skeletonEl.classList.add('hidden');
    };

    /* ── Smooth sidebar toggle ─────────────────────────────────── */

    // Override sidebar toggle for smooth map resize
    var panelOpen = true;
    var panel = document.getElementById('control-panel');
    var toggleBtn = document.getElementById('toggle-panel-btn');
    var toggleIcon = document.getElementById('toggle-panel-icon');

    toggleBtn.addEventListener('click', function () {
        panelOpen = !panelOpen;
        if (panelOpen) {
            panel.classList.remove('-translate-x-full');
            panel.classList.add('sm:translate-x-0');
            toggleBtn.style.left = '';
            toggleBtn.classList.add('sm:left-80');
            toggleIcon.style.transform = '';
        } else {
            panel.classList.add('-translate-x-full');
            panel.classList.remove('sm:translate-x-0');
            toggleBtn.classList.remove('sm:left-80');
            toggleBtn.style.left = '0';
            toggleIcon.style.transform = 'rotate(180deg)';
        }
        // Let the CSS transition finish, then tell the map to recalculate
        setTimeout(function () { map.invalidateSize({ animate: true }); }, 320);
    });

    /* ── Boot ──────────────────────────────────────────────────── */

    applyUrlParams();

    // Register layers
    registerLayer(EV.lfmc);
    registerLayer(EV.fireHotspots);
    buildLayerToggles();

    // Initialise layers
    EV.lfmc.init(map, DATA_BASE);
    EV.fireHotspots.init(map, DATA_BASE);

})();
