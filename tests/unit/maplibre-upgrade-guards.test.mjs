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

test('the custom layer reads the projection from the options object, never Array.from(options)', () => {
  assert.doesNotMatch(RELIEF, /Array\.from\(\s*(matrix|options|opts|input)\s*\)/, 'Array.from of the options object is [] and every matrix entry is NaN');
  assert.match(RELIEF, /render:\s*\(_gl,\s*options\)\s*=>\s*this\.render\(options\.defaultProjectionData\.mainMatrix\)/, 'the layer must pass mainMatrix');
});

test('MSAA is requested through canvasContextAttributes, not a top-level antialias', () => {
  const ctor = APP.slice(APP.indexOf('new maplibregl.Map({'), APP.indexOf('maxPitch: 78'));
  assert.match(ctor, /canvasContextAttributes:\s*\{\s*antialias:\s*true/, 'MSAA must come from canvasContextAttributes');
  assert.doesNotMatch(ctor.replace(/canvasContextAttributes:\s*\{[^}]*\}/, ''), /\bantialias\s*:/, 'a top-level antialias is ignored by maplibre-gl >= 5');
});
