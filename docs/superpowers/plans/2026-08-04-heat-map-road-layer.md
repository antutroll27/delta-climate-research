# Heat-map road layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the ward's OSM roads as draped three.js ribbons at honest widths, so the
buildings sit against *our* road geometry instead of the basemap's wider painted casing.

**Architecture:** Two files, mirroring the existing `water-depth.ts` / `water-layer.ts`
pair. `road-ribbon.ts` is pure array maths — centreline to mitred quad strip, draped by
an injected `groundAt` — and is node-testable with no THREE, no canvas, no DOM.
`road-layer.ts` wraps that in one `THREE.Mesh` with a six-line shader that shares the
facade's `uGrow` uniform, so roads fade in with the same reconstruction the buildings
play. The simulation is not touched.

**Tech Stack:** TypeScript, three.js (BufferGeometry + ShaderMaterial), MapLibre custom
layer (already present), `node --test` with `tsx`.

---

## Why these widths, and why this is safe

Read this before Task 1. Both facts were measured this session and both are load-bearing.

**The widths.** An Overpass survey of the 447 `highway` ways inside the Ballygunge
window found **zero** `width` tags and **zero** `est_width` tags. It found `lanes` on
**24 of 31 `primary` ways** — 22 at 4 lanes, 2 at 8. At 3.25 m per lane that is a
**~14 m** carriageway for the major class, *derived*. The minor classes (280
`residential` + 110 `service`) carry 5 lane tags between them, which is not a
measurement; **4 m** is an assumption, corroborated only weakly by those 5 tags reading
1–2 lanes.

Residual building-overlap measured against these widths: **~4 % major, ~17 % minor**,
against the basemap casing's 38 %. The remaining overlap is real Kolkata zero-setback
frontage, not error, and nothing about this feature "fixes" it — the widths must not be
inflated to chase a number.

**The hazard.** `heat-map-model.ts:239` already contains a road width:

```ts
const p = way.p, rad = way.w > 1 ? 2 : 1;
```

At `dx ≈ 7.29 m/cell` that is a **36.5 m** band for majors and **21.9 m** for minors. It
is a *tree-planting corridor*, not a carriageway. It feeds `corridor` → `corridorSorted`
→ `deliveredQuantities.treeCorridorCells` → cost and cooling, and
`compare/paired-runner.ts:103` calls `buildSpatial` too, so "unifying" the two widths
would silently move Compare's published pair numbers. Task 4 exists to make that
impossible to do by accident.

**Deliberately skipped** (`ponytail:`): re-running `scripts/fetch-roads.py` to bake a
per-way width from each way's own `lanes` tag. Two of 45 major ways are 8-lane; a flat
14 m under-draws those two and nothing else. Add it when someone can point at a visible
problem, not before — it costs a new artefact, three manifest sha256 rows and a re-ship.

---

## File structure

```
src/scripts/climate-engine/
  road-ribbon.ts   NEW  pure: width table, centreline → mitred draped quad strip.
                        No THREE, no DOM. The whole testable surface lives here.
  road-layer.ts    NEW  THREE wrapper: one BufferGeometry, one ShaderMaterial
                        sharing growU, dispose(). ~55 lines, mirrors water-layer.ts.
  heat-map-app.ts  EDIT 4 lines: import, `let roadLayer`, build block, dispose.

tests/unit/
  heat-map-roads.test.mjs  NEW  ribbon geometry, width provenance, and the two
                                tripwires that keep this render-only.
```

**Frame convention.** Ward data is `[x, y]` in metres with **y northward**. The scene
lands world `(x, z)` on data `(x, y)` — stated in `terrain.ts:60-62` and produced by
`water-layer.ts`'s `Shape(x, −y)` + `rotateX(−π/2)`. This module therefore writes world
positions **directly**: data `(px, py)` → world `(px, groundAt(px, py) + ROAD_Y, py)`.
No Shape, no rotation, no chance of a sign flip.

**Height.** The heat overlay is drawn at `ground + 0.6` (`displaceGround`, then
`overlay.position.y = 0.6`); water sits at `ground + 0.9` (`SURFACE_Y`). Roads take
`ground + 0.75`, between the two. Ordering then comes from real geometry — no
`renderOrder` games — and the one visible consequence is that a bridge over water is
hidden by the water. That is correct for this dataset: `{ward}-roads.json` carries no
`bridge` flag, so drawing bridges above water would be inventing a fact.

---

## Task 0: Branch

**Files:** none

- [ ] **Step 1: Branch off main**

The current branch `heat-map-loader` carries the audited-and-rejected v1 loader. This
work must not ride on it.

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad
git checkout main
git pull --ff-only
git checkout -b heat-map-roads
```

- [ ] **Step 2: Confirm a clean baseline**

Run: `npm run test:unit`
Expected: all tests pass. If anything is red here, stop — it is not this feature's fault
and must not be buried under this feature's diff.

---

## Task 1: Pure ribbon geometry

**Files:**
- Create: `src/scripts/climate-engine/road-ribbon.ts`
- Test: `tests/unit/heat-map-roads.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/heat-map-roads.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/unit/heat-map-roads.test.mjs`
Expected: FAIL — `Cannot find module '.../road-ribbon.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/scripts/climate-engine/road-ribbon.ts`:

```ts
/**
 * road-ribbon.ts — OSM centrelines as draped quad strips, and the width table.
 *
 * RENDER ONLY. Nothing here reaches SimLayers or Spatial. The simulation has its
 * OWN road width — `rad = way.w > 1 ? 2 : 1` in heat-map-model.ts:239, which at
 * dx ≈ 7.29 m/cell is a 36.5 m / 21.9 m band. That is a TREE-PLANTING CORRIDOR,
 * not a carriageway, and it feeds corridorSorted → treeCorridorCells → the
 * published cost and cooling figures (compare/paired-runner.ts builds Spatial
 * too). The two numbers describe different things and must never be reconciled.
 *
 * WHERE THE WIDTHS COME FROM. An Overpass survey of the 447 highway ways in the
 * Ballygunge window (2026-08-04) found:
 *
 *   width      0 / 447    OSM carries no carriageway width for Kolkata at all
 *   est_width  0 / 447
 *   lanes     24 /  31 primary ways — 22 × 4 lanes, 2 × 8
 *   lanes      5 / 390 residential + service ways — not a sample, a rumour
 *
 * So the major class is DERIVED (4 lanes × 3.25 m ≈ 14 m) and the minor class is
 * ASSUMED (4 m). The `source` field records which is which, because 14 and 4 are
 * not equally supported and a reader has no way to tell by looking.
 *
 * These are deliberately NARROWER than the basemap's painted casing. Measured
 * residual building overlap is ~4 % major / ~17 % minor against 38 % for the
 * basemap — and that residue is genuine zero-setback frontage. Widening these
 * constants to chase a prettier picture manufactures overlap that is not there.
 *
 * Pure and node-testable — no THREE, no canvas, no DOM.
 */
import type { RoadsData } from './heat-map-model';

export const ROAD_WIDTH_M: Readonly<Record<number, { widthM: number; source: string }>> =
  Object.freeze({
    2: Object.freeze({ widthM: 14, source: 'osm-lanes' }),
    1: Object.freeze({ widthM: 4, source: 'assumed' }),
  });

/** Above the heat overlay (ground + 0.6), below the water surface (ground + 0.9). */
export const ROAD_Y = 0.75;

/**
 * Mitre clamp. At a hairpin the exact mitre is half-width / cos(θ/2), which runs
 * to infinity as the way doubles back — and OSM service roads round car parks do
 * exactly that. 3× half-width is past any join that reads as a corner and short
 * of anything that reads as a spike.
 */
const MITRE_MAX = 3;

/** Unknown classes take the minor width: a road we cannot classify is far more
 *  likely to be a gully than an arterial, and under-drawing is the safe error. */
export function roadHalfWidthM(w: number): number {
  return (ROAD_WIDTH_M[w] ?? ROAD_WIDTH_M[1]).widthM / 2;
}

export interface RoadMesh {
  /** flat [x, y, z, …] world positions, y already draped */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** how many ways actually contributed geometry — for the honesty readout */
  readonly ways: number;
}

/** Drop consecutive duplicates; OSM ways carry them and they make normals NaN. */
function points(p: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < p.length; i += 2) {
    const x = p[i], y = p[i + 1];
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - x) < 1e-6 && Math.abs(last[1] - y) < 1e-6) continue;
    out.push([x, y]);
  }
  return out;
}

/**
 * Every way in the artefact as ONE indexed triangle soup, ready for a single
 * draw call.
 *
 * @param groundAt drawn ground height in metres at a point in the DATA frame
 *   (x east, y north). Sampled per vertex, not per way: a road follows the land,
 *   which is the one way it differs from water — a lane really does run downhill.
 */
export function buildRoadMesh(
  data: RoadsData,
  groundAt: (x: number, y: number) => number,
): RoadMesh | null {
  const pos: number[] = [], idx: number[] = [];
  let ways = 0;

  for (const way of data.ways ?? []) {
    const pts = points(way.p ?? []);
    if (pts.length < 2) continue;
    const half = roadHalfWidthM(way.w);
    const base = pos.length / 3;

    /* Unit normal of each segment, left-hand side. */
    const segN: [number, number][] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
      const len = Math.hypot(dx, dy) || 1;
      segN.push([-dy / len, dx / len]);
    }

    for (let i = 0; i < pts.length; i++) {
      const a = segN[Math.max(0, i - 1)], b = segN[Math.min(segN.length - 1, i)];
      let nx = a[0] + b[0], ny = a[1] + b[1];
      const len = Math.hypot(nx, ny);
      /* A doubled-back join sums to zero; fall back to one side's normal. */
      if (len < 1e-6) { nx = b[0]; ny = b[1]; }
      else { nx /= len; ny /= len; }
      /* Exact mitre: scale by 1/cos(half-angle) = 1/(m · n). Clamped both ways. */
      const scale = Math.min(MITRE_MAX, 1 / Math.max(1e-3, nx * b[0] + ny * b[1]));
      const off = half * scale;
      for (const s of [1, -1]) {
        const x = pts[i][0] + nx * off * s, y = pts[i][1] + ny * off * s;
        pos.push(x, groundAt(x, y) + ROAD_Y, y);
      }
    }

    for (let i = 0; i + 1 < pts.length; i++) {
      const q = base + i * 2;
      idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
    ways++;
  }

  if (!ways) return null;
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), ways };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/heat-map-roads.test.mjs`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/climate-engine/road-ribbon.ts tests/unit/heat-map-roads.test.mjs
git commit -m "feat(roads): centrelines to mitred ribbons, at widths that say which is measured"
```

---

## Task 2: The three.js layer

**Files:**
- Create: `src/scripts/climate-engine/road-layer.ts`

No unit test: this file is a THREE constructor with no branching logic — the geometry it
wraps is fully covered by Task 1, and the tripwires in Task 4 cover what it must not do.
Its correctness is visual, and Task 5 is the visual check.

- [ ] **Step 1: Write the implementation**

Create `src/scripts/climate-engine/road-layer.ts`:

```ts
/**
 * road-layer.ts — the ward's roads, drawn in the city scene.
 *
 * RENDER ONLY, in the exact sense water-layer.ts means it: this draws
 * {ward}-roads.json and touches neither SimLayers nor Spatial. See
 * road-ribbon.ts for the widths, where they came from, and why the simulation's
 * own road width is a different quantity that must stay different.
 *
 * One mesh, one draw call, and no per-frame work: the fade rides the facade's
 * `uGrow` uniform, so roads assemble with the buildings rather than on a clock
 * of their own. Flat ink, no shading — a road is the ABSENCE of the city, and
 * anything lit competes with the massing it exists to separate.
 */
import * as THREE from 'three';
import type { RoadsData } from './heat-map-model';
import { buildRoadMesh } from './road-ribbon';

export interface RoadLayer {
  readonly mesh: THREE.Mesh;
  /** ways actually drawn — for the honesty readout, never a hardcoded count */
  readonly ways: number;
  dispose(): void;
}

const VERT = /* glsl */ `
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/* #39555c — the stage's ink. Cool enough to sit under the cyan massing, dark
   enough to read against the basemap, and nowhere near the temperature ramp. */
const FRAG = /* glsl */ `
  precision highp float;
  uniform float uGrow;
  void main() {
    gl_FragColor = vec4(0.224, 0.333, 0.361, 0.85 * min(1.0, uGrow * 1.6));
  }`;

/**
 * @param groundAt drawn ground height at a point in the ward frame, or a flat
 *   () => 0 when there is no terrain artefact. Per vertex — roads run downhill.
 */
export function createRoadLayer(
  data: RoadsData,
  growU: { value: number },
  groundAt: (x: number, y: number) => number,
): RoadLayer | null {
  const built = buildRoadMesh(data, groundAt);
  if (!built) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(built.indices, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: { uGrow: growU },       /* SHARED with the facade's grow-in */
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,                /* buildings occlude; roads never do */
    side: THREE.DoubleSide,           /* a mitre can wind either way */
  });

  return {
    mesh: new THREE.Mesh(geometry, material),
    ways: built.ways,
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: PASS with no errors mentioning `road-layer` or `road-ribbon`.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/climate-engine/road-layer.ts
git commit -m "feat(roads): one mesh, one draw call, fading on the facade's own grow-in"
```

---

## Task 3: Wire it into the scene

**Files:**
- Modify: `src/scripts/climate-engine/heat-map-app.ts` (4 edits)

- [ ] **Step 1: Add the import**

At `src/scripts/climate-engine/heat-map-app.ts:27` the water import already reads:

```ts
import { createWaterLayer, type WaterLayer } from './water-layer';
```

Add directly beneath it:

```ts
import { createRoadLayer, type RoadLayer } from './road-layer';
```

- [ ] **Step 2: Add the handle**

At line 857 the water handle reads:

```ts
  let waterLayer: WaterLayer | null = null;
```

Add directly beneath it:

```ts
  let roadLayer: RoadLayer | null = null;
```

- [ ] **Step 3: Build the layer after the roads artefact lands**

Find this line (currently 989):

```ts
    state.spatial = M.buildSpatial(d, state.base, roadsCache[name]);
```

Insert directly **after** it:

```ts
    /* The same artefact, drawn. RENDER ONLY: buildSpatial above owns the sim's
       road corridor and keeps its own, much wider, tree-planting radius — see
       road-ribbon.ts. Rebuilt per ward because the ribbons are draped on that
       ward's ground. */
    if (threeScene) {
      if (roadLayer) { threeScene.remove(roadLayer.mesh); roadLayer.dispose(); roadLayer = null; }
      const rl = createRoadLayer(roadsCache[name], growU,
        (x, y) => terrainDrawAt(terrainCache[name] ?? null, x, y));
      if (rl) { roadLayer = rl; threeScene.add(rl.mesh); }
    }
```

- [ ] **Step 4: Dispose on teardown**

Find this line (currently 1539):

```ts
    waterLayer?.dispose();
```

Insert directly after it:

```ts
    roadLayer?.dispose();
```

- [ ] **Step 5: Type-check and run the suite**

Run: `npm run check && npm run test:unit`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/climate-engine/heat-map-app.ts
git commit -m "feat(roads): draw the ward's roads, rebuilt per ward on that ward's ground"
```

---

## Task 3b: Retire the basemap's painted casing

**Files:**
- Modify: `src/scripts/climate-engine/heat-map-app.ts` (1 edit)

**Without this task the whole feature is decorative.** The overlap the CEO reported is
against OpenFreeMap's painted road casing, and drawing our ribbons on top does not make
that casing narrower — it leaves it underneath, overlapping exactly the same buildings.
Verified in both shipped styles (`dark` and `positron`), which carry identical layer ids:

```
highway_minor         line-width interpolate(exp 1.55, zoom, 13 → 1.8px, …)
highway_major_casing  line-width interpolate(exp 1.3,  zoom, 10 → 3px,  …)
highway_major_inner
highway_major_subtle
```

Those widths are in **screen pixels**. They correspond to no width on the ground and do
not change when the camera moves closer. Replacing them with metre-true ribbons is the
substance of this feature; everything else is presentation.

`highway_path` (4 footways in frame) and the three `highway_motorway_*` layers stay
visible — we do not draw those classes, and hiding a road we have not replaced would
delete a real feature rather than redraw it.

- [ ] **Step 1: Hide the replaced layers on every style load**

The handler at `heat-map-app.ts:1520` is `on`, not `once`, precisely because `setEnv`'s
`setStyle` re-fires it — so this is the one place that covers both styles and survives
an environment switch. Change:

```ts
  map.on('style.load', () => {
    map.addLayer(customLayer);
    if (firstBoot) bootStage('shell', 'basemap', 'Acquiring point cloud');
    loadWard('ballygunge');
  });
```

to:

```ts
  map.on('style.load', () => {
    map.addLayer(customLayer);
    /* The basemap paints these in SCREEN PIXELS — a cartographic stroke that
       matches no width on the ground and does not narrow as you zoom in. We
       redraw the same classes in metres (road-layer.ts), so leaving both would
       show every building overlapping a road that is not the road we drew.
       Deliberately NOT hidden: highway_path and highway_motorway_* — classes we
       do not draw, and hiding an unreplaced road deletes it rather than redraws it. */
    for (const id of ['highway_minor', 'highway_major_casing',
                      'highway_major_inner', 'highway_major_subtle']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
    }
    if (firstBoot) bootStage('shell', 'basemap', 'Acquiring point cloud');
    loadWard('ballygunge');
  });
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/climate-engine/heat-map-app.ts
git commit -m "feat(roads): retire the basemap's pixel-width casing for metre-true ribbons"
```

---

## Task 4: The tripwires

**Files:**
- Modify: `tests/unit/heat-map-roads.test.mjs`

These three tests exist because of one specific future mistake: someone notices that the
drawn roads (14 m / 4 m) and the simulated corridor (36.5 m / 21.9 m) disagree, "fixes"
it, and moves published cost and cooling figures with no diff line that looks like it
did.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/heat-map-roads.test.mjs`:

```js
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => readFile(join(ROOT, 'src/scripts/climate-engine', p), 'utf8');

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
    const text = await src(f);
    assert.doesNotMatch(text, /SimLayers/,
      `${f} must not reach the simulation's layers`);
    assert.doesNotMatch(text, /buildSpatial|Spatial/,
      `${f} must not reach the intervention targeting`);
  }
});

test('the width table says which number is measured and which is assumed', async () => {
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
```

- [ ] **Step 2: Run the tests**

Run: `node --import tsx --test tests/unit/heat-map-roads.test.mjs`
Expected: PASS — 9 tests. These pass on first write because Tasks 1–3 already satisfy
them; they are regression guards, not drivers. If any fails, an earlier task is wrong —
fix the source, not the test.

- [ ] **Step 3: Prove the corridor tripwire actually fires**

Temporarily change `heat-map-model.ts:239` to `const p = way.p, rad = 1;` and run:

Run: `node --import tsx --test tests/unit/heat-map-roads.test.mjs`
Expected: FAIL, with the "TREE-PLANTING band" message.

Then revert:

```bash
git checkout src/scripts/climate-engine/heat-map-model.ts
```

A guard nobody has watched fail is a guard nobody knows works — the loader audit's
parting complaint was exactly this.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/heat-map-roads.test.mjs
git commit -m "test(roads): pin the corridor/carriageway split and the width provenance"
```

---

## Task 5: Visual check

**Files:** none

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Open `http://localhost:4321/heat-map`.

- [ ] **Step 2: Check the four things that could be wrong**

1. **Frame** — roads must land on the basemap's own roads. If they are mirrored or
   offset, the frame convention is wrong and everything else is noise. This is the
   known-answer check that three previous coordinate-frame false alarms lacked.
2. **Width** — arterials read wide, gullies read thin. If every road looks the same
   width, `way.w` is not reaching `roadHalfWidthM`.
3. **Corners** — no spikes at junctions (mitre clamp) and no wedge-shaped gaps
   (mitre scale). Zoom to a dense junction in Ballygunge.
4. **Drape** — switch to Barrackpore, which has the most relief. Roads must follow the
   ground rather than cutting through a rise or floating over a dip.
5. **No double roads** — the basemap's painted casing must be gone, in **both** the
   dark and studio environments. Toggle `#envchip` and check again: if the casing
   returns after the switch, Task 3b landed in `setEnv`'s `once` handler instead of
   the `on` handler at :1520.

- [ ] **Step 3: Check all three wards and the grow-in**

Click through Ballygunge → Barrackpore → Baruipur. Roads must rebuild each time and fade
in with the buildings, not before them and not after.

- [ ] **Step 4: Full verify**

Run: `npm run verify`
Expected: green.

- [ ] **Step 5: Commit the screenshot evidence in the message**

```bash
git commit --allow-empty -m "chore(roads): visual check across three wards

Frame validated against basemap roads (the known-answer check the earlier
coordinate-frame alarms skipped). Widths 14 m major / 4 m minor; residual
building overlap ~4 % / ~17 % against the basemap casing's 38 %, and that
residue is real zero-setback frontage."
```

---

## What could go wrong

| Symptom | Cause | Response |
|---|---|---|
| Roads mirrored north–south | The frame convention was "corrected" | `terrain.ts:60-62` is the contract: world `(x, z)` = data `(x, y)`. Validate against the basemap, never against a matrix derivation |
| Spikes at junctions | `MITRE_MAX` removed or raised | It is 3 for a reason; the hairpin test pins it |
| Gaps at corners | The `1/(m·n)` mitre scale was dropped for a plain averaged normal | The 90° test pins the exact `half × √2` offset |
| Every road the same width | `way.w` not read, or `ROAD_WIDTH_M` keys mistyped as strings | The straight-way test pins the minor width; add a major-class case if this recurs |
| Roads vanish under water | Working as designed — `ROAD_Y = 0.75` is below `SURFACE_Y = 0.9` | The artefact has no `bridge` flag; drawing bridges would invent a fact |
| Compare's published numbers moved | Someone unified the drawn width with the sim corridor | The Task 4 tripwire fires first. If it did not, it was deleted — restore it |
| Frame rate drops on ward switch | The old layer was not removed before the new one was added | Step 3 of Task 3 removes and disposes before creating |
| Buildings still overlap roads | Task 3b missing, or the layer ids changed upstream | `getLayer(id)` guards make a rename silent — re-run the style check in Task 3b's preamble against `tiles.openfreemap.org/styles/dark` |
| Casing returns after an env switch | The hide landed in `setEnv`'s `once` handler | It belongs in the `on('style.load')` handler at :1520, which re-fires |
| `npm run check` fails on `Record<number, …>` indexing | `noUncheckedIndexedAccess` | `roadHalfWidthM` already handles the miss with `?? ROAD_WIDTH_M[1]` |

## Out of scope

Per-way widths from each way's own `lanes` tag (2 of 45 major ways are 8-lane — add when
it visibly matters, not before) · any change to `buildSpatial`, `SimLayers`, `Spatial`,
`accuracy.ts`, or the cost model · bridges, tunnels, or one-way markings · the ~4 m
projection drift at ward edges (real, separate, its own fix) · the loader v2 rework on
`heat-map-loader` · the OSM high-rise harvest and Open City vulnerability join from the
CEO's document.
