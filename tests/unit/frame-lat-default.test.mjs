import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import { RENDERABLE_WARDS, wardLatLon } from '../../src/data/wards.ts';
import { wardMercatorScale } from '../../src/scripts/climate-engine/ward-frame.ts';
import { wardBbox } from '../../src/scripts/standards/ward-record.ts';
import { rasterizeWardBuilt } from '../../src/scripts/climate-engine/ward-raster.ts';
import { requireGrid } from '../../src/scripts/climate-engine/types.ts';
import { SHEETS, neighbours, sheetFrameOrigin } from '../../src/scripts/climate-engine/scope/sheets.ts';
import { AMSTERDAM_SHEET_LATTICE } from '../../src/data/sheets/amsterdam.ts';

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

/* ── frameLat set: the east scale moves, nothing else does ─────────────────── */

test('an explicit frameLat equal to the ward latitude is the default, and a different one moves only the east axis', () => {
  const lat = 52.364 + 0.076, lon = 4.885;
  const dflt = wardMercatorScale(lat), same = wardMercatorScale(lat, lat), moved = wardMercatorScale(lat, 52.364);
  assert.deepStrictEqual(same, dflt);
  assert.equal(moved.north, dflt.north);
  assert.equal(moved.up, dflt.up);
  assert.equal(moved.east, 1 / (360 * 111_320 * Math.cos((52.364 * Math.PI) / 180)));
  assert.notEqual(moved.east, dflt.east);
  /* the inverse: x metres east is x / (111320 cos(frameLat)) degrees; north is untouched */
  const a = wardLatLon({ lat, lon }, 1000, 1000), b = wardLatLon({ lat, lon, frameLat: 52.364 }, 1000, 1000);
  assert.equal(a.lat, b.lat);
  assert.equal(b.lon, lon + 1000 / (111_320 * Math.cos((52.364 * Math.PI) / 180)));
  assert.deepStrictEqual(wardLatLon({ lat, lon, frameLat: undefined }, 1000, 1000), a);
  /* the bbox of a ward is the box the inverse maps its corners to */
  const w = { lat, lon, footprintM: 2800, frameLat: 52.364 };
  const [west, south, east, north] = wardBbox(w);
  const sw = wardLatLon(w, -1400, -1400), ne = wardLatLon(w, 1400, 1400);
  assert.ok(Math.abs(west - sw.lon) < 1e-12 && Math.abs(south - sw.lat) < 1e-12 && Math.abs(east - ne.lon) < 1e-12 && Math.abs(north - ne.lat) < 1e-12);
});

test('G9c in TS: any seam point maps through both neighbouring sheets\' frames to coordinates exactly 2800 m apart', () => {
  const MM = 1e-3;
  let pairs = 0, worst = 0;
  for (const s of SHEETS) {
    const o = sheetFrameOrigin(s);
    assert.equal(o.frameLat, AMSTERDAM_SHEET_LATTICE.frameLat, `${s.code} uses E4's standard parallel`);
    for (const n of neighbours(s.code)) {
      const di = n.i - s.i, dj = n.j - s.j;
      const m = sheetFrameOrigin(n);
      /* a point on the shared edge (east edge for di=1, north edge for dj=1; the corner pairs share a corner point), in s's frame */
      for (let k = 0; k <= 20; k++) {
        const t = (k / 20 - 0.5) * 2800;
        const x = di === 0 ? t : di * 1400, y = dj === 0 ? t : dj * 1400;
        const ll = wardLatLon(o, x, y);
        /* the same point in n's frame, by inverting n's own forward map */
        const nx = (ll.lon - m.lon) * (111_320 * Math.cos((m.frameLat * Math.PI) / 180));
        const ny = (ll.lat - m.lat) * 110_540;
        const e = Math.max(Math.abs(nx - (x - di * 2800)), Math.abs(ny - (y - dj * 2800)));
        worst = Math.max(worst, e);
        assert.ok(e < MM, `${s.code}->${n.code}: ${e} m off an exact 2800 m translation`);
      }
      pairs++;
    }
  }
  assert.ok(pairs > 100, `${pairs} neighbour pairs checked`);
  assert.ok(worst < MM);
});
