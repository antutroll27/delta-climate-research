import assert from 'node:assert/strict';
import test from 'node:test';
import { asCanopyRaster, assertCanopyLogic } from '../../src/scripts/climate-engine/surface-raster.ts';

test('asCanopyRaster rejects malformed input and accepts a valid field', () => {
  assert.equal(asCanopyRaster(null, 'x'), null, 'null is not a canopy raster');
  assert.equal(asCanopyRaster({ n: 4 }, 'x'), null, 'missing height rejected');
  const n = 4, height = new Float32Array(n * n).fill(3);
  const c = asCanopyRaster({ ward: 'x', n, hi: 30, height }, 'x');
  assert.ok(c && c.height.length === n * n, 'valid canopy raster accepted');
});

test('canopy self-check passes', () => { assertCanopyLogic(); });
