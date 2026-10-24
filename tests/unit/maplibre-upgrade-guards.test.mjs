/**
 * THE MAPLIBRE 4 → 6 UPGRADE, HELD SHUT BY SOURCE TEXT.
 *
 * Most of what broke between maplibre-gl 4.7.1 and 6.x is SILENT at runtime: a custom
 * layer handed an options object instead of a matrix draws nothing and throws nothing; a
 * top-level `antialias` is ignored and the edges go jagged; an absent `isEasing` is a
 * TypeError only once the orbit's first frame runs. The compiler catches most of them
 * (`npm run check`); these assertions catch them where the compiler is not run, and say
 * WHY, so the next reader does not "tidy" one back.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(ts|astro|mjs)$/.test(entry.name)) yield path;
  }
}

const APP = strip(await read('src/scripts/climate-engine/heat-map-app.ts'));
const RELIEF = strip(await read('src/scripts/climate-engine/explore/relief-renderer.ts'));

test('no source file calls isEasing: it is not on a v6 Map, so the orbit would throw every frame', async () => {
  const offenders = [];
  for await (const file of walk(new URL('src/', ROOT).pathname)) {
    if (/\bisEasing\b/.test(strip(await readFile(file, 'utf8')))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'isEasing was removed from Map in maplibre-gl 6 (Map composes Camera)');
});

test('the custom layer reads the projection from the options object, never Array.from(options)', () => {
  assert.doesNotMatch(RELIEF, /Array\.from\(\s*(matrix|options|opts|input)\s*\)/, 'Array.from of the options object is [] and every matrix entry is NaN');
  assert.match(RELIEF, /render:\s*\(_gl,\s*options\)\s*=>\s*this\.render\(options\.defaultProjectionData\.mainMatrix\)/, 'the layer must pass mainMatrix');
});

test('MSAA is requested through canvasContextAttributes, not a top-level antialias', () => {
  const ctor = APP.slice(APP.indexOf('new maplibregl.Map({'), APP.indexOf('maxPitch: 78'));
  assert.match(ctor, /canvasContextAttributes:\s*\{\s*antialias:\s*true/, 'MSAA must come from canvasContextAttributes');
  assert.doesNotMatch(ctor.replace(/canvasContextAttributes:\s*\{[^}]*\}/, ''), /\bantialias\s*:/, 'a top-level antialias is ignored by maplibre-gl >= 5');
});

test('maplibre-gl is pinned EXACTLY, at a release that closes GHSA-jrc7-96c5-q579 (>= 6.4.1)', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const version = pkg.dependencies['maplibre-gl'];
  assert.match(version, /^\d+\.\d+\.\d+$/, 'no caret or tilde: the 6.x line ships a minor every week or so');
  const [major, minor, patch] = version.split('.').map(Number);
  assert.ok(major > 6 || (major === 6 && (minor > 4 || (minor === 4 && patch >= 1))), `${version} is inside the attribution-XSS range (<= 6.4.0)`);
});

test('no file default-imports maplibre-gl: v6 is ESM-only with no default export', async () => {
  const offenders = [];
  for await (const file of walk(new URL('src/', ROOT).pathname)) {
    if (/import\s+(type\s+)?[A-Za-z_$][\w$]*\s+from\s+['"]maplibre-gl['"]/.test(strip(await readFile(file, 'utf8')))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], "use `import * as maplibregl from 'maplibre-gl'` (or `import type * as`)");
});

test('the worker is wired for the bundler before the Map is built, and the build checks it shipped', async () => {
  assert.match(APP, /import\s+maplibreWorkerUrl\s+from\s+'maplibre-gl\/dist\/maplibre-gl-worker\.mjs\?worker&url'/, 'the worker URL import is gone: tiles would never parse (blank basemap)');
  const worker = APP.indexOf('maplibregl.setWorkerUrl(maplibreWorkerUrl)');
  assert.ok(worker > 0, 'setWorkerUrl is never called');
  assert.ok(worker < APP.indexOf('new maplibregl.Map('), 'setWorkerUrl must run before the first Map');
  const pkg = JSON.parse(await read('package.json'));
  assert.match(pkg.scripts.build, /node scripts\/check-maplibre-worker\.mjs/, 'npm run build must assert the worker asset is in dist/');
  const check = await read('scripts/check-maplibre-worker.mjs');
  assert.match(check, /maplibre-gl-worker/, 'the check must look for the worker asset');
});

