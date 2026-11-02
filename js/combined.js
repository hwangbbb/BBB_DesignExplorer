/* ============================================================
   BBB Design Explorer - combined page glue
   One CSV feeds both tabs:
     Parametric Explorer (js/parametric.js, window.PEApp)
     Overview            (js/app.js + js/sensitivity.js, window.designExplorer)
   ============================================================ */
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    let name = '', demo = false;

    function wire(app) {
        // Every CSV the Overview reads (file picker, drop, sample) also goes to the Parametric Explorer.
        const parse = app.dm.parseCSV.bind(app.dm);
        app.dm.parseCSV = function (text) {
            const r = parse(text);
            if (window.PEApp) window.PEApp.load(text, name, demo);
            $('pe-demo-badge').classList.toggle('hidden', !demo);
            $('pe-file-name').textContent = demo ? 'Synthetic numbers, not a real study' : name;
            $('app-tabs').classList.remove('hidden');
            showTab(currentTab());
            name = ''; demo = false;
            return r;
        };
        const loadFile = app._loadCSVFile.bind(app);
        app._loadCSVFile = function (file) { name = file.name; demo = false; return loadFile(file); };
        const loadImgs = app._loadImageFiles.bind(app);
        app._loadImageFiles = function (files) { if (window.PEApp) window.PEApp.addImages(files, false); return loadImgs(files); };

        const sample = $('btn-load-sample');
        if (sample) sample.addEventListener('click', () => { name = 'Sample: testdata.csv'; demo = false; }, true);
        $('btn-demo').addEventListener('click', () => { name = 'Demo data'; demo = true; app._loadCSVText(window.PECore.demoCSV()); });

        $('btn-reset').addEventListener('click', () => window.PEApp && window.PEApp.clearFilters());
        $('btn-export-pe').addEventListener('click', () => { showTab('parametric'); window.PEApp.exportChart(); });
        $('btn-export-pe-sens').addEventListener('click', () => { showTab('parametric'); window.PEApp.exportSens(); });

        // Plotly charts read dark/light from the body class: redraw them when the theme flips.
        let lastTheme = window.BBBTheme ? window.BBBTheme.theme : '';
        document.addEventListener('bbb-themechange', () => {
            const t = window.BBBTheme.theme;
            if (t !== lastTheme && app.dm.rowCount > 0) app._renderAll();
            lastTheme = t;
        });
    }

    // ---- tabs ----
    function currentTab() {
        let t = null; try { t = localStorage.getItem('bbb-tab'); } catch (e) { /* ignore */ }
        if (location.hash === '#overview' || location.hash === '#parametric') t = location.hash.slice(1);
        return t === 'overview' ? 'overview' : 'parametric';
    }
    function showTab(tab) {
        document.querySelectorAll('.app-tab').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
        $('tab-parametric').classList.toggle('hidden', tab !== 'parametric');
        $('tab-overview').classList.toggle('hidden', tab !== 'overview');
        try { localStorage.setItem('bbb-tab', tab); } catch (e) { /* ignore */ }
        requestAnimationFrame(() => {
            if (tab === 'overview' && window.Plotly) document.querySelectorAll('#tab-overview .js-plotly-plot').forEach(el => { try { window.Plotly.Plots.resize(el); } catch (e) { /* ignore */ } });
            if (tab === 'parametric' && window.PEApp) window.PEApp.refresh();
            // sensitivity.js sizes its charts from their container: let it re-measure
            window.dispatchEvent(new Event('resize'));
        });
    }
    document.querySelectorAll('.app-tab').forEach(b => b.addEventListener('click', () => { history.replaceState(null, '', '#' + b.dataset.tab); showTab(b.dataset.tab); }));

    function boot() {
        let tries = 0;
        (function wait() {
            if (window.designExplorer && window.designExplorer.dm) wire(window.designExplorer);
            else if (tries++ < 60) setTimeout(wait, 50);
        })();
    }
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot); else boot();
})();
