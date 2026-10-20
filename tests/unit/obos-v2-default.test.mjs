// tests/unit/obos-v2-default.test.mjs — OBOS v2 is the default UI (flip plan A.2 / B.2.3 (i)).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

test('T1: Base takes a ui prop and renders it as data-ui on <html> (server-rendered, so no-JS and soft hops are right)', () => {
  const src = readFileSync('src/layouts/Base.astro', 'utf8');
  assert.match(src, /ui\?: 'v2';/);
  assert.match(src, /<html lang="en" data-ui=\{ui\}>/);
});

/* PR 2 deletes the v1 sources. Until then this keeps them unserved: no page may import a v1 tree component, so v1 cannot come back silently (flip plan A.2.7). */
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.astro$/.test(p) ? [p] : []; });
const V1_TREES = ['HeatMapStage', 'PairedBench', 'HeatMapBrief', 'IconRail', 'PanelToggle'];

test('no page imports a v1 tree component (the v1 UI is not served)', () => {
  const offenders = [];
  for (const f of walk('src/pages')) {
    for (const m of readFileSync(f, 'utf8').matchAll(/^import\s+\w+\s+from\s+'([^']+)'/gm)) {
      const base = m[1].split('/').pop().replace(/\.astro$/, '');
      if (V1_TREES.includes(base)) offenders.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the three OBOS pages render v2 and carry no swap machinery', () => {
  for (const f of ['src/pages/heat-map/[country]/[city]/[area].astro', 'src/pages/heat-map/compare.astro', 'src/pages/heat-map/brief.astro']) {
    const src = readFileSync(f, 'utf8');
    assert.match(src, /\bui="v2"/, f);
    assert.ok(!/UiSwap|UiPrepaint|v2TreeUrl|obos:ui/.test(src), `${f}: leftover flag machinery`);
  }
});
