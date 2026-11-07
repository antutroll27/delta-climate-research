/**
 * bevel-core.ts — the `full` tier's LOD0 mesh: relief-renderer.ts `extrudeBuildings` as a pure function that returns typed
 * arrays, so it can run in a worker and be handed back as Transferables (city-streaming P0 section 2: the main-thread
 * extrusion is 0.5 s on desktop and 1.8 s at 4x slowdown, and the transfer back costs about 2 ms).
 *
 * Same ExtrudeGeometry call, bevel and per-vertex attributes as the main-thread path, so a `full` sheet looks as today's
 * do. Two differences, both invisible: `uv` is not emitted (the facade shader reads none), and the arrays are allocated ONCE,
 * at an upper bound computed from the ring sizes (see `boundOf`), and written once. The first worker prototype built
 * per-building arrays and concatenated them and peaked at 1.6x the result (P0 asked for 1x).
 */
import { ExtrudeGeometry, Shape } from 'three';
import { noise01 } from '../heat-map-model.ts';
import type { BuildingRow } from '../streaming/prism-mesh.ts';

export interface BevelMesh {
  readonly kind: 'bevel';
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly aDelay: Float32Array;
  readonly aH: Float32Array;
  readonly aCtr: Float32Array;
  readonly aG: Float32Array;
  readonly aIn: Float32Array;
  /** Vertices in use; the arrays may be a few slots longer (the bound is exact for simple rings). */
  readonly vertexCount: number;
  readonly buildings: number;
}

export interface BevelInput {
  readonly rows: readonly BuildingRow[];
  readonly sizeM: number;
  readonly groundAt: (x: number, z: number) => number;
  readonly inWard: ArrayLike<number> | null;
}

function extrude(b: BuildingRow): ExtrudeGeometry | null {
  const shape = new Shape(); shape.moveTo(b[1]!, -b[2]!);
  for (let i = 3; i < b.length; i += 2) shape.lineTo(b[i]!, -b[i + 1]!);
  let geometry: ExtrudeGeometry;
  try { geometry = new ExtrudeGeometry(shape, { depth: Math.max(0.6, b[0]! - 1.4), bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.55, bevelSegments: 1 }); }
  catch { try { geometry = new ExtrudeGeometry(shape, { depth: b[0]!, bevelEnabled: false }); } catch { return null; } }
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * An UPPER BOUND on the vertices of one bevelled building, known before it is extruded: the two caps hold at most (n - 2)
 * triangles each and the three bevel layers 2 triangles an edge, all non-indexed. For a simple ring it is exact (128.0
 * a building on Canal Ring, P0); a ring earcut thins out is slightly under it. So the arrays are allocated once at the
 * bound, written once, and `vertexCount` says how much of them is real, which is what keeps the peak at 1x without running
 * the extrusion twice (the first version did, and cost 2.8 s a sheet in node against 1.4 s).
 */
const boundOf = (b: BuildingRow): number => { const n = (b.length - 1) / 2; return 6 * (n - 2) + 18 * n; };

export function buildBevelMesh(input: BevelInput): BevelMesh {
  const { rows, groundAt, inWard } = input;
  const half = input.sizeM / 2;
  let capacity = 0;
  for (const b of rows) capacity += boundOf(b);
  let position = new Float32Array(capacity * 3), normal = new Float32Array(capacity * 3);
  let aDelay = new Float32Array(capacity), aH = new Float32Array(capacity), aCtr = new Float32Array(capacity * 2);
  let aG = new Float32Array(capacity), aIn = new Float32Array(capacity);
  const grow = (need: number): void => {                            // a ring that beat its bound (never seen): widen once, keep going
    const next = Math.ceil((need + 1) * 1.25);
    const widen = <T extends Float32Array>(a: T, k: number): T => { const out = new Float32Array(next * k); out.set(a); return out as T; };
    position = widen(position, 3); normal = widen(normal, 3); aDelay = widen(aDelay, 1); aH = widen(aH, 1);
    aCtr = widen(aCtr, 2); aG = widen(aG, 1); aIn = widen(aIn, 1); capacity = next;
  };
  let o = 0, buildings = 0;
  for (let row = 0; row < rows.length; row++) {
    const b = rows[row]!;
    const g = extrude(b);
    if (g === null) continue;
    const v = g.attributes.position!.count;
    if (o + v > capacity) grow(o + v);
    let cx = 0, cz = 0; const points = (b.length - 1) / 2;
    for (let i = 1; i < b.length; i += 2) { cx += b[i]!; cz += b[i + 1]!; }
    cx /= points; cz /= points;
    const ground = groundAt(cx, cz);
    if (ground) g.translate(0, ground, 0);
    const delay = Math.min(1, Math.hypot(b[1]!, b[2]!) / half) * 0.72 + noise01(b[2]!, b[1]!) * 0.28;
    position.set(g.attributes.position!.array as Float32Array, o * 3);
    normal.set(g.attributes.normal!.array as Float32Array, o * 3);
    aDelay.fill(delay, o, o + v); aH.fill(b[0]!, o, o + v); aG.fill(ground, o, o + v);
    aIn.fill(inWard ? inWard[row]! : 1, o, o + v);
    for (let k = 0; k < v; k++) { aCtr[(o + k) * 2] = cx; aCtr[(o + k) * 2 + 1] = cz; }
    o += v; buildings++;
    g.dispose();
  }
  return { kind: 'bevel', position, normal, aDelay, aH, aCtr, aG, aIn, vertexCount: o, buildings };
}

export function bevelBuffers(mesh: BevelMesh): ArrayBuffer[] {
  return [mesh.position, mesh.normal, mesh.aDelay, mesh.aH, mesh.aCtr, mesh.aG, mesh.aIn].map((a) => a.buffer as ArrayBuffer);
}
