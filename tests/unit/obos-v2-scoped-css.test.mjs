// tests/unit/obos-v2-scoped-css.test.mjs — a scoped <style> in a component the v2 page uses must ship.
/**
 * FLIP (plan A.0 / B.1): the OBOS pages import HeatMapStageV2 / PairedBenchV2 / HeatMapBriefV2 directly, so Astro bundles the scoped CSS of the v1 shell components v2 reuses
 * (ScopeSwitcher, InterventionPane, LayerTree, ConstructionStamp) like any other. This asserts, on the build output, that every data-astro-cid-* in dist/heat-map/**\/index.html has a
 * selector in the CSS the page links (dist/_astro/*.css). The old ConstructionStamp exception is gone: its scoped rule now ships. Needs `npm run build`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir, ext) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : []; });

test('every data-astro-cid-* on an OBOS page has a matching selector in the CSS the page links', () => {
  assert.ok(existsSync('dist/heat-map'), 'No build output: run `npm run build` first (`npm run verify` does it for you).');
  const pages = walk('dist/heat-map', 'index.html');
  assert.ok(pages.length >= 8, 'the area pages, compare and brief are built');
  for (const f of pages) {
    const html = readFileSync(f, 'utf8');
    const css = [...html.matchAll(/<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)"/g)].map((m) => readFileSync(`dist${m[1]}`, 'utf8')).join('\n')
      + [...html.matchAll(/<style[^>]*>([^<]*)<\/style>/g)].map((m) => m[1]).join('\n');
    const unmatched = new Set();
    for (const m of html.matchAll(/<[a-z][^>]*\bdata-astro-cid-([a-z0-9]+)[^>]*>/g)) {
      if (!css.includes(`[data-astro-cid-${m[1]}]`)) unmatched.add(`${m[1]}: ${/\bclass="([^"]*)"/.exec(m[0])?.[1] ?? ''}`);
    }
    assert.deepEqual([...unmatched], [], `${f}: a scoped <style> that the page does not ship`);
  }
});
