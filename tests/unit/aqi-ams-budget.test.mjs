import assert from 'node:assert/strict';
import test from 'node:test';

import { handle } from '../../api/air-quality.ts';
import { AMSTERDAM_SHEETS, AMSTERDAM_SHEET_IDS } from '../../src/data/sheets/amsterdam.ts';
import { LOCAL_LIVE_MS } from '../../src/lib/aqi/local-areas.ts';
import { liveCacheControl, newLocalCache, streamingEnabled } from '../../src/lib/aqi/local-handler.ts';
import { LKI_MODEL_HOUR_MS } from '../../src/lib/aqi/lki.ts';
import { COOLDOWN_MS, MODEL_RETRY_MS, MODEL_RUN_MAX_MS, NEGATIVE_MS, STATION_TTL_MS, currentModelRow, modelStale, stationFresh } from '../../src/lib/aqi/nl-cache.ts';
import { nlLadder } from '../../src/lib/aqi/nl-stations.ts';
import { readFileSync } from 'node:fs';

/* THE REQUEST BUDGET (audit B1). Luchtmeetnet allows 100 requests per 5 minutes. These tests drive the real handler with a SIMULATED clock against a
   fake upstream that counts every request, and measure the busiest 5-minute window of each worst case. Nothing here is estimated. */

const HOUR = 3_600_000, MIN = 60_000;
const T0 = Date.parse('2026-11-08T13:40:00Z');
const AREAS = AMSTERDAM_SHEET_IDS.map((id) => `nl/amsterdam/${id}`);

const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } }; return r; };

/**
 * A simulated Luchtmeetnet. `mode` per kind ('station' | 'model'): 'ok', 'down' (503), 'stale' (rows three hours old), '429', 'lag' (the station has not yet
 * published the last hour: its newest row is the previous one). Stations publish the hour ending H at H + 30 min. The model run is 21 hourly rows
 * starting two hours before `now`, values 1.5, 2.5 ... so every hour has its own number; `cut` is a model answer with only the last 13 rows.
 */
function upstream(sim, opts = {}) {
  const log = [];
  const mode = { station: 'ok', model: 'ok', ...opts };
  const iso = (ms) => new Date(ms).toISOString().replace('.000Z', '+00:00');
  const fetch = async (url) => {
    const now = sim.now;
    const kind = url.includes('/concentrations?') ? 'model' : 'station';
    log.push({ t: now, url, kind });
    const m = mode[kind];
    if (m === 'down') return { ok: false, status: 503, text: async () => '' };
    if (m === '429') return { ok: false, status: 429, text: async () => '' };
    if (kind === 'model') {
      const start = Math.floor((now - 2 * HOUR) / HOUR) * HOUR;
      let rows = Array.from({ length: 21 }, (_, i) => ({ formula: 'LKI', value: 1.5 + i, timestamp_measured: iso(start + i * HOUR) }));
      if (mode.cut) rows = rows.slice(8);
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: rows }) };
    }
    const id = /station_number=(NL\d+)/.exec(url)[1];
    if (url.includes('/measurements?')) return { ok: true, status: 200, text: async () => '{"data":[]}' };
    let end = Math.floor((now - 30 * MIN) / HOUR) * HOUR;
    if (m === 'stale') end -= 3 * HOUR;
    if (m === 'lag') end -= HOUR;
    const sv = mode.station_values?.[id] ?? 3;
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ station_number: id, formula: 'LKI', value: sv, timestamp_measured: iso(end) }] }) };
  };
  return { fetch, log, mode };
}

/** The busiest 5-minute window (any start) in a request log. */
function peak5(log) {
  let best = 0;
  for (let i = 0; i < log.length; i++) {
    let n = 0;
    for (let j = i; j < log.length && log[j].t < log[i].t + 5 * MIN; j++) n++;
    best = Math.max(best, n);
  }
  return best;
}

function harness(opts = {}) {
  const sim = { now: T0 };
  const up = upstream(sim, opts);
  const cache = newLocalCache();
  const call = async (area, extra = {}) => {
    const r = res();
    await handle({ method: 'GET', query: { area } }, r, { key: '', local: { fetch: up.fetch, now: () => new Date(sim.now), cache, streaming: true, ...extra } });
    return r;
  };
  return { sim, up, cache, call };
}

/** Poll every area once per `step` ms for `span` ms. */
async function poll(h, span, step) {
  const end = h.sim.now + span;
  const last = {};
  for (; h.sim.now < end; h.sim.now += step) for (const a of AREAS) last[a] = await h.call(a);
  return last;
}

test('WORST CASE, MEASURED: the busiest 5 minutes per instance for each scenario, 32 areas polled every 10 s (nothing estimated)', async () => {
  const results = {};
  for (const [name, opts, span] of [
    ['healthy cold start, all 32 areas at once, then 5 min of polling', {}, 5 * MIN],
    ['outage: every request is a 503, 5 min of polling from cold', { station: 'down', model: 'down' }, 5 * MIN],
    ['late publication: every station 3 h old, 5 min of polling', { station: 'stale' }, 5 * MIN],
    ['a new hour is due: stations lag one hour behind, 5 min of polling', { station: 'lag' }, 5 * MIN],
    ['the model answer is cut short every time, 5 min of polling', { cut: true }, 5 * MIN],
    ['rate limit: Luchtmeetnet answers 429 to everything', { station: '429', model: '429' }, 5 * MIN],
  ]) {
    const h = harness(opts);
    await poll(h, span, 10_000);
    results[name] = peak5(h.up.log);
  }
  /* a longer outage: the 60 s negative entries keep it flat, window after window */
  const out = harness({ station: 'down', model: 'down' });
  await poll(out, 30 * MIN, 10_000);
  results['outage, 30 min (busiest 5-minute window)'] = peak5(out.up.log);
  for (const [name, n] of Object.entries(results)) console.log(`budget: ${String(n).padStart(3)} requests  ${name}`);
  for (const [name, n] of Object.entries(results)) assert.ok(n < 100, `${name}: ${n}`);
  /* the ceiling the code is designed to: 6 stations asked once a minute (30) + their substance reads (6) + 32 model locations once (32) */
  const ceiling = 6 * 5 + 6 + 32;
  for (const [name, n] of Object.entries(results)) assert.ok(n <= ceiling, `${name}: ${n} <= ${ceiling}`);
});

test('AMPLIFICATION FIXED: an outage costs at most one /lki request per station per minute, however many areas and polls; the old cost was ~190 a minute', async () => {
  const h = harness({ station: 'down', model: 'down' });
  await poll(h, 3 * MIN, 5_000);
  const lki = h.up.log.filter((r) => r.url.includes('/lki?'));
  const stationsAsked = new Set(lki.map((r) => /NL\d+/.exec(r.url)[0]));
  assert.ok(stationsAsked.size <= 6);
  for (const id of stationsAsked) {
    const t = lki.filter((r) => r.url.includes(id)).map((r) => r.t);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= NEGATIVE_MS, `${id} asked twice within a minute`);
  }
  assert.ok(h.up.log.filter((r) => r.kind === 'model').length <= 32, 'one failed model read per location per 5 minutes');
});

test('SHARED ACROSS AREAS: 32 areas on a healthy upstream read each needed station once and each model location once', async () => {
  const h = harness();
  await Promise.all(AREAS.map((a) => h.call(a)));
  const lki = h.up.log.filter((r) => r.url.includes('/lki?')).map((r) => /NL\d+/.exec(r.url)[0]);
  assert.equal(new Set(lki).size, lki.length, 'no station twice');
  assert.deepEqual([...new Set(lki)].sort(), ['NL10552', 'NL49003', 'NL49012', 'NL49014']);
  assert.equal(h.up.log.filter((r) => r.kind === 'model').length, 32);
  assert.equal(h.up.log.length, 4 * 2 + 32);
  const before = h.up.log.length;
  for (const a of AREAS) await h.call(a);
  assert.equal(h.up.log.length, before, 'a second sweep is served from memory');
});

test('PITFALL 1: one area\'s distance and fallback label can never appear on another area\'s card (the cache holds raw rows only)', async () => {
  const centres = Object.fromEntries(AMSTERDAM_SHEETS.map((s) => [`nl/amsterdam/${s.id}`, s.centre]));
  const dist = (area, id) => nlLadder(centres[area]).find((x) => x.station.id === id)?.station.distance_m;
  for (const order of [['nl/amsterdam/ams-f4', 'nl/amsterdam/ams-g4', 'nl/amsterdam/canal-ring'], ['nl/amsterdam/canal-ring', 'nl/amsterdam/ams-g4', 'nl/amsterdam/ams-f4']]) {
    const h = harness();
    for (const a of order) {
      const r = await h.call(a);
      assert.equal(r.body.state, 'live', a);
      assert.equal(r.body.station.distance_m, dist(a, r.body.station.id), `${a}: its own distance to ${r.body.station.id}`);
    }
    /* the raw entries carry no distance, no fallback, no place */
    const raw = JSON.stringify([...h.cache.nl.stations.values()]);
    assert.ok(!/distance_m|fallback|owner|"lat"|area_id/.test(raw), raw.slice(0, 200));
  }
  /* fallback: NL49003 (nearest to F4) is down for the day, NL49012 is the nearest of E3 - one entry each, three areas */
  const h = harness();
  const e3 = await h.call('nl/amsterdam/ams-e3');                       // nearest NL49012, 204 m, no fallback
  assert.deepEqual([e3.body.station.id, e3.body.station.fallback], ['NL49012', undefined]);
  h.up.mode.station_values = {};
  const down = (id) => { h.cache.nl.stations.set(id, { at: h.sim.now, lki: null, meas: [] }); };
  down('NL49003');
  const f4 = await h.call('nl/amsterdam/ams-f4');                       // NL49003 unreadable: NL49012 serves it as a FALLBACK, at F4's own distance
  assert.deepEqual([f4.body.station.id, f4.body.station.fallback, f4.body.station.distance_m], ['NL49012', true, dist('nl/amsterdam/ams-f4', 'NL49012')]);
  const e3b = await h.call('nl/amsterdam/ams-e3');                      // the same cached NL49012 entry: E3 still sees no fallback and its 204 m
  assert.deepEqual([e3b.body.station.id, e3b.body.station.fallback, e3b.body.station.distance_m], ['NL49012', undefined, 204]);
});

test('PITFALL 2: stations, model runs and area payloads are separate maps; Amsterdam fills only the first two', async () => {
  const h = harness();
  for (const a of AREAS.slice(0, 6)) await h.call(a);
  assert.ok([...h.cache.nl.stations.keys()].every((k) => /^NL\d{5}$/.test(k)));
  assert.ok([...h.cache.nl.models.keys()].every((k) => /^\d+\.\d{6},\d+\.\d{6}$/.test(k)));
  assert.equal(h.cache.entries.size, 0, 'no stacked area-payload layer for Amsterdam');
  assert.ok(h.cache.nl.stations.size > 0 && h.cache.nl.models.size === 6);
});

test('PITFALL 3: no TTL stacks - a station is re-read 10 minutes after it was read, and the payload follows it, with no second layer on top', async () => {
  const h = harness();
  await h.call('nl/amsterdam/canal-ring');
  const n = h.up.log.length;
  h.sim.now += STATION_TTL_MS - 1_000;
  await h.call('nl/amsterdam/canal-ring');
  assert.equal(h.up.log.length, n, 'inside the TTL: memory');
  h.sim.now += 2_000;
  const r = await h.call('nl/amsterdam/canal-ring');
  assert.ok(h.up.log.slice(n).some((x) => x.url.includes('/lki?')), 'just past the TTL: the station is read again');
  assert.equal(r.body.served_at, new Date(h.sim.now).toISOString(), 'served_at is this request\'s');
});

test('PITFALL 4: the nearest station is not left on its old hour for a whole TTL after it published - a new hour that is due is looked for every minute', async () => {
  /* Vondelpark's hour-12:00 row (published 12:30) read at 13:25; its 13:00 row lands at 13:30. At 13:34 the entry is 9 minutes old (inside the 10-minute TTL) yet must be re-read. */
  const h = harness();
  h.sim.now = Date.parse('2026-11-08T13:25:00Z');
  const a = await h.call('nl/amsterdam/canal-ring');
  assert.equal(a.body.observed_at, '2026-11-08T12:00:00.000Z');
  h.sim.now = Date.parse('2026-11-08T13:34:00Z');
  const b = await h.call('nl/amsterdam/canal-ring');
  assert.equal(b.body.observed_at, '2026-11-08T13:00:00.000Z', 'the new row is shown at once');
  assert.equal(b.body.station.fallback, undefined);
  /* and an entry that is NOT due stays for the TTL */
  const e = { at: Date.parse('2026-11-08T13:00:00Z'), lki: [{ value: 3, endMs: Date.parse('2026-11-08T13:00:00Z') }], meas: [] };
  assert.equal(stationFresh(e, Date.parse('2026-11-08T13:09:00Z'), LOCAL_LIVE_MS['nl-lki']), true);
  assert.equal(stationFresh(e, Date.parse('2026-11-08T14:40:00Z'), LOCAL_LIVE_MS['nl-lki']), false, 'its next row is 20 minutes overdue');
});

test('PITFALL 5: a cached row is judged against the live window when USED, not when read - even with the cache held up by a cooldown', async () => {
  const h = harness();
  const a = await h.call('nl/amsterdam/canal-ring');
  assert.equal(a.body.state, 'live');
  const rows = h.cache.nl.stations.get('NL49014');
  /* the upstream goes dark and rate-limits us; the row read at 13:40 (hour ending 13:00) ages out at 15:00:00 */
  h.up.mode.station = '429'; h.up.mode.model = '429';
  h.sim.now = Date.parse('2026-11-08T14:55:00Z');
  const inside = await h.call('nl/amsterdam/canal-ring');
  assert.equal(inside.body.state, 'live', 'inside two hours the cached row still stands (the cooldown only stops requests)');
  assert.equal(inside.body.observed_at, '2026-11-08T13:00:00.000Z');
  h.sim.now = Date.parse('2026-11-08T15:01:00Z');
  const past = await h.call('nl/amsterdam/canal-ring');
  assert.equal(past.body.state, 'not_reporting');
  assert.ok(!('lki' in past.body), 'no number past the window');
  assert.ok(rows.lki[0].endMs < h.sim.now - LOCAL_LIVE_MS['nl-lki']);
});

test('PITFALL 6/7/8 + THE SURVIVING MUTANT: the whole model run is cached; the row is picked by the request\'s clock; a cache hit never serves an hour that is over', async () => {
  const h = harness();
  h.sim.now = Date.parse('2026-11-08T13:50:00Z');
  const a = await h.call('nl/amsterdam/canal-ring');
  assert.equal(a.body.model.hour_start, '2026-11-08T13:00:00.000Z');
  const modelCalls = () => h.up.log.filter((r) => r.kind === 'model').length;
  assert.equal(modelCalls(), 1);
  /* across the hour boundary, from the cached run: the next hour's row, not the old one, and not a vanished line */
  h.sim.now = Date.parse('2026-11-08T14:05:00Z');
  const b = await h.call('nl/amsterdam/canal-ring');
  assert.equal(modelCalls(), 1, 'no new model request: the run is cached');
  assert.equal(b.body.model.hour_start, '2026-11-08T14:00:00.000Z');
  assert.notEqual(b.body.model.value, a.body.model.value, 'a different hour has its own number');
  /* the run runs out: the line is ABSENT, never the last row held on */
  const run = h.cache.nl.models.values().next().value;
  run.rows = run.rows.filter((r) => r.hourMs <= Date.parse('2026-11-08T13:00:00Z'));
  h.sim.now = Date.parse('2026-11-08T14:10:00Z');
  run.at = h.sim.now;                                         // the run was read a moment ago: inside its retry gap
  const c = await h.call('nl/amsterdam/canal-ring');
  assert.equal('model' in c.body, false, 'the 13:00 row is over at 14:00; a cache hit must not serve it');
  assert.equal(c.body.state, 'live');
  /* its retry is rate-limited to once per MODEL_RETRY_MS, then a new run restores the line */
  assert.equal(modelCalls(), 1, 'no retry yet');
  h.sim.now += MODEL_RETRY_MS + 60_000;
  const d = await h.call('nl/amsterdam/canal-ring');
  assert.equal(modelCalls(), 2);
  assert.ok(d.body.model);
});

test('PITFALL 7: a truncated answer (no current-hour row) is read again after 5 minutes, not held for the run\'s life; an unreadable one likewise; a good run lives 60 minutes at most', async () => {
  const sim = Date.parse('2026-11-08T13:50:00Z');
  const cut = { at: sim, rows: [{ value: 3.2, hourMs: Date.parse('2026-11-09T05:00:00Z') }] };
  assert.equal(modelStale(cut, sim + MODEL_RETRY_MS - 1), false);
  assert.equal(modelStale(cut, sim + MODEL_RETRY_MS), true);
  assert.equal(modelStale({ at: sim, rows: null }, sim + MODEL_RETRY_MS - 1), false);
  assert.equal(modelStale({ at: sim, rows: null }, sim + MODEL_RETRY_MS), true);
  const rows = Array.from({ length: 21 }, (_, i) => ({ value: 3.2, hourMs: Date.parse('2026-11-08T12:00:00Z') + i * HOUR }));
  assert.equal(modelStale({ at: sim, rows }, sim + MODEL_RUN_MAX_MS - 1), false);
  assert.equal(modelStale({ at: sim, rows }, sim + MODEL_RUN_MAX_MS), true, 'the run is superseded after an hour at most');
  assert.equal(currentModelRow(rows, Date.parse('2026-11-08T13:59:59Z')).hourMs, Date.parse('2026-11-08T13:00:00Z'));
  /* through the handler: a cut answer costs one request per 5 minutes per location, and the card is the measured card meanwhile */
  const h = harness({ cut: true });
  h.sim.now = Date.parse('2026-11-08T13:50:00Z');
  for (let i = 0; i < 20; i++) { const r = await h.call('nl/amsterdam/canal-ring'); h.sim.now += 10_000; assert.equal('model' in r.body, false); assert.equal(r.body.state, 'live'); }
  assert.equal(h.up.log.filter((r) => r.kind === 'model').length, 1);
});

test('PITFALL 9: concurrent requests share one read per station and per model location', async () => {
  const h = harness();
  await Promise.all(Array.from({ length: 20 }, () => h.call('nl/amsterdam/canal-ring')));
  assert.equal(h.up.log.filter((r) => r.url.includes('/lki?')).length, 1);
  assert.equal(h.up.log.filter((r) => r.kind === 'model').length, 1);
});

test('PITFALL 10: a 429 starts a cooldown that stops EVERY request - rungs and model, every area - is logged once with the path only, and shows as source_down, never a value', async () => {
  const logged = [];
  const real = console.error; console.error = (...a) => { logged.push(a.join(' ')); };
  try {
    const h = harness({ station: '429', model: 'ok' });
    const a = await h.call('nl/amsterdam/canal-ring');
    assert.deepEqual([a.body.state, a.body.reason], ['not_reporting', 'source_down']);
    assert.equal(a.headers['Cache-Control'], 'no-store');
    assert.ok(!('lki' in a.body) && !('model' in a.body));
    assert.ok(h.up.log.length <= 2, `the ladder was not walked: ${h.up.log.length} requests`);
    const n = h.up.log.length;
    assert.equal(logged.filter((l) => l.includes('luchtmeetnet 429')).length, 1);
    assert.ok(logged.every((l) => !l.includes('?') && !l.includes('latitude')), 'path only');
    /* every other area, every rung, the model: nothing is asked for the whole cooldown */
    for (let i = 0; i < 25; i++) { h.sim.now += 10_000; for (const ar of AREAS) await h.call(ar); }
    assert.equal(h.up.log.length, n, 'no request during the cooldown');
    h.sim.now = T0 + COOLDOWN_MS + 1_000;
    h.up.mode.station = 'ok';
    const b = await h.call('nl/amsterdam/canal-ring');
    assert.equal(b.body.state, 'live', 'and it recovers when the cooldown ends');
    assert.ok(h.up.log.length > n);
    /* a 429 on the MODEL stops the stations too */
    const m = harness({ station: 'ok', model: '429' });
    await m.call('nl/amsterdam/canal-ring');
    const k = m.up.log.length;
    m.sim.now += 10_000;
    await m.call('nl/amsterdam/ams-f4'); await m.call('nl/amsterdam/ams-d2');
    assert.equal(m.up.log.length, k, 'a model 429 cools the stations as well');
    assert.equal(logged.filter((l) => l.includes('luchtmeetnet 429') && l.includes('/concentrations')).length, 1);
  } finally { console.error = real; }
  const R = readFileSync('src/lib/aqi/luchtmeetnet.ts', 'utf8');
  assert.match(R, /status === 429/);
});

test('A 429 does not wipe rows that are still good: the cards keep the last live figure until its window ends', async () => {
  const logs = []; const real = console.error; console.error = (...a) => logs.push(a);
  try {
    const h = harness();
    await h.call('nl/amsterdam/canal-ring');
    h.sim.now += 11 * MIN; h.up.mode.station = '429';
    const r = await h.call('nl/amsterdam/canal-ring');
    assert.equal(r.body.state, 'live');
    assert.equal(r.body.station.id, 'NL49014');
  } finally { console.error = real; }
});

/* ── S1: the streamed ids are served only where streaming is on ─────────────────────────────────── */

test('S1: production with streaming off serves Canal Ring only; the 31 other ids are a 404 and nothing is fetched; streaming on opens them', async () => {
  for (const [streaming, served] of [[false, 1], [true, 32]]) {
    const h = harness();
    let ok = 0;
    for (const a of AREAS) {
      const r = await h.call(a, { streaming });
      if (r.code === 200) ok++; else assert.equal(r.code, 404, a);
    }
    assert.equal(ok, served, `streaming ${streaming}`);
    if (!streaming) assert.ok(h.up.log.every((r) => !/latitude=52\.(4146|3893|3387|3133|2880)/.test(r.url)), 'nothing fetched for a gated id');
  }
  const off = await harness().call('nl/amsterdam/ams-f4', { streaming: false });
  assert.deepEqual([off.code, off.body], [404, { error: 'unknown area' }]);
});

test('S1: the gate is the page\'s own switch - PUBLIC_OBOS_STREAM_DEV=1 or TILED_CITY_READY - and the function entry point passes the environment', () => {
  assert.equal(streamingEnabled({}, false), false);
  assert.equal(streamingEnabled({ PUBLIC_OBOS_STREAM_DEV: '1' }, false), true);
  for (const v of ['0', 'true', '', undefined, 'yes']) assert.equal(streamingEnabled({ PUBLIC_OBOS_STREAM_DEV: v }, false), false, String(v));
  assert.equal(streamingEnabled({}, true), true, 'turning the tiled city on publicly opens the API with no second switch');
  assert.equal(streamingEnabled({}), false, 'today TILED_CITY_READY is false');
  const api = readFileSync('api/air-quality.ts', 'utf8');
  assert.match(api, /local: \{ streaming: streamingEnabled\(process\.env\) \}/);
  const app = readFileSync('src/scripts/climate-engine/heat-map-app.ts', 'utf8');
  assert.match(app, /const STREAM_DEV = import\.meta\.env\.PUBLIC_OBOS_STREAM_DEV === '1'/);
  assert.match(readFileSync('src/lib/aqi/local-handler.ts', 'utf8'), /env\['PUBLIC_OBOS_STREAM_DEV'\] === '1'/);
});

/* ── S4: the model line across the hour, at the CDN ──────────────────────────────────────────────── */

test('S4: the line is present right after the hour (the cached run has the new row), and no cache holds a body past the model\'s hour', async () => {
  const h = harness();
  h.sim.now = Date.parse('2026-11-08T13:58:00Z');
  const a = await h.call('nl/amsterdam/canal-ring');
  const cc = a.headers['Cache-Control'];
  assert.match(cc, /max-age=60, s-maxage=120, stale-while-revalidate=0/, cc);
  h.sim.now = Date.parse('2026-11-08T14:00:30Z');
  const b = await h.call('nl/amsterdam/canal-ring');
  assert.equal(b.body.model.hour_start, '2026-11-08T14:00:00.000Z', 'present 30 s after the hour: no 20-minute hole');
  const live = a.body;
  const total = (hd) => [...hd.matchAll(/(?:s-maxage|stale-while-revalidate)=(\d+)/g)].reduce((s, m) => s + Number(m[1]), 0);
  for (const sec of [0, 30, 100, 119, 120]) {
    const now = new Date(Date.parse('2026-11-08T13:58:00Z') + sec * 1000);
    const hd = liveCacheControl(live, now);
    const left = (Date.parse(live.model.hour_start) + LKI_MODEL_HOUR_MS - now.getTime()) / 1000;
    if (left <= 0) assert.equal(hd, 'no-store'); else assert.ok(total(hd) <= left + 1e-9 && Number(/max-age=(\d+)/.exec(hd)[1]) <= left, `${sec}: ${hd}`);
  }
});
