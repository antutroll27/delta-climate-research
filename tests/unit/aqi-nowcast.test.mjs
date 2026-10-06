// tests/unit/aqi-nowcast.test.mjs — the US line by EPA NowCast, from CPCB's hourly sub-indices.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import test from 'node:test';
import { handle } from '../../api/air-quality.ts';
import { handleIngest } from '../../api/air-quality-ingest.ts';
import { newArchiveMemo, readRelay } from '../../src/lib/aqi/cpcb-archive.ts';
import { parseFeed } from '../../src/lib/aqi/cpcb-feed.ts';
import { addHour, hourOf, nowcastFor, series, TRACKED } from '../../src/lib/aqi/hourly-history.ts';
import { signV1 } from '../../src/lib/aqi/relay-auth.ts';
import { archivePath, memoryStore } from '../../src/lib/aqi/relay-store.ts';
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

test('history keeps the newest 24 distinct hours, none older than 24 h', () => {
  const t0 = Date.parse('2026-09-27T00:30:00Z');
  let h = null;
  for (let i = 0; i < 30; i++) h = addHour(h, { at: new Date(t0 + i * 3_600_000).toISOString(), stations: { [BALLY]: { pm25: 10, pm10: 20 } } });
  assert.equal(h.hours.length, 24);
  assert.equal(h.hours[0].at, new Date(t0 + 6 * 3_600_000).toISOString());
});

/* ---- the ingest and the archive read-back ---- */

const KEY = '5a'.repeat(32);
const signed = (body, now) => { const ts = now.getTime() / 1000;
  return new Request('https://deltaclimate.earth/api/air-quality-ingest', { method: 'POST', body,
    headers: { 'X-OBOS-Kind': 'cpcb-feed', 'X-OBOS-Timestamp': String(ts), 'X-OBOS-Signature': signV1(KEY, ts, body) } }); };
const ingestGz = (store, gz, now) => quiet(() => handleIngest(signed(gz, now), { key: KEY, store, now: () => now }));
const ingest = (store, h) => ingestGz(store, GZ[h], new Date(Date.parse(FEED[h][0].published_at) + 10 * 60_000));

test('ingest: each new hour is one archive object and nothing else; a duplicate post writes nothing', async () => {
  const store = memoryStore();
  assert.equal((await ingest(store, '05')).status, 200);
  assert.equal((await ingest(store, '06')).status, 200);
  assert.deepEqual([...store.files.keys()], ['05', '06'].map((h) => archivePath(FEED[h][0].published_at)));
  assert.deepEqual(await (await ingest(store, '06')).json(), { stored: 'duplicate', lastupdate: FEED['06'][0].published_at, stations: FEED['06'].length });
  assert.equal(store.files.size, 2);
});

test('first deploy: hours archived before this release are the NowCast record at once (no rebuild, no record to write)', async () => {
  const store = memoryStore();
  /* 05–10 archived before this release; 08 was never relayed. */
  for (const h of ['05', '06', '07', '09', '10']) store.files.set(archivePath(FEED[h][0].published_at), GZ[h]);
  assert.equal((await ingest(store, '11')).status, 200);
  const snap = await readRelay(store, new Date(Date.parse(FEED['11'][0].published_at) + 20 * 60_000), newArchiveMemo());
  assert.deepEqual(snap.history.hours.map((r) => r.at), ['05', '06', '07', '09', '10', '11'].map((k) => FEED[k][0].published_at));
});

/* ---- PARITY: the old stored record (cpcb/hourly-pm.json, main @ afab7d7) vs the archive read-back ----
   The old path, exactly as main ran it: on a NEW archive put (a duplicate returned before this), the ingest
   read the JSON record, added hourOf(feed) with addHour and wrote it back; the reader parsed the record and
   called nowcastFor(record, station of latest). Latest moved only forward. The new path is the real ingest
   and the real reader. For the same submissions, every TRACKED station must get the same NowCast. */

function legacy() {
  const archived = new Set();
  let record = null, latest = null; // record: the JSON text of cpcb/hourly-pm.json
  return {
    submit(feed) {
      const path = archivePath(feed[0].published_at);
      if (archived.has(path)) return 'duplicate';
      archived.add(path);
      if (!latest || Date.parse(feed[0].published_at) > Date.parse(latest[0].published_at)) latest = feed;
      record = JSON.stringify(addHour(record === null ? null : JSON.parse(record), hourOf(feed)));
      return 'new';
    },
    nowcasts() {
      const h = record === null ? null : JSON.parse(record);
      return Object.fromEntries(TRACKED.map((n) => { const f = latest?.find((s) => s.name === n); return [n, f ? nowcastFor(h, f) : null]; }));
    },
  };
}
async function archived(store, memo, now) {
  const snap = await readRelay(store, now, memo);
  return Object.fromEntries(TRACKED.map((n) => { const f = snap.stations.find((s) => s.name === n); return [n, f ? nowcastFor(snap.history, f) : null]; }));
}
/** One synthetic CPCB hour: every TRACKED station with its own PM sub-indices (a few blank), plus fillers to 300. */
function synthetic(ms, seed) {
  const d = new Date(ms + 5.5 * 3_600_000), p = (n) => String(n).padStart(2, '0');
  const stamp = `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:00:00`;
  const v = (i, k) => { const x = (seed * 31 + i * 17 + k * 7) % 211; return x % 13 === 0 ? '' : String(20 + x); };
  const st = (name, i) => `<Station id="${name}" lastupdate="${stamp}" latitude="22.5" longitude="88.3"><Pollutant_Index id="PM2.5" Min="1" Max="400" Avg="${v(i, 1) || 50}" Hourly_sub_index="${v(i, 1)}"/><Pollutant_Index id="PM10" Min="1" Max="400" Avg="${v(i, 2) || 50}" Hourly_sub_index="${v(i, 2)}"/><Air_Quality_Index Value="${Math.max(Number(v(i, 1) || 50), Number(v(i, 2) || 50))}" Predominant_Parameter="${Number(v(i, 1) || 50) >= Number(v(i, 2) || 50) ? 'PM2.5' : 'PM10'}"/></Station>`;
  const xml = `<AqIndex>${TRACKED.map(st).join('')}${Array.from({ length: 300 }, (_, i) => st(`F${i}`, 99)).join('')}</AqIndex>`;
  return gzipSync(xml);
}

test('PARITY: the 27 Sep captures (a duplicate, a skipped 08:00), old record vs archive read-back, every tracked station, every hour', async () => {
  const old = legacy(), store = memoryStore(), memo = newArchiveMemo();
  let compared = 0;
  for (const h of ['05', '06', '06', '07', '09', '10', '11']) {
    old.submit(FEED[h]);
    await ingest(store, h);
    const now = new Date(Date.parse(FEED[h][0].published_at) + 20 * 60_000);
    const want = old.nowcasts(), got = await archived(store, memo, now);
    assert.deepEqual(got, want, `after ${h}:00`);
    compared += Object.values(want).filter(Boolean).length;
  }
  assert.ok(compared >= 20, `real NowCasts were compared (${compared})`);
  /* And through the API for Ballygunge at 11:00: the figure the card shows. */
  const body = await api(store);
  assert.deepEqual(body.us_nowcast, old.nowcasts()[BALLY]);
});

test('PARITY over 30 synthetic hours: gaps, a duplicate, a late hour, the 12-hour edge; old and new agree at every step', async () => {
  const old = legacy(), store = memoryStore(), memo = newArchiveMemo();
  const t0 = Date.parse('2026-10-05T18:30:00Z'); // 06-10-2026 00:00 IST
  const gaps = new Set([3, 9, 16, 17, 18, 25]);
  const order = Array.from({ length: 30 }, (_, i) => i).filter((i) => !gaps.has(i) && i !== 4);
  order.splice(order.indexOf(6) + 1, 0, 4); // hour 4 arrives late, after 6 (never archived before)
  order.splice(order.indexOf(12) + 1, 0, 8); // hour 8 submitted again after 12 (a duplicate)
  let compared = 0, wall = 0;
  for (const i of order) {
    const ms = t0 + i * 3_600_000, gz = synthetic(ms, i);
    const feed = parseFeed(gunzipSync(gz).toString('utf8'));
    wall = Math.max(wall, ms + 20 * 60_000); // the clock never runs back for a late or repeated hour
    old.submit(feed);
    await ingestGz(store, gz, new Date(wall - 10 * 60_000));
    const want = old.nowcasts(), got = await archived(store, memo, new Date(wall));
    assert.deepEqual(got, want, `hour ${i}`);
    compared += Object.values(want).filter(Boolean).length;
  }
  assert.ok(compared > 100, `real NowCasts were compared (${compared})`);
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
/** 11:00 archived, and with `withHistory` the six hours before it too. */
async function storeAt11(withHistory = true) {
  const store = memoryStore();
  for (const h of withHistory ? HOURS : ['11']) store.files.set(archivePath(FEED[h][0].published_at), GZ[h]);
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
