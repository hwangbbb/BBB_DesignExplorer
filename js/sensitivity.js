/* =====================================================================
   BBB Design Explorer — Sensitivity module
   Adds two sections: (1) Tornado of isolated (paired) effects,
   (2) Diminishing returns within each variable (small multiples).
   Self-contained: parses the same CSV on upload; also exposes
   window.BBBSensitivity.render(rows) for app.js to call directly.
   Requires Plotly (already loaded by index.html).
   ===================================================================== */
(function () {
  const S = { rows: null, inputs: [], outputs: [], out: null };

  // ---------- data detection ----------
  function detectColumns(rows) {
    const cols = Object.keys(rows[0]);
    let inputs = cols.filter(c => /^in:/i.test(c));
    let outputs = cols.filter(c => /^out:/i.test(c));
    if (!inputs.length || !outputs.length) {              // fallback: numeric last column = output
      const numeric = cols.filter(c => rows.every(r => r[c] === '' || r[c] == null || !isNaN(parseFloat(r[c]))));
      outputs = outputs.length ? outputs : [numeric[numeric.length - 1]];
      inputs = inputs.length ? inputs : cols.filter(c => !outputs.includes(c));
    }
    return { inputs, outputs };
  }
  const clean = s => String(s).replace(/^(in|out):/i, '').trim();
  const lvl = v => (v === '' || v == null) ? 'None' : String(v);
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;

  // ---------- paired (isolated) effects ----------
  // For variable V: group runs by every OTHER input; inside each group the runs differ only in V.
  // Effect of level L = mean over groups of [ y(L) - y(reference) ]. Reference = worst-performing level.
  function pairedEffects(rows, inputs, out) {
    return inputs.map(v => {
      const others = inputs.filter(o => o !== v);
      const groups = {};
      rows.forEach(r => {
        const y = parseFloat(r[out]); if (isNaN(y)) return;
        const key = others.map(o => lvl(r[o])).join('|');
        (groups[key] = groups[key] || {})[lvl(r[v])] = y;
      });
      const levels = [...new Set(rows.map(r => lvl(r[v])))];
      // raw mean per level (for choosing the reference = worst)
      const rawMean = {}; levels.forEach(L => { const ys = rows.filter(r => lvl(r[v]) === L).map(r => parseFloat(r[out])).filter(x => !isNaN(x)); rawMean[L] = ys.length ? mean(ys) : NaN; });
      const ref = levels.reduce((a, b) => rawMean[a] >= rawMean[b] ? a : b);
      const delta = {}; let n = 0;
      levels.forEach(L => {
        const d = [];
        Object.values(groups).forEach(g => { if (g[L] !== undefined && g[ref] !== undefined) d.push(g[L] - g[ref]); });
        delta[L] = d.length ? mean(d) : 0; n = Math.max(n, d.length);
      });
      const ordered = [...levels].sort((a, b) => delta[b] - delta[a]);   // worst → best
      const worst = ordered[0]; const shift = delta[worst];                 // re-anchor so the worst level sits at 0
      levels.forEach(L => { delta[L] = delta[L] - shift; });
      const span = -delta[ordered[ordered.length - 1]];
      return { name: clean(v), key: v, ordered, delta, span, ref: worst, best: ordered[ordered.length - 1], pairs: n };
    }).sort((a, b) => b.span - a.span);
  }

  // ---------- palette (follows the page's accent when available) ----------
  // Theme tokens are read from <body> so the built-in themes (dark, ocean, ...) flow into the charts.
  function tok(name, fb) { const v = getComputedStyle(document.body).getPropertyValue(name).trim(); return v || fb; }
  function accent() { return tok('--accent', '#2457c5'); }
  function colorFor(span, maxSpan) {
    const t = maxSpan ? span / maxSpan : 0;
    if (t > 0.6) return accent();
    if (t > 0.2) return tok('--chart-mid', '#7f9bd6');
    return tok('--chart-low', '#c9c9c9');
  }
  const baseLayout = () => ({
    font: { family: 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif', size: 12, color: tok('--text-primary', '#0e0e0e') },
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { l: 10, r: 10, t: 30, b: 40 }, hoverlabel: { font: { family: 'Inter' } }
  });
  const cfg = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] };

  // ---------- 1. tornado ----------
  function drawTornado(eff, unit) {
    const el = document.getElementById('tornado-chart'); if (!el) return;
    const maxSpan = eff[0]?.span || 1;
    const y = eff.map(e => e.name).reverse();
    const x = eff.map(e => e.span).reverse();
    const colors = eff.map(e => colorFor(e.span, maxSpan)).reverse();
    const labels = eff.map(e => `${fmtN(e.span)}   ${e.ref} → ${e.best}`).reverse();
    Plotly.react(el, [{
      type: 'bar', orientation: 'h', y, x, marker: { color: colors },
      text: labels, textposition: 'outside', textfont: { size: 11.5, color: tok('--text-primary', '#0e0e0e') }, cliponaxis: false,
      hovertemplate: '%{y}<br>Isolated effect: %{x:.2f} ' + unit + '<extra></extra>'
    }], Object.assign(baseLayout(), {
      height: Math.max(220, 70 + 44 * eff.length), margin: { l: 160, r: 170, t: 20, b: 48 },
      xaxis: { title: { text: `${unit} reduction, worst level → best level`, font: { size: 11.5, color: tok('--text-muted', '#8a8a8a') } }, gridcolor: tok('--border', '#e4e4e4'), zeroline: false, range: [0, maxSpan * 1.35], tickfont: { color: tok('--text-secondary', '#4b4b4b') } },
      yaxis: { automargin: true, tickfont: { size: 12.5, color: tok('--text-primary', '#0e0e0e') } },
      bargap: 0.38
    }), cfg);
    const expl = document.getElementById('tornado-explain');
    if (expl) {
      const strong = eff.filter(e => e.span > 0.6 * maxSpan).map(e => e.name);
      const flat = eff.filter(e => e.span < 0.1 * maxSpan).map(e => e.name);
      expl.innerHTML = `Each bar is the change in ${unit} when only that variable moves from its worst level to its best, with every other variable held fixed (paired comparison across ${eff[0].pairs} matched runs). `
        + (strong.length ? `<b>${strong.join(' and ')}</b> carry the study. ` : '')
        + (flat.length ? `${flat.join(', ')} ${flat.length > 1 ? 'have' : 'has'} no practical effect.` : '');
    }
  }

  // ---------- 2. diminishing returns, small multiples ----------
  // Numeric inputs (e.g. 1, 1.5, 2.5 or 20%) are drawn to scale and judged on gain PER UNIT of
  // input, so uneven level spacing cannot fake or hide a knee. Text inputs stay categorical and
  // are judged on gain per step.
  const numOf = v => { const m = String(v).trim().match(/^(-?\d*\.?\d+)\s*%?$/); return m ? parseFloat(m[1]) : null; };
  const fmtN = v => { const a = Math.abs(v); return v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2); };

  function stepStats(e) {
    const raw = e.rawOrdered || e.ordered;
    const ys = e.ordered.map(L => e.delta[L]);
    const xv = raw.map(numOf);
    let numeric = xv.length > 1 && xv.every(v => v !== null) && new Set(xv).size === xv.length;
    if (numeric) {                                   // to-scale only if worst → best is monotonic in x
      const up = xv.every((v, k) => k === 0 || v > xv[k - 1]);
      const dn = xv.every((v, k) => k === 0 || v < xv[k - 1]);
      numeric = up || dn; e._reversed = dn;
    }
    const steps = [];                                // gain is positive when the step improves the result
    for (let k = 1; k < ys.length; k++) {
      const gain = -(ys[k] - ys[k - 1]);
      steps.push({ k, gain, perUnit: numeric ? gain / Math.abs(xv[k] - xv[k - 1]) : gain });
    }
    let knee = null;                                 // first level after which gain per unit halves
    for (let j = 1; j < steps.length; j++) {
      if (steps[j - 1].perUnit > 0 && steps[j].perUnit < 0.5 * steps[j - 1].perUnit) { knee = e.ordered[j]; break; }
    }
    const pos = steps.map(s => s.perUnit).filter(v => v > 0);
    const linear = !knee && steps.length > 1 && pos.length === steps.length && Math.max(...pos) / Math.min(...pos) <= 1.5;
    return { xv, ys, numeric, steps, knee, linear };
  }

  function drawReturns(eff, unit) {
    const el = document.getElementById('returns-chart'); if (!el) return;
    const n = eff.length, maxSpan = eff[0]?.span || 1;
    const ink = tok('--text-primary', '#0e0e0e'), ink2 = tok('--text-secondary', '#4b4b4b'),
      muted = tok('--text-muted', '#8a8a8a'), line = tok('--border', '#e4e4e4'), bg = tok('--bg-secondary', '#ffffff');
    const traces = [], ann = [], shapes = [];
    const minY = Math.min(...eff.map(e => -e.span)) * 1.25 - 0.15;
    eff.forEach((e, i) => {
      const ax = i === 0 ? '' : String(i + 1);
      const st = e._st = stepStats(e);
      const xs = st.numeric ? st.xv : e.ordered, ys = st.ys;
      const col = colorFor(e.span, maxSpan);
      traces.push({
        type: 'scatter', mode: 'lines+markers', x: xs, y: ys, xaxis: 'x' + ax, yaxis: 'y' + ax,
        text: e.ordered,
        line: { color: col, width: 2, shape: st.numeric ? 'linear' : 'spline', smoothing: 0.6 }, marker: { size: 9, color: col, line: { color: bg, width: 2 } },
        hovertemplate: `${e.name}: %{text}<br>Δ ${unit} vs worst: %{y:.2f}<extra></extra>`, showlegend: false
      });
      // marginal step labels between points: step change, plus gain per unit for numeric inputs
      st.steps.forEach(s => {
        const k = s.k, step = ys[k] - ys[k - 1];
        const x = st.numeric ? (xs[k] + xs[k - 1]) / 2 : k - 0.5;
        const small = Math.abs(step) < 0.02 * maxSpan;
        ann.push({ xref: 'x' + ax, yref: 'y' + ax, x, y: (ys[k] + ys[k - 1]) / 2,
          text: (step >= 0 ? '+' : '') + fmtN(step), showarrow: false,
          font: { size: 10.5, color: small ? muted : ink }, bgcolor: bg, opacity: 0.92, borderpad: 2 });
      });
      if (st.knee !== null) {
        const kx = st.numeric ? st.xv[e.ordered.indexOf(st.knee)] : e.ordered.indexOf(st.knee);
        shapes.push({ type: 'line', xref: 'x' + ax, yref: 'y' + ax + ' domain', x0: kx, x1: kx, y0: 0, y1: 1, line: { color: ink, width: 1, dash: 'dot' } });
        ann.push({ xref: 'x' + ax, yref: 'y' + ax + ' domain', x: kx, y: 0.02, xanchor: 'left', yanchor: 'bottom', text: ' knee', showarrow: false, font: { size: 10.5, color: ink } });
      }
      // subplot title
      ann.push({ xref: 'x' + ax + ' domain', yref: 'y' + ax + ' domain', x: 0, y: 1.14, xanchor: 'left', text: `${e.name}  <span style="color:${muted}">span ${fmtN(e.span)}</span>`, showarrow: false, font: { size: 12.5, color: ink } });
      // zero line
      shapes.push({ type: 'line', xref: 'x' + ax + ' domain', yref: 'y' + ax, x0: 0, x1: 1, y0: 0, y1: 0, line: { color: line, width: 1, dash: 'dot' } });
    });
    const layout = Object.assign(baseLayout(), {
      grid: { rows: 1, columns: n, pattern: 'independent', xgap: 0.08 },
      margin: { l: 56, r: 16, t: 44, b: 44 }, annotations: ann, shapes,
      height: 320
    });
    eff.forEach((e, i) => {
      const ax = i === 0 ? '' : String(i + 1), st = e._st;
      if (st.numeric) {
        const lo = Math.min(...st.xv), hi = Math.max(...st.xv), pad = (hi - lo) * 0.08;
        layout['xaxis' + ax] = { type: 'linear', tickvals: st.xv, ticktext: e.ordered,
          range: st.numeric && e._reversed ? [hi + pad, lo - pad] : [lo - pad, hi + pad],
          tickfont: { size: 11, color: ink2 }, showgrid: false, zeroline: false, fixedrange: true };
      } else {
        layout['xaxis' + ax] = { type: 'category', categoryorder: 'array', categoryarray: e.ordered, tickfont: { size: 11, color: ink2 }, showgrid: false, zeroline: false, fixedrange: true };
      }
      layout['yaxis' + ax] = { range: [minY, Math.max(0.35, -minY * 0.08)], gridcolor: line, zeroline: false, fixedrange: true,
        showticklabels: i === 0, tickfont: { size: 10.5, color: ink2 }, title: i === 0 ? { text: `Δ ${unit} vs worst level`, font: { size: 11, color: muted } } : undefined };
    });
    Plotly.react(el, traces, layout, cfg);
    const expl = document.getElementById('returns-explain');
    if (expl) {
      const notes = eff.filter(e => e.ordered.length > 2).map(e => {
        const st = e._st, per = st.numeric ? 'per unit' : 'per step';
        const g = st.steps.map(s => fmtN(s.perUnit)).join(', ');
        if (st.knee !== null) return `${e.name}: knee at ${st.knee} (gain ${per}: ${g})`;
        if (st.linear) return `${e.name}: close to linear, no knee (gain ${per}: ${g})`;
        return null;
      }).filter(Boolean);
      expl.innerHTML = `Levels run left → right from worst to best; the number on each segment is the change from that single step. `
        + `Numeric inputs are drawn to scale and judged on gain per unit of input, so uneven level spacing does not fake a knee. `
        + `A knee is where gain per unit falls below half of the previous step. ` + (notes.length ? notes.join('; ') + '.' : '');
    }
  }

  // ---------- render + wiring ----------
  // rows: array of row objects. opts: { inputs, outputs, customLabels, customTickLabels }
  function render(rows, opts = {}) {
    if (!rows || !rows.length) return;
    S.rows = rows;
    const det = (opts.inputs && opts.outputs) ? { inputs: opts.inputs, outputs: opts.outputs } : detectColumns(rows);
    S.inputs = det.inputs; S.outputs = det.outputs;
    S.out = S.out && det.outputs.includes(S.out) ? S.out : det.outputs[0];
    S.labels = opts.customLabels || {}; S.ticks = opts.customTickLabels || {};
    const sel = document.getElementById('sens-output');
    if (sel) sel.innerHTML = det.outputs.map(o => `<option value="${o}" ${o === S.out ? 'selected' : ''}>${S.labels[o] || clean(o)}</option>`).join('');
    const unit = clean(S.out).toUpperCase() === 'EUI' ? 'kBtu/sf/yr' : (S.labels[S.out] || clean(S.out));
    const eff = pairedEffects(rows, det.inputs, S.out).map(e => {
      // apply the app's axis-label and tick-label overrides so renamed labels flow through
      const tl = S.ticks[e.key] || {};
      const map = L => tl[L] || L;
      const delta = {}; Object.keys(e.delta).forEach(L => delta[map(L)] = e.delta[L]);
      return { ...e, name: S.labels[e.key] || e.name, rawOrdered: e.ordered, ordered: e.ordered.map(map), delta, ref: map(e.ref), best: map(e.best) };
    });
    drawTornado(eff, unit); drawReturns(eff, unit);
    document.querySelectorAll('#tornado-section,#returns-section').forEach(x => x.classList.remove('hidden'));
  }


  // =====================================================================
  //  HIGHLIGHT: one click → the N lowest (or highest) runs on the chosen output
  //  are isolated on the parallel coordinates (via constraintrange, which hides
  //  all other lines) and ringed on the scatter plot; a readout lists their inputs.
  // =====================================================================
  const HL = { active: null };                       // { mode, n, out, idx:[...] }

  function pickRuns(dm, out, mode, n) {
    const vals = dm.rawData.map(r => parseFloat(String(r[out]).replace('%', '')));
    const order = vals.map((v, i) => [v, i]).filter(p => !isNaN(p[0])).sort((a, b) => mode === 'low' ? a[0] - b[0] : b[0] - a[0]);
    const chosen = order.slice(0, Math.max(1, n));
    const thr = chosen[chosen.length - 1][0];
    const idx = order.filter(p => mode === 'low' ? p[0] <= thr : p[0] >= thr).map(p => p[1]);   // include ties
    return { idx, vals, lo: Math.min(...idx.map(i => vals[i])), hi: Math.max(...idx.map(i => vals[i])) };
  }

  function applyToParcoords(app) {
    const gd = document.getElementById('parcords-chart'); if (!gd || !gd.data || !HL.active) return;
    const dm = app.dm, out = HL.active.out;
    const dimIdx = dm.dataColumns.indexOf(out); if (dimIdx < 0) return;
    const pad = (HL.active.hi - HL.active.lo) * 0.001 + 1e-6;
    // rebuild the trace with the brush baked in: Plotly.react is the reliable way to make
    // parcoords (WebGL) redraw its brushed state; restyle alone can leave the canvas stale
    const tr = JSON.parse(JSON.stringify(gd.data[0]));
    // Plotly snaps a constraintrange to the dimension's tickvals and DROPS it when the range contains
    // no tick (the app puts nice ticks on every numeric axis). So the brushed axis temporarily uses
    // auto ticks; the app's full re-render restores them when the highlight is cleared.
    tr.dimensions.forEach((d, i) => {
      if (i === dimIdx) { d.constraintrange = [HL.active.lo - pad, HL.active.hi + pad]; delete d.tickvals; delete d.ticktext; }
      else delete d.constraintrange;
    });
    Plotly.react(gd, [tr], gd.layout, gd._context);
  }

  function applyToScatter(app) {
    const gd = document.getElementById('scatter-chart'); if (!gd || !gd.data) return;
    // drop any previous ring trace
    const old = gd.data.findIndex(t => t.name === '__highlight__'); if (old >= 0) Plotly.deleteTraces(gd, old);
    if (!HL.active) return;
    const dm = app.dm, xs = app.settings.scatterX, ys = app.settings.scatterY;
    const rows = HL.active.idx.map(i => dm.rawData[i]);
    Plotly.addTraces(gd, {
      name: '__highlight__', type: 'scatter', mode: 'markers', showlegend: false, hoverinfo: 'skip',
      x: rows.map(r => dm.getNumericValue(r, xs)), y: rows.map(r => dm.getNumericValue(r, ys)),
      marker: { symbol: 'circle-open', size: 22, color: accent(), line: { width: 3 } }
    });
    Plotly.relayout(gd, { showlegend: false });
  }

  function readout(app) {
    const el = document.getElementById('hl-readout'); if (!el) return;
    if (!HL.active) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const dm = app.dm, out = HL.active.out, L = app.customLabels || {}, T = app.customTickLabels || {};
    const name = c => L[c] || clean(c);
    const tick = (c, v) => (T[c] && T[c][String(v)]) || (v === '' || v == null ? 'None' : v);
    const lines = HL.active.idx.slice(0, 12).map(i => {
      const r = dm.rawData[i];
      const ins = dm.columns.inputs.map(c => `${name(c)} <b>${tick(c, r[c])}</b>`).join(' · ');
      return `<div><b>${name(out)} ${parseFloat(r[out]).toFixed(2)}</b> &nbsp;—&nbsp; ${ins}</div>`;
    });
    const more = HL.active.idx.length > 12 ? `<div style="color:var(--text-muted)">… ${HL.active.idx.length - 12} more</div>` : '';
    el.innerHTML = `<div style="color:var(--text-muted);margin-bottom:2px">${HL.active.mode === 'low' ? 'Lowest' : 'Highest'} ${HL.active.idx.length} of ${dm.rowCount} runs (all other lines hidden on the parallel coordinates):</div>` + lines.join('') + more;
    el.classList.remove('hidden');
  }

  function setHighlight(app, mode, n) {
    const out = S.out && app.dm.columns.outputs.includes(S.out) ? S.out : (app.settings.colorDimension && app.dm.columns.outputs.includes(app.settings.colorDimension) ? app.settings.colorDimension : app.dm.columns.outputs[0]);
    if (!out) return;
    const p = pickRuns(app.dm, out, mode, n);
    HL.active = { mode, n, out, idx: p.idx, lo: p.lo, hi: p.hi };
    applyToParcoords(app); applyToScatter(app); readout(app);
    document.getElementById('btn-hl-apply')?.classList.add('active');
  }
  function clearHighlight(app) {
    HL.active = null;
    app._renderParallelCoords();                     // fresh draw removes the constraintrange
    applyToScatter(app); readout(app);
    document.getElementById('btn-hl-apply')?.classList.remove('active');
  }

  // Integrate with the Design Explorer app: piggy-back on its _renderAll so every data load,
  // sample load, or label edit re-renders these two sections with the same DataManager.
  function attachToApp() {
    const app = window.designExplorer;
    if (!app || !app._renderAll || app.__sensHooked) return false;
    const orig = app._renderAll.bind(app);
    app._renderAll = function () {
      orig();
      const dm = this.dm; if (!dm || !dm.rowCount) return;
      render(dm.rawData, { inputs: dm.columns.inputs, outputs: dm.columns.outputs, customLabels: this.customLabels, customTickLabels: this.customTickLabels });
    };
    // label edits only re-render parcoords in the app; refresh ours too (debounced)
    const origPC = app._renderParallelCoords.bind(app);
    app._renderParallelCoords = function () { origPC(); if (HL.active) setTimeout(() => applyToParcoords(this), 60); clearTimeout(S._t); S._t = setTimeout(() => { if (this.dm.rowCount) render(this.dm.rawData, { inputs: this.dm.columns.inputs, outputs: this.dm.columns.outputs, customLabels: this.customLabels, customTickLabels: this.customTickLabels }); }, 350); };
    const origSC = app._renderScatter.bind(app);
    app._renderScatter = function () { origSC(); if (HL.active) setTimeout(() => applyToScatter(this), 60); };
    // a new dataset invalidates any highlight
    const origParse = app.dm.parseCSV.bind(app.dm);
    app.dm.parseCSV = function (txt) { HL.active = null; document.getElementById('btn-hl-apply')?.classList.remove('active'); const r = origParse(txt); readout(app); return r; };
    app.__sensHooked = true;
    if (app.dm && app.dm.rowCount) app._renderAll();
    return true;
  }

  function wire() {
    // Prefer the app integration; fall back to standalone CSV parsing if app.js is absent
    if (!attachToApp()) {
      const up = document.getElementById('csv-upload');
      if (up && window.Papa) up.addEventListener('change', ev => {
        const f = ev.target.files[0]; if (!f) return;
        Papa.parse(f, { header: true, skipEmptyLines: true, complete: res => render(res.data) });
      });
    }
    document.getElementById('btn-hl-apply')?.addEventListener('click', () => { const app = window.designExplorer; if (app && app.dm.rowCount) setHighlight(app, document.getElementById('hl-mode').value, parseInt(document.getElementById('hl-n').value || '1', 10)); });
    document.getElementById('btn-hl-clear')?.addEventListener('click', () => { const app = window.designExplorer; if (app) clearHighlight(app); });
    ['hl-mode', 'hl-n'].forEach(id => document.getElementById(id)?.addEventListener('change', () => { const app = window.designExplorer; if (HL.active && app) setHighlight(app, document.getElementById('hl-mode').value, parseInt(document.getElementById('hl-n').value || '1', 10)); }));
    const sel = document.getElementById('sens-output');
    if (sel) sel.addEventListener('change', e => { S.out = e.target.value; render(S.rows, { inputs: S.inputs, outputs: S.outputs, customLabels: S.labels, customTickLabels: S.ticks }); });
    const png = (id, name) => Plotly.downloadImage(id, { format: document.getElementById('export-format')?.value || 'png', scale: parseInt(document.getElementById('export-scale')?.value || '4', 10), filename: name });
    document.getElementById('btn-export-tornado')?.addEventListener('click', () => png('tornado-chart', 'tornado_isolated_effects'));
    document.getElementById('btn-export-returns')?.addEventListener('click', () => png('returns-chart', 'diminishing_returns'));
    // join the app's "Export All Charts" action
    document.getElementById('btn-export-all-charts')?.addEventListener('click', () => {
      if (document.getElementById('tornado-chart')?.data) setTimeout(() => png('tornado-chart', 'tornado_isolated_effects'), 2600);
      if (document.getElementById('returns-chart')?.data) setTimeout(() => png('returns-chart', 'diminishing_returns'), 3400);
    });
    // re-theme when accent colour changes
    document.getElementById('accent-color')?.addEventListener('input', () => { if (S.rows) render(S.rows, { inputs: S.inputs, outputs: S.outputs, customLabels: S.labels, customTickLabels: S.ticks }); });
  }
  // app.js instantiates window.designExplorer inside a window 'DOMContentLoaded' listener; document-level
  // listeners fire earlier, so register on window too and retry briefly if the app is still booting.
  function boot(){ let tries=0; const t=()=>{ if(window.designExplorer||tries++>20){ wire(); } else setTimeout(t,50); }; t(); }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot); else boot();
  window.BBBSensitivity = { render, pairedEffects, highlight: (mode, n) => setHighlight(window.designExplorer, mode, n), clearHighlight: () => clearHighlight(window.designExplorer) };
})();
