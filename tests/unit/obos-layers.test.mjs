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
  const reasons = new Set();
  for (const id of LAYER_IDS) {
    const a = layerAvailability(id, 'ae/dubai/al-quoz', { mapillary: true });
    if (a.available) continue;
    assert.ok(a.reason && a.reason.length > 0, `${id} must say WHY it is unavailable`);
    reasons.add(a.reason);
    refused += 1;
  }
  /* GUARD THE GUARD. The loop above `continue`s past anything available, so an
     implementation that returned available:true for everything would make it
     assert NOTHING and pass — the exact shape this suite exists to catch, found
     by the Task 1 implementer inside the test as originally specified.

     SIX, NOT FIVE, AND THE CHANGE IS THE POINT. It was five: the five
     artefact-backed layers refused and the capability-backed one passed on the
     token alone. That was a DEAD CONTROL — an area shipping no artefacts renders
     no map host at all, so nothing mounts, and street-level coverage is a MapLibre
     source with no map to be added to. Production sets the token, so the console
     shipped a live, tickable checkbox over a page with no instrument behind it.
     `layerAvailability` now refuses at the PAGE level, before either axis, and the
     property worth pinning is that the refusal reaches every layer regardless of
     which axis it depends on. */
  assert.equal(refused, LAYER_IDS.length,
    `an area that ships no artefacts mounts no map, so ALL ${LAYER_IDS.length} `
    + `layers must refuse there — ${refused} did. A layer still available is one `
    + 'whose checkbox ticks with nothing behind it; if this is 0, the loop above '
    + 'checked nothing');
  /* ONE REASON, NOT SIX. The refusal is a fact about the PAGE, so every row states
     the same operative one. Six different sentences would mean the artefact branch
     is still answering — true, but incidental, and it leaves a reader of five
     greyed rows without the fact that explains all six. */
  assert.equal(reasons.size, 1,
    `the ${refused} refusals give ${reasons.size} different reasons — the page-level `
    + `refusal must answer for all of them: ${[...reasons].join(' | ')}`);
  assert.match([...reasons][0], /no map is mounted|nothing renders/,
    'the refusal names the missing artefact rather than the missing map — accurate '
    + 'and incidental, where the operative fact is that nothing renders here at all');
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

test('no stylesheet writes a colour more than once', async () => {
  /* A colour with two spellings drifts the moment someone edits one -- the CSS
     form of the defect this migration exists to end.

     THE FIRST VERSION OF THIS GUARD ASKED THE NARROWER QUESTION: "is this hex
     also some token's declared value?" That can never, by construction, catch a
     colour nobody declared -- and six of those were written 19 times between
     them in the very file it was watching. So the rule is now the general one it
     should always have been: a properly tokenised colour appears EXACTLY ONCE in
     a file, in its own declaration, and every use of it is var(). Anything
     appearing twice is therefore either a token being bypassed or a colour still
     waiting for one, and the message says which.

     COMMENTS ARE COUNTED, DELIBERATELY. A hex in prose is a copy that goes stale
     exactly like a hex in a rule -- and once a colour has a token, the accurate
     way to name it in prose is `--sage`, which points AT the single source of
     truth instead of duplicating it. A hex may still appear once in a comment;
     only a second spelling fails. */
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
    // 3-8 digits, so a #abc shorthand or an #rrggbbaa cannot smuggle in a second
    // spelling that a 6-digit-only pattern would wave through.
    const token = new Map();
    for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g)) {
      token.set(m[2].toLowerCase(), m[1]);
    }
    const seen = new Map();
    for (const m of src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const hex = m[0].toLowerCase();
      seen.set(hex, (seen.get(hex) ?? 0) + 1);
    }
    for (const [hex, n] of [...seen].sort()) {
      if (n < 2) continue;
      const t = token.get(hex);
      offences.push(t
        ? `${rel}: ${hex} written longhand ${n - 1}x beside ${t}`
        : `${rel}: ${hex} written ${n}x and no token declares it -- give it one`);
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
