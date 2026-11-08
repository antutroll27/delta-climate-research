import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/* INT re-audit R1: `npm run build` prunes dist/ after astro build. The streaming build's manifest (the pointer to the Amsterdam layer files on R2)
   must be pruned from the PRODUCTION build and kept in a build made with PUBLIC_OBOS_STREAM_DEV=1, or a dev-flag preview 404s on it and every
   area but Canal Ring fails. The script is run for real, in a scratch dist under node_modules/.cache (ignored, on this volume). */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(root, 'scripts', 'prune-dist-assets.mjs');
const MANIFEST = 'heat-map/data/ams-r2-manifest.json';

function prune(env) {
  mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, 'node_modules', '.cache', 'prune-test-'));
  try {
    for (const file of [MANIFEST, 'models/river-8k.glb', 'heat-map/data/canal-ring.json']) {
      mkdirSync(dirname(join(work, 'dist', file)), { recursive: true });
      writeFileSync(join(work, 'dist', file), '{}');
    }
    const clean = { ...process.env };
    delete clean.PUBLIC_OBOS_STREAM_DEV;
    execFileSync(process.execPath, [script], { cwd: work, env: { ...clean, ...env }, stdio: 'pipe' });
    return { manifest: existsSync(join(work, 'dist', MANIFEST)), glb: existsSync(join(work, 'dist', 'models/river-8k.glb')), ward: existsSync(join(work, 'dist', 'heat-map/data/canal-ring.json')) };
  } finally { rmSync(work, { recursive: true, force: true }); }
}

test('R1: the production build (no flag) drops the streaming manifest, and the other unused assets, but never the page\'s own data', () => {
  const kept = prune({});
  assert.equal(kept.manifest, false, 'the production dist must not carry the manifest');
  assert.equal(kept.glb, false);
  assert.equal(kept.ward, true);
});

test('R1: a PUBLIC_OBOS_STREAM_DEV=1 build keeps the manifest (the dev page fetches it), and still prunes the unused models', () => {
  const kept = prune({ PUBLIC_OBOS_STREAM_DEV: '1' });
  assert.equal(kept.manifest, true, 'a dev-flag preview needs the manifest or every area but Canal Ring 404s');
  assert.equal(kept.glb, false);
  assert.equal(kept.ward, true);
});

test('R1: any other value of the flag is not the dev flag', () => {
  assert.equal(prune({ PUBLIC_OBOS_STREAM_DEV: '0' }).manifest, false);
  assert.equal(prune({ PUBLIC_OBOS_STREAM_DEV: 'true' }).manifest, false);
});
