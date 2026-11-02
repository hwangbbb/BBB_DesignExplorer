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

        // Plotly charts read dark/light from the body class: redraw them when the theme flips.
        let lastTheme = window.BBBTheme ? window.BBBTheme.theme : '';
        document.addEventListener('bbb-themechange', () => {
            const t = window.BBBTheme.theme;
            if (t !== lastTheme && app.dm.rowCount > 0) app._renderAll();
            lastTheme = t;
        });
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
