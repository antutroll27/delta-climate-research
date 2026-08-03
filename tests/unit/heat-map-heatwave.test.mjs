import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { selectPhase, assertPhaseSelectLogic } from '../../src/scripts/climate-engine/phase-select.ts';
import { shiftAirPreservingVapour, wetBulbC, assertSkyLogic } from '../../src/scripts/climate-engine/sky.ts';
import { currentParams, PATH_DELTA } from '../../src/scripts/climate-engine/heat-map-model.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const P99 = 38.4;
const LIVE = { tAir: 30, rh: 96, wind: 3, cloud: 20, feels: 40 };

test('the modules self-check', () => {
  assertPhaseSelectLogic();
  assertSkyLogic();
});

test('an unrecognised button changes nothing — the blind cast is gone', () => {
  // The handler used to do `p as 'peak' | 'night'` on a raw dataset string, so a
  // typo'd or renamed data-p flowed straight into the physics with no error.
  for (const bad of ['retained', '', 'Peak', 'undefined', 'now ']) {
    assert.equal(selectPhase(bad, P99), null, `"${bad}" must select nothing`);
  }
});

/** Source with comments removed, so a tripwire greps CODE and not prose. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('no cast survives in the app, and the phase union stays binary', async () => {
  const app = await readFile(join(ROOT, 'src/scripts/climate-engine/heat-map-app.ts'), 'utf8');
  // Comments are stripped first: the handler's comment deliberately NAMES the
  // cast it replaced, and a tripwire that fires on its own explanation would be
  // deleted rather than heeded.
  assert.ok(!/as\s*'peak'\s*\|\s*'night'/.test(stripComments(app)),
    'a phase cast reappeared in heat-map-app.ts — route it through selectPhase instead');

  // Widening `phase` to a third value would mean edits at FIVE consumers to say
  // one thing: the ACCURACY lookup, bandLabel, the DC-URS day/night split, the
  // Compare deep-link, and the phase label. Heatwave deliberately rides peak.
  const model = await readFile(join(ROOT, 'src/scripts/climate-engine/heat-map-model.ts'), 'utf8');
  assert.match(model, /phase: 'peak' \| 'night'/,
    'ScenarioState.phase widened — heatwave is a forcing override, not a phase');
  const accuracy = await readFile(join(ROOT, 'src/scripts/climate-engine/accuracy.ts'), 'utf8');
  assert.match(accuracy, /Record<'peak' \| 'night'/,
    'ACCURACY widened — a new phase needs its own measured band, not a borrowed one');
});

test('live mode and a forced temperature are never both on', () => {
  for (const id of ['now', 'peak', 'night', 'heatwave']) {
    const sel = selectPhase(id, P99);
    assert.ok(sel, id);
    assert.ok(!(sel.sunNow !== null && sel.heatTairC !== null),
      `${id} claims to be "now" AND to force a temperature that is not now`);
    assert.ok(sel.phase === 'peak' || sel.phase === 'night', `${id} widened the union`);
  }
});

test('heatwave is inert when its data failed to load', () => {
  assert.equal(selectPhase('heatwave', null), null);
  assert.deepEqual(selectPhase('peak', null), { phase: 'peak', sunNow: null, heatTairC: null });
});

test('the override moves the air and nothing else', () => {
  const iv = { trees: 0, roof: 0, parks: 0, facades: 0 };
  const plain = currentParams({ live: LIVE, phase: 'peak', path: '2025', iv });
  const heat = currentParams({ live: LIVE, phase: 'peak', path: '2025', iv, heatTairC: P99 });
  assert.equal(heat.tAir, P99);
  assert.equal(heat.sun, plain.sun, 'sun changed');
  assert.equal(heat.wind, plain.wind, 'wind changed');
  assert.equal(heat.Q, plain.Q, 'anthropogenic heat changed');
  assert.equal(heat.store, plain.store, 'storage changed');
});

test('the warming pathway composes on top of the override', () => {
  // If the override replaced the whole expression instead of the observation,
  // #segPath would silently do nothing whenever heatwave was on.
  const iv = { trees: 0, roof: 0, parks: 0, facades: 0 };
  const hot = currentParams({ live: LIVE, phase: 'peak', path: 'ssp585', iv, heatTairC: P99 });
  assert.equal(hot.tAir, P99 + PATH_DELTA.ssp585);
});

test('the heatwave atmosphere is one that can actually exist', () => {
  // 35 °C wet-bulb is the limit of human thermoregulation and has never been
  // recorded. Holding RELATIVE humidity while adding 8 K produces 37.9 °C on a
  // muggy Kolkata day — the model would then faithfully simulate an impossible
  // world. Preserving vapour pressure is what keeps the scenario severe but real.
  for (const [t, rh] of [[30, 96], [32.5, 76], [31.4, 60], [28, 88], [35, 40]]) {
    const shifted = shiftAirPreservingVapour(t, rh, P99);
    assert.ok(shifted < rh, `warming ${t}→${P99} should lower RH, got ${shifted.toFixed(0)}%`);
    const wb = wetBulbC(P99, shifted);
    assert.ok(wb < 35, `wet-bulb ${wb.toFixed(1)} °C at ${t}/${rh} — past survivability`);
  }
  assert.ok(wetBulbC(P99, 96) > 35, 'the RH-preserving alternative should be demonstrably impossible');
});

test('the served percentile artefact is sourced and ordered', async () => {
  const d = JSON.parse(await readFile(
    join(ROOT, 'public/heat-map/data/heatwave-percentiles.json'), 'utf8'));
  assert.ok(d.source && d.licence, 'provenance travels with the data, not just the UI');
  assert.equal(d.method, 'linear', 'percentile method must be recorded — it moves p99');
  const t = d.tmaxC;
  assert.ok(t.p50 < t.p95 && t.p95 < t.p99 && t.p99 <= t.max, 'percentiles out of order');
  assert.ok(t.p99 > 35 && t.p99 < 45, `p99 ${t.p99} °C is not a plausible Kolkata heatwave`);
  assert.ok(d.rows.usable / d.rows.total > 0.99, 'too much of the record was discarded');
});
