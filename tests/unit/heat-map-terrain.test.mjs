import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  terrainAt, terrainDrawAt, terrainLabel, asTerrainField,
  assertTerrainLogic, TERRAIN_N, TERRAIN_EXAGGERATION,
} from '../../src/scripts/climate-engine/terrain.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WARDS = ['ballygunge', 'barrackpore', 'baruipur'];

const fields = Object.fromEntries(await Promise.all(WARDS.map(async w => [
  w, JSON.parse(await readFile(join(ROOT, `public/heat-map/data/${w}-terrain.json`), 'utf8')),
])));

test('the module self-checks', () => {
  assertTerrainLogic();
});

test('every ward ships a well-formed field', () => {
  for (const w of WARDS) {
    const f = asTerrainField(fields[w]);
    assert.ok(f, `${w} failed to narrow to a field`);
    assert.equal(f.n, TERRAIN_N);
    assert.equal(f.h.length, TERRAIN_N * TERRAIN_N);
    assert.equal(f.sizeM, 1400);
    assert.ok(f.h.every(Number.isFinite), `${w} has a non-finite texel`);
  }
});

test('terrain is honest about itself in band', () => {
  // Provenance travels WITH the data, not just in the docs — the rule every
  // other served artefact in this engine follows.
  for (const w of WARDS) {
    const d = fields[w];
    assert.ok(d.source && d.licence, `${w} lost its provenance`);
    assert.equal(d.confidence, 'indicative',
      `${w} claims better than indicative — two DEMs disagree by a quarter of this signal`);
    assert.match(d.crossCheck, /Copernicus/,
      `${w} lost the cross-check that establishes the uncertainty`);
    assert.match(d.note, /NOT used by the simulation/,
      `${w} lost the statement that keeps this out of the physics`);
  }
});

test('smoothing shrank the relief, and the artefact shows both numbers', () => {
  for (const w of WARDS) {
    const d = fields[w];
    assert.ok(d.smoothSpanM <= d.rawSpanM,
      `${w}: smoothing increased the span — the filter is broken`);
    assert.ok(d.rawSpanM > 3 && d.rawSpanM < 15, `${w}: implausible raw span ${d.rawSpanM}`);
  }
});

test('the exaggeration is applied exactly once and is always disclosed', () => {
  // An unlabelled exaggeration is a lie about slope. This pins that the label
  // carries the actual multiplier, so the two can never drift apart.
  const f = asTerrainField(fields.ballygunge);
  const raw = terrainAt(f, 120, -80);
  assert.equal(terrainDrawAt(f, 120, -80), TERRAIN_EXAGGERATION * raw);
  assert.ok(terrainLabel(f).includes(`×${TERRAIN_EXAGGERATION}`),
    'the label must state the multiplier actually used');
});

test('a missing artefact leaves the map flat, not broken', () => {
  // The swallow-to-empty posture every loader in this engine takes: a failed
  // fetch must give today's flat map, never a half-displaced one.
  assert.equal(terrainDrawAt(null, 0, 0), 0);
  assert.equal(terrainLabel(null), '');
  assert.equal(asTerrainField({ h: [1, 2, 3], n: 128, sizeM: 1400 }), null);
});

test('sampling stays inside the field for every point the scene can ask about', () => {
  // Roads and water are clipped to a box slightly larger than the ward window,
  // so the sampler is asked about points beyond the field's edge every frame.
  const f = asTerrainField(fields.barrackpore);
  for (const [x, y] of [[-760, -760], [760, 760], [0, 760], [-760, 0], [0, 0]]) {
    assert.ok(Number.isFinite(terrainAt(f, x, y)), `sample at ${x},${y} was not finite`);
  }
});

test('terrain never reaches the simulation', async () => {
  // The load-bearing separation. SimLayers carries albedo/veg/built/water and
  // must not gain a terrain channel: a 3-5 m elevation range has no thermal
  // meaning at ward scale, and this field is far too uncertain to sit beside a
  // published +/-3.0 K band.
  const types = await readFile(join(ROOT, 'src/scripts/climate-engine/types.ts'), 'utf8');
  assert.ok(!/terrain/i.test(types),
    'SimLayers or its neighbours gained a terrain reference — terrain is render-only');
  const raster = await readFile(join(ROOT, 'src/scripts/climate-engine/ward-raster.ts'), 'utf8');
  assert.ok(!/terrain/i.test(raster),
    'ward-raster.ts gained terrain — the built raster must stay footprint coverage only');
  const accuracy = await readFile(join(ROOT, 'src/scripts/climate-engine/accuracy.ts'), 'utf8');
  assert.ok(!/terrain/i.test(accuracy),
    'accuracy.ts mentions terrain — no published band may depend on an indicative layer');
});
