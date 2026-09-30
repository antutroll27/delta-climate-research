/**
 * THE PAYBACK ARITHMETIC (spec 2026-09-30-solar-roi §3.2). Pure: no DOM, no
 * formatting, no currency. Two scenarios bound every answer. SLOW takes the low
 * yield and the high price; FAST takes the high yield and the low price. The sheet
 * prints fast–slow, so the range is the published ranges carried through the
 * arithmetic, not a confidence the laboratory never measured.
 */
import type { SolarCostBasis } from './solar-cost.ts';
import type { PvFile } from './types';
import { pvRanges } from './solar-ranges.ts';

export type Owner = 'home' | 'society' | 'business';

/** Below this the sheet does not open: panels, inverter and paperwork do not scale down. */
export const MIN_SYSTEM_KW = 1;

export interface RoiInput {
  readonly sizeKw: number;
  /** year-1 generation per kW installed, net of shading, [low, high] in either order */
  readonly kwhPerKw: readonly [number, number];
  readonly owner: Owner;
  /** installed cost per kW before subsidy, [low, high] in either order */
  readonly costPerKw: readonly [number, number];
  /** per kWh */
  readonly tariff: number;
  /** average monthly consumption; null = every kWh valued at the tariff */
  readonly unitsPerMonth: number | null;
  readonly basis: SolarCostBasis;
}

export interface RoiYear {
  readonly year: number;
  readonly kwh: number;
  readonly value: number;
  readonly upkeep: number;
  readonly inverter: number;
  readonly cumulative: number;
}

export interface ScenarioResult {
  readonly upfront: number;
  readonly subsidy: number;
  /** first year from which the cumulative net stays non-negative to the horizon; null = never */
  readonly paybackYear: number | null;
  /** cumulative net at the horizon, upfront included */
  readonly net: number;
  readonly years: readonly RoiYear[];
}

/** status 'ok' means the FAST (optimistic) scenario pays back; SLOW may still be null, and the copy then prints 'N years to more than <horizon>'. */
export type RoiResult =
  | { readonly status: 'too_small'; readonly slow: null; readonly fast: null }
  | { readonly status: 'ok' | 'no_payback'; readonly slow: ScenarioResult; readonly fast: ScenarioResult };

export function subsidyFor(owner: Owner, sizeKw: number, basis: SolarCostBasis): number {
  if (owner === 'home') {
    const s = basis.subsidy.home.value;
    return Math.min(s.cap, Math.min(sizeKw, 2) * s.perKwFirst2 + Math.max(0, Math.min(sizeKw, 3) - 2) * s.perKwThird);
  }
  if (owner === 'society') {
    const s = basis.subsidy.society.value;
    return Math.min(sizeKw, s.capKw) * s.perKw;
  }
  return 0;
}

/** Output relative to new: year 1 loses `firstYear`, each later year `perYear` more. */
export function degradationFactor(year: number, basis: SolarCostBasis): number {
  const d = basis.degradation.value;
  return (1 - d.firstYear) * (1 - d.perYear) ** (year - 1);
}

function runScenario(inp: RoiInput, kwhPerKw: number, costPerKw: number): ScenarioResult {
  const b = inp.basis;
  const gross = inp.sizeKw * costPerKw;
  /* A subsidy cannot pay more than the system cost; only a tiny, cheap system could reach that. */
  const subsidy = Math.min(subsidyFor(inp.owner, inp.sizeKw, b), gross);
  const upfront = gross - subsidy;
  /* Bill mode: the household's own yearly use earns the tariff; generation beyond it
     earns the city's surplus credit, which is 0 where it lapses at the year's end. */
  const credit = b.surplusCreditPerKwh.value;
  const ownUse = inp.unitsPerMonth === null ? null : inp.unitsPerMonth * 12;
  const inv = b.inverter.value;
  let cumulative = -upfront;
  let paybackYear: number | null = null;
  const years: RoiYear[] = [];
  for (let t = 1; t <= b.horizonYears.value; t += 1) {
    const kwh = inp.sizeKw * kwhPerKw * degradationFactor(t, b);
    const value = ownUse === null
      ? kwh * inp.tariff
      : Math.min(kwh, ownUse) * inp.tariff + Math.max(0, kwh - ownUse) * credit;
    const upkeep = gross * b.upkeepPerYear.value;
    const inverter = t === inv.year ? inp.sizeKw * inv.perKw : 0;
    cumulative += value - upkeep - inverter;
    if (cumulative < 0) paybackYear = null; else paybackYear ??= t;
    years.push({ year: t, kwh, value, upkeep, inverter, cumulative });
  }
  return { upfront, subsidy, paybackYear, net: cumulative, years };
}

export function computeRoi(inp: RoiInput): RoiResult {
  /* Only size is guarded here; the sheet's controller refuses non-positive or non-numeric tariff, cost and units before calling (a NaN elsewhere yields net NaN). */
  if (!(inp.sizeKw >= MIN_SYSTEM_KW)) return { status: 'too_small', slow: null, fast: null };
  const [k1, k2] = inp.kwhPerKw;
  const [c1, c2] = inp.costPerKw;
  const slow = runScenario(inp, Math.min(k1, k2), Math.max(c1, c2));
  const fast = runScenario(inp, Math.max(k1, k2), Math.min(c1, c2));
  return { status: fast.paybackYear === null ? 'no_payback' : 'ok', slow, fast };
}

/** Year-1 kWh per kW for roof i: the bracket's low under the headline loss, its high
    under the strict-mask floor. The same bounds `pvRanges` uses, per kW. */
export function roofKwhPerKw(pv: Pick<PvFile, 'loss' | 'loss_strict' | 'tiers'>, i: number): readonly [number, number] {
  const [yLo, yHi] = pv.tiers.yield_bracket_kwh_per_kwp;
  return [yLo * (1 - pv.loss[i]), yHi * (1 - pv.loss_strict[i])];
}

/** The most this roof can take: the top of the published packing interval. */
export function roofMaxKw(pv: Pick<PvFile, 'kwp' | 'loss' | 'loss_strict' | 'tiers'>, i: number): number {
  return pvRanges(pv, i).kwpHigh;
}

/** The slider's starting point: a household-sized 3 kW, or less if the roof is smaller, in half-kW steps. */
export function defaultSizeKw(maxKw: number): number {
  return Math.min(3, Math.floor(maxKw * 2) / 2);
}

/** The official sizing suggestion for a monthly consumption (PM Surya Ghar table). */
export function suggestedSize(unitsPerMonth: number, basis: SolarCostBasis): readonly [number, number | null] {
  const band = basis.sizingByUnits.value.find((b) => b.maxUnits === null || unitsPerMonth <= b.maxUnits);
  return band ? band.kw : [3, null];
}

/** The whole ward as one system (spec D1, D6): every roof at its floor capacity, and a
    yield range that is exactly the capacity-weighted sum of the roofs' own ranges
    (`roofKwhPerKw`), so the ward can never be more optimistic than its roofs. */
export function wardInput(pv: Pick<PvFile, 'kwp' | 'loss' | 'loss_strict' | 'tiers'>): { readonly sizeKw: number; readonly kwhPerKw: readonly [number, number] } {
  let kw = 0, lo = 0, hi = 0;
  for (let i = 0; i < pv.kwp.length; i += 1) {
    const [a, b] = roofKwhPerKw(pv, i);
    kw += pv.kwp[i]; lo += pv.kwp[i] * a; hi += pv.kwp[i] * b;
  }
  return { sizeKw: kw, kwhPerKw: kw > 0 ? [lo / kw, hi / kw] : [0, 0] };
}

/** Year-by-year CSV of both scenarios, with the assumptions on every row so a sorted sheet keeps them. */
export function roiCsv(r: RoiResult, assumptions: string): string {
  if (r.status === 'too_small') return '';
  const q = `"${assumptions.replace(/"/g, '""')}"`;
  const rows = ['year,kwh_slow,value_slow,cumulative_slow,kwh_fast,value_fast,cumulative_fast,upkeep_slow,inverter,assumptions'];
  r.slow.years.forEach((s, k) => {
    const f = r.fast.years[k];
    rows.push([s.year, Math.round(s.kwh), Math.round(s.value), Math.round(s.cumulative),
      Math.round(f.kwh), Math.round(f.value), Math.round(f.cumulative), Math.round(s.upkeep), Math.round(s.inverter), q].join(','));
  });
  return `${rows.join('\n')}\n`;
}
