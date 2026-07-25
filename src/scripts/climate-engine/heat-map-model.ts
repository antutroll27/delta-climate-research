/**
 * Heat-map intervention model — the pure (DOM-free, GL-free) physics/economics
 * layer. Every constant is cited in docs/heat-map-intervention-model.md; this
 * module is the single source of truth for them and is unit-testable via
 * `assertInterventionLogic()` (run with `node --experimental-strip-types`).
 *
 * Deterministic footprint rasterisation lives in `ward-raster.ts`; everything
 * here is pure array math.
 */
// .ts extension: keeps this module runnable under `node --experimental-strip-types`
// for assertInterventionLogic() (node doesn't do extensionless resolution).
import { CANONICAL_GRID_N, DEFAULT_PARAMS, type SimParams, type SimLayers } from './types.ts';

export const SIM_N = CANONICAL_GRID_N;         // grid side (ward 1400 m → dx ≈ 7.29 m/cell)
export const RAMP_MIN = 26, RAMP_MAX = 48;    // °C colour-ramp bounds
export const SIM_D = 2.5;                     // §2 diffusion — λ≈47 m: LST contrast + park halo
export const RESET_BURST = 600;               // diffusion-relax steps after each reset
export const GREEN_REF = 0.45, DT_REF = 2.5, E_REF = 0.15;   // §5 score normalisers
export const COST = { roofM2: 150, tree: 1500, parkCr: 1.5, facadeM2: 9500 };  // ₹ [C1–C5]
export const PATH_DELTA: Record<string, number> = { '2025': 0, target: -1.2, bau: 2.4 };
export const FALLBACK_TAIR = 32;              // used only when the live feed is down

const ALB_BASE = 0.15, ALB_COOL = 0.60;       // §3.2 dark vs aged-cool-roof albedo (LBNL)
const TREE_CAP = 0.7, PARK_R_M = 50;          // §3.1 crown-closure cap · §3.3 blob = Kolkata TVoE
const FACADE_Q = 0.30;                        // §3.4 anthropogenic-heat reduction fraction
const TREES_PER_KM = 110;
export const PARK_HA = 0.785;

export interface WardData { center: [number, number]; sizeM: number; count: number; b: number[][]; [k: string]: unknown; }
export interface RoadsData { ways: { w: number; p: number[] }[]; }
export interface Interventions { trees: number; roof: number; parks: number; facades: number; }
export interface Ambient { tAir: number; rh: number; wind: number; cloud: number; feels: number; }
export interface Spatial {
  corridorSorted: Int32Array; corridorKm: number; parkCenters: [number, number][];
  roofM2: number; facadeM2: number; cellArea: number; cellM: number;
}
export interface ScenarioState { live: Ambient | null; phase: 'peak' | 'night'; path: string; iv: Interventions; }

export const fmtCr = (r: number) =>
  r >= 1e7 ? `${(r / 1e7).toFixed(2)} cr` : r >= 1e5 ? `${(r / 1e5).toFixed(1)} L` : `${Math.round(r).toLocaleString('en-IN')}`;
export const noise01 = (x: number, y: number) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
export const eqCell = (p: SimParams, a: number, v: number, b: number) => {
  const k = p.kRad + p.h * p.wind, pull = p.kRad * p.tSky + p.h * p.wind * p.tAir;
  return (p.S * (1 - a) * p.sun + p.Q * b - p.L * v + pull) / k;
};
export function eqMean(layers: SimLayers, p: SimParams): number {
  const k = p.kRad + p.h * p.wind, pull = p.kRad * p.tSky + p.h * p.wind * p.tAir;
  let s = 0; const N = layers.albedo.length;
  for (let i = 0; i < N; i++) s += (p.S * (1 - layers.albedo[i]) * p.sun + p.Q * layers.built[i] - p.L * layers.veg[i] + pull) / k;
  return s / N;
}

/** NWS Rothfusz heat index (feels-like) — Met Norway ships no apparent-temp field. */
export function heatIndexC(T: number, RH: number): number {
  const Tf = T * 9 / 5 + 32; if (Tf < 80) return T;
  let hi = -42.379 + 2.04901523 * Tf + 10.14333127 * RH - 0.22475541 * Tf * RH
    - 0.00683783 * Tf * Tf - 0.05481717 * RH * RH + 0.00122874 * Tf * Tf * RH
    + 0.00085282 * Tf * RH * RH - 0.00000199 * Tf * Tf * RH * RH;
  if (RH < 13 && Tf >= 80 && Tf <= 112) hi -= ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(Tf - 95)) / 17);
  else if (RH > 85 && Tf >= 80 && Tf <= 87) hi += ((RH - 85) / 10) * ((87 - Tf) / 5);
  return (hi - 32) * 5 / 9;
}

/** Per-ward precompute: road corridors ranked hottest-first, open-land park
 *  centres, and ₹-cost quantities. Pure array math over the rasterised base. */
export function buildSpatial(d: WardData, base: SimLayers, roads: RoadsData | null): Spatial {
  const n = SIM_N, half = d.sizeM / 2, cellM = d.sizeM / n, cellArea = cellM * cellM;
  const toCell = (mx: number, mz: number): [number, number] =>
    [Math.floor((mx + half) / d.sizeM * n), n - 1 - Math.floor((half - mz) / d.sizeM * n)]; // → sim (x,y), matches rasterBase Y-flip
  const corridor = new Uint8Array(n * n); let km = 0;
  for (const way of (roads?.ways ?? [])) {
    const p = way.p, rad = way.w > 1 ? 2 : 1;
    for (let i = 0; i < p.length - 2; i += 2) {
      const x0 = p[i], z0 = p[i + 1], x1 = p[i + 2], z1 = p[i + 3];
      const Lm = Math.hypot(x1 - x0, z1 - z0); km += Lm / 1000;
      const steps = Math.max(1, Math.ceil(Lm / cellM));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, c = toCell(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
        for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
          const gx = c[0] + dx, gy = c[1] + dy;
          if (gx >= 0 && gx < n && gy >= 0 && gy < n) corridor[gy * n + gx] = 1;
        }
      }
    }
  }
  const pnom: SimParams = { ...DEFAULT_PARAMS, D: SIM_D, sun: 1, tAir: 32, tSky: 17 };
  const cc: [number, number][] = [];
  for (let j = 0; j < n * n; j++) if (corridor[j] && base.built[j] < 0.55) cc.push([j, eqCell(pnom, base.albedo[j], base.veg[j], base.built[j])]);
  cc.sort((a, b) => b[1] - a[1]);
  const corridorSorted = Int32Array.from(cc.map(c => c[0]));

  const R1 = 7, R2 = 20, sep = Math.round(180 / cellM);
  const score = (cx: number, cy: number) => {
    let open = 0, on = 0, ctx = 0, cn = 0;
    for (let dy = -R1; dy <= R1; dy++) for (let dx = -R1; dx <= R1; dx++) { const gx = cx + dx, gy = cy + dy; if (gx < 0 || gx >= n || gy < 0 || gy >= n) continue; open += 1 - base.built[gy * n + gx]; on++; }
    for (let dy = -R2; dy <= R2; dy += 3) for (let dx = -R2; dx <= R2; dx += 3) { const gx = cx + dx, gy = cy + dy; if (gx < 0 || gx >= n || gy < 0 || gy >= n) continue; ctx += base.built[gy * n + gx]; cn++; }
    return (open / Math.max(1, on)) * (0.3 + 0.7 * (ctx / Math.max(1, cn)));
  };
  const cand: [number, number, number][] = [];
  for (let cy = 12; cy < n - 12; cy += 4) for (let cx = 12; cx < n - 12; cx += 4) cand.push([cx, cy, score(cx, cy)]);
  cand.sort((a, b) => b[2] - a[2]);
  const parkCenters: [number, number][] = [];
  for (const c of cand) { if (parkCenters.length >= 10) break; if (parkCenters.every(pc => Math.hypot(pc[0] - c[0], pc[1] - c[1]) >= sep)) parkCenters.push([c[0], c[1]]); }

  let roofM2 = 0; for (let j = 0; j < n * n; j++) roofM2 += base.built[j] * cellArea;
  let facadeM2 = 0;
  for (const b of d.b) { let per = 0; const nv = (b.length - 1) / 2; for (let k = 0; k < nv; k++) { const a0 = 1 + 2 * k, a1 = 1 + 2 * ((k + 1) % nv); per += Math.hypot(b[a1] - b[a0], b[a1 + 1] - b[a0 + 1]); } facadeM2 += per * Math.min(b[0], 12); }
  return { corridorSorted, corridorKm: km, parkCenters, roofM2, facadeM2, cellArea, cellM };
}

/** Apply the four sliders onto copies of the base layers (spec §3). */
export function applyInterventions(base: SimLayers, iv: Interventions, sp: Spatial | null): SimLayers {
  const N2 = SIM_N * SIM_N, albedo = base.albedo.slice(), veg = base.veg.slice();
  const dAlb = ALB_COOL - ALB_BASE;
  if (iv.roof > 0) for (let i = 0; i < N2; i++) { const b = base.built[i]; if (b > 0) albedo[i] = Math.min(0.85, albedo[i] + b * (iv.roof / 100) * dAlb); }
  const fF = iv.facades / 15;
  if (fF > 0) for (let i = 0; i < N2; i++) { const b = base.built[i]; if (b > 0) veg[i] = Math.min(1, veg[i] + Math.min(0.25, fF * b * 0.15)); }
  if (sp && iv.trees > 0) { const cs = sp.corridorSorted, k = Math.floor((iv.trees / 50) * cs.length); for (let q = 0; q < k; q++) { const i = cs[q]; veg[i] = Math.min(TREE_CAP, veg[i] + 0.6); albedo[i] = Math.min(0.85, albedo[i] + 0.04); } }
  if (sp && iv.parks > 0) {
    const r = Math.round(PARK_R_M / sp.cellM), r2 = r * r;
    const requested = Math.min(Math.max(0, iv.parks), sp.parkCenters.length);
    const fullParks = Math.floor(requested), finalFraction = requested - fullParks;
    const patchCount = fullParks + (finalFraction > 0 ? 1 : 0);
    for (let kk = 0; kk < patchCount; kk++) { const c = sp.parkCenters[kk];
      const coverage = kk < fullParks ? 1 : finalFraction;
      for (let y = Math.max(0, c[1] - r); y <= Math.min(SIM_N - 1, c[1] + r); y++) for (let x = Math.max(0, c[0] - r); x <= Math.min(SIM_N - 1, c[0] + r); x++) {
        const dx = x - c[0], dy = y - c[1]; if (dx * dx + dy * dy <= r2) {
          const i = y * SIM_N + x;
          // The final patch is blended by requested area fraction. This keeps a
          // 0.1% control from rounding up to a whole 0.785 ha intervention.
          veg[i] = Math.max(veg[i], veg[i] + (0.90 - veg[i]) * coverage);
          albedo[i] = Math.max(albedo[i], albedo[i] + (0.20 - albedo[i]) * coverage);
        }
      } }
  }
  return { albedo, veg, built: base.built, water: base.water };
}

/** Weighted-area greening ratio (BAF/Seattle-consolidated weights, §5 eq 9). */
export function computeGreenG(layers: SimLayers): number {
  const N2 = SIM_N * SIM_N; let s = 0;
  for (let i = 0; i < N2; i++) {
    const b = layers.built[i], v = layers.veg[i], w = layers.water[i];
    const coolRoof = b > 0 ? Math.max(0, Math.min(1, (layers.albedo[i] - 0.30) / 0.30)) : 0;
    s += Math.min(1, 1.0 * v * (1 - b) + 0.6 * v * b + 0.8 * w + 0.1 * coolRoof * b);
  }
  return s / N2;
}

/** ₹ budget from real geometry quantities (§5). */
export function computeCost(iv: Interventions, sp: Spatial | null): number {
  if (!sp) return 0;
  return (iv.roof / 100) * sp.roofM2 * COST.roofM2
    + (iv.trees / 50) * sp.corridorKm * TREES_PER_KM * COST.tree
    + Math.min(iv.parks, sp.parkCenters.length) * PARK_HA * COST.parkCr * 1e7
    + (iv.facades / 15) * sp.facadeM2 * 0.25 * COST.facadeM2;
}

/** Scenario forcing → SimParams (§2 D retune, §3.4 facade Q cut, §4 diurnal/pathway). */
export function currentParams(s: ScenarioState): SimParams {
  const L = s.live, baseTair = (L ? L.tAir : FALLBACK_TAIR) + (PATH_DELTA[s.path] ?? 0);
  const wind = L ? Math.min(2.5, Math.max(0.3, L.wind / 3)) : 1, cloud = L ? L.cloud / 100 : 0;
  // humidity gates evaporative cooling: dry air cools harder, muggy monsoon air stalls it.
  const rh = L ? L.rh : 60, evap = 0.6 + 0.6 * (1 - rh / 100);
  const Q = DEFAULT_PARAMS.Q * (1 - FACADE_Q * (s.iv.facades / 15));
  const b: SimParams = { ...DEFAULT_PARAMS, D: SIM_D, Q, wind, L: DEFAULT_PARAMS.L * evap };
  return s.phase === 'peak'
    ? { ...b, sun: 1 * (1 - 0.6 * cloud), tAir: baseTair, tSky: 17 }
    : { ...b, sun: 0, tAir: baseTair - 2.5, tSky: 11 };
}

/**
 * Controlled Compare forcing has a named record for each phase. Unlike Explore,
 * retained conditions are not derived from a latest-observation shortcut.
 */
export function currentParamsForReference(
  ambient: Ambient,
  phase: 'peak' | 'night',
  iv: Interventions,
): SimParams {
  const wind = Math.min(2.5, Math.max(0.3, ambient.wind / 3));
  const cloud = ambient.cloud / 100;
  const evap = 0.6 + 0.6 * (1 - ambient.rh / 100);
  const Q = DEFAULT_PARAMS.Q * (1 - FACADE_Q * (iv.facades / 15));
  const base: SimParams = { ...DEFAULT_PARAMS, D: SIM_D, Q, wind, L: DEFAULT_PARAMS.L * evap, tAir: ambient.tAir };
  return phase === 'peak'
    ? { ...base, sun: 1 * (1 - 0.6 * cloud), tSky: 17 }
    : { ...base, sun: 0, tSky: 11 };
}

/** Green Score 0–100 (§5 eq 8): greening + cooling achieved + budget efficiency. */
export function greenScore(greenG: number, coolingC: number, cost: number): number {
  const E = cost > 0 ? Math.min(1, (Math.max(0, coolingC) / Math.max(0.02, cost / 1e7)) / E_REF) : 0;
  return Math.max(0, Math.min(100, Math.round(100 * (0.40 * Math.min(1, greenG / GREEN_REF) + 0.40 * Math.min(1, Math.max(0, coolingC) / DT_REF) + 0.20 * E))));
}

/** Runnable self-check (no DOM/GL). node --experimental-strip-types -e
 *  "import('./heat-map-model.ts').then(m=>m.assertInterventionLogic())" */
export function assertInterventionLogic(): void {
  const a = (ok: boolean, msg: string) => { if (!ok) throw new Error(`heat-map-model: ${msg}`); };
  const N2 = SIM_N * SIM_N;
  const mk = (): SimLayers => ({ albedo: new Float32Array(N2), veg: new Float32Array(N2), built: new Float32Array(N2), water: new Float32Array(N2) });
  // realistic morphology: alternating building / bare-street columns (streets
  // start low-veg like real roads, so trees have somewhere to green)
  const base = mk(); const streets: number[] = [];
  for (let i = 0; i < N2; i++) { const built = (i % 2 === 0) ? 1 : 0; base.built[i] = built; base.albedo[i] = built ? 0.2 : 0.32; base.veg[i] = built ? 0 : 0.05; if (!built) streets.push(i); }
  const sp: Spatial = { corridorSorted: Int32Array.from(streets), corridorKm: 40, parkCenters: [[48, 48], [140, 140]], roofM2: 5e5, facadeM2: 8e5, cellArea: 53.1, cellM: 7.29 };
  const p: SimParams = currentParams({ live: null, phase: 'peak', path: '2025', iv: { trees: 0, roof: 0, parks: 0, facades: 0 } });

  const base0 = eqMean(base, p);
  const roofed = eqMean(applyInterventions(base, { trees: 0, roof: 100, parks: 0, facades: 0 }, sp), p);
  const treed = eqMean(applyInterventions(base, { trees: 50, roof: 0, parks: 0, facades: 0 }, sp), p);
  a(roofed < base0 - 0.2, `cool roofs cool the mean (${base0.toFixed(1)}→${roofed.toFixed(1)})`);
  a(treed < base0 - 0.05, `trees cool the mean (${base0.toFixed(1)}→${treed.toFixed(1)})`);

  // a fully-built cell equilibrates hot (orange/red band) at default ambient
  const hotCell = eqCell(p, 0.2, 0, 1);
  a(hotCell > 40 && hotCell < 50, `built-core equilibrium plausible (got ${hotCell.toFixed(1)}°C)`);

  // costs monotonic + non-zero
  const c1 = computeCost({ trees: 10, roof: 20, parks: 1, facades: 2 }, sp);
  const c2 = computeCost({ trees: 20, roof: 40, parks: 2, facades: 4 }, sp);
  a(c1 > 0 && c2 > c1, 'cost increases with intervention');

  // score bounded, rises with cooling
  a(greenScore(0.3, 0, 0) >= 0 && greenScore(0.3, 2, 1e7) <= 100, 'score bounded 0–100');
  a(greenScore(0.4, 2, 5e7) > greenScore(0.4, 0.5, 5e7), 'score rewards cooling');
}
