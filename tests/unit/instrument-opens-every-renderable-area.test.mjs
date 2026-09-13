import assert from 'node:assert/strict';
import test from 'node:test';

import { AREA_KEYS, isDrawable, splitKey } from '../../src/scripts/climate-engine/scope/registry.ts';
import { paths } from '../../src/scripts/climate-engine/scope/paths.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { RENDERABLE_WARD_MAP, renderableWardById, wardById } from '../../src/data/wards.ts';

/**
 * EVERY AREA THE INSTRUMENT CLAIMS IT CAN DRAW MUST ACTUALLY BE OPENABLE.
 *
 * THE BUG THIS EXISTS FOR, MEASURED. `heat-map-app.ts` indexed `WARD_MAP`, which
 * is built from `WARDS` — the CATALOGUE list, gated to Kolkata. So for every
 * Bengaluru ward `wardOf(key)` returned undefined and the module's own
 *
 *     center: [wardOf(INITIAL_AREA).lon, wardOf(INITIAL_AREA).lat]
 *
 * threw `TypeError: Cannot read properties of undefined (reading 'lon')` BEFORE
 * maplibre was constructed. Measured in a real browser: zero canvases, no map,
 * "SELECTING ENGINE" for ever, every readout a dash. A whole city dead on the
 * page.
 *
 * AND 728 UNIT TESTS PASSED. Every e2e spec opens `/heat-map/in/kolkata/…`, and
 * nothing anywhere opened a Bengaluru ward, so the suite was green while the
 * feature was gone. That is not a gate that failed to fire; it is the absence of
 * a gate, which is worse, and it is what this file is.
 *
 * It asserts the JOIN rather than any one call site: for every drawable area,
 * the three things the instrument needs at mount — a ward row, artefact URLs and
 * a resolved scope — must all be present. A future module that reaches for the
 * published lookup fails here rather than in someone's browser.
 */

const drawable = AREA_KEYS.filter((key) => {
  const { country, city, area } = splitKey(key);
  return isDrawable(country, city, area);
});

test('the registry declares something drawable at all', () => {
  // Guard the guard: an empty list would make every loop below vacuously true.
  assert.ok(drawable.length >= 6,
    `expected at least Kolkata's three and Bengaluru's three, got ${drawable.length}`);
});

for (const key of drawable) {
  const { area } = splitKey(key);

  test(`${key}: the instrument can look up its ward row`, () => {
    /* THE EXACT SHAPE OF THE CRASH. `wardOf` is `RENDERABLE_WARD_MAP[area]`, and
       reading `.lon` off undefined is what killed the mount. Assert the lookup
       AND the two fields the first frame reads, so a row that exists but is
       missing a coordinate fails here too. */
    const ward = RENDERABLE_WARD_MAP[area];
    assert.ok(ward, `${key}: absent from RENDERABLE_WARD_MAP — wardOf() returns undefined `
      + 'and the map never constructs. This is the published-vs-renderable mix-up.');
    assert.equal(typeof ward.lon, 'number', `${key}: no lon; the initial map centre reads it`);
    assert.equal(typeof ward.lat, 'number', `${key}: no lat; the initial map centre reads it`);
    assert.equal(typeof ward.footprintM, 'number',
      `${key}: no footprintM; currentWardSizeM and the solver grid both read it`);
    assert.deepEqual(renderableWardById(area), ward, `${key}: the two renderable lookups disagree`);
  });

  test(`${key}: the instrument can obtain its artefact URLs`, () => {
    /* `paths()` returns null for an area that ships nothing, and a null here is
       the other way this city goes blank — `loadWard` returns early and leaves
       the previous ward on screen. */
    const p = paths(key);
    assert.ok(p, `${key}: paths() is null, so the instrument has no URLs to fetch`);
    assert.match(p.ward, /\.json$/);
  });

  test(`${key}: its scope resolves and says it has data`, () => {
    const scope = resolve(key);
    assert.equal(scope.key, key);
    assert.ok(scope.area.name.length > 0, `${key}: no display name`);
    assert.equal(scope.area.hasData, true,
      `${key}: drawable in the registry but hasData false — the stage would render `
      + 'the ships-nothing placeholder instead of the instrument');
  });
}

test('a published ward is renderable too — the catalogue cannot outrun the map', () => {
  /* The converse, and the reason the two lists are not interchangeable in either
     direction. `wardById` is the CATALOGUE lookup; everything it knows about must
     also be drawable, or we would publish a record for a ward the map refuses. */
  for (const key of AREA_KEYS) {
    const { area } = splitKey(key);
    if (wardById(area) === undefined) continue;
    assert.ok(RENDERABLE_WARD_MAP[area],
      `${area} is published but not renderable — the catalogue would advertise a ward `
      + 'the instrument cannot open');
  }
});
