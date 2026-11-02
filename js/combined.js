/* ============================================================
   BBB Design Explorer - one-page glue
   One CSV feeds every view on the page:
     Parametric Explorer (js/parametric.js, window.PEApp)
     Scatter, distribution, diminishing returns, table, gallery
     (js/app.js + js/sensitivity.js, window.designExplorer)
   ============================================================ */
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    let name = '', demo = false;

    function fillColorBy(app) {
        const sel = $('scatter-color'); if (!sel) return;
        const cols = [...app.dm.columns.outputs, ...app.dm.columns.inputs];
        const clean = c => c.replace(/^\s*(in|out)\s*:\s*/i, '');
        sel.innerHTML = cols.map(c => `<option value="${c.replace(/"/g, '&quot;')}">${clean(c).replace(/</g, '&lt;')}</option>`).join('');
        if (app.settings.colorDimension) sel.value = app.settings.colorDimension;
    }

    function wire(app) {
        // Every CSV the app reads (file picker, drop, sample, demo) also goes to the Parametric Explorer.
        const parse = app.dm.parseCSV.bind(app.dm);
        app.dm.parseCSV = function (text) {
            const r = parse(text);
            if (window.PEApp) window.PEApp.load(text, name, demo);
            $('pe-demo-badge').classList.toggle('hidden', !demo);
            $('pe-file-name').textContent = demo ? 'Synthetic numbers, not a real study' : name;
            name = ''; demo = false;
            return r;
        };
        // after app.js has set its defaults for the new file
        const loaded = app._onDataLoaded.bind(app);
        app._onDataLoaded = function () { const r = loaded(); fillColorBy(app); return r; };

        const loadFile = app._loadCSVFile.bind(app);
        app._loadCSVFile = function (file) { name = file.name; demo = false; return loadFile(file); };
        const loadImgs = app._loadImageFiles.bind(app);
        app._loadImageFiles = function (files) { if (window.PEApp) window.PEApp.addImages(files, false); return loadImgs(files); };

        const sample = $('btn-load-sample');
        if (sample) sample.addEventListener('click', () => { name = 'Sample: testdata.csv'; demo = false; }, true);
        $('btn-demo').addEventListener('click', () => { name = 'Demo data'; demo = true; app._loadCSVText(window.PECore.demoCSV()); });

        $('scatter-color').addEventListener('change', e => { app.settings.colorDimension = e.target.value; app._renderScatter(); });
        $('btn-reset').addEventListener('click', () => window.PEApp && window.PEApp.clearFilters());
        $('btn-export-pe').addEventListener('click', () => window.PEApp.exportChart());
        $('btn-export-pe-sens').addEventListener('click', () => window.PEApp.exportSens());
        // "Export All Charts" exports the Plotly charts (app.js); add the explorer's two charts after them
        $('btn-export-all-charts').addEventListener('click', () => {
            if (!window.PEApp || !window.PEApp.loaded) return;
            setTimeout(() => window.PEApp.exportChart(), 1800);
            setTimeout(() => window.PEApp.exportSens(), 2600);
        });

        // One palette for the whole page: any theme or colour change redraws the Plotly charts too
        // (debounced, so dragging a colour picker stays smooth).
        let themeTimer = 0;
        document.addEventListener('bbb-themechange', () => {
            clearTimeout(themeTimer);
            themeTimer = setTimeout(() => { if (app.dm.rowCount > 0) app._renderAll(); }, 120);
        });

        // ---- selected run from the Parametric Explorer, marked in orange on scatter and distribution ----
        let selRow = -1;
        document.addEventListener('pe-select', e => { selRow = findRow(app, e.detail); markScatter(app); markHistogram(app); });
        const rs = app._renderScatter.bind(app);
        app._renderScatter = function () { const r = rs(); markScatter(app); return r; };
        const rh = app._renderHistogram.bind(app);
        app._renderHistogram = function () { const r = rh(); markHistogram(app); return r; };

        function findRow(app, d) {
            if (!d) return -1;
            const num = v => parseFloat(String(v).replace(/[,%\s]/g, ''));
            const rows = app.dm.rawData;
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const okIn = d.inputs.every(c => c.numeric ? num(r[c.col]) === c.value : String(r[c.col]).trim() === c.text);
                if (!okIn) continue;
                const okOut = d.outputs.every(c => { const v = num(r[c.col]); return isNaN(c.value) ? isNaN(v) : Math.abs(v - c.value) <= 1e-9 * Math.max(1, Math.abs(c.value)); });
                if (okOut) return i;
            }
            return -1;
        }
        function markScatter(app) {
            const gd = $('scatter-chart'); if (!gd || !gd.data || !window.Plotly) return;
            const old = gd.data.findIndex(t => t.name === '__selected__'); if (old >= 0) Plotly.deleteTraces(gd, old);
            if (selRow < 0) return;
            const r = app.dm.rawData[selRow], P = window.BBBTheme.palette();
            const x = app.dm.getNumericValue(r, app.settings.scatterX), y = app.dm.getNumericValue(r, app.settings.scatterY);
            if (isNaN(x) || isNaN(y)) return;
            Plotly.addTraces(gd, { name: '__selected__', type: 'scatter', mode: 'markers', showlegend: false, hoverinfo: 'skip', x: [x], y: [y],
                marker: { size: 15, color: P.sel, line: { width: 2, color: P.bg } } });
            Plotly.relayout(gd, { showlegend: false });   // a second trace would otherwise switch Plotly's legend on
        }
        function markHistogram(app) {
            const gd = $('histogram-chart'); if (!gd || !gd.data || !window.Plotly) return;
            const col = app.settings.histogramVar, P = window.BBBTheme.palette();
            let shapes = [], annotations = [];
            if (selRow >= 0 && col) {
                const raw = app.dm.rawData[selRow][col];
                const x = app.dm.isCategorical(col) ? String(raw) : app.dm.getNumericValue(app.dm.rawData[selRow], col);
                if (x !== '' && !(typeof x === 'number' && isNaN(x))) {
                    shapes = [{ type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color: P.sel, width: 2.5 } }];
                    annotations = [{ xref: 'x', yref: 'paper', x, y: 1, yanchor: 'bottom', text: 'Selected run', showarrow: false, font: { size: 11, color: P.sel } }];
                }
            }
            Plotly.relayout(gd, { shapes, annotations });
        }
    }

    function boot() {
        let tries = 0;
        (function wait() {
            if (window.designExplorer && window.designExplorer.dm) wire(window.designExplorer);
            else if (tries++ < 60) setTimeout(wait, 50);
        })();
    }
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot); else boot();
})();
