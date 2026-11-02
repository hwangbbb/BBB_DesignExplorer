/* ============================================================
   BBB Design Explorer - Parametric Explorer
   Parallel coordinates + level sliders + selected run panel +
   global / local sensitivity for Colibri data.csv files.
   No external libraries: works from file:// and offline.
   ============================================================ */
(function (root) {
    'use strict';

    // ================================================================
    //  CORE (pure functions, no DOM; exported for tests)
    // ================================================================

    /* RFC-4180-ish CSV parser: quotes, escaped quotes, CRLF, BOM. */
    function parseCSV(text) {
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        const rows = [];
        let row = [], field = '', i = 0, q = false;
        const n = text.length;
        while (i < n) {
            const c = text[i];
            if (q) {
                if (c === '"') {
                    if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                    q = false; i++; continue;
                }
                field += c; i++; continue;
            }
            if (c === '"') { q = true; i++; continue; }
            if (c === ',') { row.push(field); field = ''; i++; continue; }
            if (c === '\r') { i++; continue; }
            if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
            field += c; i++;
        }
        if (field !== '' || row.length) { row.push(field); rows.push(row); }
        return rows.filter(r => r.some(v => String(v).trim() !== ''));
    }

    const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*%?$/i;
    function toNumber(s) {
        if (s == null) return NaN;
        const t = String(s).trim().replace(/,/g, '');
        if (t === '' || !NUM_RE.test(t)) return NaN;
        return parseFloat(t.replace('%', ''));
    }

    /* "out:EUI (kBtu/sf·yr)" -> { label: "EUI (kBtu/sf·yr)", name: "EUI", unit: "kBtu/sf·yr" } */
    function parseHeader(h) {
        const label = h.replace(/^\s*(in|out)\s*:\s*/i, '').trim();
        const m = label.match(/^(.*?)\s*[\(\[]([^\)\]]*)[\)\]]\s*$/);
        return { label, name: m ? (m[1] || label) : label, unit: m ? m[2].trim() : '' };
    }

    /* Build the dataset model from CSV text. */
    function buildDataset(text) {
        const rows = parseCSV(text);
        if (rows.length < 2) throw new Error('The CSV has no data rows.');
        const header = rows[0].map(h => String(h).trim());
        const inCols = [], outCols = [];
        let imgCol = -1;
        header.forEach((h, j) => {
            const l = h.toLowerCase();
            if (l.startsWith('in:')) inCols.push(j);
            else if (l.startsWith('out:')) outCols.push(j);
            else if (imgCol < 0 && /^(img|image)(\s*:|$)/.test(l)) imgCol = j;
        });
        if (!inCols.length) throw new Error('No "in:" columns found. Is this a Colibri data.csv?');
        if (!outCols.length) throw new Error('No "out:" columns found. Is this a Colibri data.csv?');

        const body = rows.slice(1);
        // Rows missing any input value cannot be placed on the grid.
        const kept = body.filter(r => inCols.every(j => r[j] != null && String(r[j]).trim() !== ''));
        const droppedRows = body.length - kept.length;
        const N = kept.length;
        if (!N) throw new Error('No rows with complete input values.');

        const inputs = inCols.map(j => {
            const h = parseHeader(header[j]);
            const raw = kept.map(r => String(r[j]).trim());
            const numeric = raw.every(v => !isNaN(toNumber(v)));
            let levels; // [{ key, value, text }]
            if (numeric) {
                const seen = new Map();
                raw.forEach(v => { const x = toNumber(v); if (!seen.has(x)) seen.set(x, v); });
                levels = [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([x, t]) => ({ key: x, value: x, text: t }));
            } else {
                const seen = [];
                raw.forEach(v => { if (!seen.includes(v)) seen.push(v); });
                levels = seen.map(t => ({ key: t, value: NaN, text: t }));
            }
            const idx = new Map(levels.map((l, i) => [l.key, i]));
            const codes = new Int32Array(N);
            raw.forEach((v, r) => { codes[r] = idx.get(numeric ? toNumber(v) : v); });
            return { col: header[j], label: h.label, name: h.name, unit: h.unit, numeric, levels, codes };
        });

        const outputs = outCols.map(j => {
            const h = parseHeader(header[j]);
            const values = new Float64Array(N);
            kept.forEach((r, i) => { values[i] = toNumber(r[j]); });
            let min = Infinity, max = -Infinity, count = 0;
            for (let i = 0; i < N; i++) { const v = values[i]; if (isFinite(v)) { count++; if (v < min) min = v; if (v > max) max = v; } }
            if (!count) { min = 0; max = 1; }
            return { col: header[j], label: h.label, name: h.name, unit: h.unit, values, min, max, count };
        });

        const imgs = imgCol >= 0 ? kept.map(r => String(r[imgCol] || '').trim()) : null;

        // combination lookup: key -> first run index
        const lookup = new Map();
        let duplicates = 0;
        const K = inputs.length;
        const keyOf = (codesArr) => codesArr.join('|');
        const tmp = new Array(K);
        for (let r = 0; r < N; r++) {
            for (let k = 0; k < K; k++) tmp[k] = inputs[k].codes[r];
            const key = keyOf(tmp);
            if (lookup.has(key)) duplicates++; else lookup.set(key, r);
        }
        let gridSize = 1;
        inputs.forEach(inp => { gridSize *= inp.levels.length; });

        return { N, inputs, outputs, imgs, lookup, duplicates, droppedRows, gridSize, keyOf };
    }

    function runCodes(ds, r) { return ds.inputs.map(inp => inp.codes[r]); }
    function findRun(ds, codes) { const r = ds.lookup.get(codes.join('|')); return r === undefined ? -1 : r; }

    /* Global sensitivity of every input on output index o. */
    function globalSensitivity(ds, o) {
        const vals = ds.outputs[o].values;
        const K = ds.inputs.length;
        return ds.inputs.map((inp, k) => {
            const L = inp.levels.length;
            let expected = 1;
            ds.inputs.forEach((other, j) => { if (j !== k) expected *= other.levels.length; });
            // group key (all other inputs) -> per-level sum/count
            const groups = new Map();
            for (let r = 0; r < ds.N; r++) {
                const v = vals[r];
                if (!isFinite(v)) continue;
                let key = '';
                for (let j = 0; j < K; j++) if (j !== k) key += ds.inputs[j].codes[r] + '|';
                let g = groups.get(key);
                if (!g) { g = { sum: new Float64Array(L), cnt: new Int32Array(L) }; groups.set(key, g); }
                const l = inp.codes[r];
                g.sum[l] += v; g.cnt[l]++;
            }
            let used = 0, partial = 0, rangeSum = 0;
            const lvlSum = new Float64Array(L), lvlCnt = new Int32Array(L);
            groups.forEach(g => {
                let present = 0, mn = Infinity, mx = -Infinity;
                for (let l = 0; l < L; l++) if (g.cnt[l]) {
                    present++;
                    const m = g.sum[l] / g.cnt[l];
                    if (m < mn) mn = m; if (m > mx) mx = m;
                }
                if (present < 2) return;
                used++;
                if (present < L) partial++;
                rangeSum += mx - mn;
                for (let l = 0; l < L; l++) if (g.cnt[l]) { lvlSum[l] += g.sum[l] / g.cnt[l]; lvlCnt[l]++; }
            });
            const impact = used ? rangeSum / used : NaN;
            const levelMeans = Array.from(lvlSum, (s, l) => lvlCnt[l] ? s / lvlCnt[l] : NaN);
            let best = -1;
            levelMeans.forEach((m, l) => { if (isFinite(m) && (best < 0 || m < levelMeans[best])) best = l; });
            let direction = 'none';
            if (inp.numeric && used) {
                const fin = levelMeans.map((m, l) => [l, m]).filter(p => isFinite(p[1]));
                const tol = 1e-9 * (Math.abs(impact) + 1);
                let up = 0, dn = 0;
                for (let i = 1; i < fin.length; i++) {
                    const d = fin[i][1] - fin[i - 1][1];
                    if (d > tol) up++; else if (d < -tol) dn++;
                }
                direction = up && dn ? 'mixed' : up ? 'raises' : dn ? 'lowers' : 'flat';
            }
            return {
                k, impact, used, partial, expected, skipped: expected - used,
                levelMeans, best, direction, singleLevel: L < 2
            };
        });
    }

    /* Local sensitivity: hold others at sel codes, sweep each input. */
    function localSensitivity(ds, o, sel) {
        const vals = ds.outputs[o].values;
        return ds.inputs.map((inp, k) => {
            const pts = [];
            const c = sel.slice();
            for (let l = 0; l < inp.levels.length; l++) {
                c[k] = l;
                const r = findRun(ds, c);
                if (r >= 0 && isFinite(vals[r])) pts.push({ l, v: vals[r], r });
            }
            let min = null, max = null;
            pts.forEach(p => { if (!min || p.v < min.v) min = p; if (!max || p.v > max.v) max = p; });
            return { k, pts, min, max, range: pts.length >= 2 ? max.v - min.v : NaN, missing: inp.levels.length - pts.length };
        });
    }

    /* Nice ticks (d3-style). */
    function niceTicks(lo, hi, count) {
        if (!(hi > lo)) return [lo];
        const span = hi - lo;
        const step0 = span / Math.max(1, count - 1);
        const mag = Math.pow(10, Math.floor(Math.log10(step0)));
        const err = step0 / mag;
        const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
        const out = [];
        for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
        return out;
    }

    function fmt(v, ref) {
        if (v == null || !isFinite(v)) return '—';
        const a = Math.abs(ref != null && isFinite(ref) ? ref : v);
        const d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 1 : a >= 1 ? 2 : a >= 0.1 ? 3 : 4;
        return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    }

    /* Synthetic demo dataset (always labelled "Demo data" in the UI). */
    function demoCSV() {
        let seed = 7;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const WWR = [20, 30, 40, 50], GL = ['Double U-0.30', 'Triple U-0.18'], WALL = [13, 20, 30],
            INF = [0.06, 0.15, 0.3], SH = [0, 1, 2], PV = ['None', 'Roof PV'];
        const head = ['in:WWR (%)', 'in:Glazing', 'in:Wall R-value (h·ft²·°F/Btu)', 'in:Infiltration (cfm/sf)',
            'in:Shading depth (ft)', 'in:PV', 'out:EUI (kBtu/sf·yr)', 'out:Net EUI (kBtu/sf·yr)',
            'out:Heating (kBtu/sf·yr)', 'out:Cooling (kBtu/sf·yr)', 'out:Peak heating (kW)', 'out:Peak cooling (kW)'];
        const lines = [head.join(',')];
        let n = 0;
        WWR.forEach(w => GL.forEach((g, gi) => WALL.forEach(r => INF.forEach(inf => SH.forEach(s => PV.forEach(pv => {
            n++;
            if (n % 97 === 0) return; // a few missing runs on purpose
            const u = gi ? 0.18 : 0.30;
            const heat = 6 + 0.11 * w * u * 4 + 55 / r + 38 * inf + 0.25 * s + rnd() * 0.4;
            const cool = 4 + 0.09 * w * (1 - 0.18 * s) * (gi ? 0.85 : 1) + 0.6 * inf + rnd() * 0.3;
            const base = 31;
            const eui = base + heat + cool;
            const net = eui - (pv === 'Roof PV' ? 14.5 : 0);
            const ph = 38 + 2.6 * heat + rnd() * 2;
            const pc = 30 + 3.1 * cool + rnd() * 2;
            lines.push([w, g, r, inf, s, pv, eui.toFixed(2), net.toFixed(2), heat.toFixed(2), cool.toFixed(2),
                ph.toFixed(1), pc.toFixed(1)].join(','));
        }))))));
        return lines.join('\n');
    }

    const Core = { parseCSV, toNumber, parseHeader, buildDataset, findRun, runCodes, globalSensitivity, localSensitivity, niceTicks, fmt, demoCSV };
    if (typeof module !== 'undefined' && module.exports) module.exports = Core;
    root.PECore = Core;
    if (typeof document === 'undefined') return;

    // ================================================================
    //  UI
    // ================================================================
    const $ = id => document.getElementById(id);
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));


    /* Markup for the explorer; mounted into #pe-root on any page. */
    const ICON_CAM = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>';
    const MARKUP = `
        <div class="pe-empty-state hidden" id="pe-empty"></div>
        <div id="pe-content">
        <div class="pe-layout">
            <section class="chart-section" id="pe-pc-section">
                <div class="section-header">
                    <h2 class="section-title">Parallel Coordinates · Sliders</h2>
                    <div class="section-controls">
                        <label class="control-label pe-check" title="Also highlight runs that differ from the selection in exactly one input"><input type="checkbox" id="pe-show-near"> Show one-change runs</label>
                        <span id="pe-filter-count" class="data-count num"></span>
                        <button id="pe-clear" class="btn btn-sm btn-outline">Clear filters</button>
                        <button id="pe-export-pc" class="btn btn-sm pe-btn-export" title="Export chart as PNG">${ICON_CAM} Export</button>
                    </div>
                </div>
                <div class="pe-chart-scroll" id="pe-scroll">
                    <div class="pe-canvas-wrap" id="pe-wrap">
                        <canvas id="pe-base"></canvas>
                        <canvas id="pe-top" class="pe-top"></canvas>
                    </div>
                </div>
                <div class="pe-status">
                    <span class="pe-legend">
                        <span><i style="background:var(--pe-sel);height:4px"></i>Selected run</span>
                        <span id="pe-legend-near" class="hidden"><i style="background:var(--pe-near)"></i>Differs in one input</span>
                        <span><i style="background:var(--pe-run);opacity:.6"></i>Runs in filter</span>
                        <span><i style="background:var(--pe-grey)"></i>Filtered out</span>
                    </span>
                    <span id="pe-match" class="num"></span>
                </div>
                <div class="pe-status pe-hint">Drag up or down on an axis to filter. Click a filter band to clear it. Click a line to select that run.</div>
                <div class="pe-sliders" id="pe-sliders"></div>
            </section>
            <section class="chart-section" id="pe-run-section">
                <div class="section-header">
                    <h2 class="section-title">Selected Run</h2>
                    <div class="section-controls">
                        <label class="control-label">Primary: <select id="pe-primary"></select></label>
                    </div>
                </div>
                <div class="pe-panel-body" id="pe-run"></div>
            </section>
        </div>
        <section class="chart-section" id="pe-sens-section">
            <div class="section-header">
                <h2 class="section-title">Sensitivity Analysis</h2>
                <div class="section-controls">
                    <div class="pe-seg" id="pe-mode">
                        <button data-mode="global" class="active">Global</button>
                        <button data-mode="local">Local</button>
                    </div>
                    <label class="control-label">Output: <select id="pe-sens-out"></select></label>
                    <button id="pe-export-sens" class="btn btn-sm pe-btn-export" title="Export chart as PNG">${ICON_CAM} Export</button>
                </div>
            </div>
            <div class="pe-sens-body">
                <p class="pe-explain" id="pe-sens-explain"></p>
                <div id="pe-sens-chart"></div>
                <p class="pe-foot" id="pe-sens-foot"></p>
            </div>
        </section>
        </div>`;
    const mount = $('pe-root');
    if (!mount) return;
    mount.innerHTML = MARKUP;
    ['pe-tooltip', 'pe-toast'].forEach(id => {
        if ($(id)) return;
        const d = document.createElement('div'); d.id = id;
        d.className = id === 'pe-toast' ? 'pe-toast' : 'hidden';
        document.body.appendChild(d);
    });
    // Standalone page (parametric.html) has its own load controls; the combined page feeds us through window.PEApp.
    const STANDALONE = !!$('pe-csv');

    const S = {
        ds: null, sel: [], selRun: -1, primary: 0, baseline: -1, baselinePinned: false,
        brushes: {}, inFilter: null, mode: 'global', sensOut: 0, images: new Map(), demo: false, layout: null
    };

    function css(name) { return getComputedStyle(document.body).getPropertyValue(name).trim(); }
    function withAlpha(color, a) {
        const c = color.trim();
        if (c.startsWith('#')) {
            let h = c.slice(1); if (h.length === 3) h = h.split('').map(x => x + x).join('');
            const n = parseInt(h, 16);
            return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
        }
        return c;
    }
    function unitSuffix(u) { return u ? ' ' + u : ''; }
    function toast(msg) { const t = $('pe-toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200); }

    // ---------- theme: follow js/theme.js ----------
    function refreshColors() { if (S.ds && S.layout) { drawBase(); drawTop(); renderSensitivity(); } }
    document.addEventListener('bbb-themechange', refreshColors);

    // ---------- loading ----------
    function showEmpty(msg) {
        S.ds = null;
        $('pe-empty').innerHTML = msg; $('pe-empty').classList.remove('hidden'); $('pe-content').classList.add('hidden');
    }
    function loadText(text, name, demo) {
        let ds;
        try { ds = buildDataset(text); } catch (e) {
            if (STANDALONE) { alert('Could not read this CSV.\n\n' + e.message); return false; }
            showEmpty(`<b>The Parametric Explorer needs a Colibri file.</b> ${esc(e.message)}<br>The Overview tab can still show this file.`);
            return false;
        }
        $('pe-empty').classList.add('hidden'); $('pe-content').classList.remove('hidden');
        S.ds = ds; S.demo = !!demo; S.brushes = {}; S.baselinePinned = false;
        S.primary = 0; S.sensOut = 0;
        if ($('pe-demo-badge')) $('pe-demo-badge').classList.toggle('hidden', !demo);
        if ($('pe-file-name')) $('pe-file-name').textContent = demo ? 'Synthetic numbers, not a real study' : (name || '');
        if (STANDALONE) { $('upload-zone').classList.add('hidden'); $('viz-container').classList.remove('hidden'); }

        const opts = ds.outputs.map((o, i) => `<option value="${i}">${esc(o.label)}</option>`).join('');
        $('pe-primary').innerHTML = opts; $('pe-sens-out').innerHTML = opts;
        // baseline: highest EUI run (first output whose name is EUI, else first EUI-like, else primary)
        S.baseline = defaultBaseline();
        // start at the lowest primary-output run
        let best = -1; const pv = ds.outputs[0].values;
        for (let r = 0; r < ds.N; r++) if (isFinite(pv[r]) && (best < 0 || pv[r] < pv[best])) best = r;
        S.sel = runCodes(ds, best < 0 ? 0 : best);
        buildSliders();
        computeFilter();
        layoutChart();
        updateSelection();
        renderSensitivity();
        const notes = [];
        if (ds.droppedRows) notes.push(`${ds.droppedRows} row(s) with blank inputs ignored`);
        if (ds.duplicates) notes.push(`${ds.duplicates} duplicate combination(s), first one used`);
        if (ds.N - ds.duplicates < ds.gridSize) notes.push(`${ds.gridSize - (ds.N - ds.duplicates)} of ${ds.gridSize} grid combinations have no run`);
        if (notes.length) toast(notes.join(' · '));
        return true;
    }
    function defaultBaseline() {
        const ds = S.ds;
        let o = ds.outputs.findIndex(x => /^eui$/i.test(x.name.trim()));
        if (o < 0) o = ds.outputs.findIndex(x => /\beui\b/i.test(x.name) && !/net/i.test(x.name));
        if (o < 0) o = ds.outputs.findIndex(x => /\beui\b/i.test(x.name));
        if (o < 0) o = S.primary;
        const v = ds.outputs[o].values; let b = -1;
        for (let r = 0; r < ds.N; r++) if (isFinite(v[r]) && (b < 0 || v[r] > v[b])) b = r;
        return b;
    }
    function readFile(file) {
        if (!file) return;
        const fr = new FileReader();
        fr.onload = () => loadText(String(fr.result), file.name, false);
        fr.readAsText(file);
    }
    function addImages(files, quiet) {
        const list = [...files].filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name));
        list.forEach(f => S.images.set(imgKey(f.name), URL.createObjectURL(f)));
        if (list.length && !quiet) toast(`${list.length} image(s) loaded`);
        if (S.ds) renderRunPanel();
    }
    if (STANDALONE) {
        $('pe-csv').onchange = e => { readFile(e.target.files[0]); e.target.value = ''; };
        $('pe-drop').onclick = () => $('pe-csv').click();
        $('pe-demo').onclick = () => loadText(demoCSV(), 'Demo data', true);
        $('pe-imgs').onchange = e => { addImages(e.target.files); e.target.value = ''; };
        let dragDepth = 0;
        window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('pe-dragover'); });
        window.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('pe-dragover'); } });
        window.addEventListener('dragover', e => e.preventDefault());
        window.addEventListener('drop', e => {
            e.preventDefault(); dragDepth = 0; document.body.classList.remove('pe-dragover');
            const files = [...(e.dataTransfer.files || [])];
            const csv = files.find(f => /\.csv$/i.test(f.name) || f.type === 'text/csv');
            const imgs = files.filter(f => /^image\//.test(f.type));
            if (imgs.length) addImages(imgs, !!csv);
            if (csv) readFile(csv);
        });
    }
    function imgKey(p) { return String(p).split(/[\\/]/).pop().toLowerCase().replace(/\.[a-z0-9]+$/, ''); }

    // ---------- sliders ----------
    /* Step sliders: one dot per tested level, evenly spaced, label centred under its dot. */
    function stepPos(i, L) { return L < 2 ? 50 : i / (L - 1) * 100; }
    function buildSliders() {
        const ds = S.ds;
        $('pe-sliders').innerHTML = ds.inputs.map((inp, k) => {
            const L = inp.levels.length;
            const every = L > 7 ? Math.ceil(L / 6) : 1;           // label every n-th level when there are many
            const maxW = L < 2 ? 100 : Math.max(8, 100 / (L - 1)); // label width (%) so neighbours never overlap
            const dots = inp.levels.map((l, i) => `<span class="pe-step" data-l="${i}" style="left:${stepPos(i, L)}%" title="${esc(l.text)}"></span>`).join('');
            const labels = inp.levels.map((l, i) => {
                const edge = L > 1 && i === 0 ? ' first' : L > 1 && i === L - 1 ? ' last' : '';
                const show = i % every === 0 || i === L - 1;
                // a label owns half a step on each side of its dot (edge labels only have one side)
                return `<span class="pe-step-label${edge}${show ? '' : ' minor'}" data-l="${i}" style="left:${stepPos(i, L)}%;max-width:calc(${edge ? maxW / 2 : maxW}% ${edge ? '+ 9px' : ''})" title="${esc(l.text)}">${esc(l.text)}</span>`;
            }).join('');
            return `<div class="pe-slider">
                <label id="pe-sl${k}"><span>${esc(inp.label)}</span><b id="pe-sv${k}"></b></label>
                <div class="pe-steps${L < 2 ? ' disabled' : ''}" id="pe-s${k}" data-k="${k}" role="slider" tabindex="${L < 2 ? -1 : 0}"
                    aria-labelledby="pe-sl${k}" aria-valuemin="0" aria-valuemax="${Math.max(0, L - 1)}">
                    <div class="pe-steps-track"></div>${dots}
                </div>
                <div class="pe-step-labels" id="pe-st${k}">${labels}</div></div>`;
        }).join('');
        ds.inputs.forEach((inp, k) => {
            const el = $('pe-s' + k), L = inp.levels.length;
            if (L < 2) return;
            const set = l => { l = Math.max(0, Math.min(L - 1, l)); if (l !== S.sel[k]) { S.sel[k] = l; updateSelection(); } };
            const fromX = x => { const b = el.getBoundingClientRect(); return Math.round((x - b.left) / b.width * (L - 1)); };
            el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); el.focus(); set(fromX(e.clientX)); e.preventDefault(); });
            el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) set(fromX(e.clientX)); });
            el.addEventListener('keydown', e => {
                const m = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
                if (m) { set(S.sel[k] + m); e.preventDefault(); }
                else if (e.key === 'Home') { set(0); e.preventDefault(); }
                else if (e.key === 'End') { set(L - 1); e.preventDefault(); }
            });
            $('pe-st' + k).querySelectorAll('.pe-step-label').forEach(sp => { sp.onclick = () => set(+sp.dataset.l); });
        });
    }
    function syncSliders() {
        S.ds.inputs.forEach((inp, k) => {
            const l = S.sel[k], text = inp.levels[l].text + (inp.numeric && inp.unit && !/%$/.test(inp.levels[l].text) ? ' ' + inp.unit : '');
            const el = $('pe-s' + k);
            el.setAttribute('aria-valuenow', l); el.setAttribute('aria-valuetext', text);
            el.querySelectorAll('.pe-step').forEach(d => { const i = +d.dataset.l; d.classList.toggle('on', i === l); });
            $('pe-sv' + k).textContent = text;
            $('pe-st' + k).querySelectorAll('.pe-step-label').forEach(sp => sp.classList.toggle('on', +sp.dataset.l === l));
        });
    }

    function updateSelection() {
        S.selRun = findRun(S.ds, S.sel);
        syncSliders();
        $('pe-match').innerHTML = S.selRun >= 0 ? `Run #${S.selRun + 1} of ${S.ds.N}` : '<span class="pe-nomatch">No run with this combination</span>';
        drawTop();
        renderRunPanel();
        if (S.mode === 'local') renderSensitivity();
        announceSelection();
    }
    /* Tell the rest of the page (scatter, distribution) which run is selected, so it can be marked in orange there too. */
    function announceSelection() {
        const ds = S.ds, r = S.selRun;
        const detail = r < 0 ? null : {
            inputs: ds.inputs.map(inp => { const l = inp.levels[inp.codes[r]]; return { col: inp.col, numeric: inp.numeric, value: l.value, text: l.text }; }),
            outputs: ds.outputs.map(o => ({ col: o.col, value: o.values[r] }))
        };
        document.dispatchEvent(new CustomEvent('pe-select', { detail }));
    }

    // ---------- filter ----------
    function computeFilter() {
        const ds = S.ds; const f = new Uint8Array(ds.N); let n = 0;
        const K = ds.inputs.length;
        const br = Object.entries(S.brushes).map(([a, r]) => [+a, r[0], r[1]]);
        for (let r = 0; r < ds.N; r++) {
            let ok = 1;
            for (const [a, lo, hi] of br) {
                const v = a < K ? ds.inputs[a].codes[r] : ds.outputs[a - K].values[r];
                if (!(v >= lo && v <= hi)) { ok = 0; break; }
            }
            f[r] = ok; n += ok;
        }
        S.inFilter = f;
        const nb = br.length;
        $('pe-filter-count').textContent = nb ? `${n.toLocaleString()} of ${ds.N.toLocaleString()} runs in filter` : `${ds.N.toLocaleString()} runs`;
        $('pe-clear').disabled = !nb;
    }
    $('pe-clear').onclick = () => { S.brushes = {}; computeFilter(); drawBase(); drawTop(); };

    // ---------- parallel coordinates ----------
    const base = $('pe-base'), top = $('pe-top');
    const M = { l: 70, r: 90, t: 62, b: 26 };

    function layoutChart() {
        const ds = S.ds; if (!ds) return;
        const K = ds.inputs.length, A = K + ds.outputs.length;
        const avail = $('pe-scroll').clientWidth || 900;
        const minGap = 118;
        const gap = Math.max(minGap, (avail - M.l - M.r) / Math.max(1, A - 1));
        const W = Math.round(M.l + M.r + gap * (A - 1));
        const H = 430;
        const axes = [];
        ds.inputs.forEach((inp, k) => axes.push({ kind: 'in', k, label: inp.label, x: M.l + gap * k, L: inp.levels.length }));
        ds.outputs.forEach((o, i) => {
            const pad = (o.max - o.min) * 0.04 || Math.abs(o.max) * 0.04 || 1;
            const lo = o.min - pad, hi = o.max + pad;
            axes.push({ kind: 'out', o: i, label: o.label, x: M.l + gap * (K + i), lo, hi, ticks: niceTicks(lo, hi, 5) });
        });
        S.layout = { W, H, axes, y0: M.t, y1: H - M.b, K };
        const dpr = window.devicePixelRatio || 1;
        [base, top].forEach(c => { c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); });
        const wrap = $('pe-wrap'); wrap.style.width = W + 'px'; wrap.style.height = H + 'px';
        buildCoords();
        drawBase(); drawTop();
    }

    /* y position of value v on axis a (value = level index for inputs) */
    function yOf(a, v) {
        const { y0, y1 } = S.layout;
        if (a.kind === 'in') return a.L < 2 ? (y0 + y1) / 2 : y1 - (v / (a.L - 1)) * (y1 - y0);
        return y1 - ((v - a.lo) / (a.hi - a.lo)) * (y1 - y0);
    }
    function vOf(a, y) {
        const { y0, y1 } = S.layout;
        if (a.kind === 'in') return a.L < 2 ? 0 : (y1 - y) / (y1 - y0) * (a.L - 1);
        return a.lo + (y1 - y) / (y1 - y0) * (a.hi - a.lo);
    }
    /* precomputed y coords per run per axis (NaN = missing) */
    function buildCoords() {
        const ds = S.ds, { axes } = S.layout, A = axes.length;
        const Y = new Float32Array(ds.N * A);
        for (let a = 0; a < A; a++) {
            const ax = axes[a];
            for (let r = 0; r < ds.N; r++) {
                const v = ax.kind === 'in' ? ds.inputs[ax.k].codes[r] : ds.outputs[ax.o].values[r];
                Y[r * A + a] = isFinite(v) ? yOf(ax, v) : NaN;
            }
        }
        S.Y = Y;
    }
    function tracePath(ctx, r) {
        const { axes } = S.layout, A = axes.length, Y = S.Y; let pen = false;
        for (let a = 0; a < A; a++) {
            const y = Y[r * A + a];
            if (isNaN(y)) { pen = false; continue; }
            if (pen) ctx.lineTo(axes[a].x, y); else { ctx.moveTo(axes[a].x, y); pen = true; }
        }
    }

    function wrapText(ctx, text, maxW, maxLines) {
        const words = String(text).split(/\s+/); const lines = []; let cur = '';
        words.forEach(w => {
            const t = cur ? cur + ' ' + w : w;
            if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
        });
        if (cur) lines.push(cur);
        if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += '…'; }
        return lines.map(l => { while (ctx.measureText(l).width > maxW && l.length > 2) l = l.slice(0, -2) + '…'; return l; });
    }
    function fontStr(size, weight) { return `${weight || 400} ${size}px Inter, "Helvetica Neue", Arial, sans-serif`; }

    function drawBase() {
        const ds = S.ds, L = S.layout; if (!ds || !L) return;
        const ctx = base.getContext('2d');
        ctx.clearRect(0, 0, L.W, L.H);
        const run = css('--pe-run'), grey = css('--pe-grey');
        // "Chart Line Opacity" in Color Settings scales the fade (0.5 = default).
        const k = parseFloat(css('--chart-line-opacity')); const mult = isFinite(k) && k > 0 ? k / 0.5 : 1;
        S.baseAlpha = Math.min(0.8, Math.max(0.05, Math.min(0.2, Math.max(0.1, 1.4 / Math.pow(ds.N, 0.35))) * mult));
        // Lines are drawn opaque and the whole layer is faded. Per-line alpha does not work here: on discrete
        // axes many runs share a segment, and Chrome's 1 px hairlines add up to near-solid colour.
        base.style.opacity = S.baseAlpha;
        const anyBrush = Object.keys(S.brushes).length > 0;
        ctx.lineWidth = 1;
        if (anyBrush) {
            ctx.strokeStyle = grey;
            ctx.beginPath();
            for (let r = 0; r < ds.N; r++) if (!S.inFilter[r]) tracePath(ctx, r);
            ctx.stroke();
        }
        ctx.strokeStyle = run;
        ctx.beginPath();
        for (let r = 0; r < ds.N; r++) if (S.inFilter[r]) tracePath(ctx, r);
        ctx.stroke();
    }

    /* Axes, ticks and titles: drawn on the top layer with a halo so lines never hide them. */
    function drawAxes(ctx) {
        const ds = S.ds, L = S.layout;
        const ink = css('--text-primary'), muted = css('--text-muted'), border = css('--border-strong'), bg = css('--bg-secondary');
        ctx.lineJoin = 'round';
        const label = (t, x, y) => { ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = bg; ctx.strokeText(t, x, y); ctx.restore(); ctx.fillText(t, x, y); };
        L.axes.forEach(a => {
            ctx.strokeStyle = border; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x + 0.5, L.y0); ctx.lineTo(a.x + 0.5, L.y1); ctx.stroke();
            ctx.fillStyle = ink; ctx.font = fontStr(12, 500); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            const lines = wrapText(ctx, a.label, 112, 3);
            lines.forEach((ln, i) => label(ln, a.x, L.y0 - 14 - (lines.length - 1 - i) * 14));
            ctx.font = fontStr(10.5); ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
            if (a.kind === 'in') {
                const inp = ds.inputs[a.k];
                const step = a.L > 12 ? Math.ceil(a.L / 10) : 1;
                inp.levels.forEach((lv, i) => {
                    if (i % step && i !== a.L - 1) return;
                    const y = yOf(a, i);
                    ctx.strokeStyle = border; ctx.beginPath(); ctx.moveTo(a.x - 4, y + 0.5); ctx.lineTo(a.x, y + 0.5); ctx.stroke();
                    let t = lv.text; while (ctx.measureText(t).width > 62 && t.length > 3) t = t.slice(0, -2) + '…';
                    label(t, a.x - 7, y);
                });
            } else {
                a.ticks.forEach(t => {
                    const y = yOf(a, t);
                    ctx.strokeStyle = border; ctx.beginPath(); ctx.moveTo(a.x - 4, y + 0.5); ctx.lineTo(a.x, y + 0.5); ctx.stroke();
                    label(fmt(t, a.hi - a.lo > 20 ? 100 : a.hi - a.lo > 2 ? 10 : 1), a.x - 7, y);
                });
            }
        });
    }

    function drawTop() {
        const ds = S.ds, L = S.layout; if (!ds || !L) return;
        const ctx = top.getContext('2d');
        ctx.clearRect(0, 0, L.W, L.H);
        const near = css('--pe-near'), sel = css('--pe-sel'), bg = css('--bg-secondary'), accent = css('--accent');
        const A = L.axes.length;
        // brushes
        Object.entries(S.brushes).forEach(([ai, rg]) => {
            const a = L.axes[+ai];
            const ya = yOf(a, rg[1]), yb = yOf(a, rg[0]);
            ctx.fillStyle = withAlpha(accent, 0.18); ctx.strokeStyle = accent; ctx.lineWidth = 1;
            ctx.fillRect(a.x - 8, ya, 16, Math.max(2, yb - ya)); ctx.strokeRect(a.x - 8 + 0.5, ya + 0.5, 15, Math.max(2, yb - ya) - 1);
        });
        if (S.drag && S.drag.active) {
            const a = L.axes[S.drag.a]; const y0 = Math.min(S.drag.y0, S.drag.y1), y1 = Math.max(S.drag.y0, S.drag.y1);
            ctx.fillStyle = withAlpha(accent, 0.25); ctx.fillRect(a.x - 8, y0, 16, y1 - y0);
        }
        // neighbours (differ in exactly one input): off by default, switched on with "Show one-change runs"
        ctx.strokeStyle = withAlpha(near, 0.85); ctx.lineWidth = 1.6;
        ctx.beginPath();
        if (S.showNear) S.ds.inputs.forEach((inp, k) => {
            const c = S.sel.slice(); // fresh copy per input: only input k differs
            for (let l = 0; l < inp.levels.length; l++) {
                if (l === S.sel[k]) continue;
                c[k] = l; const r = findRun(ds, c);
                if (r >= 0) tracePath(ctx, r);
            }
        });
        ctx.stroke();
        // hover
        if (S.hover >= 0 && S.hover !== S.selRun) {
            ctx.strokeStyle = css('--text-primary'); ctx.lineWidth = 1.5; ctx.beginPath(); tracePath(ctx, S.hover); ctx.stroke();
        }
        // selected
        const r = S.selRun;
        if (r >= 0) {
            ctx.strokeStyle = bg; ctx.lineWidth = 7; ctx.lineJoin = 'round';
            ctx.beginPath(); tracePath(ctx, r); ctx.stroke();
            ctx.strokeStyle = sel; ctx.lineWidth = 3.6;
            ctx.beginPath(); tracePath(ctx, r); ctx.stroke();
            drawAxes(ctx);
            ctx.font = fontStr(11.5, 600); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
            L.axes.forEach((a, ai) => {
                const y = S.Y[r * A + ai]; if (isNaN(y)) return;
                ctx.fillStyle = sel; ctx.beginPath(); ctx.arc(a.x, y, 4.5, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = bg; ctx.lineWidth = 1.5; ctx.stroke();
                if (a.kind === 'out') {
                    const o = ds.outputs[a.o];
                    const txt = fmt(o.values[r], o.max) + unitSuffix(o.unit.length <= 14 ? o.unit : '');
                    const w = ctx.measureText(txt).width + 10;
                    ctx.fillStyle = sel; ctx.fillRect(a.x + 8, y - 9, w, 18);
                    ctx.fillStyle = '#fff'; ctx.fillText(txt, a.x + 13, y + 0.5);
                }
            });
        } else {
            drawAxes(ctx);
            // show slider position on input axes even without a run
            ctx.strokeStyle = sel; ctx.lineWidth = 2;
            S.ds.inputs.forEach((inp, k) => {
                const a = L.axes[k]; const y = yOf(a, S.sel[k]);
                ctx.beginPath(); ctx.arc(a.x, y, 5, 0, Math.PI * 2); ctx.stroke();
            });
        }
    }

    // ---------- chart interaction ----------
    function localPos(e) { const b = top.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
    function axisAt(x) {
        const ax = S.layout.axes; let best = -1, bd = 16;
        ax.forEach((a, i) => { const d = Math.abs(a.x - x); if (d < bd) { bd = d; best = i; } });
        return best;
    }
    function segDist(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1; const l2 = dx * dx + dy * dy;
        let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
        const ex = x1 + t * dx - px, ey = y1 + t * dy - py; return Math.sqrt(ex * ex + ey * ey);
    }
    function nearestRun(x, y, maxD) {
        const ds = S.ds, ax = S.layout.axes, A = ax.length, Y = S.Y;
        let seg = -1;
        for (let a = 0; a < A - 1; a++) if (x >= ax[a].x && x <= ax[a + 1].x) { seg = a; break; }
        if (seg < 0) return -1;
        const x1 = ax[seg].x, x2 = ax[seg + 1].x;
        let best = -1, bd = maxD;
        for (let r = 0; r < ds.N; r++) {
            if (!S.inFilter[r]) continue;
            const y1 = Y[r * A + seg], y2 = Y[r * A + seg + 1];
            if (isNaN(y1) || isNaN(y2)) continue;
            const d = segDist(x, y, x1, y1, x2, y2);
            if (d < bd) { bd = d; best = r; }
        }
        return best;
    }
    let raf = 0;
    function schedule(fn) { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; fn(); }); }

    top.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        const p = localPos(e); const a = axisAt(p.x);
        S.drag = { a, x0: p.x, y0: p.y, y1: p.y, active: false };
        e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
        if (!S.ds || !S.layout) return;
        const p = localPos(e);
        if (S.drag) {
            S.drag.y1 = Math.max(S.layout.y0, Math.min(S.layout.y1, p.y));
            if (S.drag.a >= 0 && Math.abs(S.drag.y1 - S.drag.y0) > 3) {
                S.drag.active = true;
                const a = S.layout.axes[S.drag.a];
                const v0 = vOf(a, Math.max(S.drag.y0, S.drag.y1)), v1 = vOf(a, Math.min(S.drag.y0, S.drag.y1));
                S.brushes[S.drag.a] = [v0, v1];
                schedule(() => { computeFilter(); drawBase(); drawTop(); });
            }
            return;
        }
        if (e.target !== top) { if (S.hover >= 0) { S.hover = -1; $('pe-tooltip').classList.add('hidden'); drawTop(); } return; }
        const h = nearestRun(p.x, p.y, 6);
        if (h !== S.hover) { S.hover = h; schedule(drawTop); }
        const tt = $('pe-tooltip');
        if (h >= 0) {
            const ds = S.ds;
            tt.innerHTML = `<b>Run #${h + 1}</b><br>` + ds.inputs.map(inp => `${esc(inp.label)}: ${esc(inp.levels[inp.codes[h]].text)}`).join('<br>') +
                '<br>' + ds.outputs.map(o => `${esc(o.name)}: <b>${fmt(o.values[h], o.max)}</b>${esc(unitSuffix(o.unit))}`).join('<br>');
            tt.style.left = Math.min(window.innerWidth - 350, e.clientX + 14) + 'px';
            tt.style.top = Math.min(window.innerHeight - tt.offsetHeight - 8, e.clientY + 14) + 'px';
            tt.classList.remove('hidden');
        } else tt.classList.add('hidden');
    });
    window.addEventListener('mouseup', e => {
        const d = S.drag; if (!d) return; S.drag = null;
        if (d.active) { computeFilter(); drawBase(); drawTop(); return; }
        // click
        if (d.a >= 0 && S.brushes[d.a]) {
            const a = S.layout.axes[d.a], rg = S.brushes[d.a];
            const ya = yOf(a, rg[1]), yb = yOf(a, rg[0]);
            if (d.y0 >= ya - 4 && d.y0 <= yb + 4) { delete S.brushes[d.a]; computeFilter(); drawBase(); drawTop(); return; }
        }
        const r = nearestRun(d.x0, d.y0, 8);
        if (r >= 0) { S.sel = runCodes(S.ds, r); updateSelection(); }
    });
    top.addEventListener('mouseleave', () => { if (!S.drag) { S.hover = -1; $('pe-tooltip').classList.add('hidden'); drawTop(); } });
    if (window.ResizeObserver) {
        let lastW = 0;
        new ResizeObserver(() => { const w = $('pe-scroll').clientWidth; if (S.ds && w !== lastW) { lastW = w; layoutChart(); renderSensitivity(); } }).observe($('pe-scroll'));
    }

    // ---------- selected run panel ----------
    $('pe-primary').onchange = e => { S.primary = +e.target.value; if (!S.baselinePinned) S.baseline = defaultBaseline(); renderRunPanel(); };

    function pct(a, b) { return isFinite(a) && isFinite(b) && b !== 0 ? (a - b) / Math.abs(b) * 100 : NaN; }
    function pctCell(p) {
        if (!isFinite(p)) return '<td>—</td>';
        const cls = Math.abs(p) < 0.05 ? '' : p < 0 ? 'dn' : 'up';
        return `<td class="${cls}">${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1)}%</td>`;
    }
    function renderRunPanel() {
        const ds = S.ds, r = S.selRun, b = S.baseline, el = $('pe-run');
        const o = ds.outputs[S.primary];
        const inputsHtml = '<div class="pe-inputs">' + ds.inputs.map((inp, k) =>
            `<div><span>${esc(inp.label)}</span><span>${esc(inp.levels[S.sel[k]].text)}</span></div>`).join('') + '</div>';
        if (r < 0) {
            el.innerHTML = `<div class="pe-big-label">${esc(o.label)}</div><div class="pe-big pe-nomatch" style="font-size:22px;margin:6px 0">No run with this combination</div>
                <p class="pe-foot" style="margin-top:0">This combination was not simulated. Move a slider, or click a line in the chart.</p>${inputsHtml}`;
            return;
        }
        const v = o.values[r], bv = b >= 0 ? o.values[b] : NaN, p = pct(v, bv);
        const rows = ds.outputs.map(out => {
            const sv = out.values[r], bb = b >= 0 ? out.values[b] : NaN;
            return `<tr><td>${esc(out.label)}</td><td>${fmt(sv, out.max)}</td><td>${fmt(bb, out.max)}</td>${pctCell(pct(sv, bb))}</tr>`;
        }).join('');
        let imgHtml = '';
        if (ds.imgs && ds.imgs[r]) {
            const path = ds.imgs[r];
            const src = S.images.get(imgKey(path));
            imgHtml = src ? `<div class="pe-img"><img alt="Run ${r + 1} screenshot" src="${src}"></div>`
                : /^([a-z]:\\|\\\\|\/)/i.test(path) ? `<div class="pe-img-note">Image: ${esc(path)}<br>Use <b>Load Images</b> to pick the screenshots folder's files.</div>`
                    : `<div class="pe-img"><img alt="Run ${r + 1} screenshot" src="${esc(path)}" onerror="this.parentNode.outerHTML='<div class=&quot;pe-img-note&quot;>Image not found: ${esc(esc(path))}<br>Use <b>Load Images</b> to pick the screenshot files.</div>'"></div>`;
        }
        el.innerHTML = `
            <div class="pe-big-label">${esc(o.name)}${o.unit ? '' : ''}</div>
            <div class="pe-big num">${fmt(v, o.max)}<small>${esc(o.unit)}</small></div>
            <div class="pe-big-delta num">${b === r ? 'This run is the baseline' : isFinite(p) ? `<span style="color:var(${p < 0 ? '--pe-good' : '--pe-bad'})">${p > 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%</span> vs baseline (${fmt(bv, o.max)}${esc(unitSuffix(o.unit))})` : ''}</div>
            ${inputsHtml}
            <table class="pe-table num"><thead><tr><th>Output</th><th>Selected</th><th>Baseline</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table>
            <div class="pe-foot" style="margin-top:6px">Baseline: Run #${b + 1}${S.baselinePinned ? ' (pinned)' : ' (highest EUI)'}. Green = lower, red = higher.</div>
            <div class="pe-actions">
                <button class="btn btn-sm btn-outline" id="pe-setbase">Set as baseline</button>
                ${S.baselinePinned ? '<button class="btn btn-sm btn-outline" id="pe-resetbase">Reset baseline</button>' : ''}
                <button class="btn btn-sm btn-outline" id="pe-copy">Copy run values</button>
            </div>${imgHtml}`;
        $('pe-setbase').onclick = () => { S.baseline = S.selRun; S.baselinePinned = true; renderRunPanel(); toast('Baseline set to Run #' + (S.selRun + 1)); };
        if ($('pe-resetbase')) $('pe-resetbase').onclick = () => { S.baselinePinned = false; S.baseline = defaultBaseline(); renderRunPanel(); };
        $('pe-copy').onclick = copyRun;
    }
    function copyRun() {
        const ds = S.ds, r = S.selRun; if (r < 0) return;
        const lines = [`Run\t${r + 1}`];
        ds.inputs.forEach(inp => lines.push(`${inp.label}\t${inp.levels[inp.codes[r]].text}`));
        ds.outputs.forEach(o => lines.push(`${o.label}\t${isFinite(o.values[r]) ? o.values[r] : ''}`));
        const text = lines.join('\n');
        const fallback = () => {
            const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
            ta.remove(); toast(ok ? 'Copied. Paste into Excel.' : 'Copy failed');
        };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => toast('Copied. Paste into Excel.'), fallback);
        else fallback();
    }

    // ---------- sensitivity ----------
    $('pe-mode').querySelectorAll('button').forEach(b => b.onclick = () => {
        S.mode = b.dataset.mode;
        $('pe-mode').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
        renderSensitivity();
    });
    $('pe-sens-out').onchange = e => { S.sensOut = +e.target.value; renderSensitivity(); };

    function svgEl(w, h, inner) { return `<svg class="pe-sens-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">${inner}</svg>`; }

    function renderSensitivity() {
        const ds = S.ds; if (!ds) return;
        const o = ds.outputs[S.sensOut];
        const W = Math.max(560, $('pe-sens-chart').clientWidth || 900);
        const ink = css('--text-primary'), muted = css('--text-muted'), border = css('--border'), runC = css('--pe-run'), sel = css('--pe-sel'), warn = css('--pe-bad'), near = css('--pe-near');
        const u = unitSuffix(o.unit);
        if (S.mode === 'global') {
            $('pe-sens-explain').innerHTML = `How much does each input move <b>${esc(o.label)}</b> on average, across every tested combination of the other inputs?`;
            const res = globalSensitivity(ds, S.sensOut).sort((a, b) => (isFinite(b.impact) ? b.impact : -1) - (isFinite(a.impact) ? a.impact : -1));
            const maxI = Math.max(1e-12, ...res.map(x => isFinite(x.impact) ? x.impact : 0));
            const labW = 210, valW = 150, rowH = 50, x0 = labW, barMax = Math.max(120, W - labW - valW - 10);
            let inner = '';
            res.forEach((x, i) => {
                const inp = ds.inputs[x.k], y = i * rowH + 6;
                inner += `<text x="${labW - 12}" y="${y + 15}" text-anchor="end" font-size="13" font-weight="500" fill="${ink}">${esc(inp.label)}</text>`;
                if (!isFinite(x.impact)) {
                    inner += `<text x="${x0}" y="${y + 15}" font-size="12.5" fill="${muted}">${x.singleLevel ? 'Only one level tested' : 'Not enough runs to compare levels'}</text>`;
                } else {
                    const w = Math.max(1, x.impact / maxI * barMax);
                    inner += `<rect x="${x0}" y="${y + 3}" width="${w}" height="16" fill="${runC}"/>`;
                    inner += `<text x="${x0 + w + 8}" y="${y + 15}" font-size="13" font-weight="600" fill="${ink}">${fmt(x.impact, o.max - o.min)}${esc(u)}</text>`;
                }
                let sub = '';
                if (x.best >= 0 && isFinite(x.impact)) {
                    sub += `best: ${esc(inp.levels[x.best].text)}`;
                    if (inp.numeric) sub += x.direction === 'raises' ? ` · higher ${esc(inp.name)} raises ${esc(o.name)}` : x.direction === 'lowers' ? ` · higher ${esc(inp.name)} lowers ${esc(o.name)}` : x.direction === 'mixed' ? ' · not monotonic (rises and falls)' : ' · no change';
                }
                const groups = `${x.used} of ${x.expected} groups`;
                const flag = x.skipped > 0 || x.partial > 0;
                sub += `${sub ? ' · ' : ''}<tspan fill="${flag ? warn : muted}">${groups}${x.skipped > 0 ? `, ${x.skipped} skipped (missing runs)` : ''}${x.partial > 0 ? `, ${x.partial} with some levels missing` : ''}</tspan>`;
                inner += `<text x="${x0}" y="${y + 36}" font-size="11.5" fill="${muted}">${sub}</text>`;
            });
            $('pe-sens-chart').innerHTML = svgEl(W, res.length * rowH + 10, inner);
            $('pe-sens-foot').innerHTML = `Impact = average change in ${esc(o.label)} across the tested levels of each input, with all other inputs held at each of their tested combinations. Values depend on the range tested, so a wider tested range shows a larger impact.`;
        } else {
            const r = S.selRun;
            const cur = r >= 0 ? o.values[r] : NaN;
            $('pe-sens-explain').innerHTML = `From the run selected with the sliders${r >= 0 ? ` (Run #${r + 1}, ${esc(o.name)} = ${fmt(cur, o.max)}${esc(u)})` : ' (<span class="pe-nomatch">no run with this combination</span>)'}, which single change moves <b>${esc(o.label)}</b> the most? Each bar holds every other input where it is and tries every level of one input.`;
            const res = localSensitivity(ds, S.sensOut, S.sel).sort((a, b) => (isFinite(b.range) ? b.range : -1) - (isFinite(a.range) ? a.range : -1));
            const valid = res.filter(x => x.pts.length >= 1);
            let lo = Infinity, hi = -Infinity;
            valid.forEach(x => x.pts.forEach(p => { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }));
            if (isFinite(cur)) { lo = Math.min(lo, cur); hi = Math.max(hi, cur); }
            if (!isFinite(lo)) { $('pe-sens-chart').innerHTML = '<div class="pe-empty">No runs share the other inputs of this combination.</div>'; $('pe-sens-foot').textContent = ''; return; }
            if (!(hi > lo)) { const p0 = Math.abs(hi) * 0.05 || 1; lo -= p0; hi += p0; }
            const labW = 220, endPad = 150, rowH = 44, top0 = 10;
            const plotW = Math.max(160, W - labW - endPad * 2);
            const X = v => labW + endPad + (v - lo) / (hi - lo) * plotW;
            const H = top0 + res.length * rowH + 40;
            let inner = '';
            const ticks = niceTicks(lo, hi, 6);
            ticks.forEach(t => {
                inner += `<line x1="${X(t)}" x2="${X(t)}" y1="${top0}" y2="${H - 30}" stroke="${border}"/>`;
                inner += `<text x="${X(t)}" y="${H - 14}" text-anchor="middle" font-size="11" fill="${muted}">${fmt(t, hi - lo > 20 ? 100 : hi - lo > 2 ? 10 : 1)}</text>`;
            });
            inner += `<text x="${labW + endPad + plotW}" y="${H - 1}" text-anchor="end" font-size="11" fill="${muted}">${esc(o.label)}</text>`;
            if (isFinite(cur)) inner += `<line x1="${X(cur)}" x2="${X(cur)}" y1="${top0}" y2="${H - 30}" stroke="${sel}" stroke-dasharray="3 3"/>`;
            res.forEach((x, i) => {
                const inp = ds.inputs[x.k], y = top0 + i * rowH + 10;
                inner += `<text x="${labW - 12}" y="${y + 9}" text-anchor="end" font-size="13" font-weight="500" fill="${ink}">${esc(inp.label)}</text>`;
                if (x.pts.length < 2) {
                    inner += `<text x="${labW + 6}" y="${y + 9}" font-size="12" fill="${muted}">${inp.levels.length < 2 ? 'Only one level tested' : 'No other level was run with these settings'}</text>`;
                    return;
                }
                const xa = X(x.min.v), xb = X(x.max.v);
                inner += `<rect x="${xa}" y="${y}" width="${Math.max(2, xb - xa)}" height="14" fill="${withAlpha(near, 0.35)}" stroke="${near}"/>`;
                x.pts.forEach(p => { inner += `<line x1="${X(p.v)}" x2="${X(p.v)}" y1="${y}" y2="${y + 14}" stroke="${near}"/>`; });
                const curPt = x.pts.find(p => p.l === S.sel[x.k]);
                if (curPt) inner += `<circle cx="${X(curPt.v)}" cy="${y + 7}" r="5" fill="${sel}" stroke="${css('--bg-secondary')}" stroke-width="1.5"/>`;
                const lmin = `${esc(inp.levels[x.min.l].text)} · ${fmt(x.min.v, o.max)}`, lmax = `${esc(inp.levels[x.max.l].text)} · ${fmt(x.max.v, o.max)}`;
                inner += `<text x="${xa - 6}" y="${y + 11}" text-anchor="end" font-size="11" fill="${muted}">${lmin}</text>`;
                inner += `<text x="${xb + 6}" y="${y + 11}" font-size="11" fill="${muted}">${lmax}</text>`;
                inner += `<text x="${labW - 12}" y="${y + 24}" text-anchor="end" font-size="11" fill="${x.missing ? warn : muted}">range ${fmt(x.range, o.max - o.min)}${esc(u)}${x.missing ? ` · ${x.missing} level(s) not run` : ''}</text>`;
            });
            $('pe-sens-chart').innerHTML = svgEl(W, H, inner);
            $('pe-sens-foot').innerHTML = `Bars run from the lowest to the highest ${esc(o.label)} reachable by changing only that input. Bar ends are labelled with the level that produces them. Orange dot = current level. Tick marks = every tested level.`;
        }
    }

    // ---------- export ----------
    function download(canvas, name) {
        const a = document.createElement('a'); a.download = name; a.href = canvas.toDataURL('image/png'); a.click();
    }
    function exportChart() {
        if (!S.layout) return;
        const dpr = window.devicePixelRatio || 1, c = document.createElement('canvas');
        c.width = base.width; c.height = base.height;
        const ctx = c.getContext('2d');
        ctx.fillStyle = css('--bg-secondary') || '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.globalAlpha = S.baseAlpha || 1; ctx.drawImage(base, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(top, 0, 0);
        download(c, 'parallel-coordinates.png');
        void dpr;
    }
    function exportSens() {
        const svg = $('pe-sens-chart').querySelector('svg'); if (!svg) return;
        const w = +svg.getAttribute('width'), h = +svg.getAttribute('height'), scale = 2;
        const clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('font-family', 'Inter, Helvetica Neue, Arial, sans-serif');
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
            const ctx = c.getContext('2d'); ctx.fillStyle = css('--bg-secondary') || '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            download(c, `sensitivity-${S.mode}.png`);
        };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    }
    $('pe-export-pc').onclick = exportChart;
    $('pe-show-near').onchange = e => { S.showNear = e.target.checked; $('pe-legend-near').classList.toggle('hidden', !S.showNear); drawTop(); };
    $('pe-export-sens').onclick = exportSens;

    // ---------- API for the combined page ----------
    root.PEApp = {
        load: loadText,
        addImages,
        clearFilters() { if (!S.ds) return; S.brushes = {}; computeFilter(); drawBase(); drawTop(); },
        refresh() { if (S.ds) { layoutChart(); renderSensitivity(); } },
        exportChart, exportSens,
        get loaded() { return !!S.ds; }
    };
})(typeof window !== 'undefined' ? window : globalThis);
