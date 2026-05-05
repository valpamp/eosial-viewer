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
    osm.addTo(map);

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

        var activeBasemap = 'OpenStreetMap';
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

        // ── Screenshot
        var ssWrap = document.createElement('div');
        ssWrap.style.position = 'relative';
        wrap.appendChild(ssWrap);

        var btnScreenshot = _tbBtn(ssWrap, '',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>' +
            '<circle cx="12" cy="13" r="4"/></svg>',
            'Take screenshot');

        var ssDropdown = document.createElement('div');
        ssDropdown.className = 'ss-dropdown';
        ssWrap.appendChild(ssDropdown);

        // Title input
        var ssTitleWrap = document.createElement('div');
        ssTitleWrap.className = 'ss-field';
        ssTitleWrap.innerHTML = '<div class="ss-field-label">Title (optional)</div>';
        var ssTitleInput = document.createElement('input');
        ssTitleInput.type = 'text';
        ssTitleInput.className = 'ss-title-input';
        ssTitleInput.placeholder = 'Map title\u2026';
        ssTitleWrap.appendChild(ssTitleInput);
        ssDropdown.appendChild(ssTitleWrap);

        // Scale buttons
        var ssScaleWrap = document.createElement('div');
        ssScaleWrap.className = 'ss-field';
        ssScaleWrap.innerHTML = '<div class="ss-field-label">Resolution</div>';
        var ssScaleRow = document.createElement('div');
        ssScaleRow.className = 'ss-scale-row';
        ssScaleWrap.appendChild(ssScaleRow);
        ssDropdown.appendChild(ssScaleWrap);

        var ssScale = 1;
        [1, 2, 3].forEach(function (n) {
            var btn = document.createElement('button');
            btn.className = 'ss-scale-btn' + (n === 1 ? ' active' : '');
            btn.textContent = n + '\xd7';
            btn.addEventListener('click', function () {
                ssScale = n;
                ssScaleRow.querySelectorAll('.ss-scale-btn').forEach(function (b) {
                    b.classList.toggle('active', b === btn);
                });
            });
            ssScaleRow.appendChild(btn);
        });

        // Divider
        var ssDivider = document.createElement('div');
        ssDivider.className = 'ss-divider';
        ssDropdown.appendChild(ssDivider);

        var btnSSFull = document.createElement('button');
        btnSSFull.className = 'ss-option';
        btnSSFull.textContent = 'Download map view';
        btnSSFull.addEventListener('click', function () {
            ssDropdown.classList.remove('open');
            captureMapScreenshot(null, { title: ssTitleInput.value.trim(), scale: ssScale });
        });
        ssDropdown.appendChild(btnSSFull);

        var btnSSArea = document.createElement('button');
        btnSSArea.className = 'ss-option';
        btnSSArea.textContent = 'Select area\u2026';
        btnSSArea.addEventListener('click', function () {
            activateScreenshotSelect(ssDropdown, { title: ssTitleInput.value.trim(), scale: ssScale });
        });
        ssDropdown.appendChild(btnSSArea);

        btnScreenshot.addEventListener('click', function () {
            ssDropdown.classList.toggle('open');
            dropdown.classList.remove('open');
            geocoderWrap.classList.remove('open');
        });

        // Close dropdowns when clicking elsewhere on the map
        map.on('click', function () {
            dropdown.classList.remove('open');
            geocoderWrap.classList.remove('open');
            ssDropdown.classList.remove('open');
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

    /* ── Screenshot tool ───────────────────────────────────────── */

    var ssSelecting = false;
    var ssStartX = 0, ssStartY = 0;
    var ssOverlay = document.getElementById('screenshot-overlay');
    var ssSel     = document.getElementById('screenshot-sel');

    function _niceTickStep(range) {
        var steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 45, 60, 90];
        var target = range / 5;
        for (var i = 0; i < steps.length; i++) {
            if (steps[i] >= target) return steps[i];
        }
        return 90;
    }

    function _fmtLat(v) {
        var n = Math.abs(v);
        return (n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)) + '\u00b0' + (v >= 0 ? 'N' : 'S');
    }

    function _fmtLon(v) {
        var n = Math.abs(v);
        return (n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)) + '\u00b0' + (v >= 0 ? 'E' : 'W');
    }

    function _addTicksToCanvas(srcCanvas, bounds, cropOffX, cropOffY, scale, title) {
        cropOffX = cropOffX || 0;
        cropOffY = cropOffY || 0;
        scale    = scale    || 1;
        title    = title    || '';

        // All margin/font values are in output-canvas pixels (already scaled by html2canvas)
        var s  = scale;
        var ML = Math.round(54 * s), MB = Math.round(26 * s);
        var MR = Math.round(4  * s), MT = Math.round(6  * s);
        var TH = title ? Math.round(32 * s) : 0;   // title bar height

        var w = srcCanvas.width, h = srcCanvas.height;
        var dst = document.createElement('canvas');
        dst.width  = w + ML + MR;
        dst.height = h + MT + MB + TH;
        var ctx = dst.getContext('2d');

        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, dst.width, dst.height);

        // Optional title
        if (title) {
            ctx.fillStyle   = '#1f2937';
            ctx.font        = 'bold ' + Math.round(13 * s) + 'px Arial, sans-serif';
            ctx.textAlign   = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(title, dst.width / 2, TH / 2);
        }

        // Map image
        ctx.drawImage(srcCanvas, ML, TH + MT);

        // Border
        ctx.strokeStyle = '#888';
        ctx.lineWidth   = Math.max(1, s);
        ctx.strokeRect(ML + 0.5, TH + MT + 0.5, w, h);

        ctx.font        = Math.round(10 * s) + 'px Arial, sans-serif';
        ctx.strokeStyle = '#555';
        ctx.fillStyle   = '#222';
        ctx.lineWidth   = Math.max(1, s);

        var latRange = bounds.getNorth() - bounds.getSouth();
        var lonRange = bounds.getEast()  - bounds.getWest();
        var latStep  = _niceTickStep(latRange);
        var lonStep  = _niceTickStep(lonRange);

        // Latitude ticks — left margin
        var latStart = Math.ceil(bounds.getSouth() / latStep) * latStep;
        for (var lat = latStart; lat <= bounds.getNorth() + 1e-9; lat += latStep) {
            var lpt = map.latLngToContainerPoint([lat, bounds.getWest()]);
            var py  = (lpt.y - cropOffY) * s + TH + MT;
            if (py < TH + MT || py > TH + MT + h) continue;
            ctx.beginPath();
            ctx.moveTo(ML, py); ctx.lineTo(ML - 5 * s, py); ctx.stroke();
            ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
            ctx.fillText(_fmtLat(lat), ML - 7 * s, py);
        }

        // Longitude ticks — bottom margin
        var lonStart = Math.ceil(bounds.getWest() / lonStep) * lonStep;
        for (var lon = lonStart; lon <= bounds.getEast() + 1e-9; lon += lonStep) {
            var opt = map.latLngToContainerPoint([bounds.getSouth(), lon]);
            var px  = (opt.x - cropOffX) * s + ML;
            if (px < ML || px > ML + w) continue;
            ctx.beginPath();
            ctx.moveTo(px, TH + MT + h); ctx.lineTo(px, TH + MT + h + 5 * s); ctx.stroke();
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText(_fmtLon(lon), px, TH + MT + h + 6 * s);
        }

        // Watermark
        ctx.fillStyle    = '#aaa';
        ctx.font         = Math.round(8 * s) + 'px Arial, sans-serif';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('EOSIAL Viewer \u2014 ' + new Date().toISOString().substring(0, 10),
                     ML + 4 * s, TH + MT + h - 3 * s);

        return dst;
    }

    function captureMapScreenshot(cropRect, opts) {
        opts = opts || {};
        var scale = opts.scale || 1;
        var title = opts.title || '';

        var mapEl = document.getElementById('map');
        var currentBounds = map.getBounds();

        html2canvas(mapEl, {
            useCORS:    true,
            allowTaint: false,
            scale:      scale,
            backgroundColor: null,
            logging:    false,
            onclone: function (clonedDoc) {
                var tb = clonedDoc.querySelector('.map-toolbar');
                if (tb) tb.style.display = 'none';
            }
        }).then(function (canvas) {
            var srcCanvas, finalBounds, offX, offY;

            if (cropRect) {
                // Crop: the html2canvas output is at `scale` pixels per CSS pixel
                var c = document.createElement('canvas');
                c.width  = cropRect.w * scale;
                c.height = cropRect.h * scale;
                c.getContext('2d').drawImage(canvas, -cropRect.x * scale, -cropRect.y * scale);
                srcCanvas   = c;
                var sw = map.containerPointToLatLng([cropRect.x,              cropRect.y + cropRect.h]);
                var ne = map.containerPointToLatLng([cropRect.x + cropRect.w, cropRect.y]);
                finalBounds = L.latLngBounds(sw, ne);
                offX = cropRect.x;
                offY = cropRect.y;
            } else {
                srcCanvas   = canvas;
                finalBounds = currentBounds;
                offX = 0;
                offY = 0;
            }

            var out = _addTicksToCanvas(srcCanvas, finalBounds, offX, offY, scale, title);
            var a = document.createElement('a');
            a.href     = out.toDataURL('image/png');
            a.download = 'eosial-map-' + new Date().toISOString().substring(0, 10) + '.png';
            a.click();
        }).catch(function (err) {
            console.error('[SCREENSHOT]', err);
            alert('Screenshot failed. Some tile layers may not support cross-origin capture.');
        });
    }

    function activateScreenshotSelect(ssDropdown, opts) {
        ssDropdown.classList.remove('open');
        ssSelecting = false;
        ssOverlay.classList.remove('hidden');
        ssSel.classList.add('hidden');

        function onDown(e) {
            ssSelecting = true;
            var r = ssOverlay.getBoundingClientRect();
            ssStartX = e.clientX - r.left;
            ssStartY = e.clientY - r.top;
            ssSel.style.left   = ssStartX + 'px';
            ssSel.style.top    = ssStartY + 'px';
            ssSel.style.width  = '0px';
            ssSel.style.height = '0px';
            ssSel.classList.remove('hidden');
        }
        function onMove(e) {
            if (!ssSelecting) return;
            var r = ssOverlay.getBoundingClientRect();
            var x = e.clientX - r.left, y = e.clientY - r.top;
            ssSel.style.left   = Math.min(x, ssStartX) + 'px';
            ssSel.style.top    = Math.min(y, ssStartY) + 'px';
            ssSel.style.width  = Math.abs(x - ssStartX) + 'px';
            ssSel.style.height = Math.abs(y - ssStartY) + 'px';
        }
        function onUp(e) {
            if (!ssSelecting) return;
            ssSelecting = false;
            ssOverlay.classList.add('hidden');
            ssSel.classList.add('hidden');
            ssOverlay.removeEventListener('mousedown', onDown);
            ssOverlay.removeEventListener('mousemove', onMove);
            ssOverlay.removeEventListener('mouseup',   onUp);
            var r = ssOverlay.getBoundingClientRect();
            var x = e.clientX - r.left, y = e.clientY - r.top;
            var cropX = Math.round(Math.min(x, ssStartX));
            var cropY = Math.round(Math.min(y, ssStartY));
            var cropW = Math.round(Math.abs(x - ssStartX));
            var cropH = Math.round(Math.abs(y - ssStartY));
            if (cropW < 30 || cropH < 30) return; // too small — ignore
            captureMapScreenshot({ x: cropX, y: cropY, w: cropW, h: cropH }, opts);
        }

        ssOverlay.addEventListener('mousedown', onDown);
        ssOverlay.addEventListener('mousemove', onMove);
        ssOverlay.addEventListener('mouseup',   onUp);
    }

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

        var area = bounds.getSouthWest().distanceTo(bounds.getSouthEast()) *
                   bounds.getSouthWest().distanceTo(bounds.getNorthWest()) / 1e6;

        // Check which layers are active and query accordingly
        var lfmcActive = EV.lfmc && EV.lfmc.getDates().length;
        var fireActive = EV.fireHotspots && document.getElementById('fire-controls') &&
                         !document.getElementById('fire-controls').classList.contains('hidden');

        if (fireActive) {
            var fireSeries = EV.fireHotspots.queryPolygon(bounds);
            if (fireSeries.length) {
                drawnItems.removeLayer(e.layer);
                var fireDetections = fireSeries.reduce(function (sum, item) {
                    return sum + (item.detections || 1);
                }, 0);
                var infoHtml = 'Area: ~' + area.toFixed(2) + ' km&sup2;' +
                               '<br>Detections in area: ' + fireDetections +
                               '<br>Acquisition times plotted: ' + fireSeries.length;
                if (fireSeries.satelliteDetections) {
                    var satelliteInfo = Object.keys(fireSeries.satelliteDetections).sort().map(function (sat) {
                        return sat + ': ' + fireSeries.satelliteDetections[sat];
                    }).join(', ');
                    if (satelliteInfo) infoHtml += '<br>Satellites: ' + satelliteInfo;
                }
                EV.showTimeseries(
                    'FRP — Polygon',
                    fireSeries,
                    {
                        unit: 'MW',
                        label: 'Cumulative FRP [MW]',
                        yLabel: 'Cumulative FRP [MW]',
                        color: '#dc2626',
                        info: infoHtml,
                        timeUnit: 'hour',
                        xLabel: 'Acquisition time [UTC]',
                        compactTimeTicks: true,
                        maxXTicks: 6,
                        beginAtZero: true,
                        datasets: fireSeries.datasets
                    }
                );
                return;
            }
        }

        if (lfmcActive) {
            EV.lfmc.queryPolygon(bounds, map).then(function (series) {
                drawnItems.removeLayer(e.layer);
                if (!series.length) {
                    alert('No LFMC data in this area.');
                    return;
                }
                var infoHtml = 'Area: ~' + area.toFixed(2) + ' km&sup2;' +
                               '<br>Dates with data: ' + series.length;
                EV.showTimeseries(
                    'LFMC — Polygon Statistics',
                    series,
                    { unit: '%', label: 'LFMC (%)', info: infoHtml }
                );
            });
            return;
        }

        drawnItems.removeLayer(e.layer);
        alert('No active queryable layer.');
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
    registerLayer(EV.adminL0);
    buildLayerToggles();

    // Initialise layers
    EV.lfmc.init(map, DATA_BASE);
    EV.fireHotspots.init(map, DATA_BASE);
    EV.adminL0.init(map);

})();
