/**
 * First-visit, dependency-free guided tour for the active fire viewer.
 */
(function () {
    'use strict';

    window.EV = window.EV || {};

    var STORAGE_KEY = 'eosial-viewer-tour-v1';
    var current = 0;
    var active = false;
    var previousFocus = null;
    var ui = {};

    var steps = [
        {
            title: 'Welcome to the Active Fire Viewer',
            text: 'Explore recent active-fire detections from several satellite products. This short guide introduces the main controls.',
            target: null
        },
        {
            title: 'Show the datasets you need',
            text: 'Use these checkboxes to show or hide SFIDE, NASA FIRMS, Sentinel-3, and MTG-FIR detections. External comparison datasets are off by default.',
            target: '#layer-toggles',
            prepare: openSidebar
        },
        {
            title: 'Choose the observation window',
            text: 'Start with the default last 6 hours, select a longer preset, or enter an exact UTC range and press Apply.',
            target: '.fire-toolbar-topline'
        },
        {
            title: 'Switch between source controls',
            text: 'Select a tab to inspect its filters. The checkbox controls map visibility; selecting the rest of the tab only changes the active control panel.',
            target: '.fire-source-tabs'
        },
        {
            title: 'Compare satellite sensors',
            text: 'Select or deselect individual satellites here. Their solid color indicators match the detections and graph legend.',
            target: '#fire-sfide-sat-list',
            prepare: showSfideTab
        },
        {
            title: 'Refine the detections',
            text: 'The default SFIDE minimum FRP is 20 MW. Lower it to include weaker detections, or raise it to focus on stronger events. Confidence and fire-type filters can further narrow the view.',
            target: '#fire-sfide-controls',
            prepare: showSfideTab
        },
        {
            title: 'Analyse an area through time',
            text: 'Choose the polygon tool and draw a rectangle around an event. The selected detections open in a dedicated analysis window.',
            target: '#btn-draw-polygon'
        },
        {
            title: 'Explore, present, and reuse the results',
            text: 'Switch freely between three views of the same selection and download the result directly to your computer. No account is required.',
            target: null,
            visual: '<div class="viewer-tour-results" aria-label="Available polygon results">' +
                '<div><strong>Animation</strong><span>Inspect fire evolution</span><small>WebM or MP4</small></div>' +
                '<div><strong>Graph</strong><span>Compare satellite timeseries</span><small>PNG</small></div>' +
                '<div><strong>Table</strong><span>Review individual detections</span><small>CSV</small></div>' +
                '</div>'
        }
    ];

    function createUi() {
        if (document.getElementById('viewer-tour')) return;
        var root = document.createElement('div');
        root.id = 'viewer-tour';
        root.className = 'viewer-tour hidden';
        root.innerHTML =
            '<div class="viewer-tour-mask viewer-tour-mask-top"></div>' +
            '<div class="viewer-tour-mask viewer-tour-mask-right"></div>' +
            '<div class="viewer-tour-mask viewer-tour-mask-bottom"></div>' +
            '<div class="viewer-tour-mask viewer-tour-mask-left"></div>' +
            '<div class="viewer-tour-focus" aria-hidden="true"></div>' +
            '<section class="viewer-tour-card" role="dialog" aria-modal="true" aria-labelledby="viewer-tour-title" aria-describedby="viewer-tour-text">' +
            '  <div class="viewer-tour-progress"><span id="viewer-tour-step"></span><button id="viewer-tour-close" type="button" aria-label="Close guide" title="Close guide">&times;</button></div>' +
            '  <h2 id="viewer-tour-title"></h2>' +
            '  <p id="viewer-tour-text"></p>' +
            '  <div id="viewer-tour-visual"></div>' +
            '  <div class="viewer-tour-actions"><button id="viewer-tour-skip" type="button">Skip tour</button><div><button id="viewer-tour-back" type="button">Back</button><button id="viewer-tour-next" type="button">Next</button></div></div>' +
            '</section>';
        document.body.appendChild(root);
        ui.root = root;
        ui.card = root.querySelector('.viewer-tour-card');
        ui.focus = root.querySelector('.viewer-tour-focus');
        ui.masks = Array.prototype.slice.call(root.querySelectorAll('.viewer-tour-mask'));
        ui.title = root.querySelector('#viewer-tour-title');
        ui.text = root.querySelector('#viewer-tour-text');
        ui.visual = root.querySelector('#viewer-tour-visual');
        ui.step = root.querySelector('#viewer-tour-step');
        ui.back = root.querySelector('#viewer-tour-back');
        ui.next = root.querySelector('#viewer-tour-next');
        ui.skip = root.querySelector('#viewer-tour-skip');
        ui.close = root.querySelector('#viewer-tour-close');
        ui.back.addEventListener('click', function () { show(current - 1); });
        ui.next.addEventListener('click', function () {
            if (current === steps.length - 1) finish();
            else show(current + 1);
        });
        ui.skip.addEventListener('click', finish);
        ui.close.addEventListener('click', finish);
    }

    function openSidebar() {
        var panel = document.getElementById('control-panel');
        if (!panel) return;
        if (panel.getBoundingClientRect().right <= 8) document.getElementById('toggle-panel-btn').click();
    }

    function showSfideTab() {
        var tab = document.querySelector('.fire-source-tab[data-source="SFIDE"]');
        if (tab && !tab.classList.contains('active')) tab.click();
    }

    function getTarget(step) {
        return step.target ? document.querySelector(step.target) : null;
    }

    function setMasks(rect) {
        var w = window.innerWidth;
        var h = window.innerHeight;
        var gap = 7;
        var top = Math.max(0, rect.top - gap);
        var left = Math.max(0, rect.left - gap);
        var right = Math.min(w, rect.right + gap);
        var bottom = Math.min(h, rect.bottom + gap);
        var values = [
            [0, 0, w, top],
            [right, top, w - right, bottom - top],
            [0, bottom, w, h - bottom],
            [0, top, left, bottom - top]
        ];
        ui.masks.forEach(function (mask, i) {
            mask.style.left = values[i][0] + 'px';
            mask.style.top = values[i][1] + 'px';
            mask.style.width = Math.max(0, values[i][2]) + 'px';
            mask.style.height = Math.max(0, values[i][3]) + 'px';
        });
        ui.focus.style.display = 'block';
        ui.focus.style.left = left + 'px';
        ui.focus.style.top = top + 'px';
        ui.focus.style.width = Math.max(0, right - left) + 'px';
        ui.focus.style.height = Math.max(0, bottom - top) + 'px';
    }

    function positionCard(target) {
        var margin = 14;
        var cardWidth = Math.min(390, window.innerWidth - 24);
        ui.card.style.width = cardWidth + 'px';
        ui.card.style.left = Math.max(12, (window.innerWidth - cardWidth) / 2) + 'px';
        ui.card.style.top = Math.max(12, (window.innerHeight - ui.card.offsetHeight) / 2) + 'px';
        if (!target) {
            setMasks({ top: 0, left: 0, right: 0, bottom: 0 });
            ui.focus.style.display = 'none';
            return;
        }
        var rect = target.getBoundingClientRect();
        setMasks(rect);
        var cardHeight = ui.card.offsetHeight;
        var below = rect.bottom + margin;
        var above = rect.top - cardHeight - margin;
        var top = below + cardHeight <= window.innerHeight - 12 ? below : above;
        if (top < 12) top = Math.max(12, window.innerHeight - cardHeight - 12);
        var left = rect.left + (rect.width - cardWidth) / 2;
        left = Math.max(12, Math.min(left, window.innerWidth - cardWidth - 12));
        ui.card.style.left = left + 'px';
        ui.card.style.top = top + 'px';
    }

    function show(index) {
        current = Math.max(0, Math.min(index, steps.length - 1));
        var step = steps[current];
        if (step.prepare) step.prepare();
        var target = getTarget(step);
        if (target) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        ui.title.textContent = step.title;
        ui.text.textContent = step.text;
        ui.visual.innerHTML = step.visual || '';
        ui.visual.classList.toggle('hidden', !step.visual);
        ui.step.textContent = 'Step ' + (current + 1) + ' of ' + steps.length;
        ui.back.disabled = current === 0;
        ui.next.textContent = current === steps.length - 1 ? 'Finish' : 'Next';
        ui.skip.classList.toggle('hidden', current === steps.length - 1);
        window.setTimeout(function () {
            positionCard(getTarget(step));
            ui.next.focus();
        }, 80);
    }

    function start() {
        createUi();
        if (active) return;
        active = true;
        previousFocus = document.activeElement;
        ui.root.classList.remove('hidden');
        document.body.classList.add('viewer-tour-active');
        show(0);
    }

    function finish() {
        if (!active) return;
        active = false;
        ui.root.classList.add('hidden');
        document.body.classList.remove('viewer-tour-active');
        try { localStorage.setItem(STORAGE_KEY, 'complete'); } catch (e) { /* storage may be unavailable */ }
        if (previousFocus && previousFocus.focus) previousFocus.focus();
    }

    function onKeydown(event) {
        if (!active) return;
        if (event.key === 'Escape') finish();
        else if (event.key === 'ArrowRight') ui.next.click();
        else if (event.key === 'ArrowLeft' && current > 0) ui.back.click();
    }

    function init() {
        createUi();
        var help = document.getElementById('btn-start-tour');
        if (help) help.addEventListener('click', start);
        window.addEventListener('keydown', onKeydown);
        window.addEventListener('resize', function () {
            if (active) positionCard(getTarget(steps[current]));
        });
        var completed = false;
        try { completed = localStorage.getItem(STORAGE_KEY) === 'complete'; } catch (e) { /* storage may be unavailable */ }
        if (!completed) window.setTimeout(start, 900);
    }

    EV.onboarding = { init: init, start: start };
})();