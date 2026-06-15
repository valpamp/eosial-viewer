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
        var xTickLimit = opts.maxXTicks || (isHourly ? 5 : 6);

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
                    backgroundColor: colorWithAlpha('#2563eb', 0.18),
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
                    backgroundColor: colorWithAlpha('#059669', 0.18),
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
                backgroundColor: colorWithAlpha(opts.color || '#2563eb', 0.14),
                fill: true,
                tension: 0.25,
                pointRadius: 4,
                pointHoverRadius: 6,
            }];
        }

        datasets = datasets.map(function (dataset) {
            return Object.assign({
                borderWidth: 2.5,
                borderCapStyle: 'round',
                borderJoinStyle: 'round',
                pointStyle: 'circle',
                pointRadius: isHourly ? 3.5 : 3,
                pointHoverRadius: 6,
                pointHitRadius: 10,
                pointBorderWidth: 2,
                pointBackgroundColor: '#ffffff',
                spanGaps: false
            }, dataset);
        });

        chart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            plugins: [chartCanvasBackgroundPlugin(), chartAreaBackgroundPlugin()],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 220 },
                interaction: { mode: 'index', intersect: false },
                layout: {
                    padding: { top: 18, right: 28, bottom: 24, left: 14 }
                },
                elements: {
                    line: { tension: 0.22 },
                    point: { hoverBorderWidth: 2.5 }
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
                            padding: 18,
                            color: '#334155',
                            font: { size: 13, weight: '650' },
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
                        backgroundColor: 'rgba(15,23,42,0.95)',
                        padding: 14,
                        cornerRadius: 9,
                        titleFont: { size: 14, weight: '700' },
                        bodyFont: { size: 14 },
                        displayColors: true,
                        boxPadding: 4,
                        callbacks: {
                            title: function (items) {
                                if (!items.length) return '';
                                var d = new Date(items[0].parsed.x);
                                return formatChartDate(d, isHourly);
                            },
                            label: function (ctx) {
                                if (ctx.parsed.y == null) return '';
                                var suffix = opts.unit ? ' ' + opts.unit : '';
                                return ctx.dataset.label + ': ' + formatNumber(ctx.parsed.y) + suffix;
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
                        afterFit: function (scale) {
                            scale.height = Math.max(scale.height, isHourly ? 82 : 66);
                        },
                        time: {
                            tooltipFormat: opts.timeUnit === 'hour' ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy',
                            unit: opts.timeUnit || 'day',
                            displayFormats: {
                                minute: 'HH:mm',
                                hour: 'HH:mm',
                                day: 'dd/MM/yyyy',
                                week: 'dd/MM/yyyy',
                                month: 'MM/yyyy'
                            }
                        },
                        ticks: {
                            maxRotation: 0,
                            minRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: xTickLimit,
                            color: '#334155',
                            font: { size: 13, weight: '700' },
                            padding: 10,
                            callback: function (value) {
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
                            color: 'rgba(100,116,139,0.38)',
                            lineWidth: 1.05,
                            drawTicks: true,
                            tickLength: 5,
                            tickColor: 'rgba(100,116,139,0.55)'
                        },
                        border: { color: '#cbd5e1', width: 1 },
                        title: {
                            display: true,
                            text: opts.xLabel || (opts.timeUnit === 'hour' ? 'Date / Time (UTC)' : 'Date'),
                            color: '#1f2937',
                            font: { size: 15, weight: '800' },
                            padding: { top: 12 }
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: opts.yLabel || opts.label || 'Value',
                            color: '#1f2937',
                            font: { size: 15, weight: '800' },
                            padding: { bottom: 12 }
                        },
                        beginAtZero: opts.beginAtZero === undefined ? false : opts.beginAtZero,
                        grace: opts.yGrace || '8%',
                        ticks: {
                            color: '#334155',
                            font: { size: 13, weight: '700' },
                            padding: 12,
                            callback: function (value) {
                                return formatNumber(value);
                            }
                        },
                        grid: {
                            color: 'rgba(100,116,139,0.44)',
                            lineWidth: 1.2,
                            drawTicks: true,
                            tickLength: 5,
                            tickColor: 'rgba(100,116,139,0.6)'
                        },
                        border: { color: '#cbd5e1', width: 1 },
                    }
                }
            }
        });
    }

    function colorWithAlpha(color, alpha) {
        if (!color) return 'rgba(37,99,235,' + alpha + ')';
        if (color.indexOf('#') === 0 && (color.length === 7 || color.length === 4)) {
            var hex = color.length === 4
                ? color.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3')
                : color;
            var r = parseInt(hex.slice(1, 3), 16);
            var g = parseInt(hex.slice(3, 5), 16);
            var b = parseInt(hex.slice(5, 7), 16);
            return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
        }
        if (color.indexOf('rgb(') === 0) {
            return color.replace('rgb(', 'rgba(').replace(')', ',' + alpha + ')');
        }
        if (color.indexOf('rgba(') === 0) {
            return color.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgba($1,$2,$3,' + alpha + ')');
        }
        return color;
    }

    function chartCanvasBackgroundPlugin() {
        return {
            id: 'tsCanvasBackground',
            beforeDraw: function (c) {
                var ctx = c.ctx;
                ctx.save();
                ctx.globalCompositeOperation = 'destination-over';
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, c.width, c.height);
                ctx.restore();
            }
        };
    }

    function chartAreaBackgroundPlugin() {
        return {
            id: 'tsChartAreaBackground',
            beforeDraw: function (c) {
                if (!c.chartArea) return;
                var ctx = c.ctx;
                var area = c.chartArea;
                ctx.save();
                var gradient = ctx.createLinearGradient(0, area.top, 0, area.bottom);
                gradient.addColorStop(0, '#f8fafc');
                gradient.addColorStop(0.52, '#ffffff');
                gradient.addColorStop(1, '#ffffff');
                ctx.fillStyle = gradient;
                ctx.fillRect(area.left, area.top, area.right - area.left, area.bottom - area.top);
                ctx.restore();
            }
        };
    }

    function chartImageWithWhiteBackground() {
        if (!chart) return '';
        var source = chart.canvas;
        var out = document.createElement('canvas');
        out.width = source.width;
        out.height = source.height;
        var ctx = out.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(source, 0, 0);
        return out.toDataURL('image/png');
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

    function formatNumber(value) {
        var n = Number(value);
        if (!isFinite(n)) return '';
        if (Math.abs(n) >= 100) return Math.round(n).toString();
        if (Math.abs(n) >= 10) return (Math.round(n * 10) / 10).toString();
        return (Math.round(n * 100) / 100).toString();
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
        renderTable(true);
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
                renderTable(true);
            });
        });
    }

    function renderTable(resetScroll) {
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
        if (resetScroll) resetTableScroll();
    }

    function resetTableScroll() {
        var wrap = document.querySelector('.ts-table-wrap');
        if (!wrap) return;
        wrap.scrollTop = 0;
        wrap.scrollLeft = 0;
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

        var keyed = visible.map(function (ds) {
            var values = {};
            (ds.data || []).forEach(function (entry, idx) {
                var key = chartDataDateKey(entry, chart.data.labels[idx]);
                if (!key) return;
                values[key] = chartDataValue(entry);
            });
            return values;
        });
        var keys = {};
        keyed.forEach(function (values) {
            Object.keys(values).forEach(function (key) { keys[key] = true; });
        });

        Object.keys(keys).sort().forEach(function (key) {
            var row = ['"' + key.replace('T', ' ') + '"'];
            for (var k = 0; k < keyed.length; k++) {
                var v = keyed[k][key];
                row.push(v != null ? String(Math.round(v * 100) / 100) : '');
            }
            rows.push(row.join(','));
        });
        triggerCSV(rows.join('\r\n'), 'timeseries.csv');
    }

    function chartDataDateKey(entry, fallbackLabel) {
        var raw = entry && typeof entry === 'object' && entry.x !== undefined ? entry.x : fallbackLabel;
        if (raw == null) return '';
        var d = raw instanceof Date ? raw : new Date(raw);
        if (d instanceof Date && !isNaN(d)) return d.toISOString().substring(0, 16);
        return String(raw);
    }

    function chartDataValue(entry) {
        if (entry && typeof entry === 'object' && entry.y !== undefined) return entry.y;
        return entry;
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
            renderTable(true);
        });
        document.getElementById('ts-table-next').addEventListener('click', function () {
            tablePage += 1;
            renderTable(true);
        });
        document.getElementById('ts-save-png').addEventListener('click', function () {
            if (!chart) return;
            var a = document.createElement('a');
            a.href = chartImageWithWhiteBackground();
            a.download = 'timeseries.png';
            a.click();
        });
        document.getElementById('ts-save-csv').addEventListener('click', downloadCSV);
    });

    // Public API
    EV.showTimeseries = showTimeseries;
    EV.closeTimeseries = closeModal;
})();
