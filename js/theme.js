/* ============================================================
   BBB Design Explorer - shared theme and colour settings
   - Theme presets (light, dark, ocean, forest, sunset, architect)
   - Custom colours from any <input data-color-var="--name">
   - Saved in localStorage, shared by every page
   - Fires a 'bbb-themechange' event on document so charts can redraw
   Custom colours are set on <body> (inline style), so they win over
   the body.theme-* rules; setting them on <html> was ignored by every
   theme except Light.
   ============================================================ */
(function () {
    'use strict';
    const THEMES = ['light', 'dark', 'ocean', 'forest', 'sunset', 'architect'];
    const DARK = ['dark', 'ocean', 'forest', 'sunset'];
    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
        del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
    };
    let colors = {};
    try { colors = JSON.parse(store.get('bbb-colors') || '{}') || {}; } catch (e) { colors = {}; }
    let theme = store.get('bbb-theme');
    if (!THEMES.includes(theme)) theme = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';

    let pending = 0;
    function notify() {
        if (pending) return;
        pending = requestAnimationFrame(() => { pending = 0; document.dispatchEvent(new CustomEvent('bbb-themechange', { detail: { theme, colors } })); });
    }
    function toHex(c) {
        c = String(c).trim();
        if (/^#[0-9a-f]{6}$/i.test(c)) return c;
        if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map(x => x + x).join('');
        const m = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
        return m ? '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('') : null;
    }
    /* Show the colour each picker currently resolves to. */
    function syncInputs() {
        const cs = getComputedStyle(document.body);
        document.querySelectorAll('input[data-color-var]').forEach(inp => {
            const hex = toHex(cs.getPropertyValue(inp.dataset.colorVar.split(/\s+/)[0]));
            if (hex) inp.value = hex;
        });
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
        const t = document.getElementById('btn-theme');
        if (t) t.textContent = isDark() ? 'Light' : 'Dark';
    }
    function applyColors() {
        Object.entries(colors).forEach(([k, v]) => document.body.style.setProperty(k, v));
    }
    function setTheme(name, keepColors) {
        if (!THEMES.includes(name)) name = 'light';
        theme = name;
        THEMES.forEach(t => document.body.classList.remove('theme-' + t));
        if (name !== 'light') document.body.classList.add('theme-' + name);
        if (!keepColors) clearColors(true);
        store.set('bbb-theme', name);
        syncInputs(); notify();
    }
    function setColor(name, value) {
        colors[name] = value;
        document.body.style.setProperty(name, value);
        if (name === '--accent') document.body.style.setProperty('--accent-hover', value);
        store.set('bbb-colors', JSON.stringify(colors));
        notify();
    }
    function clearColors(silent) {
        Object.keys(colors).forEach(k => document.body.style.removeProperty(k));
        document.body.style.removeProperty('--accent-hover');
        colors = {};
        store.del('bbb-colors');
        if (!silent) { syncInputs(); notify(); }
    }
    function isDark() { return DARK.includes(theme); }

    function wire() {
        document.querySelectorAll('input[data-color-var]').forEach(inp => {
            // data-color-var may list several variables, e.g. "--bg-primary --bg-secondary"
            inp.addEventListener('input', () => inp.dataset.colorVar.split(/\s+/).forEach(v => setColor(v, inp.value)));
        });
        document.querySelectorAll('[data-color-var-range]').forEach(inp => {
            const saved = colors[inp.dataset.colorVarRange];
            if (saved) inp.value = saved;
            inp.addEventListener('input', () => setColor(inp.dataset.colorVarRange, inp.value));
        });
        document.querySelectorAll('.theme-btn').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.theme)));
        const t = document.getElementById('btn-theme');
        if (t) t.addEventListener('click', () => setTheme(isDark() ? 'light' : 'dark'));
        const r = document.getElementById('btn-reset-colors');
        if (r) r.addEventListener('click', () => clearColors());
        // Generic open / close for side panels: [data-panel-open="id"], [data-panel-close]
        const overlay = document.getElementById('panel-overlay');
        document.querySelectorAll('[data-panel-open]').forEach(btn => btn.addEventListener('click', () => {
            const p = document.getElementById(btn.dataset.panelOpen); if (!p) return;
            const open = !p.classList.contains('open');
            document.querySelectorAll('.side-panel.open').forEach(x => x.classList.remove('open'));
            p.classList.toggle('open', open);
            if (overlay) overlay.classList.toggle('hidden', !open);
        }));
        const closeAll = () => { document.querySelectorAll('.side-panel.open').forEach(x => x.classList.remove('open')); if (overlay) overlay.classList.add('hidden'); };
        document.querySelectorAll('[data-panel-close]').forEach(b => b.addEventListener('click', closeAll));
        if (overlay && !overlay.dataset.ownedByApp) overlay.addEventListener('click', closeAll);
        syncInputs();
    }

    // Apply immediately (script sits at the end of <body>) to avoid a flash of the wrong theme.
    THEMES.forEach(t => document.body.classList.remove('theme-' + t));
    if (theme !== 'light') document.body.classList.add('theme-' + theme);
    applyColors();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

    /* ---------- shared chart palette ----------
       Every chart on the page (canvas explorer and Plotly charts) takes its colours from here,
       so one change in Color Settings or the theme recolours everything the same way:
         run  : every run / bar / line that is "just data"
         sel  : the selected run (orange) - only ever used for the selection
         near : runs or bars that change one input (teal)
         grey : filtered out / minor
         seq  : sequential scale for "Color by", built from the run colour (no orange, so the
                selection always stands out)                                                      */
    function hexToRgb(h) { h = toHex(h) || '#888888'; const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    function mix(a, b, t) { const x = hexToRgb(a), y = hexToRgb(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
    function palette() {
        const cs = getComputedStyle(document.body);
        const get = (n, fb) => (cs.getPropertyValue(n).trim() || fb);
        const run = toHex(get('--pe-run', '#5b7fbf')) || '#5b7fbf', bg = toHex(get('--bg-secondary', '#ffffff')) || '#ffffff', ink = toHex(get('--text-primary', '#0e0e0e')) || '#0e0e0e';
        const p = {
            run, bg, ink,
            sel: get('--pe-sel', '#e8710a'), near: get('--pe-near', '#12a39a'), grey: get('--pe-grey', '#b9b9b9'),
            muted: get('--text-muted', '#8a8a8a'), border: get('--border', '#e4e4e4'),
            runMid: mix(run, bg, 0.3),
            mix
        };
        p.seq = [[0, mix(bg, run, 0.22)], [0.5, run], [1, mix(run, ink, 0.6)]];
        return p;
    }

    window.BBBTheme = { setTheme, setColor, clearColors, isDark, palette, get theme() { return theme; }, get colors() { return Object.assign({}, colors); }, syncInputs };
})();
