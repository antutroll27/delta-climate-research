import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const doc = JSON.parse(await readFile(join(ROOT, 'data/opencity/aqi-daily.json'), 'utf8'));
const stations = doc.stations;
const byName = Object.fromEntries(stations.map(s => [s.station, s]));

test('all seven stations derived', () => {
  assert.equal(stations.length, 7);
  for (const s of stations) assert.ok(s.daily.length > 0, `${s.station} derived nothing`);
});

test('exactly one station is in a modelled ward, and it is Ballygunge', () => {
  // The whole "a measured multi-year record standing beside a modelled ward"
  // claim rests on this one mapping. If a future edit maps a second station to a
  // ward, or moves this one, it must break here and not decay into a footnote.
  const inWard = stations.filter(s => s.ward);
  assert.deepEqual(inWard.map(s => s.station), ['ballygunge']);
  assert.equal(inWard[0].ward, 'ballygunge');
});

test('a daily mean never exceeds its own daily max', () => {
  for (const s of stations) {
    for (const d of s.daily) {
      assert.ok(d.mean <= d.max, `${s.station} ${d.d}: mean ${d.mean} > max ${d.max}`);
    }
  }
});

test('every day carries its reading count, and the sparse flag follows it', () => {
  // `hours` is the guard against a four-reading day passing as a daily mean.
  // Without it a mean built from 4 is indistinguishable from one built from 24.
  const min = doc.min_hours_per_day;
  assert.equal(min, 18, 'the sparse threshold moved — the findings note quotes it');
  for (const s of stations) {
    for (const d of s.daily) {
      assert.ok(d.hours >= 1 && d.hours <= 24, `${s.station} ${d.d}: ${d.hours} hours`);
      assert.equal(d.sparse, d.hours < min, `${s.station} ${d.d}: flag disagrees with hours`);
    }
  }
});

test('sparse days are flagged, never dropped', () => {
  // The failure this pins is a silent filter: quietly excluding thin days would
  // raise every completeness figure and leave no trace that it had happened.
  const sparse = stations.flatMap(s => s.daily).filter(d => d.sparse);
  assert.ok(sparse.length > 0, 'no sparse day survived — something is filtering them out');
  assert.ok(sparse.every(d => typeof d.mean === 'number'),
    'a sparse day must still carry its mean, flagged rather than blanked');
});

test('days are ordered, unique, and inside the filter window', () => {
  for (const s of stations) {
    const dates = s.daily.map(d => d.d);
    assert.equal(new Set(dates).size, dates.length, `${s.station}: a day appears twice`);
    for (let i = 1; i < dates.length; i++) {
      assert.ok(dates[i] > dates[i - 1], `${s.station}: out of order at ${dates[i]}`);
    }
    assert.ok(dates[0] >= doc.window.from && dates.at(-1) <= doc.window.to, `${s.station}: outside the window`);
  }
});

test('coverage is measured against each station\'s own span, not the advertised one', () => {
  // The catalogue advertises 2017-2023, but six of seven stations were installed
  // later — Ballygunge begins 2019-08-01. Scoring them against the advertised
  // window would report a reliable station as 39 % broken. This pins the honest
  // denominator, and that first/last always travel with the percentage.
  assert.ok(byName.ballygunge.first >= '2019-01-01',
    'Ballygunge suddenly reaches further back — re-read the note before trusting it');
  const reaching2017 = stations.filter(s => s.first < '2018-01-01').map(s => s.station);
  assert.deepEqual(reaching2017, ['rabindra-bharati'],
    'the set of stations reaching 2017 changed — the findings note names exactly one');

  for (const s of stations) {
    assert.ok(s.first && s.last, `${s.station}: coverage without a window is unquotable`);
    const span = (Date.parse(s.last) - Date.parse(s.first)) / 86400000 + 1;
    assert.equal(s.span_days, span, `${s.station}: span_days disagrees with first/last`);
    assert.ok(s.coverage > 0.75 && s.coverage <= 1, `${s.station}: coverage ${s.coverage}`);
  }
});

test('the record is seasonal in the direction the findings note claims', () => {
  // The note's one substantive claim: air quality peaks in WINTER and bottoms in
  // the MONSOON, which is the inverse of the heat pattern. If that ever flips,
  // the note is wrong and must be rewritten rather than left standing.
  const b = byName.ballygunge.daily;
  const median = (xs) => xs.sort((p, q) => p - q)[Math.floor(xs.length / 2)];
  const monthly = (months) => median(b.filter(d => months.includes(d.d.slice(5, 7))).map(d => d.mean));
  const winter = monthly(['12', '01']);
  const monsoon = monthly(['07', '08']);
  assert.ok(winter > monsoon * 3,
    `winter ${winter} should far exceed monsoon ${monsoon} — the seasonality claim`);
  // …and the pre-monsoon heat season is NOT the dirty season. This is why the
  // note says co-exposure, not compounding.
  const heat = monthly(['04', '05']);
  assert.ok(heat < winter,
    `the hottest months (${heat}) should not also be the dirtiest (${winter})`);
});

test('provenance and the unit caveat travel in band', () => {
  assert.ok(doc.source && doc.licence, 'provenance belongs with the data, not just the docs');
  assert.match(doc.unit, /not state/i,
    'the unstated unit must stay stated — an AQI point and a ug/m3 are not the same number');
  assert.match(doc.window.note, /not a coverage claim/i);
});
