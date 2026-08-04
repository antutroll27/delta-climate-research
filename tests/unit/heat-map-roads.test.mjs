import assert from 'node:assert/strict';
import test from 'node:test';
import { ROAD_WIDTH_M, roadHalfWidthM, buildRoadMesh } from
  '../../src/scripts/climate-engine/road-ribbon.ts';

/** A single straight way, 100 m due north, on flat ground. */
const STRAIGHT = { ways: [{ w: 1, p: [0, 0, 0, 100] }] };
const FLAT = () => 0;

test('a straight minor way becomes a quad of exactly the tabled width', () => {
  const mesh = buildRoadMesh(STRAIGHT, FLAT);
  assert.ok(mesh, 'a two-point way must produce geometry');
  assert.equal(mesh.positions.length, 4 * 3, 'two points → two vertices each → 4 × xyz');
  assert.equal(mesh.indices.length, 6, 'one segment → two triangles');

  const half = roadHalfWidthM(1);
  assert.equal(half, ROAD_WIDTH_M[1].widthM / 2);
  // Vertices 0 and 1 are the two sides of the first point, offset along ±x.
  const x0 = mesh.positions[0], x1 = mesh.positions[3];
  assert.ok(Math.abs(Math.abs(x1 - x0) - ROAD_WIDTH_M[1].widthM) < 1e-6,
    `a way running north must be ${ROAD_WIDTH_M[1].widthM} m wide across x, got ${x1 - x0}`);
  // z carries the data's y (northward) unchanged — the frame must not flip.
  assert.equal(mesh.positions[2], 0);
  assert.equal(mesh.positions[8], 100, 'the far point keeps its northing as world z');
});

test('a right-angle corner mitres instead of pinching or spiking', () => {
  // East 100 m, then north 100 m. The inside/outside offset at the corner must be
  // half-width / cos(45°) = half × √2, or the two quads leave a wedge-shaped gap.
  const mesh = buildRoadMesh({ ways: [{ w: 1, p: [0, 0, 100, 0, 100, 100] }] }, FLAT);
  assert.ok(mesh);
  const half = roadHalfWidthM(1);
  // Corner is point index 1 → vertices 2 and 3.
  const cx = [mesh.positions[6], mesh.positions[9]];
  const cz = [mesh.positions[8], mesh.positions[11]];
  const d = Math.hypot(cx[0] - cx[1], cz[0] - cz[1]) / 2;
  assert.ok(Math.abs(d - half * Math.SQRT2) < 1e-6,
    `a 90° mitre must offset ${half * Math.SQRT2} m, got ${d}`);
});

test('a hairpin is clamped rather than allowed to spike to infinity', () => {
  // Doubling back: the exact mitre is 1/cos(~90°) → unbounded. MITRE_MAX caps it.
  const mesh = buildRoadMesh({ ways: [{ w: 2, p: [0, 0, 100, 0, 0, 0.5] }] }, FLAT);
  assert.ok(mesh);
  const half = roadHalfWidthM(2);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const r = Math.hypot(mesh.positions[i], mesh.positions[i + 2]);
    assert.ok(r < 100 + half * 4,
      `vertex at radius ${r} escaped — the mitre clamp is not holding`);
  }
});

test('the ground is sampled per vertex, in the data frame', () => {
  // A ramp in y only: the near end sits at 0, the far end at 100 × 0.1.
  const mesh = buildRoadMesh(STRAIGHT, (x, y) => y * 0.1);
  assert.equal(mesh.positions[1], 0.75, 'near end = ground 0 + ROAD_Y');
  assert.equal(mesh.positions[7], 10.75, 'far end = ground 10 + ROAD_Y');
});

test('degenerate ways are dropped, not drawn as slivers', () => {
  assert.equal(buildRoadMesh({ ways: [] }, FLAT), null);
  assert.equal(buildRoadMesh({ ways: [{ w: 1, p: [5, 5] }] }, FLAT), null,
    'a single point is not a way');
  assert.equal(buildRoadMesh({ ways: [{ w: 1, p: [5, 5, 5, 5] }] }, FLAT), null,
    'a zero-length way is not a way');
});

test('an unknown class falls back to the minor width rather than vanishing', () => {
  assert.equal(roadHalfWidthM(7), ROAD_WIDTH_M[1].widthM / 2);
  assert.equal(roadHalfWidthM(0), ROAD_WIDTH_M[1].widthM / 2);
});
