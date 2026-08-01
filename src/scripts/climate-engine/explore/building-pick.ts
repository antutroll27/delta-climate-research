/**
 * building-pick.ts — click a building on the /heat-map instrument.
 *
 * WHY THIS IS NOT A THREE.Raycaster.
 * The city is drawn from inside a MapLibre CustomLayerInterface that shares
 * MapLibre's WebGL context, and its camera is a bare `THREE.Camera` whose
 * `projectionMatrix` is overwritten every frame with the clip matrix MapLibre
 * hands to `render(gl, matrix)`. `matrixWorld`, `projectionMatrixInverse` and
 * the frustum are never maintained, so `Raycaster.setFromCamera()` and
 * `Object3D.project()` both read stale identity data. Nor can we pick against
 * the geometry: every building in a ward is merged into ONE BufferGeometry with
 * no groups and no id attribute.
 *
 * So we pick the way the renderer draws: take the same clip matrix, project the
 * candidate's own footprint to screen space, and hit-test there. That is exact
 * for any camera state MapLibre can produce — pitch, bearing, zoom, flyTo — with
 * no assumptions about the projection, and it costs nothing per frame because it
 * only runs on click.
 *
 * Ward-metre convention, matching how loadWard builds the extrusions: the shape
 * is (x, −y) extruded along +Z then rotated −90° about X, so a data pair
 * (x, y) lands at world (x, height, y). `aCtr` is (worldX, worldZ) — the same
 * pair — which is why the selection uniform can be a centroid rather than a new
 * per-vertex id attribute.
 */
/**
 * Structural stand-in for THREE.Matrix4. This module reads `.elements` and
 * nothing else, so typing it this way keeps it free of any three import — it
 * stays pure arithmetic that can be unit-tested under plain node, and the
 * tree-shaken three runtime (which re-exports neither Matrix4 nor Vector4) does
 * not have to grow to accommodate a hit test.
 */
export interface ClipMatrix { readonly elements: ArrayLike<number> }

export interface BuildingMeta {
  /** index into the ward's `b` rows — stable for the life of the ward */
  readonly idx: number;
  /** metres, as supplied (2.5 is Google's fill value, not a measurement) */
  readonly h: number;
  /** true when `h` is the 2.5 m fill value */
  readonly fill: boolean;
  /** centroid in ward metres — matches the `aCtr` vertex attribute exactly */
  readonly cx: number;
  readonly cz: number;
  /** footprint ring, flat [x0,z0, x1,z1, …] in ward metres */
  readonly ring: Float32Array;
  /** shoelace area, m² */
  readonly areaM2: number;
}

/** Screen position of a ward-metre point, in CSS pixels relative to the canvas. */
export interface Projected {
  readonly x: number;
  readonly y: number;
  /** clip-space w — ≤ 0 means behind the camera, so the point must not be drawn */
  readonly w: number;
  readonly depth: number;
}

/**
 * Project ward metres → CSS pixels using the clip matrix MapLibre last handed the
 * custom layer. `mat` is already `maplibreMatrix · modelTransform`, i.e. exactly
 * what the vertex shader multiplies by, so this cannot drift from what is drawn.
 *
 * The multiply is written out rather than routed through THREE.Vector4 because a
 * single pick projects tens of thousands of points, and the shared tree-shaken
 * three runtime does not re-export Vector4 — no allocation, nothing added to the
 * vendor chunk. `elements` is column-major, so column j lives at e[j*4 + row].
 */
export function projectWard(
  mat: ClipMatrix, x: number, y: number, z: number, wCss: number, hCss: number,
): Projected {
  const e = mat.elements;
  const w = e[3] * x + e[7] * y + e[11] * z + e[15];
  if (w <= 0) return { x: 0, y: 0, w, depth: Infinity };
  const inv = 1 / w;
  const cx = (e[0] * x + e[4] * y + e[8] * z + e[12]) * inv;
  const cy = (e[1] * x + e[5] * y + e[9] * z + e[13]) * inv;
  const cz = (e[2] * x + e[6] * y + e[10] * z + e[14]) * inv;
  return {
    x: (cx * 0.5 + 0.5) * wCss,
    y: (1 - (cy * 0.5 + 0.5)) * hCss,
    w,
    depth: cz,
  };
}

/** even-odd point-in-polygon over a flat [x,y,…] screen-space ring */
function inPoly(px: number, py: number, pts: number[], n: number): boolean {
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1], xj = pts[j * 2], yj = pts[j * 2 + 1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Hit-test a click against the ward's buildings.
 *
 * Two passes, because projecting every ring of a 3,500-building ward is wasteful
 * when almost all of them are nowhere near the pointer:
 *   1. coarse — project each centroid at roof height, keep what lands within
 *      `coarsePx`. Pure arithmetic, no allocation.
 *   2. exact — for each survivor project the full prism and test the roof cap and
 *      every wall quad. A click low on a tower's flank hits that tower, not the
 *      low building its roof happens to sit behind.
 *
 * Returns the nearest hit by clip depth, or -1.
 */
export function pickBuilding(
  mat: ClipMatrix,
  buildings: readonly BuildingMeta[],
  px: number, py: number,
  wCss: number, hCss: number,
  coarsePx = 90,
): number {
  const coarse: BuildingMeta[] = [];
  const r2 = coarsePx * coarsePx;
  for (const b of buildings) {
    const p = projectWard(mat, b.cx, b.h, b.cz, wCss, hCss);
    if (p.w <= 0) continue;
    const dx = p.x - px, dy = p.y - py;
    if (dx * dx + dy * dy <= r2) coarse.push(b);
  }
  if (!coarse.length) return -1;

  let best = -1, bestDepth = Infinity;
  const roof: number[] = [], base: number[] = [], quad = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const b of coarse) {
    const n = b.ring.length >> 1;
    roof.length = 0; base.length = 0;
    let behind = false, depth = Infinity;
    for (let i = 0; i < n; i++) {
      const x = b.ring[i * 2], z = b.ring[i * 2 + 1];
      const pr = projectWard(mat, x, b.h, z, wCss, hCss);
      const pb = projectWard(mat, x, 0, z, wCss, hCss);
      if (pr.w <= 0 || pb.w <= 0) { behind = true; break; }
      roof.push(pr.x, pr.y); base.push(pb.x, pb.y);
      if (pr.depth < depth) depth = pr.depth;
    }
    if (behind || depth >= bestDepth) continue;

    let hit = inPoly(px, py, roof, n);
    if (!hit) {
      for (let i = 0; i < n && !hit; i++) {
        const j = (i + 1) % n;
        quad[0] = base[i * 2]; quad[1] = base[i * 2 + 1];
        quad[2] = base[j * 2]; quad[3] = base[j * 2 + 1];
        quad[4] = roof[j * 2]; quad[5] = roof[j * 2 + 1];
        quad[6] = roof[i * 2]; quad[7] = roof[i * 2 + 1];
        hit = inPoly(px, py, quad, 4);
      }
    }
    if (hit) { best = b.idx; bestDepth = depth; }
  }
  return best;
}

/**
 * Build the per-building registry from a ward's raw `b` rows.
 * Row format is [height, x0,y0, x1,y1, …] in metres about the ward centre —
 * the same rows loadWard extrudes, read once so the widget and the geometry can
 * never disagree about which building is which.
 */
export function buildRegistry(rows: readonly number[][]): BuildingMeta[] {
  const out: BuildingMeta[] = [];
  for (let idx = 0; idx < rows.length; idx++) {
    const b = rows[idx];
    const n = (b.length - 1) >> 1;
    if (n < 3) continue;
    const ring = new Float32Array(n * 2);
    let cx = 0, cz = 0, twice = 0;
    for (let i = 0; i < n; i++) {
      const x = b[1 + i * 2], z = b[2 + i * 2];
      ring[i * 2] = x; ring[i * 2 + 1] = z;
      cx += x; cz += z;
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      twice += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
    }
    out.push({
      idx, h: b[0], fill: b[0] === 2.5,
      cx: cx / n, cz: cz / n, ring, areaM2: Math.abs(twice) / 2,
    });
  }
  return out;
}
