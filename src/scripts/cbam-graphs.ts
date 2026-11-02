/**
 * The graphs under the three-year strip: the previewed line, drawn.
 *
 * This file is OURS (like cbam-outlook.ts). No DOM: `graphsModel` is a pure function of the pack,
 * the line and its outlook. The tiles that draw the model are in cbam-ui/tiles-why.ts; the SVG for
 * the cost rows is drawn here. All of it returns a
 * string, so all of it runs under node:test against the real pack.
 *
 * WHAT IT ADDS TO THE STRIP, AND WHAT IT DOES NOT REPEAT. The strip above states the three
 * counts and the split as figures. These cards draw them, and add two things the strip does
 * not have: what the mark-up adds in each year, and how much of the emissions counted is
 * charged. Nothing here is a second source for a number: every figure is read from the outlook
 * (which is the engine's own answer per year) or from one more engine call, named below.
 *
 * THE ONE CONSTRUCTED CASE is "what the mark-up adds". It is the difference between the line as
 * priced and the SAME line with the Commission's base value entered as a verified figure, so that
 * no mark-up is applied. The engine is asked for that second count directly; nothing is
 * multiplied here. It is a comparison, not advice: a real verified figure can be higher or lower
 * than the Commission's base value, and the card says so.
 *
 * NOTHING IS A FORECAST. A cost is drawn only at a price the Commission has published or at the
 * visitor's own. The visitor's price is theirs wherever it appears, starts empty, and is held by
 * the caller in memory only.
 */
import Decimal from 'decimal.js';
import {
  estimateFromPack, lookupIndirectFactorFromPack, routesFor, selectFactorFromPack,
  type EstimatorInput, type EstimatorPack,
} from './cbam-algos/estimator/estimate-from-pack.ts';
import {
  assumedCost, benchmarkScope, formatDecimal, formatPackDate, parseAssumedPrice, splitBetween,
  type Outlook, type OutlookFigureYear, type OutlookSplit,
} from './cbam-outlook.ts';

const D = Decimal.clone({ precision: 60 });

/* ── the model ─────────────────────────────────────────────────────────────── */

export interface GraphYear {
  year: number;
  certificates: string;
  embeddedTco2e: string;
  allocationTco2e: string;
  /** The engine's cost, where a price is published for THIS year's date's quarter. Null otherwise. */
  costEur: string | null;
  priceEur: string | null;
  /** The quarter this year's date falls in: the engine's price lookup key, e.g. '2026-Q4'. */
  priceQuarter: string;
  /** The mark-up on whichever default this line rests on; null when no default is used. */
  markupPct: string | null;
  /** The same line with the default's base value entered as verified: the engine's own count. */
  certificatesAtBase: string;
  /** certificates − certificatesAtBase. Zero when no mark-up is applied. */
  markupAdds: string;
  /** certificates ÷ emissions counted, as a percentage; null when no emissions are counted. */
  chargedPct: string | null;
  /** certificates − the previous year's; null in the first year. */
  stepRise: string | null;
  riseOnFirstPct: string | null;
}

export interface GraphsModel {
  massT: string;
  packDate: string;
  /** The day the price source was last read; what every "none published · as at" is dated by. */
  priceAsAt: string;
  years: GraphYear[];
  /** True when any part of the line rests on a default value, so a mark-up is applied. */
  usesDefault: boolean;
  split: { rise: string; markup: string; factor: string; benchmark: string; markupSharePct: string } | null;
  /**
   * The split of the change from the first year to EACH year, by the outlook's own rule
   * (splitBetween): null for the first year, and null where the parts would not sum to the
   * change. What the "why it rises" graph draws, year by year.
   */
  causes: (OutlookSplit | null)[];
  /** What the emissions part is: the mark-up on default values, on the electricity default, or none. */
  emissionsCause: OutlookSplit['emissionsCause'];
  /** "for route (C)", or "for this good" when its benchmark has no route: the strip's own words. */
  benchmarkScope: string;
}

/** Why there is nothing to draw, for the one sentence shown in the cards' place. */
export type GraphsRefusal = 'no-estimate' | 'some-years-refused';

const figures = (view: Outlook): OutlookFigureYear[] =>
  view.years.filter((y): y is OutlookFigureYear => y.kind === 'figure');

/**
 * The line with every default it rests on replaced by that default's BASE value, entered as a
 * verified figure. One engine call. Returns the line's own count when no default is in use, so a
 * fully verified line reports that the mark-up adds nothing without a call that would only
 * reprice it.
 */
function certificatesAtBase(pack: EstimatorPack, input: EstimatorInput, y: OutlookFigureYear): string {
  if (y.directMarkupPct === null && y.indirectMarkupPct === null) return y.certificates;
  const yearInput: EstimatorInput = { ...input, date: y.date };
  const direct = y.directMarkupPct !== null ? selectFactorFromPack(pack, yearInput) : null;
  const directPerT = direct ? direct.cell.baseIntensity : input.verified?.directTco2ePerT;
  if (directPerT === undefined) return y.certificates;
  const verified: NonNullable<EstimatorInput['verified']> = { directTco2ePerT: directPerT };
  if (y.indirectMarkupPct !== null) {
    const indirect = lookupIndirectFactorFromPack(pack, yearInput);
    if (indirect.kind === 'found') verified.indirectTco2ePerT = indirect.factor.cell.baseIntensity;
  } else if (input.verified?.indirectTco2ePerT) {
    verified.indirectTco2ePerT = input.verified.indirectTco2ePerT;
  }
  const e = estimateFromPack(pack, { ...yearInput, verified });
  if (e.status === 'unavailable') return y.certificates;
  return (e.status === 'cscf_pending' ? e.scenario : e.figure).certificates;
}

/**
 * The model the cards draw, or the reason there is none. Null when there is no outlook at all
 * (an idle form, an unreadable date, a year the data does not cover): then nothing is shown.
 */
export function graphsModel(
  pack: EstimatorPack, input: EstimatorInput, view: Outlook | null,
): GraphsModel | GraphsRefusal | null {
  if (!view) return null;
  const F = figures(view);
  if (F.length === 0) return 'no-estimate';
  if (F.length !== view.years.length) return 'some-years-refused';

  const years: GraphYear[] = F.map((y, i) => {
    const base = certificatesAtBase(pack, input, y);
    const embedded = new D(y.embeddedTco2e);
    return {
      year: y.year,
      certificates: y.certificates,
      embeddedTco2e: y.embeddedTco2e,
      allocationTco2e: y.allocationTco2e,
      costEur: y.costEur,
      priceEur: y.price.priceEur,
      priceQuarter: y.price.quarter,
      markupPct: y.directMarkupPct ?? y.indirectMarkupPct,
      certificatesAtBase: base,
      markupAdds: new D(y.certificates).minus(base).toFixed(),
      chargedPct: embedded.isZero() ? null : new D(y.certificates).dividedBy(embedded).times(100).toFixed(6),
      stepRise: i ? new D(y.certificates).minus(F[i - 1].certificates).toFixed() : null,
      riseOnFirstPct: y.riseOnFirstPct,
    };
  });

  const s = view.split;
  const causes = F.map((y, i) => (i === 0 ? null : splitBetween(F[0], y)));
  const tier = F[0].tier;
  return {
    massT: input.massT,
    packDate: view.packDate,
    priceAsAt: view.priceAsAt,
    years,
    usesDefault: F.some((y) => y.directMarkupPct !== null || y.indirectMarkupPct !== null),
    // A rise of zero has no shares to speak of, so it is treated like a withheld split.
    split: s && !new D(s.rise).isZero() ? {
      rise: s.rise, markup: s.moreEmissions, factor: s.factorPart, benchmark: s.benchmarkPart,
      markupSharePct: new D(s.moreEmissions).dividedBy(s.rise).times(100).toFixed(6),
    } : null,
    causes,
    emissionsCause: tier === 'default+markup' ? 'markup-default'
      : tier === 'verified-direct+default-indirect' ? 'markup-electricity' : 'none',
    benchmarkScope: benchmarkScope(F[0]),
  };
}

/* ── words ─────────────────────────────────────────────────────────────────── */

const esc = (s: string): string => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const n1 = (v: string): string => formatDecimal(v, 1, true);
const n3 = (v: string): string => formatDecimal(v, 3, false);
const eur = (v: string): string => `€${formatDecimal(v, 2, true)}`;
const eur0 = (v: string): string => `€${formatDecimal(v, 0, true)}`;
const price = (v: string): string => `€${formatDecimal(v, 2, new D(v).decimalPlaces() > 0)}`;
const pct1 = (v: string): string => `${formatDecimal(v, 1, true)}%`;
const listOf = (items: string[], last: 'or' | 'and'): string =>
  (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`);
/**
 * A percentage to one decimal that never rounds a real amount away: something above zero that
 * would print as "0.0%" prints as "under 0.1%", and something short of the whole that would
 * print as "100.0%" prints as "over 99.9%". Exactly zero and exactly one hundred print as such.
 */
export function pctHonest(v: string): string {
  const d = new D(v), shown = d.toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  if (!d.isZero() && shown.isZero()) return 'under 0.1%';
  if (!d.equals(100) && shown.equals(100)) return 'over 99.9%';
  return pct1(v);
}
/** A count to one decimal, with the same rule: a real amount is never printed as "0.0". */
const n1Honest = (v: string): string => {
  const d = new D(v);
  return !d.isZero() && d.abs().toDecimalPlaces(1, Decimal.ROUND_HALF_UP).isZero() ? 'under 0.1' : n1(v);
};
/** A signed table figure: "+12.3", and a plain "0" for nothing, never "+0". */
const plus = (v: string): string => (new D(v).isZero() ? '0' : `${new D(v).isNegative() ? '' : '+'}${n3(v)}`);
/** 100 cells for a share: whole cells, half up on the decimal, held inside 0 to 100. */
export function chargedCells(chargedPct: string): number {
  const n = new D(chargedPct).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return Math.max(0, Math.min(100, n));
}

/**
 * THE SENTENCE IS THE TITLE, SO IT IS BUILT FROM THE SAME NUMBERS THE CHART DRAWS and from
 * nothing else. Each builder returns plain text with <b> around its figure. They are separate
 * functions so the tests can hand them the edge cases a real line seldom produces: no change, a
 * fall, a rise that rounds to nothing.
 */
export function sentenceShare(m: GraphsModel): string {
  const last = m.years[m.years.length - 1].year;
  if (!m.split) return `The change to ${last} is not divided into causes for this line.`;
  if (!m.usesDefault || new D(m.split.markup).isZero()) {
    return `of the rise to ${last} is mark-up. ${m.usesDefault ? 'The mark-up on this line does not change.' : 'These are your verified figures, so none is applied.'}`;
  }
  return `of the rise to ${last} is the mark-up on default values. It no longer applies with verified data.`;
}

export function sentenceMarkup(m: GraphsModel): string {
  const last = m.years[m.years.length - 1];
  if (!m.usesDefault) return 'No mark-up is applied to this line: the figures are your own verified ones.';
  if (new D(last.markupAdds).isZero()) return `The mark-up adds <b>no</b> certificates to this line in ${last.year}.`;
  return `On default values the mark-up adds <b>${n1Honest(last.markupAdds)}</b> certificates in ${last.year}. It no longer applies with verified data.`;
}

/**
 * What kind of year this is, DECIDED FROM THE TRUE FIGURES and from nothing rounded.
 *
 * The grid rounds a share to whole cells, and a sentence chosen from the cells said "no
 * certificates are due" of a line that owed 0.546 of one: 0.4% of the emissions rounds to no
 * cell. So "none" means the certificate count is exactly zero, and "all" means exactly the
 * whole of the emissions counted. Everything between is "some", however the cells round.
 */
export function chargedKind(y: GraphYear): 'no-emissions' | 'none' | 'all' | 'some' {
  const certificates = new D(y.certificates), embedded = new D(y.embeddedTco2e);
  if (embedded.isZero() || y.chargedPct === null) return 'no-emissions';
  if (certificates.isZero()) return 'none';
  if (certificates.equals(embedded)) return 'all';
  return 'some';
}

export function sentenceCharged(m: GraphsModel, yearIndex: number): string {
  const y = m.years[Math.max(0, Math.min(m.years.length - 1, yearIndex))];
  const kind = chargedKind(y);
  if (kind === 'no-emissions' || y.chargedPct === null) return `No emissions are counted on this line in ${y.year}.`;
  if (kind === 'none') return `In ${y.year}, free allocation covers <b>all</b> of the emissions counted. No certificates are due.`;
  if (kind === 'all') return `In ${y.year}, certificates cover <b>all</b> of the emissions counted.`;
  const k = chargedCells(y.chargedPct);
  // Certificates are due but round to no cell, or free allocation applies but rounds to none:
  // the grid cannot show it, so the sentence says it, with the share itself.
  if (k === 0) return `In ${y.year}, certificates cover <b>under 1 of every 100</b> tonnes of emissions counted (${pctHonest(y.chargedPct)}). Free allocation covers the rest.`;
  if (k === 100) return `In ${y.year}, certificates cover <b>almost all</b> of the emissions counted (${pctHonest(y.chargedPct)}). Free allocation covers the rest.`;
  return `In ${y.year}, certificates cover <b>${k} of every 100</b> tonnes of emissions counted. Free allocation covers the other ${100 - k}.`;
}

/**
 * The visitor's prices, in order. Zero, one or two of them.
 *
 * THE SECOND PRICE DOES NOTHING WITHOUT THE FIRST. The first is the strip's own box, and the
 * strip draws only that one. A second price on its own would put costs on this card that the
 * strip above does not show, and the two would be describing different assumptions.
 */
export function assumedRange(priceText: string, secondText: string): string[] {
  const first = parseAssumedPrice(priceText);
  if (first === null) return [];
  const second = parseAssumedPrice(secondText);
  if (second === null || new D(second).equals(first)) return [first];
  return [first, second].sort((a, b) => new D(a).cmp(b));
}

/** The quarters, one per year, for which no price is published for this shipment's date. */
const unpricedQuarters = (m: GraphsModel): string[] => m.years.filter((y) => y.costEur === null).map((y) => y.priceQuarter);

export function sentenceCost(m: GraphsModel, prices: string[]): string {
  const last = m.years[m.years.length - 1];
  const unpriced = unpricedQuarters(m);
  // ABOUT THE SHIPMENT'S OWN QUARTER, never "for 2026": a November shipment has no published
  // price while two other 2026 quarters do, and "none is published for 2026" would be false.
  const none = unpriced.length ? `no price is published for imports in ${listOf(unpriced, 'or')}` : 'every year here has a published price';
  if (prices.length === 0) {
    return unpriced.length
      ? `No certificate price is published for imports in ${listOf(unpriced, 'or')}. Type your own price in Three years to see a cost.`
      : 'A certificate price is published for every year shown.';
  }
  if (prices.length === 1) {
    return `At your own <b>${price(prices[0])}</b> a certificate, ${last.year} comes to ${eur0(assumedCost(last.certificates, prices[0]))}. That price is yours: ${none}.`;
  }
  return `At your own <b>${price(prices[0])} to ${price(prices[1])}</b> a certificate, ${last.year} comes to ${eur0(assumedCost(last.certificates, prices[0]))} to ${eur0(assumedCost(last.certificates, prices[1]))}. That range is yours: ${none}.`;
}

/* ── drawing ───────────────────────────────────────────────────────────────── */

/** A linear scale from zero. Zero-based always: a length on these charts is a quantity. */
export function scaleFromZero(max: number, pixels: number): (value: number) => number {
  const top = max > 0 ? max : 1;
  return (value) => (value / top) * pixels;
}

/** A mark a pointer or the keyboard can stop on. `tip` is plain text; newlines separate its lines. */
const mark = (tip: string, value: string, inner: string, extra = ''): string =>
  `<g class="cg-m" tabindex="0" role="img" aria-label="${esc(tip.replace(/\n/g, '. '))}" data-tip="${esc(tip)}" data-v="${esc(value)}" ${extra}>${inner}</g>`;

interface Plot { h: number; svg: string; alt: string }
const wrap = (w: number, p: Plot): string =>
  `<svg viewBox="0 0 ${w} ${p.h}" width="${w}" height="${p.h}" role="group" aria-label="${esc(p.alt)}">${p.svg}</svg>`;

export const chargedTip = (y: GraphYear): string => (y.chargedPct === null
  ? `${y.year}: no emissions counted`
  : `${y.year}: certificates ${pctHonest(y.chargedPct)} of emissions counted (${n3(y.certificates)} certificates)\nfree allocation covers the rest`);

/** Cost at the visitor's own price: one row per year on a shared euro scale. Square marks only. */
export function plotCost(m: GraphsModel, w: number, prices: string[]): Plot {
  const Y = m.years, asAt = `as at ${formatPackDate(m.priceAsAt)}`;
  const narrow = w < 300, rowH = 74, L = narrow ? 46 : 98, R = 10, top = 14, h = top + rowH * Y.length + 8;
  const lo = prices[0] ?? null, hi = prices.length > 1 ? prices[1] : null;
  const values = [...Y.filter((y) => y.costEur !== null).map((y) => Number(y.costEur)), ...Y.flatMap((y) => prices.map((p) => Number(assumedCost(y.certificates, p))))];
  const sx0 = scaleFromZero(Math.max(1, ...values) * 1.16, w - L - R);
  const sx = (v: string): number => L + sx0(Number(v));
  let s = '';
  Y.forEach((y, i) => {
    const cy = top + rowH * i + rowH / 2, open = y.costEur === null;
    s += `<text class="cg-lab" x="0" y="${cy + 4}" font-size="11">${y.year}</text>
      ${narrow ? '' : `<text class="cg-faint" x="0" y="${cy + 20}" font-size="9">${open ? 'none published' : 'published price'}</text>`}
      <line class="cg-hair" x1="${L}" x2="${w - R}" y1="${cy + 0.5}" y2="${cy + 0.5}"/>`;
    // THE PUBLISHED PRICE FOR THIS YEAR'S OWN QUARTER, and no other. A price published for
    // another quarter is not this shipment's cost and is not drawn as one.
    if (y.costEur !== null && y.priceEur !== null) {
      const px = sx(y.costEur);
      s += mark(`Imports in ${y.priceQuarter}: published ${price(y.priceEur)}\n${eur(y.costEur)} for this shipment`, y.costEur,
        `<rect x="${px - 1.5}" y="${cy - 10}" width="3" height="20" fill="var(--cg-ink)" data-x="${px.toFixed(3)}"/><rect x="${px - 9}" y="${cy - 14}" width="18" height="28" fill="transparent"/>`, 'data-cg="published"');
      if (lo === null) s += `<text class="cg-num" x="${px - 8}" y="${cy - 13}" text-anchor="end" font-size="11">${eur0(y.costEur)}</text>`;
    }
    if (lo === null) return;
    const cLo = assumedCost(y.certificates, lo), cHi = hi === null ? cLo : assumedCost(y.certificates, hi);
    const xLo = sx(cLo), xHi = sx(cHi);
    const tip = `${y.year}: your ${price(lo)}${hi === null ? '' : ` to ${price(hi)}`}\n${eur(cLo)}${hi === null ? '' : ` to ${eur(cHi)}`}\nyour assumption, not a published price${open ? `\nno price published for imports in ${y.priceQuarter}, ${asAt}` : ''}`;
    s += mark(tip, hi === null ? cLo : `${cLo}|${cHi}`, `
      <rect x="${hi === null ? xLo - 1.5 : xLo}" y="${cy - (hi === null ? 9 : 5)}" width="${hi === null ? 3 : Math.max(2, xHi - xLo)}" height="${hi === null ? 18 : 10}" fill="var(--cg-markup)" fill-opacity="${open && hi !== null ? 0 : hi === null ? 1 : 0.3}" stroke="var(--cg-markup)" stroke-width="1.5" ${open ? 'stroke-dasharray="3 4"' : ''} data-xlo="${xLo.toFixed(3)}" data-xhi="${xHi.toFixed(3)}"/>
      <rect x="${L}" y="${cy - rowH / 2}" width="${w - L - R}" height="${rowH}" fill="transparent"/>`);
    if (hi === null) {
      s += `<text class="cg-num" x="${xLo}" y="${cy - 15}" text-anchor="${xLo > w - 70 ? 'end' : 'middle'}" font-size="11">${eur0(cLo)}</text>`;
    } else {
      s += `<text class="cg-num" x="${xHi}" y="${cy - 13}" text-anchor="end" font-size="11">${eur0(cHi)}</text>
        <text class="cg-num" x="${xLo}" y="${cy + 22}" font-size="11">${eur0(cLo)}</text>`;
    }
  });
  return { h, svg: s, alt: prices.length ? 'Cost at your own price for each year.' : 'Published cost where one applies; no price of your own is entered.' };
}

/* ── how fast free allocation goes ─────────────────────────────────────────── */

export interface PhaseModel { rows: { year: number; factor: string; computable: boolean; locator: string }[] }

/** The legislated schedule from the pack; a year is "computable" when this line has a figure for it. */
export function phaseModel(pack: EstimatorPack, m: GraphsModel): PhaseModel {
  const computable = new Set(m.years.map((y) => y.year));
  return { rows: [...pack.cbamFactors].sort((a, b) => a.year - b.year)
    .map((r) => ({ year: r.year, factor: r.factor, computable: computable.has(r.year), locator: r.sourceLocator })) };
}

const sharePct = (f: string): string => `${formatDecimal(new D(f).times(100).toFixed(), 3, false)}%`;

/** Decided from the schedule: where it ends, and the largest single drop (the earlier on a tie). */
export function sentencePhase(phase: PhaseModel): string {
  const R = phase.rows;
  if (R.length < 2) return 'The share of free allocation retained is published for one year only.';
  const zero = R.find((r) => new D(r.factor).isZero());
  let steep = R[1], drop = new D(R[0].factor).minus(R[1].factor);
  for (let i = 2; i < R.length; i += 1) {
    const d = new D(R[i - 1].factor).minus(R[i].factor);
    if (d.greaterThan(drop)) { drop = d; steep = R[i]; }
  }
  const end = zero ? `<b>zero in ${zero.year}</b>` : `<b>${sharePct(R[R.length - 1].factor)} by ${R[R.length - 1].year}</b>`;
  return `Free allocation retained falls to ${end}. The steepest single step is ${steep.year}.`;
}

/* ── origins ───────────────────────────────────────────────────────────────── */

/**
 * WHEN THE ORIGINS ARE NOT DRAWN. A ranked row of stems says "these differ, and the differences
 * matter". That is false only when the whole range, over ALL the origins, is under a tenth of the
 * highest figure (ORIGINS_FLAT_SHARE); then the origins are said in words, as "little difference".
 *
 * WHEN HALF OR MORE SHARE ONE FIGURE (ORIGINS_SAME_SHARE), the sentence says so, and "the others"
 * are only the origins OFF that figure, with their own lowest and highest. That says nothing about
 * how much the origin matters: aluminous cement has 95 of 101 origins at 153.4, and the six others
 * run from 143.5 to 182.0, a 21% spread, so it is drawn, with the shared figure marked.
 */
export const ORIGINS_FLAT_SHARE = '0.1';
export const ORIGINS_SAME_SHARE = '0.5';

export interface OriginsModel {
  year: number;
  rows: { country: string; name: string; certificates: string }[];
  ownCountry: string;
  usesVerified: boolean;
  kind: 'chart' | 'flat' | 'few';
  /** The figure most origins share, and how many share it (exact equality). */
  mode: { certificates: string; count: number };
  /** Half or more, but not all, carry the mode: the sentence names it and the chart marks it. */
  shared: boolean;
}

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl
  ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const originName = (c: string): string => (c === 'OTHER' ? 'other origins' : (regionNames?.of(c) ?? c));

/**
 * The visitor's good and route on DEFAULT VALUES for every origin the pack publishes one for.
 * One engine call per origin, so the page computes it after the other cards are drawn, a few
 * origins at a time (originCountries, originRow, originsFrom); originsModel is all three at
 * once. Null when the line has no route offered for its year.
 */
export function originsModel(pack: EstimatorPack, input: EstimatorInput): OriginsModel | null {
  const rows = originCountries(pack, input).map((c) => originRow(pack, input, c)).filter((r): r is OriginRow => r !== null);
  return originsFrom(input, rows);
}

/**
 * WHAT A COMPUTED ORIGINS CARD MAY BE REUSED FOR: the whole input it was computed from, every
 * field, not a list of the fields thought to matter (a list once left out the mass, and the card
 * kept 100 t figures for a 250 t line). The pack is the other input; the caller keys on it by
 * identity. Fields in another order only miss the cache, which is safe.
 */
export const originsKey = (input: EstimatorInput): string => JSON.stringify(input);

type OriginRow = OriginsModel['rows'][number];
/** The countries to try: the pack's published sheets and OTHER; none when the year cannot be read. */
export const originCountries = (pack: EstimatorPack, input: EstimatorInput): string[] =>
  (Number.isInteger(Number(input.date.slice(0, 4))) ? [...pack.publishedOriginSheets, 'OTHER'] : []);

/** One origin's default-value count for the line, or null when it does not offer the route. */
export function originRow(pack: EstimatorPack, input: EstimatorInput, country: string): OriginRow | null {
  if (!routesFor(pack, input.cn, country, Number(input.date.slice(0, 4))).includes(input.route)) return null;
  const e = estimateFromPack(pack, { ...input, country, verified: undefined });
  if (e.status === 'unavailable') return null;
  return { country, name: originName(country), certificates: (e.status === 'cscf_pending' ? e.scenario : e.figure).certificates };
}

/** The model from the computed rows, in any order. */
export function originsFrom(input: EstimatorInput, computed: OriginRow[]): OriginsModel | null {
  if (!computed.length) return null;
  const year = Number(input.date.slice(0, 4));
  const rows = [...computed];
  rows.sort((a, b) => new D(a.certificates).cmp(b.certificates) || a.name.localeCompare(b.name));
  const min = new D(rows[0].certificates), max = new D(rows[rows.length - 1].certificates);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(new D(r.certificates).toFixed(), (counts.get(new D(r.certificates).toFixed()) ?? 0) + 1);
  const [modeValue, modeCount] = [...counts].reduce((a, b) => (b[1] > a[1] ? b : a));
  const flat = max.isZero() || max.minus(min).div(max).lessThan(ORIGINS_FLAT_SHARE);
  const kind = rows.length < 3 ? 'few' : flat ? 'flat' : 'chart';
  const shared = modeCount < rows.length && new D(modeCount).div(rows.length).greaterThanOrEqualTo(ORIGINS_SAME_SHARE);
  return { year, rows, ownCountry: input.country, usesVerified: !!input.verified, kind, mode: { certificates: modeValue, count: modeCount }, shared };
}

/** Decided from the rows: the extremes by exact comparison, the visitor's origin by its own row. */
export function sentenceOrigins(o: OriginsModel): string {
  const first = o.rows[0], last = o.rows[o.rows.length - 1];
  if (o.kind === 'few') {
    return o.rows.length === 1
      ? `On default values only one origin is published for this good and route: ${esc(first.name)}, ${n1(first.certificates)} certificates in ${o.year}.`
      : `On default values only ${o.rows.length} origins are published for this good and route: ${o.rows.map((r) => `${esc(r.name)} ${n1(r.certificates)}`).join(', ')} certificates in ${o.year}.`;
  }
  const own = o.rows.find((r) => r.country === o.ownCountry);
  const ownText = own ? ` ${esc(own.name)} is at ${n1(own.certificates)}.` : '';
  if (o.kind === 'flat' && o.mode.count === o.rows.length) {
    return `On default values the origin makes no difference for this good: all ${o.rows.length} origins carry the same figure, ${n1(first.certificates)} certificates in ${o.year}.`;
  }
  if (o.shared) {
    const b = (t: string): string => (o.kind === 'chart' ? `<b>${t}</b>` : t);
    const sharedText = `${b(`${o.mode.count} of ${o.rows.length}`)} origins carry the same figure${o.kind === 'chart' ? ' for this good' : ''}, ${n1(o.mode.certificates)} certificates in ${o.year}; ${othersText(o, b)}.`;
    return o.kind === 'flat'
      ? `On default values the origin makes little difference for this good: ${sharedText}`
      : `On default values, ${sharedText}${ownText}`;
  }
  if (o.kind === 'flat') {
    return `On default values the origin makes little difference for this good: ${o.rows.length} origins run from ${n1(first.certificates)} (${esc(first.name)}) to ${n1(last.certificates)} (${esc(last.name)}) certificates in ${o.year}.`;
  }
  return `On default values, ${o.year} certificates for this good run from <b>${n1(first.certificates)}</b> (${esc(first.name)}) to <b>${n1(last.certificates)}</b> (${esc(last.name)}).${ownText}`;
}

/** The origins OFF the shared figure, with their own lowest and highest. Rows are sorted. */
const offShared = (o: OriginsModel): OriginsModel['rows'] => o.rows.filter((r) => !new D(r.certificates).equals(o.mode.certificates));
function othersText(o: OriginsModel, b: (t: string) => string): string {
  const others = offShared(o), lo = others[0], hi = others[others.length - 1];
  if (others.length === 1) return `the other, ${esc(lo.name)}, is at ${b(n1(lo.certificates))}`;
  if (new D(lo.certificates).equals(hi.certificates)) return `the other ${others.length} are at ${b(n1(lo.certificates))}`;
  return `the other ${others.length} run from ${b(n1(lo.certificates))} (${esc(lo.name)}) to ${b(n1(hi.certificates))} (${esc(hi.name)})`;
}

/* ── tables ────────────────────────────────────────────────────────────────── */

interface Table { head: string[]; rows: (string | number)[][]; caption?: string }
const table = (t: Table): string => `<table>
  <thead><tr>${t.head.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead>
  <tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}</tbody>
  ${t.caption ? `<caption>${t.caption}</caption>` : ''}</table>`;

export function tableCost(m: GraphsModel, prices: string[]): Table {
  return {
    head: ['Year', 'Imports in', ...prices.map((p) => `At your ${price(p)}`), 'Published'],
    rows: m.years.map((y) => [y.year, y.priceQuarter, ...prices.map((p) => eur(assumedCost(y.certificates, p))),
      y.costEur !== null && y.priceEur !== null ? `${eur(y.costEur)} at ${price(y.priceEur)}` : 'none published']),
  };
}

/** The charged card's table: its last column uses the same honest percentage as the legend. */
export function tableCharged(m: GraphsModel): Table {
  return { head: ['Year', 'Emissions counted', 'Free allocation', 'Certificates', 'Charged'],
    rows: m.years.map((y) => [y.year, n3(y.embeddedTco2e), n3(y.allocationTco2e), n3(y.certificates), y.chargedPct === null ? '—' : pctHonest(y.chargedPct)]),
    caption: 'tCO₂e and certificates.' };
}

/* ── the section ───────────────────────────────────────────────────────────── */

export interface GraphsState {
  /** Which year the waffle shows; null means the last. */
  chargedYear: number | null;
  /** The price typed in the strip's box, and the optional second price typed here. */
  priceText: string;
  secondText: string;
  /** Which cards have their table open. */
  open: Record<string, boolean>;
}

const legendDot = (kind: 'fill' | 'ring'): string => (kind === 'fill'
  ? '<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="var(--cg-accent)"/></svg>'
  : '<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="3.8" fill="none" stroke="var(--cg-neutral)" stroke-width="1.5"/></svg>');

/**
 * The second price box is usable only once the first price exists. Until then it is disabled
 * and says why, so it can never draw a cost the strip above does not show.
 */
export const secondUsable = (state: GraphsState): boolean => parseAssumedPrice(state.priceText) !== null;
export const secondNote = (state: GraphsState): string => (secondUsable(state)
  ? '€ per certificate. Your first price is the one in Three years.'
  : 'Type your first price in Three years. This one then makes a range.');

/** The cost card's changing parts, for the page to refill while a price is being typed. */
export function costParts(m: GraphsModel, w: number, state: GraphsState): { title: string; plot: string; table: string } {
  const prices = assumedRange(state.priceText, state.secondText);
  return { title: sentenceCost(m, prices), plot: wrap(w, plotCost(m, w, prices)), table: table(tableCost(m, prices)) };
}

/** The waffle card's changing parts, for a year switch. */
export function chargedLegend(m: GraphsModel, yearIndex: number): string {
  const y = m.years[yearIndex];
  const charged = y.chargedPct === null ? null : new D(y.chargedPct);
  return `<span>${legendDot('fill')}Certificates to surrender <b>${charged ? pctHonest(charged.toFixed()) : '—'}</b></span>
    <span>${legendDot('ring')}Free allocation <b>${charged ? pctHonest(D.max(0, new D(100).minus(charged)).toFixed()) : '—'}</b></span>`;
}

/* ── shared with cbam-ui/tiles-why.ts, so the tiles format and table every figure the same way ── */
export type { Plot, Table };
export { esc, listOf, n1, n3, offShared, pct1, plus, sharePct, table as renderTable, unpricedQuarters };
