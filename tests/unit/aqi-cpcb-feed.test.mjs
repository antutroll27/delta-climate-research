// tests/unit/aqi-cpcb-feed.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

export const FEED_XML = gunzipSync(readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url))).toString('utf8');

test("CPCB's feed carries SUB-INDICES: the published AQI is the largest Avg, and the predominant pollutant is the one holding it", () => {
  let n = 0;
  for (const m of FEED_XML.matchAll(/<Station id="([^"]+)"[^>]*>([\s\S]*?)<\/Station>/g)) {
    const a = /Air_Quality_Index Value="(\d+)" Predominant_Parameter="([^"]*)"/.exec(m[2]);
    if (!a) continue;
    const avgs = [...m[2].matchAll(/Pollutant_Index id="([^"]+)" Min="[^"]*" Max="[^"]*" Avg="(\d+)"/g)].map(([, p, v]) => [p, Number(v)]);
    const max = Math.max(...avgs.map(([, v]) => v));
    assert.equal(Number(a[1]), max, `${m[1]}: AQI ${a[1]} is not the largest Avg ${max}`);
    assert.ok(avgs.some(([p, v]) => p === a[2] && v === max), `${m[1]}: ${a[2]} does not hold the largest Avg`);
    n++;
  }
  assert.equal(n, 442, 'the capture had 442 stations with a numeric AQI');
});

import { FeedError, istStamp, parseFeed, pick } from '../../src/lib/aqi/cpcb-feed.ts';
import { stationFor } from '../../src/lib/aqi/stations.ts';

const one = (station, body) => `<?xml version='1.0'?><AqIndex><Country id="India"><State id="X"><City id="Y">${station.replaceAll('BODY', body)}</City></State></Country></AqIndex>`;
const ST = (name = 'Ballygunge, Kolkata - WBPCB', lat = '22.5367507', lon = '88.3638022') => `<Station id="${name}" lastupdate="27-09-2026 05:00:00" latitude="${lat}" longitude="${lon}">BODY</Station>`;
const POLS = '<Pollutant_Index id="PM2.5" Min="19" Max="37" Avg="24" Hourly_sub_index="26"/><Pollutant_Index id="PM10" Min="18" Max="53" Avg="38" Hourly_sub_index="45"/><Pollutant_Index id="NO2" Min="16" Max="36" Avg="23" Hourly_sub_index="16"/>';

test('parseFeed reads the real capture: Ballygunge 38 PM10 and Barrackpore 46 PM10, seven sub-index rows each', () => {
  const feed = parseFeed(FEED_XML);
  assert.equal(feed.length, 481);
  const b = feed.find((s) => s.name === 'Ballygunge, Kolkata - WBPCB');
  assert.deepEqual({ aqi: b.aqi, dominant: b.dominant, published_at: b.published_at }, { aqi: 38, dominant: 'pm10', published_at: '2026-09-26T23:30:00.000Z' });
  assert.equal(b.subindices.length, 7);
  assert.deepEqual(b.subindices.find((q) => q.parameter === 'pm25'), { parameter: 'pm25', avg: 24, min: 19, max: 37, hourly: 26 });
  const s = feed.find((x) => x.name === 'SVSPA Campus, Barrackpore - WBPCB');
  assert.deepEqual({ aqi: s.aqi, dominant: s.dominant }, { aqi: 46, dominant: 'pm10' });
  assert.equal(s.subindices.find((q) => q.parameter === 'pm25').hourly, null, 'NA is null, never 0');
});

test('a blank AQI is null with no dominant; OZONE is o3', () => {
  const [g] = parseFeed(one(ST('G'), '<Pollutant_Index id="OZONE" Min="11" Max="12" Avg="11" Hourly_sub_index="11"/><Air_Quality_Index Value="" Predominant_Parameter=""/>'));
  assert.deepEqual({ aqi: g.aqi, dominant: g.dominant, p: g.subindices[0].parameter }, { aqi: null, dominant: null, p: 'o3' });
});

test('entities in names are decoded', () => {
  const [s] = parseFeed(one(ST('A &amp; B, X - Y'), POLS + '<Air_Quality_Index Value="38" Predominant_Parameter="PM10"/>'));
  assert.equal(s.name, 'A & B, X - Y');
});

test('a station with a non-numeric value is dropped, never coerced; the rest survive', () => {
  const xml = one(ST('Bad') + ST('Good'), POLS + '<Air_Quality_Index Value="38" Predominant_Parameter="PM10"/>')
    .replace('Avg="24"', 'Avg="2x"');
  assert.deepEqual(parseFeed(xml).map((s) => s.name), ['Good']);
});

test('lastupdate is IST, whatever the machine zone', () => {
  assert.equal(istStamp('27-09-2026 05:00:00'), '2026-09-26T23:30:00.000Z');
  assert.throws(() => istStamp('2026-09-27 05:00'), FeedError);
});

test('not a feed, or no stations, is a FeedError', () => {
  assert.throws(() => parseFeed('<html>busy</html>'), FeedError);
  assert.throws(() => parseFeed('<AqIndex></AqIndex>'), FeedError);
});

test("pick finds our station by exact name within 100 m, and only if CPCB's AQI is the largest Avg", () => {
  const st = stationFor('in/kolkata/ballygunge');
  assert.equal(pick(parseFeed(FEED_XML), st).aqi, 38);
  const moved = parseFeed(one(ST('Ballygunge, Kolkata - WBPCB', '22.5400', '88.3638022'), POLS + '<Air_Quality_Index Value="38" Predominant_Parameter="PM10"/>'));
  assert.equal(pick(moved, st), null, '370 m away is not our station');
  const odd = parseFeed(one(ST(), POLS + '<Air_Quality_Index Value="99" Predominant_Parameter="PM10"/>'));
  assert.equal(pick(odd, st), null, 'an AQI that is not the largest Avg means the fields changed meaning');
  const wrongLead = parseFeed(one(ST(), POLS + '<Air_Quality_Index Value="38" Predominant_Parameter="NO2"/>'));
  assert.equal(pick(wrongLead, st), null, 'the predominant pollutant must be the one holding the largest Avg');
  assert.equal(pick(parseFeed(one(ST('Other'), POLS)), st), null);
});

import { FEED_MAX_BYTES, fetchFeed } from '../../src/lib/aqi/cpcb-feed.ts';

test('fetchFeed sends an identifying User-Agent and parses the body', async () => {
  let ua = '';
  const feed = await fetchFeed({ fetch: async (u, init) => { ua = init.headers['User-Agent']; return new Response(FEED_XML); } });
  assert.match(ua, /^delta-climate-research\//);
  assert.equal(feed.length, 481);
});

test('fetchFeed failures are FeedErrors: non-OK, oversize, network, timeout', async () => {
  await assert.rejects(fetchFeed({ fetch: async () => new Response('x', { status: 502 }) }), FeedError);
  await assert.rejects(fetchFeed({ fetch: async () => new Response(FEED_XML + ' '.repeat(FEED_MAX_BYTES)) }), { name: 'FeedError', message: 'CPCB feed too large' });
  await assert.rejects(fetchFeed({ fetch: async () => new Response(FEED_XML, { headers: { 'content-length': String(FEED_MAX_BYTES + 1) } }) }), { name: 'FeedError', message: 'CPCB feed too large' });
  await assert.rejects(fetchFeed({ fetch: async () => { throw new TypeError('fetch failed'); } }), FeedError);
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(fetchFeed({ signal: ctl.signal, fetch: async (_u, init) => { init.signal.throwIfAborted(); return new Response(FEED_XML); } }), FeedError);
});

import { currentFromFeed } from '../../src/lib/aqi/cpcb-feed.ts';

const B = 'in/kolkata/ballygunge', stB = stationFor(B);
const at = (iso) => new Date(iso);
const bFeed = () => pick(parseFeed(FEED_XML), stB); // published 2026-09-26T23:30Z

test('≤ 2 h after publication is live, origin cpcb, with CPCB source', () => {
  const c = currentFromFeed(bFeed(), B, stB, at('2026-09-27T01:30:00Z'));
  assert.equal(c.state, 'live');
  assert.deepEqual({ o: c.result.origin, aqi: c.result.aqi, cat: c.result.category, dom: c.result.dominant, w: c.result.window_h }, { o: 'cpcb', aqi: 38, cat: 'good', dom: 'pm10', w: 24 });
  assert.equal(c.observed_at, '2026-09-26T23:30:00.000Z');
  assert.equal(c.source.via, 'CPCB');
  assert.equal(c.schema, 2);
});

test('2 h + 1 min is stale with its age; 7 days + 1 min falls back (null)', () => {
  const s = currentFromFeed(bFeed(), B, stB, at('2026-09-27T01:31:00Z'));
  assert.deepEqual({ st: s.state, age: s.age_h }, { st: 'stale', age: 2 });
  assert.equal(currentFromFeed(bFeed(), B, stB, at('2026-10-03T23:31:00Z')), null);
});

test('CO or O3 leading means an 8-hour window', () => {
  const f = { ...bFeed(), dominant: 'o3' };
  assert.equal(currentFromFeed(f, B, stB, at('2026-09-27T00:00:00Z')).result.window_h, 8);
});

test('a blank AQI is insufficient_data (origin cpcb) when fresh, unavailable no_valid_aqi when stale', () => {
  const f = { ...bFeed(), aqi: null, dominant: null, subindices: bFeed().subindices.map((q) => (q.parameter.startsWith('pm') ? { ...q, avg: null } : q)) };
  const fresh = currentFromFeed(f, B, stB, at('2026-09-27T00:00:00Z'));
  assert.equal(fresh.state, 'insufficient_data');
  assert.equal(fresh.origin, 'cpcb');
  assert.deepEqual(fresh.reasons, ['No valid PM2.5 or PM10 reading']);
  const stale = currentFromFeed(f, B, stB, at('2026-09-27T05:00:00Z'));
  assert.deepEqual({ st: stale.state, r: stale.reason, at: stale.last_observed_at }, { st: 'unavailable', r: 'no_valid_aqi', at: '2026-09-26T23:30:00.000Z' });
});

test('a publication stamped more than 15 min in the future is not trusted (null)', () => {
  assert.equal(currentFromFeed(bFeed(), B, stB, at('2026-09-26T23:00:00Z')), null);
});

/* ---- Audit I2: the parser is linear. Every hostile body up to the 2 MB cap parses or throws in under 200 ms. ---- */

const HOSTILE_MS = 200;
const HEAD = '<?xml version="1.0"?><AqIndex><Country id="India"><State id="X"><City id="Y">';
const TAIL = '</City></State></Country></AqIndex>';
const fill = (unit, room) => unit.repeat(Math.max(0, Math.floor(room / unit.length)));
const timed = (xml) => {
  assert.ok(xml.length >= 1_900_000 && xml.length <= FEED_MAX_BYTES, `a ${xml.length}-byte body is not near the cap`);
  const t = performance.now();
  try { parseFeed(xml); } catch (e) { assert.ok(e instanceof FeedError, `threw ${e}`); }
  return performance.now() - t;
};

test('the real capture parses exactly as it did before the linear rewrite (481 stations, deep-equal)', () => {
  const golden = JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.parsed.json.gz', import.meta.url))).toString('utf8'));
  assert.deepEqual(parseFeed(FEED_XML), golden);
});

test('I2: a 2 MB opening tag with no "=" in it parses or throws in under 200 ms', () => {
  const ms = timed(HEAD + '<Station ' + 'a'.repeat(FEED_MAX_BYTES - HEAD.length - TAIL.length - 30) + '></Station>' + TAIL);
  assert.ok(ms < HOSTILE_MS, `${ms.toFixed(0)} ms`);
});

test('I2: 2 MB of unclosed <Station> elements parses or throws in under 200 ms', () => {
  const u = '<Station id="S" lastupdate="27-09-2026 05:00:00" latitude="22.5" longitude="88.3">';
  const ms = timed(HEAD + fill(u, FEED_MAX_BYTES - HEAD.length - TAIL.length) + TAIL);
  assert.ok(ms < HOSTILE_MS, `${ms.toFixed(0)} ms`);
});

test('I2: 2 MB of unterminated <Pollutant_Index> tags inside one station parses or throws in under 200 ms', () => {
  const open = '<Station id="S" lastupdate="27-09-2026 05:00:00" latitude="22.5" longitude="88.3">', close = '</Station>';
  const junk = fill('<Pollutant_Index id' + 'x'.repeat(40) + ' ', FEED_MAX_BYTES - HEAD.length - TAIL.length - open.length - close.length - 2);
  /* No ">" at all, and one distant "/>" that every unterminated tag would reach: both must stay linear. */
  for (const body of [junk, junk + '/>']) {
    const ms = timed(HEAD + open + body + close + TAIL);
    assert.ok(ms < HOSTILE_MS, `${ms.toFixed(0)} ms (${body.endsWith('/>') ? 'with' : 'without'} a closing "/>")`);
  }
});
