// tests/unit/aqi-us.test.mjs — the US EPA equivalent under the CPCB headline.
import assert from 'node:assert/strict';
import test from 'node:test';
import { naqiToConcentration, usIndex, usCategory, usAqiFromConcentrations, usAqiOf, truncate } from '../../src/lib/aqi/us-aqi.ts';
import { subIndex } from '../../src/lib/aqi/cpcb.ts';

const cpcb = (subs) => ({ origin: 'cpcb', aqi: 107, category: 'moderate', dominant: 'pm10', window_h: 24,
  subindices: subs.map(([parameter, avg]) => ({ parameter, avg, min: null, max: null, hourly: null })) });

test('Ballygunge 2026-10-04: PM2.5 avg 87, PM10 avg 107 → US 142, USG, led by PM2.5', () => {
  assert.equal(naqiToConcentration('pm25', 87), 52.2);
  assert.equal(naqiToConcentration('pm10', 107), 110.5);
  const u = usAqiOf(cpcb([['pm25', 87], ['pm10', 107], ['no2', 20], ['co', 30]]));
  assert.deepEqual(u, { aqi: 142, capped: false, category: 'usg', dominant: 'pm25', pm25: 52.2, pm10: 110 });
  assert.equal(usIndex('pm10', 110.5).aqi, 78);
});

test('NAQI inversion hits every band edge exactly', () => {
  const pm25 = [[0, 0], [50, 30], [100, 60], [200, 90], [300, 120], [400, 250], [500, 380]];
  const pm10 = [[0, 0], [50, 50], [100, 100], [200, 250], [300, 350], [400, 430], [500, 510]];
  for (const [si, c] of pm25) assert.equal(naqiToConcentration('pm25', si), c, `pm25 ${si}`);
  for (const [si, c] of pm10) assert.equal(naqiToConcentration('pm10', si), c, `pm10 ${si}`);
});

test('round-trip: concentration → CPCB sub-index (rounded) → concentration, within half a sub-index step', () => {
  for (const p of ['pm25', 'pm10']) {
    for (let c = 0; c <= 600; c += 0.7) {
      const back = naqiToConcentration(p, subIndex(p, c));
      /* Half an index unit of the local slope: the steepest band is PM10's Very Poor and beyond, 80/100 per unit. */
      const slope = Math.abs(naqiToConcentration(p, subIndex(p, c) + 0.5) - back) + 1e-9;
      assert.ok(Math.abs(back - c) <= slope, `${p} ${c.toFixed(1)} → ${subIndex(p, c)} → ${back}`);
    }
  }
});

test('US band edges, 2024 PM2.5 and PM10, with EPA truncation', () => {
  const v = [
    ['pm25', 0, 0], ['pm25', 9.0, 50], ['pm25', 9.09, 50], ['pm25', 9.1, 51], ['pm25', 35.4, 100], ['pm25', 35.5, 101],
    ['pm25', 55.4, 150], ['pm25', 55.5, 151], ['pm25', 125.4, 200], ['pm25', 125.5, 201], ['pm25', 225.4, 300], ['pm25', 225.5, 301], ['pm25', 325.4, 500],
    ['pm10', 0, 0], ['pm10', 54, 50], ['pm10', 54.9, 50], ['pm10', 55, 51], ['pm10', 154, 100], ['pm10', 155, 101], ['pm10', 254, 150],
    ['pm10', 255, 151], ['pm10', 354, 200], ['pm10', 355, 201], ['pm10', 424, 300], ['pm10', 425, 301], ['pm10', 604, 500],
  ];
  for (const [p, c, aqi] of v) assert.deepEqual(usIndex(p, c), { aqi, capped: false }, `${p} ${c}`);
  assert.equal(truncate('pm25', 52.199999999999996), 52.2);
  assert.equal(truncate('pm10', 110.99), 110);
});

test('category names at the US edges', () => {
  assert.deepEqual([0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301, 500].map(usCategory),
    ['good', 'good', 'moderate', 'moderate', 'usg', 'usg', 'unhealthy', 'unhealthy', 'very_unhealthy', 'very_unhealthy', 'hazardous', 'hazardous']);
});

test('beyond the scale caps at 500 and says so', () => {
  assert.deepEqual(usIndex('pm25', 325.5), { aqi: 500, capped: true });
  assert.deepEqual(usIndex('pm10', 605), { aqi: 500, capped: true });
  const u = usAqiOf(cpcb([['pm25', 480]]));
  assert.equal(u.aqi, 500); assert.equal(u.capped, true); assert.equal(u.category, 'hazardous');
});

test('missing pollutants: one is enough, none is null, never a guess', () => {
  assert.equal(usAqiOf(cpcb([['pm10', 107]])).dominant, 'pm10');
  assert.equal(usAqiOf(cpcb([['pm10', 107]])).pm25, null);
  assert.equal(usAqiOf(cpcb([['no2', 120], ['o3', 90]])), null);
  assert.equal(usAqiOf(cpcb([['pm25', null], ['pm10', null]])), null);
  assert.equal(usAqiOf(cpcb([])), null);
  assert.equal(usAqiFromConcentrations(Number.NaN, -1), null);
});

test('an OBOS result uses its 24-hour concentrations directly, only where the sub-index is valid', () => {
  const reading = (parameter, value, sub_index) => ({ parameter, value, unit: 'ug_m3', window_h: 24, hours_present: 20, sub_index });
  const r = { origin: 'obos', aqi: 87, category: 'moderate', dominant: 'pm25', window_end_ist: '', algorithm: 'cpcb-aqi-1',
    pollutants: [reading('pm25', 52.2, 87), reading('pm10', 300, null)] };
  assert.deepEqual(usAqiOf(r), { aqi: 142, capped: false, category: 'usg', dominant: 'pm25', pm25: 52.2, pm10: null });
  r.pollutants[0].sub_index = null;
  assert.equal(usAqiOf(r), null);
});

/* ── the card line ─────────────────────────────────────────────────────────── */
import { cardHtml, paneHtml } from '../../src/scripts/climate-engine/air/air-panel.ts';

const payload = (subs) => ({ history: null, current: {
  schema: 2, area_id: 'in/kolkata/ballygunge', served_at: '2026-10-04T08:00:00Z', state: 'live', observed_at: '2026-10-04T07:30:00Z',
  source: { owner: 'West Bengal Pollution Control Board', via: 'CPCB', standard: 'CPCB National AQI' },
  station: { id: 'x', name: 'Ballygunge', lat: 22.5, lon: 88.4, distance_m: 900, inside: 'window_3km' },
  result: { ...cpcb(subs), dominant: 'pm10' } } });

test('the card and the pane print the US line under the official number, the official number first', () => {
  const now = new Date('2026-10-04T08:00:00Z');
  for (const html of [cardHtml(payload([['pm25', 87], ['pm10', 107]]), 'Ballygunge', now), paneHtml(payload([['pm25', 87], ['pm10', 107]]), 'Ballygunge', now)]) {
    assert.match(html.replace(/<[^>]+>/g, ''), /≈ US AQI 142 · Unhealthy for Sensitive Groupsi/);
    assert.ok(html.indexOf('class="num') < html.indexOf('US AQI'), 'CPCB headline comes first');
    assert.match(html, /converted from CPCB&#39;s 24-hour PM2.5\/PM10/);
  }
});
test('no PM2.5 or PM10 sub-index: no US line at all', () => {
  const html = cardHtml(payload([['no2', 120], ['o3', 90]]), 'Ballygunge', new Date('2026-10-04T08:00:00Z'));
  assert.match(html, /class="num/);
  assert.doesNotMatch(html, /US AQI/);
});
