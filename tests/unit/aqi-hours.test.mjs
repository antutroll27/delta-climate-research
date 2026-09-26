import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { istHours, istHourKey, window24, window8 } from '../../src/lib/aqi/hours.ts';

const raw = JSON.parse(readFileSync(new URL('../fixtures/aqi/ballygunge-pm25-2025-12-15.json', import.meta.url)));

test('a reading stamped at its END belongs to the IST hour it closes within', () => {
  // 00:30Z end = 06:00 IST end = the 05:45-06:00 quarter = IST hour 05:00
  assert.equal(istHourKey('2025-12-15T00:30:00Z'), '2025-12-15T05');
  assert.equal(istHourKey('2025-12-15T00:45:00Z'), '2025-12-15T06');
});

test('the dropped quarter-hour does not shift or blank an hour', () => {
  const h = istHours(raw);
  // IST 06:00-07:00: OpenAQ has 06:15, 06:30 (60.7, 60.7) and drops 06:45; 07:00 (60.0) belongs to it
  assert.equal(h.get('2025-12-15T06').n, 3);
  assert.equal(Math.round(h.get('2025-12-15T06').mean * 100) / 100, 60.47);
});

test('a reading of 0 counts as missing, as in the CPCB calculator', () => {
  const h = istHours([{ end_utc: '2025-12-15T00:30:00Z', value: 0 }, { end_utc: '2025-12-15T00:45:00Z', value: 5 }]);
  assert.equal(h.has('2025-12-15T05'), false);
  assert.equal(h.get('2025-12-15T06').n, 1);
});

test('a 24-hour window counts only hours present', () => {
  const hours = new Map([['2025-12-15T05', { mean: 10, n: 3 }], ['2025-12-15T06', { mean: 20, n: 3 }]]);
  assert.deepEqual(window24(hours, '2025-12-15T07'), { value: 15, hours: 2 });
});

test('an 8-hour value is the maximum rolling 8-hour mean inside the 24 hours', () => {
  const hours = new Map();
  for (let i = 0; i < 24; i++) hours.set(`2025-12-15T${String(i).padStart(2, '0')}`, { mean: i < 8 ? 100 : 10, n: 3 });
  assert.deepEqual(window8(hours, '2025-12-16T00'), { value: 100, hours: 24 });
});
