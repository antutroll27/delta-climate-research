import assert from 'node:assert/strict';
import test from 'node:test';

import { assertHeatRequest } from '../../src/scripts/climate-engine/sim-protocol.ts';
import { gridFor } from '../../src/scripts/climate-engine/types.ts';

function request(n, sizeM) {
  const count = n * n;
  const layer = () => new Float32Array(count);
  return {
    generation: 0,
    grid: { n, cellMeters: sizeM / n },
    layers: { albedo: layer(), veg: layer(), built: layer(), water: layer() },
    params: {}, settleSteps: 10, thresholdC: 30, sizeM,
  };
}

test('a 2800 m ward at 384 cells is accepted', () => {
  assert.doesNotThrow(() => assertHeatRequest(request(384, 2800)));
});

test('a 1400 m ward at 192 cells is still accepted', () => {
  assert.doesNotThrow(() => assertHeatRequest(request(192, 1400)));
});

test('a mismatched pair is refused, even though every array length is right', () => {
  assert.throws(() => assertHeatRequest(request(384, 1400)), /grid/i);
  assert.throws(() => assertHeatRequest(request(192, 2800)), /grid/i);
});

test('gridFor is the only place ward size maps to cells', () => {
  assert.equal(gridFor(1400).n, 192);
  assert.equal(gridFor(2800).n, 384);
  assert.equal(gridFor(700), undefined);
});
