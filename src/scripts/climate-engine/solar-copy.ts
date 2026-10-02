import type { PvFile } from './types';
import type { Owner, RoiResult } from './solar-roi.ts';
import { citedLeaves, type SolarCostBasis } from './solar-cost.ts';

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** The OLDEST as_of across every cited value in the basis, as `Sep 2026`: the line is only as fresh as its stalest default. */
export function oldestAsOf(basis: SolarCostBasis): string {
  const dates = citedLeaves(basis).map((c) => c.as_of).sort();
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dates[0] ?? '');
  const name = m === null ? undefined : MONTHS[Number(m[2]) - 1];
  if (m === null || name === undefined) throw new Error('unreadable as_of');
  return `${name} ${m[1]}`;
}

/** A fraction as a percentage, trailing zeros trimmed, no space: 0.03 to `3%`, 0.005 to `0.5%`. */
const pctText = (f: number): string => `${parseFloat((f * 100).toFixed(2))}%`;

/** `3 kW`, `2.5 kW`: whole numbers print whole. */
const kwText = (kw: number): string => `${Number.isInteger(kw) ? kw : kw.toFixed(1)} kW`;

export function paybackText(r: RoiResult, horizon: number): string {
  if (r.status === 'too_small') return 'Too small for a useful system';
  const fast = r.fast.paybackYear;
  if (fast === null) return `Does not pay back within ${plural(horizon, 'year')} at these assumptions`;
  const slow = r.slow.paybackYear;
  if (slow === null) return `${plural(fast, 'year')} at best; may not pay back within ${plural(horizon, 'year')}`;
  return fast === slow ? plural(fast, 'year') : `${fast}–${plural(slow, 'year')}`;
}

export function savingText(r: RoiResult, money: (n: number) => string, horizon: number): string {
  if (r.status === 'too_small') return '';
  if (r.fast.net < 0) return `A net loss over ${plural(horizon, 'year')} at these assumptions`;
  if (r.slow.net < 0) return `a loss of ${money(-r.slow.net)} to a saving of ${money(r.fast.net)}`;
  return `${money(r.slow.net)} to ${money(r.fast.net)}`;
}

/** First letter up, for a sentence that begins a cell; the copy itself stays lower case so it can follow a colon. */
export const capFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function subsidyLine(owner: Owner, subsidy: number, money: (n: number) => string): string {
  if (owner === 'home') return `Home: assumes the PM Surya Ghar subsidy of ${money(subsidy)}, if eligible`;
  if (owner === 'society') return `Housing society: assumes ${money(subsidy)} for common areas, if eligible`;
  return 'Business: no subsidy assumed';
}

/** What flat valuation quietly assumes. Empty where it is not an assumption (business) or where surplus is paid. */
export function flatCaveat(owner: Owner, basis: SolarCostBasis): string {
  /* ponytail: the zero-credit wording names West Bengal because Kolkata is the only city with a basis; move the jurisdiction onto the basis when a second zero-credit city ships. */
  if (owner === 'business' || basis.surplusCreditPerKwh.value !== 0) return '';
  return 'In West Bengal, power beyond your own yearly use earns nothing. '
    + 'Add your monthly units under "Use my bill" to see the payback on what you actually use.';
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
  const d = b.degradation.value;
  const parts = [
    OWNER_LABEL[a.owner],
    kwText(a.sizeKw),
    `installed cost ${money(lo)}–${money(hi)} per kW`,
    /* assumed, never promised: eligibility is the scheme's to decide */
    a.subsidy > 0 ? `subsidy ${money(a.subsidy)} if eligible` : 'no subsidy',
    a.unitsPerMonth !== null
      ? `${rate(a.tariff)} per unit (kWh) for your own use, ${plural(Math.round(a.unitsPerMonth), 'unit')} a month, `
        + (b.surplusCreditPerKwh.value === 0 ? 'surplus not paid' : `surplus at ${rate(b.surplusCreditPerKwh.value)}`)
      : `every kWh valued at ${rate(a.tariff)} per unit (kWh), assuming you use all of it`,
    `output falls ${pctText(d.firstYear)} in year 1, then ${pctText(d.perYear)} a year`,
    `upkeep ${pctText(b.upkeepPerYear.value)} of cost a year`,
    `inverter replaced in year ${b.inverter.value.year}`,
    'today\'s prices, no tariff rise',
    `reference defaults as of ${oldestAsOf(b)}`,
  ];
  return parts.join(' · ');
}

export function sizingText(unitsPerMonth: number, kw: readonly [number, number | null]): string {
  const band = kw[1] === null ? `above ${kw[0]} kW` : `${kw[0]}–${kw[1]} kW`;
  return `PM Surya Ghar suggests ${band} for ${plural(Math.round(unitsPerMonth), 'unit')} a month`;
}

export function surplusText(sizeKw: number, share: readonly [number, number], tariff: number, basis: SolarCostBasis,
  rate: (n: number) => string): string {
  const credit = basis.surplusCreditPerKwh.value;
  const [a, b] = [Math.round(share[0] * 100), Math.round(share[1] * 100)];
  const pct = a === b ? `${a}%` : `${a}–${b}%`;
  const lead = `At ${kwText(sizeKw)} about ${pct} of your generation is beyond your own yearly use`;
  if (credit === 0) {
    /* ponytail: the zero-credit wording names West Bengal because Kolkata is the only city with a basis; move the jurisdiction onto the basis when a second zero-credit city ships. */
    return `${lead}. Under West Bengal's 2025 rooftop solar rules (WBERC), credit for it is set to zero at the end of each year and nothing is paid.`;
  }
  return `${lead}, credited at ${rate(credit)} per kWh, not your ${rate(tariff)} tariff.`;
}
