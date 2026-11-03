// Run: node tests/gif.test.js [out-dir]   (writes test GIFs; tests/gif_check.py decodes them with Pillow)
const G = require('../js/gif.js');
const fs = require('fs'), path = require('path');
const dir = process.argv[2] || path.join(__dirname, '..', 'tests', 'out');
fs.mkdirSync(dir, { recursive: true });
function frame(w, h, fn) { const a = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x, y), i = (y * w + x) * 4; a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; a[i + 3] = 255; } return a; }
let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const PALETTE = [[255, 255, 255], [232, 113, 10], [91, 127, 191], [14, 14, 14], [18, 163, 154]];
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const w = 301, h = 157;                                    // odd sizes on purpose
const frames = [
  frame(w, h, () => PALETTE[0]),                           // flat
  frame(w, h, (x, y) => (x > 40 && x < 90 && y > 30 && y < 60) ? PALETTE[1] : PALETTE[0]),  // small change
  frame(w, h, () => PALETTE[Math.floor(rnd() * 5)]),       // noise: many LZW dictionary resets
  frame(w, h, () => PALETTE[Math.floor(rnd() * 5)]),
  frame(w, h, () => PALETTE[Math.floor(rnd() * 5)]),
];
frames.push(frames[4]);                                    // identical frame
const pal = G.buildPalette(frames, PALETTE.map(hex));
const gw = new G.GifWriter(w, h, pal, { loop: 0 });
frames.forEach((f, i) => gw.addFrame(f, i === 5 ? 1500 : 100));
const bytes = gw.finish();
fs.writeFileSync(path.join(dir, 'test.gif'), bytes);
// expected composited frames as raw RGB for the Python check
fs.writeFileSync(path.join(dir, 'expected.bin'), Buffer.concat(frames.map(f => { const b = Buffer.alloc(w * h * 3); for (let i = 0, j = 0; i < w * h; i++, j += 4) { b[i * 3] = f[j]; b[i * 3 + 1] = f[j + 1]; b[i * 3 + 2] = f[j + 2]; } return b; })));
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ w, h, n: frames.length, delays: [100, 100, 100, 100, 100, 1500] }));
console.log('wrote', bytes.length, 'bytes,', frames.length, 'frames');
