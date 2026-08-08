import test from 'node:test';
import assert from 'node:assert/strict';

const { heatRampRgb, wardFieldCoordinates } = await import('../../src/scripts/climate-engine/explore/core-field-layer.ts');
const { WARD_MAP } = await import('../../src/data/wards.ts');

test('core heat ramp preserves the relief colour endpoints', () => {
  assert.deepEqual(heatRampRgb(20, 20, 40), [111, 202, 214]);
  assert.deepEqual(heatRampRgb(40, 20, 40), [229, 72, 77]);
});

test('core field coordinates are north-up and clockwise', () => {
  const [nw, ne, se, sw] = wardFieldCoordinates(WARD_MAP.ballygunge, 1400);
  assert.ok(nw[1] > sw[1]);
  assert.ok(ne[1] > se[1]);
  assert.ok(ne[0] > nw[0]);
  assert.ok(se[0] > sw[0]);
});
