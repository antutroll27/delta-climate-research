import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ROAD_WIDTH_M, roadHalfWidthM, buildRoadMesh } from
  '../../src/scripts/climate-engine/road-ribbon.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => readFile(join(ROOT, 'src/scripts/climate-engine', p), 'utf8');

/** Source with comments stripped. The render-only guards below must test what
 *  the code REACHES, not what the documentation names — road-ribbon.ts's header
 *  is required to say "SimLayers" out loud, and a guard that forbade the word
 *  would forbid the explanation of why the word matters. */
const code = async (p) => (await src(p))
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

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
  const mesh = buildRoadMesh(STRAIGHT, (_x, y) => y * 0.1);
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

test('the sim keeps its own road radius, and it is a corridor not a carriageway', async () => {
  const model = await src('heat-map-model.ts');
  assert.match(model, /rad = way\.w > 1 \? 2 : 1/,
    'buildSpatial\'s corridor radius changed. At dx ≈ 7.29 m/cell this is a 36.5 m / '
    + '21.9 m TREE-PLANTING band, not a road width — it feeds corridorSorted → '
    + 'treeCorridorCells → published cost and cooling, and compare/paired-runner.ts '
    + 'builds Spatial too. If you came here to match the drawn widths in '
    + 'road-ribbon.ts, do not: they measure different things.');
  assert.doesNotMatch(model, /ROAD_WIDTH_M/,
    'the drawn width table must not leak into the model — one width, one purpose');
});

test('the road layer stays render-only', async () => {
  for (const f of ['road-ribbon.ts', 'road-layer.ts']) {
    const text = await code(f);
    assert.doesNotMatch(text, /SimLayers/,
      `${f} must not reach the simulation's layers`);
    assert.doesNotMatch(text, /buildSpatial|Spatial\b/,
      `${f} must not reach the intervention targeting`);
  }
});

test('the width table says which number is measured and which is assumed', () => {
  assert.equal(ROAD_WIDTH_M[2].widthM, 14,
    'derived from OSM lanes on 24/31 primary ways (22 × 4 lanes) at 3.25 m/lane. '
    + 'Changing it needs a new survey, not a new opinion.');
  assert.equal(ROAD_WIDTH_M[2].source, 'osm-lanes');
  assert.equal(ROAD_WIDTH_M[1].widthM, 4,
    'assumed. OSM has zero width tags for Kolkata; 5 lane tags across 390 minor '
    + 'ways is not a sample. Widening this manufactures building overlap that '
    + 'the measurement says is not there.');
  assert.equal(ROAD_WIDTH_M[1].source, 'assumed');
  assert.notEqual(ROAD_WIDTH_M[1].source, ROAD_WIDTH_M[2].source,
    'if both classes ever claim the same provenance, one of them is lying');
});

test('the basemap casing we replaced stays hidden, in both styles', async () => {
  /* Asserted against the EXPORTED constant, not a string literal in the app.
     This guard previously grepped heat-map-app.ts for `'highway_minor'` and broke
     the moment those ids were lifted into road-labels.ts — firing on a refactor
     rather than on the regression it exists for. Reading the constant means it
     follows the ids wherever they live. */
  const { REPLACED_ROAD_GEOMETRY } = await import('../../src/scripts/climate-engine/road-labels.ts');
  for (const id of ['highway_minor', 'highway_major_casing',
                    'highway_major_inner', 'highway_major_subtle']) {
    assert.ok(REPLACED_ROAD_GEOMETRY.includes(id),
      `${id} is no longer hidden. The basemap paints it in SCREEN PIXELS, so `
      + 'leaving it visible puts a road of no real width under every building '
      + 'and makes the whole metre-true road layer decorative.');
  }
  const app = await src('heat-map-app.ts');
  /* Matched loosely on purpose, and for the SECOND time. The comment at the top of
     this test records the guard once firing on a refactor rather than a regression;
     pinning the exact loop text `for (const id of REPLACED_ROAD_GEOMETRY)` did it
     again the moment the building ids were spread into the same loop (2026-08-13,
     OBOS Slate). What matters is that the list reaches setLayoutProperty, not how
     the iteration is spelled. */
  assert.match(app, /for \(const id of [^)]*REPLACED_ROAD_GEOMETRY/,
    'the app must actually iterate the list — exporting it is not hiding anything');

  /* Buildings joined the same rule when the basemap gained real massing. Upstream
     drew a flat near-black fill that vanished under the 3D city, so leaving it
     visible cost nothing. OBOS Slate's `building_3d` is a fill-extrusion, and the
     basemap extrudes OSM `render_height` while the relief renderer extrudes our
     MEASURED heights — two disagreeing 3D cities in one scene z-fight per building.
     `building` rides along because hiding one of a pair reads as arbitrary. */
  for (const id of ['building', 'building_3d']) {
    assert.match(app, new RegExp(`REPLACED_BUILDING_GEOMETRY[\\s\\S]{0,120}'${id}'`),
      `${id} must be listed in REPLACED_BUILDING_GEOMETRY, or relief mode draws the `
      + "basemap's buildings on top of the Three.js city that replaced them");
  }
  assert.match(app, /for \(const id of [^)]*REPLACED_BUILDING_GEOMETRY/,
    'REPLACED_BUILDING_GEOMETRY must be iterated in the visibility loop too');
  /* It must live in the `on` handler: setEnv's setStyle rebuilds the style, and
     a `once` would let the casing return the moment someone switches to studio. */
  assert.match(app, /map\.on\('style\.load'/,
    'the hide must ride the re-firing style.load handler, not a once');
});
