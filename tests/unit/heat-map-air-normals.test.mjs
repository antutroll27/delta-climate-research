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

test('a non-finite clock is refused, never turned into a NaN air temperature', () => {
  assert.throws(() => at(Number.NaN), RangeError);
  assert.throws(() => fallbackTair(N, { month: Number.NaN, hour: 14 }), RangeError);
  assert.throws(() => at(Number.POSITIVE_INFINITY), RangeError);
});

import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';

/* THE TRANSCRIPTION PIN. IMD, Climatological Tables of Observatories in India
   1991–2020 (National Data Centre, Pune). If a registry number drifts from the
   published table, this fails; it is the table, not a copy of the registry. */
const IMD = {
  bengaluru: {
    maxC: [28.4, 30.9, 33.4, 34.1, 33.1, 29.7, 28.3, 28.1, 28.6, 28.5, 27.4, 26.9],
    minC: [16.1, 17.6, 20.2, 22.1, 21.8, 20.6, 20.1, 20.0, 20.0, 19.8, 18.3, 16.4],
  },
  kolkata: {
    maxC: [25.5, 29.4, 33.7, 35.4, 35.5, 34.1, 32.5, 32.3, 32.6, 32.3, 30.2, 26.7],
    minC: [14.3, 18.1, 22.9, 25.7, 26.8, 27.1, 26.7, 26.6, 26.3, 24.4, 20.1, 15.5],
  },
};

test('every city carries twelve sane normals', () => {
  for (const key of ['in/kolkata/ballygunge', 'in/bengaluru/indiranagar', 'ae/dubai/creek']) {
    const n = resolve(key).climate.airNormals;
    assert.equal(n.maxC.length, 12, key);
    assert.equal(n.minC.length, 12, key);
    for (let i = 0; i < 12; i++) {
      assert.ok(Number.isFinite(n.maxC[i]) && Number.isFinite(n.minC[i]), `${key} month ${i + 1}`);
      assert.ok(n.minC[i] <= n.maxC[i], `${key} month ${i + 1}: min above max`);
      assert.ok(n.minC[i] > 0 && n.maxC[i] < 50, `${key} month ${i + 1}: implausible`);
    }
  }
});

test('the Indian normals are IMD 1991–2020, transcribed exactly', () => {
  const b = resolve('in/bengaluru/indiranagar').climate.airNormals;
  const k = resolve('in/kolkata/ballygunge').climate.airNormals;
  assert.deepEqual([...b.maxC], IMD.bengaluru.maxC);
  assert.deepEqual([...b.minC], IMD.bengaluru.minC);
  assert.deepEqual([...k.maxC], IMD.kolkata.maxC);
  assert.deepEqual([...k.minC], IMD.kolkata.minC);
  assert.equal(b.measured, true);
  assert.equal(k.measured, true);
  assert.equal(resolve('ae/dubai/creek').climate.airNormals.measured, false, 'Dubai is a flagged placeholder');
});

test('a Bengaluru December night is cooler than an April afternoon, and the cities differ', () => {
  const b = resolve('in/bengaluru/mg-road').climate.airNormals;
  const k = resolve('in/kolkata/ballygunge').climate.airNormals;
  assert.ok(fallbackTair(b, { month: 12, hour: 3 }) < fallbackTair(b, { month: 4, hour: 13 }) - 10);
  assert.notEqual(fallbackTair(b, { month: 5, hour: 14 }), fallbackTair(k, { month: 5, hour: 14 }));
});
