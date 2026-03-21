/**
 * EOSIAL Viewer — timeseries chart module
 *
 * Draws Chart.js timeseries in the #ts-modal.
 * Works for both point queries (single pixel) and polygon queries (zonal mean).
 */
(function () {
    var chart = null;

    /** Show the timeseries modal and render a chart.
     *  @param {string} title     - modal title
     *  @param {Array}  series    - array of { date: Date, value: number }
     *  @param {object} opts      - { unit, color, label, info }
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
        var values = series.map(function (d) { return d.value; });

        chart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: opts.label || 'Value',
                    data: values,
                    borderColor: opts.color || '#2563eb',
                    backgroundColor: (opts.color || '#2563eb') + '33',
                    fill: true,
                    tension: 0.25,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                return ctx.parsed.y.toFixed(1) + (opts.unit ? ' ' + opts.unit : '');
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'day', tooltipFormat: 'yyyy-MM-dd' },
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
