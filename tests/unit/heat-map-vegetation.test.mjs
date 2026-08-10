import assert from 'node:assert/strict';
import test from 'node:test';
import { asCanopyRaster, assertCanopyLogic, canopyHeightsFromPixels } from '../../src/scripts/climate-engine/surface-raster.ts';

test('asCanopyRaster rejects malformed input and accepts a valid field', () => {
  assert.equal(asCanopyRaster(null, 'x'), null, 'null is not a canopy raster');
  assert.equal(asCanopyRaster({ n: 4 }, 'x'), null, 'missing height rejected');
  const n = 4, height = new Float32Array(n * n).fill(3);
  const c = asCanopyRaster({ ward: 'x', n, hi: 30, height }, 'x');
  assert.ok(c && c.height.length === n * n, 'valid canopy raster accepted');
});

test('canopy self-check passes', () => { assertCanopyLogic(); });

test('canopyHeightsFromPixels applies the N->S row flip and dequantises the R channel', () => {
  // 2x2 image, RGBA. Row 0 (north) reds = [255,0]; row 1 (south) reds = [0,128]. hi=30.
  const n = 2;
  const data = new Uint8ClampedArray([
    255,0,0,255,   0,0,0,255,     // PNG row 0 (north)
    0,0,0,255,     128,0,0,255,   // PNG row 1 (south)
  ]);
  const h = canopyHeightsFromPixels(data, n, 30);
  // sim grid row 0 = SOUTH, so output row 0 must come from PNG row 1.
  assert.equal(h.length, 4);
  assert.ok(Math.abs(h[0] - 0) < 1e-6, 'out[0] = south-west = PNG row1 col0 = 0m');
  assert.ok(Math.abs(h[1] - (128/255)*30) < 1e-4, 'out[1] = south-east = PNG row1 col1');
  assert.ok(Math.abs(h[2] - 30) < 1e-4, 'out[2] = north-west = PNG row0 col0 = 255->30m');
  assert.ok(Math.abs(h[3] - 0) < 1e-6, 'out[3] = north-east = PNG row0 col1 = 0m');
});
