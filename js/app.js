/**
 * EOSIAL Active Fire Viewer — main application
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
    if (EV.fireAnimation) EV.fireAnimation.init(map);

    var basemaps = EV.mapBasemaps();
    basemaps.OpenStreetMap.addTo(map);
    // Unified toolbar (replaces separate zoom / layers / geocoder controls)
    var toolbar = L.control({ position: 'topright' });
    toolbar.onAdd = function () {
        var wrap = L.DomUtil.create('div', 'map-toolbar leaflet-bar');
        var closeMenus = EV.addMapToolbarBase(map, wrap, basemaps, function () {
            var button = EV.mapToolButton(wrap, '3D', 'Explore fire footprints on 90 m terrain');
            button.id = 'btn-toggle-3d';
            button.setAttribute('aria-label', 'Switch to 3D terrain view');
        });

        // ── Query Point
        var btnQueryPt = EV.mapToolButton(wrap, 'point', 'Query point timeseries');
        btnQueryPt.id = 'btn-draw-point';
        btnQueryPt.addEventListener('click', function () {
            closeMenus();
        });

        // ── Query Polygon
        var btnQueryPoly = EV.mapToolButton(wrap, 'area', 'Query polygon timeseries');
        btnQueryPoly.id = 'btn-draw-polygon';
        btnQueryPoly.addEventListener('click', function () {
            closeMenus();
        });

        // ── Dark mode toggle
        var btnDark = EV.mapToolButton(wrap, 'dark', 'Toggle dark mode');
        btnDark.addEventListener('click', function () {
            document.body.classList.toggle('dark');
            btnDark.classList.toggle('active', document.body.classList.contains('dark'));
            closeMenus();
        });

        // ── Measure distance
        var btnMeasure = EV.mapToolButton(wrap, 'measure', 'Measure distance');

        btnMeasure.addEventListener('click', function () {
            toggleMeasure(btnMeasure);
            closeMenus();
        });

        // ── Screenshot
        var ssWrap = document.createElement('div');
        ssWrap.style.position = 'relative';
        wrap.appendChild(ssWrap);

        var btnScreenshot = EV.mapToolButton(ssWrap, 'camera', 'Take screenshot');

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
            closeMenus();
        });

        // Close dropdowns when clicking elsewhere on the map
        map.on('click', function () {
            closeMenus();
            ssDropdown.classList.remove('open');
        });

        return wrap;
    };
    toolbar.addTo(map);

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
                if (rectangleDrawer) {
                    rectangleDrawer.disable();
                    rectangleDrawer = null;
                }
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
        ctx.fillText('EOSIAL Active Fire Viewer \u2014 ' + new Date().toISOString().substring(0, 10),
                     ML + 4 * s, TH + MT + h - 3 * s);

        return dst;
    }

    function captureMapScreenshot(cropRect, opts) {
        opts = opts || {};
        var scale = opts.scale || 1;
        var title = opts.title || '';

        var currentBounds = map.getBounds();

        EV.captureMap(map, scale).then(function (canvas) {
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

    function registerLayer(layerDef, sidebarGroup) {
        if (!layerDef) return;
        layerDef.sidebarGroup = sidebarGroup;
        layers.push(layerDef);
    }

    function buildLayerToggles() {
        var container = document.getElementById('layer-toggles');
        var groups = [
            { id: 'hotspots', title: 'Hotspot Databases' },
            { id: 'additional', title: 'Additional Layers' }
        ];
        container.innerHTML = '';
        groups.forEach(function (group) {
            var groupLayers = layers.filter(function (layer) {
                return layer.sidebarGroup === group.id;
            });
            if (!groupLayers.length) return;

            var section = document.createElement('section');
            section.className = 'sidebar-layer-group';
            var heading = document.createElement('h2');
            heading.className = 'sidebar-layer-group-title';
            heading.textContent = group.title;
            var list = document.createElement('div');
            list.className = 'sidebar-layer-group-list space-y-2';
            section.appendChild(heading);
            section.appendChild(list);

            groupLayers.forEach(function (lyr) {
                var label = document.createElement('label');
                label.className = 'layer-toggle';
                var cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.dataset.layerId = lyr.id;
                cb.checked = lyr.defaultVisible;
                cb.addEventListener('change', function () {
                    lyr.setVisible(this.checked, map);
                });
                var span = document.createElement('span');
                span.className = 'layer-name';
                span.textContent = lyr.name;
                label.appendChild(cb);
                label.appendChild(span);
                list.appendChild(label);
            });
            container.appendChild(section);
        });
    }
    /* ── Query tools (point + polygon) ─────────────────────────── */

    var drawControl = null;
    var rectangleDrawer = null;
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
            if (rectangleDrawer) {
                rectangleDrawer.disable();
                rectangleDrawer = null;
            }
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

        alert('Use the polygon tool to query active fire FRP timeseries.');
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
            if (rectangleDrawer) {
                rectangleDrawer.disable();
                rectangleDrawer = null;
            }
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
        rectangleDrawer = new L.Draw.Rectangle(map, drawControl.options.draw.rectangle);
        rectangleDrawer.enable();
    });

    map.on(L.Draw.Event.CREATED, function (e) {
        if (rectangleDrawer) {
            rectangleDrawer.disable();
            rectangleDrawer = null;
        }
        if (drawControl) {
            map.removeControl(drawControl);
            drawControl = null;
        }
        document.getElementById('btn-draw-polygon').classList.remove('active');
        document.body.classList.remove('querying');

        var bounds = e.layer.getBounds();
        drawnItems.addLayer(e.layer);


        // Check whether active fire layers are queryable.
        var fireActive = EV.fireHotspots && document.getElementById('fire-controls') &&
                         !document.getElementById('fire-controls').classList.contains('hidden');

        if (fireActive) {
            if (EV.fireHotspots.isLoading()) {
                drawnItems.removeLayer(e.layer);
                alert('Fire data are still loading. Please retry the query when loading finishes.');
                return;
            }
            var fireSeries = EV.fireHotspots.queryPolygon(bounds);
            if (fireSeries.tableRows && fireSeries.tableRows.length) {
                drawnItems.removeLayer(e.layer);
                var fireDetections = fireSeries.tableRows.length;
                var infoHtml = 'Detections in query area: ' + fireDetections +
                               '<br>Acquisition times plotted: ' + fireSeries.length;
                if (fireSeries.satelliteDetections) {
                    var satelliteInfo = Object.keys(fireSeries.satelliteDetections).sort().map(function (sat) {
                        return EV.escapeHtml(sat) + ': ' + fireSeries.satelliteDetections[sat];
                    }).join(', ');
                    if (satelliteInfo) infoHtml += '<br>Satellites: ' + satelliteInfo;
                }
                if (!fireSeries.length) infoHtml += '<br>FRP is unavailable for these detections. Animation and Table remain available.';
                if (fireSeries.loadWarnings.length) infoHtml += '<br>' + EV.escapeHtml(fireSeries.loadWarnings.join(' ')) + ' Counts and exports may be incomplete.';
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
                        datasets: fireSeries.datasets,
                        tableRows: fireSeries.tableRows,
                        tableColumns: fireSeries.tableColumns,
                        tableFilename: 'polygon_hotspot_detections.csv',
                        animation: fireSeries.animation,
                        loadWarnings: fireSeries.loadWarnings
                    }
                );
                EV.openTimeseriesAnimation();
                return;
            }
            drawnItems.removeLayer(e.layer);
            alert('No detections match this area and the current filters.');
            return;
        }


        drawnItems.removeLayer(e.layer);
        alert('No active queryable layer.');
    });

    /* ── Copy shareable link ───────────────────────────────────── */

    document.getElementById('btn-copy-link').addEventListener('click', function () {
        var c = map.getCenter();
        var params = new URLSearchParams();
        params.set('lat', c.lat.toFixed(5));
        params.set('lng', c.lng.toFixed(5));
        params.set('z', map.getZoom());
        if (EV.fireHotspots && EV.fireHotspots.getShareParams) {
            var fireState = EV.fireHotspots.getShareParams();
            Object.keys(fireState).forEach(function (key) {
                params.set(key, fireState[key]);
            });
        }
        var url = location.origin + location.pathname + '?' + params.toString();
        navigator.clipboard.writeText(url).then(function () {
            alert('Link copied with map, time, satellite, and filter settings!');
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
        return params;
    }

    /* ── Cursor info (coords + hover value) ───────────────────── */

    var coordsEl = document.getElementById('cursor-coords');
    var valueEl  = document.getElementById('cursor-value');
    var infoBar  = document.getElementById('map-info-bar');

    function hideCursorInfo() {
        if (infoBar) infoBar.classList.add('hidden');
        coordsEl.textContent = '';
        valueEl.textContent = '';
    }

    map.on('mousemove', EV.debounce(function () {
        hideCursorInfo();
    }, 30));

    map.on('mouseout', function () {
        coordsEl.textContent = '—';
        valueEl.textContent = '';
    });
    map.on('mouseout', hideCursorInfo);

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
    var panelOpen = window.matchMedia('(min-width: 640px)').matches;
    var panel = document.getElementById('control-panel');
    var toggleBtn = document.getElementById('toggle-panel-btn');
    var toggleIcon = document.getElementById('toggle-panel-icon');
    if (!panelOpen) toggleIcon.style.transform = 'rotate(180deg)';

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

    var urlParams = applyUrlParams();

    // Dataset visibility is controlled by the source tabs. The sidebar is
    // reserved for optional cartographic overlays.
    [EV.adminL0, EV.adminL1, EV.adminL2].forEach(function (layer) {
        if (layer) registerLayer(layer, 'additional');
    });
    buildLayerToggles();

    // Initialise layers
    [EV.adminL0, EV.adminL1, EV.adminL2].forEach(function (layer) {
        if (layer) layer.init(map, DATA_BASE);
    });
    if (EV.pixelGrids) EV.pixelGrids.init(map, DATA_BASE);
    if (EV.fire3D) EV.fire3D.init(map, DATA_BASE);
    var fireInit = EV.fireHotspots.init(map, DATA_BASE);
    if (EV.mobileUI) EV.mobileUI.init(map);
    if (urlParams.has('src') && fireInit && fireInit.then) {
        fireInit.then(function () {
            EV.fireHotspots.applyShareParams(urlParams);
            if (EV.mobileUI) EV.mobileUI.update();
        });
    }
    if (EV.onboarding) EV.onboarding.init();

})();
