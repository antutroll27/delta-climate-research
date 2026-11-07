import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import { RENDERABLE_WARDS, wardLatLon } from '../../src/data/wards.ts';
import { wardMercatorScale } from '../../src/scripts/climate-engine/ward-frame.ts';
import { wardBbox } from '../../src/scripts/standards/ward-record.ts';
import { rasterizeWardBuilt } from '../../src/scripts/climate-engine/ward-raster.ts';
import { requireGrid } from '../../src/scripts/climate-engine/types.ts';

/* frame_lat DEFAULTS TO THE AREA'S OWN LATITUDE, so every ward that existed before it keeps its frame to the last bit.
   `tests/fixtures/frame-lat/ts.json` was written by this very file (WRITE_FRAME_GOLDEN=1) from the code as it stood BEFORE
   `frameLat` existed; every run compares against it with deepStrictEqual -- no tolerance anywhere.
   The Python side is `scripts/check-frame-lat.py` (same idea, own golden: Math.cos and math.cos are not promised to agree
   in the last bit, so each language is pinned against itself). */

const GOLDEN = 'tests/fixtures/frame-lat/ts.json';
const XY = [-1400, -700, -1, 0, 0.5, 333.3, 700, 1400];

function compute() {
  const out = {};
  for (const w of RENDERABLE_WARDS) {
    const f = wardMercatorScale(w.lat);
    const local = [];
    for (const x of XY) for (const y of XY) local.push(wardLatLon(w, x, y));
    const ward = JSON.parse(readFileSync(`public/heat-map/data/${w.id}.json`, 'utf8'));
    const n = requireGrid(ward.sizeM).n;
    const built = rasterizeWardBuilt(ward, n);
    out[w.id] = {
      scale: { east: f.east, north: f.north, up: f.up },
      bbox: [...wardBbox(w)],
      local,
      builtSha256: createHash('sha256').update(Buffer.from(built.buffer, built.byteOffset, built.byteLength)).digest('hex'),
    };
  }
  return out;
}

if (process.env.WRITE_FRAME_GOLDEN === '1') {
  mkdirSync('tests/fixtures/frame-lat', { recursive: true });
  writeFileSync(GOLDEN, JSON.stringify(compute(), null, 1) + '\n');
}

test('every existing ward keeps its frame, its bbox, its lat/lon inverse and its built raster bit for bit', () => {
  assert.ok(existsSync(GOLDEN), `${GOLDEN} is missing`);
  const pinned = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const current = compute();
  assert.deepStrictEqual(Object.keys(current).sort(), Object.keys(pinned).sort(), 'the set of renderable wards moved: re-pin deliberately');
  for (const id of Object.keys(pinned)) assert.deepStrictEqual(current[id], pinned[id], `${id} is not bit-identical to the pre-frameLat golden`);
});
