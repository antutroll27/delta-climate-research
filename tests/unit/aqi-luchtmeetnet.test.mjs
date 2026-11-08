import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CITIES } from '../../src/data/cities.ts';
import { distanceM } from '../../src/lib/aqi/geo.ts';
import { USER_AGENT } from '../../src/lib/aqi/http.ts';
import { LKI_KEY, LKI_LABEL, lkiBand } from '../../src/lib/aqi/lki.ts';
import {
  LIVE_MS, LUCHTMEETNET_CREDIT, lkiUrl, measurementsUrl, parseLki, parseMeasurements, readAmsterdam, readingsAt,
} from '../../src/lib/aqi/luchtmeetnet.ts';
import { CANAL_RING, LKI_COMPONENTS, MAX_NL_SERVE_M, measuresLkiBasis, NL_LADDER, nlLadder } from '../../src/lib/aqi/nl-stations.ts';

/* REAL RESPONSES, captured 2026-11-06T13:43:52Z with the generic UA (tests/fixtures/aqi/nl/capture.json): the
   LKI and the hourly substances for the three stations of the ladder's first rungs, and the station details of
   the 100 stations Luchtmeetnet lists whose detail was read. */
const F = 'tests/fixtures/aqi/nl/';
const read = (n) => readFileSync(F + n, 'utf8');
const NOW = new Date('2026-11-06T13:43:52Z');
const DETAILS = JSON.parse(read('stations-details.json'));

function replay(map, hook) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const body = hook ? hook(url) : map[url];
    if (body === undefined) return { ok: false, status: 404, text: async () => '' };
    if (body instanceof Error) throw body;
    if (typeof body === 'number') return { ok: false, status: body, text: async () => '' };
    return { ok: true, status: 200, text: async () => body };
  };
  return { fetch, calls };
}
const feed = (id, now = NOW) => ({ [lkiUrl(id, now)]: read(`lki-${id}.json`), [measurementsUrl(id, now)]: read(`measurements-${id}.json`) });
const ALL = { ...feed('NL49014'), ...feed('NL49012'), ...feed('NL49003') };
const AREA = 'nl/amsterdam/canal-ring';

test('LKI classes are Luchtmeetnet\'s own five: 1-3, 4-6, 7-8, 9-10, 11; anything else has no class', () => {
  const want = { 1: 'good', 3: 'good', 4: 'moderate', 6: 'moderate', 7: 'insufficient', 8: 'insufficient', 9: 'bad', 10: 'bad', 11: 'very_bad' };
  for (const [v, b] of Object.entries(want)) assert.equal(lkiBand(Number(v)), b, v);
  for (const bad of [0, 12, -1, 3.5, 0.9, NaN, Infinity, '3', null, undefined]) assert.equal(lkiBand(bad), null, String(bad));
  assert.deepEqual(LKI_KEY.map((k) => [k.band, k.from, k.to]), [['good', 1, 3], ['moderate', 4, 6], ['insufficient', 7, 8], ['bad', 9, 10], ['very_bad', 11, 11]]);
  assert.deepEqual(Object.values(LKI_LABEL).map((l) => l.nl), ['Goed', 'Matig', 'Onvoldoende', 'Slecht', 'Zeer slecht']);
  assert.deepEqual(Object.values(LKI_LABEL).map((l) => l.en), ['Good', 'Moderate', 'Insufficient', 'Bad', 'Very bad']);
});

test('the class edges are the ones in the recorded luchtmeetnet.nl script, not retyped from memory', () => {
  const ev = JSON.parse(read('lki-legend-evidence.json'));
  const f = ev.chunk_classify.fragment;
  /* e>0&&e<4 good; e>=4&&e<7 moderate; e>=7&&e<9 insufficient; e>=9&&e<11 bad; else very bad */
  for (const piece of ['e>0&&e<4', 'e>=4&&e<7', 'e>=7&&e<9', 'e>=9&&e<11']) assert.ok(f.includes(piece), piece);
  const l = ev.chunk_legend.fragment;
  for (const s of ['string:"good"', 'string:"moderate"', 'string:"insufficient"', 'string:"bad"', 'string:"verybad"']) assert.ok(l.includes(s), s);
  assert.match(ev.chunk_classify.sha256, /^[0-9a-f]{64}$/);
  /* The prose page: five classes, 1 to 11, the highest substance decides. */
  const pages = JSON.parse(read('cms-pages-used.json')).pages;
  const lki = pages.find((p) => p.slug === 'luchtkwaliteit/luchtkwaliteitsindex-(lki)').contents.find((c) => c.language === 'NL').content;
  assert.ok(lki.includes('vijf klassen van goed tot zeer slecht') && lki.includes('1 (weinig luchtverontreiniging) tot 11'));
});

test('the licence and the credit the terms ask for are on record: CC BY-ND 4.0, source reference to www.luchtmeetnet.nl, no endorsement', () => {
  const pages = JSON.parse(read('cms-pages-used.json')).pages;
  const open = pages.find((p) => p.slug === 'download-data/open-data').contents;
  const nl = open.find((c) => c.language === 'NL').content, en = open.find((c) => c.language === 'EN').content;
  assert.ok(nl.includes('bronvermelding  (www.luchtmeetnet.nl) verplicht') || nl.includes('bronvermelding (www.luchtmeetnet.nl) verplicht'));
  assert.ok(nl.includes('CC BY-ND 4.0') && en.includes('No-derivative Works 4.0 International (CC BY-ND 4.0)'));
  assert.ok(en.includes('a source reference to www.luchtmeetnet.nl is mandatory'));
  assert.ok(en.includes('users cannot create the impression that we endorse'));
  assert.equal(LUCHTMEETNET_CREDIT.line, 'Source: www.luchtmeetnet.nl');
  assert.equal(LUCHTMEETNET_CREDIT.edit, null, 'the values are shown as published; there is nothing to declare as edited');
  assert.match(LUCHTMEETNET_CREDIT.licence, /CC BY-ND 4\.0/);
  assert.match(LUCHTMEETNET_CREDIT.note, /does not endorse this page/);
});

test('timestamps: the stamp is the END of the hour, as the same row\'s start/end fields say', () => {
  const rows = parseMeasurements(read('measurements-NL49014.json'), 'NL49014', NOW);
  const raw = JSON.parse(read('measurements-NL49014.json')).data.find((r) => r.formula === 'PM25');
  assert.equal(raw.timestamp_measured, raw.timestamp_measured_end);
  assert.equal(Date.parse(raw.timestamp_measured) - Date.parse(raw.timestamp_measured_start), 3_600_000);
  assert.equal(rows.find((r) => r.formula === 'PM25').endMs, Date.parse('2026-11-06T13:00:00Z'));
});

test('parseLki keeps only this station\'s whole-number LKI rows with an offset, none from the future', () => {
  const rows = parseLki(read('lki-NL49014.json'), 'NL49014', NOW);
  assert.deepEqual([rows[0].value, rows[0].endMs], [3, Date.parse('2026-11-06T13:00:00Z')]);
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].endMs > r.endMs), 'newest first');
  const j = (data) => JSON.stringify({ data });
  const ok = { station_number: 'NL49014', formula: 'LKI', value: 3, timestamp_measured: '2026-11-06T13:00:00+00:00' };
  assert.equal(parseLki(j([ok]), 'NL49014', NOW).length, 1);
  for (const bad of [{ value: 3.5 }, { value: 0 }, { value: 12 }, { value: '3' }, { station_number: 'NL49012' }, { formula: 'NO2' }, { timestamp_measured: '2026-11-06T13:00:00' },
    { timestamp_measured: '2026-11-06T15:00:00+00:00' }]) {
    assert.equal(parseLki(j([{ ...ok, ...bad }]), 'NL49014', NOW).length, 0, JSON.stringify(bad));
  }
  assert.throws(() => parseLki('not json', 'NL49014', NOW));
  assert.throws(() => parseLki('{"data":null}', 'NL49014', NOW));
});

test('parseMeasurements: the four LKI substances, negatives kept, rows that contradict the end-of-hour stamp dropped', () => {
  const rows = parseMeasurements(read('measurements-NL49014.json'), 'NL49014', NOW);
  assert.deepEqual([...new Set(rows.map((r) => r.formula))].sort(), ['NO2', 'O3', 'PM10', 'PM25']);
  const row = { station_number: 'NL49014', formula: 'NO2', value: -1.2, timestamp_measured: '2026-11-06T13:00:00+00:00', timestamp_measured_end: '2026-11-06T13:00:00+00:00' };
  const one = (r) => parseMeasurements(JSON.stringify({ data: [r] }), 'NL49014', NOW);
  assert.equal(one(row)[0].value, -1.2);
  assert.equal(one({ ...row, timestamp_measured_end: '2026-11-06T12:00:00+00:00' }).length, 0);
  assert.equal(one({ ...row, value: null }).length, 0);
  assert.equal(one({ ...row, formula: 'CO' }).length, 0);
});

/** Breukelen-A2 measures all four substances but is a motorway-side traffic station: dropped by decision (2026-11-09), not by the rule. */
const DROPPED = ['NL10641'];

test('the Canal Ring ladder is derived by rule from the recorded stations, and equals the baked one', () => {
  /* Both recordings agree: the 11-06 national list (103 stations) and the 11-09 survey (30 within 30 km of 52.37, 4.90). */
  const eligible = Object.entries(DETAILS)
    .map(([id, d]) => ({ id, name: d.location, comps: d.components, lon: d.geometry.coordinates[0], lat: d.geometry.coordinates[1], owner: d.organisation }))
    .filter((s) => measuresLkiBasis(s.comps) && !DROPPED.includes(s.id))
    .map((s) => ({ ...s, d: distanceM(CANAL_RING.lat, CANAL_RING.lon, s.lat, s.lon) }))
    .filter((s) => s.d <= MAX_NL_SERVE_M).sort((a, b) => a.d - b.d);
  assert.deepEqual(nlLadder().map((x) => x.station.id), eligible.map((s) => s.id));
  for (const s of eligible) {
    const ref = NL_LADDER.find((r) => r.id === s.id);
    assert.deepEqual([ref.lat, ref.lon, ref.owner], [s.lat, s.lon, s.owner], s.id);
    assert.equal(ref.name, s.name.trim());
  }
  /* Breukelen-A2 (19,363 m, traffic beside the A2) is no longer a rung; Almere and De Zilk are beyond 20 km of Canal Ring. */
  assert.deepEqual(nlLadder().map((x) => [x.station.id, x.station.distance_m]), [['NL49014', 1362], ['NL49012', 2895], ['NL49003', 4885], ['NL10552', 15849]]);
  assert.deepEqual([...LKI_COMPONENTS].sort(), ['NO2', 'O3', 'PM10', 'PM25']);
});

test('nearer stations that lack a substance are not stood in for the area\'s LKI (no O3: Stadhouderskade, Oude Schans, …)', () => {
  const near = Object.entries(DETAILS)
    .map(([id, d]) => ({ id, comps: d.components, d: distanceM(CANAL_RING.lat, CANAL_RING.lon, d.geometry.coordinates[1], d.geometry.coordinates[0]) }))
    .filter((s) => s.d < 3500).sort((a, b) => a.d - b.d);
  assert.deepEqual(near.map((s) => s.id), ['NL49017', 'NL49014', 'NL49019', 'NL49020', 'NL49002', 'NL49012', 'NL49007', 'NL49016']);
  assert.deepEqual(near.filter((s) => measuresLkiBasis(s.comps)).map((s) => s.id), ['NL49014', 'NL49012']);
  assert.equal(measuresLkiBasis(DETAILS.NL49017.components), false);
  assert.equal(measuresLkiBasis(DETAILS.NL49019.components), false);
  assert.equal(CANAL_RING.lat, CITIES.amsterdam.wards[0].lat, 'the centre is the ward\'s');
  assert.equal(CANAL_RING.lon, CITIES.amsterdam.wards[0].lon);
});

test('readAmsterdam: Vondelpark\'s LKI as published, with the four substances of the same hour, in winter time', async () => {
  const { fetch, calls } = replay(ALL);
  const p = await readAmsterdam(AREA, { fetch, now: NOW });
  assert.equal(p.state, 'live');
  assert.equal(p.standard, 'nl-lki');
  assert.equal(p.station.id, 'NL49014');
  assert.equal(p.station.distance_m, 1362);
  assert.equal(p.station.owner, 'GGD Amsterdam');
  assert.equal(p.station.fallback, undefined);
  assert.equal(p.observed_at, '2026-11-06T13:00:00.000Z');
  assert.equal(p.observed_at_local, '2026-11-06T14:00:00+01:00');
  assert.deepEqual(p.lki, { value: 3, band: 'good' });
  assert.deepEqual(p.readings.map((r) => [r.formula, r.value]), [['PM25', 16.2], ['PM10', 22.9], ['NO2', 15.5], ['O3', 25.1]]);
  assert.ok(p.readings.every((r) => r.observed_at === p.observed_at));
  assert.equal(p.credit, LUCHTMEETNET_CREDIT);
  assert.equal(calls.length, 2, 'one LKI request, one measurements request');
  for (const c of calls) {
    assert.ok(c.url.startsWith('https://api.luchtmeetnet.nl/open_api/'));
    assert.match(c.url, /&start=2026-11-06T07:43:52Z&end=2026-11-06T13:43:52Z$/, 'an explicit window: without one the API redirects to another host');
    assert.equal(c.headers['User-Agent'], USER_AGENT);
    assert.ok(!/@/.test(JSON.stringify(c.headers)));
  }
});

test('the LKI shown is the API\'s number and the substances are the API\'s numbers: nothing rounded, converted or derived', async () => {
  const p = await readAmsterdam(AREA, { fetch: replay(ALL).fetch, now: NOW });
  const raw = JSON.parse(read('measurements-NL49014.json')).data.filter((r) => r.timestamp_measured === '2026-11-06T13:00:00+00:00');
  for (const r of p.readings) assert.equal(r.value, raw.find((x) => x.formula === r.formula).value);
  assert.deepEqual(Object.keys(p).sort(), ['area_id', 'credit', 'lki', 'observed_at', 'observed_at_local', 'readings', 'schema', 'served_at', 'standard', 'state', 'station']);
  assert.ok(!/us_aqi|usAqi|nowcast/i.test(JSON.stringify(p)), 'no US AQI line: it would be an adaptation of CC BY-ND data');
});

test('a rung that cannot be read hands over to the next, labelled as the nearest REPORTING station', async () => {
  const down = replay({ ...ALL, [lkiUrl('NL49014', NOW)]: 503 });
  const p = await readAmsterdam(AREA, { fetch: down.fetch, now: NOW });
  assert.equal(p.state, 'live');
  assert.equal(p.station.id, 'NL49012');
  assert.equal(p.station.fallback, true);
  assert.equal(p.station.distance_m, 2895);
  assert.deepEqual(p.lki, { value: 4, band: 'moderate' }, 'Van Diemenstraat\'s own hour-13 LKI, not Vondelpark\'s');
});

test('a rung whose LKI is older than two hours is skipped; if every rung is, the card says so and carries no number', async () => {
  const later = new Date(Date.parse('2026-11-06T13:00:00Z') + LIVE_MS + 60_000);
  const map = { ...feed('NL49014', later), ...feed('NL49012', later), ...feed('NL49003', later) };
  const p = await readAmsterdam(AREA, { fetch: replay(map).fetch, now: later });
  assert.deepEqual([p.state, p.reason, p.last_observed_at], ['not_reporting', 'no_current_hour', '2026-11-06T13:00:00.000Z']);
  assert.equal(p.station.id, 'NL49014');
  assert.ok(!/"lki"|"readings"|"value"/.test(JSON.stringify(p)));
  const exactly = new Date(Date.parse('2026-11-06T13:00:00Z') + LIVE_MS);
  const e = await readAmsterdam(AREA, { fetch: replay({ ...feed('NL49014', exactly) }).fetch, now: exactly });
  assert.equal(e.state, 'live', 'exactly two hours is still current');
});

test('a source that is down is "not reporting" (source_down), never a cached figure', async () => {
  const p = await readAmsterdam(AREA, { fetch: replay({}).fetch, now: NOW });
  assert.deepEqual([p.state, p.reason, p.last_observed_at], ['not_reporting', 'source_down', null]);
  assert.equal(p.station.id, 'NL49014');
  const t = await readAmsterdam(AREA, { fetch: replay({}, () => new Error('aborted')).fetch, now: NOW });
  assert.equal(t.reason, 'source_down');
  const garbled = await readAmsterdam(AREA, { fetch: replay({}, () => '<html>maintenance</html>').fetch, now: NOW });
  assert.equal(garbled.reason, 'source_down');
});

test('when the substances cannot be read the LKI still stands alone; a substance from another hour is left out, never mixed in', async () => {
  const alone = await readAmsterdam(AREA, { fetch: replay({ ...ALL, [measurementsUrl('NL49014', NOW)]: 500 }).fetch, now: NOW });
  assert.equal(alone.state, 'live');
  assert.deepEqual(alone.readings, []);
  const rows = parseMeasurements(read('measurements-NL49014.json'), 'NL49014', NOW);
  const prev = Date.parse('2026-11-06T12:00:00Z');
  assert.deepEqual(readingsAt(rows.filter((r) => r.endMs !== Date.parse('2026-11-06T13:00:00Z') || r.formula !== 'O3'), Date.parse('2026-11-06T13:00:00Z')).map((r) => r.formula), ['PM25', 'PM10', 'NO2']);
  assert.deepEqual(readingsAt(rows, prev).map((r) => r.observed_at), ['2026-11-06T12:00:00.000Z', '2026-11-06T12:00:00.000Z', '2026-11-06T12:00:00.000Z', '2026-11-06T12:00:00.000Z']);
});

test('in summer time the local stamp carries +02:00 (the clock is Europe/Amsterdam, not a typed offset)', async () => {
  const summerNow = new Date('2027-07-01T10:20:00Z');
  const lki = JSON.stringify({ data: [{ station_number: 'NL49014', formula: 'LKI', value: 5, timestamp_measured: '2027-07-01T10:00:00+00:00' }] });
  const p = await readAmsterdam(AREA, { fetch: replay({ [lkiUrl('NL49014', summerNow)]: lki, [measurementsUrl('NL49014', summerNow)]: '{"data":[]}' }).fetch, now: summerNow });
  assert.equal(p.observed_at_local, '2027-07-01T12:00:00+02:00');
  assert.equal(p.lki.band, 'moderate');
});
