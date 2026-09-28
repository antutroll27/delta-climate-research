// tests/unit/relay-store.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobError, BlobNotFoundError } from '@vercel/blob';
import { archivePath, blobStore, LATEST_PATH, memoryStore, RELAY_MAX_GZ_BYTES } from '../../src/lib/aqi/relay-store.ts';

const bytes = (s) => new TextEncoder().encode(s);
const streamOf = (...chunks) => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });

test('archivePath is keyed by the IST hour of the feed', () => {
  assert.equal(archivePath('2026-09-26T23:30:00.000Z'), 'cpcb/archive/2026/09/27/05.xml.gz');
  assert.equal(archivePath('2026-12-31T18:30:00.000Z'), 'cpcb/archive/2027/01/01/00.xml.gz', 'the IST new year');
  assert.throws(() => archivePath('not a date'), RangeError);
});

test('memoryStore: latest overwrites; an archive path is written once', async () => {
  const s = memoryStore();
  assert.equal(await s.getLatest(), null);
  await s.putLatest(bytes('a')); await s.putLatest(bytes('b'));
  assert.deepEqual(await s.getLatest(), bytes('b'));
  assert.equal(await s.putArchive('cpcb/archive/x.xml.gz', bytes('1')), 'stored');
  assert.equal(await s.putArchive('cpcb/archive/x.xml.gz', bytes('2')), 'exists');
  assert.deepEqual(s.files.get('cpcb/archive/x.xml.gz'), bytes('1'), 'the first write stands');
});

test('blobStore.putLatest overwrites privately, with no random suffix', async () => {
  const calls = [];
  const s = blobStore({ put: async (...a) => { calls.push(a); return {}; } });
  await s.putLatest(bytes('gz'));
  const [path, body, opts] = calls[0];
  assert.equal(path, LATEST_PATH);
  assert.deepEqual(new Uint8Array(body), bytes('gz'));
  assert.deepEqual({ access: opts.access, suffix: opts.addRandomSuffix, over: opts.allowOverwrite, type: opts.contentType },
    { access: 'private', suffix: false, over: true, type: 'application/gzip' });
});

test('blobStore.putArchive never overwrites; "already exists" is confirmed by head, not by message', async () => {
  const opts = [];
  const stored = blobStore({ put: async (_p, _b, o) => { opts.push(o); return {}; } });
  assert.equal(await stored.putArchive('cpcb/archive/a.xml.gz', bytes('x')), 'stored');
  assert.equal(opts[0].allowOverwrite, false);
  assert.equal(opts[0].access, 'private');

  const exists = blobStore({ put: async () => { throw new BlobError('This blob already exists'); }, head: async () => ({}) });
  assert.equal(await exists.putArchive('cpcb/archive/a.xml.gz', bytes('x')), 'exists');

  const reworded = blobStore({ put: async () => { throw new BlobError('some future wording'); }, head: async () => ({}) });
  assert.equal(await reworded.putArchive('cpcb/archive/a.xml.gz', bytes('x')), 'exists', 'the wording does not matter');
});

test('blobStore.putArchive rethrows a real failure: never a false duplicate', async () => {
  const outage = new BlobError('store suspended');
  const s = blobStore({ put: async () => { throw outage; }, head: async () => { throw new BlobNotFoundError(); } });
  await assert.rejects(s.putArchive('cpcb/archive/a.xml.gz', bytes('x')), (e) => e === outage);
  let headCalled = false;
  const net = blobStore({ put: async () => { throw new TypeError('fetch failed'); }, head: async () => { headCalled = true; return {}; } });
  await assert.rejects(net.putArchive('cpcb/archive/a.xml.gz', bytes('x')), TypeError);
  assert.equal(headCalled, false, 'a non-Blob error is not probed');
});

test('blobStore.getLatest: private, uncached; null when absent; capped', async () => {
  let seen;
  const s = blobStore({ get: async (p, o) => { seen = { p, o }; return { statusCode: 200, stream: streamOf(bytes('ab'), bytes('c')) }; } });
  assert.deepEqual(await s.getLatest(), bytes('abc'));
  assert.equal(seen.p, LATEST_PATH);
  assert.deepEqual({ access: seen.o.access, useCache: seen.o.useCache }, { access: 'private', useCache: false });
  assert.ok(seen.o.abortSignal instanceof AbortSignal, 'the read has a deadline');

  assert.equal(await blobStore({ get: async () => null }).getLatest(), null);
  const big = blobStore({ get: async () => ({ statusCode: 200, stream: streamOf(new Uint8Array(RELAY_MAX_GZ_BYTES), new Uint8Array(1)) }) });
  await assert.rejects(big.getLatest(), /too large/);
});
