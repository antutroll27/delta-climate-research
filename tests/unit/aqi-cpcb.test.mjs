import assert from 'node:assert/strict';
import test from 'node:test';
import { subIndex, category, combine, MIN_HOURS } from '../../src/lib/aqi/cpcb.ts';

test('sub-index hits every band edge exactly (calculator edges)', () => {
  assert.equal(subIndex('pm25', 0), 0);
  assert.equal(subIndex('pm25', 30), 50);
  assert.equal(subIndex('pm25', 60), 100);
  assert.equal(subIndex('pm25', 90), 200);
  assert.equal(subIndex('pm25', 120), 300);
  assert.equal(subIndex('pm25', 250), 400);
  assert.equal(subIndex('pm10', 100), 100);
  assert.equal(subIndex('pm10', 250), 200);
  assert.equal(subIndex('no2', 80), 100);
  assert.equal(subIndex('co', 2.0), 100);
  assert.equal(subIndex('o3', 168), 200);
  assert.equal(subIndex('so2', 380), 200);
});

test('bands are continuous, as the CPCB calculator computes them (not the 31/51 table form)', () => {
  assert.equal(subIndex('pm25', 31), 52);    // 50 + (31-30) × 50/30 = 51.67
  assert.equal(subIndex('pm25', 45), 75);    // 50 + 15 × 50/30 = 75
  assert.equal(subIndex('pm25', 61.1), 104); // 100 + 1.1 × 100/30 = 103.67
  assert.equal(subIndex('co', 1.09), 55);    // 50 + 0.09 × 50/1 = 54.5 → 55 (round half up)
});

test('Severe is open-ended: the Very Poor slope continues with no cap', () => {
  assert.equal(subIndex('pm25', 300), 438);  // 400 + 50 × 100/130 = 438.46
  assert.equal(subIndex('pm10', 600), 613);  // 400 + 170 × 100/80 = 612.5 → 613
  assert.equal(subIndex('o3', 800), 410);    // 400 + 52 × 100/540 = 409.6 (not the workbook's defective 474)
});

test("ozone's declared deviation: 100/540 throughout the Very Poor band, not the workbook's 100/539", () => {
  assert.equal(subIndex('o3', 264.6), 310); // the workbook's /539 gives 311
});

test('subIndex refuses non-finite or negative concentrations', () => {
  assert.throws(() => subIndex('pm25', NaN), RangeError);
  assert.throws(() => subIndex('pm25', -1), RangeError);
});

test('category follows the index bands; above 500 is still Severe', () => {
  assert.equal(category(50), 'good');
  assert.equal(category(51), 'satisfactory');
  assert.equal(category(100), 'satisfactory');
  assert.equal(category(101), 'moderate');
  assert.equal(category(200), 'moderate');
  assert.equal(category(201), 'poor');
  assert.equal(category(400), 'very_poor');
  assert.equal(category(401), 'severe');
  assert.equal(category(900), 'severe');
});

const r = (parameter, value, hours, sub) => ({ parameter, value, unit: parameter === 'co' ? 'mg_m3' : 'ug_m3',
  window_h: ['co', 'o3'].includes(parameter) ? 8 : 24, hours_present: hours, sub_index: sub });

test('the AQI is the MAXIMUM valid sub-index, never an average', () => {
  const out = combine([r('pm25', 45, 24, 75), r('no2', 20, 24, 25), r('o3', 90, 24, 90)]);
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.aqi, 90);
  assert.equal(out.ok && out.dominant, 'o3');
});

test('publishing needs three valid pollutants, one of them PM', () => {
  assert.equal(combine([r('pm25', 45, 24, 75), r('no2', 20, 24, 25)]).ok, false);
  const noPm = combine([r('no2', 20, 24, 25), r('so2', 5, 24, 6), r('o3', 90, 24, 90)]);
  assert.equal(noPm.ok, false);
  assert.match(noPm.ok ? '' : noPm.reasons.join(' '), /PM2\.5 or PM10/);
});

test(`a pollutant with fewer than ${MIN_HOURS} hours does not count, even with a sub-index already computed`, () => {
  const out = combine([r('pm25', 45, MIN_HOURS - 1, 75), r('no2', 20, 24, 25), r('o3', 90, 24, 90), r('so2', 5, 24, 6)]);
  assert.equal(out.ok, false);
  assert.match(out.ok ? '' : out.reasons.join(' '), /PM2\.5 had 15 of 16/);
});

test(`the same readings with exactly ${MIN_HOURS} hours for PM2.5 do count`, () => {
  const out = combine([r('pm25', 45, MIN_HOURS, 75), r('no2', 20, 24, 25), r('o3', 90, 24, 90), r('so2', 5, 24, 6)]);
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.aqi, 90);
});
