import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findCoolingSurfaces, nearestCooling, VEG_THRESHOLD, MIN_PATCH_M2,
} from '../../src/scripts/climate-engine/explore/cooling-surfaces.ts';
import {
  buildRegistry, pickBuilding, projectWard,
} from '../../src/scripts/climate-engine/explore/building-pick.ts';

/* ————— cooling surfaces ————— */

// 8×8 grid, 100 m cells (10,000 m² each — one cell beats the 7,700 m² floor).
const N = 8, CELL_M2 = 100 * 100;
const grid = (cells) => {
  const v = new Float32Array(N * N);
  for (const [x, y] of cells) v[y * N + x] = 0.9;
  return v;
};

test('cooling surfaces: threshold, connectivity and the area floor behave', () => {
  // One 2×2 patch (4 ha) and one lone cell far away, DIAGONAL to nothing.
  const veg = grid([[1, 1], [2, 1], [1, 2], [2, 2], [6, 6]]);
  const cs = findCoolingSurfaces(veg, N, CELL_M2);
  // 4-connectivity: both survive the floor (each ≥ 1 cell = 10,000 m² ≥ 7,700)
  assert.equal(cs.patchCount, 2);
  assert.equal(cs.cells.length, 5);

  // Raise the floor above one cell: the loner dies, the 2×2 lives.
  const big = findCoolingSurfaces(veg, N, CELL_M2, VEG_THRESHOLD, 3 * CELL_M2);
  assert.equal(big.patchCount, 1);
  assert.equal(big.cells.length, 4);

  // Below-threshold vegetation is never counted.
  const sparse = new Float32Array(N * N).fill(VEG_THRESHOLD - 0.01);
  assert.equal(findCoolingSurfaces(sparse, N, CELL_M2).patchCount, 0);
});

test('cooling surfaces: flood fill does not wrap around row edges', () => {
  // Right edge of row 0 and left edge of row 1 are adjacent in the flat array
  // but NOT on the grid. A wrap bug would merge them into one patch.
  const veg = grid([[7, 0], [0, 1]]);
  const cs = findCoolingSurfaces(veg, N, CELL_M2);
  assert.equal(cs.patchCount, 2);
});

test('nearestCooling: measures from the nearest ring corner when given one', () => {
  // Grid spans ±400 m (8 × 100 m). Patch at cell (7,3) → centre x = 350, z = -50.
  const veg = grid([[7, 3]]);
  const cs = findCoolingSurfaces(veg, N, CELL_M2);

  // A 60 m-wide building whose centroid sits at the origin.
  const ring = [-30, -50, 30, -50, 30, 50, -30, 50];
  const fromCentroid = nearestCooling(cs, 0, 0, N, 800);
  const fromEdge = nearestCooling(cs, 0, 0, N, 800, ring);
  assert.ok(fromCentroid && fromEdge);
  // The corner at x=30 is 60 m closer to the patch than the centroid is.
  assert.ok(fromEdge.distM < fromCentroid.distM - 30,
    `edge ${fromEdge.distM} should beat centroid ${fromCentroid.distM} by the half-width`);

  // No qualifying patch is a real answer, not a zero.
  assert.equal(nearestCooling(findCoolingSurfaces(grid([]), N, CELL_M2), 0, 0, N, 800), null);
});

test('cooling constants stay in their honest range', () => {
  // The UI copy ("0.77 ha or more") and the TRA-derived floor are load-bearing;
  // a drive-by edit to either should fail loudly, not silently reword the map.
  assert.equal(MIN_PATCH_M2, 7_700);
  assert.ok(VEG_THRESHOLD >= 0.45 && VEG_THRESHOLD <= 0.55);
});

/* ————— building pick ————— */

// Orthographic top-down clip matrix over ±700 m, column-major:
// clip.x = x/700, clip.y = z/700, w = 1. Screen y grows downward in projectWard,
// so +z lands in the lower half — exactly the convention the renderer uses.
const ORTHO = { elements: [
  1 / 700, 0, 0, 0,
  0, 0, 0, 0,
  0, 1 / 700, 0, 0,
  0, 0, 0, 1,
] };

test('projectWard maps ward metres to CSS pixels through the clip matrix', () => {
  const c = projectWard(ORTHO, 0, 0, 0, 1000, 1000);
  assert.equal(Math.round(c.x), 500);
  assert.equal(Math.round(c.y), 500);
  const e = projectWard(ORTHO, 700, 0, 0, 1000, 1000);
  assert.equal(Math.round(e.x), 1000);           // east edge → right edge
  const s = projectWard(ORTHO, 0, 0, 700, 1000, 1000);
  assert.equal(Math.round(s.y), 0);              // +z → clip.y +1 → top of screen
  // Behind-camera points must be flagged, never drawn at a bogus position.
  assert.ok(projectWard({ elements: ORTHO.elements.map((v, i) => i === 15 ? -1 : v) },
    0, 0, 0, 1000, 1000).w <= 0);
});

test('buildRegistry: closed rings still yield exact areas and fill flags', () => {
  // 20×10 m rectangle written the way the ward files ship: first vertex repeated.
  const rows = [
    [12, 0, 0, 20, 0, 20, 10, 0, 10, 0, 0],
    [2.5, 100, 100, 110, 100, 110, 110, 100, 110, 100, 100],
  ];
  const reg = buildRegistry(rows);
  assert.equal(reg.length, 2);
  // Shoelace over a closed ring: the duplicated vertex contributes zero area.
  assert.equal(Math.round(reg[0].areaM2), 200);
  assert.equal(reg[0].fill, false);
  assert.equal(reg[1].fill, true);               // 2.5 m is the Google fill value
});

test('pickBuilding: hits the right building, prefers the nearer, misses empty ground', () => {
  const reg = buildRegistry([
    [30, -100, -100, 100, -100, 100, 100, -100, 100, -100, -100],  // big, tall, centred
    [10, 400, 400, 500, 400, 500, 500, 400, 500, 400, 400],        // small, off to the SE
  ]);
  const px = (x, z) => projectWard(ORTHO, x, z === undefined ? 0 : 0, z ?? 0, 1000, 1000);

  // Dead centre → building 0's roof.
  const centre = px(0, 0);
  assert.equal(pickBuilding(ORTHO, reg, centre.x, centre.y, 1000, 1000), 0);

  // Over the small building's footprint → building 1.
  const se = px(450, 450);
  assert.equal(pickBuilding(ORTHO, reg, se.x, se.y, 1000, 1000), 1);

  // Far corner with nothing in it → miss, not a forced nearest match.
  const empty = px(-650, 650);
  assert.equal(pickBuilding(ORTHO, reg, empty.x, empty.y, 1000, 1000), -1);
});
