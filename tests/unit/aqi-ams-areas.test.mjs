import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { handle } from '../../api/air-quality.ts';
import { AMSTERDAM_SHEETS, AMSTERDAM_SHEET_IDS } from '../../src/data/sheets/amsterdam.ts';
import { AMSTERDAM_AREA_WARDS } from '../../src/data/sheets/amsterdam-areas.ts';
import { CITIES } from '../../src/data/cities.ts';
import { distanceM } from '../../src/lib/aqi/geo.ts';
import { isLocalAirArea, localAirReady, LOCAL_AIR_AREAS } from '../../src/lib/aqi/local-areas.ts';
import { newLocalCache } from '../../src/lib/aqi/local-handler.ts';
import { isLocalAirPayload } from '../../src/lib/aqi/local-valid.ts';
import { lkiUrl, measurementsUrl, readAmsterdam } from '../../src/lib/aqi/luchtmeetnet.ts';
import { amsterdamCentre, CANAL_RING, MAX_NL_SERVE_M, measuresLkiBasis, NL_LADDER, nlLadder } from '../../src/lib/aqi/nl-stations.ts';
import { isAirCity } from '../../src/lib/aqi/stations.ts';

/* Amsterdam's 32 streamed areas, each measured from its own centre (2026-11-09). Station data: tests/fixtures/aqi/nl/stations-survey-2026-11-09.json
   (30 stations within 30 km of 52.37, 4.90, with the components each publishes) and the 2026-11-06 national list (stations-details.json). */
const NL = 'tests/fixtures/aqi/nl/';
const read = (n) => readFileSync(NL + n, 'utf8');
const SURVEY = JSON.parse(read('stations-survey-2026-11-09.json'));
const DETAILS = JSON.parse(read('stations-details.json'));
const NOW = new Date('2026-11-06T13:43:52Z');
const ids = AMSTERDAM_SHEET_IDS;

const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } }; return r; };
const call = async (area, local, query = {}) => { const r = res(); await handle({ method: 'GET', query: { area, ...query } }, r, { key: '', local: { streaming: true, ...local } }); return r; };

/** A fetch that serves `bodies[url]`; any other URL is a 503. */
function replay(bodies) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const b = bodies[url];
    if (b === undefined) return { ok: false, status: 503, text: async () => '' };
    return { ok: true, status: 200, text: async () => b };
  };
  return { fetch, calls };
}

/** A station's feed at NOW: an LKI of 3 for the hour ending 13:00Z and no substances. */
const lkiRow = (id, value = 3, at = '2026-11-06T13:00:00+00:00') => JSON.stringify({ data: [{ station_number: id, formula: 'LKI', value, timestamp_measured: at }] });
const stationFeed = (id) => ({ [lkiUrl(id, NOW)]: lkiRow(id), [measurementsUrl(id, NOW)]: '{"data":[]}' });
const allStations = () => Object.assign({}, ...NL_LADDER.map((r) => stationFeed(r.id)));

/* ── the ladder, per area ─────────────────────────────────────────────────────────────────────────── */

/** area code, area id, the ladder: [station id, true distance from THAT area's centre, m], nearest first. Re-derived below from the survey; baked here so a drift fails loudly. */
const TABLE = [
  ['D2', 'ams-d2', [['NL49012', 4055], ['NL49014', 6296], ['NL49003', 7347], ['NL10552', 13933]]],
  ['E2', 'ams-e2', [['NL49012', 2751], ['NL49003', 4886], ['NL49014', 6241], ['NL10552', 16576]]],
  ['F2', 'ams-f2', [['NL49003', 3062], ['NL49012', 3783], ['NL49014', 7342], ['NL10552', 19263]]],
  ['B3', 'ams-b3', [['NL10552', 7737], ['NL49014', 7838], ['NL49012', 8577], ['NL49003', 12378], ['NL10444', 19906]]],
  ['C3', 'ams-c3', [['NL49014', 5429], ['NL49012', 5782], ['NL49003', 9582], ['NL10552', 10454]]],
  ['D3', 'ams-d3', [['NL49012', 2987], ['NL49014', 3627], ['NL49003', 6787], ['NL10552', 13204]]],
  ['E3', 'ams-e3', [['NL49012', 204], ['NL49014', 3532], ['NL49003', 3992], ['NL10552', 15970]]],
  ['F3', 'ams-f3', [['NL49003', 1196], ['NL49012', 2605], ['NL49014', 5237], ['NL10552', 18745]]],
  ['G3', 'ams-g3', [['NL49003', 1599], ['NL49012', 5400], ['NL49014', 7617], ['NL49680', 18536]]],
  ['H3', 'ams-h3', [['NL49003', 4394], ['NL49012', 8195], ['NL49014', 10210], ['NL49680', 15755]]],
  ['B4', 'ams-b4', [['NL49014', 7131], ['NL10552', 7477], ['NL49012', 9052], ['NL49003', 12697], ['NL10444', 18608]]],
  ['C4', 'ams-c4', [['NL49014', 4344], ['NL49012', 6464], ['NL49003', 9990], ['NL10552', 10265]]],
  ['D4', 'ams-d4', [['NL49014', 1594], ['NL49012', 4156], ['NL49003', 7349], ['NL10552', 13056]]],
  ['E4', 'canal-ring', [['NL49014', 1362], ['NL49012', 2895], ['NL49003', 4885], ['NL10552', 15849]]],
  ['F4', 'ams-f4', [['NL49003', 3059], ['NL49012', 3890], ['NL49014', 4101], ['NL10552', 18644]]],
  ['G4', 'ams-g4', [['NL49003', 3237], ['NL49012', 6125], ['NL49014', 6887], ['NL49680', 18489]]],
  ['H4', 'ams-h4', [['NL49003', 5219], ['NL49012', 8692], ['NL49014', 9679], ['NL49680', 15698]]],
  ['B5', 'ams-b5', [['NL49014', 7492], ['NL10552', 8235], ['NL49012', 10305], ['NL49003', 13605], ['NL10444', 17666]]],
  ['C5', 'ams-c5', [['NL49014', 4912], ['NL49012', 8125], ['NL10552', 10830], ['NL49003', 11119]]],
  ['D5', 'ams-d5', [['NL49014', 2791], ['NL49012', 6441], ['NL49003', 8822], ['NL10552', 13507]]],
  ['E5', 'ams-e5', [['NL49014', 2665], ['NL49012', 5709], ['NL49003', 6904], ['NL10552', 16224]]],
  ['F5', 'ams-f5', [['NL49014', 4698], ['NL49003', 5757], ['NL49012', 6273], ['NL10552', 18965]]],
  ['G5', 'ams-g5', [['NL49003', 5854], ['NL49014', 7259], ['NL49012', 7858], ['NL49680', 18867]]],
  ['H5', 'ams-h5', [['NL49003', 7144], ['NL49014', 9949], ['NL49012', 9989], ['NL49680', 16140]]],
  ['E6', 'ams-e6', [['NL49014', 5312], ['NL49012', 8525], ['NL49003', 9345], ['NL10552', 17062]]],
  ['F6', 'ams-f6', [['NL49014', 6573], ['NL49003', 8532], ['NL49012', 8912], ['NL10552', 19688]]],
  ['G6', 'ams-g6', [['NL49014', 8593], ['NL49003', 8598], ['NL49012', 10091], ['NL49680', 19646]]],
  ['H6', 'ams-h6', [['NL49003', 9524], ['NL49014', 10961], ['NL49012', 11828], ['NL49680', 17042]]],
  ['I6', 'ams-i6', [['NL49003', 11097], ['NL49014', 13495], ['NL49012', 13915], ['NL49680', 14511]]],
  ['G7', 'ams-g7', [['NL49014', 10529], ['NL49003', 11378], ['NL49012', 12562]]],
  ['H7', 'ams-h7', [['NL49003', 12093], ['NL49014', 12537], ['NL49012', 13996], ['NL49680', 18337]]],
  ['I7', 'ams-i7', [['NL49003', 13368], ['NL49014', 14805], ['NL49012', 15800], ['NL49680', 16010]]],
];

test('the 32 streamed areas are exactly the sheet table\'s ids, in reading order', () => {
  assert.equal(ids.length, 32);
  assert.deepEqual(TABLE.map((r) => r[1]), [...ids]);
  assert.deepEqual(TABLE.map((r) => r[0]), AMSTERDAM_SHEETS.map((s) => s.code));
});

test('LADDER PER AREA: the chosen station and its true distance from that area\'s centre, for all 32 areas (baked table)', () => {
  for (const [code, id, ladder] of TABLE) {
    const centre = amsterdamCentre(id);
    assert.ok(centre, id);
    assert.deepEqual(nlLadder(centre).map((x) => [x.station.id, x.station.distance_m]), ladder, `${code} ${id}`);
    assert.ok(ladder.every(([, m]) => m <= MAX_NL_SERVE_M), `${code}: nothing beyond the 20 km ceiling`);
    assert.ok(ladder.every(([, m], i) => i === 0 || ladder[i - 1][1] <= m), `${code}: nearest first`);
  }
});

test('LADDER PER AREA: re-derived by rule from the recorded survey (all four substances, within 20 km of that centre, Breukelen-A2 excluded)', () => {
  const four = SURVEY.filter((s) => measuresLkiBasis(s.comp));
  assert.deepEqual(four.map((s) => s.id).sort(), ['NL10444', 'NL10552', 'NL10641', 'NL49003', 'NL49012', 'NL49014', 'NL49680']);
  for (const s of AMSTERDAM_SHEETS) {
    const want = four.filter((st) => st.id !== 'NL10641')
      .map((st) => [st.id, distanceM(s.centre.lat, s.centre.lon, st.lat, st.lon)])
      .filter(([, m]) => m <= MAX_NL_SERVE_M).sort((a, b) => a[1] - b[1]);
    assert.deepEqual(nlLadder(s.centre).map((x) => [x.station.id, x.station.distance_m]), want, s.code);
  }
  /* the baked refs carry the survey's own positions and operators */
  for (const ref of NL_LADDER) {
    const st = SURVEY.find((x) => x.id === ref.id);
    assert.deepEqual([ref.lat, ref.lon, ref.owner, ref.kind, ref.name], [st.lat, st.lon, st.org, st.type.toLowerCase(), st.name.trim()], ref.id);
  }
  assert.deepEqual(NL_LADDER.map((r) => r.id).sort(), ['NL10444', 'NL10552', 'NL49003', 'NL49012', 'NL49014', 'NL49680']);
});

test('Breukelen-A2 is gone from every ladder; Almere-Boomgaardweg is on the east and south-east ones; De Zilk only where it is inside 20 km', () => {
  const on = (sid) => TABLE.filter(([, , l]) => l.some(([x]) => x === sid)).map((r) => r[0]);
  assert.deepEqual(on('NL10641'), []);
  assert.ok(!NL_LADDER.some((r) => r.id === 'NL10641'));
  assert.deepEqual(on('NL49680'), ['G3', 'H3', 'G4', 'H4', 'G5', 'H5', 'G6', 'H6', 'I6', 'H7', 'I7']);
  assert.deepEqual(on('NL10444'), ['B3', 'B4', 'B5'], 'De Zilk (regional, 17.7 km from B5) is a far fallback for the three west-side areas');
  /* De Zilk is included only because it falls within 20 km of some area centre; so is it nobody\'s nearest. */
  const closest = Math.min(...AMSTERDAM_SHEETS.map((s) => distanceM(s.centre.lat, s.centre.lon, 52.296556, 4.510817)));
  assert.equal(closest, 17_666);
  assert.ok(TABLE.every(([, , l]) => l[0][0] !== 'NL10444' && l[0][0] !== 'NL49680'));
  /* and nothing else in the 2026-11-06 national list measures all four within 20 km of any centre */
  const others = Object.entries(DETAILS).filter(([id, d]) => measuresLkiBasis(d.components) && !NL_LADDER.some((r) => r.id === id) && id !== 'NL10641');
  for (const [id, d] of others) {
    const [lon, lat] = d.geometry.coordinates;
    assert.ok(AMSTERDAM_SHEETS.every((s) => distanceM(s.centre.lat, s.centre.lon, lat, lon) > MAX_NL_SERVE_M), `${id} is beyond 20 km of every area`);
  }
});

test('Canal Ring is the id "canal-ring" and its ladder lost only Breukelen-A2', () => {
  assert.deepEqual(nlLadder(CANAL_RING).map((x) => [x.station.id, x.station.distance_m]), [['NL49014', 1362], ['NL49012', 2895], ['NL49003', 4885], ['NL10552', 15849]]);
  assert.deepEqual(amsterdamCentre('canal-ring'), CANAL_RING);
});

test('THE CARD MEASURES FROM ITS OWN AREA: the first LKI request for each of the 32 areas is for that area\'s nearest station, served with its true distance and no fallback label', async () => {
  for (const [code, id, ladder] of TABLE) {
    const f = replay(allStations());
    const r = await call(`nl/amsterdam/${id}`, { fetch: f.fetch, now: () => NOW, cache: newLocalCache(), drawable: () => true });
    assert.equal(r.code, 200, id);
    assert.equal(r.body.state, 'live', id);
    assert.deepEqual([r.body.station.id, r.body.station.distance_m], ladder[0], `${code} ${id}`);
    assert.equal(r.body.station.fallback, undefined, `${code}: the nearest rung is not a fallback`);
    assert.equal(r.body.area_id, `nl/amsterdam/${id}`);
    assert.ok(f.calls.find((u) => u.includes('/lki?')).includes(`station_number=${ladder[0][0]}`), 'the nearest rung is asked first');
  }
});

test('A NON-NEAREST RUNG IS A FALLBACK: with the nearest down, the next rung serves, labelled, with its own true distance (all 32 areas)', async () => {
  for (const [code, id, ladder] of TABLE) {
    const map = allStations();
    delete map[lkiUrl(ladder[0][0], NOW)];
    const p = await readAmsterdam(`nl/amsterdam/${id}`, { fetch: replay(map).fetch, now: NOW, from: amsterdamCentre(id) });
    assert.equal(p.state, 'live', code);
    assert.deepEqual([p.station.id, p.station.distance_m, p.station.fallback], [ladder[1][0], ladder[1][1], true], code);
  }
});

/* ── centres: derived, never retyped ──────────────────────────────────────────────────────────────── */

test('every area\'s centre is the sheet record\'s own, equal to the ward table\'s lat/lon (31 generated rows + the hand-written Canal Ring)', () => {
  for (const s of AMSTERDAM_SHEETS) assert.equal(amsterdamCentre(s.id), s.centre, s.id);
  for (const w of AMSTERDAM_AREA_WARDS) {
    const c = amsterdamCentre(w.id);
    assert.deepEqual([c.lat, c.lon], [w.lat, w.lon], w.id);
  }
  const cr = CITIES.amsterdam.wards[0];
  assert.equal(cr.id, 'canal-ring');
  assert.deepEqual([CANAL_RING.lat, CANAL_RING.lon], [cr.lat, cr.lon]);
  assert.deepEqual(amsterdamCentre('canal-ring'), { lat: cr.lat, lon: cr.lon });
  assert.equal(amsterdamCentre('ams-a1'), null);
  assert.equal(amsterdamCentre('jordaan'), null);
  assert.equal(AMSTERDAM_AREA_WARDS.length, 31);
});

test('the area name the card uses is the ward table\'s (amsterdam-areas.ts), for every streamed area', () => {
  for (const w of AMSTERDAM_AREA_WARDS) {
    const row = CITIES.amsterdam.wards.find((x) => x.id === w.id);
    assert.equal(row.name, w.name);
    assert.ok(w.name.length > 0 && !/[<>]/.test(w.name), w.id);
  }
});

/* ── the API allowlist ────────────────────────────────────────────────────────────────────────────── */

test('API ALLOWLIST: it accepts exactly the 32 streamed areas (+ Tokyo\'s key), nothing else', () => {
  const nl = Object.keys(LOCAL_AIR_AREAS).filter((k) => k.startsWith('nl/'));
  assert.deepEqual(nl.sort(), ids.map((i) => `nl/amsterdam/${i}`).sort());
  assert.deepEqual(Object.keys(LOCAL_AIR_AREAS).filter((k) => !k.startsWith('nl/')), ['jp/tokyo/marunouchi']);
  assert.deepEqual(LOCAL_AIR_AREAS['nl/amsterdam/canal-ring'], { standard: 'nl-lki', country: 'nl', tz: 'Europe/Amsterdam' }, 'Canal Ring\'s entry is exactly what it was');
  assert.deepEqual(LOCAL_AIR_AREAS['jp/tokyo/marunouchi'], { standard: 'jp-eqs', country: 'jp', tz: 'Asia/Tokyo' }, 'Tokyo\'s is untouched');
  assert.equal(LOCAL_AIR_AREAS['nl/amsterdam/ams-f4'].streamed, true);
});

test('API ALLOWLIST: every streamed id is answered, every other key is a 404, an extra parameter is a 400, and nothing is fetched for them', async () => {
  for (const id of ids) {
    const f = replay(allStations());
    const r = await call(`nl/amsterdam/${id}`, { fetch: f.fetch, now: () => NOW, cache: newLocalCache() });
    assert.equal(r.code, 200, id);
    assert.ok(isLocalAirPayload(r.body), id);
    assert.ok(f.calls.length >= 2, id);
  }
  for (const bad of ['nl/amsterdam/ams-a1', 'nl/amsterdam/jordaan', 'nl/amsterdam/AMS-F4', 'nl/amsterdam/ams-f4/', 'nl/amsterdam/ams-f4 ', 'nl/amsterdam/', 'nl/amsterdam', 'nl/rotterdam/ams-f4', 'in/kolkata/ams-f4', 'nl/amsterdam/ams-f4/../canal-ring', '', 'ams-f4']) {
    const f = replay(allStations());
    const r = await call(bad, { fetch: f.fetch, now: () => NOW, cache: newLocalCache() });
    assert.equal(r.code, 404, JSON.stringify(bad));
    assert.equal(f.calls.length, 0, `nothing fetched for ${JSON.stringify(bad)}`);
  }
  for (const extra of [{ station: 'NL49012' }, { lat: '52.1' }, { area2: 'x' }]) {
    const f = replay(allStations());
    const r = await call('nl/amsterdam/ams-f4', { fetch: f.fetch, now: () => NOW, cache: newLocalCache() }, extra);
    assert.equal(r.code, 400, JSON.stringify(extra));
    assert.equal(f.calls.length, 0);
  }
});

test('API GATE: Canal Ring is still served only while its city is drawable; a streamed area does not depend on that (its page does not exist)', () => {
  assert.equal(localAirReady('nl/amsterdam/canal-ring', () => false), false);
  assert.equal(localAirReady('nl/amsterdam/canal-ring', () => true), true);
  assert.equal(localAirReady('jp/tokyo/marunouchi', () => false), false);
  for (const id of ids.filter((i) => i !== 'canal-ring')) {
    assert.equal(localAirReady(`nl/amsterdam/${id}`, () => false), true, id);
    assert.equal(isAirCity(`nl/amsterdam/${id}`), true, id);
  }
  assert.equal(isAirCity('nl/amsterdam/ams-a1'), false, 'a skipped lattice cell has no card');
  assert.equal(isLocalAirArea('in/kolkata/ballygunge'), false);
  assert.equal(isAirCity('in/kolkata/ballygunge'), true);
  assert.equal(isAirCity('in/bengaluru/indiranagar'), true);
  assert.equal(isAirCity('ae/dubai/creek'), false);
});

