/**
 * Delta Climate Urban Resilience Score (DC-URS) — the engine.
 *
 * Pure: no DOM, no GL, no I/O. Self-checked via `assertDcUrsLogic()`.
 *
 * Contract: **docs/dc-urs-source-of-truth.md is the final source of truth for v1.**
 * The engine ships the CEO's formulation as written, plus exactly THREE fixes,
 * each one a case where that document contradicts itself or the maths misbehaves:
 *
 *   1. VSI guarded          unguarded it returns 1.00 for water — a river scoring
 *                           as perfect vegetation stability
 *   2. §5 code over §4 table where the two disagree on pillar weights; the code is
 *                           what produced the document's published 20.01 / 65.23
 *   3. fixed anchors        §3 specifies min-max, §5 uses fixed divisors; min-max
 *                           would rescore every ward when a fourth is added
 *
 * The other five review findings — geometric aggregation, dropping the redundant
 * FVC term, canopy fraction, the /25 daytime anchor, Czekajlo attribution — are
 * DEFERRED TO v2 by decision, and each is marked "KNOWN LIMITATION for v2" at the
 * point in the code where it bites.
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
  /** °C. v1 ships the CEO's /20 as written. KNOWN LIMITATION for v2: the term
   *  saturates at 45 °C, so the index cannot discriminate above that — precisely
   *  the wards a heat action plan exists for. Review delta 7 proposed /25. */
  lstDayBase: 25, lstDaySpan: 20,
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
  /** UGS as the source document specifies: NDVI, FVC, VSI at 0.40/0.40/0.20.
   *  KNOWN LIMITATION for v2: FVC is an affine transform of NDVI by the source
   *  document's own §3 definition, so 0.80 of the greenness weight rests on one
   *  variable counted twice. Review delta 2 proposed replacing FVC with an
   *  independent structural input (tree-canopy fraction). Deferred to v2. */
  ugsNdvi: 0.40, ugsFvc: 0.40, ugsVsi: 0.20,
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
      W.ugsNdvi * clamp(i.ndviMean.value, 0, 1)
    + W.ugsFvc  * clamp(i.fvc.value,      0, 1)
    + W.ugsVsi  * vsi(i.ndviMean.value, i.ndviStd.value);

  const aci =
      W.aciUgs * ugs
    + W.aciCri * clamp(i.albedo.value / A.albedoRef, 0, 1)
    + W.aciTra * Math.exp(-A.traLambda * Math.max(0, i.distCoolM.value));

  return { aci, evi, thi, ugs };
}

/**
 * DC-URS, 0–100. Higher is more resilient.
 *
 * v1 ships the source document's WEIGHTED SUM as written.
 *
 * KNOWN LIMITATION for v2. IPCC AR6 risk is conjunctive — a near-zero pillar
 * should drag the score down rather than be bought off by a strong one — and a
 * weighted sum permits full compensation. Measured: a ward at THI 0.85 /
 * ACI 0.90 scores 8.3 points BETTER than one at THI 0.30 / ACI 0.35, so
 * greenery buys its way out of lethal heat. Review delta 1 proposed
 * `100 × ACI^0.40 × (1−EVI)^0.35 × (1−THI)^0.25`, which flips that ordering and
 * moves the CEO's own worked wards by only ~1 point. Deferred to v2 by decision.
 */
export function aggregate(aci: number, evi: number, thi: number): number {
  return 100 * (W.aci * aci + W.evi * (1 - evi) + W.thi * (1 - thi));
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

/* ── What the score does not know ───────────────────────────────────────────*/

/**
 * Each indicator's share of the final 0–100 score.
 *
 * DERIVED from `W`, never re-typed from the spec, so this cannot drift from the
 * formula. `assertDcUrsLogic()` re-measures the socio entry against the engine
 * by finite difference rather than trusting the arithmetic here.
 *
 * The shares sum above 1 on purpose: `lstDayC` and `ruralBaseC` both feed the
 * UHI term. This answers "how much of the score moves if THIS field is wrong",
 * which is the question a disclosure needs, and two fields feeding one term
 * legitimately overlap.
 *
 * `canopyFrac` is 0 and that zero is LOAD-BEARING: it is collected for v2 and
 * inert in v1, so it must never raise a disclosure about a score it cannot move.
 */
export const SCORE_WEIGHT: Record<keyof DcUrsInputs, number> = {
  lstDayC:    W.thi * (W.thiDay + W.thiUhi),
  lstNightC:  W.thi * W.thiNight,
  ruralBaseC: W.thi * W.thiUhi,
  popDensity: W.evi * W.eviPop,
  far:        W.evi * W.eviFar,
  socioVuln:  W.evi * W.eviSocio,
  fvc:        W.aci * W.aciUgs * W.ugsFvc,
  ndviMean:   W.aci * W.aciUgs * (W.ugsNdvi + W.ugsVsi),
  ndviStd:    W.aci * W.aciUgs * W.ugsVsi,
  albedo:     W.aci * W.aciCri,
  distCoolM:  W.aci * W.aciTra,
  canopyFrac: 0,
} as const;

export interface Unmeasured {
  /** not yet observed AND able to move the score */
  readonly fields: readonly (keyof DcUrsInputs)[];
  /** points of the 0–100 score resting on them, over each indicator's full range */
  readonly points: number;
}

/**
 * What the score is standing in for, and what that is worth in points.
 *
 * While this returns anything, the number on screen is a BOUND rather than a
 * claim. `socioVuln` measures vulnerability, so its unmeasured zero is the most
 * flattering value in its range: the displayed score is the maximum the ward
 * could achieve, never wrong, only loose — and `points` says how loose.
 *
 * That distinction is what keeps a placeholder out of production. An unlabelled
 * zero is an estimate nobody made; a labelled endpoint of a declared range is a
 * fact about the scale.
 *
 * It stops on its own. `build-dcurs-inputs.py` writes `measured` the day
 * `socio.json` lands, `points` falls to zero, and the disclosure disappears —
 * there is no string for anyone to forget to delete.
 *
 * `weakestProvenance()` is deliberately NOT used here: it would report
 * `placeholder` forever, on `canopyFrac` alone, long after socio arrives.
 */
export function unmeasured(i: DcUrsInputs): Unmeasured {
  const fields = (Object.keys(SCORE_WEIGHT) as (keyof DcUrsInputs)[])
    .filter(k => i[k].source === 'placeholder' && SCORE_WEIGHT[k] > 0);
  return { fields, points: 100 * fields.reduce((s, k) => s + SCORE_WEIGHT[k], 0) };
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
    expected: 20.01,
    inputs: inputsOf({
      lstDayC: 42.5, lstNightC: 31.0, ruralBaseC: 32.0,
      popDensity: 22_000, far: 3.8, socioVuln: 7.2,
      fvc: 0.12, canopyFrac: 0.10, ndviMean: 0.18, ndviStd: 0.08,
      albedo: 0.15, distCoolM: 800,
    }),
  },
  {
    id: 'baruipur',
    expected: 65.23,
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

  // ── v1 KNOWN LIMITATION, asserted so it stays visible ────────────────────
  // The source document's weighted sum permits FULL compensation: a strong
  // pillar can buy off a lethal one. This is pinned as a test rather than left
  // implicit, so that (a) nobody mistakes it for an accident, and (b) the day
  // v2 adopts geometric aggregation, this assertion fails loudly and forces the
  // limitation note to be removed with it.
  const HOT = { aci: 0.90, evi: 0.50, thi: 0.85 };   // dangerous heat, lush
  const COOL = { aci: 0.35, evi: 0.50, thi: 0.30 };  // cool, bare
  const hotS = aggregate(HOT.aci, HOT.evi, HOT.thi);
  const coolS = aggregate(COOL.aci, COOL.evi, COOL.thi);
  a(hotS > coolS,
    `v1 additive aggregation is EXPECTED to rank the hot ward above the cool one ` +
    `(${hotS.toFixed(1)} vs ${coolS.toFixed(1)}). If this now fails, aggregation has ` +
    `changed — adopt the v2 note in dcUrs() and delete this assertion.`);

  // monotone in hazard, which the weighted sum does guarantee
  a(aggregate(0.90, 0.46, 0.99) < aggregate(0.90, 0.46, 0.85),
    'score must fall as hazard rises');
  a(aggregate(0.90, 0.46, 0.5) > aggregate(0.30, 0.46, 0.5),
    'score must rise with adaptive capacity');

  // monotone in each pillar
  const base = GOLDEN[0].inputs;
  a(dcUrs({ ...base, fvc: { ...base.fvc, value: 0.9 } }) > dcUrs(base), 'more vegetation must raise the score');
  a(dcUrs({ ...base, lstDayC: { ...base.lstDayC, value: 48 } }) <= dcUrs(base), 'more heat must not raise the score');
  a(dcUrs({ ...base, popDensity: { ...base.popDensity, value: 25_000 } }) < dcUrs(base), 'more exposure must lower the score');

  // canopyFrac is collected but NOT used by the v1 greenness formula (it is the
  // v2 replacement for the redundant FVC term). Assert it is genuinely inert, so
  // that wiring it in cannot happen silently.
  const withCanopy = { ...base, canopyFrac: { ...base.canopyFrac, value: 1 } };
  a(dcUrs(withCanopy) === dcUrs(base), 'canopyFrac must not affect the v1 score');

  // structural floor
  const f = structuralFloor(GOLDEN[0].inputs);
  a(f.ceiling < 100, `a perfect retrofit cannot reach 100, got ${f.ceiling.toFixed(1)}`);
  a(f.ceiling > f.current, 'ceiling must exceed current');
  a(Math.abs(f.withheld + f.ceiling - 100) < 1e-9, 'withheld + ceiling must be 100');
  a(Math.abs((f.current + f.headroom) - f.ceiling) < 1e-9, 'current + headroom must be ceiling');

  // ── the disclosure ───────────────────────────────────────────────────────
  // Its magnitude must be MEASURED off the engine, not asserted by a table
  // someone edits. Finite-difference socioVuln end to end.
  const svLo = dcUrs({ ...base, socioVuln: { ...base.socioVuln, value: 0 } });
  const svHi = dcUrs({ ...base, socioVuln: { ...base.socioVuln, value: ANCHORS.socioVulnMax } });
  a(Math.abs((svLo - svHi) - 100 * SCORE_WEIGHT.socioVuln) < 1e-9,
    `SCORE_WEIGHT.socioVuln claims ${(100 * SCORE_WEIGHT.socioVuln).toFixed(2)} pts but the ` +
    `engine moves ${(svLo - svHi).toFixed(2)} — the disclosure would understate itself`);

  // The copy says "best case". That holds only because zero is the FLATTERING
  // end of this indicator, which is true only because it measures vulnerability.
  a(svLo > svHi, 'zero vulnerability must be the optimistic end — the "best case" wording rests on it');

  // An inert field must never raise a disclosure about a score it cannot move.
  a(SCORE_WEIGHT.canopyFrac === 0, 'canopyFrac carries no weight and must not be reported as a gap');

  // and the accounting itself
  const gapNone = unmeasured(GOLDEN[0].inputs);
  a(gapNone.points === 0, 'fully measured inputs must report no gap');
  const gapSocio = unmeasured({ ...base, socioVuln: { ...base.socioVuln, source: 'placeholder' } });
  a(gapSocio.fields.length === 1 && gapSocio.fields[0] === 'socioVuln',
    'an unmeasured socioVuln must be reported, alone');
  const gapCanopy = unmeasured({ ...base, canopyFrac: { ...base.canopyFrac, source: 'placeholder' } });
  a(gapCanopy.points === 0, 'an unmeasured but inert field must not be reported');

  // a zero pillar must not produce NaN or a negative score
  const dead = inputsOf({
    lstDayC: 60, lstNightC: 45, ruralBaseC: 20, popDensity: 99_999, far: 20, socioVuln: 10,
    fvc: 0, canopyFrac: 0, ndviMean: 0, ndviStd: 0, albedo: 0, distCoolM: 99_999,
  });
  const d = dcUrs(dead);
  a(Number.isFinite(d) && d >= 0 && d <= 100, `degenerate ward gave ${d}`);
}
