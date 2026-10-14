/**
 * The three-year view: the same shipment in every year the pack's default values cover.
 *
 * This file is OURS (like cbam-lines.ts and cbam-app.ts, unlike everything else under
 * cbam-algos/). No DOM anywhere: `outlook` is a pure function of (pack, input) and the renderers
 * are pure functions of its result, so all of it runs under node:test against the real pack.
 *
 * IT HOLDS NO REGULATION ARITHMETIC. It never multiplies a benchmark by a factor or a default
 * value by a mark-up. Each year is one call to the engine with only the date changed, and every
 * figure shown is either a field of what the engine returned or a row of the pack. What this
 * file does compute is the DIFFERENCE between two of the engine's answers, and how that
 * difference divides into causes — subtraction over figures the engine already produced.
 *
 * NOTHING HERE IS A FORECAST. The law for these years is published; the certificate price for
 * most of them is not, and the strip says "none published" where that is so. The one number that
 * is not the Commission's is the visitor's own price, which is labelled as theirs wherever it
 * appears and never leaves this module's caller (see cbam-app.ts: a closure variable, never
 * stored, exported or sent).
 *
 * NO YEAR IS COMPARED WITH A LITERAL. The years are the pack's reporting years; "first" and
 * "last" are the ends of that list; the date under "as at" is the pack's own. The day a pack
 * covers 2029 this file shows four cards without being edited.
 */
import Decimal from 'decimal.js';
import { parseRegulatoryDate } from './cbam-algos/cbam/input.ts';
import {
  estimateFromPack, lookupIndirectFactorFromPack, nonNegativeDecimal, selectFactorFromPack,
  type EstimatorInput, type EstimatorPack,
} from './cbam-algos/estimator/estimate-from-pack.ts';
import type {
  CertificateEstimate, DataTier, EstimateFigure,
} from './cbam-algos/cbam/certificate-estimate.ts';

/**
 * Exact decimals with room to spare. The one division in this file (the factor split) is exact
 * whenever free allocation is benchmark × mass × factor, which is how the engine builds it; the
 * extra precision is there so that an inexact case rounds far below anything displayed rather
 * than at the 20th digit, where it could tip the identity check.
 */
const D = Decimal.clone({ precision: 60 });

/* ── the model ─────────────────────────────────────────────────────────────── */

/** The certificate-price row the engine looked up for a year's date, as the pack states it. */
export interface OutlookPrice {
  /** The engine's lookup key: the quarter the date falls in. NOT a published price period. */
  quarter: string;
  status: 'published' | 'pending';
  priceEur: string | null;
  /** The pack row's own sourceLocator. The only wording a person is shown about the row. */
  locator: string | null;
}

export interface OutlookFigureYear {
  kind: 'figure';
  year: number;
  /** The date priced: the input's month and day, in this year. */
  date: string;
  status: 'ok' | 'zero_by_fiat' | 'cscf_pending';
  tier: DataTier;
  certificates: string;
  /** Direct embedded emissions as the engine counted them (default value with its mark-up, or the attested figure). */
  directTco2e: string;
  indirectTco2e: string;
  /** Direct plus indirect. */
  embeddedTco2e: string;
  /** Free allocation deducted. */
  allocationTco2e: string;
  /** The share of free allocation retained in this year, as the engine applied it. */
  factor: string;
  factorLocator: string;
  benchmarks: { value: string; route: string; locator: string }[];
  /** The engine's cost, present only where the pack holds a published price. */
  costEur: string | null;
  price: OutlookPrice;
  /** The mark-up on the direct default the engine selected; null when the direct figure is attested. */
  directMarkupPct: string | null;
  /** The mark-up on the electricity default the engine selected; null when none was applied. */
  indirectMarkupPct: string | null;
  /** (certificates − first year's) ÷ first year's, as a percentage. Null in the first year, or when that count is zero. */
  riseOnFirstPct: string | null;
}

export interface OutlookRefusedYear {
  kind: 'refused';
  year: number;
  date: string;
  /** The engine's own reason, verbatim. */
  reason: string;
  selector: string | null;
}

export type OutlookYear = OutlookFigureYear | OutlookRefusedYear;

/**
 * How the rise from the first year to the last divides. All five are exact decimals and
 * `rise === moreEmissions + factorPart + benchmarkPart` holds exactly, or this object is not built.
 */
export interface OutlookSplit {
  firstYear: number;
  lastYear: number;
  rise: string;
  /** Embedded emissions counted, last minus first. */
  moreEmissions: string;
  /** Free allocation deducted, first minus last. */
  lessAllocation: string;
  /** The part of lessAllocation due to the retained share falling, at the first year's benchmark. */
  factorPart: string;
  /** The rest of lessAllocation: the benchmark itself changing. */
  benchmarkPart: string;
  /**
   * What the emissions term IS, which decides how it may be labelled. A line on default values
   * counts more emissions each year because the mark-up on the default rises; a line with an
   * attested direct figure and the Commission's electricity default counts more because the
   * mark-up on THAT default rises; a fully attested line counts the same emissions every year.
   */
  emissionsCause: 'markup-default' | 'markup-electricity' | 'none';
}

/** Why no split is shown, for the one sentence the strip says in its place. */
export type SplitWithheld = 'refused' | 'floor' | 'tier-changes';

export interface Outlook {
  years: OutlookYear[];
  /** pack.generatedAt — the date the strip's "law as published" tag uses. */
  packDate: string;
  /**
   * The day the certificate-price source was last read, from the pack: the `retrievedAt` of the
   * source the year's price rows cite. Every "none published · as at" on the strip uses this,
   * because that is the claim it dates. It is not the pack's own date: the pack is cut from the
   * default-values workbook, and a price can be read again (as Q3 2026 was) without that moving.
   */
  priceAsAt: string;
  split: OutlookSplit | null;
  splitWithheld: SplitWithheld | null;
  /** The first year in which the pack's retained share is zero, if it holds one. */
  allocationEndsYear: number | null;
  /** The bounded validity periods of the pack's benchmarks, as [firstYear, lastYear]. */
  benchmarkPeriods: [number, number][];
}

/* ── the calculation ───────────────────────────────────────────────────────── */

/** The reporting years the pack's default values cover, ascending. */
export function outlookYears(pack: EstimatorPack): number[] {
  // Remembered per array of default values: 76,000 rows are walked once, not on every keystroke.
  // Keyed on the array itself, so a pack with different rows gets its own answer.
  const known = yearsByRows.get(pack.defaultValues);
  if (known) return [...known];
  const years = new Set<number>();
  for (const row of pack.defaultValues) years.add(row.reportingYear);
  const sorted = [...years].sort((a, b) => a - b);
  yearsByRows.set(pack.defaultValues, sorted);
  return [...sorted];
}
const yearsByRows = new WeakMap<object, number[]>();

/**
 * The same month and day in another year, or null for a date the engine would not read.
 *
 * 29 FEBRUARY BECOMES 28 FEBRUARY in a year that has none. Both fall in the first quarter and in
 * the same reporting year, which are the only two things about a date the engine looks up, so the
 * substitution cannot move a figure. The candidate is checked with the engine's own parser rather
 * than by leap-year arithmetic here, so the two cannot disagree about which dates exist.
 */
export function dateInYear(date: string, year: number): string | null {
  const parsed = parseRegulatoryDate(date);
  if (!parsed.ok) return null;
  const monthDay = parsed.day.slice(4);
  const yyyy = String(year).padStart(4, '0');
  const same = `${yyyy}${monthDay}`;
  if (parseRegulatoryDate(same).ok) return same;
  if (monthDay === '-02-29') {
    const clamped = `${yyyy}-02-28`;
    if (parseRegulatoryDate(clamped).ok) return clamped;
  }
  return null;
}

/** The figure block of a priced estimate, whichever arm carries it. Exhaustive by construction. */
function figureOf(e: Exclude<CertificateEstimate, { status: 'unavailable' }>): EstimateFigure {
  switch (e.status) {
    case 'ok': return e.figure;
    case 'zero_by_fiat': return e.figure;
    case 'cscf_pending': return e.scenario;
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}

function yearOf(pack: EstimatorPack, input: EstimatorInput, year: number, date: string): OutlookYear {
  const yearInput: EstimatorInput = { ...input, date };
  const e = estimateFromPack(pack, yearInput);
  if (e.status === 'unavailable') {
    return { kind: 'refused', year, date, reason: e.reason, selector: e.selector };
  }
  const figure = figureOf(e);
  const priceRow = pack.prices.find((row) => row.quarter === e.priceQuarter);
  // The mark-up percentages are read from the record the engine's OWN selector returns for this
  // year, and only for the half of the line that rests on a default. An attested figure carries
  // no mark-up, so naming one beside it would describe a charge that was not made.
  const tier = e.stamp.tier;
  const directDefault = tier === 'default+markup' ? selectFactorFromPack(pack, yearInput) : null;
  const usesIndirectDefault = (tier === 'default+markup' || tier === 'verified-direct+default-indirect')
    && !new D(figure.indirectTco2e).isZero();
  const indirectLookup = usesIndirectDefault ? lookupIndirectFactorFromPack(pack, yearInput) : null;
  return {
    kind: 'figure',
    year,
    date,
    status: e.status,
    tier,
    certificates: figure.certificates,
    directTco2e: e.emissionsTco2e,
    indirectTco2e: figure.indirectTco2e,
    embeddedTco2e: figure.totalEmbeddedTco2e,
    allocationTco2e: figure.faaTco2e,
    factor: e.terms.cbamFactor,
    factorLocator: e.terms.cbamFactorLocator,
    benchmarks: e.terms.benchmarks.map((b) => ({
      value: b.benchmarkTco2ePerT, route: b.routeIndicator, locator: b.sourceLocator,
    })),
    costEur: figure.costEur,
    price: {
      quarter: e.priceQuarter,
      status: e.priceStatus,
      priceEur: e.priceEur,
      locator: priceRow ? priceRow.sourceLocator : null,
    },
    directMarkupPct: directDefault ? directDefault.markupPct : null,
    indirectMarkupPct: indirectLookup && indirectLookup.kind === 'found'
      ? indirectLookup.factor.markupPct : null,
    riseOnFirstPct: null,
  };
}

function emissionsCauseOf(tier: DataTier): OutlookSplit['emissionsCause'] {
  switch (tier) {
    case 'default+markup': return 'markup-default';
    case 'verified-direct+default-indirect': return 'markup-electricity';
    case 'actual-verified': return 'none';
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

/**
 * The split of the rise, or the reason it is withheld.
 *
 * WITHHELD RATHER THAN APPROXIMATED. The three parts are only meaningful if they add up to the
 * rise exactly. They do not when free allocation is at least the emissions counted in either
 * year: the engine floors the count at zero there, so part of the change in allocation never
 * reaches the count and "more emissions + less allocation" overstates the rise. Showing a bar
 * whose parts do not sum to its own heading would be the strip inventing a figure, so the counts
 * are shown and the bar is not.
 *
 * THE ORDER OF THE TWO ALLOCATION PARTS IS A CHOICE, stated so it is not mistaken for a law. The
 * factor part is the fall in the retained share applied to the FIRST year's allocation; the
 * benchmark part is the remainder, so it is the benchmark change at the LAST year's share. The
 * other order moves a second-order amount from one part to the other and changes neither the
 * total nor which parts are zero.
 */
function splitOf(years: OutlookYear[]): { split: OutlookSplit | null; withheld: SplitWithheld | null } {
  const first = years[0];
  const last = years[years.length - 1];
  if (years.some((y) => y.kind === 'refused') || first.kind !== 'figure' || last.kind !== 'figure') {
    return { split: null, withheld: 'refused' };
  }
  if (years.some((y) => y.kind === 'figure' && y.tier !== first.tier)) {
    return { split: null, withheld: 'tier-changes' };
  }
  const rise = new D(last.certificates).minus(first.certificates);
  const moreEmissions = new D(last.embeddedTco2e).minus(first.embeddedTco2e);
  const lessAllocation = new D(first.allocationTco2e).minus(last.allocationTco2e);
  const factorFirst = new D(first.factor);
  // The identity. Exact equality on exact decimals: no tolerance, because a tolerance is how a
  // floored line would slip through looking almost right.
  if (!rise.equals(moreEmissions.plus(lessAllocation)) || factorFirst.isZero()) {
    return { split: null, withheld: 'floor' };
  }
  const factorPart = new D(first.allocationTco2e)
    .times(factorFirst.minus(last.factor)).dividedBy(factorFirst);
  const benchmarkPart = lessAllocation.minus(factorPart);
  if (moreEmissions.isNegative() || factorPart.isNegative() || benchmarkPart.isNegative()) {
    return { split: null, withheld: 'floor' };
  }
  return {
    withheld: null,
    split: {
      firstYear: first.year,
      lastYear: last.year,
      rise: rise.toFixed(),
      moreEmissions: moreEmissions.toFixed(),
      lessAllocation: lessAllocation.toFixed(),
      factorPart: factorPart.toFixed(),
      benchmarkPart: benchmarkPart.toFixed(),
      emissionsCause: emissionsCauseOf(first.tier),
    },
  };
}

/**
 * The same shipment in every covered year, or null when there is nothing to show: an unreadable
 * date, or a date in a year the default values do not cover (the form's own refusal stands
 * there, and the strip adding three cards beneath it would contradict it).
 */
export function outlook(pack: EstimatorPack, input: EstimatorInput): Outlook | null {
  const parsed = parseRegulatoryDate(input.date);
  if (!parsed.ok) return null;
  const covered = outlookYears(pack);
  if (!covered.includes(parsed.year)) return null;

  const years: OutlookYear[] = [];
  for (const year of covered) {
    const date = dateInYear(input.date, year);
    if (date === null) return null;
    years.push(yearOf(pack, input, year, date));
  }

  const first = years[0];
  if (first.kind === 'figure' && !new D(first.certificates).isZero()) {
    for (const y of years.slice(1)) {
      if (y.kind !== 'figure') continue;
      y.riseOnFirstPct = new D(y.certificates).minus(first.certificates)
        .dividedBy(first.certificates).times(100).toFixed();
    }
  }

  const { split, withheld } = splitOf(years);
  const zeroFactor = pack.cbamFactors
    .filter((row) => new D(row.factor).isZero()).map((row) => row.year).sort((a, b) => a - b)[0];
  const periods = new Map<string, [number, number]>();
  for (const row of pack.benchmarks) {
    if (!row.validTo) continue;
    const from = parseRegulatoryDate(row.validFrom);
    const to = parseRegulatoryDate(row.validTo);
    if (from.ok && to.ok) periods.set(`${from.year}-${to.year}`, [from.year, to.year]);
  }
  return {
    years,
    packDate: pack.generatedAt,
    priceAsAt: priceSourceDate(pack, years) ?? pack.generatedAt,
    split,
    splitWithheld: withheld,
    allocationEndsYear: zeroFactor ?? null,
    benchmarkPeriods: [...periods.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
  };
}

/** The `retrievedAt` of the source the years' price rows cite, or null if none can be found. */
function priceSourceDate(pack: EstimatorPack, years: OutlookYear[]): string | null {
  for (const y of years) {
    if (y.kind !== 'figure') continue;
    const row = pack.prices.find((r) => r.quarter === y.price.quarter);
    const source = row ? pack.sources.find((s) => s.id === row.sourceId) : undefined;
    if (source?.retrievedAt) return source.retrievedAt;
  }
  return null;
}

/* ── the visitor's own price ───────────────────────────────────────────────── */

/**
 * The visitor's assumed price, or null when the box holds nothing usable.
 *
 * READ WITH THE ENGINE'S OWN NUMBER PARSER (nonNegativeDecimal), so the box accepts exactly what
 * the mass and verified-figure fields accept and refuses what they refuse ('0x10', '1_000', a
 * bare point).
 *
 * ROUNDED ONCE, HERE, TO THE CENT, and that rounded price is the one used everywhere after. It
 * used to be shown rounded and used unrounded: 80.555 printed "at your assumed €80.56" beside a
 * cost worked out at 80.555, and 0.004 printed "€0.00" beside a cost above zero. A price is
 * money, and money on this page has two decimal places. Anything that rounds to less than one
 * cent is refused: a price of nothing would print "€0.00" under a year for which no price is
 * published, a figure that looks like a finding.
 */
export function parseAssumedPrice(text: string): string | null {
  const parsed = nonNegativeDecimal(text);
  if (!parsed || !parsed.isFinite()) return null;
  const cents = new D(parsed.toFixed()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (cents.lessThan('0.01')) return null;
  return cents.toFixed();
}

/**
 * Cost at the visitor's own price: certificates × price, to the cent, half up.
 *
 * THE ONE SUM HERE THE ENGINE DID NOT DO, because the engine prices only at a row of the pack
 * and this price is not one. It is the engine's own expression (figureFrom in
 * certificate-estimate.ts: `net.mul(price).toFixed(2, ROUND_HALF_UP)`), and
 * cbam-outlook.test.mjs holds the two to the same answer by feeding this function a price the
 * pack DOES publish and requiring the engine's cost back.
 */
export function assumedCost(certificates: string, priceEur: string): string {
  return new D(certificates).times(priceEur).toFixed(2, Decimal.ROUND_HALF_UP);
}

/* ── formatting ────────────────────────────────────────────────────────────── */

const esc = (s: string): string => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * An exact decimal string to `dp` places, rounded half up on the DECIMAL, with thousands
 * separators. Never through Number(): 329.8275 is not representable in binary, and a figure
 * rounded from its nearest double is rounded from the wrong value.
 *
 * `fixed` keeps trailing zeros (a column of counts should not change width between years);
 * without it they are trimmed, which is how the result card above prints its own figures.
 */
export function formatDecimal(value: string, dp: number, fixed: boolean): string {
  const rounded = new D(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
  const text = fixed ? rounded.toFixed(dp) : rounded.toFixed();
  const negative = text.startsWith('-');
  const [whole, fraction] = (negative ? text.slice(1) : text).split('.');
  const body = fraction === undefined ? group(whole) : `${group(whole)}.${fraction}`;
  // A value that rounds to zero prints without a sign: "−0.0" is not a quantity.
  return negative && !rounded.isZero() ? `−${body}` : body;
}

const count1 = (v: string): string => formatDecimal(v, 1, true);
const working = (v: string): string => formatDecimal(v, 3, false);
const euros = (v: string): string => `€${formatDecimal(v, 2, true)}`;
/** A price as typed or published: cents only when it has them. */
const price = (v: string): string => `€${formatDecimal(v, 2, new D(v).decimalPlaces() > 0)}`;
/** '0.975' → '97.5%'. Exact: a share times one hundred. */
const share = (v: string): string => `${formatDecimal(new D(v).times(100).toFixed(), 3, false)}%`;
const signedPct = (v: string): string => {
  const text = formatDecimal(v, 1, true);
  return text.startsWith('−') || new D(v).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).isZero()
    ? `${text}%` : `+${text}%`;
};

/** The pack's date as "18 Aug 2026", read in UTC so it is the same day in every browser. */
export function formatPackDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(d);
}

/* ── rendering ─────────────────────────────────────────────────────────────── */

const figureYears = (view: Outlook): OutlookFigureYear[] =>
  view.years.filter((y): y is OutlookFigureYear => y.kind === 'figure');

/** The years the visitor's price would fill: those with a figure and no published price. */
export function unpricedYears(view: Outlook): number[] {
  return figureYears(view).filter((y) => y.costEur === null).map((y) => y.year);
}

const yearList = (years: number[]): string =>
  years.length <= 1 ? years.join('')
    : `${years.slice(0, -1).join(', ')} and ${years[years.length - 1]}`;

function renderYearCost(y: OutlookFigureYear, view: Outlook, assumed: string | null): string {
  // A PUBLISHED PRICE IS NEVER REPLACED. The engine's cost comes first and the visitor's number
  // is not consulted at all for that year.
  if (y.costEur !== null && y.price.priceEur !== null) {
    return `<span class="cb-ol-e">${euros(y.costEur)}</span>
      <span class="cb-ol-s">price published, ${price(y.price.priceEur)}</span>`;
  }
  if (assumed !== null) {
    return `<span class="cb-ol-e cb-ol-mine">${euros(assumedCost(y.certificates, assumed))}</span>
      <span class="cb-ol-s">at your assumed ${price(assumed)} · not a published price</span>`;
  }
  // ABOUT THIS YEAR'S OWN QUARTER. "2026 · none published" was false for a November shipment:
  // two other 2026 quarters have a published price. The quarter is the engine's lookup key for
  // this date, named the way the result card above names it ("imports in <quarter>").
  return `<span class="cb-ol-s">Certificate price · imports in ${esc(y.price.quarter)}</span>
      <span class="cb-ol-e">none published</span>
      <span class="cb-ol-s">as at ${esc(formatPackDate(view.priceAsAt))}</span>`;
}

/** The year cards. */
export function renderOutlookYears(view: Outlook, assumed: string | null): string {
  const firstYear = view.years[0].year;
  return view.years.map((y) => {
    if (y.kind === 'refused') {
      return `<li class="cb-ol-yr cb-ol-refused">
        <div class="cb-ol-y">${y.year}</div>
        <div class="cb-ol-none">No estimate</div>
        <p class="cb-ol-reason">${esc(y.reason)}</p>
      </li>`;
    }
    const delta = y.year === firstYear
      ? '<div class="cb-ol-d cb-ol-zero">certificates</div>'
      : y.riseOnFirstPct === null
        ? '<div class="cb-ol-d cb-ol-zero">certificates</div>'
        : `<div class="cb-ol-d"><span class="cb-ol-sr">certificates, </span>${signedPct(y.riseOnFirstPct)} on ${firstYear}</div>`;
    return `<li class="cb-ol-yr">
        <div class="cb-ol-y">${y.year}</div>
        <div class="cb-ol-n">${count1(y.certificates)}</div>
        ${delta}
        <div class="cb-ol-p">${renderYearCost(y, view, assumed)}</div>
      </li>`;
  }).join('');
}

const benchmarkOf = (y: OutlookFigureYear): { value: string; route: string } | null =>
  y.benchmarks.length === 1 ? y.benchmarks[0] : null;

/** "Why it rises": the bar and its legend, or the sentence said in their place. */
export function renderOutlookWhy(view: Outlook): string {
  const s = view.split;
  if (s === null) {
    switch (view.splitWithheld) {
      case 'floor':
        return `<p class="cb-ol-nosplit">In at least one of these years the free allocation is as
          large as the emissions counted, so the count is held at zero and the change between years
          cannot be divided into causes. The counts above stand.</p>`;
      case 'tier-changes':
        return `<p class="cb-ol-nosplit">These years do not rest on the same kind of figure, so the
          change between them is not divided into causes. The counts above stand.</p>`;
      case 'refused':
      case null:
        return '';
      default: {
        const _exhaustive: never = view.splitWithheld;
        return _exhaustive;
      }
    }
  }
  const figures = figureYears(view);
  const first = figures[0];
  const last = figures[figures.length - 1];

  const rows: { cls: string; title: string; sub: string; value: string; label: string }[] = [];

  if (s.emissionsCause !== 'none') {
    const electricity = s.emissionsCause === 'markup-electricity';
    const from = electricity ? first.indirectMarkupPct : first.directMarkupPct;
    const to = electricity ? last.indirectMarkupPct : last.directMarkupPct;
    const what = electricity
      ? "Mark-up on the Commission's default value for electricity"
      : 'Mark-up on default values';
    // The percentages are named only when ONE mark-up explains the whole term. A line on default
    // values with electricity in scope carries two (process and electricity); when they differ,
    // quoting either would misdescribe the other half, so the sentence gives none.
    const single = electricity
      || first.indirectMarkupPct === null
      || (first.indirectMarkupPct === first.directMarkupPct && last.indirectMarkupPct === last.directMarkupPct);
    let title: string;
    if (from === null || to === null || !single) {
      title = new D(s.moreEmissions).isZero() ? `${what} does not change` : `${what} rises`;
    } else if (from === to) {
      title = `${what} stays at ${esc(from)}%`;
    } else {
      title = `${what} rises from ${esc(from)}% to ${esc(to)}%`;
    }
    rows.push({
      cls: 'cb-ol-s1',
      title,
      sub: electricity
        ? 'It applies to the electricity figure, which is not your own verified one. With a verified electricity figure it no longer applies.'
        : "It applies only while you use the Commission's default values. With verified emissions it no longer applies.",
      value: s.moreEmissions,
      label: 'Mark-up',
    });
  }

  const cite = first.factorLocator.includes(':') ? first.factorLocator.slice(0, first.factorLocator.indexOf(':')) : '';
  rows.push({
    cls: 'cb-ol-s2',
    title: first.factor === last.factor
      ? `Free allocation retained stays at ${share(first.factor)}`
      : `Free allocation retained falls from ${share(first.factor)} to ${share(last.factor)}`,
    sub: `${cite ? `${esc(cite)}. ` : ''}The share retained falls each year${
      view.allocationEndsYear === null ? '' : `, to zero in ${view.allocationEndsYear}`}.`,
    value: s.factorPart,
    label: 'Free allocation retained',
  });

  const bmFirst = benchmarkOf(first);
  const bmLast = benchmarkOf(last);
  const scope = bmFirst && bmFirst.route ? `for route ${esc(bmFirst.route)}` : 'for this good';
  // The year the benchmark first differs from the year before it, read off the cards themselves.
  const changedIn = figures.find((y, i) => i > 0 && benchmarkOf(y)?.value !== benchmarkOf(figures[i - 1])?.value);
  let benchTitle: string;
  if (!bmFirst || !bmLast) {
    benchTitle = new D(s.benchmarkPart).isZero() ? 'Benchmark does not change' : 'Benchmark changes';
  } else if (bmFirst.value === bmLast.value || !changedIn) {
    benchTitle = `Benchmark ${scope} does not change by ${s.lastYear}`;
  } else {
    const verb = new D(bmLast.value).lessThan(bmFirst.value) ? 'falls' : 'rises';
    benchTitle = `Benchmark ${scope} ${verb} in ${changedIn.year} (${esc(bmFirst.value)} → ${esc(bmLast.value)})`;
  }
  rows.push({
    cls: 'cb-ol-s3',
    title: benchTitle,
    sub: view.benchmarkPeriods.length
      ? `Benchmarks are set by period: ${view.benchmarkPeriods.map(([a, b]) => `${a}–${b}`).join(', then ')}.`
      : 'Benchmarks are set by period.',
    value: s.benchmarkPart,
    label: 'Benchmark',
  });

  // A part that is zero draws no segment (it would be a zero-width box holding a gap open); its
  // legend row still stands and says so.
  const bar = rows.filter((r) => !new D(r.value).isZero()).map((r) => `<span class="${r.cls}" style="flex-grow:${
    new D(r.value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed()}"></span>`).join('');
  const aria = rows.map((r) => `${r.label} ${count1(r.value)}`).join(', ');
  const legend = rows.map((r) => `<li>
      <span class="cb-ol-sw ${r.cls}"></span>
      <span>${r.title}<small>${r.sub}</small></span>
      <b>${new D(r.value).isZero() ? '0.0' : `+${count1(r.value)}`}</b>
    </li>`).join('');

  return `<h4 class="cb-ol-h">Why it rises by ${count1(s.rise)} certificates by ${s.lastYear}</h4>
    <div class="cb-ol-stack" role="img" aria-label="${esc(aria)}">${bar}</div>
    <ul class="cb-ol-legend">${legend}</ul>`;
}

/** The rows of the "Show the working" table. */
export function renderOutlookRows(view: Outlook, assumed: string | null): string {
  const cell = (y: OutlookYear, body: (f: OutlookFigureYear) => string): string =>
    (y.kind === 'figure' ? `<td>${body(y)}</td>` : '<td>—<small>no estimate</small></td>');
  const figures = figureYears(view);
  const tier = figures.length ? figures[0].tier : null;
  const emissionsBasis = tier === 'default+markup' ? 'default value plus mark-up'
    : tier === 'actual-verified' ? 'your verified figures'
      : tier === 'verified-direct+default-indirect'
        ? "your verified direct figure, plus the Commission's electricity default with mark-up"
        : '';
  const anyIndirect = figures.some((y) => !new D(y.indirectTco2e).isZero());

  const emissions = `<tr><th scope="row">Emissions counted, tCO₂e<small>${esc(emissionsBasis)}</small></th>${
    view.years.map((y) => cell(y, (f) => `${working(f.embeddedTco2e)}${
      f.directMarkupPct !== null ? `<small>mark-up ${esc(f.directMarkupPct)}%</small>`
        : f.indirectMarkupPct !== null ? `<small>electricity mark-up ${esc(f.indirectMarkupPct)}%</small>` : ''}`)).join('')}</tr>`;
  const indirect = anyIndirect
    ? `<tr><th scope="row">of which electricity<small>receives no free allocation</small></th>${
      view.years.map((y) => cell(y, (f) => `${working(f.indirectTco2e)}${
        f.indirectMarkupPct !== null ? `<small>mark-up ${esc(f.indirectMarkupPct)}%</small>` : ''}`)).join('')}</tr>`
    : '';
  const allocation = `<tr><th scope="row">Free allocation deducted, tCO₂e<small>benchmark × share retained × tonnes</small></th>${
    view.years.map((y) => cell(y, (f) => {
      const bm = benchmarkOf(f);
      return `−${working(f.allocationTco2e)}<small>${bm ? `${esc(bm.value)} × ` : ''}${share(f.factor)}</small>`;
    })).join('')}</tr>`;
  const certificates = `<tr class="cb-ol-tot"><th scope="row">Certificates to surrender</th>${
    view.years.map((y) => cell(y, (f) => working(f.certificates))).join('')}</tr>`;
  const cost = `<tr><th scope="row">Cost<small>price × certificates</small></th>${
    view.years.map((y) => cell(y, (f) => {
      if (f.costEur !== null && f.price.priceEur !== null) {
        return `${euros(f.costEur)}<small>published ${price(f.price.priceEur)}</small>`;
      }
      if (assumed !== null) {
        return `${euros(assumedCost(f.certificates, assumed))}<small>your assumed ${price(assumed)}</small>`;
      }
      return '—<small><b class="cb-ol-np">none published</b></small>';
    })).join('')}</tr>`;
  return emissions + indirect + allocation + certificates + cost;
}

/** The sentence under the price box. */
export function renderOutlookPriceNote(view: Outlook, priceText: string): string {
  const years = unpricedYears(view);
  const fills = `Fills the cost for ${yearList(years)}, where no price is published for the import's quarter.`;
  const mine = 'It is your own assumption: not a forecast and not a published price. '
    + 'It stays on this page and is not saved, exported or sent.';
  if (priceText.trim() !== '' && parseAssumedPrice(priceText) === null) {
    return `Enter a price of at least €0.01. ${mine}`;
  }
  return `${fills} ${mine}`;
}

/** The notes under the strip: the correction-factor caveat, and each pending price row's own locator once. */
export function renderOutlookNotes(view: Outlook): string {
  const figures = figureYears(view);
  if (!figures.length) return '';
  const notes: string[] = [];
  if (figures.some((y) => y.status === 'cscf_pending')) {
    notes.push('Certificate counts assume no cross-sectoral correction: the Commission has not '
      + 'published the factor for these years, and it can only reduce the free allocation deducted.');
  }
  const seen = new Set<string>();
  for (const y of figures) {
    if (y.price.status !== 'pending' || !y.price.locator || seen.has(y.price.locator)) continue;
    seen.add(y.price.locator);
    const years = figures.filter((f) => f.price.status === 'pending' && f.price.locator === y.price.locator)
      .map((f) => f.year);
    notes.push(`Certificate price, ${yearList(years)}: ${esc(y.price.locator)}.`);
  }
  return notes.map((n) => `<p class="cb-ol-note">${n}</p>`).join('');
}

/** The head of the card: its title and the "law as published" tag. */
export function renderOutlookHead(view: Outlook): string {
  const first = view.years[0].year;
  const last = view.years[view.years.length - 1].year;
  return `<h3 class="cb-card-label" id="cbOlTitle">The same shipment, ${first} to ${last}</h3>
    <span class="cb-tag pending">Law as published · ${esc(formatPackDate(view.packDate))}</span>`;
}

/**
 * The whole strip. `priceText` is what the visitor has typed in the price box, restored into the
 * box when the strip is rebuilt; it is never read from anywhere but the caller's own variable.
 *
 * THE PARTS THE PRICE CHANGES SIT IN `data-ol` SLOTS so the page can refill them as the visitor
 * types without replacing the price box (which would drop the caret mid-number) or the <details>
 * (which would close it). See outlookPriceSlots.
 */
export function renderOutlook(view: Outlook, priceText = '', workingOpen = false): string {
  const assumed = parseAssumedPrice(priceText);
  const hasFigures = figureYears(view).length > 0;
  const priceBox = unpricedYears(view).length > 0;
  return `<section class="cb-card cb-ol" aria-labelledby="cbOlTitle">
    <div class="cb-card-head">${renderOutlookHead(view)}</div>
    <ol class="cb-ol-years" data-ol="years">${renderOutlookYears(view, assumed)}</ol>
    <div class="cb-ol-why">${renderOutlookWhy(view)}</div>
    <details class="cb-ol-work"${workingOpen ? ' open' : ''}${hasFigures ? '' : ' hidden'}>
      <summary>Show the working</summary>
      <div class="cb-ol-scroll" tabindex="0" role="region" aria-label="The working, year by year">
        <table>
          <thead><tr><td></td>${view.years.map((y) => `<th scope="col">${y.year}</th>`).join('')}</tr></thead>
          <tbody data-ol="rows">${renderOutlookRows(view, assumed)}</tbody>
        </table>
      </div>
    </details>
    <div class="cb-ol-price"${priceBox ? '' : ' hidden'}>
      <label for="cbOlPrice">Your own price assumption, € per certificate</label>
      <input id="cbOlPrice" class="cb-ol-px" type="number" min="0" step="any" inputmode="decimal"
        placeholder="e.g. 80" autocomplete="off" aria-describedby="cbOlPriceNote" value="${esc(priceText)}" />
      <p id="cbOlPriceNote" data-ol="pricenote">${renderOutlookPriceNote(view, priceText)}</p>
    </div>
    <div class="cb-ol-notes">${renderOutlookNotes(view)}</div>
  </section>`;
}

/**
 * The three slots the visitor's price can change. The page refills these when the price box is
 * typed in, and leaves everything else — the box itself above all — exactly where it is.
 */
export function outlookPriceSlots(view: Outlook, priceText: string): Record<'years' | 'rows' | 'pricenote', string> {
  const assumed = parseAssumedPrice(priceText);
  return {
    years: renderOutlookYears(view, assumed),
    rows: renderOutlookRows(view, assumed),
    pricenote: renderOutlookPriceNote(view, priceText),
  };
}
