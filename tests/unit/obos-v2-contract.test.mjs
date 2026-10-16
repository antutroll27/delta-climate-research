// tests/unit/obos-v2-contract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

/* THE PORT CONTRACT (spec §1.2, §1.6). The app binds by id and selector at mount;
   onEl (heat-map-app.ts:3818) silently skips a null node, so a missing id is a
   control that quietly stops responding. Every id the scripts query, and every
   id the v1 tree of the same page carries from that set, must exist EXACTLY ONCE
   in the v2 template. */
const SCRIPTS = [
  'src/scripts/climate-engine/heat-map-app.ts',
  'src/scripts/climate-engine/solar-payback-sheet.ts',
  'src/scripts/climate-engine/shell/console-shell.ts',
  'src/scripts/climate-engine/shell/phone-console.ts',
  'src/scripts/climate-engine/streetview/street-view-panel.ts',
];
const PREFIXED = ['Big', 'BigK', 'Conf', 'Floor', 'Kwh', 'Kwp', 'Rs', 'Sh'];   // `${pre}X`, pre ∈ sol | solPane (app:1160)

/* Ids v2 drops on purpose. Each needs a reason. Empty by design. */
const RETIRED_IN_V2 = new Map([]);

export function scriptIds() {
  const ids = new Set();
  for (const f of SCRIPTS) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(?:el|setText|setHTML|input|show|getElementById)\(\s*'([A-Za-z][\w-]*)'/g)) ids.add(m[1]);
    for (const m of src.matchAll(/querySelector(?:All)?(?:<[^>]*>)?\(\s*'#([A-Za-z][\w-]*)/g)) ids.add(m[1]);
  }
  for (const pre of ['sol', 'solPane']) for (const x of PREFIXED) ids.add(`${pre}${x}`);
  const pane = readFileSync('src/components/ClimateEngine/shell/InterventionPane.astro', 'utf8');
  for (const m of pane.matchAll(/\bid="([A-Za-z][\w-]*)"/g)) ids.add(m[1]);
  ids.add('newCity'); ids.add('newCityHide');
  return ids;
}

function pageParts(path) {
  const file = `dist/${path}/index.html`;
  assert.ok(existsSync(file), `run npm run build first (${file})`);
  const html = readFileSync(file, 'utf8');
  const v1s = html.indexOf('<main id="main"'); const v1e = html.indexOf('</main>', v1s);
  const ts = html.indexOf('<template id="obos-v2-tree">'); const te = html.indexOf('</template>', ts);
  assert.ok(ts > v1e, `${path}: the v2 template must follow the v1 <main>`);
  return { v1: html.slice(v1s, v1e), v2: html.slice(ts, te) };
}
const idsIn = (s) => [...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

for (const path of ['heat-map/in/kolkata/ballygunge', 'heat-map/in/bengaluru/mg-road', 'heat-map/ae/dubai/al-quoz']) {
  test(`${path}: every bound id is in the v2 tree exactly once`, () => {
    const { v1, v2 } = pageParts(path);
    const want = scriptIds();
    const v1ids = new Set(idsIn(v1));
    const v2list = idsIn(v2);
    const dup = v2list.filter((id, i) => v2list.indexOf(id) !== i);
    assert.deepEqual([...new Set(dup)], [], `duplicate ids in the v2 tree: ${dup.join(', ')}`);
    const v2ids = new Set(v2list);
    const required = [...v1ids].filter((id) => want.has(id) || id.startsWith('big-'));
    const missing = required.filter((id) => !v2ids.has(id) && !RETIRED_IN_V2.has(id));
    assert.deepEqual(missing, [], `v2 lacks ids the v1 tree carries and a script binds: ${missing.join(', ')}`);
  });

  test(`${path}: the v2 root keeps the seams`, () => {
    const { v1, v2 } = pageParts(path);
    const area = /data-area="([^"]+)"/.exec(v1)?.[1];
    assert.ok(area, 'v1 root has no data-area');
    assert.match(v2, new RegExp(`<main id="main" class="stage obos-v2"[^>]*\\bdata-console\\b[^>]*data-area="${area}"`));
    if (v1.includes('id="mlmap"')) {
      /* S2 appends 'data-rail="analysis"' to this list when the menu lands. */
      for (const hook of ['data-scope="area"', 'data-w="', 'id="segPhase"', 'data-p="now"', 'data-m="relief"', 'data-e="studio"', 'data-t="2"', 'data-v="1"', 'data-s="1"', 'data-layer="', 'data-entry-close', 'data-rn-dismiss']) {
        assert.ok(v2.includes(hook), `v2 tree lacks the hook ${hook}`);
      }
    }
    assert.ok(!/<script/i.test(v2.replace(/^<template id="obos-v2-tree">/, '')), 'no <script> may sit inside the v2 tree (template scripts never run)');
  });
}

test('console-shell paints no pane state on a console that has no panes (E6, spec C3)', () => {
  const src = readFileSync('src/scripts/climate-engine/shell/console-shell.ts', 'utf8');
  assert.match(src, /\n\s*if \(panes\.length > 0\) paint\(\);\n/);
  assert.ok(!/\n\s{2}paint\(\);\n/.test(src), 'an unguarded paint() call remains');
});

test('the area page mounts the v2 shell only under the flag, after the instrument', () => {
  const page = readFileSync('src/pages/heat-map/[country]/[city]/[area].astro', 'utf8');
  assert.match(page, /getAttribute\('data-ui'\) !== 'v2'/);
  assert.ok(page.indexOf('mountHeatMap()') < page.lastIndexOf('await bootV2(generation)'), 'v2 shell must mount after mountHeatMap');
  assert.match(page, /disposeV2\?\.\(\); disposeV2 = null;/);
});
