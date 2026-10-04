// tests/unit/aqi-city.test.mjs
// The city-wide AQI: CPCB's city method (mean of the city's valid stations in one snapshot).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { handle } from '../../api/air-quality.ts';
import { cityAqi, cityFor, MIN_CITY_STATIONS } from '../../src/lib/aqi/city.ts';
import { parseFeed } from '../../src/lib/aqi/cpcb-feed.ts';
import { LATEST_PATH, memoryStore } from '../../src/lib/aqi/relay-store.ts';
import { isAirPayload, isCity } from '../../src/lib/aqi/valid.ts';
import { cardHtml, loadAir } from '../../src/scripts/climate-engine/air/air-panel.ts';

const FEED_GZ = readFileSync(new URL('../fixtures/aqi/cpcb-feed-2026-09-27T0500IST.xml.gz', import.meta.url));
const FEED_XML = gunzipSync(FEED_GZ).toString('utf8');
const KOLKATA = cityFor('in/kolkata/ballygunge');

/* BY HAND, from the fixture's <City id="Kolkata"> (West Bengal) block, 27-09-2026 05:00 IST:
   Rabindra Bharati University 59, Fort William 46, Jadavpur 46, Ballygunge 38, Victoria 45,
   Rabindra Sarobar 33, Bidhannagar 35. Sum 302, 7 stations, 302 / 7 = 43.14 → 43, Good (0–50). */
const BY_HAND = [
  ['Rabindra Bharati University, Kolkata - WBPCB', 59], ['Fort William, Kolkata - WBPCB', 46], ['Jadavpur, Kolkata - WBPCB', 46],
  ['Ballygunge, Kolkata - WBPCB', 38], ['Victoria, Kolkata - WBPCB', 45], ['Rabindra Sarobar, Kolkata - WBPCB', 33], ['Bidhannagar, Kolkata - WBPCB', 35],
];

test('parseFeed carries CPCB\'s own State/City grouping: Howrah is its own city, and the two Byrnihats stay apart', () => {
  const feed = parseFeed(FEED_XML);
  const kol = feed.filter((s) => s.state === 'West Bengal' && s.city === 'Kolkata').map((s) => s.name);
  assert.deepEqual(kol, BY_HAND.map(([n]) => n));
  assert.equal(feed.filter((s) => s.city === 'Howrah').length, 5);
  assert.ok(feed.filter((s) => s.city === 'Howrah').every((s) => s.state === 'West Bengal'));
  const byr = feed.filter((s) => s.city === 'Byrnihat');
  assert.deepEqual([...new Set(byr.map((s) => s.state))].sort(), ['Assam', 'Meghalaya']);
  assert.equal(feed.find((s) => s.name === 'SVSPA Campus, Barrackpore - WBPCB').city, 'Barrackpore');
  assert.ok(feed.every((s) => s.state !== null && s.city !== null), 'every station in the capture sits in a state and a city');
});

test('cityAqi on the fixture: Kolkata is 43 Good over 7 stations (hand-computed), Howrah not folded in', () => {
  const c = cityAqi(parseFeed(FEED_XML), KOLKATA);
  assert.deepEqual(c, {
    name: 'Kolkata', aqi: 43, category: 'good', stations: 7,
    members: BY_HAND.map(([name, aqi]) => ({ name, aqi })), observed_at: '2026-09-26T23:30:00.000Z',
  });
  assert.ok(!c.members.some((m) => m.name.includes('Howrah')));
});

test('cityAqi: fewer than 2 valid stations is no city figure; a null AQI or an older snapshot does not count', () => {
  assert.equal(MIN_CITY_STATIONS, 2);
  const feed = parseFeed(FEED_XML).filter((s) => s.city === 'Kolkata');
  const onlyOne = feed.map((s, i) => (i === 0 ? s : { ...s, aqi: null, dominant: null }));
  assert.equal(cityAqi(onlyOne, KOLKATA), null, 'one valid station is not a city');
  const old = feed.map((s, i) => (i === 0 ? s : { ...s, published_at: '2026-09-26T20:30:00.000Z' }));
  assert.equal(cityAqi(old, KOLKATA), null, 'six stations from an older hour are not this snapshot');
  const two = feed.map((s, i) => (i < 2 ? s : { ...s, aqi: null, dominant: null }));
  assert.deepEqual({ aqi: cityAqi(two, KOLKATA).aqi, n: cityAqi(two, KOLKATA).stations }, { aqi: 53, n: 2 }, '(59 + 46) / 2 = 52.5 → 53');
  assert.equal(cityFor('in/bengaluru/x'), null, 'Bengaluru has no Air card, so no city');
});

const CNOW = new Date('2026-09-27T00:30:00Z');
const rows = (sensor) => ({ results: Array.from({ length: 48 }, (_, i) => ({ value: sensor === 12236007 ? 0.5 : 20,
  period: { datetimeTo: { utc: new Date(Date.parse('2026-09-24T13:00:00Z') - i * 3_600_000).toISOString() } } })) });
const openaq = async (u) => new Response(JSON.stringify(rows(Number(/sensors\/(\d+)\//.exec(String(u))[1]))));
const get = async (now) => {
  const store = memoryStore(); store.files.set(LATEST_PATH, FEED_GZ);
  const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } };
  const orig = console.error; console.error = () => {};
  try {
    await handle({ method: 'GET', query: { area: 'in/kolkata/ballygunge' } }, r, { key: 'k', fetch: openaq, now: () => now, cache: new Map(), inflight: new Map(),
      feedCache: { entry: null, inflight: null }, cpcbFeed: true, source: 'relay', store });
  } finally { console.error = orig; }
  return r;
};

test('/api/air-quality: a live relay carries the city object beside the ward figure, and it validates', async () => {
  const r = await get(CNOW);
  assert.equal(r.body.current.result.aqi, 38);
  assert.deepEqual({ name: r.body.city.name, aqi: r.body.city.aqi, category: r.body.city.category, stations: r.body.city.stations },
    { name: 'Kolkata', aqi: 43, category: 'good', stations: 7 });
  assert.ok(isAirPayload(r.body));
});

test('/api/air-quality: on the OpenAQ fallback (relay older than 2 h) there is no city object', async () => {
  const r = await get(new Date('2026-09-27T01:31:00Z'));
  assert.equal(r.body.current.result.origin, 'obos');
  assert.equal('city' in r.body, false, 'sources are never mixed');
});

test('validator: city is optional and judged apart; a malformed one fails isCity but never the payload', async () => {
  const { body } = await get(CNOW);
  const { city, ...without } = body;
  assert.ok(isCity(city));
  assert.ok(isAirPayload(without), 'an older server sends no city');
  for (const bad of [{ ...city, stations: 1, members: city.members.slice(0, 1) }, { ...city, aqi: '43' }, { ...city, category: 'red' },
    { ...city, stations: 6 }, { ...city, members: [...city.members.slice(1), { name: 1, aqi: 2 }] }, null, 'x']) {
    assert.equal(isCity(bad), false, JSON.stringify(bad)?.slice(0, 60));
    assert.ok(isAirPayload({ ...without, city: bad }), 'a bad city never invalidates current/history');
  }
});

test('a payload with a malformed city still loads and paints the ward AQI, with no city line', async () => {
  const { body } = await get(CNOW);
  const bad = { ...body, city: { ...body.city, aqi: 'NaN', members: 'oops' } };
  const paint = await loadAir('in/kolkata/ballygunge', 'Ward 68', { fetch: async () => ({ ok: true, json: async () => bad }),
    signal: new AbortController().signal, isCurrent: () => true, now: CNOW });
  assert.match(paint.block, /<span class="num"[^>]*>38<\/span>/, 'the ward reading is painted');
  assert.doesNotMatch(paint.block, /aq-city|entire city/);
  assert.doesNotMatch(paint.pane, /aq-city|entire city/);
  assert.doesNotMatch(paint.block, /could not be loaded/);
});

test('the card prints the city line under the US line, with the station list in its note; a demoted card drops it', async () => {
  const { body } = await get(CNOW);
  const html = cardHtml(body, 'Ward 68', CNOW);
  assert.match(html, /class="aq-city"/);
  assert.match(html, /Kolkata \(entire city\) · 43 Good · <span style="white-space:nowrap">7 stations/);
  assert.match(html, /Average of all 7 CPCB stations reporting in Kolkata right now \(CPCB&#39;s city method\)\. The big number above is this ward&#39;s nearest station\./);
  assert.match(html, /<li><span>Rabindra Bharati University<\/span><span>59<\/span><\/li>/);
  assert.ok(html.indexOf('aq-city') > html.indexOf('class="aq-us"'), 'under the US line');
  assert.doesNotMatch(cardHtml(body, 'Ward 68', new Date('2026-09-27T02:00:00Z')), /aq-city/, 'stale by the viewer\'s clock: no city line');
  assert.doesNotMatch(cardHtml({ ...body, city: undefined }, 'Ward 68', CNOW), /aq-city/);
});
