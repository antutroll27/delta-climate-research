import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  LAYERS, LAYER_IDS, isLayerId, splitLayerId, layerAvailability, assertLayerLogic,
} from '../../src/scripts/climate-engine/scope/layers.ts';
import { paths, cityPaths } from '../../src/scripts/climate-engine/scope/paths.ts';

test('layer registry invariants hold', () => {
  assertLayerLogic();
});

test('every layer produces an id', () => {
  assert.ok(LAYER_IDS.includes('thermal/surface'));
  assert.ok(LAYER_IDS.includes('ground/street'));
  assert.equal(LAYER_IDS.length, 6);
});

test('isLayerId rejects anything unregistered', () => {
  assert.equal(isLayerId('thermal/surface'), true);
  assert.equal(isLayerId('thermal/typo'), false);
  assert.equal(isLayerId('surface'), false);
  assert.equal(isLayerId(null), false);
});

test('splitLayerId returns the two parts', () => {
  assert.deepEqual(splitLayerId('green/trees'), { group: 'green', item: 'trees' });
});

test('availability is DERIVED from paths, never declared', () => {
  for (const id of LAYER_IDS) {
    const a = layerAvailability(id, 'in/kolkata/ballygunge', { mapillary: true });
    assert.equal(a.available, true, `${id} should be available in Kolkata`);
  }
  for (const id of LAYER_IDS) {
    const a = layerAvailability(id, 'ae/dubai/al-quoz', { mapillary: true });
    if (a.available) continue;
    assert.ok(a.reason && a.reason.length > 0, `${id} must say WHY it is unavailable`);
  }
});

test('a capability layer follows the capability, not the artefacts', () => {
  const on  = layerAvailability('ground/street', 'in/kolkata/ballygunge', { mapillary: true });
  const off = layerAvailability('ground/street', 'in/kolkata/ballygunge', { mapillary: false });
  assert.equal(on.available, true);
  assert.equal(off.available, false);
  assert.match(off.reason, /token|mapillary/i);
});

test('every artefact a layer needs is a real path key', () => {
  const areaKeys = new Set(Object.keys(paths('in/kolkata/ballygunge')));
  const cityKeys = new Set(Object.keys(cityPaths('in/kolkata/ballygunge')));
  let checked = 0;
  for (const id of LAYER_IDS) {
    const { group, item } = splitLayerId(id);
    const needs = LAYERS[group].items[item].needs;
    if (typeof needs !== 'string') continue;
    assert.ok(areaKeys.has(needs) || cityKeys.has(needs),
      `${id} needs "${needs}", which is not a key of AreaPaths or CityPaths`);
    checked += 1;
  }
  assert.equal(checked, 5, 'expected 5 artefact-backed layers of 6');
});

test('no layer declares a city list', async () => {
  const src = await readFile(
    new URL('../../src/scripts/climate-engine/scope/layers.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
  for (const banned of ['kolkata', 'dubai', 'ballygunge', 'baruipur', 'barrackpore']) {
    assert.ok(!new RegExp(`\\b${banned}\\b`, 'i').test(code),
      `layers.ts names "${banned}" -- availability must be derived, not declared`);
  }
});
