/**
 * ward-mask.ts — the administrative boundary a ward's statistics are taken over.
 *
 * WHY THIS EXISTS (founder, 2026-10-02). Ballygunge IS KMC Ward 68. The compute
 * domain stays a square — the solver, the rasters and the 3-D scene all want one —
 * but every number the page reports AS THE WARD'S is taken inside the real polygon,
 * and the buildings between the polygon and the square edge are drawn as context.
 * Before this, the square's mean was printed under the ward's name.
 *
 * OPTIONAL BY CONSTRUCTION. Only an area that ships `{area}-ward.json` (see
 * `wardMaskPath` in scope/paths.ts) has one. Every function here takes
 * `WardMask | null`, and null is "this area's box IS its study area": the
 * statistic falls through to the whole field exactly as it was computed before,
 * so Barrackpore, Baruipur and Bengaluru behave byte-for-byte as they did.
 *
 * THE ARTEFACT, written by scripts/build-ward-mask.py:
 *   · `grid` — the SOLVER mask, `n`² cells, SOUTH-up: index gy*n + gx, the layout
 *     of every field the solver returns (ward-raster.ts). Rule: cell centre inside.
 *   · `inWard` — row-indexed against `{area}.json`'s `b`: 1 when that footprint
 *     INTERSECTS the polygon. The per-building statistics read this.
 *   · `ring` — the polygon in ward-local metres, flat [x, y, …], x east, y NORTH.
 *   · run lengths start with a run OUTSIDE the ward (it may be 0).
 * Field statistics use the solver mask; per-building statistics use `inWard`. The
 * two rules differ on purpose (a cell is in by its centre; a building is in if any
 * of it is) and both are stated wherever a figure is printed.
 *
 * THREE-FREE AND DOM-FREE: heat-map-app.ts imports it statically, and the unit
 * tests execute it.
 */

/** The decoded boundary, in the shapes the instrument reads. */
export interface WardMask {
  /** "KMC Ward 68" — the name every masked figure is printed under. */
  readonly name: string;
  readonly licence: string;
  readonly attribution: string;
  /** Polygon area in the ward-local frame, m². */
  readonly areaM2: number;
  /** The polygon, ward-local metres, flat [x0, y0, x1, y1, …], x east, y NORTH. */
  readonly ring: readonly number[];
  /** Solver cells per side; equals the open ward's admitted grid. */
  readonly n: number;
  /** n*n, SOUTH-up (index gy*n + gx), 1 where the cell centre is inside the polygon. */
  readonly cells: Uint8Array;
  readonly cellCount: number;
  /** Per building, row-aligned with the ward's `b`: 1 where the footprint touches the polygon. */
  readonly inWard: Uint8Array;
  readonly inWardCount: number;
}

/** Run lengths (first run OUTSIDE) → a 0/1 array of `size`. Throws if the runs do not sum to `size`. */
export function decodeRle(runs: readonly number[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0, inside = false;
  for (const run of runs) {
    if (!Number.isInteger(run) || run < 0 || at + run > size) throw new RangeError(`ward mask: run ${run} at ${at} overruns ${size} cells`);
    if (inside) out.fill(1, at, at + run);
    at += run;
    inside = !inside;
  }
  if (at !== size) throw new RangeError(`ward mask: runs cover ${at} of ${size} cells`);
  return out;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const count = (a: Uint8Array): number => { let k = 0; for (let i = 0; i < a.length; i++) k += a[i]; return k; };

/**
 * The fetched artefact as a `WardMask`, or null with a console warning.
 *
 * REFUSED, NOT TRUSTED, on every mismatch with the ward it is about to mask. The
 * join to the buildings is BY ROW, with no id, and the join to the field is BY
 * CELL, so a mask built for another domain would print another area's statistics
 * without a single error — the wrong-ward file failure `asPvFile` refuses for the
 * same reason. Its own declared counts are re-derived and compared, so a
 * truncated or hand-edited file cannot pass on its say-so.
 */
export function asWardMask(raw: unknown, expect: { area: string; sizeM: number; n: number; buildings: number }): WardMask | null {
  const refuse = (why: string): null => { console.warn(`ward mask for ${expect.area} refused: ${why}`); return null; };
  if (!raw || typeof raw !== 'object') return refuse('not an object');
  const f = raw as Record<string, unknown>;
  const grid = f.grid as Record<string, unknown> | undefined;
  if (f.ward !== expect.area) return refuse(`it is for "${String(f.ward)}"`);
  if (f.sizeM !== expect.sizeM) return refuse(`domain ${String(f.sizeM)} m, ward ${expect.sizeM} m`);
  if (!grid || grid.n !== expect.n || grid.rows !== 'south-up' || !Array.isArray(grid.rle)) return refuse('solver grid does not match');
  if (!Array.isArray(f.inWard) || f.inWard.length !== expect.buildings) return refuse(`inWard has ${Array.isArray(f.inWard) ? f.inWard.length : '?'} rows, ward has ${expect.buildings}`);
  if (!Array.isArray(f.ring) || f.ring.length < 6 || f.ring.length % 2 !== 0 || !f.ring.every(finite)) return refuse('ring is not a polygon');
  if (typeof f.name !== 'string' || typeof f.attribution !== 'string' || typeof f.licence !== 'string' || !finite(f.areaM2)) return refuse('name, licence or area missing');
  let cells: Uint8Array;
  try { cells = decodeRle(grid.rle as number[], expect.n * expect.n); } catch (e) { return refuse((e as Error).message); }
  const inWard = Uint8Array.from(f.inWard as unknown[], (v) => (v === 1 ? 1 : 0));
  const cellCount = count(cells), inWardCount = count(inWard);
  if (cellCount !== grid.cells) return refuse(`decodes to ${cellCount} cells, declares ${String(grid.cells)}`);
  if (inWardCount !== f.inWardCount) return refuse(`${inWardCount} buildings flagged, declares ${String(f.inWardCount)}`);
  if (cellCount === 0 || inWardCount === 0) return refuse('empty');
  return {
    name: f.name, licence: f.licence, attribution: f.attribution, areaM2: f.areaM2,
    ring: f.ring as number[], n: expect.n, cells, cellCount, inWard, inWardCount,
  };
}

/** What `SimStats` carries, over the cells a statistic is taken over. */
export interface FieldStats { meanC: number; peakC: number; fracAbove: number; thresholdC: number; cells: number }

/**
 * Mean, peak and share above `thresholdC` — over the polygon's cells when there is
 * a mask, over every cell when there is not. The no-mask branch is the same
 * arithmetic as `sim-ts.ts`'s `stats`, so a ward without a polygon reads as before.
 */
export function fieldStats(field: Float32Array, mask: WardMask | null, thresholdC: number): FieldStats {
  if (mask && mask.cells.length !== field.length) throw new RangeError(`ward mask of ${mask.cells.length} cells over a ${field.length}-cell field`);
  let sum = 0, peak = -Infinity, above = 0, k = 0;
  for (let i = 0; i < field.length; i++) {
    if (mask && mask.cells[i] === 0) continue;
    const t = field[i];
    sum += t; k++;
    if (t > peak) peak = t;
    if (t > thresholdC) above++;
  }
  if (k === 0) return { meanC: 0, peakC: 0, fracAbove: 0, thresholdC, cells: 0 };
  return { meanC: sum / k, peakC: peak, fracAbove: above / k, thresholdC, cells: k };
}

/** The heat-stress histogram: `bins` equal bands over [lo, hi], clamped, over the same cells as `fieldStats`. */
export function fieldHistogram(field: Float32Array, mask: WardMask | null, lo: number, hi: number, bins = 12): number[] {
  if (mask && mask.cells.length !== field.length) throw new RangeError(`ward mask of ${mask.cells.length} cells over a ${field.length}-cell field`);
  const out = new Array<number>(bins).fill(0);
  const span = hi - lo;
  for (let i = 0; i < field.length; i++) {
    if (mask && mask.cells[i] === 0) continue;
    out[Math.min(bins - 1, Math.max(0, ((field[i] - lo) / span * bins) | 0))]++;
  }
  return out;
}

/** Whether building row `i` counts as the ward's. Every row does when there is no polygon. */
export function buildingInWard(mask: WardMask | null, i: number): boolean {
  return mask === null || mask.inWard[i] === 1;
}

/** The building rows a ward statistic is taken over: the polygon's, or every row. */
export function wardRows(mask: WardMask | null, buildings: number): number[] {
  const rows: number[] = [];
  for (let i = 0; i < buildings; i++) if (buildingInWard(mask, i)) rows.push(i);
  return rows;
}

/**
 * The ring as a CLOSED polyline of [x, y] points no further apart than `maxStepM`,
 * so a line drawn along it can be draped on the ground per vertex (the ground is
 * sampled at vertices only). The first point is repeated at the end.
 */
export function densifyRing(ring: readonly number[], maxStepM: number): number[] {
  const out: number[] = [];
  const k = Math.floor(ring.length / 2);
  if (k < 3) return out;
  const closed = ring[0] === ring[(k - 1) * 2] && ring[1] === ring[(k - 1) * 2 + 1];
  const m = closed ? k - 1 : k;
  for (let i = 0; i < m; i++) {
    const x0 = ring[i * 2], y0 = ring[i * 2 + 1];
    const j = (i + 1) % m;
    const x1 = ring[j * 2], y1 = ring[j * 2 + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / maxStepM));
    for (let q = 0; q < steps; q++) out.push(x0 + (x1 - x0) * q / steps, y0 + (y1 - y0) * q / steps);
  }
  out.push(out[0], out[1]);
  return out;
}
