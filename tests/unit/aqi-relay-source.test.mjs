// tests/unit/aqi-relay-source.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import test from 'node:test';
import handler, { feedSource, handle } from '../../api/air-quality.ts';
import { FEED_MAX_BYTES, FeedError, readRelayFeed } from '../../src/lib/aqi/cpcb-feed.ts';
import { LATEST_PATH, memoryStore } from '../../src/lib/aqi/relay-store.ts';

const FEED_GZ = readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url));
const FEED_XML = gunzipSync(FEED_GZ).toString('utf8');
const BALLY = 'in/kolkata/ballygunge';
const CNOW = new Date('2026-09-27T00:30:00Z'); // CPCB published 23:30Z: 1 h old, live
const storeWith = (gz) => { const s = memoryStore(); if (gz) s.files.set(LATEST_PATH, gz); return s; };
const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } }; return r; };
const quiet = async (fn) => { const orig = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = orig; } };
const isCpcb = (u) => String(u).includes('airquality.cpcb.gov.in');
const sensorOf = (u) => Number(/sensors\/(\d+)\//.exec(String(u))[1]);
const rows = (sensor) => ({ results: Array.from({ length: 48 }, (_, i) => ({ value: sensor === 12236007 ? 0.5 : 20,
  period: { datetimeTo: { utc: new Date(Date.parse('2026-09-24T13:00:00Z') - i * 3_600_000).toISOString() } } })) });
/** OpenAQ answers; a CPCB request is counted and must never happen on the relay path. */
const counting = () => { const c = { cpcb: 0 }; c.fetch = async (u) => { if (isCpcb(u)) { c.cpcb++; return new Response('down', { status: 503 }); } return new Response(JSON.stringify(rows(sensorOf(u)))); }; return c; };
const get = (d) => { const r = res(); return handle({ method: 'GET', query: { area: BALLY } }, r, d).then(() => r); };
const relayDeps = (store, c, extra = {}) => ({ key: 'k', fetch: c.fetch, now: () => CNOW, cache: new Map(), inflight: new Map(),
  feedCache: { entry: null, inflight: null }, cpcbFeed: true, source: 'relay', store, ...extra });

test('readRelayFeed inflates the stored gzip and parses it: the real capture, 481 stations', async () => {
  const feed = await readRelayFeed(storeWith(FEED_GZ));
  assert.equal(feed.length, 481);
  assert.equal(feed.find((s) => s.name === 'Ballygunge, Kolkata - WBPCB').aqi, 38);
});

test('readRelayFeed: missing, unreachable, corrupt, oversize or not a feed are all FeedErrors', async () => {
  const failing = { getLatest: async () => { throw new Error('blob token secret-xyz'); }, putLatest: async () => {}, putArchive: async () => 'stored' };
  const cases = [
    ['relay feed missing', storeWith(null)],
    ['relay store unreachable', failing],
    ['relay feed corrupt', storeWith(new TextEncoder().encode(FEED_XML))],
    ['relay feed too large', storeWith(gzipSync(FEED_XML + ' '.repeat(FEED_MAX_BYTES)))],
    ['not a CPCB AQI feed', storeWith(gzipSync('<html>busy</html>'))],
  ];
  for (const [message, store] of cases) {
    await assert.rejects(readRelayFeed(store), (e) => e instanceof FeedError && e.message === message, message);
  }
});

test('relay source: Ballygunge is live from CPCB, and no request goes to CPCB', async () => {
  const c = counting();
  const r = await get(relayDeps(storeWith(FEED_GZ), c));
  assert.equal(r.body.current.state, 'live');
  assert.equal(r.body.current.result.origin, 'cpcb');
  assert.equal(r.body.current.result.aqi, 38);
  assert.equal(c.cpcb, 0);
});

test('relay source: a missing, corrupt or oversize blob falls back to OBOS, with no CPCB request', async () => {
  for (const [name, gz] of [['missing', null], ['corrupt', new Uint8Array([1, 2, 3])], ['oversize', gzipSync(FEED_XML + ' '.repeat(FEED_MAX_BYTES))]]) {
    const c = counting();
    const r = await quiet(() => get(relayDeps(storeWith(gz), c)));
    assert.equal(r.code, 200, name);
    assert.equal(r.body.current.result.origin, 'obos', name);
    assert.equal(r.headers['Cache-Control'], 'public, max-age=0, s-maxage=60', `${name}: a fallback lives 60 s`);
    assert.equal(c.cpcb, 0, name);
  }
});

test('relay source: a stored feed older than 2 h falls back to OBOS (founder 2026-09-29), never shown stale', async () => {
  const live = await get(relayDeps(storeWith(FEED_GZ), counting(), { now: () => new Date('2026-09-27T01:30:00Z') }));
  assert.deepEqual({ state: live.body.current.state, origin: live.body.current.result.origin }, { state: 'live', origin: 'cpcb' }, 'exactly 2 h is still live');
  const c = counting();
  const old = await quiet(() => get(relayDeps(storeWith(FEED_GZ), c, { now: () => new Date('2026-09-27T01:31:00Z') })));
  assert.equal(old.body.current.result.origin, 'obos', '2 h + 1 min: a dead relay hands over to OpenAQ');
  assert.equal(c.cpcb, 0);
});

test('relay source with the feed switched off: the store is never read', async () => {
  let reads = 0;
  const store = { ...storeWith(FEED_GZ), getLatest: async () => { reads++; return FEED_GZ; } };
  const r = await get(relayDeps(store, counting(), { cpcbFeed: false }));
  assert.equal(reads, 0);
  assert.equal(r.body.current.result.origin, 'obos');
});

test('feedSource: only exactly "relay" selects the relay', () => {
  assert.equal(feedSource({}), 'direct', 'unset');
  assert.equal(feedSource({ AIR_CPCB_SOURCE: 'direct' }), 'direct');
  assert.equal(feedSource({ AIR_CPCB_SOURCE: 'RELAY' }), 'direct');
  assert.equal(feedSource({ AIR_CPCB_SOURCE: ' relay' }), 'direct');
  assert.equal(feedSource({ AIR_CPCB_SOURCE: 'relay ' }), 'direct');
  assert.equal(feedSource({ AIR_CPCB_SOURCE: 'relay' }), 'relay');
});

test('the deployed handler reads AIR_CPCB_SOURCE: "relay" never asks CPCB directly', async () => {
  const keys = ['OPENAQ_API_KEY', 'AIR_CPCB_FEED', 'AIR_CPCB_SOURCE', 'BLOB_READ_WRITE_TOKEN', 'VERCEL_OIDC_TOKEN', 'BLOB_STORE_ID'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const savedFetch = globalThis.fetch, c = counting();
  globalThis.fetch = c.fetch;
  try {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, { OPENAQ_API_KEY: 'k', AIR_CPCB_FEED: 'on', AIR_CPCB_SOURCE: 'relay' });
    const r = res();
    await quiet(() => handler({ method: 'GET', query: { area: 'in/kolkata/barrackpore' } }, r));
    assert.equal(c.cpcb, 0, 'no direct CPCB request');
    assert.equal(r.body.current.result.origin, 'obos', 'no Blob credentials here, so the relay read fails and OBOS answers');
  } finally {
    globalThis.fetch = savedFetch;
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});
