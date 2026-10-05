// tests/unit/cpcb-archive.test.mjs
// The hourly CPCB archive as the relay's ONLY write (single-write redesign, 2026-10-06): the ingest
// spends exactly one Blob put per new hour, and /api/air-quality reads "current" back by walking the
// IST hours. Operations are counted at the @vercel/blob boundary (a fake SDK behind the real blobStore).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { BlobError, BlobNotFoundError, BlobServiceNotAvailable } from '@vercel/blob';
import { handle } from '../../api/air-quality.ts';
import { handleIngest, STORE_BUDGET_MS } from '../../api/air-quality-ingest.ts';
import { signV1 } from '../../src/lib/aqi/relay-auth.ts';
import { archivePath, blobStore, memoryStore } from '../../src/lib/aqi/relay-store.ts';
import { newArchiveMemo, readArchivedHour, readLiveFeed, readNowcastHistory, readRelay, walkPaths } from '../../src/lib/aqi/cpcb-archive.ts';
import { FeedError } from '../../src/lib/aqi/cpcb-feed.ts';

const FEED_GZ = readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url));
const KEY = '5a'.repeat(32); // a test value, not a secret
const NOW = new Date('2026-09-27T00:30:00Z'); // 06:00 IST; the fixture is 05:00 IST
const ARCHIVE = 'cpcb/archive/2026/09/27/05.xml.gz';
const HOUR = 3_600_000;

function req(body, { ts = NOW.getTime() / 1000, key = KEY, sig } = {}) {
  return new Request('https://deltaclimate.earth/api/air-quality-ingest', { method: 'POST', body, headers: {
    'Content-Type': 'application/octet-stream', 'X-OBOS-Kind': 'cpcb-feed', 'X-OBOS-Timestamp': String(ts),
    'X-OBOS-Signature': sig ?? signV1(key, ts, body) } });
}
const quiet = async (fn) => { const w = console.warn, i = console.info, e = console.error; console.warn = console.info = console.error = () => {}; try { return await fn(); } finally { console.warn = w; console.info = i; console.error = e; } };
/** A synthetic feed of n stations, all stamped `stamp` (CPCB's IST "DD-MM-YYYY HH:MM:SS"). */
const feedOf = (stamp, n = 300) => gzipSync(`<?xml version='1.0'?><AqIndex><Country id="India"><State id="X"><City id="Y">${
  Array.from({ length: n }, (_, i) => `<Station id="S${i}" lastupdate="${stamp}" latitude="22.5" longitude="88.3"><Pollutant_Index id="PM10" Min="1" Max="9" Avg="5" Hourly_sub_index="5"/><Air_Quality_Index Value="5" Predominant_Parameter="PM10"/></Station>`).join('')
}</City></State></Country></AqIndex>`);
/** CPCB's IST stamp for an instant. */
const istStamp = (ms) => { const d = new Date(ms + 5.5 * HOUR), p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`; };
const streamOf = (b) => new ReadableStream({ start(c) { c.enqueue(b); c.close(); } });

/**
 * A fake @vercel/blob behind the REAL blobStore, counting every SDK call by operation type.
 * Advanced (Hobby: 2,000/month): put, copy, list. Simple (10,000/month): head, and a get that misses
 * the CDN; `fresh` gets always miss (useCache false), `cached` gets miss at most once per object.
 */
function fakeBlob({ put, get } = {}) {
  const objects = new Map(), ops = { put: 0, head: 0, fresh: 0, cached: 0, list: 0, copy: 0 }, puts = [];
  const api = {
    put: async (path, body, o) => {
      ops.put++; puts.push({ path, o });
      if (put) return put(path, body, o);
      if (objects.has(path) && !o.allowOverwrite) throw new BlobError('Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.');
      objects.set(path, new Uint8Array(body));
      return {};
    },
    head: async (path) => { ops.head++; if (!objects.has(path)) throw new BlobNotFoundError(); return {}; },
    get: async (path, o) => {
      if (o.useCache === false) ops.fresh++; else ops.cached++;
      if (get) { const r = get(path, o); if (r !== undefined) return r; }
      const b = objects.get(path);
      return b ? { statusCode: 200, stream: streamOf(b.slice()) } : null;
    },
  };
  return { objects, ops, puts, store: blobStore(api),
    advanced: () => ops.put + ops.copy + ops.list, reads: () => ops.fresh + ops.cached };
}
const ingest = (r, store, now = NOW, extra = {}) => quiet(() => handleIngest(r, { key: KEY, store, now: () => now, ...extra }));

/* ================= THE INGEST: one put per new hour ================= */

test('a new hour costs exactly one Advanced Operation (the archive put) and no Simple one', async () => {
  const b = fakeBlob();
  const r = await ingest(req(FEED_GZ), b.store);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { stored: 'new', lastupdate: '2026-09-26T23:30:00.000Z', stations: 481 });
  assert.deepEqual(b.ops, { put: 1, head: 0, fresh: 0, cached: 0, list: 0, copy: 0 });
  assert.deepEqual([...b.objects.keys()], [ARCHIVE]);
  assert.deepEqual(Buffer.from(b.objects.get(ARCHIVE)), FEED_GZ, 'byte for byte as the Pi sent it');
  assert.equal(b.puts[0].o.allowOverwrite, false);
  assert.ok(b.puts[0].o.abortSignal instanceof AbortSignal, 'the put carries the deadline');
});

test('24 consecutive hours cost exactly 24 puts: one object per hour, nothing else', async () => {
  const b = fakeBlob();
  const t0 = Date.parse('2026-10-05T18:30:00Z'); // 06-10-2026 00:00 IST
  for (let h = 0; h < 24; h++) {
    const now = new Date(t0 + h * HOUR + 10 * 60_000);
    const r = await ingest(req(feedOf(istStamp(t0 + h * HOUR)), { ts: now.getTime() / 1000 }), b.store, now);
    assert.equal((await r.json()).stored, 'new', `hour ${h}`);
  }
  assert.equal(b.advanced(), 24);
  assert.equal(b.ops.head + b.reads(), 0);
  assert.equal(b.objects.size, 24);
  assert.ok([...b.objects.keys()].every((k) => /^cpcb\/archive\/2026\/10\/06\/\d\d\.xml\.gz$/.test(k)));
});

test('a repeat on the same instance costs no operation at all; on a cold instance, the refused put plus one head', async () => {
  const b = fakeBlob();
  await ingest(req(FEED_GZ), b.store);
  const first = b.objects.get(ARCHIVE);
  const r = await ingest(req(FEED_GZ, { ts: NOW.getTime() / 1000 + 60 }), b.store);
  assert.deepEqual(await r.json(), { stored: 'duplicate', lastupdate: '2026-09-26T23:30:00.000Z', stations: 481 });
  assert.equal(b.advanced(), 1, 'zero puts for a repeat');
  assert.equal(b.ops.head, 0);

  /* Another instance (its own remembered set) meets the same hour: the put's conflict, confirmed by head. */
  const cold = await ingest(req(FEED_GZ, { ts: NOW.getTime() / 1000 + 120 }), b.store, NOW, { archived: new Set() });
  assert.equal(cold.status, 200);
  assert.equal((await cold.json()).stored, 'duplicate');
  assert.equal(b.advanced(), 2, 'the one refused put: no second Advanced Operation, no overwrite');
  assert.equal(b.ops.head, 1, 'the confirmation is a head, a Simple Operation');
  assert.equal(b.objects.get(ARCHIVE), first, 'first write wins');
});

test('a newer lastupdate inside an hour already archived: first write wins, answered duplicate', async () => {
  const b = fakeBlob();
  await ingest(req(feedOf('27-09-2026 05:00:00')), b.store);
  const first = b.objects.get(ARCHIVE);
  const r = await ingest(req(feedOf('27-09-2026 05:20:00'), { ts: NOW.getTime() / 1000 + 60 }), b.store, new Date(NOW.getTime() + 60_000), { archived: new Set() });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).stored, 'duplicate');
  assert.equal(b.objects.get(ARCHIVE), first);
  assert.equal(b.objects.size, 1);
});

test('a put failure is 503 (the Pi retries next tick); the retry stores the hour', async () => {
  let down = true;
  const b = fakeBlob();
  const real = fakeBlob();
  const store = { getArchive: b.store.getArchive, putArchive: async (p, gz, s) => { if (down) throw new BlobServiceNotAvailable(); return real.store.putArchive(p, gz, s); } };
  const r = await ingest(req(FEED_GZ), store);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'store_failed' });
  down = false;
  const again = await ingest(req(FEED_GZ, { ts: NOW.getTime() / 1000 + 900 }), store, new Date(NOW.getTime() + 900_000));
  assert.equal((await again.json()).stored, 'new', 'a failure is never remembered as archived');
  assert.equal(real.objects.size, 1);
});

test('a put refused for any other reason than "exists" is 503, never a false duplicate', async () => {
  const b = fakeBlob({ put: async () => { throw new BlobError('store suspended'); } });
  assert.equal((await ingest(req(FEED_GZ), b.store)).status, 503);
  assert.equal(b.ops.head, 1, 'head found nothing there');
  assert.equal(b.objects.size, 0);
});

/** Flushes pending promise jobs and I/O callbacks (setImmediate is not mocked). */
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

/* Each deadline test has its own timeout: with the deadline removed it must FAIL, not hang the run. */
test('a put that never resolves is cut off at STORE_BUDGET_MS: 503, its signal aborted, nothing waits past the budget', { timeout: 5_000 }, async (t) => {
  assert.equal(STORE_BUDGET_MS, 20_000);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const store = { getArchive: async () => null, putArchive: (_p, _gz, s) => { signal = s; return new Promise(() => {}); } };
  let settled = null;
  const p = ingest(req(FEED_GZ), store).then((r) => { settled = r; });
  await settle();
  assert.ok(signal, 'the put was called');
  t.mock.timers.tick(STORE_BUDGET_MS - 1);
  await settle();
  assert.equal(settled, null, 'still inside the budget');
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await p;
  assert.equal(settled.status, 503);
  assert.equal(signal.aborted, true, 'the SDK is told to stop');
});

test('an SDK that keeps retrying with backoff (and ignores the abort until its next attempt) is still cut off at the budget', { timeout: 5_000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  /* @vercel/blob 2.8: up to 10 retries, backoff 1, 2, 4, 8, 16 s ...; an abort bites only at the next attempt. */
  const b = fakeBlob({ put: async () => {
    for (let k = 0; k <= 10; k++) {
      attempts++;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** k));
    }
    throw new BlobServiceNotAvailable();
  } });
  let settled = null;
  const p = ingest(req(FEED_GZ), b.store).then((r) => { settled = r; });
  await settle();
  for (let s = 0; s < STORE_BUDGET_MS / 1000; s++) { t.mock.timers.tick(1000); await settle(); }
  await p;
  assert.equal(settled.status, 503);
  assert.ok(attempts <= 5, `the SDK was still retrying (attempt ${attempts}) when the answer went`);
  assert.equal(b.objects.size, 0);
});

test('unverified or invalid feeds cost zero operations', async () => {
  const t = NOW.getTime() / 1000;
  const cases = {
    'wrong key': req(FEED_GZ, { key: 'a5'.repeat(32) }),
    'no signature': req(FEED_GZ, { sig: '' }),
    'stale timestamp': req(FEED_GZ, { ts: t - 301 }),
    'not a feed': req(gzipSync('<html>busy</html>')),
    'too few stations': req(feedOf('27-09-2026 05:00:00', 299)),
    'from the future': req(feedOf('27-09-2026 07:00:00')),
    'not gzip': req(Buffer.from('<AqIndex/>')),
  };
  for (const [name, r] of Object.entries(cases)) {
    const b = fakeBlob();
    const res = await ingest(r, b.store);
    assert.ok(res.status >= 400 && res.status < 500, `${name}: ${res.status}`);
    assert.equal(b.advanced() + b.ops.head + b.reads(), 0, name);
  }
});

/* ================= THE HOUR KEY ================= */

/* Each case: CPCB's lastupdate (IST) → the archive path. The UTC instant is on another date for 00:00–05:29 IST. */
const BOUNDARIES = [
  ['05-10-2026 23:00:00', 'cpcb/archive/2026/10/05/23.xml.gz'], // 17:30 UTC, same date
  ['06-10-2026 00:00:00', 'cpcb/archive/2026/10/06/00.xml.gz'], // IST midnight: UTC is still 5 Oct 18:30
  ['06-10-2026 05:00:00', 'cpcb/archive/2026/10/06/05.xml.gz'], // 23:30 UTC on 5 Oct
  ['06-10-2026 05:30:00', 'cpcb/archive/2026/10/06/05.xml.gz'], // exactly UTC midnight, still IST hour 05
  ['01-11-2026 00:00:00', 'cpcb/archive/2026/11/01/00.xml.gz'], // month boundary
  ['01-01-2027 00:00:00', 'cpcb/archive/2027/01/01/00.xml.gz'], // year boundary
  ['01-03-2028 00:00:00', 'cpcb/archive/2028/03/01/00.xml.gz'], // after a leap day
];
/* The walk from an instant: the IST hour containing it, then the two before. */
const WALKS = [
  ['2026-10-05T18:40:00Z', ['2026/10/06/00', '2026/10/05/23', '2026/10/05/22']], // 00:10 IST: across IST midnight
  ['2026-10-31T18:40:00Z', ['2026/11/01/00', '2026/10/31/23', '2026/10/31/22']], // across a month
  ['2026-12-31T19:40:00Z', ['2027/01/01/01', '2027/01/01/00', '2026/12/31/23']], // across a year
  ['2028-02-29T19:10:00Z', ['2028/03/01/00', '2028/02/29/23', '2028/02/29/22']], // back over a leap day
  ['2026-10-05T23:59:59Z', ['2026/10/06/05', '2026/10/06/04', '2026/10/06/03']], // UTC midnight is mid-hour in IST
].map(([at, hs]) => [at, hs.map((h) => `cpcb/archive/${h}.xml.gz`)]);

test('the ingest keys each feed by its IST hour across midnight, month and year', async () => {
  for (const [stamp, path] of BOUNDARIES) {
    const [d, m, y, hh, mm] = stamp.split(/[- :]/).map(Number);
    const now = new Date(Date.UTC(y, m - 1, d, hh, mm) - 5.5 * HOUR + 10 * 60_000);
    const b = fakeBlob();
    const r = await ingest(req(feedOf(stamp), { ts: now.getTime() / 1000 }), b.store, now);
    assert.equal(r.status, 200, stamp);
    assert.deepEqual([...b.objects.keys()], [path], stamp);
  }
});

test('the read walk crosses IST midnight, a month, a year and a leap day', () => {
  for (const [at, paths] of WALKS) assert.deepEqual(walkPaths(new Date(at)), paths, at);
});

test('the hour key and the walk hold in any machine zone (child processes under TZ)', () => {
  const root = new URL('../../', import.meta.url);
  /* The real handler, signer, store and walk, fed the BOUNDARIES and WALKS; prints what each produced. */
  const code = `const { gzipSync } = await import('node:zlib');
    const [{ handleIngest }, { signV1 }, { memoryStore }, { walkPaths }] = await Promise.all([import('./api/air-quality-ingest.ts'),
      import('./src/lib/aqi/relay-auth.ts'), import('./src/lib/aqi/relay-store.ts'), import('./src/lib/aqi/cpcb-archive.ts')]);
    console.info = console.warn = () => {};
    const key = '5a'.repeat(32), out = [];
    for (const stamp of ${JSON.stringify(BOUNDARIES.map(([s]) => s))}) {
      const [d, m, y, hh, mm] = stamp.split(/[- :]/).map(Number);
      const now = new Date(Date.UTC(y, m - 1, d, hh, mm) - 5.5 * 3600000 + 600000), ts = now.getTime() / 1000;
      const body = gzipSync('<AqIndex>' + Array.from({ length: 300 }, (_, i) => '<Station id="S' + i + '" lastupdate="' + stamp + '" latitude="22.5" longitude="88.3"><Air_Quality_Index Value="5" Predominant_Parameter="PM10"/><Pollutant_Index id="PM10" Min="1" Max="9" Avg="5" Hourly_sub_index="5"/></Station>').join('') + '</AqIndex>');
      const store = memoryStore();
      await handleIngest(new Request('https://x.test/', { method: 'POST', body, headers: { 'X-OBOS-Kind': 'cpcb-feed', 'X-OBOS-Timestamp': String(ts), 'X-OBOS-Signature': signV1(key, ts, body) } }), { key, store, now: () => now });
      out.push([...store.files.keys()]);
    }
    const walks = ${JSON.stringify(WALKS.map(([at]) => at))}.map((at) => walkPaths(new Date(at)));
    process.stdout.write(JSON.stringify({ out, walks }));`;
  const want = { out: BOUNDARIES.map(([, p]) => [p]), walks: WALKS.map(([, w]) => w) };
  for (const TZ of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kolkata']) {
    const got = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { cwd: root, env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(got), want, TZ);
  }
});

/* ================= READING "CURRENT" BACK ================= */

const at = (iso) => new Date(iso);
/** A store holding synthetic feeds for the given IST stamps. */
function holding(stamps) {
  const b = fakeBlob();
  for (const s of stamps) {
    const [d, m, y, hh, mm] = s.split(/[- :]/).map(Number);
    b.objects.set(archivePath(new Date(Date.UTC(y, m - 1, d, hh, mm) - 5.5 * HOUR).toISOString()), new Uint8Array(feedOf(s)));
  }
  return b;
}

test('current hour archived: one fresh get, and that hour is served', async () => {
  const b = holding(['27-09-2026 06:00:00', '27-09-2026 05:00:00']);
  const feed = await readLiveFeed(b.store, at('2026-09-27T00:50:00Z'), newArchiveMemo()); // 06:20 IST
  assert.equal(feed[0].published_at, '2026-09-27T00:30:00.000Z');
  assert.deepEqual({ fresh: b.ops.fresh, cached: b.ops.cached }, { fresh: 1, cached: 0 });
});

test('current hour not yet archived: the previous hour is served (two fresh gets)', async () => {
  const b = holding(['27-09-2026 05:00:00']);
  const feed = await readLiveFeed(b.store, at('2026-09-27T00:50:00Z'), newArchiveMemo());
  assert.equal(feed[0].published_at, '2026-09-26T23:30:00.000Z');
  assert.equal(b.ops.fresh, 2);
});

test('nothing archived inside the walk: "relay feed missing" after exactly three gets, and an older archive is never reached', async () => {
  const b = holding(['27-09-2026 03:00:00']);
  await assert.rejects(readLiveFeed(b.store, at('2026-09-27T00:50:00Z'), newArchiveMemo()), (e) => e instanceof FeedError && e.message === 'relay feed missing');
  assert.equal(b.ops.fresh, 3);
});

test('a read ERROR is not a 404: it fails at once, and the older hour behind it is never served', async () => {
  const b = holding(['27-09-2026 05:00:00']);
  const broken = fakeBlob({ get: (path) => { if (path.endsWith('/06.xml.gz')) throw new BlobServiceNotAvailable(); } });
  broken.objects.set(ARCHIVE, b.objects.get(ARCHIVE));
  await assert.rejects(readLiveFeed(broken.store, at('2026-09-27T00:50:00Z'), newArchiveMemo()),
    (e) => e instanceof FeedError && e.message === 'relay store unreachable');
  assert.equal(broken.ops.fresh, 1, 'the 05:00 archive was not asked for');
  /* A non-200 status is a failure too, not a 404. */
  const odd = fakeBlob({ get: () => ({ statusCode: 304, stream: null }) });
  await assert.rejects(readLiveFeed(odd.store, at('2026-09-27T00:50:00Z'), newArchiveMemo()), /unreachable/);
});

test('an object that is not a feed, or not its hour, fails the read (never skipped to an older hour)', async () => {
  const b = holding(['27-09-2026 05:00:00']);
  b.objects.set('cpcb/archive/2026/09/27/06.xml.gz', new Uint8Array([1, 2, 3]));
  await assert.rejects(readLiveFeed(b.store, at('2026-09-27T00:50:00Z'), newArchiveMemo()), /relay feed corrupt/);
  b.objects.set('cpcb/archive/2026/09/27/06.xml.gz', new Uint8Array(feedOf('27-09-2026 07:00:00')));
  await assert.rejects(readLiveFeed(b.store, at('2026-09-27T00:50:00Z'), newArchiveMemo()), /not its hour/);
});

test('a warm instance re-asks only the hours NEWER than the one it holds', async () => {
  const b = holding(['27-09-2026 05:00:00']);
  const memo = newArchiveMemo();
  await readLiveFeed(b.store, at('2026-09-27T00:50:00Z'), memo); // 06 404, 05 found
  b.ops.fresh = 0;
  await readLiveFeed(b.store, at('2026-09-27T01:00:00Z'), memo); // ten minutes later: 06 asked again, 05 remembered
  assert.equal(b.ops.fresh, 1);
  b.objects.set('cpcb/archive/2026/09/27/06.xml.gz', new Uint8Array(feedOf('27-09-2026 06:00:00')));
  const f = await readLiveFeed(b.store, at('2026-09-27T01:10:00Z'), memo);
  assert.equal(f[0].published_at, '2026-09-27T00:30:00.000Z', 'the new hour appears at the next refresh');
  b.ops.fresh = 0;
  await readLiveFeed(b.store, at('2026-09-27T01:20:00Z'), memo);
  assert.equal(b.ops.fresh, 0, 'the current hour is held: no operation at all');
});

/* ================= NOWCAST HOURS: settled, so CDN-cached and remembered ================= */

test('NowCast reads the 11 hours before the current one through the CDN, once; a gap is re-asked fresh, and a late hour is taken', async () => {
  const stamps = Array.from({ length: 12 }, (_, i) => istStamp(Date.parse('2026-09-27T00:30:00Z') - i * HOUR));
  const b = holding(stamps.filter((_, i) => i !== 4)); // 06:00 back to 19:00 the day before, 02:00 missing
  const memo = newArchiveMemo();
  const snap = await readRelay(b.store, at('2026-09-27T00:50:00Z'), memo);
  assert.equal(snap.history.hours.length, 11, '12 hours minus the gap');
  assert.deepEqual({ fresh: b.ops.fresh, cached: b.ops.cached }, { fresh: 1, cached: 11 }, 'one fresh probe; the settled hours via the CDN');
  b.ops.fresh = b.ops.cached = 0;
  await readRelay(b.store, at('2026-09-27T01:00:00Z'), memo);
  assert.deepEqual({ fresh: b.ops.fresh, cached: b.ops.cached }, { fresh: 1, cached: 0 },
    '06:30 IST: the current hour and ten settled hours are held; only the gap is asked again, at origin');
  /* The gap is filled late (as the old record would have taken it at once): the next refresh has it. */
  const two = holding([stamps[4]]);
  for (const [k, v] of two.objects) b.objects.set(k, v);
  const later = await readRelay(b.store, at('2026-09-27T01:10:00Z'), memo);
  assert.equal(later.history.hours.length, 12);
  assert.ok(memo.hours.size <= 12, 'the memo never outgrows the window');
});

test('an unreadable NowCast hour withdraws the NowCast (null) but never the current figure; it is not remembered', async () => {
  const stamps = Array.from({ length: 12 }, (_, i) => istStamp(Date.parse('2026-09-27T00:30:00Z') - i * HOUR));
  const b = holding(stamps);
  let down = true;
  const flaky = fakeBlob({ get: (path, o) => { if (down && o.useCache !== false && path.endsWith('/03.xml.gz')) throw new BlobServiceNotAvailable(); } });
  for (const [k, v] of b.objects) flaky.objects.set(k, v);
  const memo = newArchiveMemo();
  const snap = await readRelay(flaky.store, at('2026-09-27T00:50:00Z'), memo);
  assert.equal(snap.stations[0].published_at, '2026-09-27T00:30:00.000Z');
  assert.equal(snap.history, null);
  down = false;
  const again = await readRelay(flaky.store, at('2026-09-27T01:00:00Z'), memo);
  assert.equal(again.history.hours.length, 12, 'asked again, and whole');
});

test('a NowCast hour that reads but is not a feed of its hour is a gap, not a withdrawn NowCast', async () => {
  const stamps = Array.from({ length: 12 }, (_, i) => istStamp(Date.parse('2026-09-27T00:30:00Z') - i * HOUR));
  const b = holding(stamps);
  b.objects.set('cpcb/archive/2026/09/27/03.xml.gz', new Uint8Array([1, 2, 3]));
  const snap = await readRelay(b.store, at('2026-09-27T00:50:00Z'), newArchiveMemo());
  assert.equal(snap.history.hours.length, 11);
});

test('readNowcastHistory never throws', async () => {
  const boom = { getArchive: async () => { throw new Error('x'); }, putArchive: async () => 'stored' };
  const feed = (await readArchivedHour(holding(['27-09-2026 05:00:00']).store, '2026-09-27T05:00:00+05:30'));
  assert.equal(await readNowcastHistory(boom, feed, newArchiveMemo()), null);
});

/* ================= THE HANDLER: fallbacks unchanged ================= */

const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } }; return r; };
const openaqRows = (u) => new Response(JSON.stringify({ results: Array.from({ length: 48 }, (_, i) => ({
  value: String(u).includes('12236007') ? 0.5 : 20, period: { datetimeTo: { utc: new Date(Date.parse('2026-09-24T13:00:00Z') - i * HOUR).toISOString() } } })) }));
async function api(area, store, now) {
  const r = res();
  await quiet(() => handle({ method: 'GET', query: { area } }, r, { key: 'k', fetch: openaqRows, now: () => now, cache: new Map(), inflight: new Map(),
    feedCache: { entry: null, inflight: null }, cpcbFeed: true, source: 'relay', store }));
  return r;
}

test('handler: current hour present → CPCB live; missing → the previous hour; none within LIVE_H → OpenAQ fallback', async () => {
  const live = await api('in/kolkata/ballygunge', (() => { const s = memoryStore(); s.files.set(ARCHIVE, FEED_GZ); return s; })(), at('2026-09-27T00:50:00Z'));
  assert.deepEqual({ s: live.body.current.state, o: live.body.current.result.origin, aqi: live.body.current.result.aqi }, { s: 'live', o: 'cpcb', aqi: 38 }, 'served from 05:00 while 06:00 is not archived');
  const none = await api('in/kolkata/ballygunge', memoryStore(), at('2026-09-27T00:50:00Z'));
  assert.equal(none.body.current.result.origin, 'obos');
  assert.equal(none.headers['Cache-Control'], 'public, max-age=0, s-maxage=60');
});

test('handler: a read error falls back like any failure, and never serves the older hour behind it', async () => {
  const b = fakeBlob({ get: (path) => { if (path.endsWith('/06.xml.gz')) throw new BlobServiceNotAvailable(); } });
  b.objects.set(ARCHIVE, new Uint8Array(FEED_GZ));
  const k = await api('in/kolkata/ballygunge', b.store, at('2026-09-27T00:50:00Z'));
  assert.equal(k.body.current.result.origin, 'obos', 'Kolkata: OpenAQ, as when CPCB is unreachable');
  const blr = await api('in/bengaluru/indiranagar', b.store, at('2026-09-27T00:50:00Z'));
  assert.deepEqual({ s: blr.body.current.state, why: blr.body.current.reason }, { s: 'unavailable', why: 'upstream_error' }, 'Bengaluru: no OpenAQ, the honest unavailable state');
  assert.equal(blr.headers['Cache-Control'], 'no-store');
});

test('round trip: an hour the ingest archived reads back by any instant inside that IST hour', async () => {
  const store = memoryStore();
  await ingest(req(FEED_GZ), store);
  for (const t of ['2026-09-27T05:00:00+05:30', '2026-09-27T05:59:59+05:30', new Date('2026-09-26T23:30:00Z')]) {
    const feed = await readArchivedHour(store, t);
    assert.equal(feed?.length, 481, String(t));
    assert.ok(feed.every((s) => s.published_at === '2026-09-26T23:30:00.000Z'), String(t));
  }
  assert.equal(await readArchivedHour(store, '2026-09-27T06:00:00+05:30'), null);
  await assert.rejects(readArchivedHour(store, 'not a date'), RangeError);
});
