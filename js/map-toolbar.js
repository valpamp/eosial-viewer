/* Leaflet controls shared by the two EOSIAL viewers. */
(function () {
    'use strict';

    const icons = {
        plus: '<path d="M12 5v14M5 12h14"/>',
        minus: '<path d="M5 12h14"/>',
        layers: '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
        search: '<path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>',
        point: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>',
        area: '<path d="M4 4h16v16H4z"/><path d="M9 9h6v6H9z" stroke-dasharray="2,2"/>',
        dark: '<path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/>',
        measure: '<g transform="rotate(-45 12 12)"><rect x="1" y="6" width="22" height="12" rx="1"/>' +
            '<path d="M6.5 10v4M10 10v2.5M13.5 10v4M17 10v2.5"/></g>',
        camera: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>' +
            '<circle cx="12" cy="13" r="4"/>'
    };

    EV.mapToolButton = function (parent, icon, label) {
        const button = L.DomUtil.create('button', 'toolbar-btn', parent);
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        if (icons[icon]) {
            button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + icons[icon] + '</svg>';
        } else {
            button.textContent = icon;
        }
        return button;
    };

    const GrayscaleTopo = L.TileLayer.extend({
        createTile(coords, done) {
            const tile = document.createElement('canvas');
            const size = this.getTileSize();
            tile.width = size.x;
            tile.height = size.y;
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = () => {
                const context = tile.getContext('2d');
                context.filter = 'grayscale(1)';
                context.drawImage(image, 0, 0, size.x, size.y);
                done(null, tile);
            };
            image.onerror = () => done(new Error('USGS basemap tile unavailable'), tile);
            image.src = this.getTileUrl(coords);
            return tile;
        }
    });

    EV.mapBasemaps = function () {
        return {
            'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
                maxZoom: 19, crossOrigin: 'anonymous'
            }),
            'Satellite (Google)': L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
                attribution: '&copy; Google', maxZoom: 20
            }),
            'USGS Topographic (grayscale)': new GrayscaleTopo('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
                maxNativeZoom: 16, maxZoom: 19,
                attribution: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>'
            }),
            'Topographic': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenTopoMap', maxZoom: 17
            })
        };
    };

    EV.addMapToolbarBase = function (map, wrap, basemaps, afterZoom) {
        L.DomEvent.disableClickPropagation(wrap);
        L.DomEvent.disableScrollPropagation(wrap);
        EV.mapToolButton(wrap, 'plus', 'Zoom in').onclick = () => map.zoomIn();
        EV.mapToolButton(wrap, 'minus', 'Zoom out').onclick = () => map.zoomOut();
        if (afterZoom) afterZoom(wrap);

        const basemapWrap = L.DomUtil.create('div', 'map-toolbar-menu', wrap);
        const layersButton = EV.mapToolButton(basemapWrap, 'layers', 'Basemaps');
        const dropdown = L.DomUtil.create('div', 'basemap-dropdown', basemapWrap);
        const searchWrap = L.DomUtil.create('div', 'map-toolbar-menu', wrap);
        const searchButton = EV.mapToolButton(searchWrap, 'search', 'Search location');
        const geocoderWrap = L.DomUtil.create('div', 'toolbar-geocoder', searchWrap);
        const searchInput = L.DomUtil.create('input', '', geocoderWrap);
        const results = L.DomUtil.create('div', 'geocoder-results', geocoderWrap);
        const search = EV.createLocationSearch();

        function setOpen(button, panel, open) {
            panel.classList.toggle('open', open);
            button.setAttribute('aria-expanded', String(open));
        }
        layersButton.setAttribute('aria-expanded', 'false');
        searchButton.setAttribute('aria-expanded', 'false');
        function close() {
            setOpen(layersButton, dropdown, false);
            setOpen(searchButton, geocoderWrap, false);
            search.cancel();
        }
        for (const [name, layer] of Object.entries(basemaps)) {
            const option = L.DomUtil.create('button', 'basemap-option', dropdown);
            option.type = 'button';
            option.classList.toggle('active', map.hasLayer(layer));
            option.textContent = name;
            option.onclick = () => {
                Object.values(basemaps).forEach(candidate => map.removeLayer(candidate));
                layer.addTo(map);
                for (const item of dropdown.children) item.classList.toggle('active', item === option);
                close();
            };
        }
        layersButton.onclick = () => {
            const open = !dropdown.classList.contains('open');
            close();
            setOpen(layersButton, dropdown, open);
        };
        searchButton.onclick = () => {
            const open = !geocoderWrap.classList.contains('open');
            close();
            setOpen(searchButton, geocoderWrap, open);
            if (open) searchInput.focus();
        };
        searchInput.type = 'search';
        searchInput.placeholder = 'Search location, then press Enter';
        searchInput.setAttribute('aria-label', 'Location name');
        searchInput.addEventListener('input', () => {
            search.cancel();
            results.replaceChildren();
        });
        searchInput.addEventListener('keydown', async event => {
            if (event.key === 'Escape') {
                close();
                searchButton.focus();
            }
            if (event.key !== 'Enter' || event.isComposing || searchInput.value.trim().length < 3) return;
            event.preventDefault();
            results.textContent = 'Searching…';
            try {
                const matches = await search.search(searchInput.value);
                if (matches === null) return;
                results.textContent = '';
                for (const match of matches) {
                    const bounds = match.boundingbox?.map(Number);
                    if (bounds?.length !== 4 || !bounds.every(Number.isFinite)) continue;
                    const item = L.DomUtil.create('button', 'geocoder-result', results);
                    item.type = 'button';
                    item.textContent = match.display_name;
                    item.onclick = () => {
                        map.fitBounds([[bounds[0], bounds[2]], [bounds[1], bounds[3]]]);
                        searchInput.value = '';
                        results.replaceChildren();
                        close();
                    };
                }
                if (!results.childElementCount) results.textContent = 'No locations found.';
            } catch {
                results.textContent = 'Search unavailable. Please try again.';
            }
        });
        map.on('click', close);
        return close;
    };

    EV.captureMap = function (map, scale = 1) {
        return html2canvas(map.getContainer(), {
            useCORS: true, allowTaint: false, scale, backgroundColor: null, logging: false,
            ignoreElements: element => element.classList.contains('map-toolbar')
        });
    };
})();
