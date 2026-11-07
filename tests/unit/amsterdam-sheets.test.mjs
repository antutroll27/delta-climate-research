import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

import { WARDS, RENDERABLE_WARDS } from '../../src/data/wards.ts';
import { wardsOfCity } from '../../src/data/cities.ts';
import {
  AMSTERDAM_SHEETS, AMSTERDAM_SKIPPED_SHEETS, AMSTERDAM_SHEET_AREAS, AMSTERDAM_SHEET_LATTICE,
} from '../../src/data/sheets/amsterdam.ts';
import {
  REGISTRY, AREA_KEYS, PUBLIC_AREA_KEYS, areaKeysInCity, isDrawable, isPublicArea, nextDistinctArea,
  assertRegistryLogic,
} from '../../src/scripts/climate-engine/scope/registry.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { paths } from '../../src/scripts/climate-engine/scope/paths.ts';
import { publicAreaPaths, areaPageIndexable } from '../../src/scripts/climate-engine/scope/public-routes.ts';
import {
  SHEETS, SKIPPED_SHEETS, codeOf, cellOf, neighbours, sheetByCode, sheetOf, sheetKey, sheetKeysInCity,
  sheetIndex, isTiledCity, registeredSheetKeys,
} from '../../src/scripts/climate-engine/scope/sheets.ts';

/* CITY STREAMING, PHASE P1: the sheet table, the registry reading it, and the list surfaces.
   The table is GENERATED (scripts/_sheets.py); these tests pin its shape and the promise that no
   sheet is drawable, public or listed yet. `python3 scripts/_sheets.py --check` pins the other half
   (TS bytes == what the generator renders from the JSON). */

const ROOT = new URL('../../', import.meta.url);
const table = JSON.parse(readFileSync(new URL('data/cities/amsterdam/sheets.json', ROOT), 'utf8'));
const CANAL = 'nl/amsterdam/canal-ring';
const sheetAreaKeys = SHEETS.filter((s) => s.id !== 'canal-ring').map(sheetKey);

test('the table has the planned shape and count: 37 shipping sheets, 25 core and 12 edge, 17 skipped', () => {
  assert.deepEqual(Object.keys(table),
    ['city', 'lattice', 'shipRule', 'method', 'sources', 'sheets', 'skipped', 'totals']);
  assert.equal(table.city, 'amsterdam');
  assert.equal(table.sheets.length, 37);
  assert.equal(table.sheets.filter((s) => s.kind === 'core').length, 25);
  assert.equal(table.sheets.filter((s) => s.kind === 'edge').length, 12);
  assert.equal(table.skipped.length, 17);
  assert.equal(table.sheets.length + table.skipped.length, 54, 'the municipality touches 54 lattice cells');
  assert.equal(table.totals.shipping, 37);
  assert.equal(table.totals.core + table.totals.edge, 37);
  assert.deepEqual(table.shipRule, { minBuildings: 500, minMunicipalShare: 0.1, coreMinBuildings: 2000 });
  for (const s of table.sheets) {
    assert.deepEqual(Object.keys(s), ['id', 'code', 'i', 'j', 'kind', 'buildingsEst', 'municipalShare',
      'stadsdeel', 'label', 'rdBounds', 'wgs84Bounds', 'centre'], s.code);
    assert.equal(s.rdBounds.length, 4);
    assert.equal(s.wgs84Bounds.length, 4);
    assert.ok(Math.abs(s.rdBounds[2] - s.rdBounds[0] - 2800) < 1e-6, `${s.code} is a 2.8 km RD square (x)`);
    assert.ok(Math.abs(s.rdBounds[3] - s.rdBounds[1] - 2800) < 1e-6, `${s.code} is a 2.8 km RD square (y)`);
    assert.ok(s.wgs84Bounds[0] < s.centre.lon && s.centre.lon < s.wgs84Bounds[2], `${s.code} centre inside its envelope`);
    assert.ok(s.wgs84Bounds[1] < s.centre.lat && s.centre.lat < s.wgs84Bounds[3], `${s.code} centre inside its envelope`);
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
  assert.deepEqual([...AMSTERDAM_SHEET_LATTICE.originRd], table.lattice.originRd);
  assert.equal(AMSTERDAM_SHEET_LATTICE.anchor.code, table.lattice.anchor.code);
  assert.deepEqual(Object.keys(AMSTERDAM_SHEET_AREAS).sort(),
    table.sheets.map((s) => s.id).filter((id) => id !== 'canal-ring').sort());
});

test('ids are unique, `ams-<code>`, and E4 alone keeps `canal-ring`', () => {
  const ids = SHEETS.map((s) => s.id);
  assert.equal(new Set(ids).size, 37);
  assert.equal(new Set(SHEETS.map((s) => s.code)).size, 37);
  for (const s of SHEETS) {
    if (s.code === 'E4') continue;
    assert.equal(s.id, `ams-${s.code.toLowerCase()}`);
    assert.match(s.id, /^ams-[a-j][1-7]$/);
  }
  assert.equal(ids.filter((id) => !id.startsWith('ams-')).length, 1);
});

test('E4 IS Canal Ring: same id, same lattice origin cell, same centre as the shipped area', () => {
  const e4 = sheetByCode('E4');
  assert.equal(e4.id, 'canal-ring');
  assert.deepEqual([e4.i, e4.j], [0, 0]);
  assert.equal(sheetKey(e4), CANAL);
  assert.equal(sheetOf(CANAL).code, 'E4');
  const ward = RENDERABLE_WARDS.find((w) => w.id === 'canal-ring');
  /* 1e-5 degrees is 1.1 m of latitude: the RD centre is rounded to 0.1 m and the ward row to 4 decimals. */
  assert.ok(Math.abs(e4.centre.lat - ward.lat) < 1e-5 && Math.abs(e4.centre.lon - ward.lon) < 1e-5,
    `E4 centre ${e4.centre.lat}, ${e4.centre.lon} vs Canal Ring ${ward.lat}, ${ward.lon}`);
  assert.equal(ward.footprintM, 2800, 'a sheet is the existing 2.8 km square');
  assert.equal(e4.label, 'E4 · Canal Ring');
  assert.deepEqual(e4.rdBounds, [119393.2, 484953.2, 122193.2, 487753.2]);
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
  assert.deepEqual(neighbours('nonsense'), []);
});

test('NO SHEET IS DRAWABLE, PUBLIC, PUBLISHED OR ROUTED (only Canal Ring is, as before)', () => {
  assert.equal(sheetAreaKeys.length, 36);
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
  assert.equal(AREA_KEYS.length, 46);
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
  assert.deepEqual(idx.counts, { core: 25, edge: 12, skipped: 17, shipping: 37 });
  assert.equal(idx.current.code, 'E4');
  assert.equal(idx.cells[0].code, 'A1');
  assert.equal(idx.cells[69].code, 'J7');
  assert.equal(idx.cells.filter((c) => c.current).length, 1);
  assert.deepEqual(idx.cells.filter((c) => c.neighbour).map((c) => c.code), ['D3', 'E3', 'F3', 'D4', 'F4', 'D5', 'E5', 'F5']);
  const count = (state) => idx.cells.filter((c) => c.state === state).length;
  assert.equal(count('core'), 25);
  assert.equal(count('edge'), 12);
  assert.equal(count('skipped'), 17);
  assert.equal(count('outside'), 16);
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
  assert.equal(sheetKeysInCity(CANAL).length, 37);
});

test('the registry and the table name the same 37 sheets, in both directions', () => {
  assert.deepEqual([...registeredSheetKeys()].sort(), SHEETS.map(sheetKey).sort());
  assert.deepEqual([...sheetKeysInCity(CANAL)].sort(), [...registeredSheetKeys()].sort());
  assert.equal(SKIPPED_SHEETS.length, 17);
  for (const k of SKIPPED_SHEETS) assert.ok(!AREA_KEYS.some((key) => key.endsWith(`/ams-${k.code.toLowerCase()}`)), `${k.code} skipped, not registered`);
});

test('the building field is named as an estimate, and the 37 carry nearly all the municipality', () => {
  assert.ok(!('buildings' in table.sheets[0]));
  assert.match(table.method, /ESTIMATE/);
  const t = table.totals;
  assert.equal(t.buildingsEstShipping + t.buildingsEstSkipped, t.buildingsEstMunicipal);
  assert.ok(t.buildingsEstShipping / t.buildingsEstMunicipal > 0.985, 'the 37 hold at least 98.5 % of the municipal buildings');
  assert.ok(Math.abs(sheetByCode('E4').buildingsEst - 21342) / 21342 < 0.02, 'E4 within 2 % of the buildings Canal Ring ships');
});
