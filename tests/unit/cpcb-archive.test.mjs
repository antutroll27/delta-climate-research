// tests/unit/cpcb-archive.test.mjs
// The hourly CPCB archive: written once per IST hour by the ingest, best effort, read back by date.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { handleIngest } from '../../api/air-quality-ingest.ts';
import { signV1 } from '../../src/lib/aqi/relay-auth.ts';
import { LATEST_PATH, memoryStore } from '../../src/lib/aqi/relay-store.ts';
import { archiveFeed, readArchivedHour } from '../../src/lib/aqi/cpcb-archive.ts';
import { FeedError } from '../../src/lib/aqi/cpcb-feed.ts';

const FEED_GZ = readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url));
const KEY = '5a'.repeat(32); // a test value, not a secret
const NOW = new Date('2026-09-27T00:30:00Z'); // 06:00 IST; the fixture is 05:00 IST
const ARCHIVE = 'cpcb/archive/2026/09/27/05.xml.gz';

function req(body, { ts = NOW.getTime() / 1000, key = KEY, sig } = {}) {
  return new Request('https://deltaclimate.earth/api/air-quality-ingest', { method: 'POST', body, headers: {
    'Content-Type': 'application/octet-stream', 'X-OBOS-Kind': 'cpcb-feed', 'X-OBOS-Timestamp': String(ts),
    'X-OBOS-Signature': sig ?? signV1(key, ts, body) } });
}
const quiet = async (fn) => { const w = console.warn, i = console.info; console.warn = console.info = () => {}; try { return await fn(); } finally { console.warn = w; console.info = i; } };
/** A memory store that counts every write, by method. */
function counted(base = memoryStore()) {
  const n = { putArchive: 0, putLatest: 0, putHistory: 0 };
  return { n, store: { ...base, files: base.files,
    putArchive: (p, gz) => { n.putArchive++; return base.putArchive(p, gz); },
    putLatest: (gz) => { n.putLatest++; return base.putLatest(gz); },
    putHistory: (j) => { n.putHistory++; return base.putHistory(j); } } };
}
const ingest = (r, store, now = NOW) => quiet(() => handleIngest(r, { key: KEY, store, now: () => now }));
/** The same feed submitted `dt` seconds after NOW, with the server clock moved on to match. */
const later = (gz, store, dt) => { const now = new Date(NOW.getTime() + dt * 1000); return ingest(req(gz, { ts: now.getTime() / 1000 }), store, now); };
/** A synthetic feed of 300 stations, all stamped `stamp` (CPCB's IST "DD-MM-YYYY HH:MM:SS"). */
const feedOf = (stamp, n = 300) => gzipSync(`<?xml version='1.0'?><AqIndex><Country id="India"><State id="X"><City id="Y">${
  Array.from({ length: n }, (_, i) => `<Station id="S${i}" lastupdate="${stamp}" latitude="22.5" longitude="88.3"><Pollutant_Index id="PM10" Min="1" Max="9" Avg="5" Hourly_sub_index="5"/><Air_Quality_Index Value="5" Predominant_Parameter="PM10"/></Station>`).join('')
}</City></State></Country></AqIndex>`);
const archives = (store) => [...store.files.keys()].filter((k) => k.startsWith('cpcb/archive/')).sort();

/* ---- The ingest writes each new hour once. ---- */

test('a new hour is archived once, byte for byte as the Pi sent it', async () => {
  const { store, n } = counted();
  const r = await ingest(req(FEED_GZ), store);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).stored, 'new');
  assert.deepEqual(archives(store), [ARCHIVE]);
  assert.deepEqual(Buffer.from(store.files.get(ARCHIVE)), FEED_GZ);
  assert.equal(n.putArchive, 1);
});

test('the same hour submitted again is not rewritten: the first archive stands, the answer is duplicate', async () => {
  const { store, n } = counted();
  await ingest(req(FEED_GZ), store);
  const first = store.files.get(ARCHIVE);
  for (const dt of [60, 900, 1800]) {
    const r = await later(FEED_GZ, store, dt);
    assert.equal((await r.json()).stored, 'duplicate', `+${dt} s`);
  }
  assert.equal(store.files.get(ARCHIVE), first, 'the very same object, never replaced');
  assert.equal(n.putLatest, 1, 'latest is written once, by the first submission');
  assert.equal(n.putHistory, 1, 'the history too');
});

test('a newer lastupdate inside the same IST hour: the archive keeps the first, latest moves forward', async () => {
  const { store } = counted();
  await ingest(req(feedOf('27-09-2026 05:00:00')), store);
  const first = store.files.get(ARCHIVE);
  const newer = feedOf('27-09-2026 05:20:00');
  const r = await later(newer, store, 60);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).stored, 'new', 'latest advanced, so something new was stored');
  assert.deepEqual(archives(store), [ARCHIVE], 'still one object for the hour');
  assert.equal(store.files.get(ARCHIVE), first, 'first write wins');
  assert.deepEqual(Buffer.from(store.files.get(LATEST_PATH)), Buffer.from(newer));
});

/* ---- The archive is best effort: the live path never depends on it. ---- */

test('an archive failure still stores latest and answers the Pi exactly as a success would', async () => {
  const ok = counted(), bad = counted();
  bad.store.putArchive = async () => { throw new TypeError('fetch failed'); };
  const good = await ingest(req(FEED_GZ), ok.store);
  const r = await ingest(req(FEED_GZ), bad.store);
  assert.equal(r.status, good.status);
  assert.deepEqual(await r.json(), await good.json());
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(Buffer.from(bad.store.files.get(LATEST_PATH)), FEED_GZ, 'latest stored');
  assert.equal(bad.n.putHistory, 1, 'the NowCast history still updated');
  assert.deepEqual(archives(bad.store), []);
});

test('an archive failure is logged with its error class and path, never its message', async () => {
  class BlobServiceNotAvailable extends Error {}
  const { store } = counted();
  store.putArchive = async () => { throw new BlobServiceNotAvailable('store sk_secret_details'); };
  const lines = [], w = console.warn, i = console.info;
  console.warn = console.info = (...a) => lines.push(a.join(' '));
  try {
    assert.equal((await handleIngest(req(FEED_GZ), { key: KEY, store, now: () => NOW })).status, 200);
  } finally { console.warn = w; console.info = i; }
  const out = lines.join('\n');
  assert.match(out, /archive failed .*BlobServiceNotAvailable/);
  assert.match(out, /cpcb\/archive\/2026\/09\/27\/05\.xml\.gz/);
  assert.doesNotMatch(out, /sk_secret_details/);
});

test('when latest also fails it is 503, and the retry archives the hour and repairs latest', async () => {
  const base = memoryStore();
  let down = true;
  const store = { ...base, files: base.files,
    putArchive: async (p, gz) => { if (down) throw new Error('blob down'); return base.putArchive(p, gz); },
    putLatest: async (gz) => { if (down) throw new Error('blob down'); return base.putLatest(gz); } };
  assert.equal((await ingest(req(FEED_GZ), store)).status, 503);
  assert.equal(store.files.size, 0);
  down = false;
  const r = await later(FEED_GZ, store, 900);
  assert.equal((await r.json()).stored, 'new');
  assert.deepEqual(archives(store), [ARCHIVE]);
  assert.deepEqual(Buffer.from(store.files.get(LATEST_PATH)), FEED_GZ);
});

test('archived but latest failed (503): the retry is a duplicate archive yet still repairs latest', async () => {
  const base = memoryStore();
  let latestDown = true;
  const store = { ...base, files: base.files,
    putLatest: async (gz) => { if (latestDown) throw new Error('blob down'); return base.putLatest(gz); } };
  assert.equal((await ingest(req(FEED_GZ), store)).status, 503);
  assert.deepEqual(archives(store), [ARCHIVE], 'the archive landed before latest failed');
  latestDown = false;
  const r = await later(FEED_GZ, store, 900);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).stored, 'new', 'latest was stored this time');
  assert.deepEqual(Buffer.from(store.files.get(LATEST_PATH)), FEED_GZ);
});

/* ---- Only verified, valid feeds reach the archive. ---- */

test('an unsigned, mis-signed or stale submission archives nothing', async () => {
  const t = NOW.getTime() / 1000;
  for (const [name, r] of Object.entries({
    'wrong key': req(FEED_GZ, { key: 'a5'.repeat(32) }),
    'no signature': req(FEED_GZ, { sig: '' }),
    'stale timestamp': req(FEED_GZ, { ts: t - 301 }),
  })) {
    const { store, n } = counted();
    assert.equal((await ingest(r, store)).status, 401, name);
    assert.equal(n.putArchive, 0, name);
    assert.equal(store.files.size, 0, name);
  }
});

test('a feed the validator refuses archives nothing', async () => {
  for (const [name, gz] of Object.entries({
    'not a feed': gzipSync('<html>busy</html>'),
    'too few stations': feedOf('27-09-2026 05:00:00', 299),
    'from the future': feedOf('27-09-2026 07:00:00'),
    'not gzip': Buffer.from('<AqIndex/>'),
  })) {
    const { store, n } = counted();
    const r = await ingest(req(gz), store);
    assert.ok(r.status >= 400 && r.status < 500, `${name}: ${r.status}`);
    assert.equal(n.putArchive, 0, name);
  }
});

/* ---- The hour key: CPCB's own IST wall-clock hour, whatever the machine zone. ---- */

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

test('the ingest keys each feed by its IST hour across midnight, month and year (in this process)', async () => {
  for (const [stamp, path] of BOUNDARIES) {
    const [d, m, y, hh, mm] = stamp.split(/[- :]/).map(Number);
    const now = new Date(Date.UTC(y, m - 1, d, hh, mm) - 5.5 * 3_600_000 + 10 * 60_000); // 10 min after publication
    const { store } = counted();
    const r = await ingest(req(feedOf(stamp), { ts: now.getTime() / 1000 }), store, now);
    assert.equal(r.status, 200, stamp);
    assert.deepEqual(archives(store), [path], stamp);
  }
});

test('the hour key holds in any machine zone (the whole ingest, in child processes under TZ)', () => {
  const root = new URL('../../', import.meta.url);
  /* The real handler, signer and store, fed the BOUNDARIES; prints the archive path each one wrote. */
  const code = `const { gzipSync } = await import('node:zlib');
    const [{ handleIngest }, { signV1 }, { memoryStore }] = await Promise.all([import('./api/air-quality-ingest.ts'), import('./src/lib/aqi/relay-auth.ts'), import('./src/lib/aqi/relay-store.ts')]);
    console.info = console.warn = () => {};
    const key = '5a'.repeat(32), out = [];
    for (const stamp of ${JSON.stringify(BOUNDARIES.map(([s]) => s))}) {
      const [d, m, y, hh, mm] = stamp.split(/[- :]/).map(Number);
      const now = new Date(Date.UTC(y, m - 1, d, hh, mm) - 5.5 * 3600000 + 600000), ts = now.getTime() / 1000;
      const body = gzipSync('<AqIndex>' + Array.from({ length: 300 }, (_, i) => '<Station id="S' + i + '" lastupdate="' + stamp + '" latitude="22.5" longitude="88.3"><Air_Quality_Index Value="5" Predominant_Parameter="PM10"/><Pollutant_Index id="PM10" Min="1" Max="9" Avg="5" Hourly_sub_index="5"/></Station>').join('') + '</AqIndex>');
      const store = memoryStore();
      await handleIngest(new Request('https://x.test/', { method: 'POST', body, headers: { 'X-OBOS-Kind': 'cpcb-feed', 'X-OBOS-Timestamp': String(ts), 'X-OBOS-Signature': signV1(key, ts, body) } }), { key, store, now: () => now });
      out.push([...store.files.keys()].filter((k) => k.startsWith('cpcb/archive/')));
    }
    process.stdout.write(JSON.stringify(out));`;
  const want = BOUNDARIES.map(([, p]) => [p]);
  for (const TZ of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kolkata']) {
    const out = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { cwd: root, env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), want, TZ);
  }
});

/* ---- Read-back: the format is proven round-trip. ---- */

test('round trip: an hour the ingest archived reads back by any instant inside that IST hour', async () => {
  const store = memoryStore();
  await ingest(req(FEED_GZ), store);
  for (const at of ['2026-09-27T05:00:00+05:30', '2026-09-27T05:59:59+05:30', new Date('2026-09-26T23:30:00Z')]) {
    const feed = await readArchivedHour(store, at);
    assert.equal(feed?.length, 481, String(at));
    assert.ok(feed.every((s) => s.published_at === '2026-09-26T23:30:00.000Z'), String(at));
    assert.ok(feed.some((s) => s.name.startsWith('Ballygunge')), String(at));
  }
  assert.equal(await readArchivedHour(store, '2026-09-27T06:00:00+05:30'), null, 'the next hour was never archived');
  assert.equal(await readArchivedHour(store, '2026-09-27T04:59:59+05:30'), null, 'nor the previous one');
});

test('read-back refuses an object whose contents belong to another hour, or are not a feed', async () => {
  const store = memoryStore();
  store.files.set(ARCHIVE, feedOf('27-09-2026 07:00:00'));
  await assert.rejects(readArchivedHour(store, '2026-09-27T05:00:00+05:30'), FeedError);
  store.files.set(ARCHIVE, new Uint8Array([1, 2, 3]));
  await assert.rejects(readArchivedHour(store, '2026-09-27T05:00:00+05:30'), FeedError);
  await assert.rejects(readArchivedHour(store, 'not a date'), RangeError);
});

test('archiveFeed never throws: stored, exists, or failed', async () => {
  const store = memoryStore();
  const quietly = (fn) => quiet(fn);
  assert.equal(await quietly(() => archiveFeed(store, '2026-09-26T23:30:00.000Z', FEED_GZ)), 'stored');
  assert.equal(await quietly(() => archiveFeed(store, '2026-09-26T23:30:00.000Z', FEED_GZ)), 'exists');
  const broken = { ...store, putArchive: async () => { throw new Error('down'); } };
  assert.equal(await quietly(() => archiveFeed(broken, '2026-09-26T23:30:00.000Z', FEED_GZ)), 'failed');
  assert.equal(await quietly(() => archiveFeed(store, 'not a date', FEED_GZ)), 'failed');
});
