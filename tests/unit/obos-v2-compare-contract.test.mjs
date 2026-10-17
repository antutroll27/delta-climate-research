// tests/unit/obos-v2-compare-contract.test.mjs — OBOS v2 spec §1.2 for Compare and the paired brief (D7). Owner: Track C (plan amendment A1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const V1 = readFileSync('src/components/ClimateEngine/compare/PairedBench.astro', 'utf8');
const V1B = readFileSync('src/components/ClimateEngine/brief/HeatMapBrief.astro', 'utf8');
const V2F = 'src/components/ClimateEngine/compare/PairedBenchV2.astro';
const V2BF = 'src/components/ClimateEngine/brief/HeatMapBriefV2.astro';
/* markup only: v1's <style> block quotes selectors such as [data-sheet="half"] that no element ever carries */
const markupOnly = (s) => s.replace(/<style[\s\S]*?<\/style>/g, '');
const pairs = (s) => new Set([...markupOnly(s).matchAll(/\b(data-[a-z-]+)="([^"{}]*)"/g)].map((m) => `${m[1]}="${m[2]}"`)
  .filter((p) => !/^data-(pane|rail|rail-toggle|panel-toggle|label-[a-z]+|astro[a-z-]*)=/.test(p)));
const frontmatterless = (s) => s.replace(/^---[\s\S]*?\n---\n/, '');
const text = (s) => frontmatterless(s).replace(/<style[\s\S]*?<\/style>/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('every data hook the bench controller reads exists in PairedBenchV2', () => {
  assert.ok(existsSync(V2F), V2F);
  const v2 = readFileSync(V2F, 'utf8');
  const missing = [...pairs(V1)].filter((p) => !v2.includes(p));
  assert.deepEqual(missing, []);
  for (const h of ['data-compare-root', 'data-console']) assert.ok(v2.includes(h), h);
  assert.match(v2, /<main id="main" class="heat-compare obos-v2"/);
});

test('every data hook the brief reads exists in HeatMapBriefV2', () => {
  assert.ok(existsSync(V2BF), V2BF);
  const v2 = readFileSync(V2BF, 'utf8');
  assert.deepEqual([...pairs(V1B)].filter((p) => !v2.includes(p)), []);
  assert.match(v2, /<main id="main" class="heat-brief obos-v2"[^>]*data-brief-root/);
  for (const t of ['Paired scenario brief', 'This is not a ward ranking or an investment-priority recommendation.', 'It is not an observed regional heat-day record.']) assert.ok(v2.includes(t), t);
});

/* H25 and the brief's honesty (spec §5): v1's sentences, word for word. Each is asserted in v1 FIRST, so this list cannot drift
   from the source it protects, then in v2 (the rendered text, so a re-indented tag cannot hide a changed word). */
const COMPARE_SENTENCES = [
  'Illustrative, editable',
  'Thermal relief illustrative',
  '26–48°C fixed scale',
  'Modelled corridor-cell coverage',
  'Mapped roof-stock coverage',
  'Modelled programme intensity',
  'Both sides come from one city. A pair drawn across two of them would compare two climates and two currencies, and would price the result in neither.',
  'Results show each ward’s response from its own baseline. They are not a ward ranking.',
  'Ballygunge is KMC Ward 68: its figures are taken inside the ward boundary, the rest of its 1.8 km square is context.',
  'This interim reference is explicitly labelled until a sourced regional heat-day record is supplied. It is not live ward weather.',
  'Screening-grade output. It does not assess vulnerability, equity, feasibility, ownership, operations, maintenance, or investment priority.',
  'Δ vs all-green ref',
  'Surface cooling from baseline',
  'Indicative capital',
  'Grid area, surface >40°C',
  'Hot-area change',
  'Delivered quantities',
  'Retry model',
];
const BRIEF_SENTENCES = [
  'A controlled, modelled comparison of the same intervention package in two study areas, which need not be equal: each side\'s figures, its cost included, are taken over the area named under its name. This is not a ward ranking or an investment-priority recommendation.',
  'The current release uses an explicitly labelled interim fallback reference to verify the architecture. It is not an observed regional heat-day record. Before publication, replace it with a cited reference location, date, source, and actual 13:00/22:00 conditions.',
  'Screening-grade, modelled heat field',
  'ward-geometry-v1',
  'paired-coverage-v1',
  'Figures taken over',
  'Indicative capital',
];

/* v1 says the Δ disclosure in a title="" (a tooltip: invisible on touch); v2 keeps the title AND prints it. */
const DELTA = 'Modelled ward mean minus a fully vegetated reference cell under identical forcing. This is not a measured urban–rural heat-island value.';

test('H25: the Δ disclosure is in v1\'s tooltip, and in v2 as a tooltip AND as visible text', () => {
  const v2src = readFileSync(V2F, 'utf8');
  assert.ok(V1.includes(`title="${DELTA}"`), 'v1 no longer says it');
  assert.ok(v2src.includes(`title="${DELTA}"`), 'v2 lost the tooltip');
  assert.ok(text(v2src).includes(DELTA), 'v2 must print the disclosure, not only tooltip it');
});

test('H25: every honesty sentence of v1 Compare survives in v2, word for word', () => {
  const v1 = text(V1), v2 = text(readFileSync(V2F, 'utf8'));
  for (const s of COMPARE_SENTENCES) {
    assert.ok(v1.includes(s), `v1 no longer says: ${s}`);
    assert.ok(v2.includes(s), `v2 Compare lost: ${s}`);
  }
});

test('H25: every honesty sentence of the v1 paired brief survives in v2, word for word', () => {
  const v1 = text(V1B), v2 = text(readFileSync(V2BF, 'utf8'));
  for (const s of BRIEF_SENTENCES) {
    assert.ok(v1.includes(s), `v1 no longer says: ${s}`);
    assert.ok(v2.includes(s), `v2 brief lost: ${s}`);
  }
});

test('"checked", never "validated"; no banned money words; no currency written by hand (spec §5, BRIEF)', () => {
  for (const f of [V2F, V2BF]) {
    const t = text(readFileSync(f, 'utf8'));
    assert.ok(!/validated|guarantee|ROI of|\breturns\b/i.test(t), `${f}: a banned word`);
    assert.ok(!/[₹$€£]|\bAED\b|\bINR\b/.test(t), `${f}: a currency is written by hand; the controller formats it with fmtMoney`);
  }
});

test('the v2 components carry no <style> and no <script> (template scripts never run; scoped CSS would stamp data-astro-cid, spec §1.2, A1 S2.9)', () => {
  for (const f of [V2F, V2BF]) {
    const src = frontmatterless(readFileSync(f, 'utf8'));
    assert.ok(!/<style[\s>]/.test(src), `${f}: <style>`);
    assert.ok(!/<script[\s>]/.test(src), `${f}: <script>`);
  }
});

test('Compare: the A/B pickers, the sliders and the actions sit inside the root the controller queries (it queries through [data-compare-root])', () => {
  const v2 = readFileSync(V2F, 'utf8');
  const root = v2.slice(v2.indexOf('<main id="main"'), v2.lastIndexOf('</main>'));
  for (const h of ['data-input="ward-a"', 'data-input="ward-b"', 'data-input="trees"', 'data-input="roofs"', 'data-input="facades"',
    'data-action="swap"', 'data-action="reset"', 'data-action="undo"', 'data-action="share"', 'data-action="retry"', 'data-action="motion"',
    'data-role="share-url"', 'data-role="brief-link"', 'data-view-mode="relief"', 'data-view-mode="top"', 'data-map-three="a"', 'data-map-three="b"']) {
    assert.ok(root.includes(h), h);
  }
  /* the two classes paired-controller.ts's setSheet() looks up by name */
  assert.ok(root.includes('heat-compare__controls') && root.includes('heat-compare__workbench'));
});

test('Compare: the menu says "Analysis · Compare", and the current route is never a self-link (spec §3.1)', () => {
  const v2 = readFileSync(V2F, 'utf8');
  assert.match(v2, /<RailV2 current="compare"/);
  const rail = readFileSync('src/components/ClimateEngine/v2/RailV2.astro', 'utf8');
  assert.match(rail, /onCompare\s*\n?\s*\?\s*<button class="nav-item" type="button" aria-current="page"/);
});

test('Compare: the Key and Credits popovers exist with the ids bindLayers opens, and the credits name what Compare draws', () => {
  const v2 = readFileSync(V2F, 'utf8');
  for (const id of ['v2Key', 'v2Credits']) assert.equal((v2.match(new RegExp(`\\sid="${id}"`, 'g')) ?? []).length, 1, id);
  const t = text(v2);
  assert.ok(t.includes('DataMeet'), 'the ward boundary credit (CC BY-SA 2.5 India) must travel with the figures taken inside it');
  assert.ok(v2.includes('https://creativecommons.org/licenses/by-sa/2.5/in/'), 'the licence link');
  /* Compare draws no basemap: the basemap credit would be a false statement here */
  assert.ok(!/OpenFreeMap|OpenMapTiles/.test(v2), 'Compare draws no OpenFreeMap basemap');
});

for (const [page, tag] of [['compare', 'PairedBenchV2'], ['brief', 'HeatMapBriefV2']]) {
  test(`${page}.astro wraps the v2 tree exactly as the area page does (UiPrepaint, v1, template, UiSwap) and boots v2 under the flag`, () => {
    const src = readFileSync(`src/pages/heat-map/${page}.astro`, 'utf8');
    for (const part of ['<UiPrepaint />', '<template id="obos-v2-tree">', '<UiSwap />']) assert.ok(src.includes(part), part);
    assert.ok(src.indexOf('<UiPrepaint />') < src.indexOf('<template id="obos-v2-tree">') && src.indexOf('<template id="obos-v2-tree">') < src.indexOf('<UiSwap />'));
    assert.match(src, new RegExp(`<template id="obos-v2-tree"><${tag} /></template>`));
    assert.match(src, /document\.documentElement\.getAttribute\('data-ui'\) !== 'v2'/);
    assert.match(src, /disposeV2\?\.\(\); disposeV2 = null;/);
  });
}

test('compare.astro mounts the bench exactly as before (v1 behaviour kept), then the v2 frame', () => {
  const src = readFileSync('src/pages/heat-map/compare.astro', 'utf8');
  assert.match(src, /dispose = mountPairedBench\(\);/);
  assert.match(src, /if \(!disposeShell\) disposeShell = mountConsoleShell\(\);/);
  assert.ok(src.indexOf('mountConsoleShell()') < src.indexOf('bootV2(generation)'), 'the v2 frame binds after the v1 console shell, as on the area page');
});

/* the built page: one v2 tree per page, unique ids, the v1 <main> untouched in front of it */
for (const [path, root, tag] of [['heat-map/compare', 'heat-compare', 'PairedBenchV2'], ['heat-map/brief', 'heat-brief', 'HeatMapBriefV2']]) {
  test(`${path}: the built page carries the v1 <main> and then ONE v2 template, with unique ids`, () => {
    const file = `dist/${path}/index.html`;
    assert.ok(existsSync(file), `run npm run build first (${file})`);
    const html = readFileSync(file, 'utf8');
    const v1s = html.indexOf('<main id="main"'); const v1e = html.indexOf('</main>', v1s);
    const ts = html.indexOf('<template id="obos-v2-tree">'); const te = html.indexOf('</template>', ts);
    assert.ok(v1s >= 0 && ts > v1e && te > ts, 'v1 main, then the template');
    assert.equal((html.match(/<template id="obos-v2-tree">/g) ?? []).length, 1);
    const v1 = html.slice(v1s, v1e), v2 = html.slice(ts, te);
    assert.match(v1, new RegExp(`^<main id="main" class="${root}`));
    assert.match(v2, new RegExp(`<main id="main" class="${root} obos-v2"`));
    const ids = [...v2.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))], [], 'duplicate ids in the v2 tree');
    assert.ok(tag.length > 0);
  });
}
