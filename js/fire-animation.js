/**
 * Polygon hotspot map animation and WebM export.
 */
(function () {
    var map = null;
    var points = [];
    var frameTimes = [];
    var markerLayer = null;
    var selectionLayer = null;
    var selectionBounds = null;
    var stamp = null;
    var legend = null;
    var timer = null;
    var currentFrame = 0;
    var currentVisiblePoints = [];
    var active = false;
    var exporting = false;

    function init(mapInstance) {
        map = mapInstance;
        wireControls();
    }

    function wireControls() {
        var play = document.getElementById('fire-animation-play');
        if (!play || play.dataset.wired) return;
        play.dataset.wired = 'true';

        play.addEventListener('click', togglePlayback);
        document.getElementById('fire-animation-close').addEventListener('click', close);
        document.getElementById('fire-animation-slider').addEventListener('input', function () {
            stopPlayback();
            renderFrame(parseInt(this.value, 10) || 0);
        });
        document.getElementById('fire-animation-step').addEventListener('change', rebuildFrames);
        document.getElementById('fire-animation-persistence').addEventListener('change', function () {
            renderFrame(currentFrame);
        });
        document.getElementById('fire-animation-labels').addEventListener('change', function () {
            renderFrame(currentFrame);
        });
        document.getElementById('fire-animation-frame-delay').addEventListener('change', function () {
            if (timer) {
                stopPlayback();
                startPlayback();
            }
        });
        document.getElementById('fire-animation-apply-range').addEventListener('click', applyAnimationRange);
        document.getElementById('fire-animation-export').addEventListener('click', exportWebM);
        document.addEventListener('keydown', function (event) {
            if (active && event.key === 'Escape') close();
        });
    }

    function open(data) {
        if (!map || !data || !data.points || !data.points.length) return;
        close();
        active = true;
        points = data.points.slice().sort(function (a, b) { return a.time - b.time; });
        document.body.classList.add('fire-animation-active');
        document.getElementById('fire-animation-controls').classList.remove('hidden');

        if (EV.fireHotspots && EV.fireHotspots.setAnimationMode) {
            EV.fireHotspots.setAnimationMode(true);
        }

        markerLayer = L.layerGroup().addTo(map);
        var bounds = L.latLngBounds(
            [data.bounds.south, data.bounds.west],
            [data.bounds.north, data.bounds.east]
        );
        selectionBounds = bounds;
        selectionLayer = L.rectangle(bounds, {
            color: '#2563eb',
            weight: 2,
            opacity: 0.9,
            fillColor: '#2563eb',
            fillOpacity: 0.035,
            dashArray: '7 5',
            interactive: false
        }).addTo(map);

        createMapOverlays();
        map.invalidateSize();
        fitLiveAnimationBounds(bounds);

        var dataStart = points[0].time;
        var dataEnd = points[points.length - 1].time;
        var slider = document.getElementById('fire-animation-slider');
        slider.dataset.dataStart = String(dataStart);
        slider.dataset.dataEnd = String(dataEnd);
        slider.dataset.start = String(dataStart);
        slider.dataset.end = String(dataEnd);
        var startInput = document.getElementById('fire-animation-start');
        var endInput = document.getElementById('fire-animation-end');
        startInput.min = formatInputUTC(dataStart);
        startInput.max = formatInputUTC(dataEnd);
        startInput.value = formatInputUTC(dataStart);
        endInput.min = formatInputUTC(dataStart);
        endInput.max = formatInputUTC(dataEnd);
        endInput.value = formatInputUTC(dataEnd);
        buildLegend();
        rebuildFrames();
    }

    function createMapOverlays() {
        var container = map.getContainer();
        stamp = document.createElement('div');
        stamp.className = 'fire-animation-map-stamp';
        stamp.innerHTML = '<strong>Selected hotspot animation</strong><span id="fire-animation-map-time"></span><small id="fire-animation-map-window"></small>';
        container.appendChild(stamp);

        legend = document.createElement('div');
        legend.className = 'fire-animation-map-legend';
        container.appendChild(legend);
    }
    function fitLiveAnimationBounds(bounds) {
        var panel = document.getElementById('control-panel');
        var controls = document.getElementById('fire-animation-controls');
        var panelRect = panel ? panel.getBoundingClientRect() : null;
        var controlsRect = controls ? controls.getBoundingClientRect() : null;
        var left = panelRect && panelRect.right > 20 ?
            Math.min(panelRect.right + 24, map.getSize().x * 0.42) : 36;
        var bottom = controlsRect && controlsRect.height ? controlsRect.height + 42 : 190;

        map.fitBounds(bounds, {
            animate: false,
            maxZoom: 14,
            paddingTopLeft: [left, 74],
            paddingBottomRight: [278, bottom]
        });
    }

    function buildLegend() {
        if (!legend) return;
        var satellites = {};
        var fireTypes = {};
        points.forEach(function (point) {
            satellites[point.satellite] = {
                label: point.satellite,
                color: point.color
            };
            if (point.hasFireClass) {
                fireTypes[point.fireType] = {
                    label: point.fireTypeLabel || 'Fire',
                    path: point.typePath
                };
            }
        });

        var satelliteRows = Object.keys(satellites).sort().map(function (key) {
            var item = satellites[key];
            return '<span class="fire-animation-legend-item"><i class="fire-animation-legend-satellite" style="background:' +
                escapeAttribute(item.color) + '"></i>' + escapeHtml(item.label) + '</span>';
        }).join('');
        var typeRows = Object.keys(fireTypes).sort().map(function (key) {
            var item = fireTypes[key];
            return '<span class="fire-animation-legend-item">' + legendShapeSvg(item.path) +
                escapeHtml(item.label) + '</span>';
        }).join('');
        var typeSection = typeRows ?
            '<section><strong>Fire type</strong>' + typeRows + '</section>' : '';

        legend.innerHTML =
            '<section><strong>Satellite</strong>' + satelliteRows + '</section>' +
            typeSection +
            '<section><strong>FRP [MW]</strong><div class="fire-animation-legend-sizes">' +
            '<span><i style="width:12px;height:12px"></i>&lt;20</span>' +
            '<span><i style="width:16px;height:16px"></i>20-100</span>' +
            '<span><i style="width:21px;height:21px"></i>100-500</span>' +
            '<span><i style="width:28px;height:28px"></i>&ge;500</span>' +
            '</div></section>';
    }
    function legendShapeSvg(path) {
        return '<svg class="fire-animation-legend-shape" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="' + escapeAttribute(path) + '"/></svg>';
    }

    function getFRPMarkerSize(frp) {
        if (frp == null || !isFinite(Number(frp))) return 12;
        frp = Number(frp);
        if (frp < 20) return 12;
        if (frp < 100) return 16;
        if (frp < 500) return 21;
        return 28;
    }
    function rebuildFrames() {
        if (!active) return;
        stopPlayback();
        var slider = document.getElementById('fire-animation-slider');
        var start = Number(slider.dataset.start);
        var end = Number(slider.dataset.end);
        var persistenceMinutes = Number(document.getElementById('fire-animation-persistence').value);
        var stepSelect = document.getElementById('fire-animation-step');
        var exactMode = persistenceMinutes === 0;
        stepSelect.disabled = exactMode;
        frameTimes = [];

        if (exactMode) {
            var previousTime = null;
            points.forEach(function (point) {
                if (point.time < start || point.time > end || point.time === previousTime) return;
                frameTimes.push(point.time);
                previousTime = point.time;
            });
        } else {
            var stepMs = getSelectMinutes('fire-animation-step') * 60000;
            for (var time = start; time <= end; time += stepMs) {
                frameTimes.push(time);
            }
            if (!frameTimes.length || frameTimes[frameTimes.length - 1] < end) frameTimes.push(end);
        }

        if (!frameTimes.length) frameTimes.push(end);
        slider.min = '0';
        slider.max = String(Math.max(0, frameTimes.length - 1));
        slider.value = '0';
        renderFrame(0);
    }
    function renderFrame(index) {
        if (!active || !frameTimes.length) return;
        currentFrame = Math.max(0, Math.min(index, frameTimes.length - 1));
        var endTime = frameTimes[currentFrame];
        var persistenceMinutes = Number(document.getElementById('fire-animation-persistence').value);
        var exactMode = persistenceMinutes === 0;
        var startTime = exactMode ? endTime : endTime - persistenceMinutes * 60000;
        var visible = pointsInWindow(startTime, endTime);
        currentVisiblePoints = visible;

        markerLayer.clearLayers();
        var showFRPLabels = document.getElementById('fire-animation-labels').checked;
        visible.forEach(function (point) {
            var markerSize = getFRPMarkerSize(point.frp);
            var showLabel = showFRPLabels && point.frp != null;
            var frpLabel = showLabel ?
                '<span class="fire-animation-frp-label">' + Math.round(Number(point.frp)) + ' MW</span>' : '';
            var icon = L.divIcon({
                className: 'fire-animation-marker',
                html: '<div class="fire-animation-symbol"><svg width="' + markerSize + '" height="' + markerSize +
                    '" viewBox="0 0 24 24" style="fill:' + escapeAttribute(point.color) +
                    '"><path d="' + escapeAttribute(point.typePath) + '"/></svg>' + frpLabel + '</div>',
                iconSize: [markerSize, markerSize],
                iconAnchor: [markerSize / 2, markerSize / 2]
            });
            L.marker([point.latitude, point.longitude], {
                icon: icon,
                interactive: false,
                keyboard: false
            }).addTo(markerLayer);
        });

        var formatted = formatUTC(endTime);
        var windowText = exactMode ? 'Detections acquired at this timestamp' :
            'Detections acquired in the preceding ' + persistenceMinutes + ' minutes';
        document.getElementById('fire-animation-time').textContent = formatted;
        document.getElementById('fire-animation-slider').value = String(currentFrame);
        document.getElementById('fire-animation-frame-count').textContent =
            (currentFrame + 1) + ' / ' + frameTimes.length;
        document.getElementById('fire-animation-status').textContent =
            visible.length ? visible.length + ' detections in this window' : 'No detections in this window';
        var mapTime = document.getElementById('fire-animation-map-time');
        var mapWindow = document.getElementById('fire-animation-map-window');
        if (mapTime) mapTime.textContent = formatted;
        if (mapWindow) mapWindow.textContent = windowText;
    }

    function pointsInWindow(startTime, endTime) {
        var result = [];
        var low = lowerBound(points, startTime);
        for (var i = low; i < points.length && points[i].time <= endTime; i++) {
            result.push(points[i]);
        }
        return result;
    }

    function lowerBound(items, time) {
        var low = 0;
        var high = items.length;
        while (low < high) {
            var mid = (low + high) >> 1;
            if (items[mid].time < time) low = mid + 1;
            else high = mid;
        }
        return low;
    }

    function togglePlayback() {
        if (timer) stopPlayback();
        else startPlayback();
    }

    function startPlayback() {
        if (!active || frameTimes.length < 2) return;
        if (currentFrame >= frameTimes.length - 1) renderFrame(0);
        setPlayButton(true);
        var frameDelay = getFrameDelay();
        timer = setInterval(function () {
            if (currentFrame >= frameTimes.length - 1) {
                stopPlayback();
                return;
            }
            renderFrame(currentFrame + 1);
        }, frameDelay);
    }

    function stopPlayback() {
        if (timer) clearInterval(timer);
        timer = null;
        setPlayButton(false);
    }

    function setPlayButton(playing) {
        var button = document.getElementById('fire-animation-play');
        button.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
        button.title = playing ? 'Pause animation' : 'Play animation';
        button.setAttribute('aria-label', button.title);
    }

    async function exportWebM() {
        if (!active || exporting) return;
        if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
            setStatus('WebM export is not supported by this browser.');
            return;
        }
        if (frameTimes.length > 600) {
            setStatus('This export has more than 600 frames. Increase the animation step first.');
            return;
        }

        var crop = getSelectionCrop();
        if (!crop) {
            setStatus('The complete selected area must be visible. Recenter or zoom out, then export again.');
            return;
        }

        stopPlayback();
        exporting = true;
        var button = document.getElementById('fire-animation-export');
        var originalText = button.textContent;
        var restoreFrame = currentFrame;
        var mapElement = map.getContainer();
        var attributionElement = mapElement.querySelector('.leaflet-control-attribution');
        var attribution = attributionElement ?
            attributionElement.textContent.replace(/\s+/g, ' ').trim() : '';
        button.disabled = true;
        document.body.classList.add('fire-animation-exporting');
        if (selectionLayer) selectionLayer.setStyle({ opacity: 0, fillOpacity: 0 });
        if (markerLayer && map.hasLayer(markerLayer)) map.removeLayer(markerLayer);

        try {
            await nextPaint();
            var cssWidth = mapElement.clientWidth;
            var cssHeight = mapElement.clientHeight;
            var sourceScale = Math.min(3, 3840 / cssWidth);
            setStatus('Preparing high-resolution map template...');
            var snapshot = await html2canvas(mapElement, {
                useCORS: true,
                allowTaint: false,
                backgroundColor: '#ffffff',
                logging: false,
                scale: sourceScale,
                width: cssWidth,
                height: cssHeight
            });

            var layout = createExportLayout(crop);
            var output = document.createElement('canvas');
            output.width = layout.width;
            output.height = layout.height;
            var context = output.getContext('2d');
            var stream = output.captureStream(10);
            var mimeType = supportedWebMMime();
            var recorderOptions = { videoBitsPerSecond: 14000000 };
            if (mimeType) recorderOptions.mimeType = mimeType;
            var recorder = new MediaRecorder(stream, recorderOptions);
            var chunks = [];
            recorder.ondataavailable = function (event) {
                if (event.data && event.data.size) chunks.push(event.data);
            };
            var stopped = new Promise(function (resolve) {
                recorder.onstop = resolve;
            });

            recorder.start(1000);
            for (var i = 0; i < frameTimes.length; i++) {
                renderFrame(i);
                drawExportFrame(context, snapshot, crop, sourceScale, layout, attribution);
                setStatus('Rendering WebM frame ' + (i + 1) + ' of ' + frameTimes.length + '...');
                await delay(getFrameDelay());
            }
            await delay(220);
            recorder.stop();
            await stopped;

            var blob = new Blob(chunks, { type: mimeType || 'video/webm' });
            var url = URL.createObjectURL(blob);
            var anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'hotspot_animation_' + filenameTime(frameTimes[0]) + '_' +
                filenameTime(frameTimes[frameTimes.length - 1]) + '.webm';
            anchor.click();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            setStatus('Cropped WebM animation saved.');
        } catch (error) {
            console.error('[ANIMATION] WebM export failed:', error);
            setStatus('Export failed. The selected basemap may block browser capture; try the OpenStreetMap or Light basemap.');
        } finally {
            document.body.classList.remove('fire-animation-exporting');
            if (selectionLayer) {
                selectionLayer.setStyle({ opacity: 0.9, fillOpacity: 0.035 });
            }
            if (markerLayer && !map.hasLayer(markerLayer)) markerLayer.addTo(map);
            exporting = false;
            button.disabled = false;
            button.textContent = originalText;
            renderFrame(restoreFrame);
        }
    }

    function getSelectionCrop() {
        if (!selectionBounds) return null;
        var northWest = map.latLngToContainerPoint(selectionBounds.getNorthWest());
        var southEast = map.latLngToContainerPoint(selectionBounds.getSouthEast());
        var left = Math.floor(Math.min(northWest.x, southEast.x));
        var top = Math.floor(Math.min(northWest.y, southEast.y));
        var right = Math.ceil(Math.max(northWest.x, southEast.x));
        var bottom = Math.ceil(Math.max(northWest.y, southEast.y));
        var size = map.getSize();

        if (left < 0 || top < 0 || right > size.x || bottom > size.y ||
                right - left < 2 || bottom - top < 2) return null;
        return {
            left: left,
            top: top,
            width: right - left,
            height: bottom - top
        };
    }

    function createExportLayout(crop) {
        var mapScale = Math.min(1920 / crop.width, 820 / crop.height);
        var mapWidth = evenNumber(Math.max(1, Math.round(crop.width * mapScale)));
        var mapHeight = evenNumber(Math.max(1, Math.round(crop.height * mapScale)));
        var width = evenNumber(Math.max(900, mapWidth));
        var headerHeight = 86;
        var footerHeight = 174;
        return {
            width: width,
            height: evenNumber(headerHeight + mapHeight + footerHeight),
            headerHeight: headerHeight,
            footerHeight: footerHeight,
            mapX: Math.round((width - mapWidth) / 2),
            mapY: headerHeight,
            mapWidth: mapWidth,
            mapHeight: mapHeight,
            pointScaleX: mapWidth / crop.width,
            pointScaleY: mapHeight / crop.height
        };
    }

    function drawExportFrame(context, snapshot, crop, sourceScale, layout, attribution) {
        context.save();
        context.fillStyle = '#f8fafc';
        context.fillRect(0, 0, layout.width, layout.height);

        drawExportHeader(context, layout);
        context.drawImage(
            snapshot,
            crop.left * sourceScale,
            crop.top * sourceScale,
            crop.width * sourceScale,
            crop.height * sourceScale,
            layout.mapX,
            layout.mapY,
            layout.mapWidth,
            layout.mapHeight
        );

        context.save();
        context.beginPath();
        context.rect(layout.mapX, layout.mapY, layout.mapWidth, layout.mapHeight);
        context.clip();
        currentVisiblePoints.forEach(function (point) {
            drawExportHotspot(context, point, crop, layout);
        });
        context.restore();

        context.strokeStyle = '#cbd5e1';
        context.lineWidth = 2;
        context.strokeRect(layout.mapX, layout.mapY, layout.mapWidth, layout.mapHeight);
        drawExportLegend(context, layout, attribution);
        context.restore();
    }

    function drawExportHeader(context, layout) {
        var endTime = frameTimes[currentFrame];
        var persistence = Number(document.getElementById('fire-animation-persistence').value);
        var modeText = persistence === 0 ?
            'Exact acquisition timestamp' :
            'Detections acquired in the preceding ' + persistence + ' minutes';

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, layout.width, layout.headerHeight);
        context.fillStyle = '#0f172a';
        context.font = '700 24px Inter, Arial, sans-serif';
        context.textAlign = 'left';
        context.textBaseline = 'alphabetic';
        context.fillText('EOSIAL Active Fire Viewer', 28, 34);
        context.fillStyle = '#64748b';
        context.font = '600 13px Inter, Arial, sans-serif';
        context.fillText(modeText + ' | ' + currentVisiblePoints.length + ' detections | Map zoom ' + map.getZoom(), 28, 61);

        context.fillStyle = '#0f172a';
        context.font = '700 19px Inter, Arial, sans-serif';
        context.textAlign = 'right';
        context.fillText(formatUTC(endTime), layout.width - 28, 39);
        context.strokeStyle = '#e2e8f0';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(0, layout.headerHeight - 1);
        context.lineTo(layout.width, layout.headerHeight - 1);
        context.stroke();
    }

    function drawExportHotspot(context, point, crop, layout) {
        var screenPoint = map.latLngToContainerPoint([point.latitude, point.longitude]);
        var x = layout.mapX + (screenPoint.x - crop.left) * layout.pointScaleX;
        var y = layout.mapY + (screenPoint.y - crop.top) * layout.pointScaleY;
        var size = getExportMarkerSize(point.frp);

        context.save();
        context.shadowColor = 'rgba(15, 23, 42, 0.65)';
        context.shadowBlur = 5;
        context.shadowOffsetY = 2;
        drawCanvasFireShape(context, x, y, size,
            point.hasFireClass ? point.fireType : -1,
            point.color, '#ffffff', 2.5);
        context.restore();

        if (document.getElementById('fire-animation-labels').checked && point.frp != null) {
            drawExportFRPLabel(context, x, y - size / 2 - 7, Math.round(Number(point.frp)) + ' MW');
        }
    }

    function getExportMarkerSize(frp) {
        if (frp == null || !isFinite(Number(frp))) return 16;
        frp = Number(frp);
        if (frp < 20) return 16;
        if (frp < 100) return 22;
        if (frp < 500) return 30;
        return 40;
    }

    function drawCanvasFireShape(context, x, y, size, fireType, fill, stroke, lineWidth) {
        var half = size / 2;
        context.beginPath();
        if (fireType === 1) {
            context.moveTo(x, y - half);
            context.lineTo(x + half, y + half);
            context.lineTo(x - half, y + half);
            context.closePath();
        } else if (fireType === 2) {
            context.rect(x - half, y - half, size, size);
        } else if (fireType === 3) {
            context.moveTo(x, y - half);
            context.lineTo(x + half, y);
            context.lineTo(x, y + half);
            context.lineTo(x - half, y);
            context.closePath();
        } else {
            context.arc(x, y, half, 0, Math.PI * 2);
        }
        context.fillStyle = fill;
        context.fill();
        context.strokeStyle = stroke;
        context.lineWidth = lineWidth;
        context.stroke();
    }

    function drawExportFRPLabel(context, x, y, text) {
        context.save();
        context.font = '700 13px Inter, Arial, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        var width = context.measureText(text).width + 12;
        var height = 23;
        roundedRectPath(context, x - width / 2, y - height, width, height, 4);
        context.fillStyle = 'rgba(255, 255, 255, 0.94)';
        context.fill();
        context.strokeStyle = 'rgba(100, 116, 139, 0.75)';
        context.lineWidth = 1;
        context.stroke();
        context.fillStyle = '#0f172a';
        context.fillText(text, x, y - height / 2);
        context.restore();
    }

    function drawExportLegend(context, layout, attribution) {
        var top = layout.mapY + layout.mapHeight;
        var pointsInRange = animationPointsInRange();
        var satellites = {};
        var fireTypes = {};
        pointsInRange.forEach(function (point) {
            satellites[point.satellite] = point.color;
            if (point.hasFireClass) fireTypes[point.fireType] = point.fireTypeLabel;
        });

        context.fillStyle = '#ffffff';
        context.fillRect(0, top, layout.width, layout.footerHeight);
        context.strokeStyle = '#e2e8f0';
        context.beginPath();
        context.moveTo(0, top);
        context.lineTo(layout.width, top);
        context.stroke();

        var margin = 28;
        var sectionGap = 24;
        var satelliteWidth = Math.round(layout.width * 0.42);
        var typeWidth = Math.round(layout.width * 0.24);
        var frpX = margin + satelliteWidth + typeWidth + sectionGap * 2;
        drawExportSectionTitle(context, 'SATELLITES', margin, top + 27);
        drawSatelliteLegend(context, satellites, margin, top + 48, satelliteWidth);

        drawExportSectionTitle(context, 'FIRE TYPE', margin + satelliteWidth + sectionGap, top + 27);
        drawFireTypeLegend(context, fireTypes, margin + satelliteWidth + sectionGap, top + 48, typeWidth);

        drawExportSectionTitle(context, 'FRP [MW] - MARKER SIZE', frpX, top + 27);
        drawFRPLegend(context, frpX, top + 54, layout.width - frpX - margin);

        context.fillStyle = '#94a3b8';
        context.font = '500 10px Inter, Arial, sans-serif';
        context.textAlign = 'right';
        context.fillText(attribution || 'Basemap attribution shown in the interactive viewer',
            layout.width - margin, layout.height - 13);
    }

    function drawExportSectionTitle(context, text, x, y) {
        context.fillStyle = '#64748b';
        context.font = '800 10px Inter, Arial, sans-serif';
        context.textAlign = 'left';
        context.fillText(text, x, y);
    }

    function drawSatelliteLegend(context, satellites, x, y, width) {
        var keys = Object.keys(satellites).sort();
        var rows = 5;
        var columns = Math.max(1, Math.ceil(keys.length / rows));
        var columnWidth = width / columns;
        keys.forEach(function (key, index) {
            var column = Math.floor(index / rows);
            var row = index % rows;
            var itemX = x + column * columnWidth;
            var itemY = y + row * 20;
            context.beginPath();
            context.arc(itemX + 6, itemY - 4, 5, 0, Math.PI * 2);
            context.fillStyle = satellites[key];
            context.fill();
            context.strokeStyle = 'rgba(15, 23, 42, 0.3)';
            context.lineWidth = 1;
            context.stroke();
            context.fillStyle = '#334155';
            context.font = '650 11px Inter, Arial, sans-serif';
            context.textAlign = 'left';
            context.fillText(key, itemX + 17, itemY);
        });
    }

    function drawFireTypeLegend(context, fireTypes, x, y) {
        var labels = {
            0: 'Vegetation',
            1: 'Volcano',
            2: 'Static source',
            3: 'Offshore'
        };
        var keys = Object.keys(fireTypes).sort();
        if (!keys.length) {
            context.fillStyle = '#64748b';
            context.font = '600 11px Inter, Arial, sans-serif';
            context.textAlign = 'left';
            context.fillText('Not classified', x, y);
            return;
        }
        keys.forEach(function (key, index) {
            var itemY = y + index * 24 - 4;
            drawCanvasFireShape(context, x + 7, itemY, 11, Number(key), '#64748b', '#ffffff', 1.2);
            context.fillStyle = '#334155';
            context.font = '650 11px Inter, Arial, sans-serif';
            context.textAlign = 'left';
            context.fillText(labels[key] || fireTypes[key], x + 20, itemY + 4);
        });
    }

    function drawFRPLegend(context, x, y, width) {
        var entries = [
            { label: '<20', size: 10 },
            { label: '20-100', size: 14 },
            { label: '100-500', size: 18 },
            { label: '>=500', size: 24 }
        ];
        var itemWidth = width / entries.length;
        entries.forEach(function (entry, index) {
            var itemX = x + itemWidth * index + itemWidth / 2;
            context.beginPath();
            context.arc(itemX, y, entry.size / 2, 0, Math.PI * 2);
            context.fillStyle = '#475569';
            context.fill();
            context.strokeStyle = '#ffffff';
            context.lineWidth = 1.5;
            context.stroke();
            context.fillStyle = '#475569';
            context.font = '700 10px Inter, Arial, sans-serif';
            context.textAlign = 'center';
            context.fillText(entry.label, itemX, y + 29);
        });
    }

    function animationPointsInRange() {
        var slider = document.getElementById('fire-animation-slider');
        var start = Number(slider.dataset.start);
        var end = Number(slider.dataset.end);
        return points.filter(function (point) {
            return point.time >= start && point.time <= end;
        });
    }

    function roundedRectPath(context, x, y, width, height, radius) {
        radius = Math.min(radius, width / 2, height / 2);
        context.beginPath();
        context.moveTo(x + radius, y);
        context.arcTo(x + width, y, x + width, y + height, radius);
        context.arcTo(x + width, y + height, x, y + height, radius);
        context.arcTo(x, y + height, x, y, radius);
        context.arcTo(x, y, x + width, y, radius);
        context.closePath();
    }

    function evenNumber(value) {
        value = Math.max(2, Math.round(value));
        return value % 2 === 0 ? value : value + 1;
    }
    function supportedWebMMime() {
        var candidates = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm'
        ];
        for (var i = 0; i < candidates.length; i++) {
            if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
        }
        return '';
    }

    function close() {
        if (!active || exporting) return;
        stopPlayback();
        if (markerLayer && map) map.removeLayer(markerLayer);
        if (selectionLayer && map) map.removeLayer(selectionLayer);
        markerLayer = null;
        selectionLayer = null;
        selectionBounds = null;
        if (stamp && stamp.parentNode) stamp.parentNode.removeChild(stamp);
        if (legend && legend.parentNode) legend.parentNode.removeChild(legend);
        stamp = null;
        legend = null;
        points = [];
        frameTimes = [];
        active = false;
        document.body.classList.remove('fire-animation-active');
        var controls = document.getElementById('fire-animation-controls');
        if (controls) controls.classList.add('hidden');
        if (EV.fireHotspots && EV.fireHotspots.setAnimationMode) {
            EV.fireHotspots.setAnimationMode(false);
        }
    }

    function applyAnimationRange() {
        if (!active) return;
        var slider = document.getElementById('fire-animation-slider');
        var start = parseInputUTC(document.getElementById('fire-animation-start').value);
        var end = parseInputUTC(document.getElementById('fire-animation-end').value);
        var dataStart = Number(slider.dataset.dataStart);
        var dataEnd = Number(slider.dataset.dataEnd);

        if (!isFinite(start) || !isFinite(end)) {
            setStatus('Enter valid UTC start and end times.');
            return;
        }
        if (start > end) {
            setStatus('The animation start time must not be after the end time.');
            return;
        }
        if (start < dataStart || end > dataEnd) {
            setStatus('Choose a range within the selected detections: ' +
                formatUTC(dataStart) + ' to ' + formatUTC(dataEnd) + '.');
            return;
        }

        slider.dataset.start = String(start);
        slider.dataset.end = String(end);
        setStatus('');
        rebuildFrames();
    }

    function parseInputUTC(value) {
        if (!value) return NaN;
        var match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
        if (!match) return NaN;
        var day = Number(match[1]);
        var month = Number(match[2]);
        var year = Number(match[3]);
        var hour = Number(match[4]);
        var minute = Number(match[5]);
        var time = Date.UTC(year, month - 1, day, hour, minute);
        var date = new Date(time);
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
                date.getUTCDate() !== day || date.getUTCHours() !== hour ||
                date.getUTCMinutes() !== minute) return NaN;
        return time;
    }

    function formatInputUTC(value) {
        var date = new Date(value);
        return pad2(date.getUTCDate()) + '/' + pad2(date.getUTCMonth() + 1) + '/' +
            date.getUTCFullYear() + ' ' + pad2(date.getUTCHours()) + ':' +
            pad2(date.getUTCMinutes());
    }

    function pad2(value) {
        return String(value).padStart(2, '0');
    }
    function getSelectMinutes(id) {
        return Math.max(1, parseInt(document.getElementById(id).value, 10) || 1);
    }
    function getFrameDelay() {
        var input = document.getElementById('fire-animation-frame-delay');
        var value = Math.round(Number(input.value));
        if (!isFinite(value)) value = 1000;
        value = Math.max(100, Math.min(5000, value));
        input.value = String(value);
        return value;
    }

    function formatUTC(value) {
        var date = new Date(value);
        return date.toLocaleString('en-GB', {
            timeZone: 'UTC',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }) + ' UTC';
    }

    function filenameTime(value) {
        return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    }

    function setStatus(message) {
        var status = document.getElementById('fire-animation-status');
        if (status) status.textContent = message;
    }

    function nextPaint() {
        return new Promise(function (resolve) {
            requestAnimationFrame(function () {
                requestAnimationFrame(resolve);
            });
        });
    }

    function delay(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttribute(value) {
        return escapeHtml(value);
    }

    EV.fireAnimation = {
        init: init,
        open: open,
        close: close
    };
})();