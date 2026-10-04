// tests/unit/aqi-bengaluru.test.mjs
// Bengaluru's three wards on the Air card (founder, 2026-10-05): the station mapping from
// coordinates, the city-wide mean by hand, and the API answering for in/bengaluru/*.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { handle } from '../../api/air-quality.ts';
import { allWards } from '../../src/data/cities.ts';
import { cityAqi, cityFor } from '../../src/lib/aqi/city.ts';
import { parseFeed } from '../../src/lib/aqi/cpcb-feed.ts';
import { hourOf, TRACKED } from '../../src/lib/aqi/hourly-history.ts';
import { LATEST_PATH, memoryStore } from '../../src/lib/aqi/relay-store.ts';
import { AREAS, isAirArea, isAirCity, stationFor } from '../../src/lib/aqi/stations.ts';
import { isAirPayload } from '../../src/lib/aqi/valid.ts';
import { cardHtml, paneHtml } from '../../src/scripts/climate-engine/air/air-panel.ts';

/* CPCB's feed as fetched from a home connection, 05-10-2026 02:00 IST (2026-10-04T20:30Z). */
const FEED_GZ = readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-10-05T0200IST.xml.gz', import.meta.url));
const FEED = parseFeed(gunzipSync(FEED_GZ).toString('utf8'));
const NOW = new Date('2026-10-04T21:00:00Z');
const WARDS = ['indiranagar', 'mg-road', 'whitefield'];
const havM = (a, b, c, d) => { const R = 6_371_008.8, r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const blr = FEED.filter((s) => s.state === 'Karnataka' && s.city === 'Bengaluru');

test('the fixture holds the eight Bengaluru stations, grouped by CPCB under Karnataka / Bengaluru', () => {
  assert.deepEqual(blr.map((s) => s.name).sort(), [
    'BTM Layout, Bengaluru - CPCB', 'Bapuji Nagar, Bengaluru - KSPCB', 'Hebbal, Bengaluru - KSPCB', 'Hombegowda Nagar, Bengaluru - KSPCB',
    'Jayanagar 5th Block, Bengaluru - KSPCB', 'Kasturi Nagar, Bengaluru - KSPCB', 'Peenya, Bengaluru - CPCB', 'Silk Board, Bengaluru - KSPCB',
  ]);
});

/* THE MAPPING, DERIVED: for each ward, the station in the feed nearest the ward centre in
   src/data/cities.ts (any station present, AQI or not), at the distance its coordinates give. */
test('each Bengaluru ward is mapped to the nearest station in the feed, at the haversine distance, labelled outside its window', () => {
  const expect = { indiranagar: ['Kasturi Nagar, Bengaluru - KSPCB', 3803], 'mg-road': ['Hombegowda Nagar, Bengaluru - KSPCB', 4341], whitefield: ['Kasturi Nagar, Bengaluru - KSPCB', 10037] };
  for (const id of WARDS) {
    const w = allWards().find((x) => x.id === id);
    const nearest = [...blr].sort((a, b) => havM(w.lat, w.lon, a.lat, a.lon) - havM(w.lat, w.lon, b.lat, b.lon))[0];
    const st = stationFor(`in/bengaluru/${id}`);
    assert.equal(st.cpcb_name, nearest.name, `${id}: registry disagrees with the feed's nearest station`);
    assert.equal(st.cpcb_name, expect[id][0]);
    assert.ok(havM(st.lat, st.lon, nearest.lat, nearest.lon) <= 1, `${id}: registry position is not the feed's`);
    assert.equal(st.distance_m, Math.round(havM(w.lat, w.lon, nearest.lat, nearest.lon)));
    assert.equal(st.distance_m, expect[id][1]);
    assert.equal(st.inside, 'outside_window');
    assert.match(st.placement, /^in .+ of /);
    assert.equal(st.sensors, null, 'no verified OpenAQ ids for Bengaluru');
    assert.ok(st.id.startsWith('cpcb:'));
    assert.equal(st.owner, 'Karnataka State Pollution Control Board');
  }
});

test('the gates open for Bengaluru and stay shut for Dubai', () => {
  for (const id of WARDS) { assert.ok(isAirArea(`in/bengaluru/${id}`)); assert.ok(isAirCity(`in/bengaluru/${id}`)); }
  assert.ok(isAirCity('in/kolkata/baruipur'));
  assert.equal(isAirCity('ae/dubai/creek'), false);
  assert.equal(isAirCity('in/bengaluru-x/y'), false, 'a prefix match is by whole segment');
  assert.equal(isAirArea('in/bengaluru/nowhere'), false);
});

/* BY HAND, from the fixture's <City id="Bengaluru"> block at 02:00 IST: Jayanagar 5th Block 119,
   Bapuji Nagar 84, Peenya 37, BTM Layout 88, Silk Board 126, Hebbal 90, Kasturi Nagar 68;
   Hombegowda Nagar published no AQI. Sum 612, 7 stations, 612 / 7 = 87.43 → 87, Satisfactory (51–100). */
test('cityAqi: Bengaluru is 87 Satisfactory over 7 of its 8 stations (hand-computed)', () => {
  const ref = cityFor('in/bengaluru/indiranagar');
  assert.deepEqual(ref, { name: 'Bengaluru', cpcb_state: 'Karnataka', cpcb_city: 'Bengaluru' });
  const c = cityAqi(FEED, ref);
  assert.deepEqual({ aqi: c.aqi, category: c.category, stations: c.stations, observed_at: c.observed_at },
    { aqi: 87, category: 'satisfactory', stations: 7, observed_at: '2026-10-04T20:30:00.000Z' });
  assert.ok(!c.members.some((m) => m.name.startsWith('Hombegowda')));
});

test('the hourly record tracks the Bengaluru stations, each once, and reads them from the feed', () => {
  assert.equal(new Set(TRACKED).size, TRACKED.length, 'Kasturi Nagar serves two wards but is recorded once');
  assert.ok(TRACKED.includes('Kasturi Nagar, Bengaluru - KSPCB') && TRACKED.includes('Hombegowda Nagar, Bengaluru - KSPCB'));
  const h = hourOf(FEED);
  assert.deepEqual(h.stations['Hombegowda Nagar, Bengaluru - KSPCB'], { pm25: 33, pm10: 49 });
  assert.deepEqual(h.stations['Kasturi Nagar, Bengaluru - KSPCB'], { pm25: null, pm10: null });
  assert.ok(JSON.stringify(h).length < 600, 'one hour stays small');
});

const call = async (area, now, { store = memoryStore(), cpcbFeed = true } = {}) => {
  if (!store.files.has(LATEST_PATH)) store.files.set(LATEST_PATH, FEED_GZ);
  let openaqCalls = 0;
  const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } };
  const orig = console.error; console.error = () => {};
  try {
    await handle({ method: 'GET', query: { area } }, r, { key: 'k', fetch: async () => { openaqCalls++; throw new Error('no OpenAQ for Bengaluru'); },
      now: () => now, cache: new Map(), inflight: new Map(), feedCache: { entry: null, inflight: null }, cpcbFeed, source: 'relay', store });
  } finally { console.error = orig; }
  return { ...r, openaqCalls };
};

test('/api/air-quality answers for in/bengaluru/indiranagar: CPCB live, Bengaluru city line, KSPCB via CPCB, no OpenAQ call', async () => {
  const r = await call('in/bengaluru/indiranagar', NOW);
  assert.equal(r.code, 200);
  assert.ok(isAirPayload(r.body));
  const c = r.body.current;
  assert.equal(c.state, 'live');
  assert.deepEqual(c.source, { owner: 'Karnataka State Pollution Control Board', via: 'CPCB', standard: 'CPCB National AQI' });
  assert.deepEqual({ aqi: c.result.aqi, origin: c.result.origin, dominant: c.result.dominant }, { aqi: 68, origin: 'cpcb', dominant: 'pm10' });
  assert.deepEqual({ inside: c.station.inside, d: c.station.distance_m }, { inside: 'outside_window', d: 3803 });
  assert.equal(r.body.city.aqi, 87);
  assert.equal(r.body.history, null);
  assert.equal(r.openaqCalls, 0);
  assert.match(r.headers['Cache-Control'], /s-maxage=600/, 'no history is coming, so the answer is whole');
  const html = cardHtml(r.body, 'Indiranagar', NOW);
  assert.match(html, /Kasturi Nagar, Bengaluru<\/b> · nearest official KSPCB monitor · 3\.8 km from the Indiranagar centre, in Kasturi Nagar, north-east of Indiranagar/);
  assert.match(html, /Bengaluru \(entire city\) · 87 Satisfactory · <span style="white-space:nowrap">7 stations/);
  const pane = paneHtml(r.body, 'Indiranagar', NOW);
  assert.match(pane, /No 30-day history for this station/);
  assert.doesNotMatch(pane, /History is loading/);
  assert.doesNotMatch(pane, /OpenAQ&#39;s copy|from OpenAQ's copy/);
});

test('MG Road: its nearest station published no AQI this hour, so the card shows CPCB\'s no-AQI state, not a neighbour', async () => {
  const r = await call('in/bengaluru/mg-road', NOW);
  assert.equal(r.code, 200);
  assert.equal(r.body.current.state, 'insufficient_data');
  assert.equal(r.body.current.origin, 'cpcb');
  assert.equal(r.body.current.station.name, 'Hombegowda Nagar, Bengaluru');
  assert.equal('city' in r.body, false);
  assert.match(cardHtml(r.body, 'MG Road', NOW), /CPCB published no AQI/);
});

test('Whitefield: Kasturi Nagar at 10.0 km, with the distance and placement on the card', async () => {
  const r = await call('in/bengaluru/whitefield', NOW);
  assert.equal(r.body.current.state, 'live');
  assert.match(cardHtml(r.body, 'Whitefield', NOW), /nearest official KSPCB monitor · 10\.0 km from the Whitefield centre, in Kasturi Nagar, west-north-west of Whitefield/);
});

test('a stale relay (or the feed off) is the honest unavailable state for Bengaluru, never an error or an OpenAQ figure', async () => {
  for (const r of [await call('in/bengaluru/indiranagar', new Date('2026-10-04T23:00:00Z')), await call('in/bengaluru/indiranagar', NOW, { cpcbFeed: false })]) {
    assert.equal(r.code, 200);
    assert.ok(isAirPayload(r.body));
    assert.equal(r.body.current.state, 'unavailable');
    assert.equal(r.body.current.reason, 'upstream_error');
    assert.equal(r.body.current.source.via, 'CPCB');
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.equal(r.openaqCalls, 0);
    assert.match(cardHtml(r.body, 'Indiranagar', NOW), /Not loaded[\s\S]*nearest official KSPCB monitor · 3\.8 km/);
  }
});

test('every Bengaluru station is registered, and Kolkata\'s areas are unchanged', () => {
  assert.deepEqual(Object.keys(AREAS).sort(), ['in/bengaluru/indiranagar', 'in/bengaluru/mg-road', 'in/bengaluru/whitefield',
    'in/kolkata/ballygunge', 'in/kolkata/barrackpore', 'in/kolkata/baruipur']);
});
