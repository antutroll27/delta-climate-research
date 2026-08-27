import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REGISTRY, AREA_KEYS, isAreaKey, splitKey, assertRegistryLogic,
} from '../../src/scripts/climate-engine/scope/registry.ts';
import { WARDS as WARD_TABLE } from '../../src/data/wards.ts';

test('registry invariants hold', () => {
  assertRegistryLogic();
});

test('every registered area produces a key', () => {
  assert.ok(AREA_KEYS.includes('in/kolkata/ballygunge'));
  assert.ok(AREA_KEYS.includes('ae/dubai/al-quoz'));
  assert.equal(AREA_KEYS.length, 6);
});

test('isAreaKey rejects anything not registered', () => {
  assert.equal(isAreaKey('in/kolkata/ballygunge'), true);
  assert.equal(isAreaKey('in/kolkata/typo'), false);
  assert.equal(isAreaKey('ballygunge'), false);
  assert.equal(isAreaKey(''), false);
  assert.equal(isAreaKey(null), false);
});

test('splitKey returns the three parts', () => {
  assert.deepEqual(splitKey('in/kolkata/ballygunge'),
    { country: 'in', city: 'kolkata', area: 'ballygunge' });
});

test('Kolkata ships data and Dubai does not', () => {
  assert.equal(REGISTRY.in.cities.kolkata.areas.ballygunge.shipsData, true);
  assert.equal(REGISTRY.ae.cities.dubai.areas['al-quoz'].shipsData, false);
});

test('the registry does not become a fourth ward table', () => {
  // src/data/wards.ts is THE area table. scripts/_types.py mirrors it, and records
  // that five scripts once carried private copies which had already diverged --
  // one by 10-44 m of coordinate. Every data-shipping area must exist there, and
  // Kolkata's ids must match it exactly.
  const tableIds = WARD_TABLE.map((w) => w.id).sort();
  const kolkata = Object.keys(REGISTRY.in.cities.kolkata.areas).sort();
  assert.deepEqual(kolkata, tableIds);
  for (const key of AREA_KEYS) {
    const { country, city, area } = splitKey(key);
    if (REGISTRY[country].cities[city].areas[area].shipsData) {
      assert.ok(tableIds.includes(area), `${key} ships data but is not in src/data/wards.ts`);
    }
  }
});

test('the registry restates no geography', async () => {
  // Geography lives in src/data/wards.ts alone. If it appears here too, the two
  // can silently disagree -- which is the failure this whole design exists to stop.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(
    new URL('../../src/scripts/climate-engine/scope/registry.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const banned of ['lat', 'lon', 'footprintM', 'veg']) {
    assert.ok(!new RegExp(`\\b${banned}\\s*:`).test(code),
      `registry.ts declares "${banned}" — geography belongs in src/data/wards.ts only`);
  }
});
