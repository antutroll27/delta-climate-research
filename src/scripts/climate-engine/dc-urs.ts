/**
 * Delta Climate Urban Resilience Score (DC-URS) — the engine.
 *
 * Pure: no DOM, no GL, no I/O. Self-checked via `assertDcUrsLogic()`.
 *
 * Contract:
 *   docs/dc-urs-source-of-truth.md   the CEO-approved engine definition
 *   docs/dc-urs-engineering-review.md  eight approved corrections, applied here
 *   docs/dc-urs-spec.md §2           how those corrections are implemented
 *
 * This module composes INDICATORS. `heat-map-model.ts` computes PHYSICS. They are
 * deliberately separate — mixing the two is what made the Green Score hard to
 * audit.
 */
// .ts extension keeps this runnable under `node --experimental-strip-types`
import type { DcUrsInputs } from './dc-urs-inputs.ts';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/* ── Normalisation anchors ────────────────────────────────────────────────────
 * Fixed ABSOLUTE anchors, not min-max (review delta 6). Min-max is disqualifying
 * for a product: with three wards the best always scores 1.0 and the worst 0.0,
 * and adding a fourth silently rescores every existing ward. Fixed anchors are
 * stable across time, wards and cities.
 *
 * Values are CEO-specified and researched (dc-urs-spec.md §4). Recorded as named
 * constants so a disputed score traces to a constant and its owner.
 * ────────────────────────────────────────────────────────────────────────────*/
export const ANCHORS = {
  /** °C. Denominator widened 20 → 25 per review delta 7: at /20 the term
   *  saturated at 45 °C, leaving the index blind in exactly the wards a heat
   *  action plan exists for. 25 puts the ceiling at 50 °C. */
  lstDayBase: 25, lstDaySpan: 25,
  lstNightBase: 20, lstNightSpan: 15,
  uhiSpan: 10,
  popDensityMax: 25_000,
  farMax: 5.0,
  socioVulnMax: 10,
  /** LBNL aged cool-roof albedo — the same value the thermal model uses. */
  albedoRef: 0.60,
  /** TRA decay, per metre. ≈347 m half-distance. */
  traLambda: 0.002,
} as const;

/** Below this mean NDVI there is no vegetation whose stability could be measured. */
export const VSI_NDVI_FLOOR = 0.10;

/** Pillar weights. Top level from the source document; within-pillar weights
 *  taken from its §5 CODE, which is normative where its §4 table disagrees
 *  (review delta 5). */
export const W = {
  aci: 0.40, evi: 0.35, thi: 0.25,
  thiDay: 0.40, thiNight: 0.40, thiUhi: 0.20,
  eviPop: 0.45, eviFar: 0.30, eviSocio: 0.25,
  aciUgs: 0.50, aciCri: 0.30, aciTra: 0.20,
  /** UGS: FVC replaces raw NDVI (delta 2 — FVC is an affine transform of NDVI,
   *  so counting both spent 80 % of the greenness weight on one variable).
   *  CanopyFrac is structurally independent of NDVI. */
  ugsFvc: 0.50, ugsCanopy: 0.30, ugsVsi: 0.20,
} as const;

/**
 * Vegetation Stability Index — multi-year persistence.
 *
 * GUARDED (review delta 3). Unguarded, `1 − σ/mean` on water's negative mean
 * NDVI makes the ratio negative, `clamp(…,0,1)` floors it at zero, and VSI
 * returns **1.00 — perfect vegetation stability for a river**. The Hooghly runs
 * through the study area, so this fires immediately.
 */
export function vsi(ndviMean: number, ndviStd: number): number {
  if (!(ndviMean > VSI_NDVI_FLOOR)) return 0;   // also catches NaN
  return 1 - clamp(ndviStd / ndviMean, 0, 1);
}

export interface Pillars {
  readonly aci: number; readonly evi: number; readonly thi: number;
  readonly ugs: number;
}

/** The three pillars plus the greenness sub-score, each in [0,1]. */
export function pillars(i: DcUrsInputs): Pillars {
  const A = ANCHORS;

  const thi =
      W.thiDay   * clamp((i.lstDayC.value   - A.lstDayBase)   / A.lstDaySpan,   0, 1)
    + W.thiNight * clamp((i.lstNightC.value - A.lstNightBase) / A.lstNightSpan, 0, 1)
    + W.thiUhi   * clamp(Math.max(0, i.lstDayC.value - i.ruralBaseC.value) / A.uhiSpan, 0, 1);

  const evi =
      W.eviPop   * clamp(i.popDensity.value / A.popDensityMax, 0, 1)
    + W.eviFar   * clamp(i.far.value        / A.farMax,        0, 1)
    + W.eviSocio * clamp(i.socioVuln.value  / A.socioVulnMax,  0, 1);

  const ugs =
      W.ugsFvc    * clamp(i.fvc.value,        0, 1)
    + W.ugsCanopy * clamp(i.canopyFrac.value, 0, 1)
    + W.ugsVsi    * vsi(i.ndviMean.value, i.ndviStd.value);

  const aci =
      W.aciUgs * ugs
    + W.aciCri * clamp(i.albedo.value / A.albedoRef, 0, 1)
    + W.aciTra * Math.exp(-A.traLambda * Math.max(0, i.distCoolM.value));

  return { aci, evi, thi, ugs };
}

/**
 * DC-URS, 0–100. Higher is more resilient.
 *
 * GEOMETRIC, not additive (review delta 1). IPCC AR6 risk is conjunctive: a
 * near-zero pillar must drag the score down rather than be bought off by a
 * strong one. Under the original weighted sum a ward at THI 0.85 / ACI 0.90
 * scored 8.3 points BETTER than one at THI 0.30 / ACI 0.35 — greenery buying
 * its way out of lethal heat.
 */
export function aggregate(aci: number, evi: number, thi: number): number {
  // floor at 0.001 so a single zero pillar cannot annihilate the score and
  // 0 ** 0.4 is never evaluated
  const g = (x: number) => clamp(x, 0.001, 1);
  return 100 * g(aci) ** W.aci * g(1 - evi) ** W.evi * g(1 - thi) ** W.thi;
}

export function dcUrs(i: DcUrsInputs): number {
  const { aci, evi, thi } = pillars(i);
  return aggregate(aci, evi, thi);
}

/* ── Tiers ──────────────────────────────────────────────────────────────────*/

export type TierId = 'optimal' | 'moderate' | 'vulnerable' | 'critical';

export interface Tier {
  readonly id: TierId; readonly label: string;
  readonly colour: string; readonly guidance: string;
}

/** Bands, labels and colours exactly as the source document §6 specifies. */
export const TIERS: readonly (Tier & { readonly min: number })[] = [
  { min: 80, id: 'optimal', label: 'Optimal Resilience', colour: '#22c55e',
    guidance: 'Maintain canopy cover and protect ecosystem services.' },
  { min: 60, id: 'moderate', label: 'Moderate Resilience', colour: '#eab308',
    guidance: 'Expand cool roofs and targeted tree corridors.' },
  { min: 40, id: 'vulnerable', label: 'Vulnerable', colour: '#f97316',
    guidance: 'Urgent intervention required: pocket parks & high-albedo coatings.' },
  { min: 0, id: 'critical', label: 'Critical Hotspot', colour: '#ef4444',
    guidance: 'Extreme emergency risk: deploy urban greening and cooling centres.' },
] as const;

export function tierFor(score: number): Tier {
  return TIERS.find(t => score >= t.min) ?? TIERS[TIERS.length - 1];
}

/* ── Structural floor ───────────────────────────────────────────────────────*/

export interface StructuralFloor {
  /** best score reachable with a physically perfect retrofit */
  readonly ceiling: number;
  /** points no intervention can recover */
  readonly withheld: number;
  readonly current: number;
  /** points still winnable from where the ward is today */
  readonly headroom: number;
}

/**
 * What no intervention can fix.
 *
 * EVI carries 0.35 of the weight and nothing the user does touches population
 * density, floor-area ratio or social vulnerability. This is the tool's sharpest
 * output rather than a limitation — it separates what greening can achieve from
 * what only housing and health policy can:
 *
 *   "28 of this ward's missing points are demographic exposure. Trees cannot fix
 *    them — that needs housing, health outreach and cooling-centre policy."
 *
 * A named export, not an incidental number (dc-urs-spec.md §5).
 */
export function structuralFloor(i: DcUrsInputs): StructuralFloor {
  const perfect: DcUrsInputs = {
    ...i,
    fvc:        { ...i.fvc,        value: 1 },
    canopyFrac: { ...i.canopyFrac, value: 1 },
    ndviMean:   { ...i.ndviMean,   value: 0.85 },
    ndviStd:    { ...i.ndviStd,    value: 0.03 },
    albedo:     { ...i.albedo,     value: ANCHORS.albedoRef },
    distCoolM:  { ...i.distCoolM,  value: 0 },
    // heat cannot fall below the rural reference: no intervention makes a city
    // cooler than the countryside around it
    lstDayC:    { ...i.lstDayC,    value: i.ruralBaseC.value },
    lstNightC:  { ...i.lstNightC,  value: ANCHORS.lstNightBase },
  };
  const ceiling = dcUrs(perfect);
  const current = dcUrs(i);
  return { ceiling, withheld: 100 - ceiling, current, headroom: ceiling - current };
}

/* ── Self-check ─────────────────────────────────────────────────────────────*/

const m = (v: number) => ({ value: v, source: 'measured' as const });

/** Build inputs tersely, for tests and fixtures. */
export function inputsOf(o: {
  lstDayC: number; lstNightC: number; ruralBaseC: number;
  popDensity: number; far: number; socioVuln: number;
  fvc: number; canopyFrac: number; ndviMean: number; ndviStd: number;
  albedo: number; distCoolM: number;
}): DcUrsInputs {
  return {
    lstDayC: m(o.lstDayC), lstNightC: m(o.lstNightC), ruralBaseC: m(o.ruralBaseC),
    popDensity: m(o.popDensity), far: m(o.far), socioVuln: m(o.socioVuln),
    fvc: m(o.fvc), canopyFrac: m(o.canopyFrac),
    ndviMean: m(o.ndviMean), ndviStd: m(o.ndviStd),
    albedo: m(o.albedo), distCoolM: m(o.distCoolM),
  };
}

/**
 * Frozen golden cases (dc-urs-spec.md §7).
 *
 * Ballygunge and Baruipur only — their inputs come from the CEO's own worked
 * examples in the source document. Barrackpore is IN SCOPE everywhere else but
 * is held out of this fixture until Phase 1 supplies measured inputs: freezing
 * estimated values would test every future change against a fiction.
 */
export const GOLDEN = [
  {
    id: 'ballygunge',
    expected: 21.13,
    inputs: inputsOf({
      lstDayC: 42.5, lstNightC: 31.0, ruralBaseC: 32.0,
      popDensity: 22_000, far: 3.8, socioVuln: 7.2,
      fvc: 0.12, canopyFrac: 0.10, ndviMean: 0.18, ndviStd: 0.08,
      albedo: 0.15, distCoolM: 800,
    }),
  },
  {
    id: 'baruipur',
    expected: 64.16,
    inputs: inputsOf({
      lstDayC: 34.1, lstNightC: 24.5, ruralBaseC: 32.0,
      popDensity: 4_500, far: 0.8, socioVuln: 4.1,
      fvc: 0.54, canopyFrac: 0.42, ndviMean: 0.58, ndviStd: 0.04,
      albedo: 0.22, distCoolM: 250,
    }),
  },
] as const;

/** Runnable self-check. node --experimental-strip-types -e
 *  "import('./dc-urs.ts').then(m=>m.assertDcUrsLogic())" */
export function assertDcUrsLogic(): void {
  const a = (ok: boolean, msg: string) => { if (!ok) throw new Error(`dc-urs: ${msg}`); };

  // VSI guard — the bug that gave a river perfect vegetation stability
  a(vsi(-0.30, 0.05) === 0, 'water must score 0 stability, not 1');
  a(vsi(0.05, 0.06) === 0, 'bare ground must score 0 stability');
  a(vsi(0.75, 0.04) > 0.9, `mature canopy should be stable, got ${vsi(0.75, 0.04).toFixed(2)}`);
  a(vsi(NaN, 0.04) === 0, 'NaN NDVI must not propagate');

  // golden cases reproduce
  for (const g of GOLDEN) {
    const s = dcUrs(g.inputs);
    a(s >= 0 && s <= 100, `${g.id}: ${s} out of range`);
    a(Math.abs(s - g.expected) < 0.05,
      `${g.id}: ${s.toFixed(2)} vs frozen ${g.expected}`);
  }

  // tiers agree with the frozen scores
  a(tierFor(dcUrs(GOLDEN[0].inputs)).id === 'critical', 'Ballygunge should be Critical Hotspot');
  a(tierFor(dcUrs(GOLDEN[1].inputs)).id === 'moderate', 'Baruipur should be Moderate Resilience');
  a(tierFor(100).id === 'optimal' && tierFor(0).id === 'critical', 'tier bounds');

  // ── What geometric aggregation actually guarantees ───────────────────────
  // NOTE, because this is easy to get wrong and one of these assertions was
  // wrong on first writing: geometric aggregation removes FULL compensation,
  // not ALL compensation. It is still a weighted product, and w_aci (0.40)
  // exceeds w_thi (0.25) — so a large enough adaptive-capacity advantage CAN
  // still outweigh a large hazard disadvantage. That is the CEO's weighting
  // choice, not a defect. What it guarantees is the two properties below.

  // 1. On the case the review was written against — matched pillar magnitudes —
  //    the additive form ranked the dangerously hot ward 8.3 points ABOVE the
  //    cool one. Geometric must not.
  const addv = (aci: number, evi: number, thi: number) =>
    100 * (W.aci * aci + W.evi * (1 - evi) + W.thi * (1 - thi));
  const HOT = { aci: 0.90, evi: 0.50, thi: 0.85 };
  const COOL = { aci: 0.35, evi: 0.50, thi: 0.30 };
  a(addv(HOT.aci, HOT.evi, HOT.thi) > addv(COOL.aci, COOL.evi, COOL.thi),
    'sanity: the additive form should exhibit the bug we are fixing');
  a(aggregate(HOT.aci, HOT.evi, HOT.thi) <= aggregate(COOL.aci, COOL.evi, COOL.thi),
    `geometric must not rank the hot ward above the cool one ` +
    `(${aggregate(HOT.aci, HOT.evi, HOT.thi).toFixed(1)} vs ${aggregate(COOL.aci, COOL.evi, COOL.thi).toFixed(1)})`);

  // 2. A pillar approaching its extreme dominates, however good the others are.
  //    This is the property full compensation would destroy.
  a(aggregate(0.90, 0.46, 0.999) < 20,
    `lethal hazard must crush the score even with excellent capacity, got ${aggregate(0.90, 0.46, 0.999).toFixed(1)}`);
  a(aggregate(0.001, 0.46, 0.10) < 20,
    'zero adaptive capacity must crush the score even in a cool ward');
  a(aggregate(0.90, 0.46, 0.99) < aggregate(0.90, 0.46, 0.85),
    'score must fall monotonically as hazard rises');

  // monotone in each pillar
  const base = GOLDEN[0].inputs;
  a(dcUrs({ ...base, fvc: { ...base.fvc, value: 0.9 } }) > dcUrs(base), 'more vegetation must raise the score');
  a(dcUrs({ ...base, lstDayC: { ...base.lstDayC, value: 48 } }) <= dcUrs(base), 'more heat must not raise the score');
  a(dcUrs({ ...base, popDensity: { ...base.popDensity, value: 25_000 } }) < dcUrs(base), 'more exposure must lower the score');

  // structural floor
  const f = structuralFloor(GOLDEN[0].inputs);
  a(f.ceiling < 100, `a perfect retrofit cannot reach 100, got ${f.ceiling.toFixed(1)}`);
  a(f.ceiling > f.current, 'ceiling must exceed current');
  a(Math.abs(f.withheld + f.ceiling - 100) < 1e-9, 'withheld + ceiling must be 100');
  a(Math.abs((f.current + f.headroom) - f.ceiling) < 1e-9, 'current + headroom must be ceiling');

  // a zero pillar must not produce NaN or a negative score
  const dead = inputsOf({
    lstDayC: 60, lstNightC: 45, ruralBaseC: 20, popDensity: 99_999, far: 20, socioVuln: 10,
    fvc: 0, canopyFrac: 0, ndviMean: 0, ndviStd: 0, albedo: 0, distCoolM: 99_999,
  });
  const d = dcUrs(dead);
  a(Number.isFinite(d) && d >= 0 && d <= 100, `degenerate ward gave ${d}`);
}
