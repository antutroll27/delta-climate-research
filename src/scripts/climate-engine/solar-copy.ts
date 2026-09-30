import type { PvFile } from './types';
import type { Owner, RoiResult } from './solar-roi.ts';
import type { SolarCostBasis } from './solar-cost.ts';

type Validated = NonNullable<PvFile['tiers']['validated']>;

/** `1 real rooftop`, `31 real rooftops` — the plural the reader's own sample size
    happens to need, never hardcoded to the many case. */
const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** THE WARD BLOCK'S ONE-LINE LADDER SUMMARY (spec 2026-09-07-solar-guide §5): the
    same limits the card's five rungs name, condensed to a sentence for the pane
    that opens before any building is selected. Pure string building only — no
    currency lives here, so a future consumer (the installer brief, Task 5) can
    import it without pulling in `fmtMoney`. */
export function wardSummary(pv: Pick<PvFile, 'tiers'>): string {
  const v = pv.tiers.validated;
  return v === null
    ? 'Screened from satellites and open data. What limits it: roof obstacles, canopy over roofs, '
      + 'sunlight from a coarse cell, unverified heights, and no comparison with real rooftops yet. '
      + 'Open any roof for what would narrow each.'
    : `Checked against ${plural(v.n, 'real rooftop')} over ${plural(v.months, 'month')} `
      + `(median ratio ${v.median_ratio.toFixed(2)}). Still limited by roof obstacles, canopy over roofs, `
      + 'sunlight from a coarse cell and unverified heights; open any roof for what would narrow each.';
}

/** The card's fifth rung once a validation result exists (`#bcSureValid`, spec §2.3). */
export function validatedSentence(v: Validated): string {
  return `Compared with ${plural(v.n, 'real rooftop')} over ${plural(v.months, 'month')}: `
    + `median ratio ${v.median_ratio.toFixed(2)}, ${Math.round(v.within_15pct_share * 100)}% within 15%.`;
}

/** A SHARE OF A WHOLE, FLOORED AT "under 1%". `Math.round` turns anything under
    half a percent into `0%`, which reads as "none" when it means "a rounding away
    from none" — and the card and the brief print the same tree share side by side,
    so they cannot each own a copy of the rule. */
export function sharePct(f: number): string {
  return f < 0.005 ? 'under 1%' : `${Math.round(f * 100)}%`;
}

/** `#bcSolNote`'s tier-aware line. The static default names the tier in its own
    prose ("Screening estimate · …"), so once a roof is checked that prefix is
    stripped rather than left standing beside a note that now says otherwise. */
export function noteFor(pv: Pick<PvFile, 'tiers'>, defaultNote: string): string {
  const v = pv.tiers.validated;
  if (v === null) return defaultNote;
  return `Checked against ${plural(v.n, 'real rooftop')} · still a screening estimate · `
    + `${defaultNote.replace(/^Screening estimate · /, '')}`;
}

/* ── the payback sheet's sentences (spec 2026-09-30-solar-roi §4) ──
   Money arrives as formatter functions, so this file never names a currency. */

/** Printed beside every payback figure, on screen and on paper. */
export const ESTIMATE_TAG = 'screened · estimate, not a quote';

/** Words that turn an estimate into a promise. No payback sentence may use them. */
export const BANNED_PAYBACK_WORDS = /guarantee|assured|\bROI of\b|\breturns?\b/i;

const OWNER_LABEL: Record<Owner, string> = { home: 'Home', society: 'Housing society', business: 'Business' };

export function paybackText(r: RoiResult, horizon: number): string {
  if (r.status === 'too_small') return 'Too small for a useful system';
  if (r.status === 'no_payback') return `Does not pay back within ${horizon} years at these assumptions`;
  const fast = r.fast.paybackYear as number;
  const slow = r.slow.paybackYear;
  if (slow === null) return `${fast} years to more than ${horizon}`;
  return fast === slow ? `${fast} years` : `${fast}–${slow} years`;
}

export function savingText(r: RoiResult, money: (n: number) => string): string {
  if (r.status === 'too_small') return '';
  return `${money(r.slow.net)} to ${money(r.fast.net)}`;
}

export function subsidyLine(owner: Owner, subsidy: number, money: (n: number) => string): string {
  if (owner === 'home') return `Home: PM Surya Ghar subsidy ${money(subsidy)} applied`;
  if (owner === 'society') return `Housing society: ${money(subsidy)} for common areas (assumes common-area use)`;
  return 'Business: no subsidy';
}

export interface AssumptionInputs {
  readonly owner: Owner;
  readonly sizeKw: number;
  readonly costPerKw: readonly [number, number];
  readonly subsidy: number;
  readonly tariff: number;
  readonly unitsPerMonth: number | null;
  readonly basis: SolarCostBasis;
}

/** Every input the result depends on, in one line. It travels with every figure. */
export function assumptionsLine(a: AssumptionInputs, money: (n: number) => string, rate: (n: number) => string): string {
  const b = a.basis;
  const [lo, hi] = [Math.min(...a.costPerKw), Math.max(...a.costPerKw)];
  const bill = a.unitsPerMonth !== null;
  const d = b.degradation.value;
  const parts = [
    OWNER_LABEL[a.owner],
    `${a.sizeKw.toFixed(1)} kW`,
    `${money(lo)}–${money(hi)} per kW`,
    `subsidy ${money(a.subsidy)}`,
    bill
      ? `${rate(a.tariff)} per kWh for your own use, ${a.unitsPerMonth} units a month, `
        + (b.surplusCreditPerKwh.value === 0 ? 'surplus not paid' : `surplus at ${rate(b.surplusCreditPerKwh.value)}`)
      : `${rate(a.tariff)} per kWh flat`,
    `degradation ${(d.firstYear * 100).toFixed(1)} % then ${(d.perYear * 100).toFixed(2)} %/yr`,
    `upkeep ${(b.upkeepPerYear.value * 100).toFixed(1)} %/yr`,
    `inverter replaced in year ${b.inverter.value.year}`,
    `defaults as of ${b.costPerKw.as_of}`,
  ];
  return parts.join(' · ');
}

export function sizingText(unitsPerMonth: number, kw: readonly [number, number | null]): string {
  const band = kw[1] === null ? `above ${kw[0]} kW` : `${kw[0]}–${kw[1]} kW`;
  return `Official sizing for ${unitsPerMonth} units a month: ${band}`;
}

export function surplusText(sizeKw: number, share: readonly [number, number], tariff: number, credit: number,
  rate: (n: number) => string): string {
  const [a, b] = [Math.round(share[0] * 100), Math.round(share[1] * 100)];
  const pct = a === b ? `${a} %` : `${a}–${b} %`;
  if (credit === 0) {
    return `At ${sizeKw.toFixed(1)} kW about ${pct} of your generation is surplus beyond your yearly use. `
      + 'Under WBERC\'s 2025 rules it is reset to zero at the end of each year, not paid.';
  }
  return `At ${sizeKw.toFixed(1)} kW about ${pct} of your generation is surplus, credited at ${rate(credit)} per kWh, not your ${rate(tariff)} tariff.`;
}
