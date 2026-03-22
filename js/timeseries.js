/**
 * EOSIAL Viewer — timeseries chart module
 *
 * Draws Chart.js timeseries in the #ts-modal.
 * Supports single-value series and multi-metric series (mean/median/IQR).
 */
(function () {
    var chart = null;

    /** Show the timeseries modal and render a chart.
     *  @param {string} title     - modal title
     *  @param {Array}  series    - array of { date, value } OR { date, mean, median, q25, q75 }
     *  @param {object} opts      - { unit, color, label, info, timeUnit, datasets }
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

        if (chart) { chart.destroy(); chart = null; }

        var labels = series.map(function (d) { return d.date; });
        var datasets;
        var showLegend = false;

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
                plugins: {
                    legend: {
                        display: showLegend,
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            padding: 12,
                            font: { size: 11 },
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
                        callbacks: {
                            label: function (ctx) {
                                var suffix = opts.unit ? ' ' + opts.unit : '';
                                return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1) + suffix;
                            }
                        },
                        filter: function (item) {
                            // Hide Q25 from tooltip
                            return item.dataset.label !== 'Q25';
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            tooltipFormat: opts.timeUnit === 'hour' ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd',
                            unit: opts.timeUnit || 'day',
                        },
                        title: { display: true, text: 'Date' }
                    },
                    y: {
                        title: { display: true, text: opts.label || 'Value' },
                        beginAtZero: false,
                    }
                }
            }
        });
    }

    /** Close modal */
    function closeModal() {
        document.getElementById('ts-modal').classList.add('hidden');
        if (chart) { chart.destroy(); chart = null; }
    }

    // Wire close button
    document.addEventListener('DOMContentLoaded', function () {
        document.getElementById('ts-modal-close').addEventListener('click', closeModal);
        document.getElementById('ts-modal').addEventListener('click', function (e) {
            if (e.target === this) closeModal();
        });
        document.getElementById('ts-save-png').addEventListener('click', function () {
            if (!chart) return;
            var a = document.createElement('a');
            a.href = chart.toBase64Image();
            a.download = 'timeseries.png';
            a.click();
        });
    });

    // Public API
    EV.showTimeseries = showTimeseries;
    EV.closeTimeseries = closeModal;
})();
