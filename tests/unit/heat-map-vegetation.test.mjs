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

import { blendCanopyIntoVeg } from '../../src/scripts/climate-engine/ward-raster.ts';

test('canopy blend preserves the ward-mean vegetation but redistributes it', () => {
  const n = 4, count = n * n;
  const veg = new Float32Array(count).fill(0.3);
  const canopy = new Float32Array(count);            // tall canopy only in the top half
  for (let i = 0; i < count; i++) canopy[i] = i < count / 2 ? 10 : 0;
  const before = veg.reduce((a, b) => a + b, 0) / count;
  const out = blendCanopyIntoVeg(veg, canopy, 0.5);
  const after = out.reduce((a, b) => a + b, 0) / count;
  assert.ok(Math.abs(before - after) < 1e-6, 'ward mean is preserved (CEO scalar must not move)');
  const hi = out.slice(0, count / 2).reduce((a, b) => a + b, 0);
  const lo = out.slice(count / 2).reduce((a, b) => a + b, 0);
  assert.ok(hi > lo, 'vegetation shifts toward tall canopy');
  for (const v of out) assert.ok(v >= 0 && v <= 1, 'stays in [0,1]');
});

import { asTreesFile, assertVegetationLogic, createVegetationLayer, TREE_COLS } from '../../src/scripts/climate-engine/vegetation-layer.ts';

const HEADER = { ward: 'x', grid: 140, sizeM: 1400, retrieved: '2026-08-10',
  cols: ['x_m', 'y_m', 'h_dm', 'r_dm', 'species'], speciesNames: ['neem', 'gulmohar', 'palm'] };

test('asTreesFile decodes rows into the objects the layer draws', () => {
  assert.deepEqual([...TREE_COLS], HEADER.cols, 'the column order is the contract with scripts/_trees.py');
  const f = asTreesFile({ ...HEADER, trees: [[1, -2, 63, 21, 2], [-916, 1395, 43, 15, 0]] });
  assert.ok(f, 'valid rows accepted');
  assert.deepEqual(f.trees[0], { x: 1, y: -2, h: 6.3, species: 'palm', r: 2.1 });
  assert.equal(f.trees[1].species, 'neem');
});

test('asTreesFile refuses the old object rows rather than rendering half a migration', () => {
  assert.equal(asTreesFile({ ...HEADER, trees: [{ x: 1, y: 2, h: 6, species: 'neem', r: 2 }] }), null);
  assert.equal(asTreesFile({ ward: 'x', grid: 140, sizeM: 1400, trees: [{ x: 1, y: 2, h: 6, species: 'neem', r: 2 }] }), null);
});

test('asTreesFile refuses a header or row it cannot trust', () => {
  assert.equal(asTreesFile(null), null, 'null rejected');
  assert.equal(asTreesFile({ ...HEADER, trees: 'no' }), null, 'trees must be an array');
  assert.equal(asTreesFile({ ...HEADER, cols: ['y_m', 'x_m', 'h_dm', 'r_dm', 'species'], trees: [] }), null, 'swapped columns');
  assert.equal(asTreesFile({ ...HEADER, speciesNames: ['oak'], trees: [[0, 0, 50, 10, 0]] }), null, 'unknown species name');
  assert.equal(asTreesFile({ ...HEADER, trees: [[0, 0, 50, 10, 3]] }), null, 'species index out of range');
  assert.equal(asTreesFile({ ...HEADER, trees: [[0, 0, 50, 10]] }), null, 'short row');
  assert.equal(asTreesFile(JSON.parse(`{"cols":${JSON.stringify(HEADER.cols)},"speciesNames":["neem"],"trees":[[1e400,0,50,10,0]]}`)),
    null, 'a non-finite position (1e400 parses to Infinity)');
});

test('vegetation self-check passes', () => { assertVegetationLogic(); });
