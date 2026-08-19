import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadEstimatorPack } from '../../src/scripts/cbam-algos/estimator/load-pack.ts';

const rawPack = readFileSync(new URL('../../public/cbam/estimator-pack.json', import.meta.url));
const integrity = {
  schemaVersion: 1,
  algorithm: 'sha256',
  packSha256: 'fc56043b76d22dba984f55e783f8d9de6bc1df04a7f0513116898fda3646889d',
  generatedAt: '2026-08-18T00:00:00.000Z',
};

test('pack loader hashes exact response bytes against bundled integrity', async () => {
  let requests = 0;
  const loaded = await loadEstimatorPack('/cbam/estimator-pack.json', integrity, async () => {
    requests += 1;
    return new Response(rawPack);
  });

  assert.equal(requests, 1, 'only the pack is public-fetched; expected integrity is bundled');
  assert.equal(loaded.packSha256, integrity.packSha256);
  assert.equal(loaded.pack.schemaVersion, 2);
});

test('changed public pack bytes cannot be blessed by changing a public manifest', async () => {
  const changed = Buffer.from(rawPack);
  changed[changed.length - 2] = changed[changed.length - 2] === 0x30 ? 0x31 : 0x30;

  await assert.rejects(
    loadEstimatorPack('/cbam/estimator-pack.json', integrity, async () => new Response(changed)),
    /pack content SHA-256 mismatch/,
  );
});
