import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

import { WARDS, RENDERABLE_WARDS, wardLatLon } from '../../src/data/wards.ts';
import { wardsOfCity } from '../../src/data/cities.ts';
import {
  AMSTERDAM_SHEETS, AMSTERDAM_SKIPPED_SHEETS, AMSTERDAM_SHEET_AREAS, AMSTERDAM_SHEET_LATTICE, AMSTERDAM_SHEET_IDS,
} from '../../src/data/sheets/amsterdam.ts';
import {
  REGISTRY, AREA_KEYS, PUBLIC_AREA_KEYS, areaKeysInCity, isDrawable, isPublicArea, nextDistinctArea,
  assertRegistryLogic, sheetFlagProblems,
} from '../../src/scripts/climate-engine/scope/registry.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { paths } from '../../src/scripts/climate-engine/scope/paths.ts';
import { publicAreaPaths, areaPageIndexable } from '../../src/scripts/climate-engine/scope/public-routes.ts';
import {
  SHEETS, SKIPPED_SHEETS, codeOf, cellOf, neighbours, sheetByCode, sheetOf, sheetKey, sheetKeysInCity,
  sheetIndex, isTiledCity, registeredSheetKeys,
} from '../../src/scripts/climate-engine/scope/sheets.ts';

/* CITY STREAMING, PHASE P1 (graticule rework): the sheet table, the registry reading it, and the list surfaces.
   A sheet is Canal Ring's own lon/lat box, repeated; RD New is the ingest CRS only.
   The table is GENERATED (scripts/_sheets.py); these tests pin its shape and the promise that no
   sheet is drawable, public or listed yet. `python3 scripts/_sheets.py --check` pins the other half
   (TS bytes == what the generator renders from the JSON). */

const ROOT = new URL('../../', import.meta.url);
const table = JSON.parse(readFileSync(new URL('data/cities/amsterdam/sheets.json', ROOT), 'utf8'));
const CANAL = 'nl/amsterdam/canal-ring';
const sheetAreaKeys = SHEETS.filter((s) => s.id !== 'canal-ring').map(sheetKey);

test('the table has the planned shape: 36 shipping sheets (23 core, 13 edge), 17 skipped, on a graticule lattice', () => {
  assert.deepEqual(Object.keys(table),
    ['city', 'lattice', 'shipRule', 'method', 'sources', 'sheets', 'skipped', 'totals']);
  assert.equal(table.city, 'amsterdam');
  assert.equal(table.sheets.length, 36);
  assert.equal(table.sheets.filter((s) => s.kind === 'core').length, 23);
  assert.equal(table.sheets.filter((s) => s.kind === 'edge').length, 13);
  assert.equal(table.skipped.length, 17);
  assert.equal(table.sheets.length + table.skipped.length, 53, 'the municipality touches 53 lattice cells');
  assert.equal(table.totals.shipping, 36);
  assert.equal(table.totals.core + table.totals.edge, 36);
  assert.deepEqual(table.shipRule, { minBuildings: 500, minMunicipalShare: 0.1, coreMinBuildings: 2000 });
  assert.equal(table.lattice.kind, 'graticule');
  assert.equal(table.lattice.ingestCrs, 'EPSG:28992', 'RD New is the ingest CRS, not the lattice');
  assert.equal(table.lattice.frameLat, 52.364, "every sheet's frame uses E4's latitude as its standard parallel");
  for (const s of table.sheets) {
    assert.deepEqual(Object.keys(s), ['id', 'code', 'i', 'j', 'kind', 'buildingsEst', 'municipalShare',
      'stadsdeel', 'label', 'wgs84Bounds', 'rdQuad', 'centre'], s.code);
    assert.equal(s.wgs84Bounds.length, 4);
    assert.equal(s.rdQuad.length, 8);
    const [w, so, e, n] = s.wgs84Bounds;
    /* every sheet is the same lon/lat box translated: 2,800 m in the shared frame (E4's standard parallel) */
    assert.ok(Math.abs((e - w) - table.lattice.dLon) < 1e-12 && Math.abs((n - so) - table.lattice.dLat) < 1e-12, `${s.code} is one lattice box`);
    assert.ok(Math.abs((e - w) * table.lattice.mPerDegLon - 2800) < 1e-6, `${s.code} is 2.8 km east-west in the frame`);
    assert.ok(Math.abs((n - so) * table.lattice.mPerDegLat - 2800) < 1e-6, `${s.code} is 2.8 km north-south in the frame`);
    assert.ok(w < s.centre.lon && s.centre.lon < e, `${s.code} centre inside its box`);
    assert.ok(so < s.centre.lat && s.centre.lat < n, `${s.code} centre inside its box`);
    assert.ok(s.buildingsEst >= 500 && s.municipalShare >= 0.1, `${s.code} meets the ship rule`);
    assert.equal(s.kind, s.buildingsEst >= 2000 ? 'core' : 'edge', s.code);
  }
  for (const k of table.skipped) {
    assert.ok(k.buildingsEst < 500 || k.municipalShare < 0.1, `${k.code} fails the ship rule`);
  }
});

test('the generated TypeScript module carries the JSON table exactly (the drift test)', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(AMSTERDAM_SHEETS)), table.sheets);
  assert.deepEqual(JSON.parse(JSON.stringify(AMSTERDAM_SKIPPED_SHEETS)), table.skipped);
  assert.equal(AMSTERDAM_SHEET_LATTICE.sizeM, table.lattice.sizeM);
  assert.deepEqual([...AMSTERDAM_SHEET_LATTICE.anchorBox], table.lattice.anchorBox);
  assert.deepEqual(
    [AMSTERDAM_SHEET_LATTICE.frameLat, AMSTERDAM_SHEET_LATTICE.dLon, AMSTERDAM_SHEET_LATTICE.dLat, AMSTERDAM_SHEET_LATTICE.mPerDegLon],
    [table.lattice.frameLat, table.lattice.dLon, table.lattice.dLat, table.lattice.mPerDegLon]);
  assert.equal(AMSTERDAM_SHEET_LATTICE.anchor.code, table.lattice.anchor.code);
  assert.deepEqual([...AMSTERDAM_SHEET_IDS], table.sheets.map((s) => s.id), 'the id list the registry check reads');
  assert.deepEqual(Object.keys(AMSTERDAM_SHEET_AREAS).sort(),
    table.sheets.map((s) => s.id).filter((id) => id !== 'canal-ring').sort());
});

test('ids are unique, `ams-<code>`, and E4 alone keeps `canal-ring`', () => {
  const ids = SHEETS.map((s) => s.id);
  assert.equal(new Set(ids).size, 36);
  assert.equal(new Set(SHEETS.map((s) => s.code)).size, 36);
  for (const s of SHEETS) {
    if (s.code === 'E4') continue;
    assert.equal(s.id, `ams-${s.code.toLowerCase()}`);
    assert.match(s.id, /^ams-[a-j][1-7]$/);
  }
  assert.equal(ids.filter((id) => !id.startsWith('ams-')).length, 1);
});

test('E4 IS Canal Ring: same id, same lattice origin cell, and the same BOX (not merely the same centre)', () => {
  const e4 = sheetByCode('E4');
  assert.equal(e4.id, 'canal-ring');
  assert.deepEqual([e4.i, e4.j], [0, 0]);
  assert.equal(sheetKey(e4), CANAL);
  assert.equal(sheetOf(CANAL).code, 'E4');
  const ward = RENDERABLE_WARDS.find((w) => w.id === 'canal-ring');
  assert.equal(ward.footprintM, 2800, 'a sheet is the existing 2.8 km square');
  assert.equal(e4.label, 'E4 · Canal Ring');
  /* The centre is Canal Ring's own, exactly (it is the lattice origin, not a rounded projection of it). */
  assert.deepEqual([e4.centre.lat, e4.centre.lon], [ward.lat, ward.lon]);
  /* The BOX. The Python check holds E4 bit-equal to scripts/_city.bounds(canal-ring); this is its TS twin through
     wardLatLon, which does the same arithmetic (origin + metres / (111320 cos lat), origin + metres / 110540). It is
     compared at 1e-12 degrees (0.1 micrometre) only because JS and C libm may differ in the last bit of cos(). */
  const half = ward.footprintM / 2;
  const sw = wardLatLon(ward, -half, -half);
  const ne = wardLatLon(ward, half, half);
  const [w, s, e, n] = e4.wgs84Bounds;
  for (const [got, want, name] of [[w, sw.lon, 'west'], [s, sw.lat, 'south'], [e, ne.lon, 'east'], [n, ne.lat, 'north']]) {
    assert.ok(Math.abs(got - want) < 1e-12, `E4 ${name} ${got} vs Canal Ring ${want}`);
  }
  assert.deepEqual([...AMSTERDAM_SHEET_LATTICE.anchorBox], e4.wgs84Bounds, 'the lattice anchor box is E4 box');
});

test('the lattice is exact: shared edges are bit-equal floats, each box is the formula of its (i, j)', () => {
  const L = AMSTERDAM_SHEET_LATTICE;
  const byCell = new Map(SHEETS.map((x) => [`${x.i},${x.j}`, x]));
  let pairs = 0;
  for (const x of SHEETS) {
    const east = byCell.get(`${x.i + 1},${x.j}`);
    if (east !== undefined) {
      pairs++;
      assert.equal(x.wgs84Bounds[2], east.wgs84Bounds[0], `${x.code} | ${east.code}: shared meridian`);
      assert.equal(x.wgs84Bounds[1], east.wgs84Bounds[1], `${x.code} | ${east.code}: same south parallel`);
      assert.equal(x.wgs84Bounds[3], east.wgs84Bounds[3], `${x.code} | ${east.code}: same north parallel`);
    }
    const north = byCell.get(`${x.i},${x.j + 1}`);
    if (north !== undefined) {
      pairs++;
      assert.equal(x.wgs84Bounds[3], north.wgs84Bounds[1], `${x.code} / ${north.code}: shared parallel`);
      assert.equal(x.wgs84Bounds[0], north.wgs84Bounds[0], `${x.code} / ${north.code}: same west meridian`);
      assert.equal(x.wgs84Bounds[2], north.wgs84Bounds[2], `${x.code} / ${north.code}: same east meridian`);
    }
    /* the one formula, in TS (the Python generator is the authority; this holds the stored floats to it at 1e-12) */
    const [lon0, lat0] = [L.anchor.centre.lon, L.anchor.centre.lat];
    const want = [lon0 + (x.i - 0.5) * L.dLon, lat0 + (x.j - 0.5) * L.dLat, lon0 + (x.i + 0.5) * L.dLon, lat0 + (x.j + 0.5) * L.dLat];
    x.wgs84Bounds.forEach((v, k) => assert.ok(Math.abs(v - want[k]) < 1e-12, `${x.code} edge ${k}`));
  }
  assert.ok(pairs > 40, `the table has ${pairs} adjacent pairs`);
});

test('the lattice maths: 70 cells round-trip, row 1 is north, column A is west', () => {
  const seen = new Set();
  for (let j = 3; j >= -3; j--) {
    for (let i = -4; i <= 5; i++) {
      const code = codeOf(i, j);
      assert.deepEqual(cellOf(code), [i, j]);
      seen.add(code);
    }
  }
  assert.equal(seen.size, 70);
  assert.equal(codeOf(0, 0), 'E4');
  assert.equal(codeOf(-5, 0), null);
  assert.equal(codeOf(0, 4), null);
  assert.equal(codeOf(6, 0), null);
  assert.equal(codeOf(0, -4), null);
  for (const bad of ['K1', 'A0', 'A8', 'E', 'e4', '', 'E44']) assert.equal(cellOf(bad), null, bad);
  assert.ok(sheetByCode('E2').centre.lat > sheetByCode('E6').centre.lat, 'row 2 is north of row 6');
  assert.ok(sheetByCode('H4').centre.lon > sheetByCode('C4').centre.lon, 'column H is east of column C');
});

test('neighbours: eight around Canal Ring, fewer at the edge, none that do not ship', () => {
  assert.deepEqual(neighbours('E4').map((s) => s.code), ['D3', 'E3', 'F3', 'D4', 'F4', 'D5', 'E5', 'F5']);
  const corner = neighbours('J7').map((s) => s.code);
  assert.ok(corner.length < 8 && corner.every((c) => sheetByCode(c) !== undefined), String(corner));
  assert.deepEqual(neighbours('A1').map((s) => s.code), ['B2'], 'A1 is skipped; its one shipping neighbour is B2');
  assert.equal(sheetByCode('J7'), undefined, 'J7 fell under 500 estimated buildings on the graticule lattice');
  assert.deepEqual(neighbours('nonsense'), []);
});

test('NO SHEET IS DRAWABLE, PUBLIC, PUBLISHED OR ROUTED (only Canal Ring is, as before)', () => {
  assert.equal(sheetAreaKeys.length, 35);
  for (const key of sheetAreaKeys) {
    const [country, city, area] = key.split('/');
    const entry = REGISTRY[country].cities[city].areas[area];
    assert.equal(entry.drawable, false, `${key} must not be drawable`);
    assert.equal(entry.shipsData, false, `${key} must not ship data`);
    assert.equal(entry.sheet, true, `${key} is flagged as a sheet`);
    assert.equal(isDrawable(country, city, area), false, key);
    assert.equal(isPublicArea(key), false, key);
    assert.ok(!PUBLIC_AREA_KEYS.includes(key), key);
    assert.ok(!publicAreaPaths().some((p) => p.includes(`/${area}/`)), `${key} has a route`);
    assert.equal(areaPageIndexable(`/heat-map/${key}/`), false, `${key} is in the sitemap`);
    assert.equal(paths(key), null, `${key} has artefact URLs`);
    const scope = resolve(key);
    assert.equal(scope.area.hasData, false, key);
    assert.equal(scope.area.publishes, false, key);
    assert.equal(scope.tier, 'geometry', `${key}: D10, geometry tier and noindex`);
    assert.ok(!WARDS.some((w) => w.id === area), `${key} is in the published ward table`);
    assert.ok(!wardsOfCity('amsterdam').some((w) => w.id === area), `${key} is in the renderable ward table`);
  }
  assert.equal(REGISTRY.nl.cities.amsterdam.areas['canal-ring'].sheet, undefined, 'E4 is not flagged: it is written by hand');
  assert.deepEqual(REGISTRY.nl.cities.amsterdam.areas['canal-ring'], { shipsData: false, drawable: true });
  assert.equal(PUBLIC_AREA_KEYS.length, 7, 'Kolkata 3 + Bengaluru 3 + Canal Ring');
  assert.equal(AREA_KEYS.length, 45);
  assert.deepEqual(PUBLIC_AREA_KEYS.filter((k) => k.startsWith('nl/')), [CANAL]);
  assertRegistryLogic();
});

test('every sheet is named by the lattice code and, because the stadsdeel boundary is CC0, the district', () => {
  for (const key of sheetAreaKeys) {
    const s = sheetOf(key);
    const scope = resolve(key);
    assert.equal(scope.area.name, `${s.code} · ${s.stadsdeel}`);
    assert.equal(scope.area.name, s.label);
    assert.match(scope.area.descriptor, /^sheet · (core|edge) · our tiling$/);
  }
  assert.deepEqual([...new Set(SHEETS.map((s) => s.stadsdeel))].sort(),
    ['Centrum', 'Nieuw-West', 'Noord', 'Oost', 'West', 'Weesp', 'Westpoort', 'Zuid', 'Zuidoost'].sort());
  const evidence = new URL('docs/evidence/2026-11-07-amsterdam-stadsdelen-licence.md', ROOT);
  assert.ok(existsSync(evidence), 'the licence finding is recorded');
  assert.match(readFileSync(evidence, 'utf8'), /CC0|CC-0/);
});

test('LIST SURFACES DO NOT CHANGE: no area list grows, every other city is exactly as it was', () => {
  assert.deepEqual(areaKeysInCity(CANAL), [CANAL]);
  assert.equal(nextDistinctArea(CANAL), null, 'Canal Ring still has no sibling to compare with');
  assert.deepEqual(areaKeysInCity('in/kolkata/baruipur'),
    ['in/kolkata/ballygunge', 'in/kolkata/baruipur', 'in/kolkata/barrackpore']);
  assert.deepEqual(areaKeysInCity('in/bengaluru/mg-road'),
    ['in/bengaluru/indiranagar', 'in/bengaluru/mg-road', 'in/bengaluru/whitefield']);
  assert.equal(areaKeysInCity('ae/dubai/creek').length, 3, 'Dubai is still listed to the scope code');
  /* A sheet key still lists itself, so "including the key itself" holds. */
  assert.deepEqual(areaKeysInCity('nl/amsterdam/ams-f4'), [CANAL, 'nl/amsterdam/ams-f4']);
});

test('the sheet-index data model: 70 cells, the current sheet and its neighbours marked, null for other cities', () => {
  const idx = sheetIndex(CANAL);
  assert.equal(idx.columns, 'ABCDEFGHIJ');
  assert.equal(idx.rows, 7);
  assert.equal(idx.cells.length, 70);
  assert.deepEqual(idx.counts, { core: 23, edge: 13, skipped: 17, shipping: 36 });
  assert.equal(idx.current.code, 'E4');
  assert.equal(idx.cells[0].code, 'A1');
  assert.equal(idx.cells[69].code, 'J7');
  assert.equal(idx.cells.filter((c) => c.current).length, 1);
  assert.deepEqual(idx.cells.filter((c) => c.neighbour).map((c) => c.code), ['D3', 'E3', 'F3', 'D4', 'F4', 'D5', 'E5', 'F5']);
  const count = (state) => idx.cells.filter((c) => c.state === state).length;
  assert.equal(count('core'), 23);
  assert.equal(count('edge'), 13);
  assert.equal(count('skipped'), 17);
  assert.equal(count('outside'), 17);
  for (const c of idx.cells) {
    assert.equal(c.key !== null, c.state === 'core' || c.state === 'edge', c.code);
    assert.equal(c.col, c.i + 4);
    assert.equal(c.row, 3 - c.j);
  }
  assert.equal(sheetIndex('nl/amsterdam/ams-f4').current.code, 'F4');
  assert.equal(sheetIndex('in/kolkata/ballygunge'), null);
  assert.equal(sheetIndex('ae/dubai/creek'), null);
  assert.equal(isTiledCity(CANAL), true);
  assert.equal(isTiledCity('in/bengaluru/mg-road'), false);
  assert.deepEqual(sheetKeysInCity('in/kolkata/ballygunge'), []);
  assert.equal(sheetKeysInCity(CANAL).length, 36);
});

test('the registry and the table name the same 36 sheets, in both directions', () => {
  assert.deepEqual([...registeredSheetKeys()].sort(), SHEETS.map(sheetKey).sort());
  assert.deepEqual([...sheetKeysInCity(CANAL)].sort(), [...registeredSheetKeys()].sort());
  assert.equal(SKIPPED_SHEETS.length, 17);
  for (const k of SKIPPED_SHEETS) assert.ok(!AREA_KEYS.some((key) => key.endsWith(`/ams-${k.code.toLowerCase()}`)), `${k.code} skipped, not registered`);
});

test('the building field is named as an estimate, and the 36 carry nearly all the municipality', () => {
  assert.ok(!('buildings' in table.sheets[0]));
  assert.match(table.method, /ESTIMATE/);
  const t = table.totals;
  assert.equal(t.buildingsEstShipping + t.buildingsEstSkipped, t.buildingsEstMunicipal);
  assert.ok(t.buildingsEstShipping / t.buildingsEstMunicipal > 0.985, 'the 36 hold at least 98.5 % of the municipal buildings');
  assert.ok(Math.abs(sheetByCode('E4').buildingsEst - 21342) / 21342 < 0.01, 'E4 within 1 % of the buildings Canal Ring ships (0.4 % measured)');
});

test('F2: the `sheet` flag only appears on a tiled city\'s sheets (and every generated sheet carries it)', () => {
  assert.deepEqual(sheetFlagProblems(REGISTRY, { 'nl/amsterdam': AMSTERDAM_SHEET_IDS }, 'canal-ring'), [], 'the live registry agrees');
  const tiled = { 'nl/amsterdam': ['canal-ring', 'ams-f4'] };
  const tree = (areas) => ({ nl: { cities: { amsterdam: { areas } } }, in: { cities: { kolkata: { areas: { ballygunge: {} } } } } });
  const good = tree({ 'canal-ring': {}, 'ams-f4': { sheet: true } });
  assert.deepEqual(sheetFlagProblems(good, tiled, 'canal-ring'), []);
  /* a flag on a Kolkata ward would silently drop it from every list */
  const kolkata = { ...good, in: { cities: { kolkata: { areas: { ballygunge: { sheet: true } } } } } };
  assert.match(sheetFlagProblems(kolkata, tiled, 'canal-ring').join('\n'), /in\/kolkata\/ballygunge.*not a tiled city/);
  /* a flag on an Amsterdam area that is not in the table */
  assert.match(sheetFlagProblems(tree({ 'canal-ring': {}, 'ams-f4': { sheet: true }, 'ams-zz': { sheet: true } }), tiled, 'canal-ring').join('\n'), /ams-zz.*not in the sheet table/);
  /* a flag on the anchor: E4 is written by hand, unflagged */
  assert.match(sheetFlagProblems(tree({ 'canal-ring': { sheet: true }, 'ams-f4': { sheet: true } }), tiled, 'canal-ring').join('\n'), /anchor sheet/);
  /* a generated sheet that lost its flag would join the area lists; a sheet missing from the registry is drift */
  assert.match(sheetFlagProblems(tree({ 'canal-ring': {}, 'ams-f4': {} }), tiled, 'canal-ring').join('\n'), /ams-f4.*not flagged/);
  assert.match(sheetFlagProblems(tree({ 'canal-ring': {} }), tiled, 'canal-ring').join('\n'), /ams-f4.*not registered/);
});
