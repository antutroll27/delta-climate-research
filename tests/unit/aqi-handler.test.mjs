// tests/unit/aqi-handler.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import handler, { handle, GRACE_MS, feedEnabled } from '../../api/air-quality.ts';

const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } }; return r; };
import { gunzipSync } from 'node:zlib';
const FEED_XML = gunzipSync(readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url))).toString('utf8');
const isCpcb = (u) => String(u).includes('airquality.cpcb.gov.in');
/** Routes CPCB's URL to `cpcb` (a Response factory; default: CPCB down, 503) and everything else to `openaq`. */
const route = (openaq, cpcb = () => new Response('down', { status: 503 })) => (u, init) => (isCpcb(u) ? Promise.resolve(cpcb()) : openaq(u, init));
const freshFeed = () => ({ entry: null, inflight: null });

test('only GET', async () => { const r = res(); await handle({ method: 'POST', query: {} }, r, { key: 'k' }); assert.equal(r.code, 405); assert.equal(r.headers.Allow, 'GET'); });
test('unknown area is 404', async () => { const r = res(); await handle({ method: 'GET', query: { area: 'in/kolkata/nowhere' } }, r, { key: 'k' }); assert.equal(r.code, 404); });
test('missing key fails closed, with no upstream call, never cached', async () => { let called = false; const r = res();
  await handle({ method: 'GET', query: { area: 'in/kolkata/ballygunge' } }, r, { key: '', fetch: route(async () => { called = true; }), feedCache: freshFeed(), cpcbFeed: true }); assert.equal(r.code, 503); assert.equal(called, false);
  assert.equal(r.headers['Cache-Control'], 'no-store'); });
test('Baruipur answers no_station without calling OpenAQ, cacheable', async () => { const r = res();
  await handle({ method: 'GET', query: { area: 'in/kolkata/baruipur' } }, r, { key: 'k', fetch: async () => { throw new Error('must not fetch'); } });
  assert.equal(r.code, 200); assert.equal(r.body.current.state, 'no_station'); assert.match(r.headers['Cache-Control'], /s-maxage=600/); });
test('upstream failure is 200 unavailable upstream_error, never stored, never a number', async () => { const r = res();
  const orig = console.error; console.error = () => {};
  try { await handle({ method: 'GET', query: { area: 'in/kolkata/ballygunge' } }, r, { key: 'k', fetch: async () => new Response('x', { status: 503 }), cache: new Map(), inflight: new Map(), feedCache: freshFeed(), cpcbFeed: true }); }
  finally { console.error = orig; }
  assert.equal(r.code, 200); assert.equal(r.body.current.state, 'unavailable'); assert.equal(r.body.current.reason, 'upstream_error');
  assert.equal(r.body.current.last_observed_at, null);
  /* no-store, so the CDN keeps serving the previous good payload through stale-while-revalidate. */
  assert.equal(r.headers['Cache-Control'], 'no-store'); });

// Additions beyond the plan.
test('prototype keys are not areas', async () => { const r = res();
  await handle({ method: 'GET', query: { area: '__proto__' } }, r, { key: 'k', fetch: async () => { throw new Error('must not fetch'); } }); assert.equal(r.code, 404); });
test('an array area is 404, not its first element', async () => { const r = res();
  await handle({ method: 'GET', query: { area: ['in/kolkata/ballygunge'] } }, r, { key: 'k', fetch: async () => { throw new Error('must not fetch'); } }); assert.equal(r.code, 404); });
test('upstream failure is logged by area and status, and the key appears in no logged argument', async () => {
  const KEY = 'SECRET-XYZ', logged = [], orig = console.error;
  console.error = (...a) => { logged.push(a); };
  const r = res();
  try {
    await handle({ method: 'GET', query: { area: 'in/kolkata/barrackpore' } }, r, { key: KEY, cache: new Map(), inflight: new Map(), feedCache: freshFeed(), cpcbFeed: true,
      fetch: async (u, init) => new Response(`bad key ${init?.headers?.['X-API-Key']} at ${u}`, { status: 401 }) });
  } finally { console.error = orig; }
  assert.equal(r.body.current.state, 'unavailable');
  assert.ok(logged.length >= 1, 'the failure was logged');
  assert.deepEqual(logged.find((a) => a[0] === 'air-quality upstream failure'), ['air-quality upstream failure', 'in/kolkata/barrackpore', 401]);
  for (const args of logged) for (const a of args) {
    const s = typeof a === 'string' ? a : JSON.stringify(a) ?? String(a);
    assert.ok(!s.includes(KEY), 'key leaked into a log argument');
    assert.ok(!(a instanceof Error), 'raw error object logged');
  }
  assert.ok(!JSON.stringify(r.body).includes(KEY), 'key leaked into the response');
});

test('tsconfig rewrites .ts import specifiers, or the deployed function cannot load', () => {
  const src = readFileSync(new URL('../../tsconfig.json', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const cfg = JSON.parse(src);
  assert.equal(cfg.compilerOptions.rewriteRelativeImportExtensions, true,
    "Vercel's @vercel/node compiles api/*.ts file by file and keeps import specifiers verbatim: without rewriteRelativeImportExtensions, "
    + "api/air-quality.js imports '../src/lib/aqi/*.ts' files that are not shipped, and every request 500s (ERR_MODULE_NOT_FOUND, measured 2026-09-26).");
});

/* ---- Audit I1-I3: honest upstream failures, quota guard, one deadline. ---- */

const BALLY = 'in/kolkata/ballygunge';
const SO2 = 12236014, CO = 12236007;
const NOW = new Date('2026-09-24T18:00:00Z');
const sensorOf = (u) => Number(/sensors\/(\d+)\//.exec(String(u))[1]);
/** Hourly rows for 48 h ending `lastEnd`, clean air: one page, so one request per sensor. */
const rows = (sensor, lastEnd = '2026-09-24T13:00:00Z') => ({ results: Array.from({ length: 48 }, (_, i) => ({
  value: sensor === CO ? 0.5 : 20, period: { datetimeTo: { utc: new Date(Date.parse(lastEnd) - i * 3_600_000).toISOString() } } })) });
const ok = (u) => new Response(JSON.stringify(rows(sensorOf(u))));
/* Every test here runs with the CPCB feed ON; the dormant default (off) has its own tests at the end. */
const deps = (fetch, extra = {}) => ({ key: 'k', fetch: route(fetch), now: () => NOW, cache: new Map(), inflight: new Map(), feedCache: freshFeed(), cpcbFeed: true, ...extra });
const quiet = async (fn) => { const orig = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = orig; } };
const get = (d, query = { area: BALLY }) => { const r = res(); return handle({ method: 'GET', query }, r, d).then(() => r); };

test('I1: a 429 on one sensor is upstream_error for the area, no-store, and the other fetches are aborted', async () => {
  const signals = [];
  const fake = (u, init) => {
    if (sensorOf(u) === SO2) return Promise.resolve(new Response('slow down', { status: 429 }));
    signals.push(init.signal);
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  };
  const r = await quiet(() => get(deps(fake)));
  assert.equal(r.code, 200);
  assert.equal(r.body.current.state, 'unavailable');
  assert.equal(r.body.current.reason, 'upstream_error');
  assert.equal(r.body.current.last_observed_at, null);
  assert.equal(r.body.history, null);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.ok(signals.length >= 1, 'other sensors were fetched');
  assert.ok(signals.every((s) => s.aborted), 'every other in-flight fetch was aborted');
});

test('I1: a 404 on the SO2 sensor is a missing pollutant, not a failure: the AQI still publishes with SO2 null', async () => {
  const fake = async (u) => (sensorOf(u) === SO2 ? new Response('not found', { status: 404 }) : ok(u));
  const r = await get(deps(fake));
  assert.equal(r.code, 200);
  assert.ok(['live', 'stale'].includes(r.body.current.state), r.body.current.state);
  const so2 = r.body.current.result.pollutants.find((q) => q.parameter === 'so2');
  assert.deepEqual({ value: so2.value, sub_index: so2.sub_index }, { value: null, sub_index: null });
  assert.equal(r.headers['Cache-Control'], 'public, max-age=0, s-maxage=60', 'a fallback answer lives 60 s at the CDN (re-audit M-2)');
});

test('I2: any query parameter other than area is 400, no-store, with no upstream call', async () => {
  let n = 0;
  const r = await get(deps(async (u) => { n++; return ok(u); }), { area: BALLY, x: '1' });
  assert.equal(r.code, 400);
  assert.deepEqual(r.body, { error: 'unexpected query parameter' });
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.equal(n, 0);
});

test('I2: two concurrent cold calls share one set of upstream fetches', async () => {
  let n = 0;
  const d = deps(async (u) => { n++; await new Promise((f) => setTimeout(f, 5)); return ok(u); });
  const [a, b] = await Promise.all([get(d), get(d)]);
  assert.equal(n, 6, 'one request per sensor, once');
  assert.equal(a.body.current.state, 'stale');
  assert.deepEqual(a.body, b.body);
});

test('I2: a second call within the TTL makes no upstream fetch, and re-judges age against its own clock', async () => {
  let n = 0, t = NOW.getTime();
  const d = deps(async (u) => { n++; return ok(u); }, { now: () => new Date(t) });
  const a = await get(d);
  t += 9 * 60_000;
  const b = await get(d);
  assert.equal(n, 6);
  assert.equal(b.body.current.served_at, new Date(t).toISOString());
  assert.equal(b.body.current.observed_at, a.body.current.observed_at);
  t += 2 * 60_000; // past the 10-minute TTL
  await get(d);
  assert.equal(n, 12, 'refetched after the TTL');
});

test('I2: an upstream failure is never cached', async () => {
  let n = 0, fail = true;
  const d = deps(async (u) => { n++; return fail ? new Response('x', { status: 503 }) : ok(u); });
  const a = await quiet(() => get(d));
  assert.equal(a.body.current.reason, 'upstream_error');
  fail = false;
  const b = await get(d);
  assert.equal(b.body.current.state, 'stale');
  assert.ok(n > 6, 'the second call went upstream again');
});

test('I3: a fetch that never resolves ends in upstream_error within the budget', { timeout: 3000 }, async () => {
  const r = await quiet(() => get(deps(() => new Promise(() => {}), { budgetMs: 30 })));
  assert.equal(r.body.current.state, 'unavailable');
  assert.equal(r.body.current.reason, 'upstream_error');
  assert.equal(r.headers['Cache-Control'], 'no-store');
});

test('I3: the function declares maxDuration 30', async () => {
  const mod = await import('../../api/air-quality.ts');
  assert.equal(mod.config?.maxDuration, 30);
});

const cpcbOk = () => new Response(FEED_XML);
const CNOW = new Date('2026-09-27T00:30:00Z'); // CPCB published 23:30Z: 1 h old → live

test('CPCB ok, OpenAQ ok within the grace: live from CPCB, history from OpenAQ, full cache', async () => {
  const r = await get(deps(null, { fetch: route(async (u) => ok(u), cpcbOk), now: () => CNOW }));
  assert.equal(r.body.current.state, 'live');
  assert.equal(r.body.current.result.origin, 'cpcb');
  assert.equal(r.body.current.result.aqi, 38);
  assert.ok(r.body.history, 'history present');
  assert.match(r.headers['Cache-Control'], /s-maxage=600/);
});

test('CPCB ok, OpenAQ slower than the grace: answer without history, waitUntil keeps the fetch, 60 s cache', async () => {
  const kept = [];
  const slow = (u) => new Promise((f) => setTimeout(() => f(ok(u)), 200));
  const d = deps(null, { fetch: route(slow, cpcbOk), now: () => CNOW, graceMs: 20, waitUntil: (p) => kept.push(p) });
  const r = await get(d);
  assert.equal(r.body.current.result.origin, 'cpcb');
  assert.equal(r.body.history, null);
  assert.equal(r.headers['Cache-Control'], 'public, max-age=0, s-maxage=60');
  assert.equal(kept.length, 1, 'the OpenAQ fetch was handed to waitUntil');
  await kept[0];
  assert.ok(d.cache.get('in/kolkata/ballygunge'), 'it filled the raw cache for the next visitor');
});

test('CPCB ok, OpenAQ fails: CPCB current, no history, 60 s cache, failure logged', async () => {
  const r = await quiet(() => get(deps(null, { fetch: route(async () => new Response('x', { status: 503 }), cpcbOk), now: () => CNOW })));
  assert.equal(r.body.current.result.origin, 'cpcb');
  assert.equal(r.body.history, null);
  assert.equal(r.headers['Cache-Control'], 'public, max-age=0, s-maxage=60');
});

test('CPCB down, OpenAQ ok: today\'s path, origin obos', async () => {
  const r = await quiet(() => get(deps(async (u) => ok(u))));
  assert.equal(r.body.current.result.origin, 'obos');
  assert.equal(r.headers['Cache-Control'], 'public, max-age=0, s-maxage=60', 'a fallback answer lives 60 s at the CDN (re-audit M-2)');
});

test('no OpenAQ key but CPCB ok: CPCB current, no history, never an OpenAQ call', async () => {
  let openaq = 0;
  const r = await get(deps(null, { key: '', fetch: route(async (u) => { openaq++; return ok(u); }, cpcbOk), now: () => CNOW }));
  assert.equal(r.code, 200);
  assert.equal(r.body.current.result.origin, 'cpcb');
  assert.equal(r.body.history, null);
  assert.equal(openaq, 0);
});

test('the feed is fetched once per 10 minutes and shared by both areas', async () => {
  let cp = 0;
  const d = deps(null, { fetch: route(async (u) => ok(u), () => { cp++; return cpcbOk(); }), now: () => CNOW });
  await get(d); await get(d, { area: 'in/kolkata/barrackpore' });
  assert.equal(cp, 1);
});

/* ---- Audit I3: surviving mutations. ---- */

test('M3: the feed cache expires after 10 minutes', async () => {
  let cp = 0, t = CNOW.getTime();
  const d = deps(null, { fetch: route(async (u) => ok(u), () => { cp++; return cpcbOk(); }), now: () => new Date(t) });
  await get(d); t += 9 * 60_000; await get(d);
  assert.equal(cp, 1, 'within 10 min the feed is cached');
  t += 2 * 60_000; await get(d);
  assert.equal(cp, 2, 'after 10 min the feed is fetched again');
});

test('M16: a feed failure is never cached as an empty feed: a later request gets CPCB again', async () => {
  let cp = 0, t = CNOW.getTime();
  const d = deps(null, { fetch: route(async (u) => ok(u), () => (++cp === 1 ? new Response('down', { status: 503 }) : cpcbOk())), now: () => new Date(t) });
  const a = await quiet(() => get(d));
  assert.equal(a.body.current.result.origin, 'obos');
  t += 2 * 60_000;
  const b = await get(d);
  assert.equal(b.body.current.result.origin, 'cpcb');
  assert.equal(cp, 2);
});

/* ---- Audit minor M-g: a short negative cache. ---- */

test('M-g: after a feed failure CPCB is not asked again for 60 s; the fallback answers at once', async () => {
  let cp = 0, t = CNOW.getTime();
  const d = deps(null, { fetch: route(async (u) => ok(u), () => { cp++; return new Response('down', { status: 503 }); }), now: () => new Date(t) });
  await quiet(() => get(d));
  t += 30_000;
  const b = await quiet(() => get(d));
  assert.equal(cp, 1, 'no second CPCB request within 60 s');
  assert.equal(b.body.current.result.origin, 'obos');
  t += 31_000;
  await quiet(() => get(d));
  assert.equal(cp, 2, 'CPCB is asked again after 60 s');
});

/* ---- Re-audit M-2, M-4. ---- */

test('M-2: a fallback answer is cached 60 s at the CDN, so a CPCB blip is not pinned for 10 min; no_station keeps 10 min', async () => {
  const fb = await quiet(() => get(deps(async (u) => ok(u), { now: () => CNOW })));
  assert.equal(fb.body.current.result.origin, 'obos');
  assert.equal(fb.headers['Cache-Control'], 'public, max-age=0, s-maxage=60');
  const none = await get(deps(async () => { throw new Error('must not fetch'); }), { area: 'in/kolkata/baruipur' });
  assert.equal(none.headers['Cache-Control'], 'public, max-age=60, s-maxage=600, stale-while-revalidate=1800');
});

test('M-4: the grace after CPCB settles is 1.5 s', () => {
  assert.equal(GRACE_MS, 1_500);
});

test('the air-quality function runs in Mumbai (bom1): CPCB\'s feed times out from Vercel\'s default US region', () => {
  const cfg = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(cfg.functions?.['api/air-quality.ts']?.regions, ['bom1'],
    "Measured 2026-09-27 on PR #34's Preview: from iad1 (Washington) the CPCB feed fetch hit its 8 s timeout on every request, "
    + 'so Ballygunge fell back to OpenAQ; from India the same feed answers in ~0.4 s.');
});

/* ---- Dormant release: the CPCB feed is off unless AIR_CPCB_FEED is exactly 'on' (spec §11, register AQI-R48). ---- */

const OK = 'public, max-age=60, s-maxage=600, stale-while-revalidate=1800';

test('feed off: no request ever goes to CPCB, even one that would succeed; OBOS answers with the 10-min cache, as on main', async () => {
  let cp = 0;
  const r = await get(deps(null, { cpcbFeed: false, fetch: route(async (u) => ok(u), () => { cp++; return cpcbOk(); }), now: () => CNOW }));
  assert.equal(cp, 0, 'no CPCB request');
  assert.equal(r.body.current.result.origin, 'obos');
  assert.ok(r.body.history, 'history as on main');
  assert.equal(r.headers['Cache-Control'], OK);
});

test('feed off, no key: 503 no-store, with no request anywhere, as on main', async () => {
  let calls = 0;
  const r = await get(deps(null, { cpcbFeed: false, key: '', fetch: async () => { calls++; return cpcbOk(); } }));
  assert.equal(r.code, 503);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.equal(calls, 0);
});

test('feedEnabled: only exactly "on" switches the feed on', () => {
  assert.equal(feedEnabled({}), false, 'unset');
  assert.equal(feedEnabled({ AIR_CPCB_FEED: 'off' }), false);
  assert.equal(feedEnabled({ AIR_CPCB_FEED: 'ON' }), false);
  assert.equal(feedEnabled({ AIR_CPCB_FEED: ' on' }), false);
  assert.equal(feedEnabled({ AIR_CPCB_FEED: 'on' }), true);
});

test('the deployed handler reads AIR_CPCB_FEED: unset means no CPCB request, "on" means one', async () => {
  const saved = { fetch: globalThis.fetch, key: process.env.OPENAQ_API_KEY, flag: process.env.AIR_CPCB_FEED };
  let cp = 0;
  globalThis.fetch = async (u) => (isCpcb(u) ? (cp++, cpcbOk()) : ok(u));
  process.env.OPENAQ_API_KEY = 'k';
  try {
    delete process.env.AIR_CPCB_FEED;
    const a = res(); await handler({ method: 'GET', query: { area: BALLY } }, a);
    assert.equal(cp, 0, 'unset: no CPCB request');
    assert.equal(a.body.current.result.origin, 'obos');
    process.env.AIR_CPCB_FEED = 'on';
    const b = res(); await handler({ method: 'GET', query: { area: 'in/kolkata/barrackpore' } }, b);
    assert.equal(cp, 1, '"on": CPCB is asked');
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.OPENAQ_API_KEY; else process.env.OPENAQ_API_KEY = saved.key;
    if (saved.flag === undefined) delete process.env.AIR_CPCB_FEED; else process.env.AIR_CPCB_FEED = saved.flag;
  }
});
