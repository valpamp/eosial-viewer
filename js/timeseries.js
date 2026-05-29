/**
 * EOSIAL Viewer — timeseries chart module
 *
 * Draws Chart.js timeseries in the #ts-modal.
 * Supports single-value series and multi-metric series (mean/median/IQR).
 */
(function () {
    var chart = null;
    var tableRows = [];
    var tableColumns = [];
    var selectedTableColumns = [];
    var tablePage = 0;
    var tablePageSize = 50;
    var tableFilename = 'hotspot_table.csv';
    var activeView = 'chart';

    /** Show the timeseries modal and render a chart.
     *  @param {string} title     - modal title
     *  @param {Array}  series    - array of { date, value } OR { date, mean, median, q25, q75 }
     *  @param {object} opts      - { unit, color, label, yLabel, xLabel, info, timeUnit, datasets }
     *
     *  If opts.datasets is provided, it's used directly (array of Chart.js dataset objects).
     *  If series items have .mean/.median/.q25/.q75, multi-metric chart is rendered.
     *  Otherwise falls back to single-value chart.
     */
    function showTimeseries(title, series, opts) {
        opts = opts || {};
        var modal  = document.getElementById('ts-modal');
        var canvas = document.getElementById('ts-chart');
        var info   = document.getElementById('ts-info');

        document.getElementById('ts-modal-title').textContent = title;
        info.innerHTML = opts.info || '';
        modal.classList.remove('hidden');
        setupTable(opts);
        setViewMode('chart');

        if (chart) { chart.destroy(); chart = null; }

        var labels = series.map(function (d) { return d.date; });
        var datasets;
        var showLegend = false;
        var isHourly = opts.timeUnit === 'hour' || opts.timeUnit === 'minute';
        var xTickLimit = opts.maxXTicks || (isHourly ? 6 : 8);

        if (opts.datasets) {
            // Custom datasets passed directly
            datasets = opts.datasets;
            showLegend = datasets.length > 1;
        } else if (series.length > 0 && series[0].mean !== undefined) {
            // Multi-metric polygon series (mean, median, IQR)
            showLegend = true;
            datasets = [
                {
                    label: 'Mean',
                    data: series.map(function (d) { return d.mean; }),
                    borderColor: '#2563eb',
                    backgroundColor: '#2563eb33',
                    fill: false,
                    tension: 0.25,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    borderWidth: 2,
                },
                {
                    label: 'Median',
                    data: series.map(function (d) { return d.median; }),
                    borderColor: '#059669',
                    backgroundColor: '#05966933',
                    fill: false,
                    tension: 0.25,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                    borderDash: [5, 3],
                },
                {
                    label: 'IQR (Q25–Q75)',
                    data: series.map(function (d) { return d.q75; }),
                    borderColor: 'rgba(99,102,241,0.3)',
                    backgroundColor: 'rgba(99,102,241,0.12)',
                    fill: '+1',
                    tension: 0.25,
                    pointRadius: 0,
                    borderWidth: 1,
                },
                {
                    label: 'Q25',
                    data: series.map(function (d) { return d.q25; }),
                    borderColor: 'rgba(99,102,241,0.3)',
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.25,
                    pointRadius: 0,
                    borderWidth: 1,
                    hidden: false,
                }
            ];
        } else {
            // Single-value series
            datasets = [{
                label: opts.label || 'Value',
                data: series.map(function (d) { return d.value; }),
                borderColor: opts.color || '#2563eb',
                backgroundColor: (opts.color || '#2563eb') + '33',
                fill: true,
                tension: 0.25,
                pointRadius: 4,
                pointHoverRadius: 6,
            }];
        }

        chart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                layout: {
                    padding: { top: 8, right: 14, bottom: 4, left: 4 }
                },
                plugins: {
                    legend: {
                        display: showLegend,
                        position: 'top',
                        align: 'center',
                        labels: {
                            usePointStyle: true,
                            boxWidth: 9,
                            boxHeight: 9,
                            padding: 16,
                            color: '#374151',
                            font: { size: 11, weight: '500' },
                            filter: function (item) {
                                // Hide Q25 from legend — IQR label covers the band
                                return item.text !== 'Q25';
                            }
                        },
                        onClick: function (e, legendItem, legend) {
                            var idx = legendItem.datasetIndex;
                            var meta = chart.getDatasetMeta(idx);
                            meta.hidden = !meta.hidden;
                            // Toggle IQR band: link "IQR (Q25–Q75)" with the Q25 dataset
                            if (legendItem.text === 'IQR (Q25–Q75)') {
                                var q25Meta = chart.getDatasetMeta(idx + 1);
                                q25Meta.hidden = meta.hidden;
                            }
                            chart.update();
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(17,24,39,0.92)',
                        padding: 10,
                        cornerRadius: 6,
                        titleFont: { size: 12, weight: '600' },
                        bodyFont: { size: 12 },
                        displayColors: true,
                        callbacks: {
                            title: function (items) {
                                if (!items.length) return '';
                                var d = new Date(items[0].parsed.x);
                                return formatChartDate(d, opts.timeUnit === 'hour');
                            },
                            label: function (ctx) {
                                if (ctx.parsed.y == null) return '';
                                var suffix = opts.unit ? ' ' + opts.unit : '';
                                return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1) + suffix;
                            }
                        },
                        filter: function (item) {
                            // Hide Q25 from tooltip
                            return item.dataset.label !== 'Q25' && item.parsed.y != null;
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            tooltipFormat: opts.timeUnit === 'hour' ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy',
                            unit: opts.timeUnit || 'day',
                            displayFormats: {
                                minute: 'dd/MM HH:mm',
                                hour: 'dd/MM HH:mm',
                                day: 'dd/MM/yyyy',
                                week: 'dd/MM/yyyy',
                                month: 'MM/yyyy'
                            }
                        },
                        ticks: {
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: xTickLimit,
                            color: '#4b5563',
                            font: { size: 11 },
                            padding: 8,
                            callback: function (value) {
                                if (!opts.compactTimeTicks) return this.getLabelForValue(value);
                                var d = new Date(value);
                                if (!(d instanceof Date) || isNaN(d)) return this.getLabelForValue(value);
                                if (isHourly) {
                                    return [
                                        pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1),
                                        pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes())
                                    ];
                                }
                                return pad2(d.getUTCDate()) + '/' +
                                       pad2(d.getUTCMonth() + 1) + '/' +
                                       d.getUTCFullYear();
                            }
                        },
                        grid: {
                            color: 'rgba(148,163,184,0.22)',
                            drawTicks: false
                        },
                        border: { color: '#d1d5db' },
                        title: {
                            display: true,
                            text: opts.xLabel || (opts.timeUnit === 'hour' ? 'Date / Time (UTC)' : 'Date'),
                            color: '#4b5563',
                            font: { size: 12, weight: '500' },
                            padding: { top: 8 }
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: opts.yLabel || opts.label || 'Value',
                            color: '#374151',
                            font: { size: 12, weight: '500' },
                            padding: { bottom: 6 }
                        },
                        beginAtZero: opts.beginAtZero === undefined ? false : opts.beginAtZero,
                        ticks: {
                            color: '#4b5563',
                            font: { size: 11 },
                            padding: 8
                        },
                        grid: {
                            color: 'rgba(148,163,184,0.26)',
                            drawTicks: false
                        },
                        border: { color: '#d1d5db' },
                    }
                }
            }
        });
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function formatChartDate(date, includeTime) {
        if (!(date instanceof Date) || isNaN(date)) return '';
        var text = pad2(date.getUTCDate()) + '/' +
                   pad2(date.getUTCMonth() + 1) + '/' +
                   date.getUTCFullYear();
        if (includeTime) {
            text += ' ' + pad2(date.getUTCHours()) + ':' + pad2(date.getUTCMinutes()) + ' UTC';
        }
        return text;
    }

    function setupTable(opts) {
        tableRows = opts.tableRows || [];
        tableColumns = opts.tableColumns || inferColumns(tableRows);
        selectedTableColumns = tableColumns.filter(function (col) {
            return col.defaultVisible !== false;
        }).map(function (col) { return col.key; });
        if (!selectedTableColumns.length && tableColumns.length) {
            selectedTableColumns = tableColumns.slice(0, Math.min(4, tableColumns.length)).map(function (col) {
                return col.key;
            });
        }
        tableFilename = opts.tableFilename || 'hotspot_table.csv';
        tablePage = 0;

        var tabs = document.getElementById('ts-view-tabs');
        if (tabs) tabs.classList.toggle('hidden', !tableRows.length);
        renderFieldControls();
        renderTable();
    }

    function inferColumns(rows) {
        if (!rows.length) return [];
        return Object.keys(rows[0]).map(function (key) {
            return { key: key, label: key };
        });
    }

    function setViewMode(mode) {
        activeView = mode === 'table' && tableRows.length ? 'table' : 'chart';
        var chartPanel = document.getElementById('ts-chart-panel');
        var tablePanel = document.getElementById('ts-table-panel');
        var chartTab = document.getElementById('ts-chart-tab');
        var tableTab = document.getElementById('ts-table-tab');
        var pngBtn = document.getElementById('ts-save-png');
        var csvBtn = document.getElementById('ts-save-csv');

        if (chartPanel) chartPanel.classList.toggle('hidden', activeView !== 'chart');
        if (tablePanel) tablePanel.classList.toggle('hidden', activeView !== 'table');
        if (chartTab) chartTab.classList.toggle('active', activeView === 'chart');
        if (tableTab) tableTab.classList.toggle('active', activeView === 'table');
        if (pngBtn) pngBtn.classList.toggle('hidden', activeView !== 'chart');
        if (csvBtn) csvBtn.textContent = activeView === 'table' ? 'Download Table CSV' : 'Download CSV';
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function cellValue(row, col) {
        var value = row[col.key];
        return col.formatter ? col.formatter(value, row) : value;
    }

    function getVisibleTableColumns() {
        var selected = {};
        selectedTableColumns.forEach(function (key) { selected[key] = true; });
        var visible = tableColumns.filter(function (col) { return selected[col.key]; });
        if (!visible.length && tableColumns.length) {
            visible = [tableColumns[0]];
            selectedTableColumns = [tableColumns[0].key];
        }
        return visible;
    }

    function renderFieldControls() {
        var wrap = document.getElementById('ts-field-controls');
        if (!wrap) return;
        if (!tableRows.length || !tableColumns.length) {
            wrap.innerHTML = '';
            wrap.classList.add('hidden');
            return;
        }
        wrap.classList.remove('hidden');
        var selected = {};
        selectedTableColumns.forEach(function (key) { selected[key] = true; });
        wrap.innerHTML = tableColumns.map(function (col) {
            return '<label class="ts-field-pill">' +
                   '<input type="checkbox" class="ts-field-toggle" value="' + escapeHtml(col.key) + '"' +
                   (selected[col.key] ? ' checked' : '') + '>' +
                   '<span>' + escapeHtml(col.label || col.key) + '</span>' +
                   '</label>';
        }).join('');
        wrap.querySelectorAll('.ts-field-toggle').forEach(function (cb) {
            cb.addEventListener('change', function () {
                selectedTableColumns = [];
                wrap.querySelectorAll('.ts-field-toggle:checked').forEach(function (checked) {
                    selectedTableColumns.push(checked.value);
                });
                if (!selectedTableColumns.length) {
                    cb.checked = true;
                    selectedTableColumns.push(cb.value);
                }
                renderTable();
            });
        });
    }

    function renderTable() {
        var table = document.getElementById('ts-table');
        var summary = document.getElementById('ts-table-summary');
        var status = document.getElementById('ts-table-page-status');
        var prev = document.getElementById('ts-table-prev');
        var next = document.getElementById('ts-table-next');
        if (!table) return;

        var visibleColumns = getVisibleTableColumns();
        if (!tableRows.length || !visibleColumns.length) {
            table.innerHTML = '';
            if (summary) summary.textContent = '';
            if (status) status.textContent = '';
            return;
        }

        var totalPages = Math.max(1, Math.ceil(tableRows.length / tablePageSize));
        tablePage = Math.min(Math.max(tablePage, 0), totalPages - 1);
        var start = tablePage * tablePageSize;
        var end = Math.min(start + tablePageSize, tableRows.length);
        var rows = tableRows.slice(start, end);

        var html = '<thead><tr>' + visibleColumns.map(function (col) {
            return '<th>' + escapeHtml(col.label || col.key) + '</th>';
        }).join('') + '</tr></thead><tbody>';
        rows.forEach(function (row) {
            html += '<tr>' + visibleColumns.map(function (col) {
                return '<td>' + escapeHtml(cellValue(row, col)) + '</td>';
            }).join('') + '</tr>';
        });
        html += '</tbody>';
        table.innerHTML = html;

        if (summary) summary.textContent = 'Selected hotspot detections. Choose fields below; 50 rows are shown per page.';
        if (status) status.textContent = (start + 1) + '-' + end + ' of ' + tableRows.length;
        if (prev) prev.disabled = tablePage <= 0;
        if (next) next.disabled = tablePage >= totalPages - 1;
    }

    /** Close modal */
    function closeModal() {
        document.getElementById('ts-modal').classList.add('hidden');
        if (chart) { chart.destroy(); chart = null; }
    }

    function csvEscape(value) {
        value = value == null ? '' : String(value);
        if (/[",\r\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
        return value;
    }

    function downloadTableCSV() {
        if (!tableRows.length || !tableColumns.length) return;
        var visibleColumns = getVisibleTableColumns();
        var rows = [visibleColumns.map(function (col) {
            return csvEscape(col.label || col.key);
        }).join(',')];
        tableRows.forEach(function (row) {
            rows.push(visibleColumns.map(function (col) {
                return csvEscape(cellValue(row, col));
            }).join(','));
        });
        triggerCSV(rows.join('\r\n'), tableFilename);
    }

    function triggerCSV(csv, filename) {
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href     = url;
        a.download = filename || 'timeseries.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    function downloadChartCSV() {
        if (!chart) return;
        var datasets = chart.data.datasets;
        var labels   = chart.data.labels;
        // Collect visible datasets; skip the internal Q25 fill-target series
        var visible = [];
        for (var i = 0; i < datasets.length; i++) {
            if (datasets[i].label !== 'Q25' && !chart.getDatasetMeta(i).hidden) {
                visible.push({ label: datasets[i].label, data: datasets[i].data });
            }
        }
        if (!visible.length) return;
        var header = ['Date'].concat(visible.map(function (ds) { return ds.label; }));
        var rows = [header.join(',')];
        for (var j = 0; j < labels.length; j++) {
            var d = labels[j];
            var dateStr = (d instanceof Date)
                ? d.toISOString().substring(0, 16).replace('T', ' ')
                : String(d);
            var row = ['"' + dateStr + '"'];
            for (var k = 0; k < visible.length; k++) {
                var v = visible[k].data[j];
                row.push(v != null ? String(Math.round(v * 100) / 100) : '');
            }
            rows.push(row.join(','));
        }
        triggerCSV(rows.join('\r\n'), 'timeseries.csv');
    }

    function downloadCSV() {
        if (activeView === 'table' && tableRows.length) {
            downloadTableCSV();
        } else {
            downloadChartCSV();
        }
    }

    // Wire close button
    document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('ts-modal-close').addEventListener('click', closeModal);
        document.getElementById('ts-modal').addEventListener('click', function (e) {
            if (e.target === this) closeModal();
        });
        document.getElementById('ts-chart-tab').addEventListener('click', function () {
            setViewMode('chart');
        });
        document.getElementById('ts-table-tab').addEventListener('click', function () {
            setViewMode('table');
        });
        document.getElementById('ts-table-prev').addEventListener('click', function () {
            tablePage -= 1;
            renderTable();
        });
        document.getElementById('ts-table-next').addEventListener('click', function () {
            tablePage += 1;
            renderTable();
        });
        document.getElementById('ts-save-png').addEventListener('click', function () {
            if (!chart) return;
            var a = document.createElement('a');
            a.href = chart.toBase64Image();
            a.download = 'timeseries.png';
            a.click();
        });
        document.getElementById('ts-save-csv').addEventListener('click', downloadCSV);
    });

    // Public API
    EV.showTimeseries = showTimeseries;
    EV.closeTimeseries = closeModal;
})();
