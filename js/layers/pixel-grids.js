/**
 * Native MSG/MTG grid projection and per-detection polar-sensor footprints.
 */
(function () {
    'use strict';

    var dataBase = 'data';
    var metadataCache = Object.create(null);
    var metadataLoads = Object.create(null);

    var definitions = {
        'msg-hrit-grid-3km': { id: 'msg-hrit-grid-3km', file: 'pixel-grids/msg_hrit_3km.json' },
        'msg-rss-grid-3km': { id: 'msg-rss-grid-3km', file: 'pixel-grids/msg_rss_3km.json' },
        'mtg-fci-grid-1km': { id: 'mtg-fci-grid-1km', file: 'pixel-grids/mtg_fci_1km.json' },
        'mtg-fir-grid-2km': { id: 'mtg-fir-grid-2km', file: 'pixel-grids/mtg_fir_2km.json' }
    };

    var hotspotGridIds = {
        'MET-10': 'msg-hrit-grid-3km',
        'MET-11': 'msg-rss-grid-3km',
        'MTG-1': 'mtg-fci-grid-1km',
        'MTG-FIR': 'mtg-fir-grid-2km'
    };

    var polarFootprintDefaults = {
        'FIRMS-MODIS-AQUA': [1, 1],
        'FIRMS-MODIS-TERRA': [1, 1],
        'FIRMS-MODIS': [1, 1],
        'FIRMS-NOAA20': [0.375, 0.375],
        'FIRMS-NOAA21': [0.375, 0.375],
        'FIRMS-NPP': [0.375, 0.375],
        'S3A': [1, 1],
        'S3B': [1, 1]
    };

    function loadDefinitionMetadata(definition) {
        if (metadataCache[definition.id]) return Promise.resolve(metadataCache[definition.id]);
        if (metadataLoads[definition.id]) return metadataLoads[definition.id];
        metadataLoads[definition.id] = fetch(dataBase.replace(/\/$/, '') + '/' + definition.file)
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function (metadata) {
                metadataCache[definition.id] = metadata;
                delete metadataLoads[definition.id];
                return metadata;
            })
            .catch(function (error) {
                delete metadataLoads[definition.id];
                throw error;
            });
        return metadataLoads[definition.id];
    }

    function nativeCorner(metadata, row, column) {
        var x = metadata.origin_x + column * metadata.pixel_x;
        var y = metadata.origin_y + row * metadata.pixel_y;
        try {
            var lonLat = proj4(metadata.projection, 'WGS84', [x, y]);
            return [lonLat[1], lonLat[0]];
        } catch (error) {
            return null;
        }
    }

    function finitePositive(value) {
        var number = Number(value);
        return isFinite(number) && number > 0 ? number : null;
    }

    function polarFootprint(satellite, latitude, longitude, properties) {
        var fallback = polarFootprintDefaults[satellite];
        if (!fallback || !isFinite(latitude) || !isFinite(longitude)) return null;
        properties = properties || {};
        var widthKm;
        var heightKm;

        if (satellite.indexOf('FIRMS-') === 0) {
            widthKm = finitePositive(properties.PIXEL_SCAN_KM) || fallback[0];
            heightKm = finitePositive(properties.PIXEL_TRACK_KM) || fallback[1];
        } else {
            var acrossKm = finitePositive(properties.EFF_ACROSS_KM);
            var alongKm = finitePositive(properties.EFF_ALONG_KM);
            var areaM2 = finitePositive(properties.IFOV_AREA_M2);
            if (areaM2) {
                widthKm = heightKm = Math.sqrt(areaM2) / 1000;
            } else if (acrossKm && alongKm) {
                widthKm = heightKm = Math.sqrt(acrossKm * alongKm);
            } else {
                widthKm = fallback[0];
                heightKm = fallback[1];
            }
        }

        var halfLatitude = (heightKm / 2) / 111.32;
        var longitudeScale = 111.32 * Math.max(0.05, Math.cos(latitude * Math.PI / 180));
        var halfLongitude = (widthKm / 2) / longitudeScale;
        return {
            key: 'polar:' + satellite + ':' + Number(latitude).toFixed(6) + ':' +
                Number(longitude).toFixed(6) + ':' + widthKm.toFixed(4) + ':' + heightKm.toFixed(4),
            corners: [
                [latitude - halfLatitude, longitude - halfLongitude],
                [latitude - halfLatitude, longitude + halfLongitude],
                [latitude + halfLatitude, longitude + halfLongitude],
                [latitude + halfLatitude, longitude - halfLongitude]
            ],
            approximate: true
        };
    }

    function hotspotFootprint(satellite, latitude, longitude, properties) {
        if (polarFootprintDefaults[satellite]) {
            return polarFootprint(satellite, latitude, longitude, properties);
        }
        var definition = definitions[hotspotGridIds[satellite]];
        var metadata = definition && metadataCache[definition.id];
        if (!metadata || !isFinite(latitude) || !isFinite(longitude)) return null;
        var nativePoint;
        try {
            nativePoint = proj4('WGS84', metadata.projection, [longitude, latitude]);
        } catch (error) {
            return null;
        }
        var column = Math.floor((nativePoint[0] - metadata.origin_x) / metadata.pixel_x);
        var row = Math.floor((nativePoint[1] - metadata.origin_y) / metadata.pixel_y);
        if (row < 0 || row >= metadata.height || column < 0 || column >= metadata.width) return null;
        var corners = [
            nativeCorner(metadata, row, column),
            nativeCorner(metadata, row, column + 1),
            nativeCorner(metadata, row + 1, column + 1),
            nativeCorner(metadata, row + 1, column)
        ];
        if (corners.some(function (corner) { return !corner; })) return null;
        return {
            key: definition.id + ':' + row + ':' + column,
            row: row,
            column: column,
            corners: corners
        };
    }

    EV.pixelGrids = {
        init: function (map, baseUrl) {
            dataBase = baseUrl || 'data';
        },
        preloadHotspotGrids: function () {
            return Promise.all(Object.keys(hotspotGridIds).map(function (satellite) {
                return loadDefinitionMetadata(definitions[hotspotGridIds[satellite]]);
            }));
        },
        hasHotspotGrid: function (satellite) {
            return !!hotspotGridIds[satellite] || !!polarFootprintDefaults[satellite];
        },
        getHotspotFootprint: hotspotFootprint
    };
})();