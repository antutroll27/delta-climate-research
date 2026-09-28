// tests/unit/aqi-ingest.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import test from 'node:test';
import { handleIngest, MIN_STATIONS, POST } from '../../api/air-quality-ingest.ts';
import { signV1 } from '../../src/lib/aqi/relay-auth.ts';
import { LATEST_PATH, memoryStore } from '../../src/lib/aqi/relay-store.ts';

const FEED_GZ = readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url));
const FEED_XML = gunzipSync(FEED_GZ).toString('utf8');
const KEY = '5a'.repeat(32); // a test value, not a secret
const NOW = new Date('2026-09-27T00:30:00Z'); // the fixture was published 2026-09-26T23:30Z: 1 h old
const ARCHIVE = 'cpcb/archive/2026/09/27/05.xml.gz';
const URL_ = 'https://deltaclimate.earth/api/air-quality-ingest';

/** A signed request. `ts` defaults to NOW; `sig` overrides the signature header. */
function req(body, { kind = 'cpcb-feed', ts = NOW.getTime() / 1000, key = KEY, sig, method = 'POST', headers = {} } = {}) {
  const b = body ?? new Uint8Array(0);
  const h = { 'Content-Type': 'application/octet-stream', 'X-OBOS-Kind': kind, 'X-OBOS-Timestamp': String(ts),
    'X-OBOS-Signature': sig ?? signV1(key, ts, b), ...headers };
  return new Request(URL_, method === 'GET' ? { method, headers: h } : { method, headers: h, body: b });
}
const deps = (extra = {}) => ({ key: KEY, store: memoryStore(), now: () => NOW, ...extra });
const quiet = async (fn) => { const w = console.warn, i = console.info; console.warn = console.info = () => {}; try { return await fn(); } finally { console.warn = w; console.info = i; } };
const call = (r, d = deps()) => quiet(() => handleIngest(r, d));
/** A synthetic feed of n stations, each with a valid AQI, all stamped `stamp` (IST). */
const feedOf = (n, stamp = '27-09-2026 05:00:00') => gzipSync(`<?xml version='1.0'?><AqIndex><Country id="India"><State id="X"><City id="Y">${
  Array.from({ length: n }, (_, i) => `<Station id="S${i}" lastupdate="${stamp}" latitude="22.5" longitude="88.3"><Pollutant_Index id="PM10" Min="1" Max="9" Avg="5" Hourly_sub_index="5"/><Air_Quality_Index Value="5" Predominant_Parameter="PM10"/></Station>`).join('')
}</City></State></Country></AqIndex>`);

test('a new feed is archived by its IST hour, then becomes latest: 200 new', async () => {
  const d = deps();
  const r = await call(req(FEED_GZ), d);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { stored: 'new', lastupdate: '2026-09-26T23:30:00.000Z', stations: 481 });
  assert.deepEqual([...d.store.files.keys()].sort(), [ARCHIVE, LATEST_PATH].sort());
  assert.deepEqual(Buffer.from(d.store.files.get(LATEST_PATH)), FEED_GZ, 'stored exactly as sent');
});

test('the same hour again is a duplicate: 200, and latest is not rewritten', async () => {
  const d = deps();
  await call(req(FEED_GZ), d);
  const sentinel = new Uint8Array([1, 2, 3]);
  d.store.files.set(LATEST_PATH, sentinel);
  const r = await call(req(FEED_GZ, { ts: NOW.getTime() / 1000 + 60 }), d);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { stored: 'duplicate', lastupdate: '2026-09-26T23:30:00.000Z', stations: 481 });
  assert.equal(d.store.files.get(LATEST_PATH), sentinel);
});

test('a valid ping is 204 and stores nothing; a ping with a body is 400', async () => {
  const d = deps();
  const r = await call(req(null, { kind: 'ping' }), d);
  assert.equal(r.status, 204);
  assert.equal(await r.text(), '');
  assert.equal(d.store.files.size, 0);
  assert.equal((await call(req(new Uint8Array([1]), { kind: 'ping' }), d)).status, 400);
});

test('only POST: 405 with Allow', async () => {
  const r = await call(req(null, { method: 'GET' }));
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('Allow'), 'POST');
});

test('an unknown or missing kind is 400', async () => {
  assert.equal((await call(req(FEED_GZ, { kind: 'cpcb' }))).status, 400);
  assert.equal((await call(req(FEED_GZ, { kind: '' }))).status, 400);
});

test('no key, or a key that is not 32 bytes of hex, is 503: closed by default', async () => {
  for (const key of ['', 'zz'.repeat(32), '5a'.repeat(31)]) {
    const r = await call(req(FEED_GZ, { key: '' }), deps({ key }));
    assert.equal(r.status, 503, JSON.stringify(key));
  }
});

test('401 with no detail: missing, malformed or wrong signature; timestamp more than 300 s off', async () => {
  const good = signV1(KEY, NOW.getTime() / 1000, FEED_GZ);
  const wrongLast = good.slice(0, -1) + (good.at(-1) === '0' ? '1' : '0');
  const t = NOW.getTime() / 1000;
  const cases = {
    'no signature': req(FEED_GZ, { sig: '' }),
    'malformed': req(FEED_GZ, { sig: 'v1=xyz' }),
    'same length, last char wrong': req(FEED_GZ, { sig: wrongLast }),
    'another key': req(FEED_GZ, { key: 'a5'.repeat(32) }),
    '301 s old': req(FEED_GZ, { ts: t - 301 }),
    '301 s ahead': req(FEED_GZ, { ts: t + 301 }),
    'signed ping replayed as a feed': req(FEED_GZ, { sig: signV1(KEY, t, new Uint8Array(0)) }),
  };
  for (const [name, r] of Object.entries(cases)) {
    const res = await call(r);
    assert.equal(res.status, 401, name);
    assert.deepEqual(await res.json(), { error: 'unauthorized' }, name);
  }
  assert.equal((await call(req(FEED_GZ, { ts: t - 300 }))).status, 200, '300 s is inside the window');
});

test('the compressed body is capped at 1 MB, by header and while reading', async () => {
  const big = new Uint8Array(1_000_001);
  assert.equal((await call(req(big))).status, 413, 'signed but too large');
  assert.equal((await call(req(FEED_GZ, { headers: { 'Content-Length': '1000001' } }))).status, 413);
});

test('gunzip is capped at 2 MB; a body that is not gzip is 400', async () => {
  const bomb = gzipSync(Buffer.alloc(2_000_001, 32));
  assert.ok(bomb.length < 1_000_000, 'small on the wire');
  assert.equal((await call(req(bomb))).status, 413);
  assert.equal((await call(req(new TextEncoder().encode(FEED_XML)))).status, 400, 'raw XML, not gzip');
});

test('422 for what the parser refuses, with a machine reason, and nothing stored', async () => {
  const mixed = gzipSync(FEED_XML.replace('lastupdate="27-09-2026 05:00:00"', 'lastupdate="27-09-2026 04:00:00"'));
  const cases = [
    ['not_a_feed', gzipSync('<html>busy</html>'), NOW],
    ['too_few_stations', feedOf(MIN_STATIONS - 1), NOW],
    ['mixed_lastupdate', mixed, NOW],
    ['lastupdate_in_future', FEED_GZ, new Date('2026-09-26T23:14:59Z')],
    ['lastupdate_too_old', FEED_GZ, new Date('2026-10-03T23:30:01Z')],
  ];
  for (const [reason, gz, now] of cases) {
    const d = deps({ now: () => now });
    const r = await call(req(gz, { ts: now.getTime() / 1000 }), d);
    assert.equal(r.status, 422, reason);
    assert.deepEqual(await r.json(), { error: reason });
    assert.equal(d.store.files.size, 0, `${reason}: nothing stored`);
  }
});

test('the boundaries pass: 300 stations, 15 min ahead, 7 days old', async () => {
  assert.equal(MIN_STATIONS, 300);
  assert.equal((await call(req(feedOf(300)))).status, 200);
  for (const iso of ['2026-09-26T23:15:00Z', '2026-10-03T23:30:00Z']) {
    const now = new Date(iso);
    assert.equal((await call(req(FEED_GZ, { ts: now.getTime() / 1000 }), deps({ now: () => now }))).status, 200, iso);
  }
});

test('a store failure is 503, so the Pi retries at its next tick', async () => {
  const broken = { getLatest: async () => null, putLatest: async () => { throw new Error('blob down'); }, putArchive: async () => { throw new Error('blob down'); } };
  assert.equal((await call(req(FEED_GZ), deps({ store: broken }))).status, 503);
});

test('every response is Cache-Control: no-store', async () => {
  const rs = [req(null, { method: 'GET' }), req(FEED_GZ, { kind: 'x' }), req(FEED_GZ, { sig: '' }), req(null, { kind: 'ping' }), req(FEED_GZ)];
  for (const r of rs) assert.equal((await call(r)).headers.get('Cache-Control'), 'no-store');
  assert.equal((await call(req(FEED_GZ), deps({ key: '' }))).headers.get('Cache-Control'), 'no-store');
});

test('logs carry the outcome and reason only: never the key, a signature or the body', async () => {
  const logged = [], w = console.warn, i = console.info, e = console.error;
  console.warn = console.info = console.error = (...a) => logged.push(a.map(String).join(' '));
  try {
    for (const r of [req(FEED_GZ), req(FEED_GZ, { sig: signV1('a5'.repeat(32), NOW.getTime() / 1000, FEED_GZ) }), req(gzipSync('<html/>'))]) {
      await handleIngest(r, deps());
    }
  } finally { console.warn = w; console.info = i; console.error = e; }
  const all = logged.join('\n');
  assert.ok(logged.length >= 3);
  assert.ok(!all.includes(KEY), 'key');
  assert.ok(!/v1=[0-9a-f]{8}/.test(all), 'signature');
  assert.ok(!all.includes('AqIndex') && !all.includes('Ballygunge'), 'body');
});

test('POST reads RELAY_HMAC_KEY: unset is 503; set, a signed ping is 204 with no store call', async () => {
  const saved = process.env.RELAY_HMAC_KEY;
  try {
    delete process.env.RELAY_HMAC_KEY;
    assert.equal((await quiet(() => POST(req(null, { kind: 'ping', ts: Math.floor(Date.now() / 1000) })))).status, 503);
    process.env.RELAY_HMAC_KEY = KEY;
    assert.equal((await quiet(() => POST(req(null, { kind: 'ping', ts: Math.floor(Date.now() / 1000) })))).status, 204);
  } finally {
    if (saved === undefined) delete process.env.RELAY_HMAC_KEY; else process.env.RELAY_HMAC_KEY = saved;
  }
});

test('the ingest function declares maxDuration 30', async () => {
  const mod = await import('../../api/air-quality-ingest.ts');
  assert.equal(mod.config?.maxDuration, 30);
});
