import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

import { RENDERABLE_WARDS, WARDS, wardLatLon } from '../../src/data/wards.ts';
import { wardBbox } from '../../src/scripts/standards/ward-record.ts';
import { AMSTERDAM_SHEETS, AMSTERDAM_SHEET_LATTICE } from '../../src/data/sheets/amsterdam.ts';
import { AMSTERDAM_AREA_WARDS, AMSTERDAM_AREA_FACTS, AMSTERDAM_NAME_CREDIT } from '../../src/data/sheets/amsterdam-areas.ts';
import { REGISTRY, TILED_CITY_READY } from '../../src/scripts/climate-engine/scope/registry.ts';

/* CITY STREAMING P2c: the 31 streamed areas are real records. `data/cities/amsterdam/area-records.json` is the one source,
   written by scripts/build-area-records.py from the sheet pipeline's outputs; `src/data/sheets/amsterdam-areas.ts` and the area rows of
   `public/heat-map/data/surface-meta.json` derive from it (`python3 scripts/build-area-records.py --check` holds the bytes equal; this file
   holds what the page and the runtime READ). Nothing here needs the untracked build outputs, so CI runs all of it. */

const ROOT = new URL('../../', import.meta.url);
const json = (rel) => JSON.parse(readFileSync(new URL(rel, ROOT), 'utf8'));
const records = json('data/cities/amsterdam/area-records.json');
const names = json('data/cities/amsterdam/area-names.json');
const meta = json('public/heat-map/data/surface-meta.json').wards;
const streamedWard = new Map(AMSTERDAM_AREA_WARDS.map((w) => [w.id, w]));
const canal = RENDERABLE_WARDS.find((w) => w.id === 'canal-ring');

/* THE S5 RULE (P2a audit): `frameLat` is optional on a WardRecord and defaults to the ward's own latitude, so a streamed record that
   forgot it would render in the wrong frame (0.8 m at a north-south seam, 4.8 m in rows 1 and 7) and no other test would fail. A
   streamed record must STATE it, and state the lattice standard parallel. Canal Ring (E4) is written by hand and states none: its own
   latitude IS the standard parallel, which is checked here too. */
const effectiveFrameLat = (w) => w.frameLat ?? w.lat;
const stated = (w) => typeof w.frameLat === 'number' && w.frameLat === AMSTERDAM_SHEET_LATTICE.frameLat;

test('S5: every streamed area states frameLat, and it is the lattice standard parallel; there is no silent default', () => {
  assert.equal(AMSTERDAM_AREA_WARDS.length, 31);
  for (const w of AMSTERDAM_AREA_WARDS) assert.ok(stated(w), `${w.id}: frameLat ${w.frameLat}`);
  assert.equal(effectiveFrameLat(canal), AMSTERDAM_SHEET_LATTICE.frameLat, 'E4 is hand-written: its own latitude is the standard parallel');
  /* the control: a record that omits it, or states another latitude, is caught by the same predicate */
  const w0 = AMSTERDAM_AREA_WARDS[0];
  const { frameLat: _drop, ...forgot } = w0;
  assert.ok(!stated(forgot), 'a record with no frameLat must fail');
  assert.ok(!stated({ ...w0, frameLat: w0.lat }), 'a record in its own-latitude frame must fail');
  /* and the consequence is real: the omitted record puts its east edge somewhere else */
  const real = wardBbox(w0), wrong = wardBbox(forgot);
  assert.notEqual(real[2], wrong[2]);
});

test('every streamed area\'s ward-table frame IS its lattice box: wardBbox equals the sheet table\'s wgs84Bounds', () => {
  for (const s of AMSTERDAM_SHEETS) {
    if (s.id === 'canal-ring') continue;
    const w = streamedWard.get(s.id);
    assert.ok(w, `${s.id} has no ward-table row`);
    const [west, south, east, north] = wardBbox(w);
    const [bw, bs, be, bn] = s.wgs84Bounds;
    for (const [got, want, nm] of [[west, bw, 'west'], [south, bs, 'south'], [east, be, 'east'], [north, bn, 'north']]) {
      assert.ok(Math.abs(got - want) < 1e-9, `${s.id} ${nm}: ${got} vs ${want}`);
    }
    assert.deepEqual([w.lat, w.lon], [s.centre.lat, s.centre.lon], `${s.id}: centre`);
    assert.equal(w.footprintM, 2800);
    const c = wardLatLon(w, 0, 0);
    assert.ok(Math.abs(c.lat - w.lat) < 1e-12 && Math.abs(c.lon - w.lon) < 1e-12);
  }
});

test('the records, the generated ward rows and the generated facts agree; the area rows are in the ward table and not in the published one', () => {
  assert.deepEqual(records.areas.map((r) => r.id), AMSTERDAM_AREA_WARDS.map((w) => w.id));
  for (const r of records.areas) {
    const w = streamedWard.get(r.id);
    assert.deepEqual({ id: w.id, name: w.name, zone: w.zone, body: w.body, lat: w.lat, lon: w.lon, frameLat: w.frameLat, veg: w.veg, footprintM: w.footprintM, swatch: w.swatch },
      { id: r.id, name: r.name, zone: r.zone, body: r.body, lat: r.lat, lon: r.lon, frameLat: r.frameLat, veg: r.veg, footprintM: r.footprintM, swatch: r.swatch });
    assert.ok(RENDERABLE_WARDS.some((x) => x.id === r.id), `${r.id} is renderable`);
    assert.ok(!WARDS.some((x) => x.id === r.id), `${r.id} must not be in the published ward table`);
    const f = AMSTERDAM_AREA_FACTS[r.id];
    assert.equal(f.drawn, r.counts.drawn);
    assert.equal(f.scenes, r.surfaceMeta.scenes);
    assert.deepEqual(f.provenance, r.provenance);
    assert.equal(r.sheet, true);
    assert.equal(r.drawable, false);
    const reg = REGISTRY.nl.cities.amsterdam.areas[r.id];
    assert.equal(reg.sheet, true);
    assert.equal(reg.drawable, false, `${r.id}: TILED_CITY_READY stays false, nothing is reachable`);
  }
  assert.equal(TILED_CITY_READY, false);
  assert.equal(RENDERABLE_WARDS.filter((w) => w.id.startsWith('ams-')).length, 31);
  assert.equal(new Set(RENDERABLE_WARDS.map((w) => w.id)).size, RENDERABLE_WARDS.length, 'ward ids are unique');
});

test('names are the wijk names of area-names.json (CC0), unique, with the credit line carried', () => {
  const seen = new Set();
  for (const r of records.areas) {
    assert.equal(r.name, names.areas[r.code].name, r.code);
    assert.equal(r.nameSource, names.areas[r.code].source);
    assert.ok(!seen.has(r.name), `${r.name} is used twice`);
    seen.add(r.name);
    assert.match(r.provenance.at(-1), new RegExp(`^Name: ${r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(`));
  }
  assert.equal(records.nameCredit, names.credit);
  assert.equal(AMSTERDAM_NAME_CREDIT, names.credit);
  assert.match(AMSTERDAM_NAME_CREDIT, /Gemeente Amsterdam, Kernregistratie gebieden \(CC0 1\.0\)/);
  assert.equal(records.anchor.name, 'Canal Ring');
});

test('surface-meta: every streamed area has a measured row in Canal Ring\'s shape, and veg is its fvc_mean to three places', () => {
  const canalKeys = Object.keys(meta['canal-ring']);
  for (const r of records.areas) {
    const row = meta[r.id];
    assert.ok(row, `${r.id}: no surface-meta row`);
    assert.deepEqual(row, r.surfaceMeta, `${r.id}: the row is the record's`);
    assert.deepEqual(Object.keys(row), canalKeys, `${r.id}: same keys, same order as Canal Ring's row`);
    assert.equal(row.level, 'measured');
    assert.equal(row.grid, 280);
    assert.equal(row.footprint_m, 2800);
    assert.equal(row.sunElevationFloorDeg, 40);
    assert.ok(row.scenes >= 20, `${r.id}: ${row.scenes} scenes`);
    assert.ok(row.fvc_mean > 0 && row.fvc_mean < 1 && row.albedo_mean > 0 && row.albedo_mean < 0.5);
    assert.equal(r.veg, Math.round(row.fvc_mean * 1000) / 1000, `${r.id}: veg is the measured mean to three places`);
  }
  for (const id of ['ballygunge', 'baruipur', 'barrackpore', 'indiranagar', 'mg-road', 'whitefield']) assert.equal(meta[id].sunElevationFloorDeg, undefined, id);
});

test('counts: the DRAWN count is the exported count (not the lattice count); E4\'s is its shipped file\'s', () => {
  const sheetsBuild = json('data/cities/amsterdam/sheets-build.json');
  const byCode = new Map(sheetsBuild.sheets.map((s) => [s.code, s]));
  for (const r of records.areas) {
    const lattice = AMSTERDAM_SHEETS.find((s) => s.id === r.id);
    assert.equal(r.counts.inBox, lattice.buildings, `${r.id}: in-box is the lattice count`);
    assert.equal(r.counts.municipal, lattice.municipalBuildings);
    assert.equal(r.counts.drawn, byCode.get(r.code).buildings, `${r.id}: drawn is sheets-build.json's (what the picker shows)`);
    /* a building cut into parts is one row per part: drawn = in box - slivers + extra parts, each multipart building adds at least one */
    assert.ok(r.counts.drawn >= r.counts.inBox - r.counts.droppedSmall + r.counts.multipart, `${r.id}: drawn is too low`);
    assert.ok(r.counts.drawn > 0 && r.counts.trees > 0);
  }
  const shipped = json('public/heat-map/data/canal-ring.json');
  assert.equal(records.anchor.drawn, shipped.count, 'E4 drawn = canal-ring.json count');
  assert.equal(AMSTERDAM_AREA_FACTS['canal-ring'].drawn, shipped.count);
  assert.equal(byCode.get('E4').buildings, shipped.count, 'the picker reads E4 from sheets-build.json');
  assert.equal(byCode.get('E4').anchor, true);
  assert.equal(sheetsBuild.sheets.length, 32);
});

/* G6 on the 31 rebuilt sheets, the audited rule (CANAL-RING-FIX-AUDIT.md part B), re-derived from each sheet's recorded numbers:
     k0 >= 0.5  and  k0 >= 2 x max(mirror, rot180, 0.1)  and  k0 > every +-10/20 m shift and +-3 degree turn.
   H3 is the tightest at ratio 2.86 here (0.924 against a mirrored 0.323; the audit's local-frame run read 0.927 and 2.87), which is the north-south symmetry
   of the IJmeer water lobe: buildings-only mirrored kappa is -0.009. A factor of 3 would FAIL H3 (0.927 < 0.969), so the factor stays 2. */
test('G6: all 31 streamed areas pass the audited rule, from their recorded kappas (H3 and H7 included)', () => {
  const RATIO = 2, FLOOR = 0.1, MIN = 0.5;
  let tightest = { code: '', ratio: Infinity };
  for (const r of records.areas) {
    const fg = json(`data/cities/amsterdam/${r.id}/frame-guard.json`);
    const g = fg.guards.find((x) => x.id === 'G6');
    const c = g.detail.controls;
    const k0 = g.north, mirror = c.mirror, rot180 = c.rot180;
    const perturbed = Object.entries(c).filter(([k]) => k.startsWith('turn') || k.startsWith('shift')).map(([, v]) => v);
    assert.equal(perturbed.length, 10, `${r.id}: two turns and eight shifts are recorded`);
    assert.ok(k0 >= MIN, `${r.id}: kappa ${k0}`);
    assert.ok(k0 >= RATIO * Math.max(mirror, rot180, FLOOR), `${r.id}: ${k0} vs mirrored ${mirror} / 180 ${rot180}`);
    assert.ok(perturbed.every((p) => k0 > p), `${r.id}: a shifted or turned copy beats the candidate`);
    assert.equal(g.status, 'pass', `${r.id}: recorded status`);
    assert.ok(Math.abs(g.mirrored - mirror) < 6e-4, `${r.id}: recorded mirrored ${g.mirrored} vs control ${mirror}`);
    const ratio = k0 / Math.max(mirror, rot180, FLOOR);
    if (ratio < tightest.ratio) tightest = { code: r.code, ratio };
  }
  assert.equal(tightest.code, 'H3');
  assert.ok(tightest.ratio > 2 && tightest.ratio < 3, `the tightest ratio is ${tightest.ratio}: a factor of 3 would fail it`);
});

test('every record has the provenance lines, and the generator\'s inputs were hashed', () => {
  for (const r of records.areas) {
    assert.ok(r.provenance.length >= 5);
    assert.match(r.provenance[0], /^Footprints and heights: 3D BAG v20250903/);
    assert.match(r.provenance[2], /^Surface: Sentinel-2 L2A, \d+ scenes with the sun at least 40 degrees up/);
  }
  assert.match(records.namesSha256, /^[0-9a-f]{64}$/);
  assert.ok(existsSync(new URL('scripts/build-area-records.py', ROOT)));
});
