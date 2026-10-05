// tests/unit/aqi-bengaluru.test.mjs
// Bengaluru's three wards on the Air card (founder, 2026-10-05): the station mapping from
// coordinates, the city-wide mean by hand, and the API answering for in/bengaluru/*.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import test from 'node:test';
import { handle } from '../../api/air-quality.ts';
import { allWards } from '../../src/data/cities.ts';
import { cityAqi, cityFor } from '../../src/lib/aqi/city.ts';
import { currentFromFeed, parseFeed, pick, pickServed } from '../../src/lib/aqi/cpcb-feed.ts';
import { hourOf, TRACKED } from '../../src/lib/aqi/hourly-history.ts';
import { HISTORY_PATH, LATEST_PATH, memoryStore } from '../../src/lib/aqi/relay-store.ts';
import { AREAS, candidatesFor, FALLBACKS, isAirArea, isAirCity, MAX_SERVE_M, stationFor } from '../../src/lib/aqi/stations.ts';
import { isAirPayload } from '../../src/lib/aqi/valid.ts';
import { cardHtml, paneHtml, statusText } from '../../src/scripts/climate-engine/air/air-panel.ts';

/* CPCB's feed as fetched from a home connection, 05-10-2026 02:00 IST (2026-10-04T20:30Z). */
const FEED_GZ = readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-10-05T0200IST.xml.gz', import.meta.url));
const XML = gunzipSync(FEED_GZ).toString('utf8');
const FEED = parseFeed(XML);
const NOW = new Date('2026-10-04T21:00:00Z');
/* The same, 05-10-2026 18:00 IST (12:30Z): Kasturi Nagar ABSENT, the outage that blanked two wards. */
const LIVE_GZ = readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-10-05T1800IST.xml.gz', import.meta.url));
const LIVE = parseFeed(gunzipSync(LIVE_GZ).toString('utf8'));
const LIVE_NOW = new Date('2026-10-05T12:45:00Z');
/* The 02:00 feed edited: one station's element removed, or the whole Bengaluru block. */
const without = (xml, name) => xml.replace(new RegExp(`<Station id="${name}"[\\s\\S]*?</Station>\\n?`), '');
const noBengaluru = (xml) => xml.replace(/<City id="Bengaluru">[\s\S]*?<\/City>/, '');
const gz = (xml) => gzipSync(Buffer.from(xml, 'utf8'));
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
    assert.match(st.placement, /^(in|at) .+ of /);
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

test('the hourly record tracks every rung of every ladder, each once, and reads them from the feed', () => {
  assert.equal(new Set(TRACKED).size, TRACKED.length, 'a station on several ladders is recorded once');
  /* Every rung is on the record, so a fallback has its own hours for NowCast. */
  const names = new Set(WARDS.flatMap((id) => candidatesFor(`in/bengaluru/${id}`).map((s) => s.cpcb_name)));
  for (const n of names) assert.ok(TRACKED.includes(n), `${n} is not recorded`);
  assert.equal(names.size, 8);
  assert.equal(TRACKED.length, names.size + 2, 'Bengaluru\'s eight plus Kolkata\'s two, nothing else');
  const h = hourOf(FEED);
  assert.deepEqual(h.stations['Hombegowda Nagar, Bengaluru - KSPCB'], { pm25: 33, pm10: 49 });
  assert.deepEqual(h.stations['Kasturi Nagar, Bengaluru - KSPCB'], { pm25: null, pm10: null });
  assert.ok(JSON.stringify(hourOf(LIVE)).length < 1200, 'one hour stays small');
});

/* THE LADDER, DERIVED: after the nearest monitor, every other Bengaluru station in either
   capture within 20 km (MAX_SERVE_M), less the two that never publish an AQI, nearest first,
   each at its own haversine distance, outside the window, and with a placement whose
   direction is the bearing's 16-point name (one point of slack). */
const NEVER_REPORT = ['Shivapura_Peenya, Bengaluru - KSPCB', 'Jigani, Bengaluru - KSPCB'];
const P16 = ['north', 'north-north-east', 'north-east', 'east-north-east', 'east', 'east-south-east', 'south-east', 'south-south-east',
  'south', 'south-south-west', 'south-west', 'west-south-west', 'west', 'west-north-west', 'north-west', 'north-north-west'];
const bearing = (a, b, c, d) => { const r = Math.PI / 180, y = Math.sin((d - b) * r) * Math.cos(c * r), x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos((d - b) * r); return (Math.atan2(y, x) / r + 360) % 360; };
test('each Bengaluru ward\'s ladder is every station in the feed, nearest first, at its true distance and direction', () => {
  const inFeed = new Map([...blr, ...LIVE.filter((s) => s.state === 'Karnataka' && s.city === 'Bengaluru')].map((s) => [s.name, s]));
  assert.equal(inFeed.size, 10, 'both captures together hold ten Bengaluru stations');
  for (const id of WARDS) {
    const w = allWards().find((x) => x.id === id), ladder = candidatesFor(`in/bengaluru/${id}`);
    assert.equal(ladder[0], stationFor(`in/bengaluru/${id}`), 'the first rung is the ward\'s nearest monitor');
    const near = [...inFeed.values()].filter((f) => !NEVER_REPORT.includes(f.name) && havM(w.lat, w.lon, f.lat, f.lon) <= MAX_SERVE_M);
    assert.deepEqual(ladder.map((s) => s.cpcb_name).sort(), near.map((f) => f.name).sort(), `${id}: the ladder is not every Bengaluru station within 20 km`);
    for (const [i, st] of ladder.entries()) {
      const f = inFeed.get(st.cpcb_name);
      assert.ok(havM(st.lat, st.lon, f.lat, f.lon) <= 1, `${id}/${st.name}: not the feed's position`);
      assert.equal(st.distance_m, Math.round(havM(w.lat, w.lon, f.lat, f.lon)), `${id}/${st.name}: distance`);
      if (i > 0) assert.ok(st.distance_m >= ladder[i - 1].distance_m, `${id}: rung ${i} is nearer than rung ${i - 1}`);
      assert.equal(st.inside, 'outside_window');
      assert.equal(st.sensors, null);
      assert.ok(st.id.startsWith('cpcb:'));
      assert.equal(st.owner, st.cpcb_name.endsWith('- CPCB') ? 'Central Pollution Control Board' : 'Karnataka State Pollution Control Board');
      const dir = /, ([a-z-]+) of [A-Z]/.exec(st.placement)?.[1];
      const k = Math.round(bearing(w.lat, w.lon, st.lat, st.lon) / 22.5) % 16, j = P16.indexOf(dir);
      assert.ok(j >= 0 && Math.min((j - k + 16) % 16, (k - j + 16) % 16) <= 1, `${id}/${st.name}: "${dir}" is not the bearing's ${P16[k]}`);
      assert.match(st.placement, new RegExp(` of ${id === 'mg-road' ? 'MG Road' : id[0].toUpperCase() + id.slice(1)}$`));
    }
  }
});

test('the 20 km cap: lengths, and no listed station past it', () => {
  assert.equal(MAX_SERVE_M, 20_000);
  assert.deepEqual(WARDS.map((id) => candidatesFor(`in/bengaluru/${id}`).length), [8, 8, 6]);
  for (const id of WARDS) for (const st of candidatesFor(`in/bengaluru/${id}`)) assert.ok(st.distance_m <= MAX_SERVE_M, `${id}/${st.name}`);
  assert.deepEqual(candidatesFor('in/bengaluru/whitefield').map((s) => s.distance_m), [10037, 14966, 17673, 17917, 18696, 18965]);
});

/* THE CAP AT THE BOUNDARY, enforced at serve time too: the same station at exactly 20,000 m is
   served; at 20,001 m it is skipped, as if it were not in the feed. */
test('pickServed: a rung at exactly 20,000 m is served, at 20,001 m it is never served', () => {
  const silk = candidatesFor('in/bengaluru/whitefield')[1];
  assert.equal(silk.name, 'Silk Board, Bengaluru');
  const at = (d) => pickServed(LIVE, [stationFor('in/bengaluru/whitefield'), { ...silk, distance_m: d }]);
  assert.equal(at(MAX_SERVE_M)?.st.name, 'Silk Board, Bengaluru');
  assert.equal(at(MAX_SERVE_M)?.fallback, true);
  assert.equal(at(MAX_SERVE_M + 1), null, 'past 20 km nothing is served');
});

test('Whitefield with nothing reporting within 20 km is station_not_reporting, not a far station', async () => {
  /* Keep only Peenya (28.4 km) and Bapuji Nagar (22.9 km) in the Bengaluru block: both report, both are past the cap. */
  const keep = ['Peenya, Bengaluru - CPCB', 'Bapuji Nagar, Bengaluru - KSPCB'];
  let xml = XML;
  for (const s of blr) if (!keep.includes(s.name)) xml = without(xml, s.name);
  assert.deepEqual(parseFeed(xml).filter((s) => s.city === 'Bengaluru').map((s) => s.name).sort(), [...keep].sort());
  const w = (await call('in/bengaluru/whitefield', NOW, { feed: gz(xml) })).body.current;
  assert.deepEqual({ s: w.state, why: w.reason, n: w.station.name }, { s: 'unavailable', why: 'station_not_reporting', n: 'Kasturi Nagar, Bengaluru' });
  /* The same feed still serves MG Road, whose Bapuji Nagar is 7.3 km away. */
  const m = (await call('in/bengaluru/mg-road', NOW, { feed: gz(xml) })).body.current;
  assert.deepEqual({ s: m.state, n: m.station.name, d: m.station.distance_m }, { s: 'live', n: 'Bapuji Nagar, Bengaluru', d: 7335 });
});

test('Kolkata has no ladder: each area is its one station, exactly as before', () => {
  assert.deepEqual(Object.keys(FALLBACKS).sort(), ['in/bengaluru/indiranagar', 'in/bengaluru/mg-road', 'in/bengaluru/whitefield']);
  assert.deepEqual(candidatesFor('in/kolkata/ballygunge'), [stationFor('in/kolkata/ballygunge')]);
  assert.deepEqual(candidatesFor('in/kolkata/barrackpore'), [stationFor('in/kolkata/barrackpore')]);
  assert.deepEqual(candidatesFor('in/kolkata/baruipur'), []);
});

const call = async (area, now, { store = memoryStore(), cpcbFeed = true, feed = FEED_GZ } = {}) => {
  if (!store.files.has(LATEST_PATH)) store.files.set(LATEST_PATH, feed);
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

test('MG Road at 02:00: its nearest station published no AQI, so the nearest REPORTING one is served, labelled so, at its own distance', async () => {
  const r = await call('in/bengaluru/mg-road', NOW);
  assert.equal(r.code, 200);
  assert.ok(isAirPayload(r.body));
  const c = r.body.current;
  assert.equal(c.state, 'live');
  assert.deepEqual({ name: c.station.name, d: c.station.distance_m, fallback: c.station.fallback, aqi: c.result.aqi },
    { name: 'Hebbal, Bengaluru', d: 6247, fallback: true, aqi: 90 });
  assert.equal(r.body.city.aqi, 87, 'the city mean rides with a live fallback, from the same snapshot');
  const html = cardHtml(r.body, 'MG Road', NOW);
  assert.match(html, /Hebbal, Bengaluru<\/b> · nearest reporting KSPCB monitor · 6\.2 km from the MG Road centre, in Hebbal, north-north-west of MG Road/);
  assert.doesNotMatch(html, /nearest official/);
  assert.match(html, /this ward&#39;s nearest reporting station/);
  assert.match(paneHtml(r.body, 'MG Road', NOW), /the nearer ones published no AQI this hour; this is the nearest one reporting, 6\.2 km away/);
});

/* THE OUTAGE OF 5 OCT 18:00 IST, from the real capture: Kasturi Nagar is not in the feed. */
test('18:00 IST, Kasturi Nagar absent: Indiranagar and Whitefield get the nearest reporting monitor; MG Road its own', async () => {
  assert.equal(LIVE.some((s) => s.name.startsWith('Kasturi Nagar')), false, 'the capture is the outage');
  const want = {
    indiranagar: ['Hombegowda Nagar, Bengaluru', 7059, true, 77, /nearest reporting KSPCB monitor · 7\.1 km from the Indiranagar centre, in Hombegowda Nagar, south-west of Indiranagar/],
    whitefield: ['Silk Board, Bengaluru', 14966, true, 119, /nearest reporting KSPCB monitor · 15\.0 km from the Whitefield centre, at Silk Board, west-south-west of Whitefield/],
    'mg-road': ['Hombegowda Nagar, Bengaluru', 4341, undefined, 77, /nearest official KSPCB monitor · 4\.3 km from the MG Road centre/],
  };
  for (const [id, [name, d, fallback, aqi, line]] of Object.entries(want)) {
    const r = await call(`in/bengaluru/${id}`, LIVE_NOW, { feed: LIVE_GZ });
    assert.ok(isAirPayload(r.body));
    const c = r.body.current;
    assert.equal(c.state, 'live', id);
    assert.deepEqual({ name: c.station.name, d: c.station.distance_m, fallback: c.station.fallback, aqi: c.result.aqi }, { name, d, fallback, aqi }, id);
    /* The distance on the card is the SERVED station's, from the payload, not the ward's nearest. */
    const place = { indiranagar: 'Indiranagar', whitefield: 'Whitefield', 'mg-road': 'MG Road' }[id];
    assert.match(cardHtml(r.body, place, LIVE_NOW), line, id);
    assert.ok(cardHtml(r.body, place, LIVE_NOW).includes(`${(d / 1000).toFixed(1)} km`), id);
    assert.equal(r.body.city.name, 'Bengaluru');
  }
});

test('02:00 IST with Kasturi Nagar removed: Indiranagar skips Hombegowda Nagar (no AQI) to Silk Board; Whitefield to Silk Board', async () => {
  const feed = gz(without(XML, 'Kasturi Nagar, Bengaluru - KSPCB'));
  const i = (await call('in/bengaluru/indiranagar', NOW, { feed })).body.current;
  assert.deepEqual({ s: i.state, n: i.station.name, d: i.station.distance_m, f: i.station.fallback, aqi: i.result.aqi },
    { s: 'live', n: 'Silk Board, Bengaluru', d: 7063, f: true, aqi: 126 });
  const w = (await call('in/bengaluru/whitefield', NOW, { feed })).body.current;
  assert.deepEqual({ s: w.state, n: w.station.name, d: w.station.distance_m, f: w.station.fallback, aqi: w.result.aqi },
    { s: 'live', n: 'Silk Board, Bengaluru', d: 14966, f: true, aqi: 126 });
});

test('no rung of the ladder in a current feed is station_not_reporting (not upstream_error), with the nearest monitor named', async () => {
  for (const id of WARDS) {
    const r = await call(`in/bengaluru/${id}`, NOW, { feed: gz(noBengaluru(XML)) });
    assert.equal(r.code, 200);
    assert.ok(isAirPayload(r.body));
    const c = r.body.current;
    assert.deepEqual({ s: c.state, why: c.reason, at: c.last_observed_at }, { s: 'unavailable', why: 'station_not_reporting', at: null });
    assert.equal(c.station.name, stationFor(`in/bengaluru/${id}`).name);
    assert.equal(c.station.fallback, undefined);
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.equal(r.openaqCalls, 0);
    const html = cardHtml(r.body, id, NOW);
    assert.match(html, /None of the nearby monitors is reporting to CPCB this hour/);
    assert.doesNotMatch(html, /could not be loaded/);
    assert.match(statusText(r.body, 'X', NOW), /no nearby monitor is reporting this hour/);
  }
});

test('every rung present but none with an AQI: the nearest present monitor shows CPCB\'s own no-AQI state', async () => {
  const block = /<City id="Bengaluru">[\s\S]*?<\/City>/.exec(XML)[0];
  const feed = gz(XML.replace(block, block.replace(/<Air_Quality_Index Value="\d+" Predominant_Parameter="[^"]*"\/>/g, '<Air_Quality_Index Value="" Predominant_Parameter=""/>')));
  const c = (await call('in/bengaluru/indiranagar', NOW, { feed })).body.current;
  assert.deepEqual({ s: c.state, o: c.origin, n: c.station.name, f: c.station.fallback }, { s: 'insufficient_data', o: 'cpcb', n: 'Kasturi Nagar, Bengaluru', f: undefined });
});

/* NOWCAST FOLLOWS THE SERVED STATION: with the served fallback's previous two hours on record,
   its NowCast appears; with only Kasturi Nagar's on record (the old TRACKED), none is invented. */
test('US NowCast follows the served station: a fallback with its own hours on record gets one; none is invented', async () => {
  const at = (h) => new Date(Date.parse(LIVE[0].published_at) - h * 3_600_000).toISOString();
  const shifted = (h) => ({ ...hourOf(LIVE), at: at(h) });
  const withHistory = (hours) => { const store = memoryStore(); store.files.set(HISTORY_PATH, new TextEncoder().encode(JSON.stringify({ v: 1, hours }))); return store; };
  const r = await call('in/bengaluru/indiranagar', LIVE_NOW, { feed: LIVE_GZ, store: withHistory([shifted(2), shifted(1)]) });
  assert.equal(r.body.current.station.name, 'Hombegowda Nagar, Bengaluru');
  assert.ok(r.body.us_nowcast, 'the fallback station has its NowCast');
  assert.ok(r.body.us_nowcast.hours_used >= 2);
  const only = (h) => ({ at: at(h), stations: { 'Kasturi Nagar, Bengaluru - KSPCB': { pm25: 50, pm10: 60 } } });
  const n = await call('in/bengaluru/indiranagar', LIVE_NOW, { feed: LIVE_GZ, store: withHistory([only(2), only(1)]) });
  assert.equal('us_nowcast' in n.body, false, 'one hour on record is not enough: no NowCast is made up');
});

/* KOLKATA UNCHANGED: on the same real feeds, the handler's CPCB answer for Ballygunge and
   Barrackpore is exactly `pick` + `currentFromFeed` for their one station, the pre-ladder path. */
test('Kolkata on the ladder code is the one-station path, byte for byte', async () => {
  for (const [area, feed, xmlGz, now] of [['in/kolkata/ballygunge', FEED, FEED_GZ, NOW], ['in/kolkata/barrackpore', FEED, FEED_GZ, NOW],
    ['in/kolkata/ballygunge', LIVE, LIVE_GZ, LIVE_NOW], ['in/kolkata/barrackpore', LIVE, LIVE_GZ, LIVE_NOW]]) {
    const st = stationFor(area), f = pick(feed, st);
    const r = await call(area, now, { feed: xmlGz });
    const expected = f ? currentFromFeed(f, area, st, now) : null;
    if (expected) assert.deepEqual(r.body.current, expected, area);
    else assert.notEqual(r.body.current.station?.fallback, true, area);
    assert.equal(JSON.stringify(r.body).includes('"fallback"'), false, `${area}: no Kolkata answer carries a fallback flag`);
  }
  const b = await call('in/kolkata/baruipur', NOW);
  assert.equal(b.body.current.state, 'no_station');
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
