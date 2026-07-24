/**
 * Viewport-limited canvas rendering for native MSG/MTG pixel grids.
 */
(function () {
    'use strict';

    var mapRef = null;
    var dataBase = 'data';
    var activeLayer = null;
    var activeDefinition = null;
    var statusControl = null;
    var statusElement = null;
    var MAX_VISIBLE_CELLS = 16000;

    var definitions = {
        'msg-hrit-grid-3km': {
            id: 'msg-hrit-grid-3km',
            name: 'MSG-HRIT 3 km Pixel Grid',
            file: 'pixel-grids/msg_hrit_3km.json',
            color: '#0f766e'
        },
        'msg-rss-grid-3km': {
            id: 'msg-rss-grid-3km',
            name: 'MSG-RSS 3 km Pixel Grid',
            file: 'pixel-grids/msg_rss_3km.json',
            color: '#7c3aed'
        },
        'mtg-fci-grid-1km': {
            id: 'mtg-fci-grid-1km',
            name: 'MTG-FCI 1 km Pixel Grid',
            file: 'pixel-grids/mtg_fci_1km.json',
            color: '#075985'
        },
        'mtg-fir-grid-2km': {
            id: 'mtg-fir-grid-2km',
            name: 'MTG-FIR 2 km Pixel Grid',
            file: 'pixel-grids/mtg_fir_2km.json',
            color: '#9f1239'
        }
    };

    function ensurePane(map) {
        if (map.getPane('pixelGridPane')) return;
        var pane = map.createPane('pixelGridPane');
        pane.style.zIndex = 455;
        pane.style.pointerEvents = 'none';
    }

    function ensureStatusControl(map) {
        if (statusControl) return;
        statusControl = L.control({ position: 'bottomleft' });
        statusControl.onAdd = function () {
            statusElement = L.DomUtil.create('div', 'pixel-grid-status hidden');
            L.DomEvent.disableClickPropagation(statusElement);
            return statusElement;
        };
        statusControl.addTo(map);
    }

    function setStatus(message, muted) {
        if (!statusElement) return;
        statusElement.textContent = message || '';
        statusElement.classList.toggle('hidden', !message);
        statusElement.classList.toggle('pixel-grid-status-muted', !!muted);
    }

    function setToggleChecked(layerId, checked) {
        var input = document.querySelector(
            '#layer-toggles input[data-layer-id="' + layerId + '"]'
        );
        if (input) input.checked = checked;
    }

    function findRun(runs, column) {
        var low = 0;
        var high = runs.length - 1;
        while (low <= high) {
            var middle = (low + high) >> 1;
            var run = runs[middle];
            if (column < run[0]) high = middle - 1;
            else if (column > run[1]) low = middle + 1;
            else return run;
        }
        return null;
    }

    function cellAtLatLng(metadata, latlng) {
        var nativePoint;
        try {
            nativePoint = proj4('WGS84', metadata.projection, [latlng.lng, latlng.lat]);
        } catch (error) {
            return null;
        }
        var column = Math.floor((nativePoint[0] - metadata.origin_x) / metadata.pixel_x);
        var row = Math.floor((nativePoint[1] - metadata.origin_y) / metadata.pixel_y);
        if (row < 0 || row >= metadata.height || column < 0 || column >= metadata.width) {
            return null;
        }
        if (!findRun(metadata.runs[row], column)) return null;
        return { row: row, column: column };
    }

    function globalCellDetails(metadata, cell) {
        var row = metadata.global_row_offset + cell.row;
        var column = metadata.global_column_offset + cell.column;
        var km = metadata.resolution_m / 1000;
        return {
            row: row,
            column: column,
            pixelId: (metadata.pixel_prefix || 'FCI') + '_' + km + 'KM_R' +
                String(row).padStart(5, '0') + '_C' + String(column).padStart(5, '0')
        };
    }

    var PixelGridCanvas = L.Layer.extend({
        initialize: function (definition, metadata) {
            this.definition = definition;
            this.metadata = metadata;
            this.canvas = null;
            this.frame = null;
            this.lastMessage = '';
        },

        onAdd: function (map) {
            this.map = map;
            this.canvas = L.DomUtil.create('canvas', 'pixel-grid-canvas');
            this.canvas.setAttribute('aria-hidden', 'true');
            map.getPane('pixelGridPane').appendChild(this.canvas);
            map.on('moveend zoomend resize', this.scheduleRedraw, this);
            map.on('click', this.handleClick, this);
            this.scheduleRedraw();
        },

        onRemove: function (map) {
            map.off('moveend zoomend resize', this.scheduleRedraw, this);
            map.off('click', this.handleClick, this);
            if (this.frame) cancelAnimationFrame(this.frame);
            this.frame = null;
            if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
            this.canvas = null;
        },

        scheduleRedraw: function () {
            if (this.frame) cancelAnimationFrame(this.frame);
            this.frame = requestAnimationFrame(function () {
                this.frame = null;
                this.redraw();
            }.bind(this));
        },

        visibleRange: function () {
            var bounds = this.map.getBounds();
            var south = bounds.getSouth();
            var north = bounds.getNorth();
            var west = bounds.getWest();
            var east = bounds.getEast();
            var latitudes = [south, (south + north) / 2, north];
            var longitudes = [west, (west + east) / 2, east];
            var nativePoints = [];
            for (var latIndex = 0; latIndex < latitudes.length; latIndex++) {
                for (var lonIndex = 0; lonIndex < longitudes.length; lonIndex++) {
                    try {
                        nativePoints.push(proj4(
                            'WGS84',
                            this.metadata.projection,
                            [longitudes[lonIndex], latitudes[latIndex]]
                        ));
                    } catch (error) {
                        // Ignore points outside the geostationary projection.
                    }
                }
            }
            if (!nativePoints.length) return null;

            var xs = nativePoints.map(function (point) { return point[0]; });
            var ys = nativePoints.map(function (point) { return point[1]; });
            var colA = Math.floor((Math.min.apply(null, xs) - this.metadata.origin_x) /
                this.metadata.pixel_x) - 1;
            var colB = Math.floor((Math.max.apply(null, xs) - this.metadata.origin_x) /
                this.metadata.pixel_x) + 1;
            var rowA = Math.floor((Math.max.apply(null, ys) - this.metadata.origin_y) /
                this.metadata.pixel_y) - 1;
            var rowB = Math.floor((Math.min.apply(null, ys) - this.metadata.origin_y) /
                this.metadata.pixel_y) + 1;

            return {
                rowMin: Math.max(0, Math.min(rowA, rowB)),
                rowMax: Math.min(this.metadata.height - 1, Math.max(rowA, rowB)),
                colMin: Math.max(0, Math.min(colA, colB)),
                colMax: Math.min(this.metadata.width - 1, Math.max(colA, colB))
            };
        },

        countVisibleCells: function (range) {
            var count = 0;
            for (var row = range.rowMin; row <= range.rowMax; row++) {
                var runs = this.metadata.runs[row];
                for (var index = 0; index < runs.length; index++) {
                    var start = Math.max(range.colMin, runs[index][0]);
                    var end = Math.min(range.colMax, runs[index][1]);
                    if (end >= start) count += end - start + 1;
                }
            }
            return count;
        },

        projectCorner: function (row, column, cache) {
            var key = row + ':' + column;
            if (cache[key]) return cache[key];
            var x = this.metadata.origin_x + column * this.metadata.pixel_x;
            var y = this.metadata.origin_y + row * this.metadata.pixel_y;
            var lonLat;
            try {
                lonLat = proj4(this.metadata.projection, 'WGS84', [x, y]);
            } catch (error) {
                return null;
            }
            var point = this.map.latLngToContainerPoint([lonLat[1], lonLat[0]]);
            cache[key] = point;
            return point;
        },

        redraw: function () {
            if (!this.canvas || !this.map) return;
            var size = this.map.getSize();
            var ratio = Math.min(window.devicePixelRatio || 1, 2);
            this.canvas.width = Math.round(size.x * ratio);
            this.canvas.height = Math.round(size.y * ratio);
            this.canvas.style.width = size.x + 'px';
            this.canvas.style.height = size.y + 'px';
            L.DomUtil.setPosition(
                this.canvas,
                this.map.containerPointToLayerPoint([0, 0])
            );

            var context = this.canvas.getContext('2d');
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            context.clearRect(0, 0, size.x, size.y);

            if (this.map.getZoom() < this.metadata.min_zoom) {
                setStatus(
                    this.definition.name + ': zoom to level ' + this.metadata.min_zoom +
                    ' to display cells',
                    true
                );
                return;
            }

            var range = this.visibleRange();
            if (!range || range.rowMax < range.rowMin || range.colMax < range.colMin) {
                setStatus(this.definition.name + ': outside coverage', true);
                return;
            }
            var visibleCount = this.countVisibleCells(range);
            if (!visibleCount) {
                setStatus(this.definition.name + ': no grid cells in view', true);
                return;
            }
            if (visibleCount > MAX_VISIBLE_CELLS) {
                setStatus(
                    this.definition.name + ': zoom in to draw ' +
                    visibleCount.toLocaleString() + ' cells',
                    true
                );
                return;
            }

            var cache = Object.create(null);
            context.beginPath();
            for (var row = range.rowMin; row <= range.rowMax; row++) {
                var runs = this.metadata.runs[row];
                for (var runIndex = 0; runIndex < runs.length; runIndex++) {
                    var start = Math.max(range.colMin, runs[runIndex][0]);
                    var end = Math.min(range.colMax, runs[runIndex][1]);
                    for (var column = start; column <= end; column++) {
                        var topLeft = this.projectCorner(row, column, cache);
                        var topRight = this.projectCorner(row, column + 1, cache);
                        var bottomRight = this.projectCorner(row + 1, column + 1, cache);
                        var bottomLeft = this.projectCorner(row + 1, column, cache);
                        if (!topLeft || !topRight || !bottomRight || !bottomLeft) continue;
                        context.moveTo(topLeft.x, topLeft.y);
                        context.lineTo(topRight.x, topRight.y);
                        context.lineTo(bottomRight.x, bottomRight.y);
                        context.lineTo(bottomLeft.x, bottomLeft.y);
                        context.closePath();
                    }
                }
            }
            context.lineJoin = 'round';
            context.strokeStyle = 'rgba(255,255,255,0.82)';
            context.lineWidth = 2.4;
            context.stroke();
            context.strokeStyle = this.definition.color;
            context.lineWidth = 0.8;
            context.stroke();
            setStatus(
                this.definition.name + ' - ' + visibleCount.toLocaleString() +
                ' cells in view',
                false
            );
        },

        handleClick: function (event) {
            if (this.map.getZoom() < this.metadata.min_zoom) return;
            var cell = cellAtLatLng(this.metadata, event.latlng);
            if (!cell) return;
            var details = globalCellDetails(this.metadata, cell);
            L.popup({ className: 'pixel-grid-popup', maxWidth: 260 })
                .setLatLng(event.latlng)
                .setContent(
                    '<strong>' + this.definition.name + '</strong>' +
                    '<dl><dt>Pixel ID</dt><dd>' + details.pixelId + '</dd>' +
                    '<dt>Resolution</dt><dd>' + this.metadata.resolution_m.toLocaleString() +
                    ' m</dd><dt>Row</dt><dd>' + details.row.toLocaleString() +
                    '</dd><dt>Column</dt><dd>' + details.column.toLocaleString() +
                    '</dd></dl>'
                )
                .openOn(this.map);
        }
    });

    function disableActiveLayer() {
        if (activeLayer && mapRef && mapRef.hasLayer(activeLayer)) {
            mapRef.removeLayer(activeLayer);
        }
        if (activeDefinition) setToggleChecked(activeDefinition.id, false);
        activeLayer = null;
        activeDefinition = null;
        setStatus('', false);
    }

    function enableDefinition(definition) {
        if (!mapRef) return;
        if (activeDefinition && activeDefinition.id !== definition.id) disableActiveLayer();
        setToggleChecked(definition.id, true);
        if (activeLayer && activeDefinition === definition) return;

        activeDefinition = definition;
        setStatus('Loading ' + definition.name + '...', true);
        fetch(dataBase.replace(/\/$/, '') + '/' + definition.file)
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function (metadata) {
                if (activeDefinition !== definition) return;
                activeLayer = new PixelGridCanvas(definition, metadata);
                activeLayer.addTo(mapRef);
            })
            .catch(function (error) {
                console.error('[PIXEL GRID]', error);
                if (activeDefinition === definition) {
                    setStatus('Unable to load ' + definition.name, true);
                    setToggleChecked(definition.id, false);
                    activeDefinition = null;
                }
            });
    }

    function layerDefinition(definition) {
        return {
            id: definition.id,
            name: definition.name,
            defaultVisible: false,
            setVisible: function (visible) {
                if (visible) enableDefinition(definition);
                else if (activeDefinition === definition) disableActiveLayer();
            }
        };
    }

    EV.pixelGrids = {
        init: function (map, baseUrl) {
            mapRef = map;
            dataBase = baseUrl || 'data';
            ensurePane(map);
            ensureStatusControl(map);
        }
    };
    EV.pixelGridLayers = Object.keys(definitions).map(function (key) {
        return layerDefinition(definitions[key]);
    });
})();
