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
  let refused = 0;
  for (const id of LAYER_IDS) {
    const a = layerAvailability(id, 'ae/dubai/al-quoz', { mapillary: true });
    if (a.available) continue;
    assert.ok(a.reason && a.reason.length > 0, `${id} must say WHY it is unavailable`);
    refused += 1;
  }
  /* GUARD THE GUARD. The loop above `continue`s past anything available, so an
     implementation that returned available:true for everything would make it
     assert NOTHING and pass — the exact shape this suite exists to catch, found
     by the Task 1 implementer inside the test as originally specified. Dubai
     ships no artefacts, so the five artefact-backed layers MUST refuse; only the
     capability-backed one may pass with a token present. */
  assert.equal(refused, 5,
    'Dubai ships no artefacts, so 5 of 6 layers must refuse — if this is 0, the '
    + 'loop above checked nothing');
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

test('no stylesheet writes a colour a token already declares', async () => {
  /* #6fcad6 appeared FOUR times longhand beside `--cyan: #6fcad6`. A colour with
     two spellings drifts the moment someone edits one -- the CSS form of the
     defect this migration exists to end. */
  const files = [
    'src/components/ClimateEngine/HeatMapStage.astro',
    'src/components/ClimateEngine/shell/IconRail.astro',
    'src/components/ClimateEngine/shell/ScopeSwitcher.astro',
    'src/components/ClimateEngine/shell/LayerTree.astro',
    'src/components/ClimateEngine/shell/InterventionPane.astro',
  ];
  const offences = [];
  for (const rel of files) {
    let src;
    try { src = await readFile(new URL(`../../${rel}`, import.meta.url), 'utf8'); }
    catch { continue; }                       // component not created yet
    const decl = new Map();
    for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) {
      decl.set(m[2].toLowerCase(), m[1]);
    }
    for (const [hex, token] of decl) {
      const n = [...src.matchAll(new RegExp(hex, 'gi'))].length - 1;
      if (n > 0) offences.push(`${rel}: ${hex} written longhand ${n}x beside ${token}`);
    }
  }
  assert.deepEqual(offences, []);
});

test('the new components use scoped styles, and never :global inside is:global', async () => {
  /* The stage's 581-line block is is:global for a REAL reason: MapLibre injects
     its own DOM and heat-map-app.ts re-classes elements at runtime, and Astro's
     scoping hash only reaches markup Astro rendered. That reason does not extend
     to a rail, a switcher and a tree, which are static -- so they scope, and the
     global surface SHRINKS rather than grows.

     The second half matters more than it looks: a :global(...) written INSIDE an
     is:global block ships verbatim and the browser discards the whole rule.
     HeatMapStage.astro already carries two comments warning about it. */
  const shell = ['IconRail', 'ScopeSwitcher', 'LayerTree', 'InterventionPane'];
  for (const name of shell) {
    let src;
    try {
      src = await readFile(new URL(
        `../../src/components/ClimateEngine/shell/${name}.astro`, import.meta.url), 'utf8');
    } catch { continue; }                     // not created yet
    // InterventionPane is the documented exception: it holds runtime-classed ids.
    if (name !== 'InterventionPane') {
      assert.ok(!/<style\s+is:global/.test(src),
        `${name}.astro uses is:global -- its markup is static, so it can scope`);
    }
    for (const [, attrs, body] of src.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)) {
      if (!attrs.includes('is:global')) continue;
      assert.ok(!/:global\(/.test(body),
        `${name}.astro writes :global() inside an is:global block -- it ships `
        + 'verbatim and the browser discards the entire rule');
    }
  }
});
