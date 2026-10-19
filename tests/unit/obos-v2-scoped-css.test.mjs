// tests/unit/obos-v2-scoped-css.test.mjs — rc1 R5: a scoped <style> in a v2-only component must still ship.
/**
 * The v2 trees are rendered by AstroContainer (src/pages/obos-v2/), so the PAGE no longer imports the components in them: a scoped <style> in a component that only v2 uses is not
 * emitted, and its elements carry a `data-astro-cid-*` attribute that no selector matches. This asserts, on the build output, that every cid in dist/obos-v2/**.html has a selector
 * in dist/_astro/*.css or dist/obos-v2/obos-v2.css. Needs `npm run build` (npm run verify builds first).
 *
 * One known, justified exception: ConstructionStamp (shared with v1's SoonDraft) is scoped and, in v2, its style is not shipped. src/styles/obos-v2/screens/mapstack.css
 * sets every property it set (display, border, colour, font, letter-spacing, case, padding, transform, animation, opacity, box-shadow), so nothing is lost. An element with
 * class con-stamp is the only thing allowed to carry an unmatched cid.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir, ext) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : []; });

test('rc1 R5: every data-astro-cid-* in dist/obos-v2 has a matching selector in the shipped CSS (the ConstructionStamp exception aside)', () => {
  assert.ok(existsSync('dist/obos-v2'), 'No build output: run `npm run build` first (`npm run verify` does it for you).');
  const css = [...walk('dist/_astro', '.css'), 'dist/obos-v2/obos-v2.css'].map((f) => readFileSync(f, 'utf8')).join('\n');
  const unmatched = new Map();   // cid -> Set of element tags' class lists
  for (const f of walk('dist/obos-v2', '.html')) {
    for (const m of readFileSync(f, 'utf8').matchAll(/<[a-z][^>]*\bdata-astro-cid-([a-z0-9]+)[^>]*>/g)) {
      const cid = m[1];
      if (css.includes(`[data-astro-cid-${cid}]`)) continue;
      const cls = /\bclass="([^"]*)"/.exec(m[0])?.[1] ?? '';
      (unmatched.get(cid) ?? unmatched.set(cid, new Set()).get(cid)).add(cls);
    }
  }
  const bad = [...unmatched].filter(([, classes]) => ![...classes].every((c) => c.split(/\s+/).includes('con-stamp')));
  assert.deepEqual(bad.map(([cid, classes]) => `${cid}: ${[...classes].join(' | ')}`), [], 'a scoped <style> that the v2 page no longer ships (move it to src/styles/obos-v2/ or import it from the page)');
  /* the exception stays honest: it is still needed only for the stamp, and mapstack.css still restyles the properties the scoped rule set */
  const ms = readFileSync('src/styles/obos-v2/screens/mapstack.css', 'utf8');
  for (const p of ['display', 'border', 'border-radius', 'padding', 'font', 'letter-spacing', 'text-transform', 'color', 'transform', 'animation', 'opacity', 'box-shadow']) {
    assert.match(ms, new RegExp(`\\.wardc \\.con-stamp \\{[^}]*\\b${p}:`), `mapstack.css restyles .con-stamp ${p}`);
  }
});
