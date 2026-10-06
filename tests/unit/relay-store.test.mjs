// tests/unit/relay-store.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobError, BlobNotFoundError } from '@vercel/blob';
import { archivePath, blobStore, memoryStore, RELAY_MAX_GZ_BYTES } from '../../src/lib/aqi/relay-store.ts';

const bytes = (s) => new TextEncoder().encode(s);
const streamOf = (...chunks) => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });

test('archivePath is keyed by the IST hour of the feed', () => {
  assert.equal(archivePath('2026-09-26T23:30:00.000Z'), 'cpcb/archive/2026/09/27/05.xml.gz');
  assert.equal(archivePath('2026-12-31T18:30:00.000Z'), 'cpcb/archive/2027/01/01/00.xml.gz', 'the IST new year');
  assert.throws(() => archivePath('not a date'), RangeError);
});

test('memoryStore: an archive path is written once and read back; an absent one is null', async () => {
  const s = memoryStore();
  assert.equal(await s.getArchive('cpcb/archive/x.xml.gz'), null);
  assert.equal(await s.putArchive('cpcb/archive/x.xml.gz', bytes('1')), 'stored');
  assert.equal(await s.putArchive('cpcb/archive/x.xml.gz', bytes('2')), 'exists');
  assert.deepEqual(s.files.get('cpcb/archive/x.xml.gz'), bytes('1'), 'the first write stands');
  assert.deepEqual(await s.getArchive('cpcb/archive/x.xml.gz'), bytes('1'));
  assert.deepEqual(Object.keys(s).sort(), ['files', 'getArchive', 'putArchive'], 'no latest, no history: the archive is the only object');
});

test('blobStore.putArchive never overwrites; "already exists" is confirmed by head, not by message', async () => {
  const opts = [];
  const stored = blobStore({ put: async (_p, _b, o) => { opts.push(o); return {}; } });
  const ctl = new AbortController();
  assert.equal(await stored.putArchive('cpcb/archive/a.xml.gz', bytes('x'), ctl.signal), 'stored');
  assert.deepEqual({ over: opts[0].allowOverwrite, access: opts[0].access, suffix: opts[0].addRandomSuffix, type: opts[0].contentType },
    { over: false, access: 'private', suffix: false, type: 'application/gzip' });
  assert.equal(opts[0].abortSignal, ctl.signal, 'the ingest deadline reaches the SDK');
  assert.equal('cacheControlMaxAge' in opts[0], false, 'immutable: the default (1 month) CDN lifetime is right');

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

test('blobStore.getArchive: private; CDN-cached unless fresh; null on 404; capped; any other status throws', async () => {
  const seen = [];
  const s = blobStore({ get: async (p, o) => { seen.push({ p, o }); return { statusCode: 200, stream: streamOf(bytes('ab'), bytes('c')) }; } });
  assert.deepEqual(await s.getArchive('cpcb/archive/a.xml.gz'), bytes('abc'));
  assert.deepEqual(await s.getArchive('cpcb/archive/a.xml.gz', { fresh: true }), bytes('abc'));
  assert.equal(seen[0].p, 'cpcb/archive/a.xml.gz');
  assert.equal(seen[0].o.access, 'private');
  assert.equal('useCache' in seen[0].o, false, 'a settled hour is read through the CDN (the SDK default)');
  assert.equal(seen[1].o.useCache, false, 'a fresh probe goes to origin, so a cached 404 cannot hide a new hour');
  for (const { o } of seen) assert.ok(o.abortSignal instanceof AbortSignal, 'every read has a deadline');
  const ctl = new AbortController();
  await s.getArchive('cpcb/archive/a.xml.gz', { signal: ctl.signal });
  assert.equal(seen[2].o.abortSignal, ctl.signal, "the caller's deadline is used");

  assert.equal(await blobStore({ get: async () => null }).getArchive('p'), null);
  await assert.rejects(blobStore({ get: async () => ({ statusCode: 304, stream: null }) }).getArchive('p'), /answered 304/);
  await assert.rejects(blobStore({ get: async () => { throw new BlobError('store suspended'); } }).getArchive('p'), BlobError);
  const big = blobStore({ get: async () => ({ statusCode: 200, stream: streamOf(new Uint8Array(RELAY_MAX_GZ_BYTES), new Uint8Array(1)) }) });
  await assert.rejects(big.getArchive('p'), /too large/);
});
