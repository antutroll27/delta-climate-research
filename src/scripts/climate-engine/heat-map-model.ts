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
import { CANONICAL_GRID_N, DEFAULT_PARAMS, STORE_NIGHT, type ClimateConstants, type Costs, type SimParams, type SimLayers } from './types.ts';
import { skyTemperatureC, dewpointC, shiftAirPreservingVapour } from './sky.ts';

export const SIM_N = CANONICAL_GRID_N;         // grid side (ward 1400 m → dx ≈ 7.29 m/cell)
/**
 * Colour-ramp bounds, °C. Kept as the LEGACY FIXED PAIR for anything that still
 * wants a constant; `rampBounds()` below is what the map uses.
 */
export const RAMP_MIN = 26, RAMP_MAX = 48;

/**
 * Reference surface extremes, p2–p98 of the MEASURED Sentinel-2 texture and the
 * footprint raster across all three wards. These make `rampBounds` depend on the
 * CONDITION but not on which ward is open — so two wards at the same conditions
 * still share a colour scale and remain visually comparable, which per-ward
 * autoscaling would quietly destroy.
 */
const REF = { vegHi: 0.878, vegLo: 0.0, albHi: 0.190, albLo: 0.088, builtHi: 1.0, builtLo: 0.0 };

/**
 * Colour-ramp bounds for the current forcing.
 *
 * WHY THIS IS NOT A FIXED PAIR ANY MORE. 26–48 °C was chosen before the model
 * was calibrated and it fits almost nothing the model produces. On a normal day
 * the field spans 28–39 °C, which lands entirely in the ramp's lower half — the
 * whole ward renders one flat green and the instrument looks inert. On a
 * heatwave the field reaches 76 °C and EVERY cell clips: 100 % of the ward
 * becomes one shade of red, so the map stops discriminating on precisely the
 * day a reader opens it.
 *
 * The bounds are therefore evaluated from the same physics the field uses, at a
 * coolest-plausible and hottest-plausible cell. The scale moves with the
 * weather and the pathway; it does not move with the ward. The legend always
 * prints the numbers, so a reader is never guessing what a colour means.
 */
export function rampBounds(p: SimParams): [number, number] {
  const lo = eqCell(p, REF.albHi, REF.vegHi, REF.builtLo);   // shaded, green, unbuilt
  const hi = eqCell(p, REF.albLo, REF.vegLo, REF.builtHi);   // dark, bare, fully built
  // A degenerate span would divide by ~zero in the shader and flatten the map.
  return hi - lo < 1 ? [lo - 0.5, lo + 0.5] : [lo, hi];
}
/**
 * Empirical spatial-influence kernel — NOT a thermal diffusivity.
 * Lateral heat conduction between 7.29 m cells is physically negligible (soil
 * diurnal damping depth ≈ 0.12 m, ~8 orders of magnitude short), so this term
 * does not represent conduction. It is a smoothing kernel whose steady state
 * has decay length λ = dx·√(D/k) ≈ 47 m, deliberately kept short because our
 * field is land-surface temperature, which real thermal imagery shows as sharp.
 * The 120–300 m park-cooling distances in the literature are an AIR-temperature
 * phenomenon driven by advection, which this model does not represent.
 */
export const SIM_D = 2.5;
export const RESET_BURST = 600;               // relaxation steps after each reset
/** §5 score normalisers. GREEN_REF: Berlin BAF 0.30–0.60 target band midpoint.
 *  DT_REF: ward-scale cooling beyond ~2–3 °C is not credible.
 *  E_REF is TOOL-RELATIVE, not an external benchmark — no published
 *  cost-per-degree-cooled figure exists to normalise against. Labelled as such. */
export const GREEN_REF = 0.45, DT_REF = 2.5, E_REF = 0.15;
/**
 * FOUR CONSTANTS USED TO LIVE HERE AND HAVE MOVED to the scope directory
 * (`src/scripts/climate-engine/scope`, files `registry.ts` and `resolve.ts`),
 * reaching this module as a `ClimateConstants` parameter. They are named so a reader
 * looking for them finds the reason rather than an absence:
 *
 *   COST           four figures in RUPEES     → REGISTRY.<country>.costs
 *   PATH_DELTA     all-India warming deltas   → REGISTRY.<country>.pathway, resolved
 *                                               against PATHWAYS in resolve.ts
 *   FALLBACK_TAIR  32 °C, Kolkata climatology → REGISTRY.<c>.cities.<y>.fallbackTairC
 *   PARK_R_M       50 m, Kolkata TVoE scale   → REGISTRY.<c>.cities.<y>.parkRadiusM
 *
 * NOT ONE OF THEM WAS A FACT ABOUT HEAT TRANSFER. Two belong to a country and two
 * to a city, and held here a second city could not be added without being wrong:
 * Dubai's fallback air temperature is nearer 40 °C, no Gulf warming pathway has been
 * adopted at all, and a DEWA audience quoted rupees would be reading Kolkata's
 * economics under Dubai's name. None of those four failures throws. Each computes
 * cleanly and prints a plausible number.
 *
 * THE DEPENDENCY POINTS ONE WAY ONLY. This module must not import from that
 * directory — not even a type. It knows DATA and PARAMETERS, never IDENTITY: nothing
 * here can name a ward, a city or a country, which is what lets the same physics run
 * over ground it has never seen. `ClimateConstants` and `Costs` are declared in
 * `./types.ts`, the vocabulary both halves already share, so neither has to import
 * the other; `tests/unit/obos-scope.test.mjs` reads this file's source to keep it so.
 *
 * The move itself is guarded by `data/calibration/golden-params.json` and
 * `golden-layers.json`, captured BEFORE it: 24 frozen `currentParams` cases, six
 * `computeCost` figures and a park-blob transect that straddles the blob edge. A
 * transcription that changed a value fails those rather than shipping quietly.
 */

const ALB_BASE = 0.15, ALB_COOL = 0.60;       // §3.2 dark vs aged-cool-roof albedo (LBNL)
const TREE_CAP = 0.7;                         // §3.1 crown-closure cap
/* §3.3's park blob radius is now `applyInterventions`' `parkRadiusM` parameter —
   it was 50 m, measured as KOLKATA's tree-void-effect scale, and a city's measured
   length is not a property of the operator that applies it. See the note above. */
/**
 * Neighbourhood-scale anthropogenic-heat reduction from vertical greening.
 * Was 0.30 (uncited). Gunawardena & Steemers 2023 (Buildings & Cities,
 * 10.5334/bc.282) is the only neighbourhood-scale measurement found: green
 * facades cut space-conditioning energy 2.1% and living walls 5.2%, and moved
 * heat-island intensity 1.86 K → 1.81 K (~3%). The dramatic −13 to −20 °C
 * figures are LOCAL wall-surface effects; the authors found the vapour flux
 * "advects away to background levels" beyond a proximate zone.
 * Facades are a marginal ward-scale lever, and the model now says so.
 */
const FACADE_Q = 0.03;

/**
 * Evapotranspiration after dark, as a fraction of the daytime rate.
 *
 * Stomata close at night, so transpiration all but stops; what remains is soil
 * and canopy-interception evaporation. Eddy-covariance studies over urban and
 * peri-urban vegetation put nocturnal latent flux at 5–15 % of midday. Running
 * the full daytime L overnight was giving parks a cooling advantage they cannot
 * physically hold once the sun is down.
 */
const NIGHT_ET_FRACTION = 0.10;

/**
 * Anthropogenic heat at night, as a fraction of the daytime rate.
 *
 * Traffic, air-conditioning and commercial load all fall after dark but none go
 * to zero. 0.5 is the round midpoint of the diurnal Q profiles reported for
 * South and East Asian cities; Phase 2 fits it against measurement rather than
 * leaving it at a guess.
 */
const Q_NIGHT_RATIO = 0.5;

/**
 * Solar elevation factor above which "now" runs the daytime branch.
 *
 * cos(zenith) = 0.05 is the sun about 3° above the horizon — past civil
 * twilight, low enough that the surface is still storage-dominated, high enough
 * that a real shortwave term has begun. A CLOCK HOUR WOULD BE WRONG: Kolkata's
 * sunrise swings roughly 40 minutes between solstices, so a fixed 06:00 cutoff
 * models night in June and day in December at the same instant.
 */
export const SUN_LIT = 0.05;

/**
 * Width of the dewpoint taper, K. Evaporation is driven by the vapour-pressure
 * deficit, which closes continuously as the surface cools toward the dewpoint —
 * so ET must ramp to zero, not switch off.
 *
 * A hard cutoff put a 0.39 K step on park cells at RH ≈ 86 %, which is squarely
 * inside the 85–95 % band Kolkata monsoon nights occupy: the live humidity feed
 * would have jerked the map every time it drifted across the threshold.
 */
const DEWPOINT_TAPER_K = 1.0;

/**
 * Night latent term: below the dewpoint the surface is condensing rather than
 * evaporating, so ET cannot keep removing heat.
 *
 * The taper depends on the answer it modifies, so it is evaluated on the no-ET
 * equilibrium of a representative vegetated cell and applied to the whole field.
 * ponytail: one scalar evaluation per frame, not per cell. Cells span ~2 K at
 * night, so a per-cell taper would only differ on those straddling the
 * dewpoint; move it into eqCell/the shader if that edge ever matters.
 */
function nightLatent(p: SimParams, rh: number): number {
  const dry: SimParams = { ...p, L: 0 };
  const surface = eqCell(dry, 0.18, 0.6, 0);   // eqCell(p, albedo, veg, built)
  const headroom = (surface - dewpointC(p.tAir, rh)) / DEWPOINT_TAPER_K;
  return p.L * NIGHT_ET_FRACTION * Math.min(1, Math.max(0, headroom));
}
const TREES_PER_KM = 110;
export const PARK_HA = 0.785;

export interface WardData { center: [number, number]; sizeM: number; count: number; b: number[][]; [k: string]: unknown; }
export interface RoadsData { ways: { w: number; p: number[] }[]; }
/** {ward}-water.json — OSM polygons in the roads contract's frame. `k` is the
 * broad class ('water' | 'river' | 'pool'); `p` is flat [x,y,…] ward metres. */
export interface WaterData { polys: { k: string; p: number[] }[]; }
export interface Interventions { trees: number; roof: number; parks: number; facades: number; }
export interface Ambient {
  tAir: number; rh: number; wind: number; cloud: number; feels: number;
  /** met.no `wind_from_direction`, degrees. Cloud advection ONLY — the MODEL uses
   *  wind as a scalar (`p.h * p.wind`) and has no direction term anywhere. Do not
   *  wire this into the physics believing it already belongs there. */
  windFrom?: number;
  /**
   * ISO instant the reading is valid for (met.no's `timeseries[0].time`).
   * Optional because the physics never needs it — but the UI does: this reading
   * sets the simulation's boundary conditions, so "how old is it" is a property
   * of the answer on screen, not a decoration. Absent means unknown, which the
   * dial must render as unknown rather than as fresh.
   */
  validAt?: string;
}
export interface Spatial {
  corridorSorted: Int32Array; corridorKm: number; parkCenters: [number, number][];
  roofM2: number; facadeM2: number; cellArea: number; cellM: number;
}
export interface ScenarioState {
  live: Ambient | null; phase: 'peak' | 'night'; path: string; iv: Interventions;
  /**
   * The scope's climate constants — the warming table `path` indexes into, and the
   * air temperature to fall back on when the live feed is down.
   *
   * REQUIRED, not optional with a default. A default would have to be Kolkata's,
   * which is the exact defect this parameter exists to end: every scenario that
   * forgot to pass one would silently model Kolkata's climatology under another
   * city's name and never say so. Absent, it is a compile error at the call site.
   */
  climate: ClimateConstants;
  /* HEATWAVE IS A FORCING OVERRIDE, NOT A THIRD PHASE — the same shape `sunNow`
     takes, and for the same reason its comment gives: every consumer downstream
     (ACCURACY, bandLabel, the DC-URS split, the Compare link, the phase label)
     is written against the binary phase. Non-null substitutes this air
     temperature for the observed one and holds today's VAPOUR PRESSURE while
     doing it; the phase stays 'peak'. */
  heatTairC?: number | null;
  /**
   * Clear-sky solar elevation factor for RIGHT NOW at the ward, 0–1, or null
   * for the two canonical phases.
   *
   * When present the scenario stops being "a representative midday" and becomes
   * "this ward, this hour": the sun term is real astronomy rather than a fixed 1,
   * and the day/night branch follows the actual sun rather than a button. It also
   * removes an incoherence the canonical peak carries — `peak` applies FULL noon
   * insolation to whatever air temperature was last observed, so at 03:00 it
   * models midday sun on 3 a.m. air, a combination that exists at no real moment.
   */
  sunNow?: number | null;
}

/* `fmtCr` STOOD HERE and is now `fmtMoney` in ./money.ts. It was the fifth thing
   in this module that was not a fact about heat transfer: it hardcoded the rupee's
   numbering convention (crore, lakh) and its digit grouping (`en-IN`), while all
   three call sites separately pasted a ₹ in front of the result. A formatter is
   presentation, a currency is a COUNTRY's, and neither belongs in the physics —
   `tests/unit/obos-scope.test.mjs` now greps this file's code for ₹, en-IN, INR,
   crore and lakh alongside the place names, because the place-name tripwire that
   was already here walked straight past every one of them. */
export const noise01 = (x: number, y: number) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
export const eqCell = (p: SimParams, a: number, v: number, b: number) => {
  const k = p.kRad + p.h * p.wind, pull = p.kRad * p.tSky + p.h * p.wind * p.tAir;
  // `p.store` is zero by day; at night it is the fabric discharging the day's
  // heat, which is what puts the measured surface ABOVE air. See SimParams.store.
  return (p.S * (1 - a) * p.sun + p.Q * b - p.L * v + p.store + pull) / k;
};
export function eqMean(layers: SimLayers, p: SimParams): number {
  const k = p.kRad + p.h * p.wind, pull = p.kRad * p.tSky + p.h * p.wind * p.tAir;
  let s = 0; const N = layers.albedo.length;
  for (let i = 0; i < N; i++) s += (p.S * (1 - layers.albedo[i]) * p.sun + p.Q * layers.built[i] - p.L * layers.veg[i] + p.store + pull) / k;
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
 *  centres, and the geometry quantities `computeCost` prices (roof and facade
 *  area, corridor length). Currency-free — the unit prices arrive with the scope.
 *  Pure array math over the rasterised base. */
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

/**
 * Apply the four sliders onto copies of the base layers (spec §3).
 *
 * `parkRadiusM` is the CITY's measured cooling-blob scale, passed in rather than
 * held here — see the constants note above. It reaches the raster as
 * `round(parkRadiusM / cellM)` cells, so the same metres describe the same ground
 * whatever the grid resolution.
 */
export function applyInterventions(base: SimLayers, iv: Interventions, sp: Spatial | null, parkRadiusM: number): SimLayers {
  const N2 = SIM_N * SIM_N, albedo = base.albedo.slice(), veg = base.veg.slice();
  const dAlb = ALB_COOL - ALB_BASE;
  if (iv.roof > 0) for (let i = 0; i < N2; i++) { const b = base.built[i]; if (b > 0) albedo[i] = Math.min(0.85, albedo[i] + b * (iv.roof / 100) * dAlb); }
  // Facades act ONLY through the anthropogenic-heat term (FACADE_Q, applied in
  // currentParams). The previous ground-vegetation addition used an ET-equivalence
  // factor η = 0.15 for which no neighbourhood-scale measurement exists, and
  // Gunawardena & Steemers 2023 found green-wall vapour flux advects away rather
  // than accumulating. Adding ground veg for a wall treatment was double-counting.
  if (sp && iv.trees > 0) { const cs = sp.corridorSorted, k = Math.floor((iv.trees / 50) * cs.length); for (let q = 0; q < k; q++) { const i = cs[q]; veg[i] = Math.min(TREE_CAP, veg[i] + 0.6); albedo[i] = Math.min(0.85, albedo[i] + 0.04); } }
  if (sp && iv.parks > 0) {
    const r = Math.round(parkRadiusM / sp.cellM), r2 = r * r;
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

/**
 * Capital budget from real geometry quantities (§5), in `costs.currency`.
 *
 * `costs` IS REQUIRED AND NON-NULL, deliberately. A country that has adopted no
 * cost basis has no cost answer, and the tempting `costs ?? 0` here would quote it
 * a budget of nothing — a number that computes cleanly, reads as a finding, and is
 * wrong. The absence is refused once, where a scope is chosen — `requireCosts`, in
 * the scope directory's `resolve.ts` — so that it can never arrive here as a zero.
 *
 * The four multipliers each act on a DIFFERENT spatial quantity, so an absent field
 * would be `undefined`, its term NaN, and NaN poisons the whole total — which is
 * loud, and is why `Costs` has no optional members.
 */
export function computeCost(iv: Interventions, sp: Spatial | null, costs: Costs): number {
  if (!sp) return 0;
  return (iv.roof / 100) * sp.roofM2 * costs.roofM2
    + (iv.trees / 50) * sp.corridorKm * TREES_PER_KM * costs.tree
    /* The `* 1e7` that stood here was a crore-to-rupee conversion — an Indian
       numbering convention living inside the physics, applied to every country's
       money. It moved into the declared figure (see `Costs.park`); the arithmetic
       is identical, since 1.5 crore is 15,000,000. */
    + Math.min(iv.parks, sp.parkCenters.length) * PARK_HA * costs.park
    + (iv.facades / 15) * sp.facadeM2 * 0.25 * costs.facadeM2;
}

/**
 * Humidity gate on evapotranspiration, CAPPED AT 1.0 — 2026-08-09, see
 * docs/green-score-methodology.md §4.2.2.
 *
 * Uncapped, this ramp kept RAISING evapotranspiration as the air dried, to 1.2x
 * at rh 0, while the model's own 4 K vegetated-surface bar LOSES headroom as the
 * sky dries. The two crossed near 22 % rh — and ward-observations.json records
 * humidity down to 14.1 %, so the model broke its own physical bar on six of 298
 * readings we actually measured.
 *
 * The cap is the anchor the linear form never had. Real stomata CLOSE under high
 * vapour-pressure deficit and transpiration falls; a term rising without limit as
 * air dries has the physics backwards at the dry end. A linear rise is a fair
 * local approximation near ordinary humidity, and that is exactly where this
 * leaves it alone: the cap binds only below rh 33.3 %, so 230 of those 298
 * readings are bit-for-bit identical and the median-case Green Score is unmoved.
 *
 * ONE DEFINITION ON PURPOSE. This expression was copy-pasted across seven sites —
 * two here, five in scripts/ — and capping some of them would have left the
 * offline analyses modelling different physics from the page. Python's copy lives
 * in scripts/_physics.py:evap_scale and must be changed with this one.
 */
export function evapScale(rh: number): number {
  return Math.min(1, 0.6 + 0.6 * (1 - rh / 100));
}

/**
 * The warming delta for one pathway key. Zero ONLY where zero is the truth.
 *
 * WHAT THIS REPLACED, AND WHY. The line was `PATH_DELTA[s.path] ?? 0`, which gave
 * the same answer — no warming — to two situations that are not the same:
 *
 *   · a country that has adopted no regional projection, where zero is CORRECT and
 *     the pathway control legitimately does nothing; and
 *   · a typo, a renamed scenario, or a URL parameter naming a pathway that does not
 *     exist, where zero is a WRONG answer silently substituted for a missing one.
 *
 * The second is the dangerous one and it is invisible: `Record<string, number>` with
 * `noUncheckedIndexedAccess` off type-checks `table[path]` as a `number`, so a
 * mistyped `ssp858` would type-check, run, and quietly model no warming under a
 * pathway label the page still prints. The two cases are separated by the SHAPE of
 * the table rather than by the value it returns: an empty table is a declared
 * absence, and a populated one is a closed set that a stranger may not enter.
 *
 * `Object.hasOwn`, not `in`: `in` finds inherited members, so `path = 'toString'`
 * would pass the check and multiply a function into the air temperature as NaN.
 */
function pathwayDelta(table: Readonly<Record<string, number>>, path: string): number {
  const scenarios = Object.keys(table);
  if (scenarios.length === 0) return 0;
  if (!Object.hasOwn(table, path)) {
    throw new Error(
      `heat-map-model: warming pathway "${path}" is not in this scope's table `
      + `(${scenarios.join(' | ')}). An unrecognised pathway is a missing answer, not a `
      + 'zero one — zero is reserved for a scope that declares no pathway at all');
  }
  return table[path];
}

/** Scenario forcing → SimParams (§2 D retune, §3.4 facade Q cut, §4 diurnal/pathway). */
export function currentParams(s: ScenarioState): SimParams {
  const L = s.live, obsTair = L ? L.tAir : s.climate.fallbackTairC, obsRh = L ? L.rh : 60;
  /* THE PATHWAY STAYS ADDITIVE ON TOP OF THE OVERRIDE. Replacing the whole
     expression would make the warming-pathway control silently dead whenever
     heatwave was on — a button that does nothing and says nothing, which is the
     fan-out the `sunNow` note exists to refuse. Composed, it reads as what it
     is: a 1-in-100 day under SSP5-8.5. Both are additive forcing shifts. */
  const baseTair = (s.heatTairC ?? obsTair) + pathwayDelta(s.climate.pathDelta, s.path);
  const wind = L ? Math.min(2.5, Math.max(0.3, L.wind / 3)) : 1, cloud = L ? L.cloud / 100 : 0;
  /* Humidity gates evaporative cooling: dry air cools harder, muggy monsoon air
     stalls it. Under a heatwave the air mass is TODAY'S, warmed — so absolute
     humidity is preserved and the relative value falls out of it. Holding the
     ratio instead would invent heatwave-day humidity, the one thing a 74-year
     record of air TEMPERATURE cannot supply, and on a muggy day it produces a
     wet-bulb past human survivability (see shiftAirPreservingVapour). */
  const rh = s.heatTairC == null ? obsRh
    : shiftAirPreservingVapour(obsTair, obsRh, s.heatTairC);
  const evap = evapScale(rh);
  const Q = DEFAULT_PARAMS.Q * (1 - FACADE_Q * (s.iv.facades / 15));
  const b: SimParams = { ...DEFAULT_PARAMS, D: SIM_D, Q, wind, L: DEFAULT_PARAMS.L * evap };

  /* ── "now": real solar geometry, live air, branch chosen by the sun ──
     Unlike the canonical phases this uses the observed air temperature AS
     OBSERVED — no −2.5 K retained-night convention — because the reading and
     the hour describe the same moment. The day/night split is SUN_LIT rather
     than a clock hour so it tracks the season: Kolkata's sunrise moves about
     40 minutes across the year and a fixed 06:00 cutoff would be wrong at both
     solstices. */
  if (s.sunNow != null) {
    const lit = s.sunNow > SUN_LIT;
    const tSky = skyTemperatureC(baseTair, rh, cloud);
    if (lit) return { ...b, sun: s.sunNow * (1 - 0.6 * cloud), tAir: baseTair, tSky };
    const dark: SimParams = { ...b, sun: 0, tAir: baseTair, Q: Q * Q_NIGHT_RATIO, tSky, store: STORE_NIGHT };
    return { ...dark, L: nightLatent(dark, rh) };
  }

  if (s.phase === 'peak') {
    return { ...b, sun: 1 * (1 - 0.6 * cloud), tAir: baseTair, tSky: skyTemperatureC(baseTair, rh, cloud) };
  }
  const tAir = baseTair - 2.5;
  const night: SimParams = { ...b, sun: 0, tAir, Q: Q * Q_NIGHT_RATIO,
    tSky: skyTemperatureC(tAir, rh, cloud), store: STORE_NIGHT };
  return { ...night, L: nightLatent(night, rh) };
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
  const evap = evapScale(ambient.rh);
  const Q = DEFAULT_PARAMS.Q * (1 - FACADE_Q * (iv.facades / 15));
  const base: SimParams = { ...DEFAULT_PARAMS, D: SIM_D, Q, wind, L: DEFAULT_PARAMS.L * evap, tAir: ambient.tAir };
  const tSky = skyTemperatureC(ambient.tAir, ambient.rh, cloud);
  if (phase === 'peak') return { ...base, sun: 1 * (1 - 0.6 * cloud), tSky };
  // store: the compare view runs the same physics as the explorer. Omitting it
  // here would make the two views disagree at night by ~1.7 K, and only one of
  // them would be right.
  const night: SimParams = { ...base, sun: 0, Q: Q * Q_NIGHT_RATIO, tSky, store: STORE_NIGHT };
  return { ...night, L: nightLatent(night, ambient.rh) };
}

/**
 * Green Score 0–100 — equal-weighted composite of three sub-scores.
 *
 * Weights were 0.40 / 0.40 / 0.20, which had no published precedent and implied
 * that greening and cooling were each exactly twice as important as cost. Equal
 * weighting is the most commonly applied approach in composite indicator practice
 * (OECD/JRC 2008, Handbook on Constructing Composite Indicators) and is the
 * convention in urban-resilience indices. An arbitrary split dressed as a derived
 * one is worse than a plain, citable one.
 *
 * The three sub-scores are returned alongside the total so the UI can show them
 * raw — transparency is what makes a BAF-style score trusted.
 */
export function greenScoreParts(greenG: number, coolingC: number, cost: number) {
  const greening = Math.min(1, greenG / GREEN_REF);
  const cooling = Math.min(1, Math.max(0, coolingC) / DT_REF);
  const efficiency = cost > 0 ? Math.min(1, (Math.max(0, coolingC) / Math.max(0.02, cost / 1e7)) / E_REF) : 0;
  const total = Math.max(0, Math.min(100, Math.round(100 * (greening + cooling + efficiency) / 3)));
  return { greening, cooling, efficiency, total };
}

export function greenScore(greenG: number, coolingC: number, cost: number): number {
  return greenScoreParts(greenG, coolingC, cost).total;
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

  /* A TEST FIXTURE, not the constants coming back. The four scope constants left
     this module (see the note near the top) and the shipped values now live in the
     scope directory's `registry.ts`; these are inputs to a self-check, written here
     rather than imported because a physics module that had to reach for an identity
     module to check itself would have the layering backwards.

     They match Kolkata's because the physical bars asserted below — a built core
     equilibrating at 40–50 °C, cool roofs cooling the mean by 0.2 K — were measured
     against that climatology. Substitute Gulf air and the bars would need re-deriving
     rather than re-labelling. What matters for the migration is not these numbers but
     that the physics READS them, which the first block of assertions proves. */
  const climate: ClimateConstants = {
    pathDelta: { '2025': 0, ssp245: 1.25, ssp585: 4.1 },
    fallbackTairC: 32,
    parkRadiusM: 50,
    /* `XTS` IS ISO 4217'S RESERVED TEST CODE, and it is here rather than the real
       code for the same reason the note above gives about the numbers: this is a
       fixture, and the self-check never formats it. Naming a real currency would
       put a country's money inside the physics module — which is precisely what
       the money tripwire in tests/unit/obos-scope.test.mjs now refuses, and it
       would have to be waved through as an exception to keep passing. An exception
       is how a tripwire stops meaning anything. */
    costs: { currency: 'XTS', roofM2: 150, tree: 1500, park: 15_000_000, facadeM2: 9500 },
  };
  const p: SimParams = currentParams({ live: null, phase: 'peak', path: '2025', climate, iv: { trees: 0, roof: 0, parks: 0, facades: 0 } });

  /* ── the scope constants are READ, never remembered ───────────────────────
     The migration's whole risk is a constant that appears to move and does not —
     a parameter added, threaded, and then shadowed by a leftover literal. These
     three assertions make that impossible to ship: the answers must FOLLOW the
     scope object, and a scope naming a pathway that does not exist must be refused
     rather than quietly warmed by zero. */
  const zeroIv = { trees: 0, roof: 0, parks: 0, facades: 0 };
  const gulf: ClimateConstants = { pathDelta: {}, fallbackTairC: 40, parkRadiusM: 50, costs: null };
  const noFeed = (c: ClimateConstants) =>
    currentParams({ live: null, phase: 'peak', path: '2025', climate: c, iv: zeroIv }).tAir;
  a(noFeed(climate) === 32 && noFeed(gulf) === 40,
    `the fallback air temperature must come from the scope (got ${noFeed(climate)}, ${noFeed(gulf)})`);
  /* An empty table is a DECLARED absence: no adopted projection, so no warming,
     whatever the control says. It must not throw — Dubai has to be reachable. */
  a(currentParams({ live: null, phase: 'peak', path: 'ssp585', climate: gulf, iv: zeroIv }).tAir === 40,
    'a scope with no pathway must contribute zero warming, not throw');
  let refused = false;
  try { currentParams({ live: null, phase: 'peak', path: 'ssp858', climate, iv: zeroIv }); }
  catch { refused = true; }
  a(refused, 'an unknown pathway against a POPULATED table must throw, not warm by zero');

  /* ── heatwave: a FORCING OVERRIDE, and only that ─────────────────────────
     The risk this pins down is scope creep in a substitution. The override must
     move air temperature (and the humidity that travels with it) and leave every
     other term of the forcing exactly where the plain peak scenario put it. */
  const iv0 = { trees: 0, roof: 0, parks: 0, facades: 0 };
  const live = { tAir: 30, rh: 96, wind: 3, cloud: 20, feels: 40 } as Ambient;
  const P99 = 38.4;
  const plain = currentParams({ live, phase: 'peak', path: '2025', climate, iv: iv0 });
  const heat = currentParams({ live, phase: 'peak', path: '2025', climate, iv: iv0, heatTairC: P99 });
  a(Math.abs(heat.tAir - P99) < 1e-9, `heatwave tAir ${heat.tAir}, expected ${P99}`);
  a(heat.sun === plain.sun && heat.wind === plain.wind && heat.Q === plain.Q,
    'heatwave changed sun, wind or Q — it may only change the air');
  a(heat.store === plain.store, 'heatwave changed the storage term');
  // hotter air holds more, so the same water is a LOWER relative humidity, and the
  // drier air evaporates harder — L must rise, never fall.
  a(heat.L > plain.L, 'heatwave should dry the air and raise the latent term');
  // the pathway composes on top rather than being replaced by the override
  const hot585 = currentParams({ live, phase: 'peak', path: 'ssp585', climate, iv: iv0, heatTairC: P99 });
  a(Math.abs(hot585.tAir - (P99 + climate.pathDelta.ssp585)) < 1e-9,
    `heatwave + ssp585 = ${hot585.tAir}, expected ${P99 + climate.pathDelta.ssp585} — the pathway was swallowed`);
  // absent, it must be exactly the old behaviour
  a(currentParams({ live, phase: 'peak', path: '2025', climate, iv: iv0, heatTairC: null }).tAir === plain.tAir,
    'a null override changed the forcing');

  const base0 = eqMean(base, p);
  const roofed = eqMean(applyInterventions(base, { trees: 0, roof: 100, parks: 0, facades: 0 }, sp, climate.parkRadiusM), p);
  const treed = eqMean(applyInterventions(base, { trees: 50, roof: 0, parks: 0, facades: 0 }, sp, climate.parkRadiusM), p);
  a(roofed < base0 - 0.2, `cool roofs cool the mean (${base0.toFixed(1)}→${roofed.toFixed(1)})`);
  a(treed < base0 - 0.05, `trees cool the mean (${base0.toFixed(1)}→${treed.toFixed(1)})`);

  // a fully-built cell equilibrates hot (orange/red band) at default ambient
  const hotCell = eqCell(p, 0.2, 0, 1);
  a(hotCell > 40 && hotCell < 50, `built-core equilibrium plausible (got ${hotCell.toFixed(1)}°C)`);

  // costs monotonic + non-zero
  const costs = climate.costs;
  if (costs === null) throw new Error('heat-map-model: the self-check fixture must declare costs');
  const c1 = computeCost({ trees: 10, roof: 20, parks: 1, facades: 2 }, sp, costs);
  const c2 = computeCost({ trees: 20, roof: 40, parks: 2, facades: 4 }, sp, costs);
  a(c1 > 0 && c2 > c1, 'cost increases with intervention');
  /* Doubling one unit price must double that lever's share of the total, which no
     leftover module-level COST could do. */
  const dearRoofs = computeCost({ trees: 0, roof: 20, parks: 0, facades: 0 }, sp, { ...costs, roofM2: costs.roofM2 * 2 });
  a(Math.abs(dearRoofs - 2 * computeCost({ trees: 0, roof: 20, parks: 0, facades: 0 }, sp, costs)) < 1e-6,
    'the roof unit price must come from the `costs` argument');

  // score bounded, rises with cooling
  a(greenScore(0.3, 0, 0) >= 0 && greenScore(0.3, 2, 1e7) <= 100, 'score bounded 0–100');
  a(greenScore(0.4, 2, 5e7) > greenScore(0.4, 0.5, 5e7), 'score rewards cooling');

  // REGRESSION: the night ET taper must stay continuous in humidity. A hard
  // dewpoint cutoff put a 0.39 K step on park cells at RH ~86 %, right inside
  // the band Kolkata monsoon nights occupy, so the live feed jerked the map.
  const zero = { trees: 0, roof: 0, parks: 0, facades: 0 };
  let prev = NaN, worst = 0;
  for (let rh = 40; rh <= 99; rh += 0.5) {
    const np = currentParamsForReference({ tAir: 28, rh, wind: 3, cloud: 0, feels: 30 }, 'night', zero);
    const park = eqCell(np, 0.20, 0.75, 0.05);
    if (!Number.isNaN(prev)) worst = Math.max(worst, Math.abs(park - prev));
    prev = park;
  }
  a(worst < 0.1, `night ET must vary smoothly with humidity (worst step ${worst.toFixed(3)} K per 0.5 % RH)`);

  // ...and must still shut off entirely once the surface is condensing.
  //
  // THE CASE CHANGED WHEN THE STORAGE TERM LANDED, and the change is correct.
  // This used to test tAir 28 / rh 97. Under the old constants the surface was
  // dragged BELOW air by strong sky coupling, so it fell under the dewpoint and
  // ET shut off. It no longer does: the nocturnal storage release holds the
  // surface at 29.1 °C against a 27.5 °C dewpoint. That is not a regression —
  // 28 °C at 97 % RH is muggy monsoon air, and Kolkata's monsoon nights are not
  // dewy. Asserting condensation there was asserting something false that the
  // old constants happened to satisfy.
  //
  // Dew forms on a radiative-cooling winter night: cold, near-saturated, calm.
  // The taper still fires there, which is what this now checks. Verified across
  // the range: it shuts off at tAir <= 12 with rh >= 98, and tapers smoothly
  // above it rather than switching.
  const frost = currentParamsForReference({ tAir: 10, rh: 100, wind: 1, cloud: 0, feels: 10 }, 'night', zero);
  a(frost.L === 0, 'ET must reach zero once the surface is below the dewpoint');
  // and it must NOT shut off in warm humid air, where no dew forms
  const muggy = currentParamsForReference({ tAir: 28, rh: 97, wind: 3, cloud: 0, feels: 30 }, 'night', zero);
  a(muggy.L > 0, 'ET must keep running in warm humid air — a warm surface does not condense');
}
