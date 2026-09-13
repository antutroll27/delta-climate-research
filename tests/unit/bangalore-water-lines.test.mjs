import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { rasterizeWardWater } from '../../src/scripts/climate-engine/ward-raster.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = async (f) => JSON.parse(await readFile(join(ROOT, 'public/heat-map/data', f), 'utf8'));
const BENGALURU = ['indiranagar', 'mg-road', 'whitefield'];

/* MG Road's open-line and covered counts, as measured by the 2026-09-14 re-scan
   (Task 7 Step 4: 37 lines, 15 covered, so 22 open). A regression to dropping
   lines, or to drawing culverts, moves these. */
const MG_ROAD = { lines: 22, coveredDropped: 15 };

test('Bengaluru water artefacts carry open centrelines and their own field size', async () => {
  for (const ward of BENGALURU) {
    const d = await read(`${ward}-water.json`);
    assert.equal(d.fieldM, 2800, `${ward}: fieldM`);
    assert.ok(Array.isArray(d.lines), `${ward}: lines missing`);
    assert.ok(Number.isInteger(d.coveredDropped) && d.coveredDropped >= 0, `${ward}: coveredDropped`);
    for (const line of d.lines) {
      assert.ok(['drain', 'stream', 'river', 'canal'].includes(line.k), `${ward}: unexpected class ${line.k}`);
      assert.ok(line.p.length >= 4 && line.p.length % 2 === 0, `${ward}: a line needs two points`);
    }
  }
  const mg = await read('mg-road-water.json');
  assert.equal(mg.lines.length, MG_ROAD.lines, 'MG Road open lines');
  assert.equal(mg.coveredDropped, MG_ROAD.coveredDropped, 'MG Road covered reaches');
});

test('Kolkata water artefacts are untouched by the line contract', async () => {
  for (const ward of ['ballygunge', 'baruipur', 'barrackpore']) {
    const d = await read(`${ward}-water.json`);
    assert.equal(d.lines, undefined, `${ward} gained lines`);
    assert.equal(d.fieldM, undefined, `${ward} gained fieldM`);
  }
});

test('water lines never reach the heat model', async () => {
  const d = await read('mg-road-water.json');
  const withLines = rasterizeWardWater(d, 2800, 384);
  const polysOnly = rasterizeWardWater({ polys: d.polys }, 2800, 384);
  assert.deepEqual([...withLines], [...polysOnly], 'the solver raster changed when lines were present');
});

import { waterFieldM } from '../../src/scripts/climate-engine/water-depth.ts';

test('the depth field takes the artefact’s own size, and falls back to Kolkata’s', () => {
  assert.equal(waterFieldM({ polys: [], fieldM: 2800 }), 2800);
  assert.equal(waterFieldM({ polys: [] }), 1520, 'absent → Kolkata clip box');
  assert.equal(waterFieldM({ polys: [], fieldM: 0 }), 1520, 'zero → fallback');
  assert.equal(waterFieldM({ polys: [], fieldM: Number.NaN }), 1520, 'NaN → fallback');
});
