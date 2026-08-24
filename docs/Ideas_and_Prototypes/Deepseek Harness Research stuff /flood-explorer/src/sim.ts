// Simulation core — DEMO EDITION (synthetic terrain, production algorithm).
//
// Copernicus-style priority flood -> depression HIERARCHY -> Fill-Spill-Merge
// water routing (Barnes, Callaghan & Wickert 2021, ESurf 9:105-131) -> rainfall
// losses -> precomputed snapshots the client interpolates.
//
// TERRAIN + FORCING ARE SYNTHETIC and badged in the UI. Depth grid === render grid.
//
// Every volume below is m3 and every elevation m. The stage-volume curves carry
// cell area explicitly: an earlier revision compared an inflow in m3 against a
// curve in metre-cells, understating storage by CELL^2 = 576 and pinning every
// basin at its rim, so all eight rainfall snapshots came out bit-identical.
// `assertSolverLogic` closes the water budget so that cannot recur silently.

// .ts extension: keeps this module runnable under `node --experimental-strip-types`
// for solver-check.ts (node does not do extensionless resolution).
import { buildHierarchy, routeWater, type DepHier } from './depression-hierarchy.ts';

export const GRID = 128;
export const CELL = 24; // metres per cell
export const DOMAIN = GRID * CELL;
export const N = GRID * GRID;

export const RAIN_STEPS = [0, 15, 30, 60, 100, 150, 220, 300]; // mm event total

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, s: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, s: number): number {
  let sum = 0, amp = 1, f = 1, norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(x * f, y * f, s + o * 131);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function synthesizeTerrain(): Float32Array {
  const H = new Float32Array(N);
  const basins: Array<[number, number, number, number]> = [
    [0.36, 0.30, 0.085, 5.0],
    [0.62, 0.42, 0.065, 3.6],
    [0.44, 0.55, 0.055, 2.8],
    [0.58, 0.22, 0.045, 2.2],
  ];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = i / (GRID - 1), y = j / (GRID - 1); // y=0 -> south coast (open boundary)
      const coast = Math.pow(y, 1.3) * 30;
      const hills = fbm(x * 5, y * 5, 11) * 18 * smoothstep(0.18, 0.65, y);
      let h = coast + hills;
      const wx = 0.5 + 0.15 * Math.sin(y * 6.1) + 0.06 * Math.sin(y * 16.0 + 2.0);
      const dw = x - wx;
      h -= 8.0 * Math.exp(-(dw * dw) / 0.045) * smoothstep(0.02, 0.3, y);
      for (const [cx, cy, r, dpt] of basins) {
        const dx = (x - cx) / r, dy = (y - cy) / (r * 0.8);
        h -= dpt * Math.exp(-(dx * dx + dy * dy) * 2.0);
      }
      H[j * GRID + i] = h;
    }
  }
  const S2 = new Float32Array(N); // one 3x3 smoothing pass
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      let s = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= GRID || jj >= GRID) continue;
          s += H[jj * GRID + ii]; c++;
        }
      }
      S2[j * GRID + i] = s / c;
    }
  }
  for (let k = 0; k < N; k++) H[k] = Math.max(S2[k], 0.05);
  return H;
}

class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  private n = 0;
  constructor(cap: number) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }
  get size(): number { return this.n; }
  push(k: number, v: number): void {
    let i = this.n++;
    this.keys[i] = k; this.vals[i] = v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(p, i); i = p;
    }
  }
  pop(): number {
    const top = this.vals[0];
    this.n--;
    if (this.n > 0) {
      this.keys[0] = this.keys[this.n]; this.vals[0] = this.vals[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.keys[l] < this.keys[m]) m = l;
        if (r < this.n && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(m, i); i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    const k = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = k;
    const v = this.vals[a]; this.vals[a] = this.vals[b]; this.vals[b] = v;
  }
}

export function priorityFlood(H: Float32Array): Float32Array {
  const S = new Float32Array(N);
  const done = new Uint8Array(N);
  const heap = new MinHeap(N + GRID);
  for (let i = 0; i < GRID; i++) { // south edge = open sea boundary
    S[i] = H[i]; done[i] = 1; heap.push(S[i], i);
  }
  while (heap.size > 0) {
    const c = heap.pop();
    const i = c % GRID, j = (c / GRID) | 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if ((di === 0) === (dj === 0)) continue; // 4-connectivity
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= GRID || jj >= GRID) continue;
        const m = jj * GRID + ii;
        if (done[m]) continue;
        S[m] = Math.max(H[m], S[c]);
        done[m] = 1;
        heap.push(S[m], m);
      }
    }
  }
  return S;
}

// ---------------------------------------------------------------------------
// Rainfall losses
// ---------------------------------------------------------------------------

/** Storm duration the scenarios are posed over, hours. Matches the HUD readout. */
export const STORM_HOURS = 6;

/**
 * Initial abstraction, mm — depression storage, wetting and interception that
 * must be satisfied before any runoff is generated.
 */
export const INITIAL_ABSTRACTION_MM = 5;

/**
 * Constant infiltration rate, mm/h, for a partly-sealed urban desert surface.
 *
 * SCALAR ON PURPOSE, FOR NOW. Real Dubai is a mosaic of sealed carriageway and
 * open sand whose infiltration rates differ by an order of magnitude, so this
 * becomes a per-cell field the moment imperviousness data lands. `runoffMm`
 * takes the rate as an argument so that swap does not reach callers.
 *
 * WHY THIS IS NOT FITTED TO THE 6.4 % RUNOFF RATIO IN Hussein et al. 2025.
 * That figure is a WATERSHED-OUTLET ratio: 2,216 km2 of Al Ain wadi, over a
 * multi-day three-pulse event, and it includes channel transmission losses as
 * the flood wave soaks into the wadi bed. This domain is a ~9 km2 urban block
 * over six hours with no channel to lose water to. They are different
 * quantities measured at different scales, and forcing this rate to reproduce
 * that ratio would need ~39 mm/h of loss -- which zeroes runoff below ~240 mm
 * and models a city that cannot flood. Sealed urban ground is precisely why
 * Dubai flooded while the wadi absorbed most of its rain.
 *
 * So the ratio is REPORTED (see `waterBudget`) and compared, never targeted.
 */
export const INFILTRATION_MM_PER_H = 4;

/** Rain depth that becomes runoff, mm. Losses are rate-limited, not proportional. */
export function runoffMm(
  rainMm: number,
  initialAbstractionMm = INITIAL_ABSTRACTION_MM,
  rateMmPerH = INFILTRATION_MM_PER_H,
  hours = STORM_HOURS,
): number {
  return Math.max(0, rainMm - initialAbstractionMm - rateMmPerH * hours);
}

// ---------------------------------------------------------------------------
// Model assembly
// ---------------------------------------------------------------------------

export interface FloodModel {
  /** The depression tree. Catchment membership is its cell labelling. */
  hier: DepHier;
  /** Steepest-descent pointer on the filled surface. Drainage-lines layer only. */
  next: Int32Array;
  /** Flow accumulation. Drainage-lines layer only. */
  acc: Float64Array;
}

/**
 * Build the routing model for a DEM.
 *
 * The south edge is the open sea boundary. That is a property of this synthetic
 * terrain; a real city takes its ocean cells from a coastline mask, and every
 * other domain edge must be treated as a wall or the model invents an outlet.
 */
export function buildModel(H: Float32Array, S: Float32Array): FloodModel {
  const oceanCells = new Int32Array(GRID);
  for (let i = 0; i < GRID; i++) oceanCells[i] = i;
  const hier = buildHierarchy(H, GRID, oceanCells);

  // Descent pointers for the drainage overlay. Computed on the FILLED surface
  // with a deterministic tie-break so flats resolve rather than dead-ending.
  const J = new Float32Array(N);
  for (let k = 0; k < N; k++) J[k] = S[k] + hash2(k & 127, k >> 7, 777) * 1e-4;
  const next = new Int32Array(N).fill(-1);
  for (let c = 0; c < N; c++) {
    const i = c % GRID, j = (c / GRID) | 0;
    let best = -1, bestJ = J[c];
    if (i > 0 && J[c - 1] < bestJ) { bestJ = J[c - 1]; best = c - 1; }
    if (i < GRID - 1 && J[c + 1] < bestJ) { bestJ = J[c + 1]; best = c + 1; }
    if (j > 0 && J[c - GRID] < bestJ) { bestJ = J[c - GRID]; best = c - GRID; }
    if (j < GRID - 1 && J[c + GRID] < bestJ) { bestJ = J[c + GRID]; best = c + GRID; }
    next[c] = best;
  }
  // Flow accumulation must run HIGH TO LOW: a cell has to have collected
  // everything upstream of it before it passes its total downstream. The
  // original ran this ascending, so each cell contributed its bare 1 before its
  // own tributaries had arrived and `acc` never grew past "1 + number of
  // immediate upstream neighbours" -- a drainage network that looked plausible
  // on screen and carried no accumulation at all.
  const acc = new Float64Array(N).fill(1);
  const ordDesc = Array.from({ length: N }, (_, k) => k).sort((a, b) => J[b] - J[a]);
  for (const c of ordDesc) { const nx = next[c]; if (nx >= 0) acc[nx] += acc[c]; }

  return { hier, next, acc };
}

/**
 * Rain that collects in each hierarchy node, m3.
 *
 * No flow routing is needed: the hierarchy's flood labels every cell with the
 * basin whose rising water reached it, which IS the catchment partition. Cells
 * labelled OCEAN drain out of the domain and never pond.
 */
function directInflow(hier: DepHier, runoffDepthM: number, cellArea: number): Float64Array {
  const inflow = new Float64Array(hier.nNodes);
  const perCell = runoffDepthM * cellArea;
  for (let k = 0; k < hier.nNodes; k++) inflow[k] = hier.ownCells[k].length * perCell;
  return inflow;
}

export interface WaterBudget {
  rainVol: number; runoffVol: number; infiltratedVol: number;
  ponded: number; toSea: number;
  /** rainVol - (infiltrated + ponded + toSea). Must be ~0; reported, never assumed. */
  residual: number;
  runoffRatio: number;
}

/** Depth field for a rainfall total, m per cell. */
export function computeSnapshot(H: Float32Array, model: FloodModel, rainMm: number): Float32Array {
  return snapshotWithBudget(H, model, rainMm).depth;
}

/** Depth field plus the closed water budget behind it. */
export function snapshotWithBudget(
  H: Float32Array, model: FloodModel, rainMm: number,
): { depth: Float32Array; budget: WaterBudget } {
  const cellArea = CELL * CELL;
  const ro = runoffMm(rainMm);
  const inflow = directInflow(model.hier, ro / 1000, cellArea);
  const routed = routeWater(model.hier, H, cellArea, inflow);
  const rainVol = (rainMm / 1000) * cellArea * N;
  const runoffVol = (ro / 1000) * cellArea * N;
  return {
    depth: routed.depth,
    budget: {
      rainVol, runoffVol,
      infiltratedVol: rainVol - runoffVol,
      ponded: routed.ponded,
      toSea: routed.toSea,
      residual: rainVol - ((rainVol - runoffVol) + routed.ponded + routed.toSea),
      runoffRatio: rainMm > 0 ? ro / rainMm : 0,
    },
  };
}

export function lerpDepth(a: Float32Array, b: Float32Array, t: number, out: Float32Array): Float32Array {
  for (let k = 0; k < N; k++) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export interface Metrics { hits: number; miss: number; fa: number; csi: number; f1: number; pod: number; far: number; }

export function extentMetrics(sim: Float32Array, obs: Float32Array, thr = 0.05): Metrics {
  let hits = 0, miss = 0, fa = 0;
  for (let k = 0; k < N; k++) {
    const s = sim[k] > thr, o = obs[k] > thr;
    if (s && o) hits++;
    else if (!s && o) miss++;
    else if (s && !o) fa++;
  }
  const csi = hits + miss + fa > 0 ? hits / (hits + miss + fa) : 1;
  const pod = hits + miss > 0 ? hits / (hits + miss) : 1;
  const far = hits + fa > 0 ? fa / (hits + fa) : 0;
  const f1 = 2 * hits + miss + fa > 0 ? (2 * hits) / (2 * hits + miss + fa) : 0;
  return { hits, miss, fa, csi, f1, pod, far };
}

/**
 * Height Above Nearest Drainage, m — an INDEPENDENT extent method for the
 * truth tab. Nobre et al. 2016; ranked #5 in
 * `research/floodsim-preflight-research.md` §4, whose recommended shape is
 * "#1 core + #5 free QA overlay". This is that overlay.
 *
 * WHY THIS REPLACED A PERTURBED COPY OF THE SIMULATION. The demo previously
 * built its "observed" extent by flipping 5 % of the simulator's own output,
 * so the truth tab compared the model against a noisy copy of itself and CSI
 * could not fall below ~0.9 whatever the solver did. A validation panel that
 * cannot fail is worse than no validation panel: it teaches the reader to
 * trust a number that carries no information. HAND is derived from the terrain
 * by a different method and can, and does, disagree.
 *
 * It is a PROXY, not an observation. Real validation is Sentinel-1 derived
 * extents (BUILD-SPEC §2a); this occupies the same UI slot until those land.
 */
export function handIndex(H: Float32Array, model: FloodModel, minAccum = HAND_MIN_ACCUM): Float32Array {
  const { next, acc } = model;
  const hand = new Float32Array(N);
  const drainElev = new Float32Array(N);
  const resolved = new Uint8Array(N);
  // Ascending accumulation order guarantees `next` is resolved before its
  // upstream cells, because next always carries strictly more flow.
  const order = Array.from({ length: N }, (_, k) => k).sort((a, b) => acc[b] - acc[a]);
  for (const c of order) {
    const nx = next[c];
    if (acc[c] >= minAccum || nx < 0) { drainElev[c] = H[c]; resolved[c] = 1; continue; }
    drainElev[c] = resolved[nx] ? drainElev[nx] : H[c];
    resolved[c] = 1;
  }
  for (let c = 0; c < N; c++) hand[c] = Math.max(0, H[c] - drainElev[c]);
  return hand;
}

/**
 * Stage rise per mm of runoff for the HAND proxy, m/mm.
 *
 * UNCALIBRATED AND DELIBERATELY SO. Real HAND flood mapping derives stage from
 * at-a-station hydraulic geometry; there is no gauge on synthetic terrain to
 * derive one from. The point of this overlay is that it is an INDEPENDENT
 * method that can disagree with the solver, not that it is right.
 */
export const HAND_STAGE_PER_MM = 0.01;

/**
 * Support area defining the drainage network, in cells. 500 cells x 576 m2 is
 * ~0.29 km2, mid-range for the 0.1-1 km2 critical-support-area convention.
 * NOT tuned for agreement: raising it past ~1500 stops changing the network at
 * all, because what remains at HAND = 0 is depression floor, not channel.
 */
export const HAND_MIN_ACCUM = 500;

/** Binary extent from the HAND proxy at a rainfall total, as a pseudo-depth field. */
export function handExtent(hand: Float32Array, rainMm: number): Float32Array {
  const stage = runoffMm(rainMm) * HAND_STAGE_PER_MM;
  const out = new Float32Array(N);
  if (stage <= 0) return out;
  for (let c = 0; c < N; c++) if (hand[c] < stage) out[c] = 0.2;
  return out;
}
