import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { TILED_CITY_READY } from '../../src/scripts/climate-engine/scope/registry.ts';

/* STREAMING IS DEV-ONLY AND OFF BY CONSTRUCTION. The sheet manager, the caches, the halo solve and (P3b) the executor, the mesh
   builders and the page controller live under streaming/ and streaming-host/. The only modules outside them that may read them are
   the three below, and heat-map-app.ts reaches the controller ONLY through dynamic import() inside the `STREAM_ON` branch, whose
   condition is a compile-time constant that is false in every build not made with PUBLIC_OBOS_STREAM=1 (public) or PUBLIC_OBOS_STREAM_DEV=1 (dev). This test is the proof,
   so a stray import cannot change a live page unnoticed. */

const ROOT = new URL('../../src/', import.meta.url).pathname;
const STREAMING = join(ROOT, 'scripts/climate-engine/streaming');
const STREAMING_HOST = join(ROOT, 'scripts/climate-engine/streaming-host');

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

/** The only files outside the two directories that name them, and how. */
const ALLOWED = new Map([
  ['scripts/climate-engine/heat-map-app.ts', 'type imports, and dynamic import() in startStream'],
  ['scripts/climate-engine/explore/relief-contract.ts', 'type imports'],
  ['scripts/climate-engine/explore/relief-renderer.ts', 'the packed-attribute ranges (two constants) from prism-mesh.ts'],
]);

test('nothing outside the streaming directories imports them, except the three known files', () => {
  const offenders = [];
  for (const file of files(ROOT)) {
    if (file.startsWith(STREAMING) || file.startsWith(STREAMING_HOST)) continue;
    const text = readFileSync(file, 'utf8');
    if (/from\s+['"][^'"]*\/streaming(-host)?\/[^'"]*['"]|import\(\s*['"][^'"]*\/streaming(-host)?\//.test(text) && !ALLOWED.has(file.slice(ROOT.length))) offenders.push(file.slice(ROOT.length));
  }
  assert.deepEqual(offenders, []);
});

test('heat-map-app.ts reaches streaming only through type imports and dynamic import() inside startStream', () => {
  const text = readFileSync(join(ROOT, 'scripts/climate-engine/heat-map-app.ts'), 'utf8');
  const staticValue = text.split('\n').filter((l) => /^import\s+(?!type)[^;]*from\s+['"][^'"]*\/streaming(-host)?\//.test(l));
  assert.deepEqual(staticValue, [], 'a static value import would put streaming in every bundle');
  assert.match(text, /const STREAM_ON = \(import\.meta\.env\.PUBLIC_OBOS_STREAM === '1' \|\| import\.meta\.env\.PUBLIC_OBOS_STREAM_DEV === '1'\)\s+&& INITIAL_AREA === 'nl\/amsterdam\/canal-ring'\s+&& \(import\.meta\.env\.PUBLIC_OBOS_STREAM === '1' \? streamParam\(\) !== '0' : streamParam\(\) === '1'\);/);
  assert.match(text, /const STREAM_TOOLS = import\.meta\.env\.PUBLIC_OBOS_STREAM_DEV === '1' && STREAM_ON;/);
  assert.match(text, /if \(STREAM_ON\) void startStream\(\)\.catch\(streamFailed\); else void loadWard\(INITIAL_AREA\);/);
});

test('the streaming modules are DOM-free and GL-free: no three.js value import, no window/document', () => {
  for (const file of files(STREAMING)) {
    if (file.endsWith('city-stream.ts')) continue;
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/from\s+['"]three['"]/.test(text) || /import\s+type/.test(text), `${file} imports three.js`);
    assert.ok(!/\b(window|document|navigator|requestAnimationFrame|fetch)\b/.test(text), `${file} touches the DOM or the network`);
  }
});
