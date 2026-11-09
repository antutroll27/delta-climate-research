import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/* scripts/check-stream-dist.mjs against tiny synthetic dists: the check itself must fail when it should, or "0 strings" proves nothing. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(root, 'scripts', 'check-stream-dist.mjs');
const PAGE = '<meta name="robots" content="noindex"><meta property="og:url" content="https://x.test/heat-map/nl/amsterdam/canal-ring/">';

function run(mode, files) {
  mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true });
  const dir = mkdtempSync(join(root, 'node_modules', '.cache', 'csd-'));
  try {
    const all = { 'heat-map/nl/amsterdam/canal-ring/index.html': PAGE, ...files };
    for (const [f, body] of Object.entries(all)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), body); }
    const r = spawnSync(process.execPath, [script, mode, dir], { encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const STREAMING = { 'heat-map/data/ams-r2-manifest.json': '{}', '_astro/city-stream.a.js': 'x', '_astro/page-wiring.b.js': 'y' };

test('plain: a clean dist passes; a streaming string, a streaming chunk or the manifest fails it', () => {
  assert.equal(run('plain', { '_astro/app.js': 'console.log(1)' }).code, 0);
  assert.equal(run('plain', { '_astro/app.js': 'fetch("https://obos-city-data.example")' }).code, 1);
  assert.equal(run('plain', { '_astro/app.js': 'x', '_astro/city-stream.z.js': 'y' }).code, 1);
  assert.equal(run('plain', { '_astro/app.js': 'x', 'heat-map/data/ams-r2-manifest.json': '{}' }).code, 1);
});

test('public: the streaming code is required, and each dev tool fails it', () => {
  assert.equal(run('public', { ...STREAMING, '_astro/app.js': 'x' }).code, 0);
  assert.equal(run('public', { '_astro/app.js': 'x' }).code, 1, 'no manifest, no chunks');
  for (const dev of ['streamtier', 'window.__obosStream=1', 'jsHeapMB', 'glBufferMB']) assert.equal(run('public', { ...STREAMING, '_astro/app.js': dev }).code, 1, dev);
  assert.equal(run('public', { ...STREAMING, '_astro/app.js': 'x', '_astro/gl-meter.q.js': 'z' }).code, 1);
});

test('dev: the dev tools are required', () => {
  assert.equal(run('dev', { ...STREAMING, '_astro/app.js': 'streamtier __obosStream', '_astro/gl-meter.q.js': 'z' }).code, 0);
  assert.equal(run('dev', { ...STREAMING, '_astro/app.js': 'x' }).code, 1);
});

test('every mode: the Canal Ring page\'s URL tags must be its own query-free path', () => {
  const bad = '<meta name="robots" content="noindex"><meta property="og:url" content="https://x.test/heat-map/nl/amsterdam/canal-ring/?area=F4">';
  assert.equal(run('plain', { '_astro/app.js': 'x', 'heat-map/nl/amsterdam/canal-ring/index.html': bad }).code, 1);
});
