// Run: node tests/parametric.test.js
const C = require('../js/parametric.js');
const assert = require('assert');
let pass = 0; const ok = (c, m) => { assert(c, m); pass++; console.log('  ok', m); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// 1. Full 2x3 grid, out = 2*A + 5*B  ->  impact(A) = 2*(30-10) = 40, impact(B) = 5*(3-1) = 10
const rows = ['in:A (ft),in:B,out:Y (kBtu/sf·yr)'];
[10, 20, 30].forEach(a => [1, 2, 3].forEach(b => rows.push(`${a},${b},${2 * a + 5 * b}`)));
let ds = C.buildDataset(rows.join('\n'));
let g = C.globalSensitivity(ds, 0);
console.log('Full grid');
ok(near(g[0].impact, 40), `impact A = ${g[0].impact} (slope 2 x span 20 = 40)`);
ok(near(g[1].impact, 10), `impact B = ${g[1].impact} (slope 5 x span 2 = 10)`);
ok(g[0].used === 3 && g[0].skipped === 0, 'A uses 3 of 3 groups');
ok(g[0].direction === 'raises' && ds.inputs[0].levels[g[0].best].text === '10', 'A: higher raises Y, best 10');
ok(ds.outputs[0].unit === 'kBtu/sf·yr' && ds.outputs[0].label === 'Y (kBtu/sf·yr)', 'units kept, prefix stripped');
let l = C.localSensitivity(ds, 0, [1, 1]);
ok(near(l[0].range, 40) && near(l[1].range, 10), 'local ranges 40 / 10 at centre');

// 2. Remove two runs
console.log('Missing runs');
const miss = rows.filter((_, i) => i !== 2 && i !== 6);
ds = C.buildDataset(miss.join('\n'));
g = C.globalSensitivity(ds, 0);
ok(ds.N === 7, '7 runs');
ok(g.every(x => isFinite(x.impact)), 'no NaN impacts: ' + g.map(x => x.impact).join(', '));
ok(g.some(x => x.partial > 0 || x.skipped > 0), 'incomplete groups reported: ' + JSON.stringify(g.map(x => ({ used: x.used, partial: x.partial, skipped: x.skipped }))));
ok(C.findRun(ds, [0, 1]) === -1, 'missing combination returns -1');
l = C.localSensitivity(ds, 0, [0, 1]);
ok(l.every(x => x.pts.every(p => isFinite(p.v))), 'local skips missing combos');

// 3. Text input, numbers with %, BOM, quotes
console.log('Text input');
const t = '﻿in:Option,in:WWR (%),out:EUI (kBtu/sf·yr),img\n' +
  'Option 2,20%,50,a.png\nOption 1,20%,40,b.png\nOption 2,40%,58,"c,1.png"\nOption 1,40%,48,d.png\n';
ds = C.buildDataset(t);
ok(!ds.inputs[0].numeric && ds.inputs[0].levels.map(x => x.text).join('/') === 'Option 1/Option 2', 'numbered text levels sort by their number');
ok(ds.inputs[1].numeric && ds.inputs[1].levels.map(x => x.value).join('/') === '20/40', '20%/40% parsed as numeric, sorted');
g = C.globalSensitivity(ds, 0);
ok(near(g[0].impact, 10) && ds.inputs[0].levels[g[0].best].text === 'Option 1', 'text input impact 10, best Option 1');
ok(ds.imgs[2] === 'c,1.png', 'quoted field with comma');

// 4. Numeric sort
ds = C.buildDataset('in:R,out:Y\n30,1\n13,2\n20,3\n');
ok(ds.inputs[0].levels.map(x => x.value).join(',') === '13,20,30', 'numeric levels ascending');

// 5. Large file
console.log('3,000 runs');
const big = ['in:A,in:B,in:C,in:D,in:E,out:Y (kWh),out:Z (kW)'];
for (let a = 0; a < 10; a++) for (let b = 0; b < 5; b++) for (let c = 0; c < 6; c++) for (let d = 0; d < 2; d++) for (let e = 0; e < 5; e++)
  big.push([a, b, c, d, e, a + 2 * b + c * c + d + Math.random(), a * b].join(','));
let t0 = Date.now(); ds = C.buildDataset(big.join('\n')); g = C.globalSensitivity(ds, 0);
const dt = Date.now() - t0;
ok(ds.N === 3000 && dt < 1500, `3000 runs parsed + global sensitivity in ${dt} ms`);
t0 = Date.now(); for (let i = 0; i < 100; i++) C.localSensitivity(ds, 0, [i % 10, 1, 2, 1, 3]);
ok(Date.now() - t0 < 200, `100 local sensitivities in ${Date.now() - t0} ms`);

// 6. Plain text levels keep file order
ds = C.buildDataset('in:Glazing,out:Y\nTriple,1\nDouble,2\nQuad,3\n');
ok(ds.inputs[0].levels.map(x => x.text).join('/') === 'Triple/Double/Quad', 'plain text levels keep file order');

// 7. Failed simulations (-999) are missing, not real values
console.log('Failed runs and other file formats');
const f = ['in:Wall,in:Roof,out:Gross_EUI,out:Heating_Load'];
['R 20', 'R 30', 'R 40'].forEach((w, i) => ['R-30', 'R-50', 'R-70'].forEach((r, j) => f.push([w, r, 50 - 2 * i - j, 20 - i].join(','))));
f[5] = 'R 30,R-50,-999,-999';
ds = C.buildDataset(f.join('\n'));
ok(ds.outputs[0].min === 44 && ds.outputs[0].max === 50, `-999 ignored for axis range (${ds.outputs[0].min}..${ds.outputs[0].max})`);
ok(ds.failed.size === 1 && ds.failedCells === 2, 'failed run counted');
ok(ds.inputs[0].levels.map(x => x.text).join('/') === 'R 20/R 30/R 40' && ds.inputs[1].levels.map(x => x.text).join('/') === 'R-30/R-50/R-70', 'R-values sorted by number, "R-30" not read as negative');
g = C.globalSensitivity(ds, 0);
ok(g.every(x => isFinite(x.impact)) && g[0].direction === 'lowers', 'sensitivity skips the failed run; R-value direction works');
const nt = C.normalizeCSV(f.join('\n')).text;
ok(!/-999/.test(nt) && nt.split('\n')[5] === 'R 30,R-50,,', 'normalised text blanks failure codes for the other charts');
ds = C.buildDataset('in:A,out:Y,out:Note\n1,5,ok\n2,#DIV/0!,ok\n3,NaN,bad\n4,7,ok\n');
ok(ds.outputs.length === 1 && ds.skippedOutputs[0] === 'Note' && isNaN(ds.outputs[0].values[1]) && isNaN(ds.outputs[0].values[2]), 'error text -> missing; text-only output skipped');

// 8. Semicolon CSV with decimal commas (European Excel)
ds = C.buildDataset('in:WWR (%);in:Glazing;out:EUI (kBtu/sf·yr)\n20;Double;54,7\n40;Double;58,2\n20;Triple;51,0\n40;Triple;"55,5"\n');
ok(ds.inputs.length === 2 && ds.outputs[0].values[0] === 54.7 && ds.outputs[0].values[3] === 55.5, 'semicolon file with decimal commas');
console.log(`\n${pass} checks passed`);
