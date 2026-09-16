import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ANCHORS, SCORE_WEIGHT, unmeasured } from '../../src/scripts/climate-engine/dc-urs.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BENGALURU = ['indiranagar', 'mg-road', 'whitefield'];
const SERVED = 'public/heat-map/data/bengaluru-dc-urs-inputs.json';
const text = (p) => readFile(join(ROOT, p), 'utf8');
const json = async (p) => JSON.parse(await text(p));

test('the served Bengaluru inputs are the committed source, byte for byte', async () => {
  assert.equal(await text(SERVED), await text('data/bangalore/dc-urs-inputs.json'));
});

test('every Bengaluru ward carries all twelve indicators, with provenance and in-range values', async () => {
  const { wards } = await json(SERVED);
  assert.deepEqual(Object.keys(wards).sort(), [...BENGALURU].sort());
  const range = {
    lstDayC: [0, 70], lstNightC: [0, 50], ruralBaseC: [0, 70], popDensity: [0, 200_000],
    far: [0, 10], socioVuln: [0, 10], fvc: [0, 1], canopyFrac: [0, 1], ndviMean: [-1, 1],
    ndviStd: [0, 1], albedo: [0, 1], distCoolM: [0, 5000],
  };
  for (const w of BENGALURU) {
    assert.deepEqual(Object.keys(wards[w]).sort(), Object.keys(SCORE_WEIGHT).sort(), `${w}: field set`);
    for (const [k, f] of Object.entries(wards[w])) {
      assert.ok(['measured', 'modelled', 'estimated', 'placeholder'].includes(f.source), `${w}.${k}: ${f.source}`);
      assert.ok(Number.isFinite(f.value) && f.value >= range[k][0] && f.value <= range[k][1],
        `${w}.${k}: ${f.value} out of range`);
      if (f.source === 'placeholder') assert.equal(f.value, 0, `${w}.${k}: a placeholder sits at 0`);
      else assert.ok(f.vintage && f.cite, `${w}.${k}: a measured value needs a vintage and a cite`);
    }
  }
});

test('heat vulnerability ships unmeasured, and the chip counts its full weight', async () => {
  const { wards } = await json(SERVED);
  for (const w of BENGALURU) {
    assert.equal(wards[w].socioVuln.source, 'placeholder', `${w}: socioVuln`);
    const gap = unmeasured(wards[w]);
    assert.ok(gap.fields.includes('socioVuln'), `${w}: chip must name socioVuln`);
    assert.ok(gap.points >= 8.75 - 1e-9, `${w}: ${gap.points} pts`);
  }
});

test('a measured heat island discloses its effective baseline', async () => {
  const { wards } = await json(SERVED);
  for (const w of BENGALURU) {
    const rb = wards[w].ruralBaseC;
    if (rb.source !== 'placeholder') assert.match(rb.cite, /EFFECTIVE/, `${w}: baseline construction`);
  }
});

test('the Python clamp report reads the same anchors as the engine', async () => {
  const py = await text('scripts/_dcurs_blr.py');
  const start = py.indexOf('ANCHORS: dict[str, float] = {');
  const block = py.slice(start, py.indexOf('}', start));
  const pairs = [...block.matchAll(/"(\w+)":\s*([\d_.]+)/g)];
  assert.ok(pairs.length >= 8, 'no anchors parsed from _dcurs_blr.py');
  for (const [, k, v] of pairs) assert.equal(Number(v.replaceAll('_', '')), ANCHORS[k], k);
});

test("Kolkata's inputs file gains no Bengaluru ward", async () => {
  const { wards } = await json('public/heat-map/data/dc-urs-inputs.json');
  assert.deepEqual(Object.keys(wards).sort(), ['ballygunge', 'barrackpore', 'baruipur']);
});
