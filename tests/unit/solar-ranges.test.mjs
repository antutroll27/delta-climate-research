import assert from 'node:assert/strict';
import test from 'node:test';

import { pvRanges } from '../../src/scripts/climate-engine/solar-ranges.ts';

// Fixture: one screened roof (index 0) and one zero-capacity roof (index 1),
// under the same ward tiers block published by build-pv-yield.py.
const pv = {
  kwp: [7.3, 0],
  loss: [0.09, 0],
  loss_strict: [0.04, 0],
  packing_factor: 0.28,
  tiers: {
    yield_bracket_kwh_per_kwp: [1200, 1450],
    packing_range: [0.28, 0.40],
  },
};

test('pvRanges multiplies published numbers only, and pins the exact figures', () => {
  // kwpHigh = 7.3 × 0.40/0.28 = 10.428571… → 10.43 to 2 dp.
  // kwhLow  = round(7.3 × 1200 × (1 − 0.09)) = round(7,972.4)  = 7972.
  // kwhHigh = round(10.43 × 1450 × (1 − 0.04)) = round(14,518.56) = 14519.
  // (Measured with node, not assumed: 10.43 × 1450 × 0.96 = 14518.56, which
  // rounds to 14519 — not 14523. Flagging this in the report: the task brief's
  // worked example states 14523, but re-deriving the arithmetic gives 14519.)
  assert.deepEqual(pvRanges(pv, 0), {
    kwpLow: 7.3,
    kwpHigh: 10.43,
    kwhLow: 7972,
    kwhHigh: 14519,
  });
});

test('the screen\'s own point estimate sits inside its own range', () => {
  const r = pvRanges(pv, 0);
  const screenedKwh = 9470; // build-pv-yield.py's central-cell (A1) point estimate for this roof.
  assert.ok(
    r.kwhLow <= screenedKwh && screenedKwh <= r.kwhHigh,
    `expected the screened point ${screenedKwh} to sit inside [${r.kwhLow}, ${r.kwhHigh}]`,
  );
});

test('a roof with zero capacity returns all zeros', () => {
  assert.deepEqual(pvRanges(pv, 1), {
    kwpLow: 0,
    kwpHigh: 0,
    kwhLow: 0,
    kwhHigh: 0,
  });
});

test('pvRanges is a pure product — it does not clamp even when loss_strict > loss', () => {
  // Real artefacts guarantee loss_strict <= loss (the strict mask can only
  // remove canopy from the central-cell mask, never add shading back), so
  // this ordering cannot occur in production. It is cheap to pin anyway:
  // the function must not special-case or clamp for it, it just multiplies.
  const inverted = {
    kwp: [10],
    loss: [0.09],
    loss_strict: [0.15],
    packing_factor: 0.28,
    tiers: {
      yield_bracket_kwh_per_kwp: [1200, 1450],
      packing_range: [0.28, 0.40],
    },
  };
  // kwpHigh = 10 × 0.40/0.28 = 14.285714… → 14.29 to 2 dp.
  // kwhLow  = round(10 × 1200 × 0.91) = 10920.
  // kwhHigh = round(14.29 × 1450 × 0.85) = round(17,612.425) = 17612.
  assert.deepEqual(pvRanges(inverted, 0), {
    kwpLow: 10,
    kwpHigh: 14.29,
    kwhLow: 10920,
    kwhHigh: 17612,
  });
});
