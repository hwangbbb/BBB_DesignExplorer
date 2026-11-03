/* ============================================================
   BBB Design Explorer - animated GIF encoder (no dependencies)
   - Palette: 255 colours by popularity over sampled frames, with the
     chart's key colours pinned so they stay exact; index 255 = transparent
   - Frames after the first only store the pixels that changed (cropped to
     the changed box, the rest transparent), which keeps chart GIFs small
   - Standard GIF89a + NETSCAPE2.0 loop, LZW with 12-bit codes
   Exposed as window.BBBGif (and module.exports for tests).
   ============================================================ */
(function (root) {
    'use strict';
    const TRANSPARENT = 255;

    /* ---------- byte buffer ---------- */
    function ByteWriter() { this.buf = new Uint8Array(1 << 20); this.len = 0; }
    ByteWriter.prototype.ensure = function (n) {
        if (this.len + n <= this.buf.length) return;
        let size = this.buf.length * 2; while (size < this.len + n) size *= 2;
        const b = new Uint8Array(size); b.set(this.buf.subarray(0, this.len)); this.buf = b;
    };
    ByteWriter.prototype.byte = function (v) { this.ensure(1); this.buf[this.len++] = v & 255; };
    ByteWriter.prototype.u16 = function (v) { this.byte(v); this.byte(v >> 8); };
    ByteWriter.prototype.str = function (s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); };
    ByteWriter.prototype.bytes = function (a, n) { this.ensure(n); this.buf.set(a.subarray(0, n), this.len); this.len += n; };
    ByteWriter.prototype.result = function () { return this.buf.slice(0, this.len); };

    /* ---------- LZW (GIF variant), min code size 8 ----------
       Dictionary: key = prefix code (12 bit) << 8 | pixel, stored in typed arrays. A generation
       stamp marks live entries, so clearing the dictionary costs nothing. */
    const DICT_CODE = new Int16Array(1 << 20), DICT_GEN = new Int32Array(1 << 20);
    let dictGen = 0;
    function lzwEncode(out, pixels) {
        const MIN = 8, CLEAR = 1 << MIN, EOI = CLEAR + 1, MAXCODES = 4096;
        let nBits = MIN + 1, maxcode = (1 << nBits) - 1, next = EOI + 1, clearFlag = false;
        let gen = ++dictGen;
        // sub-block packing
        const block = new Uint8Array(255); let blen = 0;
        let acc = 0, accBits = 0;
        const flushBlock = () => { if (blen) { out.byte(blen); out.bytes(block, blen); blen = 0; } };
        const putByte = b => { block[blen++] = b; if (blen === 255) flushBlock(); };
        const output = code => {
            acc |= code << accBits; accBits += nBits;
            while (accBits >= 8) { putByte(acc & 255); acc >>>= 8; accBits -= 8; }
            // grow the code size exactly when the decoder will
            if (clearFlag) { nBits = MIN + 1; maxcode = (1 << nBits) - 1; clearFlag = false; }
            else if (next > maxcode) { nBits++; maxcode = nBits === 12 ? MAXCODES : (1 << nBits) - 1; }
        };
        out.byte(MIN);
        output(CLEAR);
        let prefix = pixels[0];
        for (let i = 1; i < pixels.length; i++) {
            const k = pixels[i], key = (prefix << 8) | k;
            if (DICT_GEN[key] === gen) { prefix = DICT_CODE[key]; continue; }
            output(prefix);
            if (next < MAXCODES) { DICT_GEN[key] = gen; DICT_CODE[key] = next++; }
            else { gen = ++dictGen; next = EOI + 1; clearFlag = true; output(CLEAR); }
            prefix = k;
        }
        output(prefix);
        output(EOI);
        if (accBits > 0) putByte(acc & 255);
        flushBlock();
        out.byte(0); // block terminator
    }

    /* ---------- palette ---------- */
    function hexToRgb(h) {
        h = String(h || '').trim();
        let m = h.match(/^#([0-9a-f]{6})$/i);
        if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
        m = h.match(/^#([0-9a-f]{3})$/i);
        if (m) return m[1].split('').map(c => parseInt(c + c, 16));
        m = h.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
        return m ? [+m[1], +m[2], +m[3]] : null;
    }
    /* Popularity palette from RGBA samples; `pinned` colours (hex strings) are kept exact. */
    function buildPalette(samples, pinned) {
        const sums = new Float64Array(32768 * 3), counts = new Uint32Array(32768);
        samples.forEach(px => {
            for (let i = 0; i < px.length; i += 8) {           // every second pixel is plenty
                const r = px[i], g = px[i + 1], b = px[i + 2], key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
                counts[key]++; sums[key * 3] += r; sums[key * 3 + 1] += g; sums[key * 3 + 2] += b;
            }
        });
        const pal = [];
        const seen = new Set();
        (pinned || []).forEach(c => {
            const rgb = hexToRgb(c); if (!rgb) return;
            const k = rgb.join(','); if (seen.has(k) || pal.length >= 255) return;
            seen.add(k); pal.push(rgb);
        });
        const order = [];
        for (let k = 0; k < 32768; k++) if (counts[k]) order.push(k);
        order.sort((a, b) => counts[b] - counts[a]);
        for (const k of order) {
            if (pal.length >= 255) break;
            const n = counts[k], rgb = [Math.round(sums[k * 3] / n), Math.round(sums[k * 3 + 1] / n), Math.round(sums[k * 3 + 2] / n)];
            const s = rgb.join(','); if (seen.has(s)) continue;
            seen.add(s); pal.push(rgb);
        }
        while (pal.length < 256) pal.push([0, 0, 0]);         // index 255 = transparent slot
        return pal;
    }
    function makeMapper(pal) {
        const cache = new Int16Array(32768).fill(-1);
        return function (r, g, b) {
            const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
            let idx = cache[key];
            if (idx >= 0) return idx;
            let best = 0, bd = Infinity;
            for (let i = 0; i < 255; i++) {
                const p = pal[i], dr = p[0] - r, dg = p[1] - g, db = p[2] - b, d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
                if (d < bd) { bd = d; best = i; if (!d) break; }
            }
            cache[key] = best; return best;
        };
    }

    /* ---------- writer ---------- */
    function GifWriter(width, height, palette, opts) {
        opts = opts || {};
        this.w = width; this.h = height; this.pal = palette; this.map = makeMapper(palette);
        this.prev = null; this.frames = 0;
        const o = this.out = new ByteWriter();
        o.str('GIF89a'); o.u16(width); o.u16(height);
        o.byte(0xF7); o.byte(0); o.byte(0);                    // global colour table, 256 entries
        for (let i = 0; i < 256; i++) { const c = palette[i]; o.byte(c[0]); o.byte(c[1]); o.byte(c[2]); }
        o.byte(0x21); o.byte(0xFF); o.byte(11); o.str('NETSCAPE2.0'); o.byte(3); o.byte(1); o.u16(opts.loop == null ? 0 : opts.loop); o.byte(0);
    }
    /* rgba: Uint8ClampedArray (width*height*4); delay in milliseconds */
    GifWriter.prototype.addFrame = function (rgba, delayMs) {
        const w = this.w, h = this.h, n = w * h, idx = new Uint8Array(n), map = this.map;
        for (let i = 0, j = 0; i < n; i++, j += 4) idx[i] = map(rgba[j], rgba[j + 1], rgba[j + 2]);
        let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1, data = idx, trans = false;
        if (this.prev) {
            // only the pixels that changed: crop to their box, everything else transparent
            const p = this.prev; x0 = w; y0 = h; x1 = -1; y1 = -1;
            for (let y = 0; y < h; y++) for (let x = 0, i = y * w; x < w; x++, i++) if (idx[i] !== p[i]) {
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
            if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }    // identical frame: one transparent pixel
            const cw = x1 - x0 + 1, ch = y1 - y0 + 1; data = new Uint8Array(cw * ch); trans = true;
            for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
                const i = (y + y0) * w + x + x0;
                data[y * cw + x] = idx[i] === p[i] ? TRANSPARENT : idx[i];
            }
        }
        const o = this.out, delay = Math.max(2, Math.round((delayMs || 100) / 10));
        o.byte(0x21); o.byte(0xF9); o.byte(4);
        o.byte((1 << 2) | (trans ? 1 : 0));                    // disposal 1 = keep, transparency flag
        o.u16(delay); o.byte(TRANSPARENT); o.byte(0);
        o.byte(0x2C); o.u16(x0); o.u16(y0); o.u16(x1 - x0 + 1); o.u16(y1 - y0 + 1); o.byte(0);
        lzwEncode(o, data);
        this.prev = idx; this.frames++;
    };
    GifWriter.prototype.finish = function () { this.out.byte(0x3B); return this.out.result(); };

    const API = { GifWriter, buildPalette, lzwEncode, hexToRgb };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    root.BBBGif = API;
})(typeof window !== 'undefined' ? window : globalThis);
