// tests/unit/aqi-load.test.mjs
/* THE FETCH-AND-CHOOSE STEP, run against a fake fetch. heat-map-app.ts only moves
   what `loadAir` returns into the DOM, so every decision about WHAT the reader sees
   after a request (the payload, the designed failure, or nothing at all because the
   answer is for an area they have already left) is made here, where it can be run. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAir, cardHtml, paneHtml, unavailableHtml, loadingPaneHtml, uncoveredPaneHtml } from '../../src/scripts/climate-engine/air/air-panel.ts';
import { buildPayload } from '../../src/lib/aqi/build.ts';
import { stationFor } from '../../src/lib/aqi/stations.ts';
import { isAirPayload } from '../../src/lib/aqi/valid.ts';

const raw = (lastEnd) => { const e = Date.parse(lastEnd), o = {}; for (const p of ['pm25','pm10','no2','so2','co','o3']) { o[p] = []; for (let t = e - 31*864e5; t <= e; t += 9e5) o[p].push({ end_utc: new Date(t).toISOString(), value: p === 'co' ? 0.5 : 20 }); } return o; };
const K = 'in/kolkata/ballygunge';
const NOW = new Date('2026-09-26T08:30:00Z');
const PAYLOAD = buildPayload(K, stationFor(K), raw('2026-09-24T17:30:00Z'), NOW);

/** A fake fetch: records the url, answers with `res` (or throws it). */
function fakeFetch(res) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); if (res instanceof Error) throw res; return res; };
  return { f, calls };
}
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const run = (res, { isCurrent = () => true, ctl = new AbortController() } = {}) => {
  const { f, calls } = fakeFetch(res);
  return { calls, out: loadAir(K, 'Ballygunge', { fetch: f, signal: ctl.signal, isCurrent, now: NOW }) };
};
const assertFailed = (v) => {
  assert.ok(v, 'a failure paints the designed view, not nothing');
  assert.equal(v.block, unavailableHtml('Ballygunge'), 'the block shows unavailableHtml');
  assert.match(v.pane, /could not be loaded/, 'the pane says the same thing');
  assert.match(v.pane, /id="pane-air-h"/, 'the pane keeps its labelled heading');
  assert.doesNotMatch(v.pane + v.block, /class="num/, 'a failure never prints a number');
  assert.deepEqual(v.days, []);
};

test('a good payload paints the card and the pane from the painters', async () => {
  const { out, calls } = run(json(PAYLOAD));
  const v = await out;
  assert.equal(calls[0].url, '/api/air-quality?area=in%2Fkolkata%2Fballygunge');
  assert.ok(calls[0].init.signal, 'the request carries the abort signal');
  assert.equal(v.block, cardHtml(PAYLOAD, 'Ballygunge', NOW));
  assert.equal(v.pane, paneHtml(PAYLOAD, 'Ballygunge', NOW));
  assert.equal(v.days, PAYLOAD.history.days);
});
test('a 500 paints the designed failure, and its body is never read', async () => {
  let read = false;
  assertFailed(await run({ ok: false, status: 500, json: async () => { read = true; return PAYLOAD; } }).out);
  assert.equal(read, false, 'a non-OK body is not trusted, even if it parses');
});
test('a network error paints the designed failure', async () => {
  assertFailed(await run(new TypeError('Failed to fetch')).out);
});
test('a body that is not JSON paints the designed failure', async () => {
  assertFailed(await run({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }).out);
});
test('a body with no `current` paints the designed failure', async () => {
  assertFailed(await run(json({ error: 'upstream' })).out);
  assertFailed(await run(json(null)).out);
  assertFailed(await run(json({ current: { nope: 1 } })).out);
});
test('an aborted request paints nothing', async () => {
  const ctl = new AbortController(); ctl.abort();
  const err = new DOMException('aborted', 'AbortError');
  assert.equal(await run(err, { ctl }).out, null);
});
test('an answer for an area the reader has left paints nothing, success or failure', async () => {
  assert.equal(await run(json(PAYLOAD), { isCurrent: () => false }).out, null);
  assert.equal(await run(json({}, 500), { isCurrent: () => false }).out, null);
  assert.equal(await run(new TypeError('Failed to fetch'), { isCurrent: () => false }).out, null);
});
test('the loading and not-covered panes name the place and keep the heading', () => {
  for (const [html, say] of [[loadingPaneHtml('Ballygunge'), /Loading air quality…/], [uncoveredPaneHtml('MG <Road>'), /covers Kolkata first; this city is not yet covered/]]) {
    assert.match(html, /<p class="pane-h" id="pane-air-h">Air · /);
    assert.match(html, say);
    assert.doesNotMatch(html, /<Road>/, 'the place is escaped');
  }
});

/* ── I5: the payload is validated at the boundary ──────────────────────────── */
const clone = () => structuredClone(PAYLOAD);
test('a hostile category is a load failure, never painted', async () => {
  const p = clone(); p.current.result.category = 'good);"><img src=x onerror=alert(2)>';
  assertFailed(await run(json(p)).out);
});
test('a malformed payload of any kind is a load failure', async () => {
  const bad = [
    (p) => { p.current.state = 'bogus'; },
    (p) => { p.current.result.aqi = '<img src=x>'; },
    (p) => { p.current.result.aqi = Number.NaN; },
    (p) => { p.current.result.dominant = 'pm1'; },
    (p) => { p.current.age_h = Infinity; },
    (p) => { p.current.observed_at = 7; },
    (p) => { p.current.result.pollutants = {}; },
    (p) => { p.current.result.pollutants[0].sub_index = '12'; },
    (p) => { p.current.result.pollutants[0].unit = 'ppb'; },
    (p) => { p.current.station.distance_m = '993'; },
    (p) => { p.current.station.name = 5; },
    (p) => { p.history.days = 'x'; },
    (p) => { p.history.days[0].aqi = '<b>'; },
    (p) => { p.history.days[0].category = 'purple'; },
    (p) => { p.history.pm25_24h[0].value = '1'; },
  ];
  for (const f of bad) { const p = clone(); f(p); assertFailed(await run(json(p)).out); }
});
test('isAirPayload accepts every state the builder emits', async () => {
  const { isAirPayload } = await import('../../src/lib/aqi/valid.ts');
  const now = NOW;
  const short = raw('2026-09-26T08:15:00Z');
  for (const p of Object.keys(short)) short[p] = short[p].filter((r) => Date.parse(r.end_utc) > now - 10 * 36e5);
  const all = [
    buildPayload(K, stationFor(K), raw('2026-09-26T08:15:00Z'), now),
    PAYLOAD,
    buildPayload(K, stationFor(K), raw('2026-09-10T00:00:00Z'), now),
    buildPayload(K, stationFor(K), {}, now),
    buildPayload(K, stationFor(K), short, now),
    buildPayload('in/kolkata/baruipur', null, {}, now),
  ];
  assert.deepEqual(all.map((p) => p.current.state), ['live', 'stale', 'unavailable', 'unavailable', 'insufficient_data', 'no_station']);
  for (const p of all) assert.equal(isAirPayload(JSON.parse(JSON.stringify(p))), true, p.current.state);
});
test('loadAir hands the app a status line', async () => {
  const v = await run(json(PAYLOAD)).out;
  assert.match(v.status, /^Air quality, Ballygunge: \d+ \w+, not live, \d+ hours old$/);
  const f = await run(new TypeError('Failed to fetch')).out;
  assert.equal(f.status, 'Air quality, Ballygunge: could not be loaded just now.');
});

const cpcbLive = () => ({ current: { schema: 2, area_id: 'in/kolkata/ballygunge', served_at: '2026-09-27T00:00:00.000Z',
  source: { owner: 'West Bengal Pollution Control Board', via: 'CPCB', standard: 'CPCB National AQI' }, state: 'live',
  station: { id: 'openaq:10918', name: 'Ballygunge, Kolkata', lat: 22.5, lon: 88.3, distance_m: 993, inside: 'window_3km' },
  observed_at: '2026-09-26T23:30:00.000Z',
  result: { origin: 'cpcb', aqi: 38, category: 'good', dominant: 'pm10', window_h: 24,
    subindices: [{ parameter: 'pm10', avg: 38, min: 18, max: 53, hourly: 45 }, { parameter: 'pm25', avg: 24, min: 19, max: 37, hourly: null }] } }, history: null });

test('a CPCB-origin payload validates; a bad sub-index or unknown origin does not', () => {
  assert.equal(isAirPayload(cpcbLive()), true);
  const bad = cpcbLive(); bad.current.result.subindices[0].avg = 'x'; assert.equal(isAirPayload(bad), false);
  const odd = cpcbLive(); odd.current.result.origin = 'google'; assert.equal(isAirPayload(odd), false);
  const ins = cpcbLive(); ins.current = { ...ins.current, state: 'insufficient_data', origin: 'cpcb', reasons: ['No valid PM2.5 or PM10 reading'], subindices: ins.current.result.subindices };
  delete ins.current.result; assert.equal(isAirPayload(ins), true);
});

test('a schema-1 payload still validates (the CDN can serve pre-deploy answers for ~40 min)', () => {
  const p = cpcbLive(); p.current.schema = 1;
  p.current.result = { aqi: 28, category: 'good', dominant: 'o3', window_end_ist: '2026-09-24T23:00:00+05:30', algorithm: 'cpcb-aqi-1',
    pollutants: [{ parameter: 'o3', value: 28.45, unit: 'ug_m3', window_h: 8, hours_present: 24, sub_index: 28 }] };
  assert.equal(isAirPayload(p), true);
});

test('M8: only undefined or "obos" passes as an OBOS origin, on a result and on insufficient_data', () => {
  const bad = structuredClone(PAYLOAD); bad.current.result.origin = 'google';
  assert.equal(isAirPayload(bad), false);
  const v1 = structuredClone(PAYLOAD); delete v1.current.result.origin;
  assert.equal(isAirPayload(v1), true, 'schema 1 has no origin');
  const ins = (origin) => { const p = structuredClone(PAYLOAD); const { result, age_h, ...c } = p.current;
    p.current = { ...c, state: 'insufficient_data', origin, pollutants: result.pollutants, reasons: ['PM2.5 had 11 of 16 required hours'] }; return p; };
  assert.equal(isAirPayload(ins('obos')), true);
  assert.equal(isAirPayload(ins('google')), false);
});
