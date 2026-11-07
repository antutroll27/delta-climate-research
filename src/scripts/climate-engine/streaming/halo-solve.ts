/**
 * halo-solve.ts — the contract of a seam-free per-sheet solve.
 *
 * Each sheet solves alone, but on its 384-cell CORE plus a 60-cell RING of real neighbour ground on every side: 504 cells
 * over 3,675 m (the admitted pair `hm-grid-504-3675-v1`). The model is local (decay length 47-73 m, 6.5-10 cells), so a
 * wall 437.5 m away moves the core by 0.010 K at the production calm-wind floor against the 0.05 K pass mark (P0
 * section 1; the floor is pinned in tests/unit/halo-wind-floor.test.mjs). Only the core is ever DISPLAYED or COUNTED.
 *
 * CELL DEFINITION (the one scripts/_sheets.py `_cell_corners` and G9d use). Rows count NORTH from the south edge and
 * columns EAST from the west edge, which is also the simulation grid's own layout (sim grid row 0 = SOUTH, surface-raster.ts).
 * Cell (r, c) of a sheet covers x from -S/2 + c*h to -S/2 + (c+1)*h and y from -S/2 + r*h to -S/2 + (r+1)*h in the sheet's
 * frame (S = 2,800 m, h = 175/24 m). Indices outside 0..383 are the halo: (r, c) with c >= 384 is the cell (r, c - 384)
 * of the EAST neighbour, c < 0 is (r, c + 384) of the WEST one, and alike for rows with north and south. Because every
 * sheet's frame shares one standard parallel (E4's), a halo cell IS the neighbour's own cell, corner for corner; G9d proves
 * it in Python, and tests/unit/halo-solve.test.mjs proves this file's index arithmetic against the same lon/lat corners.
 *
 * THE EDGE RULE (a neighbour with nothing to give). Where a neighbour is absent (a skipped or outside lattice cell, a
 * halo asset that failed to load), the core is REFLECTED across the missing edge: halo cell -k takes core cell k-1 (and
 * N-1+k takes N-k), a corner reflects on both axes. That is the solver's own border made explicit. sim-ts.ts clamps the
 * neighbour index, so a border cell sees ITSELF as its outside neighbour (cell-centred zero flux); a mirror ghost layer
 * at -1 is that same cell, and the further mirror cells keep the field symmetric about the edge, so the wall sits where
 * today's wall sits. Replicating the nearest core cell outward instead (the first version of this file) is a different
 * problem: each edge cell's forcing is stretched over 437 m and pins the edge toward its own local equilibrium. Audit
 * P3A B1 measured it 2.3-2.9 K away from today's wall solve at the calm floor; reflection is 0.01 K away. It adds no
 * ground that is not in the sheet. `missing` lists the directions that used it; real ground (the halo-only bake of the
 * skipped neighbours, P2b) replaces it wherever it exists.
 *
 * STATS ARE CORE-ONLY. `coreStats` reads the 384 x 384 window and nothing else. `HeatSim.stats()` averages the whole 504
 * grid and would count every ring cell twice across the seam, so a halo solve must never call it.
 *
 * No DOM, no GL: the solver is passed in.
 */
import { requireGrid, type GridSpec, type HeatSim, type SimLayers, type SimParams, type SimStats } from '../types.ts';
import { DIRECTIONS, directionOfStep, type Direction } from './sheet-topology.ts';

export interface HaloGeometry {
  /** Cells per side of a sheet's own square. */
  readonly coreN: number;
  /** Cells of neighbour ground on each side. */
  readonly haloCells: number;
}

/** The shipped geometry: 384 + 2 x 60 = 504. */
export const SHEET_HALO: HaloGeometry = Object.freeze({ coreN: 384, haloCells: 60 });

/** Metres per cell, shared with Kolkata and Bengaluru (7.2917 m = 175/24). */
export const CELL_M = 175 / 24;

export const haloN = (g: HaloGeometry): number => g.coreN + 2 * g.haloCells;

/** The admitted grid pair of the shipped geometry, from ADMITTED_GRIDS (so a change there is caught here). */
export function haloGridSpec(): GridSpec {
  const grid = requireGrid(3675);
  if (grid.n !== haloN(SHEET_HALO)) throw new RangeError(`ADMITTED_GRIDS holds ${grid.n} cells for 3,675 m; the halo is ${haloN(SHEET_HALO)}.`);
  return { n: grid.n, cellMeters: grid.sizeM / grid.n };
}

/** Where a halo-grid cell comes from: `dir` null = this sheet's own core. (r, c) are the source sheet's own cell. */
export interface HaloSource {
  readonly dir: Direction | null;
  readonly r: number;
  readonly c: number;
}

/** The source of halo-grid cell (R, C), R rows north of the halo's south edge and C columns east of its west edge. */
export function haloCellSource(g: HaloGeometry, R: number, C: number): HaloSource {
  const n = haloN(g);
  if (!Number.isInteger(R) || !Number.isInteger(C) || R < 0 || C < 0 || R >= n || C >= n) {
    throw new RangeError(`Halo cell (${R}, ${C}) is outside the ${n} x ${n} grid.`);
  }
  const r = R - g.haloCells, c = C - g.haloCells;
  const dj = r < 0 ? -1 : r >= g.coreN ? 1 : 0;
  const di = c < 0 ? -1 : c >= g.coreN ? 1 : 0;
  return { dir: directionOfStep(di, dj), r: r - dj * g.coreN, c: c - di * g.coreN };
}

/** Mirror an index about the edges of 0..n-1 (cell -k <-> k-1, cell n-1+k <-> n-k). Needs the ring no deeper than the core. */
function reflect(i: number, n: number): number {
  return i < 0 ? -i - 1 : i >= n ? 2 * n - 1 - i : i;
}

/** A neighbour's ground at rest: one byte a cell, 1/255 steps (halo-asset.ts). Read through `/ 255`, never expanded to floats. */
export interface QuantisedSource {
  readonly albedo: Uint8Array;
  readonly veg: Uint8Array;
  readonly built: Uint8Array;
  readonly water: Uint8Array;
}

/** Neighbour ground by direction, as floats or quantised. A direction with no entry uses the edge rule above. */
export type NeighbourLayers = Readonly<Partial<Record<Direction, SimLayers | QuantisedSource>>>;

export interface HaloAssembly {
  readonly layers: SimLayers;
  /** The directions that had no neighbour and took the edge rule, reading order. Empty = a fully real halo. */
  readonly missing: readonly Direction[];
}

const LAYER_NAMES = ['albedo', 'veg', 'built', 'water'] as const;

function checkLayers(name: string, l: SimLayers | QuantisedSource, count: number): void {
  for (const k of LAYER_NAMES) {
    if (l[k].length !== count) throw new RangeError(`${name}.${k} has ${l[k].length} cells; a ${Math.sqrt(count)}-cell square needs ${count}.`);
  }
}

/**
 * Lay a sheet's core and its neighbours' ground into one (coreN + 2 haloCells)-cell square. Copies; the inputs are not
 * touched. Every layer is assembled the same way, so albedo, vegetation, built and water cannot drift apart.
 */
export function assembleHaloLayers(g: HaloGeometry, core: SimLayers, neighbours: NeighbourLayers): HaloAssembly {
  if (g.haloCells > g.coreN) throw new RangeError('The halo cannot be deeper than the core it reflects.');
  const count = g.coreN * g.coreN;
  checkLayers('core', core, count);
  for (const dir of DIRECTIONS) {
    const n = neighbours[dir];
    if (n !== undefined) checkLayers(`neighbour ${dir}`, n, count);
  }
  const N = haloN(g);
  const scale: Partial<Record<Direction, number>> = {};
  for (const dir of DIRECTIONS) { const n = neighbours[dir]; if (n !== undefined) scale[dir] = n.albedo instanceof Uint8Array ? 1 / 255 : 1; }
  const out: SimLayers = {
    albedo: new Float32Array(N * N), veg: new Float32Array(N * N), built: new Float32Array(N * N), water: new Float32Array(N * N),
  };
  for (let R = 0; R < N; R++) {
    for (let C = 0; C < N; C++) {
      const src = haloCellSource(g, R, C);
      const real = src.dir === null ? core : neighbours[src.dir];
      let r = src.r, c = src.c;
      if (real === undefined) {                                    // the edge rule: reflect this sheet's own core across the edge
        r = reflect(R - g.haloCells, g.coreN);
        c = reflect(C - g.haloCells, g.coreN);
      }
      const from = (real ?? core), at = r * g.coreN + c, to = R * N + C;
      const k1 = real === undefined || src.dir === null ? 1 : scale[src.dir]!;
      for (const k of LAYER_NAMES) out[k][to] = from[k][at]! * k1;
    }
  }
  const missing = DIRECTIONS.filter((d) => neighbours[d] === undefined);
  return { layers: out, missing };
}

/** The core window of a halo-grid field, as its own coreN x coreN array (row 0 = south). */
export function extractCore(g: HaloGeometry, field: ArrayLike<number>): Float32Array {
  const N = haloN(g);
  if (field.length !== N * N) throw new RangeError(`A halo field has ${N * N} cells; got ${field.length}.`);
  const out = new Float32Array(g.coreN * g.coreN);
  for (let r = 0; r < g.coreN; r++) {
    const from = (r + g.haloCells) * N + g.haloCells;
    for (let c = 0; c < g.coreN; c++) out[r * g.coreN + c] = field[from + c]!;
  }
  return out;
}

/**
 * Mean, peak and the fraction above the threshold over the CORE only: the same definitions as `TsHeatSim.stats`, on the
 * cells the sheet owns. Ring cells never enter any of the three.
 */
export function coreStats(g: HaloGeometry, field: ArrayLike<number>, thresholdC = 40): SimStats {
  const N = haloN(g);
  if (field.length !== N * N) throw new RangeError(`A halo field has ${N * N} cells; got ${field.length}.`);
  let sum = 0, peak = -Infinity, above = 0;
  for (let r = 0; r < g.coreN; r++) {
    const from = (r + g.haloCells) * N + g.haloCells;
    for (let c = 0; c < g.coreN; c++) {
      const v = field[from + c]!;
      sum += v;
      if (v > peak) peak = v;
      if (v > thresholdC) above += 1;
    }
  }
  const count = g.coreN * g.coreN;
  return { meanC: sum / count, peakC: peak, fracAbove: above / count, thresholdC };
}

export interface HaloSolve {
  /** The sheet's own coreN x coreN field: what is drawn. */
  readonly core: Float32Array;
  /** Core-only statistics: what is printed and scored. */
  readonly stats: SimStats;
  readonly missing: readonly Direction[];
}

/**
 * Solve one sheet on its halo grid and hand back the core. `sim` is any HeatSim (the CPU floor or the GPU solver) and
 * is left initialised, so the caller can keep stepping it and call `readHaloSolve` again; the caller disposes it.
 */
export function solveSheetWithHalo(
  sim: HeatSim, params: SimParams, g: HaloGeometry, core: SimLayers, neighbours: NeighbourLayers, steps: number, dt: number,
  cellMeters: number = CELL_M, thresholdC = 40,
): HaloSolve {
  const { layers, missing } = assembleHaloLayers(g, core, neighbours);
  sim.reset({ n: haloN(g), cellMeters }, layers, params);
  sim.step(dt, steps);
  return { ...readHaloSolve(sim, g, thresholdC), missing };
}

/** Read the current field of a halo-grid sim as core + core-only stats (never `sim.stats()`). */
export function readHaloSolve(sim: HeatSim, g: HaloGeometry, thresholdC = 40): Omit<HaloSolve, 'missing'> {
  const field = sim.temperature();
  return { core: extractCore(g, field), stats: coreStats(g, field, thresholdC) };
}
