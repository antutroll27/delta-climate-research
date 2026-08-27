import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import test from 'node:test';

import {
  REGISTRY, AREA_KEYS, isAreaKey, splitKey, assertRegistryLogic,
  areaTableDrift, shippingAreaIds,
} from '../../src/scripts/climate-engine/scope/registry.ts';
import { paths, cityPaths } from '../../src/scripts/climate-engine/scope/paths.ts';
import { WARDS as WARD_TABLE } from '../../src/data/wards.ts';
import { COST, FALLBACK_TAIR, PARK_R_M } from '../../src/scripts/climate-engine/heat-map-model.ts';

test('registry invariants hold', () => {
  assertRegistryLogic();
});

test('every registered area produces a key', () => {
  assert.ok(AREA_KEYS.includes('in/kolkata/ballygunge'));
  assert.ok(AREA_KEYS.includes('ae/dubai/al-quoz'));
  assert.equal(AREA_KEYS.length, 6);
});

test('isAreaKey rejects anything not registered', () => {
  assert.equal(isAreaKey('in/kolkata/ballygunge'), true);
  assert.equal(isAreaKey('in/kolkata/typo'), false);
  assert.equal(isAreaKey('ballygunge'), false);
  assert.equal(isAreaKey(''), false);
  assert.equal(isAreaKey(null), false);
});

test('splitKey returns the three parts', () => {
  assert.deepEqual(splitKey('in/kolkata/ballygunge'),
    { country: 'in', city: 'kolkata', area: 'ballygunge' });
});

test('Kolkata ships data and Dubai does not', () => {
  assert.equal(REGISTRY.in.cities.kolkata.areas.ballygunge.shipsData, true);
  assert.equal(REGISTRY.ae.cities.dubai.areas['al-quoz'].shipsData, false);
});

test('the registry does not become a fourth ward table', () => {
  // src/data/wards.ts is THE area table. scripts/_types.py mirrors it, and records
  // that five scripts once carried private copies which had already diverged --
  // one by 10-44 m of coordinate. Every data-shipping area must exist there, and
  // Kolkata's ids must match it exactly.
  const tableIds = WARD_TABLE.map((w) => w.id).sort();
  const kolkata = Object.keys(REGISTRY.in.cities.kolkata.areas).sort();
  assert.deepEqual(kolkata, tableIds);
  for (const key of AREA_KEYS) {
    const { country, city, area } = splitKey(key);
    if (REGISTRY[country].cities[city].areas[area].shipsData) {
      assert.ok(tableIds.includes(area), `${key} ships data but is not in src/data/wards.ts`);
    }
  }
});

test('the registry restates no geography', async () => {
  // Geography lives in src/data/wards.ts alone. If it appears here too, the two
  // can silently disagree -- which is the failure this whole design exists to stop.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(
    new URL('../../src/scripts/climate-engine/scope/registry.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const banned of ['lat', 'lon', 'footprintM', 'veg']) {
    assert.ok(!new RegExp(`\\b${banned}\\s*:`).test(code),
      `registry.ts declares "${banned}" — geography belongs in src/data/wards.ts only`);
  }
});

test('an area outside Kolkata may ship data once the ward table describes it', () => {
  /* The premise of this whole design is that src/data/wards.ts is THE AREA TABLE,
     not "Kolkata's table". Check 7 first compared the table against Kolkata's areas
     alone, so the first non-Kolkata area to ship data failed it spuriously -- give
     Dubai's creek shipsData and add the ward row the check's own first half then
     demands, and it fired anyway. That would have blocked Task 3 onwards.

     This is that case. It must NOT report drift. It is exercised through the pure
     comparison rather than the shipped registry because no Dubai area ships data
     yet, which is exactly why the bug survived being written. */
  assert.equal(areaTableDrift(
    ['ballygunge', 'baruipur', 'barrackpore', 'creek'],
    ['ballygunge', 'baruipur', 'barrackpore', 'creek'],
  ), null);

  // ...while still catching real drift in BOTH directions.
  assert.ok(areaTableDrift(['ballygunge'], ['ballygunge', 'baruipur']),
    'a ward row that no area ships must be reported');
  assert.ok(areaTableDrift(['ballygunge', 'fake'], ['ballygunge']),
    'an area shipping data with no ward row must be reported');
  // order and duplication are not drift; the sets are what matter
  assert.equal(areaTableDrift(['b', 'a', 'a'], ['a', 'b']), null);
});

test('today, the areas shipping data are exactly the ward table', () => {
  // Covers the COLLECTION half that areaTableDrift's purity leaves untested.
  assert.deepEqual([...shippingAreaIds()].sort(), WARD_TABLE.map((w) => w.id).sort());
});

/* TRANSITIONAL -- DELETE IN TASK 5, WITH THE CONSTANTS IT WATCHES.

   Until the scope migration moves them, these numbers exist in two places: here in
   the registry and in heat-map-model.ts, which still owns them. That is the exact
   shape of the divergence this whole design exists to prevent, pointed at a second
   file, so it is guarded for the window in which it is true. Task 5 deletes COST,
   FALLBACK_TAIR and PARK_R_M from the model, makes the registry the only source,
   and this test goes with them.

   It lives in the TEST, never in the module. Importing heat-map-model.ts from
   scope/registry.ts would invert the layering the migration rests on -- the
   registry is meant to sit above the model, not depend on it.

   Task 1's goldens would catch each of these eventually: they froze the cost
   matrix, the pathway/fallback params and the park blob edge, so a drifted copy
   surfaces once Task 5 wires the registry in. This is the same failure four tasks
   earlier and with the cause named, which is the whole argument for it -- facadeM2
   was already found missing here once. */
test('the registry has not drifted from the constants it will replace', () => {
  const costs = REGISTRY.in.costs;
  assert.equal(costs.roofM2, COST.roofM2);
  assert.equal(costs.tree, COST.tree);
  assert.equal(costs.parkCr, COST.parkCr);
  assert.equal(costs.facadeM2, COST.facadeM2);
  /* Field-for-field, and no field left behind: an absent one is `undefined`, which
     multiplies to NaN and poisons computeCost's whole total. `currency` is
     registry-only -- the model has no notion of one -- hence the +1. */
  assert.equal(Object.keys(costs).length, Object.keys(COST).length + 1,
    'REGISTRY.in.costs and COST must carry the same fields, plus currency');

  assert.equal(REGISTRY.in.cities.kolkata.fallbackTairC, FALLBACK_TAIR);
  assert.equal(REGISTRY.in.cities.kolkata.parkRadiusM, PARK_R_M);
});

/* ---------------------------------------------------------------------------
   scope/paths.ts — the ONE place a /heat-map/data/ URL may be built.
   --------------------------------------------------------------------------- */

test('paths builds every ward URL from the registry', () => {
  const p = paths('in/kolkata/ballygunge');
  assert.equal(p.ward, '/heat-map/data/ballygunge.json');
  assert.equal(p.terrain, '/heat-map/data/ballygunge-terrain.json');
  assert.equal(p.water, '/heat-map/data/ballygunge-water.json');
  assert.equal(p.roads, '/heat-map/data/ballygunge-roads.json');
  assert.equal(p.labels, '/heat-map/data/ballygunge-road-labels.geojson');
  assert.equal(p.provenance, '/heat-map/data/ballygunge-provenance.json');
  assert.equal(p.trees, '/heat-map/data/ballygunge-trees.json');
  assert.equal(p.surface, '/heat-map/data/ballygunge-surface.png');
  assert.equal(p.canopy, '/heat-map/data/ballygunge-canopy.png');
  assert.equal(p.layers, '/heat-map/data/ballygunge-layers.json');
});

test('an area that ships no data resolves to null, never a URL', () => {
  // A disabled city must be unreachable BY CONSTRUCTION, so it cannot 404 in
  // the console and cannot half-render.
  assert.equal(paths('ae/dubai/al-quoz'), null);
  assert.equal(paths('ae/dubai/creek'), null);
  assert.equal(paths('ae/dubai/south'), null);
});

test('city-level files are city-scoped, not global', () => {
  // heatwave-percentiles.json carries a `city` key and dc-urs-inputs.json a
  // `wards` key -- both Kolkata's -- at paths that imply they are global. A
  // second city would silently inherit Kolkata's heat statistics.
  assert.equal(cityPaths('in/kolkata/ballygunge').heatwave,
    '/heat-map/data/heatwave-percentiles.json');
  assert.equal(cityPaths('in/kolkata/ballygunge').dcUrs,
    '/heat-map/data/dc-urs-inputs.json');
  assert.equal(cityPaths('ae/dubai/al-quoz').heatwave, null);
  assert.equal(cityPaths('ae/dubai/al-quoz').dcUrs, null);
});

test('every URL paths() emits exists on disk', async () => {
  // A typo in a suffix would produce a plausible URL that 404s silently at
  // runtime. This is the check that makes the builder trustworthy.
  const present = new Set(await readdir(new URL('../../public/heat-map/data', import.meta.url)));
  let checked = 0;
  for (const key of AREA_KEYS) {
    const p = paths(key);
    if (p === null) continue;
    for (const [name, url] of Object.entries(p)) {
      const file = url.replace('/heat-map/data/', '');
      assert.ok(present.has(file), `${key}: ${name} -> ${file} is missing on disk`);
      checked += 1;
    }
  }
  // Guard the guard: if paths() ever returned {} or every area stopped
  // shipping, the loop above would pass while checking nothing.
  assert.equal(checked, 30, 'expected 3 shipping areas x 10 files');
});

test('every city-level URL exists on disk too', async () => {
  const present = new Set(await readdir(new URL('../../public/heat-map/data', import.meta.url)));
  let checked = 0;
  for (const key of AREA_KEYS) {
    for (const url of Object.values(cityPaths(key))) {
      if (url === null) continue;
      assert.ok(present.has(url.replace('/heat-map/data/', '')), `${url} is missing on disk`);
      checked += 1;
    }
  }
  assert.ok(checked > 0, 'no city-level URL was checked');
});
