import assert from 'node:assert/strict';
import test from 'node:test';

import { fallbackTair, T_MAX_HOUR, T_MIN_HOUR } from '../../src/scripts/climate-engine/heat-map-model.ts';

/* A flat-by-month fixture so the diurnal shape is the only thing under test. */
const N = {
  station: 'fixture', period: 'fixture', source: 'fixture', measured: false,
  maxC: Array(12).fill(30), minC: Array(12).fill(20),
};
const at = (hour, month = 4) => fallbackTair(N, { month, hour });

test('the curve hits the minimum at dawn and the maximum mid-afternoon', () => {
  assert.equal(T_MIN_HOUR, 6);
  assert.equal(T_MAX_HOUR, 14);
  assert.equal(at(6), 20);
  assert.equal(at(14), 30);
  assert.ok(Math.abs(at(10) - 25) < 1e-9, 'halfway up the morning rise is the midpoint');
  assert.ok(Math.abs(at(22) - 25) < 1e-9, 'halfway down the evening fall is the midpoint');
});

test('the curve is continuous at both joins', () => {
  assert.ok(Math.abs(at(5.9999) - at(6)) < 1e-3, 'jump at dawn');
  assert.ok(Math.abs(at(13.9999) - at(14)) < 1e-3, 'jump at the afternoon peak');
});

test('the month picks the row, and hours wrap', () => {
  const byMonth = { ...N, maxC: N.maxC.map((_, i) => 20 + i), minC: N.minC.map((_, i) => 10 + i) };
  assert.equal(fallbackTair(byMonth, { month: 1, hour: 14 }), 20);
  assert.equal(fallbackTair(byMonth, { month: 12, hour: 14 }), 31);
  assert.equal(at(30), at(6), 'hour 30 is 06:00 the next day');
  assert.equal(at(-2), at(22), 'hour -2 is 22:00 the day before');
});
