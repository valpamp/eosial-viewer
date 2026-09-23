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
    var FRP_MIN = 1;
    var FRP_MAX = 1000;
    var FRP_COLOR_STOPS = [
        { t: 0.000, c: [255, 255, 204] },
        { t: 0.125, c: [255, 237, 160] },
        { t: 0.250, c: [254, 217, 118] },
        { t: 0.375, c: [254, 178, 76] },
        { t: 0.500, c: [253, 141, 60] },
        { t: 0.625, c: [252, 78, 42] },
        { t: 0.750, c: [227, 26, 28] },
        { t: 0.875, c: [189, 0, 38] },
        { t: 1.000, c: [128, 0, 38] }
    ];
    var brandImagesPromise = null;

    function init(mapInstance) {
        map = mapInstance;
        brandImagesPromise = Promise.all([
            loadImage('images/EOSIAL_banner.png'),
            loadImage('images/LOGO_DEF.png')
        ]).then(function (images) {
            return { eosial: images[0], sia: images[1] };
        });
        wireControls();
    }

    function wireControls() {
        var play = document.getElementById('fire-animation-play');
        if (!play || play.dataset.wired) return;
        play.dataset.wired = 'true';

        play.addEventListener('click', togglePlayback);
        document.getElementById('fire-animation-close').addEventListener('click', close);
        document.getElementById('fire-animation-show-graph').addEventListener('click', function () {
            close();
            if (EV.reopenTimeseries) EV.reopenTimeseries('chart');
        });
        document.getElementById('fire-animation-show-table').addEventListener('click', function () {
            close();
            if (EV.reopenTimeseries) EV.reopenTimeseries('table');
        });
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
        document.getElementById('fire-animation-opacity').addEventListener('input', function () {
            document.getElementById('fire-animation-opacity-value').textContent = this.value + '%';
            renderFrame(currentFrame);
        });
        document.getElementById('fire-animation-title').addEventListener('input', updateAnimationTitlePreview);
        document.getElementById('fire-animation-frame-delay').addEventListener('change', function () {
            if (timer) {
                stopPlayback();
                startPlayback();
            }
        });
        document.getElementById('fire-animation-apply-range').addEventListener('click', applyAnimationRange);
        document.getElementById('fire-animation-export').addEventListener('click', function () { exportVideo('webm'); });
        var mp4Button = document.getElementById('fire-animation-export-mp4');
        mp4Button.addEventListener('click', function () { exportVideo('mp4'); });
        if (!supportedMp4Mime()) {
            mp4Button.disabled = true;
            mp4Button.title = 'MP4/H.264 export is not supported by this browser. Use Microsoft Edge or Google Chrome.';
        }
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
        document.getElementById('fire-animation-title').value = '';

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
        stamp.innerHTML = '<strong id="fire-animation-map-title">Selected hotspot animation</strong><span id="fire-animation-map-time"></span><small id="fire-animation-map-window"></small>';
        container.appendChild(stamp);

        legend = document.createElement('div');
        legend.className = 'fire-animation-map-legend';
        container.appendChild(legend);
    }
    function loadImage(url) {
        return new Promise(function (resolve) {
            var image = new Image();
            image.onload = function () { resolve(image); };
            image.onerror = function () { resolve(null); };
            image.src = url;
        });
    }

    function getAnimationTitle() {
        var input = document.getElementById('fire-animation-title');
        return input ? input.value.trim() : '';
    }

    function updateAnimationTitlePreview() {
        var preview = document.getElementById('fire-animation-map-title');
        if (preview) preview.textContent = getAnimationTitle() || 'Selected hotspot animation';
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
            return '<span class="fire-animation-legend-item"><i class="fire-animation-legend-satellite" style="background:#fff;border-color:' +
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
            '<section><strong>Satellite outline</strong>' + satelliteRows + '</section>' +
            typeSection +
            '<section><strong>FRP [MW] - log scale</strong>' + frpColorbarHtml() + '</section>';
    }
    function legendShapeSvg(path) {
        return '<svg class="fire-animation-legend-shape" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="' + escapeAttribute(path) + '"/></svg>';
    }

    function interpolateColor(a, b, amount) {
        return [0, 1, 2].map(function (index) {
            return Math.round(a[index] + (b[index] - a[index]) * amount);
        });
    }

    function frpScalePosition(frp) {
        var value = Number(frp);
        if (!isFinite(value) || value <= 0) return null;
        var clamped = Math.max(FRP_MIN, Math.min(FRP_MAX, value));
        return (Math.log10(clamped) - Math.log10(FRP_MIN)) /
            (Math.log10(FRP_MAX) - Math.log10(FRP_MIN));
    }

    function frpColor(frp) {
        var position = frpScalePosition(frp);
        if (position === null) return '#6b7280';
        for (var index = 1; index < FRP_COLOR_STOPS.length; index++) {
            if (position <= FRP_COLOR_STOPS[index].t) {
                var low = FRP_COLOR_STOPS[index - 1];
                var high = FRP_COLOR_STOPS[index];
                var amount = (position - low.t) / (high.t - low.t);
                var color = interpolateColor(low.c, high.c, amount);
                return 'rgb(' + color.join(',') + ')';
            }
        }
        return 'rgb(' + FRP_COLOR_STOPS[FRP_COLOR_STOPS.length - 1].c.join(',') + ')';
    }

    function frpColorbarHtml() {
        return '<div class="fire-animation-frp-colorbar">' +
            '<i aria-hidden="true"></i>' +
            '<div><span>1</span><span>10</span><span>100</span><span>1000+</span></div>' +
            '</div>';
    }

    function retrievalLabel(retrieval) {
        if (retrieval === 'alternative') return 'Alternative';
        if (retrieval === 'swir') return 'SWIR 500 m';
        return 'Standard';
    }

    function nativeFootprint(point) {
        if (!EV.pixelGrids || !EV.pixelGrids.hasHotspotGrid ||
                !EV.pixelGrids.hasHotspotGrid(point.satellite)) return null;
        var footprint = EV.pixelGrids.getHotspotFootprint(
            point.satellite, point.latitude, point.longitude, {
                PIXEL_SCAN_KM: point.pixelScanKm,
                PIXEL_TRACK_KM: point.pixelTrackKm,
                IFOV_AREA_M2: point.ifovAreaM2,
                EFF_ACROSS_KM: point.effAcrossKm,
                EFF_ALONG_KM: point.effAlongKm
            }
        );
        if (footprint && point.dataset === 'S3') {
            return {
                key: footprint.key + ':' + (point.retrieval || 'standard'),
                corners: footprint.corners
            };
        }
        return footprint;
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
    function strongerAnimationPoint(current, candidate) {
        if (!current) return candidate;
        var currentFrp = Number(current.frp);
        var candidateFrp = Number(candidate.frp);
        if (isFinite(candidateFrp) && (!isFinite(currentFrp) || candidateFrp > currentFrp)) return candidate;
        return candidateFrp === currentFrp && candidate.time > current.time ? candidate : current;
    }

    function animationSymbolIcon(point, size, showLabel, pixelSymbol) {
        var frpLabel = showLabel && point.frp != null ?
            '<span class="fire-animation-frp-label">' + Math.round(Number(point.frp)) + ' MW</span>' : '';
        var alternative = point.dataset === 'S3' && point.retrieval === 'alternative';
        var swir = point.dataset === 'S3' && point.retrieval === 'swir';
        var fillColor = alternative ? '#ffffff' : frpColor(point.frp);
        var outlineColor = swir ? '#27313a' : point.color;
        var symbol = point.hasFireClass || !pixelSymbol ?
            '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" style="fill:' +
            escapeAttribute(fillColor) + ';stroke:' + escapeAttribute(outlineColor) +
            ';stroke-width:2.5;opacity:' + getHotspotOpacity() + '"><path d="' +
            escapeAttribute(point.typePath) + '"/></svg>' : '';
        return L.divIcon({
            className: 'fire-animation-marker',
            html: '<div class="fire-animation-symbol">' + symbol + frpLabel + '</div>',
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
        });
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
        var hotspotOpacity = getHotspotOpacity();
        var pixelBuckets = Object.create(null);
        visible.forEach(function (point) {
            var footprint = nativeFootprint(point);
            if (footprint) {
                var bucket = pixelBuckets[footprint.key];
                if (!bucket) bucket = pixelBuckets[footprint.key] = { footprint: footprint, point: point };
                bucket.point = strongerAnimationPoint(bucket.point, point);
                return;
            }
            L.marker([point.latitude, point.longitude], {
                icon: animationSymbolIcon(point, 16, showFRPLabels, false),
                interactive: false,
                keyboard: false
            }).addTo(markerLayer);
        });

        Object.keys(pixelBuckets).forEach(function (key) {
            var bucket = pixelBuckets[key];
            var point = bucket.point;
            L.polygon(bucket.footprint.corners, {
                color: point.color,
                weight: 2,
                opacity: hotspotOpacity,
                fillColor: frpColor(point.frp),
                fillOpacity: point.dataset === 'S3' && point.retrieval === 'alternative' ? Math.min(0.42, hotspotOpacity) : hotspotOpacity,
                dashArray: point.dataset === 'S3' ? (point.retrieval === 'alternative' ? '7 5' :
                    (point.retrieval === 'swir' ? '2 6' : null)) : null,
                lineJoin: 'round',
                interactive: false,
                className: 'fire-animation-pixel'
            }).addTo(markerLayer);
            if (point.hasFireClass || (showFRPLabels && point.frp != null)) {
                L.marker([point.latitude, point.longitude], {
                    icon: animationSymbolIcon(point, 11, showFRPLabels, true),
                    interactive: false,
                    keyboard: false
                }).addTo(markerLayer);
            }
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

    async function exportVideo(format) {
        if (!active || exporting) return;
        if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
            setStatus('Video export is not supported by this browser.');
            return;
        }
        var mimeType = format === 'mp4' ? supportedMp4Mime() : supportedWebMMime();
        if (format === 'mp4' && !mimeType) {
            setStatus('MP4/H.264 export is not supported by this browser. Open the viewer in Microsoft Edge or Google Chrome.');
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
        var button = document.getElementById(format === 'mp4' ? 'fire-animation-export-mp4' : 'fire-animation-export');
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
            var brandImages = await (brandImagesPromise || Promise.resolve({ eosial: null, sia: null }));
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
                drawExportFrame(context, snapshot, crop, sourceScale, layout, attribution, brandImages);
                setStatus('Rendering ' + format.toUpperCase() + ' frame ' + (i + 1) + ' of ' + frameTimes.length + '...');
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
                filenameTime(frameTimes[frameTimes.length - 1]) + '.' + format;
            anchor.click();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            setStatus('Cropped ' + format.toUpperCase() + ' animation saved.');
        } catch (error) {
            console.error('[ANIMATION] ' + format.toUpperCase() + ' export failed:', error);
            setStatus('Export failed. The selected basemap may block browser capture; try the OpenStreetMap basemap.');
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
        var axisLeft = 66;
        var axisRight = 24;
        var axisTop = 18;
        var axisBottom = 38;
        var maxMapWidth = 1920 - axisLeft - axisRight;
        var mapScale = Math.min(maxMapWidth / crop.width, 780 / crop.height);
        var mapWidth = evenNumber(Math.max(1, Math.round(crop.width * mapScale)));
        var mapHeight = evenNumber(Math.max(1, Math.round(crop.height * mapScale)));
        var width = evenNumber(Math.max(900, mapWidth + axisLeft + axisRight));
        var headerHeight = 112;
        var footerHeight = 260;
        var mapX = axisLeft + Math.round((width - axisLeft - axisRight - mapWidth) / 2);
        var mapY = headerHeight + axisTop;
        var footerY = mapY + mapHeight + axisBottom;
        return {
            width: width,
            height: evenNumber(footerY + footerHeight),
            headerHeight: headerHeight,
            footerHeight: footerHeight,
            footerY: footerY,
            mapX: mapX,
            mapY: mapY,
            mapWidth: mapWidth,
            mapHeight: mapHeight,
            pointScaleX: mapWidth / crop.width,
            pointScaleY: mapHeight / crop.height
        };
    }
    function drawExportFrame(context, snapshot, crop, sourceScale, layout, attribution, brandImages) {
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
        var exportPixelBuckets = Object.create(null);
        currentVisiblePoints.forEach(function (point) {
            var footprint = nativeFootprint(point);
            if (footprint) {
                var bucket = exportPixelBuckets[footprint.key];
                if (!bucket) bucket = exportPixelBuckets[footprint.key] = { footprint: footprint, point: point };
                bucket.point = strongerAnimationPoint(bucket.point, point);
            } else {
                drawExportHotspot(context, point, crop, layout);
            }
        });
        Object.keys(exportPixelBuckets).forEach(function (key) {
            var bucket = exportPixelBuckets[key];
            drawExportPixel(context, bucket.point, bucket.footprint, crop, layout);
        });
        context.restore();

        drawExportCoordinateFrame(context, crop, layout);
        drawExportLegend(context, layout, attribution, brandImages);
        context.restore();
    }
    function drawExportHeader(context, layout) {
        var endTime = frameTimes[currentFrame];
        var persistence = Number(document.getElementById('fire-animation-persistence').value);
        var modeText = persistence === 0 ?
            'Exact acquisition timestamp' :
            'Detections acquired in the preceding ' + persistence + ' minutes';
        var title = getAnimationTitle() || 'Selected hotspot animation';

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, layout.width, layout.headerHeight);
        context.fillStyle = '#0f172a';
        context.textAlign = 'left';
        context.textBaseline = 'alphabetic';
        fitCanvasText(context, title, layout.width - 56, 30, 19, '750');
        context.fillText(ellipsizeCanvasText(context, title, layout.width - 56), 28, 39);

        context.fillStyle = '#475569';
        context.font = '700 13px Inter, Arial, sans-serif';
        context.fillText('EOSIAL Active Fire Viewer', 28, 69);
        context.fillStyle = '#0f172a';
        context.font = '700 17px Inter, Arial, sans-serif';
        context.textAlign = 'right';
        context.fillText(formatUTC(endTime), layout.width - 28, 69);

        context.fillStyle = '#64748b';
        context.font = '600 12px Inter, Arial, sans-serif';
        context.textAlign = 'left';
        context.fillText(modeText + ' | ' + currentVisiblePoints.length + ' detections | Map zoom ' + map.getZoom(), 28, 95);
        context.strokeStyle = '#e2e8f0';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(0, layout.headerHeight - 1);
        context.lineTo(layout.width, layout.headerHeight - 1);
        context.stroke();
    }

    function fitCanvasText(context, text, maxWidth, maximum, minimum, weight) {
        var size = maximum;
        do {
            context.font = weight + ' ' + size + 'px Inter, Arial, sans-serif';
            if (context.measureText(text).width <= maxWidth) return size;
            size -= 1;
        } while (size > minimum);
        context.font = weight + ' ' + minimum + 'px Inter, Arial, sans-serif';
        return minimum;
    }

    function ellipsizeCanvasText(context, text, maxWidth) {
        if (context.measureText(text).width <= maxWidth) return text;
        var suffix = '...';
        var low = 0;
        var high = text.length;
        while (low < high) {
            var middle = Math.ceil((low + high) / 2);
            if (context.measureText(text.substring(0, middle) + suffix).width <= maxWidth) low = middle;
            else high = middle - 1;
        }
        return text.substring(0, low).trimEnd() + suffix;
    }
    function niceCoordinateStep(span, targetCount) {
        if (!isFinite(span) || span <= 0) return 1;
        var rough = span / Math.max(1, targetCount);
        var power = Math.pow(10, Math.floor(Math.log10(rough)));
        var normalized = rough / power;
        var factor = normalized <= 1 ? 1 : (normalized <= 2 ? 2 : (normalized <= 5 ? 5 : 10));
        return factor * power;
    }

    function coordinateValues(minimum, maximum, step) {
        var values = [];
        var first = Math.ceil((minimum - step * 1e-8) / step) * step;
        for (var value = first; value <= maximum + step * 1e-8; value += step) {
            values.push(Math.abs(value) < step * 1e-8 ? 0 : value);
        }
        return values;
    }

    function formatCoordinate(value, axis, step) {
        var precision = step >= 1 ? 0 : (step >= 0.1 ? 1 : (step >= 0.01 ? 2 : 3));
        var suffix = axis === 'longitude' ? (value < 0 ? ' W' : ' E') : (value < 0 ? ' S' : ' N');
        return Math.abs(value).toFixed(precision) + '\u00B0' + suffix;
    }

    function drawExportCoordinateFrame(context, crop, layout) {
        if (!selectionBounds) return;
        var west = selectionBounds.getWest();
        var east = selectionBounds.getEast();
        var south = selectionBounds.getSouth();
        var north = selectionBounds.getNorth();
        var longitudeStep = niceCoordinateStep(east - west, Math.max(3, Math.min(7, Math.round(layout.mapWidth / 260))));
        var latitudeStep = niceCoordinateStep(north - south, Math.max(3, Math.min(6, Math.round(layout.mapHeight / 190))));
        var tickLength = 7;

        context.save();
        context.strokeStyle = '#334155';
        context.fillStyle = '#334155';
        context.lineWidth = 1.25;
        context.font = '650 11px Inter, Arial, sans-serif';
        context.textBaseline = 'middle';

        coordinateValues(west, east, longitudeStep).forEach(function (longitude) {
            var x = exportCanvasPoint((south + north) / 2, longitude, crop, layout).x;
            if (x < layout.mapX - 1 || x > layout.mapX + layout.mapWidth + 1) return;
            context.beginPath();
            context.moveTo(x, layout.mapY);
            context.lineTo(x, layout.mapY + tickLength);
            context.moveTo(x, layout.mapY + layout.mapHeight);
            context.lineTo(x, layout.mapY + layout.mapHeight - tickLength);
            context.stroke();
            context.textAlign = 'center';
            context.fillText(formatCoordinate(longitude, 'longitude', longitudeStep), x,
                layout.mapY + layout.mapHeight + 21);
        });

        coordinateValues(south, north, latitudeStep).forEach(function (latitude) {
            var y = exportCanvasPoint(latitude, (west + east) / 2, crop, layout).y;
            if (y < layout.mapY - 1 || y > layout.mapY + layout.mapHeight + 1) return;
            context.beginPath();
            context.moveTo(layout.mapX, y);
            context.lineTo(layout.mapX + tickLength, y);
            context.moveTo(layout.mapX + layout.mapWidth, y);
            context.lineTo(layout.mapX + layout.mapWidth - tickLength, y);
            context.stroke();
            context.textAlign = 'right';
            context.fillText(formatCoordinate(latitude, 'latitude', latitudeStep), layout.mapX - 11, y);
        });

        context.strokeStyle = '#1e293b';
        context.lineWidth = 1.5;
        context.strokeRect(layout.mapX, layout.mapY, layout.mapWidth, layout.mapHeight);
        context.restore();
    }
    function exportCanvasPoint(latitude, longitude, crop, layout) {
        var screenPoint = map.latLngToContainerPoint([latitude, longitude]);
        return {
            x: layout.mapX + (screenPoint.x - crop.left) * layout.pointScaleX,
            y: layout.mapY + (screenPoint.y - crop.top) * layout.pointScaleY
        };
    }

    function drawExportHotspot(context, point, crop, layout) {
        var canvasPoint = exportCanvasPoint(point.latitude, point.longitude, crop, layout);
        var size = 22;
        context.save();
        context.globalAlpha = getHotspotOpacity();
        if (point.dataset === 'S3' && point.retrieval === 'alternative') context.setLineDash([7, 5]);
        else if (point.dataset === 'S3' && point.retrieval === 'swir') context.setLineDash([2, 6]);
        context.shadowColor = 'rgba(15, 23, 42, 0.65)';
        context.shadowBlur = 5;
        context.shadowOffsetY = 2;
        drawCanvasFireShape(context, canvasPoint.x, canvasPoint.y, size,
            point.hasFireClass ? point.fireType : -1,
            point.dataset === 'S3' && point.retrieval === 'alternative' ? '#ffffff' : frpColor(point.frp), point.color, 3);
        context.restore();

        if (document.getElementById('fire-animation-labels').checked && point.frp != null) {
            drawExportFRPLabel(context, canvasPoint.x, canvasPoint.y - size / 2 - 7,
                Math.round(Number(point.frp)) + ' MW');
        }
    }

    function drawExportPixel(context, point, footprint, crop, layout) {
        var corners = footprint.corners.map(function (corner) {
            return exportCanvasPoint(corner[0], corner[1], crop, layout);
        });
        context.save();
        context.globalAlpha = getHotspotOpacity();
        context.beginPath();
        corners.forEach(function (corner, index) {
            if (index === 0) context.moveTo(corner.x, corner.y);
            else context.lineTo(corner.x, corner.y);
        });
        context.closePath();
        context.fillStyle = frpColor(point.frp);
        if (point.dataset === 'S3' && point.retrieval === 'alternative') context.globalAlpha = Math.min(0.42, getHotspotOpacity());
        context.fill();
        context.strokeStyle = point.color;
        context.lineWidth = 3;
        if (point.dataset === 'S3' && point.retrieval === 'alternative') context.setLineDash([8, 5]);
        else if (point.dataset === 'S3' && point.retrieval === 'swir') context.setLineDash([2, 6]);
        context.stroke();
        context.restore();

        var center = exportCanvasPoint(point.latitude, point.longitude, crop, layout);
        if (point.hasFireClass) {
            context.save();
            context.globalAlpha = getHotspotOpacity();
            drawCanvasFireShape(context, center.x, center.y, 13, point.fireType,
                frpColor(point.frp), point.color, 2.5);
            context.restore();
        }
        if (document.getElementById('fire-animation-labels').checked && point.frp != null) {
            var top = Math.min.apply(null, corners.map(function (corner) { return corner.y; }));
            drawExportFRPLabel(context, center.x, top - 7, Math.round(Number(point.frp)) + ' MW');
        }
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

    function drawExportLegend(context, layout, attribution, brandImages) {
        var top = layout.footerY;
        var pointsInRange = animationPointsInRange();
        var satellites = {};
        var fireTypes = {};
        pointsInRange.forEach(function (point) {
            var satelliteKey = point.satellite + (point.retrieval ? ' - ' + retrievalLabel(point.retrieval) : '');
            satellites[satelliteKey] = point.color;
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
        drawExportSectionTitle(context, 'SATELLITE OUTLINE', margin, top + 27);
        drawSatelliteLegend(context, satellites, margin, top + 48, satelliteWidth);

        drawExportSectionTitle(context, 'FIRE TYPE', margin + satelliteWidth + sectionGap, top + 27);
        drawFireTypeLegend(context, fireTypes, margin + satelliteWidth + sectionGap, top + 48, typeWidth);

        drawExportSectionTitle(context, 'FRP [MW] - LOG SCALE', frpX, top + 27);
        drawFRPLegend(context, frpX, top + 54, layout.width - frpX - margin);

        context.strokeStyle = '#e2e8f0';
        context.beginPath();
        context.moveTo(margin, top + 142);
        context.lineTo(layout.width - margin, top + 142);
        context.stroke();

        if (brandImages) {
            var eosialSize = containedImageSize(brandImages.eosial, 260, 72);
            var siaSize = containedImageSize(brandImages.sia, 100, 72);
            var logoGap = eosialSize.width && siaSize.width ? 32 : 0;
            var logoWidth = eosialSize.width + logoGap + siaSize.width;
            var logoX = Math.max(margin, (layout.width - logoWidth) / 2);
            drawContainedImage(context, brandImages.eosial, logoX, top + 155, 260, 72);
            drawContainedImage(context, brandImages.sia,
                logoX + eosialSize.width + logoGap, top + 155, 100, 72);
        }

        context.fillStyle = '#94a3b8';
        context.font = '500 10px Inter, Arial, sans-serif';
        context.textAlign = 'right';
        context.fillText(attribution || 'Basemap attribution shown in the interactive viewer',
            layout.width - margin, layout.height - 13);
    }

    function containedImageSize(image, maximumWidth, maximumHeight) {
        if (!image || !image.naturalWidth || !image.naturalHeight) return { width: 0, height: 0 };
        var scale = Math.min(maximumWidth / image.naturalWidth, maximumHeight / image.naturalHeight);
        return {
            width: image.naturalWidth * scale,
            height: image.naturalHeight * scale
        };
    }

    function drawContainedImage(context, image, x, y, maximumWidth, maximumHeight) {
        var size = containedImageSize(image, maximumWidth, maximumHeight);
        if (!size.width || !size.height) return 0;
        context.drawImage(image, x, y + (maximumHeight - size.height) / 2, size.width, size.height);
        return size.width;
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
            context.fillStyle = '#ffffff';
            context.fill();
            context.strokeStyle = satellites[key];
            context.lineWidth = 2.5;
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
            2: 'Static source'
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
        var barWidth = Math.max(120, width);
        var barHeight = 14;
        var gradient = context.createLinearGradient(x, y, x + barWidth, y);
        FRP_COLOR_STOPS.forEach(function (stop) {
            gradient.addColorStop(stop.t, 'rgb(' + stop.c.join(',') + ')');
        });
        context.fillStyle = gradient;
        context.fillRect(x, y - barHeight / 2, barWidth, barHeight);
        context.strokeStyle = '#64748b';
        context.lineWidth = 1;
        context.strokeRect(x, y - barHeight / 2, barWidth, barHeight);
        ['1', '10', '100', '1000+'].forEach(function (label, index) {
            context.fillStyle = '#475569';
            context.font = '700 10px Inter, Arial, sans-serif';
            context.textAlign = index === 0 ? 'left' : (index === 3 ? 'right' : 'center');
            context.fillText(label, x + barWidth * index / 3, y + 25);
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
    function supportedMp4Mime() {
        if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
        var candidates = [
            'video/mp4;codecs=avc1.42E01E',
            'video/mp4;codecs=avc1.4D401E',
            'video/mp4;codecs=h264',
            'video/mp4'
        ];
        for (var i = 0; i < candidates.length; i++) {
            if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
        }
        return '';
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
    function getHotspotOpacity() {
        var input = document.getElementById('fire-animation-opacity');
        var percentage = input ? Number(input.value) : 85;
        if (!isFinite(percentage)) percentage = 85;
        return Math.max(20, Math.min(100, percentage)) / 100;
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
