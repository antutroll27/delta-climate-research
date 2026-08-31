import assert from 'node:assert/strict';
import test from 'node:test';

import { assertCapsLogic, resolveHeatCaps } from '../../src/scripts/climate-engine/caps.ts';
import { applyInterventions, SIM_N } from '../../src/scripts/climate-engine/heat-map-model.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { coverageToInterventions, deliveredQuantities } from '../../src/scripts/climate-engine/scenario/coverage.ts';
import { parsePairedScenario, serializePairedScenario } from '../../src/scripts/climate-engine/scenario/scenario-url.ts';
import { DEFAULT_PAIRED_SCENARIO, normalizeCoverage } from '../../src/scripts/climate-engine/scenario/scenario-state.ts';
import { fromLegacyWard, toLegacyWard } from '../../src/scripts/climate-engine/scope/legacy.ts';
import { areaKeysInCity, nextDistinctArea, nextDistinctKey } from '../../src/scripts/climate-engine/scope/registry.ts';
import { TsHeatSim } from '../../src/scripts/climate-engine/sim-ts.ts';
import { DEFAULT_PARAMS } from '../../src/scripts/climate-engine/types.ts';
import { rasterizeWardBuilt, rasterWardBase } from '../../src/scripts/climate-engine/ward-raster.ts';

test('coverage controls convert once into the existing model units', () => {
  const coverage = normalizeCoverage({ trees: 55, roofs: 65, facades: 35 });
  const interventions = coverageToInterventions(coverage);
  assert.ok(Math.abs(interventions.trees - 27.5) < 1e-9);
  assert.equal(interventions.roof, 65);
  assert.ok(Math.abs(interventions.facades - 5.25) < 1e-9);
});

test('parks is retired from Compare and can never be applied from input', () => {
  // The lever has no control, so no request — URL, default, or otherwise — may
  // reintroduce it. A non-zero value here would be an invisible intervention.
  assert.equal(normalizeCoverage({ parks: 3 }).parks, 0);
  assert.equal(normalizeCoverage({}).parks, 0);
  assert.equal(coverageToInterventions(normalizeCoverage({ parks: 4 })).parks, 0);
  const legacy = parsePairedScenario('?a=ballygunge&b=baruipur&parks=3.5');
  assert.equal(legacy.coverage.parks, 0);
  assert.ok(!serializePairedScenario(legacy).includes('parks'));
});

test('park coverage retains a fractional final patch rather than rounding upward', () => {
  const count = SIM_N * SIM_N;
  const base = {
    albedo: new Float32Array(count).fill(0.12),
    veg: new Float32Array(count),
    built: new Float32Array(count),
    water: new Float32Array(count),
  };
  const spatial = {
    corridorSorted: new Int32Array(), corridorKm: 0,
    parkCenters: [[40, 40], [120, 120]], roofM2: 0, facadeM2: 0,
    cellArea: 53.1, cellM: 7.29,
  };
  /* The park radius is the CITY's, read from the registry — the blob centre this
     asserts on is radius-independent, but the argument must still be the real one. */
  const layers = applyInterventions(base, { trees: 0, roof: 0, parks: 1.5, facades: 0 }, spatial,
    resolve('in/kolkata/ballygunge').climate.parkRadiusM);
  const first = 40 * SIM_N + 40;
  const second = 120 * SIM_N + 120;
  assert.ok(Math.abs(layers.veg[first] - 0.9) < 1e-6);
  assert.ok(Math.abs(layers.veg[second] - 0.45) < 1e-6);
  assert.ok(Math.abs(layers.albedo[second] - 0.16) < 1e-6);
});

// parks is retired from the Compare UI, but its delivered-quantity maths is kept
// for the day the control returns — exercise it directly so it cannot rot.
test('delivered park area reports the requested fractional area', () => {
  const quantities = deliveredQuantities({ trees: 55, roofs: 0, parks: 3, facades: 0 }, {
    corridorSorted: new Int32Array(100), corridorKm: 0,
    parkCenters: Array.from({ length: 10 }, (_, index) => [index * 10, index * 10]),
    roofM2: 500_000, facadeM2: 0, cellArea: 53.1, cellM: 7.29,
  });
  assert.equal(quantities.requestedParkHa, 5.88);
  assert.equal(quantities.appliedParkHa, 5.88);
  assert.equal(quantities.treeCorridorCells, 55);
});

test('all device tiers retain the canonical analytical grid', () => {
  const unavailable = { webgpu: false, floatRenderTargets: false };
  assert.equal(resolveHeatCaps(2, true, unavailable, '').grid, 192);
  assert.equal(resolveHeatCaps(1, true, unavailable, '').grid, 192);
  assert.equal(resolveHeatCaps(0, true, unavailable, '').grid, 192);
});

test('WebGPU alone does not select the WebGL2-only GPU solver', () => {
  const webGpuOnly = { webgpu: true, floatRenderTargets: false };
  assert.equal(resolveHeatCaps(2, true, webGpuOnly, '').backend, 'ts');
  assert.equal(resolveHeatCaps(2, true, { webgpu: true, floatRenderTargets: true }, '').backend, 'gpu');
});

/* caps.ts carries its own runnable self-check. Nothing executed it, so when the
   backend rule was narrowed to WebGL2 float render targets the check kept
   asserting the old rule and failed against the module it lives in — silently,
   because `npm run verify` never ran it. Executing it here is what makes the
   invariant a gate rather than a comment. */
test('the capability module satisfies its own backend invariants', () => {
  assert.doesNotThrow(() => assertCapsLogic());
});

test('footprint rasterisation is deterministic and unions subcell coverage', () => {
  const ward = {
    center: [0, 0],
    sizeM: 4,
    count: 3,
    b: [
      [8, -1, -1, 1, -1, 1, 1, -1, 1],
      [5, -2, -2, -1.5, -2, -1.5, -1.5, -2, -1.5],
      [5, -2, -2, -1.5, -2, -1.5, -1.5, -2, -1.5],
    ],
  };
  const built = rasterizeWardBuilt(ward, 4);
  assert.equal(built.reduce((sum, value) => sum + value, 0), 4.25);
  assert.equal(built[0], 0.25);
  assert.equal(built[5], 1);
  assert.equal(built[6], 1);
  assert.equal(built[9], 1);
  assert.equal(built[10], 1);
  assert.deepEqual(rasterWardBase(ward, 0.2).built, rasterWardBase(ward, 0.2).built);
});

test('scenario URLs normalize duplicate wards and preserve reproducible state', () => {
  const state = parsePairedScenario('?a=ballygunge&b=ballygunge&trees=55.4&roof=63&facades=35.04&phase=retained');
  /* The bare id in the URL resolves to the area KEY in the state. The link's
     spelling is unchanged from before the scope migration; what it means is now
     hierarchical. */
  assert.equal(state.a, 'in/kolkata/ballygunge');
  assert.notEqual(state.a, state.b);
  /* The distinct-ward fallback stays inside Kolkata. Over the flat ward list this
     was free; over the registry it is a property worth asserting. */
  assert.ok(state.b.startsWith('in/kolkata/'));
  assert.deepEqual(state.coverage, { trees: 55, roofs: 65, parks: 0, facades: 35 });
  const roundTrip = parsePairedScenario(`?${serializePairedScenario(state)}`);
  assert.deepEqual(roundTrip, state);
});

/*
 * THE ONE THAT COULD HAVE LOST USER DATA.
 *
 * /heat-map/compare ships, and it reads its two wards from the query string. The
 * reader it used to use, `isWardId`, FAILED SOFT: an unrecognised id fell through to
 * the default pair. So switching the state to `AreaKey` and validating with
 * `isAreaKey` would have left every already-shared link working in the only sense a
 * smoke test measures — it would not have thrown, it would not have 404'd, the page
 * would have settled — while showing a DIFFERENT COMPARISON under the same URL.
 * Nothing on screen and nothing in the console would have said so, because the page
 * rewrites the address bar from the state it parsed.
 *
 * Asserting each spelling against a hard-coded key is not enough on its own: that
 * checks the table, not the property. What a bookmark actually depends on is that
 * the OLD spelling and the NEW one name the same comparison, so the last case
 * compares two parsed states directly.
 *
 * THE PAIR IS NOT `ballygunge`/`baruipur`, AND THAT IS THE POINT. That pair is the
 * DEFAULT, so it is the one comparison for which the fail-soft is invisible: drop
 * the legacy bridge entirely and `?a=ballygunge&b=baruipur` still parses to
 * Ballygunge-vs-Baruipur, via the fallback, and every assertion about it passes.
 * Measured, not reasoned — the first version of this test used that pair and went
 * green against a `fromLegacyWard` that returned null for every bare id. Every case
 * below therefore names a pair that differs from the default on BOTH sides.
 */
test('a legacy compare link and its area-key form are the same comparison', () => {
  // 1 · a bare legacy id resolves to the right key — both sides, not just `a`.
  const legacy = parsePairedScenario('?a=barrackpore&b=ballygunge');
  assert.equal(legacy.a, 'in/kolkata/barrackpore');
  assert.equal(legacy.b, 'in/kolkata/ballygunge');
  // Neither side is the default, so neither could have arrived by falling back.
  assert.notEqual(legacy.a, DEFAULT_PAIRED_SCENARIO.a);
  assert.notEqual(legacy.b, DEFAULT_PAIRED_SCENARIO.b);

  // 2 · a full key passes through untouched.
  const keyed = parsePairedScenario('?a=in/kolkata/barrackpore&b=in/kolkata/ballygunge');
  assert.equal(keyed.a, 'in/kolkata/barrackpore');
  assert.equal(keyed.b, 'in/kolkata/ballygunge');

  // …and the two spellings may be mixed, which a hand-edited link readily is.
  assert.deepEqual(parsePairedScenario('?a=barrackpore&b=in/kolkata/ballygunge'), keyed);

  // 3 · THE PROPERTY: the two spellings are one comparison, whole state included.
  assert.deepEqual(keyed, legacy);

  /* …and it survives a round trip, which is what a bookmarked link goes through
     the moment the page calls history.replaceState on the first interaction. */
  assert.deepEqual(parsePairedScenario(`?${serializePairedScenario(legacy)}`), legacy);

  // 4 · garbage is refused and falls back to the default — it must not resolve.
  const nonsense = parsePairedScenario('?a=nonsense&b=barrackpore');
  assert.equal(nonsense.a, DEFAULT_PAIRED_SCENARIO.a);
  // The good half is untouched: one bad id does not discard the whole link.
  assert.equal(nonsense.b, 'in/kolkata/barrackpore');
  // A shape that merely LOOKS like a key is garbage too — registered, or nothing.
  assert.equal(parsePairedScenario('?a=in/kolkata/typo').a, DEFAULT_PAIRED_SCENARIO.a);
  assert.equal(fromLegacyWard('in/kolkata/typo'), null);
  assert.equal(fromLegacyWard('ballygunge '), null);
  assert.equal(fromLegacyWard(null), null);
  assert.equal(fromLegacyWard(undefined), null);
  /* Object.hasOwn, not `in`: a prototype key would otherwise be "recognised" and
     hand back a function where an AreaKey belongs. */
  assert.equal(fromLegacyWard('toString'), null);
  assert.equal(fromLegacyWard('constructor'), null);
});

/*
 * The emit side of the same decision: Compare keeps writing the LEGACY spelling, so
 * a link written today is byte-identical to one bookmarked before the migration and
 * only one URL form is ever in the wild. Asserted on the string, because "the state
 * round-trips" would pass just as well against percent-encoded keys.
 */
test('Compare still emits bare ward ids, so old and new links are identical', () => {
  // Again a non-default pair: the default would survive a broken bridge unchanged.
  const query = serializePairedScenario(parsePairedScenario('?a=barrackpore&b=ballygunge'));
  assert.ok(query.includes('a=barrackpore'), query);
  assert.ok(query.includes('b=ballygunge'), query);
  assert.ok(!query.includes('kolkata'), 'the URL must not carry the hierarchical key');
  // Emitting a key would arrive percent-encoded and unreadable; prove it does not.
  assert.ok(!query.includes('%2F'), query);

  /* The alias is per-key, NOT `splitKey(key).area`. An area with no legacy spelling
     must emit its whole key: `?a=creek` is a URL that never shipped, and the reader
     would refuse it and answer with the default pair — the same silent substitution,
     reintroduced from the writer. */
  assert.equal(toLegacyWard('in/kolkata/ballygunge'), 'ballygunge');
  assert.equal(toLegacyWard('ae/dubai/creek'), 'ae/dubai/creek');
});

/*
 * `nextDistinctWard` picked from a flat three-slug list that was Kolkata by
 * construction, so "a different ward" and "a different ward in this city" were the
 * same statement. Over the registry they are not, and the unfiltered spelling
 * `AREA_KEYS.find(k => k !== key)` would pair Ballygunge with Al Quoz — two
 * climates, two currencies, and Dubai shipping no artefacts, so half the comparison
 * would fail to load while the other half rendered.
 */
test('the distinct-area fallback never leaves the city', () => {
  const kolkata = nextDistinctArea('in/kolkata/ballygunge');
  assert.notEqual(kolkata, 'in/kolkata/ballygunge');
  assert.ok(kolkata.startsWith('in/kolkata/'));

  // The case that proves the filter rather than assuming it: Dubai stays in Dubai.
  const dubai = nextDistinctArea('ae/dubai/creek');
  assert.notEqual(dubai, 'ae/dubai/creek');
  assert.ok(dubai.startsWith('ae/dubai/'), `${dubai} left the city`);

  assert.deepEqual(areaKeysInCity('in/kolkata/baruipur'), [
    'in/kolkata/ballygunge', 'in/kolkata/baruipur', 'in/kolkata/barrackpore',
  ]);

  /* A CITY OF ONE AREA has no distinct sibling, and no registered city is one
     today — so the pure half is exercised directly, the same reason
     `areaTableDrift` is separate from the walk that calls it. Null, not the key
     back: a caller handed its own key would build an area-against-itself
     comparison, which `assertPairedResult` refuses. */
  assert.equal(nextDistinctKey(['in/kolkata/ballygunge'], 'in/kolkata/ballygunge'), null);
  assert.equal(nextDistinctKey([], 'in/kolkata/ballygunge'), null);
});

test('TypeScript HeatSim produces stable finite statistics on the canonical grid', () => {
  const count = SIM_N * SIM_N;
  const layers = {
    albedo: new Float32Array(count).fill(0.25),
    veg: new Float32Array(count).fill(0.15),
    built: new Float32Array(count).fill(0.5),
    water: new Float32Array(count),
  };
  const sim = new TsHeatSim();
  sim.reset({ n: SIM_N, cellMeters: 1400 / SIM_N }, layers, DEFAULT_PARAMS);
  sim.step(1, 20);
  const stats = sim.stats();
  assert.ok(Number.isFinite(stats.meanC));
  assert.ok(stats.meanC > 20 && stats.meanC < 60);
  sim.dispose();
});
