/**
 * The two ward surfaces, and the default that was never checked against either.
 *
 * OBOS answers two different questions with two different lists, and this file
 * pins the difference:
 *
 *   WARDS            — what the CATALOGUE publishes. Needs {ward}-provenance.json,
 *                      {ward}-layers.json and public/3d-tiles/{ward}/tileset.json.
 *   RENDERABLE_WARDS — what the INSTRUMENT can open. Needs {ward}.json and the
 *                      optional geometry/surface layers beside it.
 *
 * Collapsing them was measured, not imagined: publishing Bengaluru before its
 * provenance exists aborts `npm run build` on ENOENT and fails 27 tests here.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CITIES, allWards, wardsOfCity } from '../../src/data/cities.ts';
import { RENDERABLE_CITIES, RENDERABLE_WARDS, WARDS, isPublishedWard } from '../../src/data/wards.ts';
import { DEFAULT_PAIRED_SCENARIO } from '../../src/scripts/climate-engine/scenario/scenario-state.ts';

/* REMOVED: two tests pinning `assertDefaultScenarioPublished`, a runtime guard
   this branch added so a DEFAULT paired ward could not name an unpublished ward.
   Main's scenario-url.ts supersedes it at the type level: `AreaKey` is a literal
   union derived from REGISTRY, so a default naming an unregistered area fails to
   TYPECHECK rather than at module load. The guard is stronger and earlier, so the
   tests are retired rather than rewritten. The WARDS/RENDERABLE split they sat
   beside is still pinned by everything below. */

test('every published ward is renderable — the catalogue cannot outrun the map', () => {
  for (const w of WARDS) {
    assert.ok(
      RENDERABLE_WARDS.some(r => r.id === w.id),
      `${w.id} is published but not renderable: the catalogue would advertise a ward the instrument refuses to open`,
    );
  }
});

test('isPublishedWard agrees with WARDS, and Bengaluru is renderable but unpublished', () => {
  for (const w of WARDS) assert.ok(isPublishedWard(w.id), `${w.id}`);
  for (const w of wardsOfCity('bengaluru')) {
    assert.ok(RENDERABLE_WARDS.some(r => r.id === w.id), `${w.id} must be drawable`);
    /* Not an aspiration — a statement of the artefacts on disk. When Bengaluru's
       provenance, layer manifest and tileset land, this line is what says the
       publication gate is the next thing to move. */
    assert.ok(!isPublishedWard(w.id), `${w.id} has no provenance/tileset yet, so it must not be published`);
  }
});

test('the tabs and cards can be generated: every renderable ward carries a swatch', () => {
  // The strip's gradients used to be inline markup, one hand-written card per
  // ward. Generating them means the registry must be able to supply all six.
  const swatches = new Set();
  for (const w of RENDERABLE_WARDS) {
    assert.match(w.swatch, /gradient|#[0-9a-f]{3,6}/i, `${w.id}: swatch must be a CSS background`);
    swatches.add(w.swatch);
  }
  assert.equal(swatches.size, RENDERABLE_WARDS.length, 'two wards share a swatch, so the strip cannot tell them apart');
});

test('every renderable city declares a resolution the readout can print', () => {
  for (const id of RENDERABLE_CITIES) {
    const city = CITIES[id];
    assert.ok(city, `${id} is renderable but absent from CITIES`);
    assert.ok(Number.isFinite(city.cellMeters) && city.cellMeters > 0, `${id}: ${city.cellMeters}`);
    assert.ok(city.wards.length > 0, `${id} has no wards`);
  }
  // both cities resolve to the same declared cell size, by construction:
  // 1400/192 and 2800/384 are the same number, which is the point of the
  // admitted (grid, ward size) pairs.
  assert.equal(CITIES.kolkata.cellMeters.toFixed(2), CITIES.bengaluru.cellMeters.toFixed(2));
});

test('a fourth ward would be a data change: the registry is the only ward list', () => {
  // six wards across two cities, and the renderable set is exactly their union
  assert.equal(allWards().length, 6);
  assert.equal(RENDERABLE_WARDS.length, 6);
});
