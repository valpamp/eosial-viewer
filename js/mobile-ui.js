/**
 * Responsive mobile dock and bottom sheet.
 * Existing desktop controls are moved into the sheet, never duplicated.
 */
(function () {
    'use strict';

    window.EV = window.EV || {};

    var media = window.matchMedia('(max-width: 760px)');
    var activeMode = null;
    var mapRef = null;
    var nodes = {};
    var ui = {};

    function rememberNode(name, element) {
        if (!element || nodes[name]) return;
        var marker = document.createComment('mobile-' + name + '-home');
        element.parentNode.insertBefore(marker, element);
        nodes[name] = { element: element, marker: marker };
    }

    function restoreNode(name) {
        var item = nodes[name];
        if (!item || !item.marker.parentNode) return;
        item.marker.parentNode.insertBefore(item.element, item.marker.nextSibling);
    }

    function restoreAll() {
        restoreNode('layers');
        restoreNode('fire');
    }

    function setDockState(mode) {
        document.querySelectorAll('[data-mobile-panel]').forEach(function (button) {
            var selected = mode && button.getAttribute('data-mobile-panel') === mode;
            button.classList.toggle('active', !!selected);
            button.setAttribute('aria-expanded', selected ? 'true' : 'false');
        });
    }

    function moveForMode(mode) {
        ui.body.innerHTML = '';
        restoreAll();
        if (mode === 'layers' && nodes.layers) ui.body.appendChild(nodes.layers.element);
        if ((mode === 'time' || mode === 'filters') && nodes.fire) ui.body.appendChild(nodes.fire.element);
    }

    function open(mode) {
        if (!media.matches) return;
        if (activeMode === mode && document.body.classList.contains('mobile-sheet-open')) {
            close();
            return;
        }
        activeMode = mode;
        moveForMode(mode);
        ui.sheet.className = 'mobile-control-sheet mode-' + mode;
        ui.title.textContent = mode === 'layers' ? 'Hotspot layers' :
            (mode === 'time' ? 'Observation window' : 'Dataset filters');
        ui.sheet.setAttribute('aria-hidden', 'false');
        ui.backdrop.classList.remove('hidden');
        document.body.classList.add('mobile-sheet-open');
        setDockState(mode);
        ui.sheet.style.transform = '';
        updateSummaries();
    }

    function close() {
        activeMode = null;
        document.body.classList.remove('mobile-sheet-open');
        ui.sheet.setAttribute('aria-hidden', 'true');
        ui.sheet.style.transform = '';
        ui.backdrop.classList.add('hidden');
        setDockState(null);
        restoreAll();
    }

    function updateSummaries() {
        var layerChecks = document.querySelectorAll('#layer-toggles input[type="checkbox"]:checked').length;
        ui.layersSummary.textContent = layerChecks + ' active';

        var activeTime = document.querySelector('.fire-time-btn.active');
        ui.timeSummary.textContent = activeTime ?
            (activeTime.getAttribute('data-hours') === '0' ? 'All dates' : 'Last ' + activeTime.textContent.trim()) :
            'Custom range';

        var tab = document.querySelector('.fire-source-tab.active');
        var source = tab ? tab.getAttribute('data-source') : 'SFIDE';
        var names = { SFIDE: 'SFIDE', FIRMS: 'FIRMS', S3: 'Sentinel-3', MTG_FIR: 'MTG-FIR' };
        var frpIds = { SFIDE: 'fire-sfide-min-frp', FIRMS: 'fire-firms-min-frp', S3: 'fire-s3-min-frp' };
        var suffix = '';
        if (frpIds[source]) {
            var input = document.getElementById(frpIds[source]);
            if (input && input.value !== '') suffix = ' \u00b7 ' + input.value + ' MW';
        }
        ui.filterSummary.textContent = (names[source] || source) + suffix;
    }

    function handleMediaChange() {
        if (!media.matches) {
            close();
            restoreAll();
            document.body.classList.remove('mobile-ui');
        } else {
            document.body.classList.add('mobile-ui');
        }
        updateSummaries();
    }

    function init(map) {
        mapRef = map;
        ui.sheet = document.getElementById('mobile-control-sheet');
        ui.body = document.getElementById('mobile-sheet-body');
        ui.title = document.getElementById('mobile-sheet-title');
        ui.close = document.getElementById('mobile-sheet-close');
        ui.handle = document.getElementById('mobile-sheet-handle');
        ui.backdrop = document.getElementById('mobile-sheet-backdrop');
        ui.layersSummary = document.getElementById('mobile-layers-summary');
        ui.timeSummary = document.getElementById('mobile-time-summary');
        ui.filterSummary = document.getElementById('mobile-filter-summary');
        if (!ui.sheet || !ui.body) return;

        rememberNode('layers', document.getElementById('layer-toggles'));
        rememberNode('fire', document.getElementById('fire-controls'));

        document.querySelectorAll('[data-mobile-panel]').forEach(function (button) {
            button.addEventListener('click', function () {
                open(button.getAttribute('data-mobile-panel'));
            });
        });
        ui.close.addEventListener('click', close);
        ui.backdrop.addEventListener('click', close);
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && activeMode) close();
        });
        document.addEventListener('change', function (event) {
            if (event.target.closest('#layer-toggles, #fire-controls')) updateSummaries();
        });
        document.addEventListener('click', function (event) {
            if (event.target.closest('.fire-time-btn, .fire-source-tab, #fire-apply-custom')) {
                window.setTimeout(updateSummaries, 0);
            }
        });
        if (media.addEventListener) media.addEventListener('change', handleMediaChange);
        else media.addListener(handleMediaChange);
        handleMediaChange();
    }

    EV.mobileUI = { init: init, open: open, close: close, update: updateSummaries };
})();