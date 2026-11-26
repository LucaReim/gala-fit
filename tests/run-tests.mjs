// Unit tests for the parser and the file-name value reader.
// Run with:  node tests/run-tests.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSpectrum, detectUnit } from '../js/parser.js';
import { valueFromFileName } from '../js/series.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, 'data');
let failed = 0, passed = 0;
function check(name, cond, info = '') {
  if (cond) { passed++; } else { failed++; console.log(`FAIL ${name} ${info}`); }
}
const read = (f) => readFileSync(join(dataDir, f), 'utf8');

// 1) All variants of LR23_5s.txt parse to identical numbers.
const ref = parseSpectrum(read('LR23_5s.txt'));
check('reference length', ref.x.length === 201, ref.x.length);
check('reference has negatives', ref.y.some((v) => v < 0));
check('reference unit', detectUnit(ref.x).unit === 'nm');
for (const f of readdirSync(dataDir).filter((f) => f.startsWith('variant_'))) {
  const p = parseSpectrum(read(f));
  const same = p.x.length === ref.x.length &&
    p.x.every((v, i) => v === ref.x[i] && p.y[i] === ref.y[i]);
  check(`variant ${f} identical`, same, `(sep=${p.separator}, n=${p.x.length})`);
}

// 2) Bad files give clear errors.
for (const [f, re] of [['bad_ambiguous_comma.csv', /ambiguous/], ['bad_no_data.txt', /No data/]]) {
  let msg = '';
  try { parseSpectrum(read(f)); } catch (e) { msg = e.message; }
  check(`error for ${f}`, re.test(msg), msg);
}

// 3) Repository example files.
const ex1 = parseSpectrum(readFileSync(join(here, '../data/examplePL.csv'), 'utf8'));
check('examplePL.csv header skipped', ex1.skippedLines === 1 && ex1.x[0] === 471);
const ex2 = parseSpectrum(readFileSync(join(here, '../data/examplePL_subpopulation.txt'), 'utf8'));
check('examplePL_subpopulation rows', ex2.x.length === 161);

// 4) Small cases.
const unsorted = parseSpectrum('3.0 1\n2.0 2\n' + Array.from({ length: 30 }, (_, i) => `${2.1 + i * 0.01} 5`).join('\n'));
check('sorted ascending', unsorted.x.every((v, i, a) => i === 0 || v >= a[i - 1]));
check('eV detection', detectUnit(unsorted.x).unit === 'eV');
const extra = parseSpectrum('x,y,z\n' + Array.from({ length: 25 }, (_, i) => `${400 + i},${i}.5,99`).join('\n'));
check('extra column ignored', extra.y[3] === 3.5 && extra.extraColumns);
check('few points warning', parseSpectrum('1;2\n3;4').warnings.length === 1);

// 5) File-name values.
const cases = [
  ['LR23_5s.txt', 'time', 5], ['sample_0.5 s.csv', 'time', 0.5], ['run_10min.txt', 'time', 600],
  ['A_2h.dat', 'time', 7200], ['x_1,5s.txt', 'time', 1.5], ['B_250ms.txt', 'time', 0.25],
  ['CsPbBr3_300K.txt', 'temperature', 300], ['77 K.txt', 'temperature', 77],
  ['T_25C.txt', 'temperature', 298.15], ['T_25°C.txt', 'temperature', 298.15],
  ['np_4.2k.csv', 'temperature', 4.2],
];
for (const [name, kind, expected] of cases) {
  const r = valueFromFileName(name, kind);
  check(`name ${name}`, r && Math.abs(r.value - expected) < 1e-9, JSON.stringify(r));
}
for (const [name, kind] of [['5samples.txt', 'time'], ['LR23.txt', 'time'], ['LR23_5s.txt', 'temperature']]) {
  check(`no value in ${name} (${kind})`, valueFromFileName(name, kind) === null,
    JSON.stringify(valueFromFileName(name, kind)));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
