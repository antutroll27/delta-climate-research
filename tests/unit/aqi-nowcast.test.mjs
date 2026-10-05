// tests/unit/aqi-nowcast.test.mjs — the US line by EPA NowCast, from CPCB's hourly sub-indices.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { handle } from '../../api/air-quality.ts';
import { handleIngest } from '../../api/air-quality-ingest.ts';
import { parseFeed } from '../../src/lib/aqi/cpcb-feed.ts';
import { addHour, HISTORY_PATH, hourOf, nowcastFor, parseHistory, series, updateHistory } from '../../src/lib/aqi/hourly-history.ts';
import { signV1 } from '../../src/lib/aqi/relay-auth.ts';
import { archivePath, LATEST_PATH, memoryStore } from '../../src/lib/aqi/relay-store.ts';
import { nowcast, usIndex, usNowcast } from '../../src/lib/aqi/us-aqi.ts';
import { isAirPayload, isUsNowcast } from '../../src/lib/aqi/valid.ts';
import { cardHtml } from '../../src/scripts/climate-engine/air/air-panel.ts';

const BALLY = 'Ballygunge, Kolkata - WBPCB';
const fx = (h) => readFileSync(new URL(h === '05' ? '../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz'
  : `../fixtures/aqi/cpcb-hourly/cpcb-feed-2026-09-27T${h}00IST.xml.gz`, import.meta.url));
const HOURS = ['05', '06', '07', '08', '09', '10', '11'];
const GZ = Object.fromEntries(HOURS.map((h) => [h, fx(h)]));
const FEED = Object.fromEntries(HOURS.map((h) => [h, parseFeed(gunzipSync(GZ[h]).toString('utf8'))]));
const RAW = JSON.parse(readFileSync(new URL('../fixtures/aqi/ballygunge-raw-hourly-2026-09-27.json', import.meta.url), 'utf8'));
const quiet = async (fn) => { const w = console.warn, i = console.info, e = console.error; console.warn = console.info = console.error = () => {}; try { return await fn(); } finally { console.warn = w; console.info = i; console.error = e; } };

/* ---- nowcast() ---- */

test('EPA worked example (AirNow forum): w floors at 0.5, one missing hour, 28.4 µg/m³ → AQI 87', () => {
  /* As published, oldest first; nowcast() takes latest first. Min 21, max 69.2: w = 0.30 → 0.5. */
  const oldestFirst = [34.9, 43, 50, 64.9, 69.2, 66.2, 53.7, 48.6, 49.2, 35, null, 21];
  const c = nowcast('pm25', [...oldestFirst].reverse());
  assert.equal(c, 28.4);
  assert.equal(usIndex('pm25', c).aqi, 87);
});

test('weight: steady air (min/max ≥ 0.5) uses min/max itself; a spike is floored at 0.5', () => {
  /* 40 then eleven 50s: w = 0.8, so the latest counts most. */
  const w = 0.8, xs = [40, ...Array(11).fill(50)];
  const want = xs.reduce((a, x, k) => a + x * w ** k, 0) / xs.reduce((a, _, k) => a + w ** k, 0);
  assert.equal(nowcast('pm25', xs), Math.floor(want * 10) / 10);
  /* A one-hour pulse of 144 among zeros: w = 0 → 0.5, so it reads 144/2, then 144/4, then 144/8 (Wikipedia's example). */
  assert.equal(nowcast('pm25', [144, ...Array(11).fill(0)]), 72);
  assert.equal(nowcast('pm25', [0, 144, ...Array(10).fill(0)]), 36);
  assert.equal(nowcast('pm10', [0, 0, 144, ...Array(9).fill(0)]), 18);
  /* All zeros: max 0, w = 1, NowCast 0. */
  assert.equal(nowcast('pm25', Array(12).fill(0)), 0);
});

test('missing hours keep their slot; hours beyond 12 are ignored', () => {
  /* Hours 3–11 missing: the mean of 10, 20 weighted 1, 0.5 (w floored), = 13.3. */
  assert.equal(nowcast('pm25', [10, 20]), 13.3);
  assert.equal(nowcast('pm25', [10, 20, null, null, 999].slice(0, 3)), 13.3);
  assert.equal(nowcast('pm25', [10, 20, ...Array(10).fill(null), 999]), 13.3, 'the 13th hour is not read');
});

test('fewer than 2 of the latest 3 hours: null, whatever the older hours hold', () => {
  assert.equal(nowcast('pm25', [10, null, null, 10, 10, 10]), null);
  assert.equal(nowcast('pm25', [null, null, 10, 10, 10]), null);
  assert.equal(nowcast('pm25', []), null);
  assert.notEqual(nowcast('pm25', [null, 10, 10]), null);
  assert.notEqual(nowcast('pm25', [10, null, 10]), null);
  /* Neither pollutant: no figure. One is enough. */
  assert.equal(usNowcast([10], [null, 10]), null);
  assert.equal(usNowcast([10, 10], [null]).dominant, 'pm25');
});

test('usNowcast: the larger index leads, with the valid hours it used', () => {
  const u = usNowcast([30, 30, 30], [300, 300, null, 300]);
  assert.deepEqual(u, { aqi: 173, category: 'unhealthy', dominant: 'pm10', hours_used: 3 });
});

/* ---- parity: CPCB's hourly sub-indices vs the raw S3 readings ---- */

test('27 Sep 11:00 IST: NowCast from the 7 CPCB feeds equals NowCast from the raw readings (19.1 / 47 → US 70)', () => {
  let h = null;
  for (const k of HOURS) h = addHour(h, hourOf(FEED[k]));
  const at = FEED['11'][0].published_at;
  const p25 = series(h, BALLY, 'pm25', at), p10 = series(h, BALLY, 'pm10', at);
  assert.equal(p25.filter((v) => v !== null).length, 7);
  /* Each converted hour sits within half a sub-index step of the raw value. */
  for (let k = 0; k < 7; k++) {
    assert.ok(Math.abs(p25[k] - RAW.pm25[k]) <= 0.3 + 1e-9, `pm25 slot ${k}: ${p25[k]} vs ${RAW.pm25[k]}`);
    assert.ok(Math.abs(p10[k] - RAW.pm10[k]) <= 0.5 + 1e-9, `pm10 slot ${k}: ${p10[k]} vs ${RAW.pm10[k]}`);
  }
  const raw7 = (p) => RAW[p].map((v, k) => (k < 7 ? v : null));
  assert.equal(nowcast('pm25', p25), 19.1);
  assert.equal(nowcast('pm25', raw7('pm25')), 19.1);
  assert.equal(nowcast('pm10', p10), 47);
  assert.equal(nowcast('pm10', raw7('pm10')), 47);
  const f = FEED['11'].find((s) => s.name === BALLY);
  assert.deepEqual(nowcastFor(h, f), { aqi: 70, category: 'moderate', dominant: 'pm25', hours_used: 7 });
});

/* ---- the rolling history ---- */

test('history: a new hour is added, a duplicate changes nothing, a skipped hour stays a gap', () => {
  let h = addHour(null, hourOf(FEED['05']));
  h = addHour(h, hourOf(FEED['06']));
  assert.equal(h.hours.length, 2);
  assert.deepEqual(addHour(h, hourOf(FEED['06'])), h, 'duplicate is idempotent');
  /* 07 never arrives; 08 does. Slot 1 (07) is null, slots 2 and 3 are 06 and 05. */
  h = addHour(h, hourOf(FEED['08']));
  const s = series(h, BALLY, 'pm25', FEED['08'][0].published_at);
  assert.deepEqual(s.slice(0, 4).map((v) => v !== null), [true, false, true, true]);
  /* 2 of the latest 3 present: still a NowCast. Drop 06 as well and it is null. */
  const f08 = FEED['08'].find((x) => x.name === BALLY);
  assert.notEqual(nowcastFor(h, f08), null);
  assert.equal(nowcastFor(addHour(null, hourOf(FEED['05'])), f08), null);
  /* Out of order: an older hour lands in its place. */
  const late = addHour(h, hourOf(FEED['07']));
  assert.deepEqual(late.hours.map((r) => r.at), ['05', '06', '07', '08'].map((k) => FEED[k][0].published_at));
  /* Only the stations OBOS may show are recorded: Kolkata's two and every rung of Bengaluru's ladders
     in this capture (Kasturi Nagar is absent from the 27 Sep capture, so not here). */
  assert.deepEqual(Object.keys(h.hours[0].stations).sort(), [BALLY, 'SVSPA Campus, Barrackpore - WBPCB',
    ...['BTM Layout', 'Peenya'].map((n) => `${n}, Bengaluru - CPCB`),
    ...['Bapuji Nagar', 'Hebbal', 'Hombegowda Nagar', 'Jayanagar 5th Block', 'Silk Board'].map((n) => `${n}, Bengaluru - KSPCB`)].sort());
});

test('history keeps the newest 24 distinct hours, none older than 24 h; parseHistory refuses a bad body', () => {
  const t0 = Date.parse('2026-09-27T00:30:00Z');
  let h = null;
  for (let i = 0; i < 30; i++) h = addHour(h, { at: new Date(t0 + i * 3_600_000).toISOString(), stations: { [BALLY]: { pm25: 10, pm10: 20 } } });
  assert.equal(h.hours.length, 24);
  assert.equal(h.hours[0].at, new Date(t0 + 6 * 3_600_000).toISOString());
  assert.deepEqual(parseHistory(JSON.stringify(h)), h);
  for (const bad of ['', 'null', '{"v":2,"hours":[]}', '{"v":1,"hours":[{"at":"x","stations":{}}]}',
    JSON.stringify({ v: 1, hours: [{ at: h.hours[0].at, stations: { [BALLY]: { pm25: 9.5, pm10: 1 } } }] })]) {
    assert.equal(parseHistory(bad), null, bad);
  }
});

/* ---- the ingest ---- */

const KEY = '5a'.repeat(32);
const signed = (body, now) => { const ts = now.getTime() / 1000;
  return new Request('https://deltaclimate.earth/api/air-quality-ingest', { method: 'POST', body,
    headers: { 'X-OBOS-Kind': 'cpcb-feed', 'X-OBOS-Timestamp': String(ts), 'X-OBOS-Signature': signV1(KEY, ts, body) } }); };
const ingest = (store, h) => { const now = new Date(Date.parse(FEED[h][0].published_at) + 10 * 60_000);
  return quiet(() => handleIngest(signed(GZ[h], now), { key: KEY, store, now: () => now })); };
const stored = (store) => parseHistory(new TextDecoder().decode(store.files.get(HISTORY_PATH)));

test('ingest: each new hour updates the history; a duplicate post leaves it untouched', async () => {
  const store = memoryStore();
  assert.equal((await ingest(store, '05')).status, 200);
  assert.equal((await ingest(store, '06')).status, 200);
  assert.equal(stored(store).hours.length, 2);
  const before = store.files.get(HISTORY_PATH);
  assert.deepEqual(await (await ingest(store, '06')).json(), { stored: 'duplicate', lastupdate: FEED['06'][0].published_at, stations: FEED['06'].length });
  assert.equal(store.files.get(HISTORY_PATH), before, 'a duplicate never rewrites it');
});

test('ingest, first deploy: no history yet, so it is rebuilt once from the previous archives', async () => {
  const store = memoryStore();
  /* 05–10 archived before this release; 08 was never relayed. */
  for (const h of ['05', '06', '07', '09', '10']) store.files.set(archivePath(FEED[h][0].published_at), GZ[h]);
  assert.equal((await ingest(store, '11')).status, 200);
  assert.deepEqual(stored(store).hours.map((r) => r.at), ['05', '06', '07', '09', '10', '11'].map((k) => FEED[k][0].published_at));
});

test('ingest: a history failure is logged, never fails the feed', async () => {
  const store = { ...memoryStore(), getHistory: async () => { throw new Error('blob down'); } };
  const r = await ingest(store, '05');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).stored, 'new');
});

/* ---- the API and the card ---- */

const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } }; return r; };
const NOW11 = new Date(Date.parse(FEED['11'][0].published_at) + 20 * 60_000);
async function api(store, now = NOW11) {
  const r = res();
  await quiet(() => handle({ method: 'GET', query: { area: 'in/kolkata/ballygunge' } }, r,
    { key: '', now: () => now, feedCache: { entry: null, inflight: null }, cpcbFeed: true, source: 'relay', store }));
  return r.body;
}
async function storeAt11(withHistory = true) {
  const store = memoryStore();
  store.files.set(LATEST_PATH, GZ['11']);
  if (withHistory) for (const h of HOURS) await updateHistory(store, FEED[h]);
  return store;
}

test('API: a live CPCB answer carries us_nowcast; without a history it has none', async () => {
  const body = await api(await storeAt11());
  assert.equal(body.current.state, 'live');
  assert.deepEqual(body.us_nowcast, { aqi: 70, category: 'moderate', dominant: 'pm25', hours_used: 7 });
  assert.ok(isAirPayload(body) && isUsNowcast(body.us_nowcast));
  /* Only the current hour: fewer than 2 of 3, no NowCast; the card shows the 24-hour line. */
  const bare = await api(await storeAt11(false));
  assert.equal(bare.current.state, 'live');
  assert.equal(bare.us_nowcast, undefined);
  assert.match(cardHtml(bare, 'Ward 68', NOW11), /≈ US AQI \d+ · [A-Za-z ]+ · <span[^>]*>24-h/);
});

test('card: NowCast line and note; a malformed us_nowcast is dropped, never fails the payload', async () => {
  const body = await api(await storeAt11());
  const html = cardHtml(body, 'Ward 68', NOW11);
  assert.match(html, /≈ US AQI 70 · Moderate · <span[^>]*>NowCast/);
  assert.match(html, /NowCast, recent hours weighted, as used by AirNow/);
  for (const bad of [{ ...body.us_nowcast, aqi: 'x' }, { ...body.us_nowcast, aqi: 600 }, { ...body.us_nowcast, category: 'hazardous' },
    { ...body.us_nowcast, dominant: 'o3' }, { ...body.us_nowcast, hours_used: 1 }, null, 'NowCast 70']) {
    const b = { ...body, us_nowcast: bad };
    assert.ok(isAirPayload(b), 'the payload stays valid');
    assert.equal(isUsNowcast(bad), false, JSON.stringify(bad));
    assert.match(cardHtml(b, 'Ward 68', NOW11), /24-h<span/);
  }
  /* Stale by the viewer's clock: the NowCast line goes with the live figure. */
  assert.doesNotMatch(cardHtml(body, 'Ward 68', new Date(NOW11.getTime() + 3 * 3_600_000)), /NowCast/);
});
