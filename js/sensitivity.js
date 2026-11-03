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
  // Same palette as the Parametric Explorer (js/theme.js): run blue for strong effects, a lighter
  // blue for moderate, grey for minor. Orange stays reserved for the selected run.
  function pal() { return window.BBBTheme && window.BBBTheme.palette ? window.BBBTheme.palette() : { run: tok('--pe-run', '#5b7fbf'), runMid: '#a6b8dc', grey: tok('--pe-grey', '#b9b9b9'), ink: tok('--text-primary', '#0e0e0e') }; }
  function colorFor(span, maxSpan) {
    const t = maxSpan ? span / maxSpan : 0, P = pal();
    if (t > 0.6) return P.run;
    if (t > 0.2) return P.runMid;
    return P.grey;
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

  // ---------- figure renderer: publication style (Nature figure guidelines) ----------
  // Small multiples drawn as plain SVG so the export is true vector:
  //   Arial/Helvetica, 5-7 pt type at print size, 0.5-0.75 pt lines, open axes with outward ticks,
  //   no gridlines, bold lowercase panel letters, one shared y-scale so panels compare directly.
  const MM = 72 / 25.4;                                   // points per millimetre
  const WIDTHS = { single: 89, mid: 120, double: 183 };   // Nature column widths (mm)
  const FONT = 'Arial, Helvetica, "Helvetica Neue", sans-serif';
  const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tw = (s, fs) => String(s).length * fs * 0.55;     // text width estimate for Arial
  function fit(s, fs, w) { s = String(s); if (tw(s, fs) <= w) return s; let t = s; while (t.length > 1 && tw(t + '…', fs) > w) t = t.slice(0, -1); return t + '…'; }
  function wrap2(s, fs, w) {                               // up to two lines, then ellipsis
    s = String(s); if (tw(s, fs) <= w) return [s];
    const words = s.split(/\s+/); let a = '';
    while (words.length && tw((a ? a + ' ' : '') + words[0], fs) <= w) a = (a ? a + ' ' : '') + words.shift();
    if (!a) return [fit(s, fs, w)];
    return [a, fit(words.join(' '), fs, w)].filter(Boolean);
  }
  function niceTicks(lo, hi, count) {
    if (!(hi > lo)) return [lo];
    const step0 = (hi - lo) / Math.max(1, count - 1), mag = Math.pow(10, Math.floor(Math.log10(step0))), err = step0 / mag;
    const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag, out = [];
    for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
    return out;
  }
  const tickFmt = (v, step) => { const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2; return (v < 0 ? '−' : '') + Math.abs(v).toFixed(d); };
  const signFmt = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmtN(Math.abs(v));

  /* eff: paired effects; o: { W, print, cols } -> { svg, W, H } (units: px on screen, pt when print) */
  function returnsFigure(eff, unit, outName, o) {
    const print = !!o.print;
    const P = print ? { run: '#3f63a8', runMid: '#7d97cc', grey: '#9e9e9e', ink: '#000000', muted: '#4d4d4d', faint: '#8c8c8c', bg: '#ffffff' }
      : (() => { const p = pal(); return { run: p.run, runMid: p.runMid, grey: p.grey, ink: tok('--text-primary', '#0e0e0e'), muted: tok('--text-muted', '#8a8a8a'), faint: tok('--border-strong', '#c9c9c9'), bg: tok('--bg-secondary', '#ffffff') }; })();
    const f = print ? { tick: 6, label: 7, title: 7, letter: 8, step: 5.5, lw: 0.75, axis: 0.5, r: 2.1, tick_len: 2.5 }
      : { tick: 11, label: 12, title: 12.5, letter: 13, step: 10, lw: 1.6, axis: 1, r: 4, tick_len: 4 };
    const vars = eff.filter(e => e.ordered.length > 1);
    if (!vars.length) return null;
    const W = o.W, n = vars.length;
    const maxCols = o.cols || Math.max(1, Math.min(n, Math.floor(W / (print ? 120 : 250))));
    const rows = Math.ceil(n / maxCols), cols = Math.ceil(n / rows);
    const maxSpan = Math.max(...vars.map(e => e.span), 1e-9);
    vars.forEach(e => { e._st = stepStats(e); });
    // shared y range (Δ vs worst level; ≤ 0 means the output drops = improves for energy)
    let yLo = Math.min(0, ...vars.flatMap(e => e._st.ys)), yHi = Math.max(0, ...vars.flatMap(e => e._st.ys));
    const yt = niceTicks(yLo, yHi, 4), ystep = yt.length > 1 ? yt[1] - yt[0] : 1;
    yLo = Math.min(yLo, yt[0]); yHi = Math.max(yHi, yt[yt.length - 1]);
    const yPad = (yHi - yLo) * 0.06; yHi += yPad; yLo -= yPad * 0.3;
    const yLabW = Math.max(...yt.map(v => tw(tickFmt(v, ystep), f.tick))) + f.tick_len + 3;
    const mL = f.label * 1.8 + yLabW, mR = print ? 4 : 8, gapX = print ? 12 : 26;
    const pw = (W - mL - mR - gapX * (cols - 1)) / cols;
    const ph = Math.max(print ? 52 : 120, Math.min(print ? 90 : 210, pw * 0.62));
    const titleH = f.title * 1.25 + f.tick * 1.9, xlabH = f.tick * 3.6, rowGap = print ? 6 : 14;
    const rowH = titleH + ph + xlabH + rowGap;
    const H = rows * rowH + (print ? 2 : 4);
    const out = [];
    const T = (x, y, s, fs, opt = {}) => out.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${fs}"${opt.anchor ? ` text-anchor="${opt.anchor}"` : ''}${opt.weight ? ` font-weight="${opt.weight}"` : ''}${opt.style ? ` font-style="${opt.style}"` : ''} fill="${opt.fill || P.ink}"${opt.extra || ''}>${xmlEsc(s)}</text>`);
    const Lp = (x1, y1, x2, y2, stroke, w, dash) => out.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
    if (print) out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
    const yOf = (v, y0) => y0 + ph - (v - yLo) / (yHi - yLo) * ph;
    vars.forEach((e, i) => {
      const st = e._st, col = i % cols, row = Math.floor(i / cols);
      const x0 = mL + col * (pw + gapX), y0 = row * rowH + titleH;
      const color = (() => { const t = e.span / maxSpan; return t > 0.6 ? P.run : t > 0.2 ? P.runMid : P.grey; })();
      const L = e.ordered.length;
      let xOf;
      if (st.numeric) {
        const lo = Math.min(...st.xv), hi = Math.max(...st.xv), pad = (hi - lo) * 0.1 || 1;
        const a = e._reversed ? hi + pad : lo - pad, b = e._reversed ? lo - pad : hi + pad;
        xOf = k => x0 + (st.xv[k] - a) / (b - a) * pw;
      } else xOf = k => x0 + pw * (0.1 + 0.8 * (L === 1 ? 0.5 : k / (L - 1)));
      // panel letter in the margin, title aligned with the axis, statistics on the line below
      const letter = String.fromCharCode(97 + i), ty = y0 - titleH + f.title;
      T(col === 0 ? f.label * 1.75 : x0 - gapX + 1, ty, letter, f.letter, { weight: 700 });   // col 0: just right of the y-axis title
      T(x0, ty, fit(e.name, f.title, pw), f.title, { weight: 600 });
      T(x0, ty + f.tick * 1.35, `Δ = ${fmtN(e.span)}${unit ? ' ' + unit : ''} · n = ${e.pairs} pairs`, f.tick, { fill: P.muted });
      // axes: open box (left + bottom), outward ticks
      Lp(x0, y0, x0, y0 + ph, P.ink, f.axis); Lp(x0, y0 + ph, x0 + pw, y0 + ph, P.ink, f.axis);
      yt.forEach(v => {
        const y = yOf(v, y0); if (y < y0 - 0.5 || y > y0 + ph + 0.5) return;
        Lp(x0 - f.tick_len, y, x0, y, P.ink, f.axis);
        if (col === 0) T(x0 - f.tick_len - 2, y + f.tick * 0.35, tickFmt(v, ystep), f.tick, { anchor: 'end' });
      });
      if (yLo < 0 && yHi > 0) Lp(x0, yOf(0, y0), x0 + pw, yOf(0, y0), P.faint, f.axis, print ? '1.5 1.5' : '3 3');
      // x ticks and level labels (worst → best)
      const slot = pw / Math.max(1, L) * (st.numeric ? 1.6 : 1.15);
      e.ordered.forEach((lab, k) => {
        const x = xOf(k);
        Lp(x, y0 + ph, x, y0 + ph + f.tick_len, P.ink, f.axis);
        wrap2(lab, f.tick, Math.max(slot, f.tick * 3)).forEach((ln, j) => {
          const half = tw(ln, f.tick) / 2, cx = Math.max(half + 1, Math.min(W - half - 1, x));   // never past the figure edge
          T(cx, y0 + ph + f.tick_len + f.tick * (1.05 + j * 1.15), ln, f.tick, { anchor: 'middle' });
        });
      });
      // knee: dashed line; the label goes on the side of the panel away from the data
      if (st.knee !== null) {
        const kk = e.ordered.indexOf(st.knee), kx = xOf(kk), ky = yOf(st.ys[kk], y0);
        Lp(kx, y0, kx, y0 + ph, P.muted, f.axis, print ? '2 1.5' : '4 3');
        T(kx + 2, ky < y0 + ph / 2 ? y0 + ph - 3 : y0 + f.step + 1, 'knee', f.step, { style: 'italic', fill: P.muted });
      }
      // data: line, markers, step change at each segment
      const pts = st.ys.map((v, k) => [xOf(k), yOf(v, y0)]);
      out.push(`<polyline points="${pts.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ')}" fill="none" stroke="${color}" stroke-width="${f.lw}" stroke-linejoin="round" stroke-linecap="round"/>`);
      // step change: offset perpendicular to the segment (above it), with a halo so lines never cut the number
      st.steps.forEach(s => {
        const k = s.k, step = st.ys[k] - st.ys[k - 1];
        const dx = pts[k][0] - pts[k - 1][0], dy = pts[k][1] - pts[k - 1][1], len = Math.hypot(dx, dy) || 1;
        // below the segment: a descending curve leaves that side empty, and it keeps clear of the zero line
        let nx = dy / len, ny = -dx / len; if (ny < 0) { nx = -nx; ny = -ny; }
        const off = f.step * 0.9;
        const mx = (pts[k][0] + pts[k - 1][0]) / 2 + nx * off, my = (pts[k][1] + pts[k - 1][1]) / 2 + ny * off + f.step * 0.55;
        const small = Math.abs(step) < 0.02 * maxSpan;
        T(mx, my, signFmt(step), f.step, { anchor: 'middle', fill: small ? P.faint : P.muted,
          extra: ` stroke="${P.bg}" stroke-width="${print ? 1.6 : 3}" stroke-linejoin="round" paint-order="stroke"` });
      });
      pts.forEach((p, k) => out.push(`<circle cx="${p[0].toFixed(2)}" cy="${p[1].toFixed(2)}" r="${f.r}" fill="${color}" stroke="${P.bg}" stroke-width="${f.axis}"><title>${xmlEsc(`${e.name}: ${e.ordered[k]}  Δ ${signFmt(st.ys[k])}${unit ? ' ' + unit : ''} vs worst level`)}</title></circle>`));
    });
    // one y-axis title for the whole figure (panels share the scale)
    {
      const cy = (rows * rowH - rowGap) / 2 + titleH / 2, tx = f.label * 0.95;
      const yTitle = `Δ ${outName} relative to worst level${unit ? ` (${unit})` : ''}`;
      T(tx, cy, fit(yTitle, f.label, rows * rowH - rowGap), f.label, { anchor: 'middle', extra: ` transform="rotate(-90 ${tx.toFixed(2)} ${cy.toFixed(2)})"` });
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" ${print ? `width="${(W / MM).toFixed(1)}mm" height="${(H / MM).toFixed(1)}mm"` : `width="${W}" height="${H.toFixed(0)}"`} font-family='${FONT}' role="img" aria-label="Diminishing returns within each variable">${out.join('')}</svg>`;
    return { svg, W, H, vars };
  }

  function returnsCaption(vars, unit, outName) {
    const notes = vars.filter(e => e.ordered.length > 2).map(e => {
      const st = e._st, per = st.numeric ? 'per unit' : 'per step';
      if (st.knee !== null) return `${e.name} shows a knee at ${st.knee}`;
      if (st.linear) return `${e.name} is close to linear (gain ${per}: ${st.steps.map(s => fmtN(s.perUnit)).join(', ')})`;
      return null;
    }).filter(Boolean);
    return `Diminishing returns within each design variable. Each panel shows the mean change in ${outName}${unit ? ` (${unit})` : ''} `
      + `relative to the worst-performing level of that variable, from paired comparisons in which all other variables are held at each tested combination `
      + `(n = number of pairs). Levels are ordered from worst (left) to best (right); numbers on the segments give the change for each step. `
      + `Numeric variables are plotted to scale. Dashed lines mark a knee, where the gain per unit falls below half that of the previous step. `
      + `Δ is the total span from worst to best level. Panels share one y-axis.` + (notes.length ? ' ' + notes.join('; ') + '.' : '');
  }

  function drawReturns(eff, unit, outName) {
    const el = document.getElementById('returns-chart'); if (!el) return;
    if (window.Plotly && el.data) { try { Plotly.purge(el); } catch (e) { /* not a Plotly chart any more */ } }
    const W = Math.max(320, (el.clientWidth || 940) - 40);   // minus the container's side padding
    const fig = returnsFigure(eff, unit, outName, { W });
    S.fig = { eff, unit, outName };
    if (!fig) { el.innerHTML = '<p class="setting-hint">Every input has a single tested level, so there is nothing to compare.</p>'; return; }
    el.innerHTML = fig.svg;
    const expl = document.getElementById('returns-explain');
    if (expl) expl.textContent = returnsCaption(fig.vars, unit, outName);
  }

  /* Export: format 'svg' | 'png300' | 'png600'; width 'single' | 'mid' | 'double' (mm presets) */
  function exportReturns(format, width) {
    if (!S.fig) return;
    format = format || document.getElementById('returns-format')?.value || 'svg';
    width = width || document.getElementById('returns-width')?.value || 'double';
    const mm = WIDTHS[width] || WIDTHS.double, Wpt = mm * MM;
    const cols = width === 'single' ? 2 : width === 'mid' ? 3 : 4;
    const fig = returnsFigure(S.fig.eff, S.fig.unit, S.fig.outName, { W: Wpt, print: true, cols });
    if (!fig) return;
    const name = `diminishing-returns-${String(S.fig.outName).replace(/[^\w.-]+/g, '_')}-${mm}mm`;
    const save = (blob, ext) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name}.${ext}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); };
    if (format === 'svg') { save(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + fig.svg], { type: 'image/svg+xml' }), 'svg'); return Promise.resolve(fig); }
    const dpi = format === 'png600' ? 600 : 300;
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = Math.round(fig.W / 72 * dpi); c.height = Math.round(fig.H / 72 * dpi);
        const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => { save(b, 'png'); res(Object.assign({ px: [c.width, c.height] }, fig)); }, 'image/png');
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fig.svg);
    });
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
    const sel = document.getElementById('returns-output');
    if (sel) sel.innerHTML = det.outputs.map(o => `<option value="${o}" ${o === S.out ? 'selected' : ''}>${S.labels[o] || clean(o)}</option>`).join('');
    // unit from the column header, e.g. "out:EUI (kBtu/sf·yr)" -> "kBtu/sf·yr"; never guessed
    const outLabel = S.labels[S.out] || clean(S.out);
    const um = outLabel.match(/^(.*?)\s*[\(\[]([^\)\]]*)[\)\]]\s*$/);
    const unit = um ? um[2].trim() : '', outName = um ? (um[1] || outLabel) : outLabel;
    const eff = pairedEffects(rows, det.inputs, S.out).map(e => {
      // apply the app's axis-label and tick-label overrides so renamed labels flow through
      const tl = S.ticks[e.key] || {};
      const map = L => tl[L] || L;
      const delta = {}; Object.keys(e.delta).forEach(L => delta[map(L)] = e.delta[L]);
      return { ...e, name: S.labels[e.key] || e.name, rawOrdered: e.ordered, ordered: e.ordered.map(map), delta, ref: map(e.ref), best: map(e.best) };
    });
    // unhide first: Plotly sizes 'responsive' charts from the container, which is 0 wide while hidden
    document.querySelectorAll('#tornado-section,#returns-section').forEach(x => x.classList.remove('hidden'));
    drawTornado(eff, unit); drawReturns(eff, unit, outName);
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
      marker: { symbol: 'circle-open', size: 20, color: pal().ink, line: { width: 2.5 } }   // ink ring: orange is the selected run
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
    el.innerHTML = `<div style="color:var(--text-muted);margin-bottom:2px">${HL.active.mode === 'low' ? 'Lowest' : 'Highest'} ${HL.active.idx.length} of ${dm.rowCount} runs, ringed on the scatter plot:</div>` + lines.join('') + more;
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
    const sel = document.getElementById('returns-output');
    if (sel) sel.addEventListener('change', e => { S.out = e.target.value; render(S.rows, { inputs: S.inputs, outputs: S.outputs, customLabels: S.labels, customTickLabels: S.ticks }); });
    const png = (id, name) => Plotly.downloadImage(id, { format: document.getElementById('export-format')?.value || 'png', scale: parseInt(document.getElementById('export-scale')?.value || '4', 10), filename: name });
    document.getElementById('btn-export-tornado')?.addEventListener('click', () => png('tornado-chart', 'tornado_isolated_effects'));
    document.getElementById('btn-export-returns')?.addEventListener('click', () => exportReturns());
    document.getElementById('btn-copy-returns-caption')?.addEventListener('click', () => {
      const t = document.getElementById('returns-explain')?.textContent || '';
      const done = () => { const b = document.getElementById('btn-copy-returns-caption'); if (b) { b.textContent = 'Caption copied'; setTimeout(() => b.textContent = 'Copy caption', 1600); } };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(done); else { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { } ta.remove(); done(); }
    });
    // redraw the on-screen figure to the new width (debounced)
    let rsT = 0; window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => { if (S.fig) drawReturns(S.fig.eff, S.fig.unit, S.fig.outName); }, 150); });
    // join the app's "Export All Charts" action
    document.getElementById('btn-export-all-charts')?.addEventListener('click', () => {
      if (document.getElementById('tornado-chart')?.data) setTimeout(() => png('tornado-chart', 'tornado_isolated_effects'), 2600);
      if (S.fig) setTimeout(() => exportReturns(), 3400);
    });
    // colours follow js/theme.js: combined.js re-renders on 'bbb-themechange'
  }
  // app.js instantiates window.designExplorer inside a window 'DOMContentLoaded' listener; document-level
  // listeners fire earlier, so register on window too and retry briefly if the app is still booting.
  function boot(){ let tries=0; const t=()=>{ if(window.designExplorer||tries++>20){ wire(); } else setTimeout(t,50); }; t(); }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot); else boot();
  window.BBBSensitivity = { render, pairedEffects, exportReturns, returnsFigure: (o) => S.fig && returnsFigure(S.fig.eff, S.fig.unit, S.fig.outName, o), highlight: (mode, n) => setHighlight(window.designExplorer, mode, n), clearHighlight: () => clearHighlight(window.designExplorer) };
})();
