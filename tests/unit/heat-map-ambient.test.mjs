import assert from 'node:assert/strict';
import test from 'node:test';
import { asAmbient, eqCell, heatIndexC } from '../../src/scripts/climate-engine/heat-map-model.ts';
import { DEFAULT_PARAMS } from '../../src/scripts/climate-engine/types.ts';

/**
 * THE ONE INGEST ON THIS PAGE THAT COMES FROM SOMEONE ELSE'S SERVER, IN REAL TIME.
 *
 * api/live.js is a transparent proxy — met.no's body reaches the client verbatim —
 * and `air_temperature`, `relative_humidity` and `wind_speed` are ALL optional in
 * met.no's schema. Before `asAmbient` the client read them straight off the object,
 * so a response that arrived whole but short of a field became a complete reading
 * holding `undefined`, and nothing anywhere said so.
 *
 * These tests pin both halves: what such a body used to do to the physics, and
 * that the parser now refuses it.
 */

/** A body shaped exactly like met.no's, minus whatever the caller drops. */
const body = (details) => ({
  properties: { timeseries: [{ time: '2026-08-31T09:00:00Z', data: { instant: { details } } }] },
});
const FULL = {
  air_temperature: 29.4, relative_humidity: 71,
  wind_speed: 2.4, cloud_area_fraction: 38, wind_from_direction: 190,
};

test('a complete reading survives intact, with feels derived and validAt carried', () => {
  const a = asAmbient(body(FULL));
  assert.ok(a, 'a complete met.no body must parse');
  assert.equal(a.tAir, 29.4);
  assert.equal(a.rh, 71);
  assert.equal(a.wind, 2.4);
  assert.equal(a.cloud, 38);
  assert.equal(a.windFrom, 190);
  assert.equal(a.validAt, '2026-08-31T09:00:00Z');
  assert.equal(a.feels, heatIndexC(29.4, 71));
});

/**
 * WHY THE REFUSAL HAS TO BE TOTAL, demonstrated rather than asserted.
 *
 * `Math.max` does not clamp NaN — `Math.max(0.3, undefined / 3)` is NaN, not 0.3 —
 * so the clamp in `currentParams` that looks like a guard is not one. A missing
 * wind reached `eqCell` as a NaN `k` and took the entire field with it.
 */
test('a missing number would have poisoned the whole field, which is why it is refused', () => {
  const clamped = Math.min(2.5, Math.max(0.3, undefined / 3));
  assert.ok(Number.isNaN(clamped), 'the clamp does not sanitise — this is the trap');
  assert.ok(Number.isNaN(eqCell({ ...DEFAULT_PARAMS, wind: clamped }, 0.2, 0.3, 0.5)),
    'a NaN wind makes every cell NaN');

  for (const field of ['air_temperature', 'relative_humidity', 'wind_speed']) {
    const short = { ...FULL };
    delete short[field];
    assert.equal(asAmbient(body(short)), null, `a body with no ${field} must be refused`);
  }
});

test('a null or non-finite number is refused as firmly as an absent one', () => {
  /* JSON carries no NaN, but it does carry null — and `Number(null)` is 0, so a
     lazier check would have turned "no reading" into "0 °C, dead calm". */
  for (const bad of [null, 'warm', Infinity, -Infinity, {}, []]) {
    assert.equal(asAmbient(body({ ...FULL, air_temperature: bad })), null,
      `air_temperature=${JSON.stringify(bad)} must be refused`);
    assert.equal(asAmbient(body({ ...FULL, wind_speed: bad })), null,
      `wind_speed=${JSON.stringify(bad)} must be refused`);
  }
});

test('cloud and wind direction are optional, because the model can run without them', () => {
  /* Refusing these would throw away a reading the physics can use in full: cloud
     only tints the sky term and already had a fallback, and direction drives
     cloud drift and nothing else. */
  const a = asAmbient(body({ air_temperature: 30, relative_humidity: 60, wind_speed: 1.2 }));
  assert.ok(a, 'a reading with the three required numbers must parse');
  assert.equal(a.cloud, 0, 'absent cloud falls back to clear rather than refusing');
  assert.equal(a.windFrom, undefined, 'absent direction stays absent');
});

test('an undated reading parses but carries no validAt, so the dial cannot call it fresh', () => {
  /* The freshness dial ages `validAt`. Inventing one here would manufacture the
     exact "claims to be live" defect the dial exists to prevent. */
  const undated = { properties: { timeseries: [{ data: { instant: { details: FULL } } }] } };
  const a = asAmbient(undated);
  assert.ok(a, 'a reading without a timestamp is still a usable reading');
  assert.equal(a.validAt, undefined, 'an unknown age must stay unknown');
});

test('a reshaped or empty envelope is refused rather than crashed on', () => {
  for (const bad of [null, undefined, 42, 'nope', {}, { properties: {} },
    { properties: { timeseries: [] } }, { properties: { timeseries: [{}] } },
    { properties: { timeseries: [{ data: { instant: {} } }] } }]) {
    assert.equal(asAmbient(bad), null, `${JSON.stringify(bad)} must be refused, not thrown on`);
  }
});
