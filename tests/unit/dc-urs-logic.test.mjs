import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertDcUrsLogic, dcUrs, GOLDEN } from '../../src/scripts/climate-engine/dc-urs.ts';
import {
  applyScenario, areaScale, assertScenarioLogic, REFERENCE_WARD_M, scenarioLst,
} from '../../src/scripts/climate-engine/dc-urs-scenario.ts';
import {
  applyInterventions, currentParams, eqMean, eqMeanFromMeans, layerMeans,
} from '../../src/scripts/climate-engine/heat-map-model.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';

/* THE ENGINE'S OWN SELF-CHECKS, WHICH NOTHING CALLED. assertDcUrsLogic and
   assertScenarioLogic were written, exported and never run by any test: a gate
   that cannot fail because it never executes. */
test('the DC-URS engine self-check holds', () => { assertDcUrsLogic(); });
test('the scenario self-check holds on every golden ward', () => {
  for (const g of GOLDEN) assertScenarioLogic(g.inputs);
});

const IV = { trees: 30, roof: 40, parks: 4, facades: 5 };
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

/* A 1400 m ward is the reference the gains were sized for, so it must be scored
   exactly as before the area scaling existed. Values are pinned by hand from
   SCENARIO, not recomputed by the code under test. */
test('a 1400 m ward moves exactly as before', () => {
  const base = GOLDEN[0].inputs;
  assert.deepEqual(applyScenario(base, IV, undefined, REFERENCE_WARD_M), applyScenario(base, IV));
  const r = applyScenario(base, IV);
  close(r.inputs.fvc.value, 0.12 + 0.6 * 0.12 + 0.4 * 0.06 + (5 / 15) * 0.01, 'fvc');
  close(r.inputs.albedo.value, 0.15 + 0.4 * 0.10, 'albedo');
  close(r.inputs.distCoolM.value, 800 - 0.4 * 220, 'distCoolM');
});

/* Bengaluru's wards are 2800 m, four times the area: the same package of trees,
   parks and roofs moves a ward mean a quarter as far. */
test('a 2800 m ward moves a quarter as far', () => {
  const base = GOLDEN[0].inputs;
  assert.equal(areaScale(2800), 0.25);
  const r = applyScenario(base, IV, undefined, 2800);
  close(r.inputs.fvc.value, 0.12 + 0.25 * (0.6 * 0.12 + 0.4 * 0.06 + (5 / 15) * 0.01), 'fvc');
  close(r.inputs.albedo.value, 0.15 + 0.25 * 0.4 * 0.10, 'albedo');
  close(r.inputs.distCoolM.value, 800 - 0.25 * 0.4 * 220, 'distCoolM');
  assert.equal(r.active, true, 'a scaled plan is still an active plan');
});

test('a ward size that is not positive is refused, not scored', () => {
  assert.throws(() => areaScale(0), RangeError);
  assert.throws(() => areaScale(Number.NaN), RangeError);
});

/* ── THE SCENARIO LST: measured, moved by the plan ─────────────────────────────
   Before `scenarioLst`, the page handed DC-URS the simulator's ward-mean surface
   temperature whenever a slider moved. It replaced MG Road's measured 29.49 °C day
   LST with a 35-41 °C simulated noon mean, and 25 trees read "-6.6 pts from this
   plan". These cases use MG Road's SERVED inputs row and Bengaluru's real scope
   constants through the real `currentParams`, so the forcing is the page's own.
   Only the layers are synthetic: a small square grid, which is all
   `applyInterventions` and `eqMean` need. */
const MG_KEY = 'in/bengaluru/mg-road';
const MG_SIZE_M = 2800;
const NO_IV = { trees: 0, roof: 0, parks: 0, facades: 0 };

async function mgRoad() {
  const raw = JSON.parse(await readFile(
    new URL('../../public/heat-map/data/bengaluru-dc-urs-inputs.json', import.meta.url), 'utf8'));
  const base = raw.wards['mg-road'];
  assert.equal(base?.lstDayC?.source, 'measured',
    'the served MG Road row has no measured day LST -- these cases would test nothing');
  return base;
}

/** A 24 x 24 ward: mixed built fabric, some ground vegetation, a street corridor. */
function syntheticWard() {
  const n = 24, N = n * n;
  const layers = {
    albedo: new Float32Array(N).fill(0.15), veg: new Float32Array(N),
    built: new Float32Array(N), water: new Float32Array(N),
  };
  const corridor = [];
  for (let i = 0; i < N; i++) {
    layers.built[i] = i % 3 === 0 ? 0.7 : 0.3;
    layers.veg[i] = i % 5 === 0 ? 0.4 : 0.1;
    if (layers.built[i] < 0.55) corridor.push(i);
  }
  const cellM = MG_SIZE_M / n;
  const spatial = {
    corridorSorted: Int32Array.from(corridor), corridorKm: 10, parkCenters: [[12, 12]],
    roofM2: 1, facadeM2: 1, cellArea: cellM * cellM, cellM,
  };
  return { layers, spatial };
}

/** The page's forcing for a phase, and the same forcing with the sliders at zero. */
function forcing(phase, iv, path) {
  const { climate } = resolve(MG_KEY);
  const state = { live: null, phase, path, iv, climate, clock: { month: 5, hour: 13 } };
  return { after: currentParams(state), before: currentParams({ ...state, iv: NO_IV }) };
}

const lstOf = (lst) => ('dayC' in lst ? lst.dayC : lst.nightC);
const firstPath = () => Object.keys(resolve(MG_KEY).climate.pathDelta)[0] ?? '';

test('no plan leaves the measured LST exactly as it was, in both phases', async () => {
  const base = await mgRoad();
  const { layers } = syntheticWard();
  for (const phase of ['peak', 'night']) {
    const p = forcing(phase, NO_IV, firstPath());
    const m = layerMeans(layers);
    const lst = scenarioLst(base, { means: m, params: p.before }, { means: m, params: p.after }, phase);
    if (phase === 'night') assert.deepEqual(lst, { nightC: base.lstNightC.value });
    else assert.deepEqual(lst, { dayC: base.lstDayC.value });
  }
});

test('planting trees cools the measured LST and never lowers the score', async () => {
  const base = await mgRoad();
  const { layers, spatial } = syntheticWard();
  const iv = { ...NO_IV, trees: 25 };
  const planted = applyInterventions(layers, iv, spatial, resolve(MG_KEY).climate.parkRadiusM);
  for (const phase of ['peak', 'night']) {
    const p = forcing(phase, iv, firstPath());
    const lst = scenarioLst(base,
      { means: layerMeans(layers), params: p.before },
      { means: layerMeans(planted), params: p.after }, phase);
    const measured = phase === 'night' ? base.lstNightC.value : base.lstDayC.value;
    assert.ok(lstOf(lst) < measured,
      `${phase}: 25 trees put the LST at ${lstOf(lst)} against a measured ${measured}`);
    const scored = dcUrs(applyScenario(base, iv, lst, MG_SIZE_M).inputs);
    assert.ok(scored >= dcUrs(base),
      `${phase}: 25 trees scored ${scored} against a no-plan ${dcUrs(base)}`);
  }
});

test('green facades reach the LST through Q, so the no-plan side must not carry them', async () => {
  /* Facades change no layer. If both sides were solved under the facade-cut Q the
     difference would be exactly zero and the slider would do nothing to heat. */
  const base = await mgRoad();
  const { layers } = syntheticWard();
  const iv = { ...NO_IV, facades: 15 };
  const p = forcing('peak', iv, firstPath());
  const m = layerMeans(layers);
  const lst = scenarioLst(base, { means: m, params: p.before }, { means: m, params: p.after }, 'peak');
  assert.ok(lst.dayC < base.lstDayC.value,
    `facades at full travel left the day LST at ${lst.dayC} against ${base.lstDayC.value}`);
});

test('a hotter air mass is not scored as the plan: the forcing cancels out of the change', async () => {
  /* EXACT IN ALGEBRA. `tAir` and `tSky` enter `eqMean` only through a per-cell term
     identical on both sides, so they cancel; what remains is float64 rounding over a
     576-cell mean of ~40 °C terms, orders of magnitude inside 1e-9 K. The pathway
     case goes through the real `currentParams`, which moves tAir and tSky together
     and leaves humidity alone. (A heatwave does move humidity, and therefore `L`,
     which legitimately changes how much the trees cool -- it is not tested here for
     cancellation because it should not cancel.) */
  const base = await mgRoad();
  const { layers, spatial } = syntheticWard();
  const iv = { trees: 25, roof: 40, parks: 3, facades: 5 };
  const planted = applyInterventions(layers, iv, spatial, resolve(MG_KEY).climate.parkRadiusM);
  const delta = (before, after) =>
    scenarioLst(base,
      { means: layerMeans(layers), params: before },
      { means: layerMeans(planted), params: after }, 'peak').dayC
    - base.lstDayC.value;

  const p = forcing('peak', iv, firstPath());
  const shift = (q) => ({ ...q, tAir: q.tAir + 4.1, tSky: q.tSky + 4.1 });
  const cool = delta(p.before, p.after), hot = delta(shift(p.before), shift(p.after));
  assert.ok(cool < 0, `the plan should cool; its change is ${cool}`);
  assert.ok(Math.abs(hot - cool) < 1e-9,
    `+4.1 K of air moved the plan's change from ${cool} to ${hot}`);

  const paths = Object.entries(resolve(MG_KEY).climate.pathDelta).sort((a, b) => a[1] - b[1]);
  assert.ok(paths.length >= 2 && paths.at(-1)[1] > paths[0][1],
    `Bengaluru's pathway table has no warming spread to test (${JSON.stringify(paths)})`);
  const lo = forcing('peak', iv, paths[0][0]), hi = forcing('peak', iv, paths.at(-1)[0]);
  assert.ok(hi.after.tAir > lo.after.tAir, 'the warmer pathway did not warm the air');
  assert.ok(Math.abs(delta(hi.before, hi.after) - delta(lo.before, lo.after)) < 1e-9,
    `pathway ${paths.at(-1)[0]} moved the plan's change from `
    + `${delta(lo.before, lo.after)} to ${delta(hi.before, hi.after)}`);
});

/* ── THE ALGEBRA IS THE LOOP ───────────────────────────────────────────────────
   `eqMeanFromMeans` is what makes a stats tick constant-time (see its own note, and
   `refreshScenarioMeans` in heat-map-app.ts). It is a SECOND expression for a number
   the per-cell loop already computes, and the two agree only because `eqCell` is
   affine in albedo, built and veg. Should that stop holding — a term dropped, a
   nonlinearity added on one side — every resilience score on the page moves, and not
   one test that mentions the score would fail. So the two are compared head to head,
   over the same grid and the same forcing, at both phases and with a plan applied. */
test('eqMeanFromMeans reproduces the per-cell loop exactly', () => {
  const { layers, spatial } = syntheticWard();
  const { climate } = resolve(MG_KEY);
  const planted = applyInterventions(
    layers, { ...NO_IV, trees: 25, roof: 60 }, spatial, climate.parkRadiusM);
  for (const phase of ['peak', 'night']) {
    const p = currentParams({
      live: null, phase, path: firstPath(), iv: NO_IV, climate, clock: { month: 5, hour: 13 },
    });
    for (const [what, grid] of [['base', layers], ['planted', planted]]) {
      const loop = eqMean(grid, p), algebra = eqMeanFromMeans(layerMeans(grid), p);
      assert.ok(Math.abs(loop - algebra) < 1e-9,
        `${phase}/${what}: the loop says ${loop}, the algebra says ${algebra}`);
    }
  }
  /* The two grids must actually differ, or the comparison above would hold just as
     well for a function that ignored the vegetation it was handed. */
  assert.notEqual(layerMeans(layers).veg, layerMeans(planted).veg,
    'planting moved no vegetation mean -- this case is not testing what it says');
});
