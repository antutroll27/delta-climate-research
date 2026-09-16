import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { asTerrainField, terrainDrawAt, terrainLabel } from '../../src/scripts/climate-engine/terrain.ts';

/**
 * BENGALURU'S WEB GROUND IS THE GROUND ITS GLB BUILDINGS STAND ON.
 *
 * blender_bangalore.py seats every building base at
 * `(sample_ground - meanM) * TERRAIN_EXAG - BASE_SINK_M` and bakes it into the GLB.
 * The browser draws trees, roads, water and the heat ground at `terrainDrawAt`. With
 * no Bengaluru terrain shipped, that read 0 and 61-67 % of trees sat more than 5 m off
 * their neighbours' ground (audit, 2026-09-13).
 *
 * So the two samplers must agree at every point, and the points are deliberately
 * OFF-CENTRE and unpaired: a mirrored field agrees on symmetric statistics and
 * disagrees here by up to 50 m (measured). See the mirror memory in this repo's history.
 */
const ROOT = new URL('../../', import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));

/** blender_bangalore.py `sample_ground`, line for line: row 0 is the SOUTH edge. */
function sampleGround(t, x, y) {
  const n = t.n, size = t.sizeM, h = t.h;
  const gx = Math.min(Math.max((x + size / 2) / size * (n - 1), 0), n - 1);
  const gy = Math.min(Math.max((y + size / 2) / size * (n - 1), 0), n - 1);
  const x0 = Math.trunc(gx), y0 = Math.trunc(gy);
  const x1 = Math.min(x0 + 1, n - 1), y1 = Math.min(y0 + 1, n - 1);
  const fx = gx - x0, fy = gy - y0;
  return (h[y0 * n + x0] * (1 - fx) + h[y0 * n + x1] * fx) * (1 - fy)
    + (h[y1 * n + x0] * (1 - fx) + h[y1 * n + x1] * fx) * fy;
}

test('the GLB was seated at exaggeration 1 on the mesh mean, which the web terrain assumes', () => {
  const blender = readFileSync(new URL('scripts/blender_bangalore.py', ROOT), 'utf8');
  assert.match(blender, /^TERRAIN_EXAG = 1\.0$/m,
    'blender_bangalore.py changed the GLB exaggeration; export_terrain must carry the new value');
  assert.match(blender, /datum = float\(terrain\["meanM"\]\)/,
    'blender_bangalore.py changed the GLB datum; export_terrain must use the same one');
});

for (const ward of ['indiranagar', 'mg-road', 'whitefield']) {
  test(`${ward}: the browser draws the ground the GLB buildings were seated on`, () => {
    const src = json(`data/bangalore/${ward}-terrain.json`);
    const field = asTerrainField(json(`public/heat-map/data/${ward}-terrain.json`));
    assert.ok(field, `${ward}: the shipped terrain did not narrow to a field — the ward draws flat`);
    assert.equal(field.exaggeration, 1, 'x4 would lift the ground off buildings baked at x1');
    assert.match(terrainLabel(field), /1:1/, 'the label must say the ground is not exaggerated');
    const half = src.sizeM / 2;
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      const x = ((i * 7919) % src.sizeM) - half + 0.37;
      const y = ((i * 104729) % src.sizeM) - half + 0.61;
      worst = Math.max(worst, Math.abs(terrainDrawAt(field, x, y) - (sampleGround(src, x, y) - src.meanM)));
    }
    assert.ok(worst < 0.02,
      `${ward}: web ground differs from the GLB's seat by up to ${worst.toFixed(2)} m — mirrored, mis-datumed or exaggerated`);
  });
}
