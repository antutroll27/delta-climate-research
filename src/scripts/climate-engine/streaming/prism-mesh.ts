/**
 * prism-mesh.ts — flat-roofed prisms from footprint rings, as typed arrays, with the vertex count known BEFORE anything is
 * allocated. Pure: no three.js, no DOM, so it runs in a worker and in node. The triangulator is injected (the host passes
 * three's Earcut), which is what keeps this file importable by the node tests without a GL stack.
 *
 * TWO MESHES, ONE BUILDER.
 *   'packed'   the LOD0 mesh of the `balanced` and `low` tiers: walls and roof, no bottom (nobody sees it), no bevel, no `uv`.
 *              30 bytes per vertex in seven attributes (see PACKED_BYTES_PER_VERTEX; the shader decodes aH and aG).
 *   'massing'  LOD1, the grey neighbour: footprint simplified to MASSING_TOLERANCE_M, sheds dropped (P3b measured: the sweep over 1.5-4 m moves E4's 11.1 MB to 8.4 MB at most, because terraced footprints are already 4-6 points), position + normal only,
 *              16 bytes per vertex, ONE indexed draw for the whole sheet.
 *
 * THE TWO-PASS RULE (P0 section 2 asked for it: the first worker kept per-building arrays and concatenated, peaking at 1.6x
 * the final size). Pass 1 cleans each ring and triangulates it, keeping only the ring and a handful of triangle indices;
 * the vertex and index totals are then exact; pass 2 writes straight into arrays allocated once at their final size.
 *
 * FRAME (matches relief-renderer.ts `extrudeBuildings`): a ring is (x east, y north); the mesh is (x, height, z = ring y), a
 * building spans y from the ground under its centroid to ground + h. Triangles wind counter-clockwise seen from OUTSIDE in the
 * mesh's own right-handed frame, as ExtrudeGeometry's do (tests/unit/prism-mesh.test.mjs checks both against ExtrudeGeometry).
 */
import { noise01 } from '../heat-map-model.ts';

/** One footprint row of WardData.b: [height, x0, y0, x1, y1, ...]. */
export type BuildingRow = ArrayLike<number>;

/** Flat triple list of vertex indices into the ring's points (earcut's output shape). */
export type Triangulate = (xy: readonly number[]) => ArrayLike<number>;

/** The packed attribute ranges: aH is a u16 over 0..H_RANGE_M metres, aG an i16 over +-G_RANGE_M. The shader multiplies back. */
export const H_RANGE_M = 400;
export const G_RANGE_M = 200;

/** position f32x3 (12) + normal i8x4 (4) + aCtr f32x2 (8) + aDelay u8 (1) + aIn u8 (1) + aH u16 (2) + aG i16 (2) = 30. */
export const PACKED_BYTES_PER_VERTEX = 30;
/** position f32x3 (12) + normal i8x4 (4). */
export const MASSING_BYTES_PER_VERTEX = 16;
/** Every vertex also costs its share of the u32 index: walls 6 per 4 vertices, roof (n-2)*3 per n. Reported, not guessed. */
export const MASSING_TOLERANCE_M = 2.5;
/** A building smaller than this footprint (m^2) and lower than MASSING_MIN_HEIGHT_M is a shed: dropped from the massing. */
export const MASSING_MIN_AREA_M2 = 40;
export const MASSING_MIN_HEIGHT_M = 6;

export interface PackedMesh {
  readonly kind: 'packed';
  readonly position: Float32Array;
  readonly normal: Int8Array;     // 4 per vertex (x, y, z, 0): int8 normalised
  readonly aCtr: Float32Array;
  readonly aDelay: Uint8Array;    // normalised
  readonly aIn: Uint8Array;       // normalised
  readonly aH: Uint16Array;       // normalised, x H_RANGE_M
  readonly aG: Int16Array;        // normalised, x G_RANGE_M
  readonly index: Uint32Array;
  readonly vertexCount: number;
  readonly buildings: number;
}

export interface MassingMesh {
  readonly kind: 'massing';
  readonly position: Float32Array;
  readonly normal: Int8Array;
  readonly index: Uint32Array;
  readonly vertexCount: number;
  readonly buildings: number;
}

export type PrismMesh = PackedMesh | MassingMesh;

export interface PrismInput {
  readonly rows: readonly BuildingRow[];
  readonly sizeM: number;
  readonly triangulate: Triangulate;
  /** Drawn ground height under (x, z); 0 where there is no terrain. */
  readonly groundAt?: (x: number, z: number) => number;
  /** Row-aligned 1 / 0: the building is inside the ward boundary. Absent = every building is. */
  readonly inWard?: ArrayLike<number> | null;
  /** Massing thresholds; the defaults are the shipped ones. Only the measurement scripts pass these. */
  readonly massing?: { readonly toleranceM: number; readonly minAreaM2: number; readonly minHeightM: number };
}

interface Plan {
  readonly xy: Float64Array;   // ring points, x/z interleaved, oriented so roof triangles face +Y
  readonly tri: Uint32Array;
  readonly row: number;
  readonly h: number;
  readonly cx: number;
  readonly cz: number;
}

const EPS = 1e-6;

/** The ring with its closing duplicate and repeated points removed, as x/z pairs; null if fewer than 3 points remain. */
function cleanRing(row: BuildingRow): number[] | null {
  const out: number[] = [];
  for (let i = 1; i + 1 < row.length; i += 2) {
    const x = row[i]!, z = row[i + 1]!;
    const n = out.length;
    if (n >= 2 && Math.abs(out[n - 2]! - x) < EPS && Math.abs(out[n - 1]! - z) < EPS) continue;
    out.push(x, z);
  }
  while (out.length >= 4 && Math.abs(out[0]! - out[out.length - 2]!) < EPS && Math.abs(out[1]! - out[out.length - 1]!) < EPS) out.length -= 2;
  return out.length >= 6 ? out : null;
}

/** Shoelace area in the (x, z) plane: negative = the orientation the roof wants (cross.y > 0 per triangle). */
function signedArea(xy: readonly number[]): number {
  let a = 0;
  for (let i = 0, n = xy.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += xy[i * 2]! * xy[j * 2 + 1]! - xy[j * 2]! * xy[i * 2 + 1]!;
  }
  return a / 2;
}

/** Ramer-Douglas-Peucker on a CLOSED ring: split at the two mutually farthest points, simplify each chain. */
function simplifyRing(xy: readonly number[], tol: number): number[] {
  const n = xy.length / 2;
  if (n <= 4) return [...xy];
  let a = 0, b = 0, best = -1;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(xy[i * 2]! - xy[0]!, xy[i * 2 + 1]! - xy[1]!);
    if (d > best) { best = d; a = i; }
  }
  best = -1;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(xy[i * 2]! - xy[a * 2]!, xy[i * 2 + 1]! - xy[a * 2 + 1]!);
    if (d > best) { best = d; b = i; }
  }
  const keep = new Uint8Array(n);
  keep[a] = keep[b] = 1;
  const chain = (from: number, to: number): void => {              // indices strictly between from and to, walking forward
    const idx: number[] = [];
    for (let i = (from + 1) % n; i !== to; i = (i + 1) % n) idx.push(i);
    const rec = (lo: number, hi: number): void => {                 // positions in idx, exclusive of the end points
      const p = lo < 0 ? from : idx[lo]!, q = hi >= idx.length ? to : idx[hi]!;
      const ax = xy[p * 2]!, az = xy[p * 2 + 1]!, bx = xy[q * 2]!, bz = xy[q * 2 + 1]!;
      const len = Math.hypot(bx - ax, bz - az);
      let far = -1, farD = tol;
      for (let k = lo + 1; k < hi; k++) {
        const i = idx[k]!;
        const px = xy[i * 2]!, pz = xy[i * 2 + 1]!;
        const d = len < EPS ? Math.hypot(px - ax, pz - az) : Math.abs((bx - ax) * (az - pz) - (ax - px) * (bz - az)) / len;
        if (d > farD) { farD = d; far = k; }
      }
      if (far < 0) return;
      keep[idx[far]!] = 1;
      rec(lo, far);
      rec(far, hi);
    };
    rec(-1, idx.length);
  };
  chain(a, b);
  chain(b, a);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(xy[i * 2]!, xy[i * 2 + 1]!);
  return out;
}

/** Pass 1: clean, (for massing: simplify and filter,) orient and triangulate every ring. */
function planBuildings(input: PrismInput, massing: boolean): Plan[] {
  const plans: Plan[] = [];
  for (let row = 0; row < input.rows.length; row++) {
    const b = input.rows[row]!;
    const h = b[0]!;
    if (!(h > 0)) continue;
    let ring = cleanRing(b);
    if (ring === null) continue;
    if (massing) {
      const m = input.massing ?? { toleranceM: MASSING_TOLERANCE_M, minAreaM2: MASSING_MIN_AREA_M2, minHeightM: MASSING_MIN_HEIGHT_M };
      if (Math.abs(signedArea(ring)) < m.minAreaM2 && h < m.minHeightM) continue;
      ring = simplifyRing(ring, m.toleranceM);
      if (ring.length < 6 || Math.abs(signedArea(ring)) < 1) continue;
    }
    if (signedArea(ring) > 0) {                                     // reverse the point order, keeping (x, z) pairs
      const r: number[] = [];
      for (let i = ring.length / 2 - 1; i >= 0; i--) r.push(ring[i * 2]!, ring[i * 2 + 1]!);
      ring = r;
    }
    const raw = input.triangulate(ring);
    const tri: number[] = [];
    for (let t = 0; t + 2 < raw.length; t += 3) {
      let a = raw[t]!, bb = raw[t + 1]!, c = raw[t + 2]!;
      const cross = (ring[bb * 2 + 1]! - ring[a * 2 + 1]!) * (ring[c * 2]! - ring[a * 2]!) - (ring[bb * 2]! - ring[a * 2]!) * (ring[c * 2 + 1]! - ring[a * 2 + 1]!);
      if (Math.abs(cross) < 1e-9) continue;                          // a sliver: nothing to draw
      if (cross < 0) { const s = bb; bb = c; c = s; }                // roof triangles must face +Y
      tri.push(a, bb, c);
    }
    if (tri.length === 0) continue;
    /* The centroid is the MEAN OF THE ROW'S POINTS, closing duplicate included, exactly as extrudeBuildings takes it, so
       aCtr, the grow delay and the ground lookup match the bevelled mesh building for building. */
    let cx = 0, cz = 0; const points = (b.length - 1) / 2;
    for (let i = 1; i < b.length; i += 2) { cx += b[i]!; cz += b[i + 1]!; }
    cx /= points; cz /= points;
    plans.push({ xy: Float64Array.from(ring), tri: Uint32Array.from(tri), row, h, cx, cz });
  }
  return plans;
}

interface Totals { vertices: number; indices: number }
function totals(plans: readonly Plan[]): Totals {
  let vertices = 0, indices = 0;
  for (const p of plans) {
    const n = p.xy.length / 2;
    vertices += 5 * n;                                              // 4 per wall edge + the roof ring
    indices += 6 * n + p.tri.length;
  }
  return { vertices, indices };
}

/** Write one building's walls and roof; `put(v, x, y, z, nx, ny, nz)` receives each vertex. Returns the next vertex and index. */
function writePrism(
  p: Plan, y0: number, y1: number, v: number, at: number, index: Uint32Array,
  put: (v: number, x: number, y: number, z: number, nx: number, ny: number, nz: number) => void,
): { v: number; at: number } {
  const n = p.xy.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = p.xy[i * 2]!, az = p.xy[i * 2 + 1]!, bx = p.xy[j * 2]!, bz = p.xy[j * 2 + 1]!;
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;                            // outward for this orientation
    put(v, ax, y0, az, nx, 0, nz); put(v + 1, bx, y0, bz, nx, 0, nz);
    put(v + 2, bx, y1, bz, nx, 0, nz); put(v + 3, ax, y1, az, nx, 0, nz);
    index[at++] = v; index[at++] = v + 1; index[at++] = v + 2;
    index[at++] = v; index[at++] = v + 2; index[at++] = v + 3;
    v += 4;
  }
  const roof = v;
  for (let i = 0; i < n; i++) put(v++, p.xy[i * 2]!, y1, p.xy[i * 2 + 1]!, 0, 1, 0);
  for (let t = 0; t < p.tri.length; t++) index[at++] = roof + p.tri[t]!;
  return { v, at };
}

const i8 = (x: number): number => Math.max(-127, Math.min(127, Math.round(x * 127)));

/** The `balanced` / `low` LOD0 mesh. */
export function buildPackedMesh(input: PrismInput): PackedMesh {
  const plans = planBuildings(input, false);
  const { vertices: V, indices: I } = totals(plans);
  const position = new Float32Array(V * 3), normal = new Int8Array(V * 4), aCtr = new Float32Array(V * 2);
  const aDelay = new Uint8Array(V), aIn = new Uint8Array(V), aH = new Uint16Array(V), aG = new Int16Array(V);
  const index = new Uint32Array(I);
  const half = input.sizeM / 2;
  let v = 0, at = 0;
  for (const p of plans) {
    const b = input.rows[p.row]!;
    const ground = input.groundAt?.(p.cx, p.cz) ?? 0;
    const delay = Math.min(1, Math.hypot(b[1]!, b[2]!) / half) * 0.72 + noise01(b[2]!, b[1]!) * 0.28;
    const inside = input.inWard ? input.inWard[p.row]! : 1;
    const h16 = Math.max(0, Math.min(65535, Math.round(p.h / H_RANGE_M * 65535)));
    const g16 = Math.max(-32767, Math.min(32767, Math.round(ground / G_RANGE_M * 32767)));
    const d8 = Math.round(Math.max(0, Math.min(1, delay)) * 255), in8 = Math.round(Math.max(0, Math.min(1, inside)) * 255);
    const start = v;
    ({ v, at } = writePrism(p, ground, ground + p.h, v, at, index, (k, x, y, z, nx, ny, nz) => {
      position[k * 3] = x; position[k * 3 + 1] = y; position[k * 3 + 2] = z;
      normal[k * 4] = i8(nx); normal[k * 4 + 1] = i8(ny); normal[k * 4 + 2] = i8(nz);
    }));
    for (let k = start; k < v; k++) {
      aCtr[k * 2] = p.cx; aCtr[k * 2 + 1] = p.cz;
      aDelay[k] = d8; aIn[k] = in8; aH[k] = h16; aG[k] = g16;
    }
  }
  return { kind: 'packed', position, normal, aCtr, aDelay, aIn, aH, aG, index, vertexCount: V, buildings: plans.length };
}

/** The LOD1 grey massing of a neighbour sheet. */
export function buildMassingMesh(input: PrismInput): MassingMesh {
  const plans = planBuildings(input, true);
  const { vertices: V, indices: I } = totals(plans);
  const position = new Float32Array(V * 3), normal = new Int8Array(V * 4), index = new Uint32Array(I);
  let v = 0, at = 0;
  for (const p of plans) {
    ({ v, at } = writePrism(p, 0, p.h, v, at, index, (k, x, y, z, nx, ny, nz) => {
      position[k * 3] = x; position[k * 3 + 1] = y; position[k * 3 + 2] = z;
      normal[k * 4] = i8(nx); normal[k * 4 + 1] = i8(ny); normal[k * 4 + 2] = i8(nz);
    }));
  }
  return { kind: 'massing', position, normal, index, vertexCount: V, buildings: plans.length };
}

/** Bytes the mesh occupies on the GPU: every attribute plus the u32 index. */
export function meshBytes(mesh: PrismMesh): number {
  let bytes = mesh.position.byteLength + mesh.normal.byteLength + mesh.index.byteLength;
  if (mesh.kind === 'packed') bytes += mesh.aCtr.byteLength + mesh.aDelay.byteLength + mesh.aIn.byteLength + mesh.aH.byteLength + mesh.aG.byteLength;
  return bytes;
}

/** The buffers to hand to postMessage's transfer list. */
export function meshBuffers(mesh: PrismMesh): ArrayBuffer[] {
  const arrays: ArrayBufferView[] = [mesh.position, mesh.normal, mesh.index];
  if (mesh.kind === 'packed') arrays.push(mesh.aCtr, mesh.aDelay, mesh.aIn, mesh.aH, mesh.aG);
  return arrays.map((a) => a.buffer as ArrayBuffer);
}
