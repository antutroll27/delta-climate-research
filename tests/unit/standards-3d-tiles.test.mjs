import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { WARDS } from '../../src/data/wards.ts';
import { checkTileset, ecefToGeodetic } from '../../scripts/check-3d-tiles.mjs';

test('ecefToGeodetic inverts the known reference points', () => {
  const [lon0, lat0] = ecefToGeodetic([6378137.0, 0, 0]);
  assert.ok(Math.abs(lon0) < 1e-9 && Math.abs(lat0) < 1e-9, 'equator/Greenwich');
  const [, lat90] = ecefToGeodetic([0, 0, 6378137.0 * (1 - 1 / 298.257223563)]);
  assert.ok(Math.abs(lat90 - 90) < 1e-6, `north pole gave ${lat90}`);
});

test('every ward tileset is structurally valid and lands where the ward is', () => {
  for (const w of WARDS) {
    const r = checkTileset(w.id);
    assert.deepEqual(r.issues, [], `${w.id}: ${r.issues.join('; ')}`);
    const [lon, lat] = r.placed;
    // the tileset origin must be the ward centre the rest of the pipeline uses —
    // this is the check that fails if the geometry is mirrored or displaced
    assert.ok(Math.abs(lon - w.lon) < 0.01, `${w.id}: tileset at ${lon}, ward at ${w.lon}`);
    assert.ok(Math.abs(lat - w.lat) < 0.01, `${w.id}: tileset at ${lat}, ward at ${w.lat}`);
  }
});

test('geometric error is measured, not a placeholder', () => {
  for (const w of WARDS) {
    const t = JSON.parse(readFileSync(`public/3d-tiles/${w.id}/tileset.json`, 'utf8'));
    // a median building diagonal in these wards is metres, not 0 and not a round
    // stand-in like 100 or 512 that a placeholder would be
    assert.ok(t.geometricError > 5 && t.geometricError < 60, `${w.id}: gErr ${t.geometricError} m is not plausible`);
    assert.match(String(t.extras.geometricErrorDerivation), /median/i, 'the derivation must be stated');
    assert.equal(t.extras.status, 'prototype');
    assert.match(t.extras.heightDatum, /ellipsoid/i, 'the height datum limitation must ship with the data');
    // attribution moved into a full licence block: the tileset is now declared a
    // Derivative Database under ODbL rather than merely crediting the source
    assert.equal(t.extras.licence.licence, 'ODbL-1.0', 'the geometry must carry its licence');
    assert.ok(t.extras.licence.upstream.some((u) => /OpenStreetMap/.test(u)), 'upstream notices preserved');
    assert.match(t.extras.licence.treatedAs, /Derivative Database/);
  }
});

test('the tileset height ceiling matches the heights the map ships', async () => {
  const heights = JSON.parse(readFileSync('data/geometry/heights-overture.json', 'utf8')).wards;
  for (const w of WARDS) {
    const t = JSON.parse(readFileSync(`public/3d-tiles/${w.id}/tileset.json`, 'utf8'));
    const maxShipped = Math.max(...heights[w.id].map((h) => (h.fill || h.p65 < 2.5 ? 2.5 : h.p65)));
    assert.ok(Math.abs(t.root.boundingVolume.region[5] - maxShipped) < 0.01,
      `${w.id}: region maxHeight ${t.root.boundingVolume.region[5]} vs shipped ${maxShipped}`);
  }
});
