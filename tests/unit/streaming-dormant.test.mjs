import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { TILED_CITY_READY } from '../../src/scripts/climate-engine/scope/registry.ts';

/* PHASE P3a SHIPS THE STREAMING CORE AND WIRES NOTHING. The sheet manager, the caches and the halo solve live under
   src/scripts/climate-engine/streaming/ and are imported only by their tests; no page, renderer or app module reads them
   until P3b, behind TILED_CITY_READY. This test is the proof, so a stray import cannot change a live page unnoticed. */

const ROOT = new URL('../../src/', import.meta.url).pathname;
const STREAMING = join(ROOT, 'scripts/climate-engine/streaming');

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|astro|mjs|js)$/.test(name)) yield p;
  }
}

test('TILED_CITY_READY is still false', () => {
  assert.equal(TILED_CITY_READY, false);
});

test('nothing outside the streaming directory imports it', () => {
  const offenders = [];
  for (const file of files(ROOT)) {
    if (file.startsWith(STREAMING)) continue;
    if (/from\s+['"][^'"]*\/streaming\/[^'"]*['"]|import\(\s*['"][^'"]*\/streaming\//.test(readFileSync(file, 'utf8'))) offenders.push(file.slice(ROOT.length));
  }
  assert.deepEqual(offenders, []);
});

test('the streaming modules are DOM-free and GL-free: no three.js value import, no window/document', () => {
  for (const file of files(STREAMING)) {
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/from\s+['"]three['"]/.test(text) || /import\s+type/.test(text), `${file} imports three.js`);
    assert.ok(!/\b(window|document|navigator|requestAnimationFrame|fetch)\b/.test(text), `${file} touches the DOM or the network`);
  }
});
