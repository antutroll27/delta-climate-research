/**
 * The graphs under the three-year strip: the previewed line, drawn.
 *
 * This file is OURS (like cbam-outlook.ts). No DOM: `graphsModel` is a pure function of the pack,
 * the line and its outlook, and every renderer returns a string, so all of it runs under
 * node:test against the real pack.
 *
 * WHAT IT ADDS TO THE STRIP, AND WHAT IT DOES NOT REPEAT. The strip above states the three
 * counts and the split as figures. These five cards draw them, and add two things the strip does
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
/** The mass as a number, through the same formatter as every other figure ("1e2" is 100). */
const massText = (massT: string): string => {
  try { return `${formatDecimal(new D(massT).toFixed(), 3, false)} t`; } catch { return `${esc(massT)} t`; }
};
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
export function sentenceSteps(m: GraphsModel): string {
  const first = m.years[0];
  const last = m.years[m.years.length - 1];
  const diff = new D(last.certificates).minus(first.certificates);
  const mass = massText(m.massT);
  if (diff.isZero()) return `The same ${mass} needs <b>the same</b> certificates in ${last.year} as in ${first.year}.`;
  const word = diff.isNegative() ? 'fewer' : 'more';
  if (last.riseOnFirstPct === null) {
    // The first year's count is zero, so there is no percentage to give.
    return `The same ${mass} needs <b>${n1(diff.abs().toFixed())} ${word}</b> certificates in ${last.year} than in ${first.year}.`;
  }
  const shown = new D(last.riseOnFirstPct).abs().toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  // A change too small to show at one decimal place is said in certificates, not as "0.0%".
  if (shown.isZero()) return `The same ${mass} needs <b>${n3(diff.abs().toFixed())} ${word}</b> certificates in ${last.year} than in ${first.year}.`;
  return `The same ${mass} needs <b>${formatDecimal(shown.toFixed(), 1, true)}% ${word}</b> certificates in ${last.year} than in ${first.year}.`;
}

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
      ? `No certificate price is published for imports in ${listOf(unpriced, 'or')}. Type your own price above to see a cost.`
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

/** Certificates by year: one thin stepped line. Square corners and flat ends only. */
export function plotSteps(m: GraphsModel, w: number): Plot {
  const Y = m.years, asAt = `as at ${formatPackDate(m.priceAsAt)}`;
  const h = 292, top = 40, base = 206, col = w / Y.length;
  const sy = scaleFromZero(Math.max(...Y.map((y) => Number(y.certificates))) * 1.02, base - top);
  const yOf = (v: string): number => base - sy(Number(v));
  const inset = Math.min(22, col * 0.16), narrow = w < 400;
  let s = `<line class="cg-hair" x1="0" x2="${w}" y1="${base + 0.5}" y2="${base + 0.5}"/>`;
  Y.forEach((_, i) => { if (i) s += `<line class="cg-hair" x1="${col * i + 0.5}" x2="${col * i + 0.5}" y1="${top - 10}" y2="${base}"/>`; });
  let d = '';
  Y.forEach((y, i) => {
    const yy = yOf(y.certificates);
    d += `${i ? 'L' : 'M'}${i ? col * i : inset},${yy}L${i === Y.length - 1 ? w - inset : col * (i + 1)},${yy}`;
  });
  s += `<path d="${d}" fill="none" stroke="var(--cg-ink)" stroke-width="2" stroke-linejoin="miter" stroke-linecap="butt"/>`;
  const last = Y[Y.length - 1];
  s += `<rect x="${w - inset - 4}" y="${yOf(last.certificates) - 4}" width="8" height="8" fill="var(--cg-accent)"/>`;
  Y.forEach((y, i) => {
    const cx = col * i + col / 2, yy = yOf(y.certificates);
    const tip = `${y.year}: ${n3(y.certificates)} certificates\n${y.costEur !== null && y.priceEur !== null
      ? `${eur(y.costEur)} at the published ${price(y.priceEur)} for imports in ${y.priceQuarter}` : `no price published for imports in ${y.priceQuarter}, ${asAt}`}`;
    s += mark(tip, y.certificates, `<rect x="${cx - col / 2}" y="${top - 30}" width="${col}" height="${base - top + 30}" fill="transparent" data-h="${(base - yy).toFixed(3)}"/>`);
    s += `<text class="cg-num" x="${cx}" y="${yy - 13}" text-anchor="middle" font-size="${w < 360 ? 16 : 19}">${n1(y.certificates)}</text>`;
    if (y.stepRise !== null && !new D(y.stepRise).isZero()) {
      const prev = yOf(Y[i - 1].certificates);
      s += `<text class="cg-faint" x="${col * i + 7}" y="${(prev + yy) / 2 + 18}" font-size="10.5">${new D(y.stepRise).isNegative() ? '' : '+'}${n1(y.stepRise)}</text>`;
    }
    s += `<text class="cg-lab" x="${cx}" y="${base + 22}" text-anchor="middle" font-size="11">${y.year}</text>`;
    const cw = Math.min(col - 6, 132), cy = base + 36;
    if (y.costEur !== null && y.priceEur !== null) {
      s += `<rect x="${cx - cw / 2}" y="${cy}" width="${cw}" height="40" rx="1" fill="var(--cg-well)"/>
        <text class="cg-num" x="${cx}" y="${cy + 17}" text-anchor="middle" font-size="${narrow ? 10.5 : 12}">${eur(y.costEur)}</text>
        <text class="cg-faint" x="${cx}" y="${cy + 31}" text-anchor="middle" font-size="9.5">published ${price(y.priceEur)}</text>`;
    } else {
      s += `<rect x="${cx - cw / 2 + 0.5}" y="${cy + 0.5}" width="${cw - 1}" height="39" rx="1" fill="none" stroke="var(--cg-faint)" stroke-width="1" stroke-dasharray="3 4"/>
        <text class="cg-num" x="${cx}" y="${cy + 17}" text-anchor="middle" font-size="${narrow ? 9.5 : 11}">none published</text>
        <text class="cg-faint" x="${cx}" y="${cy + 31}" text-anchor="middle" font-size="9.5">${narrow ? '' : 'for '}${y.priceQuarter} imports</text>`;
    }
  });
  return { h, svg: s, alt: `Certificates: ${Y.map((y) => `${y.year} ${n1(y.certificates)}`).join(', ')}.` };
}

/** The share of the rise that is mark-up: one restrained arc from 0 to 100%. */
export function plotShare(m: GraphsModel, w: number, uid: string): Plot {
  const h = 170, cx = w / 2, cy = 150, R = Math.min(118, Math.min(w, 300) / 2 - 14);
  const share = m.split ? Math.max(0, Math.min(1, Number(m.split.markupSharePct) / 100)) : 0;
  const pt = (t: number): [number, number] => [cx - R * Math.cos(Math.PI * t), cy - R * Math.sin(Math.PI * t)];
  const arc = (t0: number, t1: number): string => {
    const [x0, y0] = pt(t0), [x1, y1] = pt(t1);
    return `M${x0},${y0}A${R},${R} 0 0 1 ${x1},${y1}`;
  };
  let s = `<defs><linearGradient id="${uid}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--cg-allocation)"/><stop offset=".55" stop-color="var(--cg-markup)"/><stop offset="1" stop-color="var(--cg-warm)"/></linearGradient></defs>
    <path d="${arc(0, 1)}" fill="none" stroke="var(--cg-neutral-2)" stroke-width="2" stroke-linecap="round"/>`;
  if (m.split && share > 0) {
    const [mx, my] = pt(share);
    const [ox, oy] = [cx - (R + 16) * Math.cos(Math.PI * share), cy - (R + 16) * Math.sin(Math.PI * share)];
    s += `<path class="cg-halo" d="${arc(0, share)}" fill="none" stroke="url(#${uid})" stroke-width="30" stroke-linecap="round"/>`;
    s += mark(`${pct1(m.split.markupSharePct)} of the rise\n${n1(m.split.markup)} of ${n1(m.split.rise)} certificates`, m.split.markupSharePct,
      `<path d="${arc(0, share)}" fill="none" stroke="url(#${uid})" stroke-width="7" stroke-linecap="round" data-t="${share.toFixed(5)}"/><path d="${arc(0, 1)}" fill="none" stroke="transparent" stroke-width="40"/>`);
    s += `<line x1="${mx}" y1="${my}" x2="${ox}" y2="${oy}" stroke="var(--cg-ink)" stroke-width="1.5" stroke-dasharray="2 3"/>`;
  }
  s += `<text class="cg-lab" x="${cx - R}" y="${cy + 16}" text-anchor="middle" font-size="9.5">0</text>
    <text class="cg-lab" x="${cx + R}" y="${cy + 16}" text-anchor="middle" font-size="9.5">100%</text>`;
  return { h, svg: s, alt: m.split ? `${pct1(m.split.markupSharePct)} of the rise is mark-up.` : 'The change is not divided into causes.' };
}

/** What the mark-up adds: a capsule from the count at the base value up to the count as priced. */
export function plotMarkup(m: GraphsModel, w: number, uid: string): Plot {
  const Y = m.years, h = 340, top = 30, base = 290, col = w / Y.length, cw = Math.min(38, col * 0.34);
  const sy = scaleFromZero(Math.max(1e-9, ...Y.map((y) => Number(y.certificates))) * 1.04, base - top);
  const yOf = (v: string): number => base - sy(Number(v));
  let s = `<defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--cg-markup)"/><stop offset="1" stop-color="var(--cg-markup)" stop-opacity=".55"/></linearGradient></defs>
    <line class="cg-hair" x1="0" x2="${w}" y1="${base + 0.5}" y2="${base + 0.5}"/><text class="cg-faint" x="0" y="${base + 14}" font-size="9.5">0</text>`;
  Y.forEach((y, i) => {
    const cx = col * i + col / 2, y1 = yOf(y.certificates), y0 = yOf(y.certificatesAtBase);
    const adds = !new D(y.markupAdds).isZero();
    const tip = adds
      ? `${y.year}: mark-up ${y.markupPct ?? ''}% adds ${n3(y.markupAdds)}\nas priced: ${n3(y.certificates)}\nthe base value entered as verified: ${n3(y.certificatesAtBase)}`
      : `${y.year}: ${n3(y.certificates)} certificates\nno mark-up is applied`;
    s += `<line x1="${cx}" x2="${cx}" y1="${y0}" y2="${base}" stroke="var(--cg-neutral)" stroke-width="1.5"/>`;
    s += mark(tip, y.markupAdds, `${adds ? `
      <rect class="cg-halo" x="${cx - cw / 2}" y="${y1}" width="${cw}" height="${y0 - y1}" rx="${cw / 2}" fill="var(--cg-markup)"/>
      <rect x="${cx - cw / 2}" y="${y1}" width="${cw}" height="${y0 - y1}" rx="${Math.min(cw / 2, (y0 - y1) / 2)}" fill="url(#${uid})"/>` : ''}
      <circle cx="${cx}" cy="${y0}" r="4" fill="var(--cg-surface)" stroke="var(--cg-ink)" stroke-width="1.5"/>
      <rect x="${cx - col / 2}" y="${top - 20}" width="${col}" height="${base - top + 20}" fill="transparent" data-y1="${y1.toFixed(3)}" data-y0="${y0.toFixed(3)}"/>`);
    s += `<text class="cg-num" x="${cx}" y="${y1 - (adds ? 9 : 13)}" text-anchor="middle" font-size="12.5">${n1(y.certificates)}</text>`;
    if (adds) {
      s += `<text class="cg-faint" x="${cx + cw / 2 + 7}" y="${y0 + 4}" font-size="10.5">${n1(y.certificatesAtBase)}</text>`;
      s += `<text class="cg-num" x="${cx - cw / 2 - 7}" y="${(y0 + y1) / 2 + 4}" text-anchor="end" font-size="11">${new D(y.markupAdds).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).isZero() ? 'under 0.1' : `+${n1(y.markupAdds)}`}</text>`;
    }
    s += `<text class="cg-lab" x="${cx}" y="${base + 24}" text-anchor="middle" font-size="11">${y.year}</text>
      <text class="cg-faint" x="${cx}" y="${base + 40}" text-anchor="middle" font-size="9.5">${y.markupPct !== null ? `mark-up ${esc(y.markupPct)}%` : 'no mark-up'}</text>`;
  });
  return { h, svg: s, alt: `Mark-up adds ${Y.map((y) => `${n1(y.markupAdds)} in ${y.year}`).join(', ')} certificates.` };
}

/** How much of the emissions counted is charged: 100 cells per year, one layer per year. */
export function plotCharged(m: GraphsModel, w: number, yearIndex: number): Plot {
  const size = Math.min(w, 270), gap = size / 10, r = gap * 0.34, x0 = (w - size) / 2 + gap / 2, h = size + 6;
  const yi = Math.max(0, Math.min(m.years.length - 1, yearIndex));
  const cells = m.years.map((y) => (y.chargedPct === null ? 0 : chargedCells(y.chargedPct)));
  let s = '';
  for (let k = 0; k < 100; k += 1) {
    const x = x0 + (k % 10) * gap, yy = h - gap / 2 - Math.floor(k / 10) * gap - 3;
    s += m.years.map((_, j) => `<g class="cg-cell" data-year="${j}" style="opacity:${j === yi ? 1 : 0};transition-delay:${Math.floor(k / 10) * 18}ms">${k < cells[j]
      ? `<circle cx="${x}" cy="${yy}" r="${r}" fill="var(--cg-accent)"/>`
      : `<circle cx="${x}" cy="${yy}" r="${r - 0.8}" fill="none" stroke="var(--cg-neutral)" stroke-width="1.5"/>`}</g>`).join('');
  }
  const y = m.years[yi];
  s += mark(chargedTip(y), y.chargedPct ?? '', `<rect x="${x0 - gap / 2}" y="0" width="${size}" height="${h}" fill="transparent"/>`, `data-charged="${cells[yi]}" data-cg="charged-mark"`);
  return { h, svg: s, alt: `${cells[yi]} of 100 cells are certificates in ${y.year}.` };
}
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

/* ── why it rises ──────────────────────────────────────────────────────────── */

type CauseKey = 'markup' | 'factor' | 'benchmark';
const CAUSES: { key: CauseKey; cls: string }[] = [
  { key: 'markup', cls: 'cg-c1' }, { key: 'factor', cls: 'cg-c2' }, { key: 'benchmark', cls: 'cg-c3' },
];
const causePart = (sp: OutlookSplit, key: CauseKey): string =>
  (key === 'markup' ? sp.moreEmissions : key === 'factor' ? sp.factorPart : sp.benchmarkPart);
const causeWords = (m: GraphsModel, key: CauseKey): string => (key === 'markup'
  ? (m.emissionsCause === 'markup-electricity' ? "the mark-up on the Commission's default value for electricity" : 'the mark-up on default values')
  : key === 'factor' ? 'the smaller share of free allocation retained' : 'the lower benchmark');
const causeLabel = (m: GraphsModel, key: CauseKey): string => (key === 'markup'
  ? (m.emissionsCause === 'markup-electricity' ? 'Mark-up on the electricity default' : 'Mark-up on default values')
  : key === 'factor' ? 'Less free allocation retained' : 'Lower benchmark');

/**
 * Why the count rises, DECIDED FROM THE TRUE PARTS. The largest part is found by comparing exact
 * decimals, not the rounded figures printed beside them, and the benchmark is said not to change
 * only when its part is exactly zero.
 */
export function sentenceCascade(m: GraphsModel): string {
  const first = m.years[0], last = m.years[m.years.length - 1];
  const rise = new D(last.certificates).minus(first.certificates);
  if (rise.isZero()) {
    return `The count does not change between ${first.year} and ${last.year}${chargedKind(last) === 'none' ? ': free allocation covers all of the emissions counted' : ''}.`;
  }
  const sp = m.causes[m.causes.length - 1];
  if (!sp) return `The change to ${last.year} is not divided into causes for this line.`;
  const largest = CAUSES.map((c) => ({ ...c, part: new D(causePart(sp, c.key)) }))
    .reduce((a, b) => (b.part.greaterThan(a.part) ? b : a));
  const flat = new D(sp.benchmarkPart).isZero() ? ` The benchmark does not change ${m.benchmarkScope}.` : '';
  return `Of the <b>${n1Honest(sp.rise)}</b> extra certificates by ${last.year}, <b>${n1Honest(largest.part.toFixed())}</b> come from ${causeWords(m, largest.key)}.${flat}`;
}

/** Whole units that sum exactly to `total`: the largest-remainder method. */
function apportion(values: Decimal[], total: number): number[] {
  const sum = values.reduce((a, b) => a.plus(b), new D(0));
  if (sum.isZero() || total <= 0) return values.map(() => 0);
  const raw = values.map((v) => v.div(sum).times(total));
  const base = raw.map((r) => r.floor().toNumber());
  let left = total - base.reduce((a, b) => a + b, 0);
  raw.map((r, i) => ({ rem: r.minus(base[i]), i })).sort((a, b) => b.rem.cmp(a.rem) || a.i - b.i)
    .forEach(({ i }) => { if (left > 0) { base[i] += 1; left -= 1; } });
  return base;
}

/** A dot per cause, a different SHAPE as well as a different hue. Small points, not bodies. */
function causeDot(cls: string, x: number, y: number, r: number): string {
  if (cls === 'cg-c1') return `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--cg-markup)"/>`;
  if (cls === 'cg-c2') return `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--cg-allocation)"/><circle cx="${x}" cy="${y}" r="${r * 0.36}" fill="var(--cg-surface)"/>`;
  return `<circle cx="${x}" cy="${y}" r="${r - 0.9}" fill="none" stroke="var(--cg-benchmark)" stroke-width="1.8"/>`;
}

/** The dot unit: the smallest round number that keeps the tallest column within 52 dots. */
export function cascadeUnit(maxCertificates: number): number {
  return [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 100000, 1000000]
    .find((u) => maxCertificates / u <= 52) ?? 10000000;
}

export function plotCascade(m: GraphsModel, w: number): Plot {
  const Y = m.years, max = Math.max(...Y.map((y) => Number(y.certificates)));
  const unit = cascadeUnit(max), per = 4, gap = w < 420 ? 13 : 17, r = gap * 0.36;
  const base0 = Math.round(Number(Y[0].certificates) / unit);
  const cols = Y.map((y, i) => {
    const total = Math.round(Number(y.certificates) / unit), sp = m.causes[i];
    if (i === 0 || !sp) return { y, seq: Array<string>(total).fill('n') };
    const parts = apportion(CAUSES.map((c) => new D(causePart(sp, c.key))), Math.max(0, total - base0));
    return { y, seq: [...Array<string>(Math.min(base0, total)).fill('n'), ...parts.flatMap((n, k) => Array<string>(n).fill(CAUSES[k].cls))] };
  });
  const rows = Math.max(1, Math.ceil(Math.max(...cols.map((c) => c.seq.length)) / per));
  const top0 = 44, baseY = top0 + rows * gap, h = baseY + 40, colW = w / cols.length;
  let s = `<line class="cg-hair" x1="0" x2="${w}" y1="${baseY + 4.5}" y2="${baseY + 4.5}"/>`;
  const drawn = new Set<string>();
  cols.forEach((c, ci) => {
    const cx = colW * ci + colW / 2, x0 = cx - ((per - 1) * gap) / 2;
    let dots = '';
    c.seq.forEach((cls, k) => {
      const x = x0 + (k % per) * gap, yy = baseY - Math.floor(k / per) * gap - gap / 2 + 2;
      if (cls !== 'n') drawn.add(cls);
      dots += `<g class="cg-dot" style="animation-delay:${Math.floor(k / per) * 22 + ci * 90}ms">${cls === 'n'
        ? `<circle cx="${x}" cy="${yy}" r="${r}" fill="var(--cg-neutral)"/>` : causeDot(cls, x, yy, r)}</g>`;
    });
    const topY = baseY - Math.ceil(c.seq.length / per) * gap - 12;
    const sp = m.causes[ci];
    const tip = `${c.y.year}: ${n3(c.y.certificates)} certificates${ci === 0 ? '\nthe starting year'
      : sp ? `\nsince ${Y[0].year}: ${CAUSES.filter((k) => !new D(causePart(sp, k.key)).isZero()).map((k) => `${causeLabel(m, k.key).toLowerCase()} +${n1Honest(causePart(sp, k.key))}`).join(', ')}` : '\nthe change is not divided into causes'}`;
    s += mark(tip, c.y.certificates, `${dots}
      <circle cx="${cx}" cy="${topY}" r="6.5" fill="var(--cg-ink)"/>
      <rect x="${cx - colW / 2}" y="0" width="${colW}" height="${baseY + 6}" fill="transparent"/>`, `data-dots="${c.seq.length}"`);
    s += `<text class="cg-num" x="${cx}" y="${topY - 14}" text-anchor="middle" font-size="15">${n1(c.y.certificates)}</text>
      <text class="cg-lab" x="${cx}" y="${baseY + 24}" text-anchor="middle" font-size="11">${c.y.year}</text>`;
  });
  // Which causes are drawn at all, for the legend and the tests: a cause with no part draws nothing.
  const sp = m.causes[m.causes.length - 1];
  const present = sp ? CAUSES.filter((c) => !new D(causePart(sp, c.key)).isZero()) : [];
  s += present.map((c) => `<g data-cause="${c.key}"></g>`).join('');
  void drawn;
  return { h, svg: s, alt: sp ? `By ${Y[Y.length - 1].year}: ${present.map((c) => `${causeLabel(m, c.key)} ${n1Honest(causePart(sp, c.key))}`).join(', ')}.` : 'The change is not divided into causes.' };
}

export function cascadeLegend(m: GraphsModel): string {
  const sp = m.causes[m.causes.length - 1];
  const dot = (cls: string): string => `<svg width="12" height="12" aria-hidden="true">${cls === 'n'
    ? '<circle cx="6" cy="6" r="4.5" fill="var(--cg-neutral)"/>' : causeDot(cls, 6, 6, 4.5)}</svg>`;
  const present = sp ? CAUSES.filter((c) => !new D(causePart(sp, c.key)).isZero()) : [];
  return `<span>${dot('n')}${m.years[0].year} level</span>${present.map((c) => `<span>${dot(c.cls)}${causeLabel(m, c.key)} <b>+${n1Honest(causePart(sp!, c.key))}</b></span>`).join('')}`;
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

export function plotPhase(phase: PhaseModel, w: number): Plot {
  const F = phase.rows, h = w > 560 ? 310 : 250, L = 34, R = 14, top = 22, base = h - 54;
  const sx = (i: number): number => L + (i / Math.max(1, F.length - 1)) * (w - L - R);
  const sy = (v: string): number => base - Number(v) * (base - top);
  let steepI = 1, drop = -1;
  F.forEach((f, i) => { if (i) { const d = Number(F[i - 1].factor) - Number(f.factor); if (d > drop) { drop = d; steepI = i; } } });
  let s = '';
  for (const v of ['0', '0.5', '1']) s += `<line class="cg-hair" x1="${L}" x2="${w - R}" y1="${sy(v) + 0.5}" y2="${sy(v) + 0.5}"/><text class="cg-faint" x="${L - 8}" y="${sy(v) + 3.5}" text-anchor="end" font-size="9.5">${Number(v) * 100}%</text>`;
  F.forEach((f, i) => { s += `<line class="cg-hair" x1="${sx(i) + 0.5}" x2="${sx(i) + 0.5}" y1="${top}" y2="${base}"/><text class="cg-lab" x="${sx(i)}" y="${base + 20}" text-anchor="middle" font-size="${w < 420 ? 9 : 10.5}">${w < 420 ? `'${String(f.year).slice(2)}` : f.year}</text>`; });
  const nComp = F.filter((f) => f.computable).length;
  const path = (from: number, to: number): string => F.slice(from, to).map((f, k) => `${k ? 'L' : 'M'}${sx(from + k)},${sy(f.factor)}`).join('');
  if (nComp > 0 && nComp < F.length) s += `<path d="${path(nComp - 1, F.length)}" fill="none" stroke="var(--cg-neutral)" stroke-width="1.5" stroke-linejoin="round"/>`;
  if (nComp > 1) s += `<path d="${path(0, nComp)}" fill="none" stroke="var(--cg-ink)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  s += `<circle class="cg-halo" cx="${sx(steepI)}" cy="${sy(F[steepI].factor)}" r="11" fill="var(--cg-warm)"/>`;
  F.forEach((f, i) => {
    const x = sx(i), y = sy(f.factor);
    const tip = `${f.year}: ${sharePct(f.factor)} of free allocation retained\n${f.locator}\n${f.computable ? 'the engine computes this line for this year' : 'legislated; no certificate count is computed here for this year'}`;
    s += mark(tip, f.factor, `${f.computable
      ? `<circle cx="${x}" cy="${y}" r="4.5" fill="var(--cg-ink)" stroke="var(--cg-surface)" stroke-width="2"/>`
      : `<circle cx="${x}" cy="${y}" r="4" fill="var(--cg-surface)" stroke="${i === steepI ? 'var(--cg-warm)' : 'var(--cg-neutral)'}" stroke-width="1.8"/>`}
      <rect x="${x - 14}" y="${top}" width="28" height="${base - top}" fill="transparent"/>`, `data-computable="${f.computable}" data-cy="${y.toFixed(3)}"`);
  });
  s += `<text class="cg-num" x="${sx(steepI) + 12}" y="${sy(F[steepI].factor) - 8}" font-size="11.5">${sharePct(F[steepI].factor)}</text>`;
  return { h, svg: s, alt: `Share of free allocation retained: ${F.map((f) => `${f.year} ${sharePct(f.factor)}`).join(', ')}.` };
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

export function plotOrigins(o: OriginsModel, w: number, ownCountry: string): Plot {
  if (o.kind !== 'chart') return { h: 0, svg: '', alt: 'Not drawn: the origins barely differ, or too few are published.' };
  const O = o.rows, me = O.find((r) => r.country === ownCountry);
  // With a shared figure, the labelled extremes are those of the others, as the sentence says.
  const named = o.shared ? offShared(o) : O, lo = named[0], hi = named[named.length - 1];
  const h = 260, top = 50, base = 216, L = 6, R = 6, step = (w - L - R) / O.length;
  const sy = scaleFromZero(Number(hi.certificates) * 1.02, base - top);
  const yOf = (v: string): number => base - sy(Number(v));
  let s = `<line class="cg-hair" x1="0" x2="${w}" y1="${base + 0.5}" y2="${base + 0.5}"/>`;
  O.forEach((r, i) => {
    const x = L + step * i + step / 2, y = yOf(r.certificates), is = r === me, rad = is ? 5.5 : Math.max(1.6, Math.min(3.2, step * 0.3));
    s += mark(`${r.name}: ${n3(r.certificates)} certificates on default values, ${o.year}`, r.certificates, `
      <line x1="${x}" x2="${x}" y1="${top - 6}" y2="${base}" stroke="var(--cg-hair)" stroke-width="1"/>
      <line x1="${x}" x2="${x}" y1="${y}" y2="${base}" stroke="${is ? 'var(--cg-accent)' : 'var(--cg-neutral)'}" stroke-width="${is ? 2 : 1.2}"/>
      ${is ? `<circle class="cg-halo" cx="${x}" cy="${y}" r="9" fill="var(--cg-accent)"/>` : ''}
      <circle cx="${x}" cy="${y}" r="${rad}" fill="${is ? 'var(--cg-accent)' : 'var(--cg-ink)'}" ${is ? 'stroke="var(--cg-surface)" stroke-width="2"' : ''} data-cy="${y.toFixed(3)}"/>
      <rect x="${x - Math.max(step, 6) / 2}" y="${top - 6}" width="${Math.max(step, 6)}" height="${base - top + 6}" fill="transparent"/>`, `data-country="${esc(r.country)}"`);
  });
  if (o.shared) {
    // The shared figure, marked once across its run of stems (a sorted run is contiguous).
    const i0 = O.findIndex((r) => new D(r.certificates).equals(o.mode.certificates)), i1 = i0 + o.mode.count - 1;
    const x0 = L + step * i0, x1 = L + step * (i1 + 1), y = yOf(o.mode.certificates);
    // Below the band, clear of the extremes' labels (which sit above their dots); above it only
    // when the band is too near the baseline. A surface halo keeps it legible over the stems.
    const ly = y + 22 < base - 4 ? y + 22 : y - 12;
    s += `<g data-shared="${o.mode.count}" aria-hidden="true"><rect x="${x0}" y="${y - 6}" width="${x1 - x0}" height="12" fill="var(--cg-accent)" opacity="0.14"/>
      <text class="cg-num" x="${(x0 + x1) / 2}" y="${ly}" text-anchor="middle" font-size="11" paint-order="stroke" stroke="var(--cg-surface)" stroke-width="4" stroke-linejoin="round">${o.mode.count} origins at ${n1(o.mode.certificates)}</text></g>`;
  }
  for (const r of new Set([lo, hi, ...(me ? [me] : [])])) {
    const i = O.indexOf(r), x = L + step * i + step / 2, y = yOf(r.certificates), right = x > w * 0.7, left = x < w * 0.3;
    const anchor = right ? 'end' : left ? 'start' : 'middle', dx = right ? 6 : left ? -4 : 0, up = r === lo && r !== me ? 30 : 16;
    if (up > 16) s += `<line x1="${x}" x2="${x}" y1="${y - 6}" y2="${y - up + 5}" stroke="var(--cg-faint)" stroke-width="1"/>`;
    s += `<text class="cg-num" x="${x + dx}" y="${y - up}" text-anchor="${anchor}" font-size="11">${n1(r.certificates)} <tspan class="cg-faint" font-weight="400">${esc(r.name)}</tspan></text>`;
  }
  s += `<text class="cg-lab" x="${L}" y="${base + 20}" font-size="10">Lowest default</text><text class="cg-lab" x="${w - R}" y="${base + 20}" text-anchor="end" font-size="10">Highest default</text>`;
  return { h, svg: s, alt: `${O.length} origins ranked by certificates on default values, from ${n1(O[0].certificates)} to ${n1(O[O.length - 1].certificates)}${o.shared ? `; ${o.mode.count} of them at ${n1(o.mode.certificates)}` : ''}.` };
}

/** The origins card's body, drawn when the origins have been computed. */
export function originsParts(o: OriginsModel | null, w: number): { title: string; plot: string; table: string; cap: string } {
  if (!o) return { title: 'No origin publishes a default value for this good and route in this year.', plot: '', table: '', cap: '' };
  const p = plotOrigins(o, w, o.ownCountry);
  return {
    title: sentenceOrigins(o),
    plot: p.h ? wrap(w, p) : '',
    table: table({ head: ['Origin', `Certificates, ${o.year}`], rows: o.rows.map((r) => [esc(r.name), n3(r.certificates)]) }),
    cap: `The Commission's default values for each origin, ${o.rows.length} published for this good and route. Where goods come from is a fact of the shipment, not a setting${o.usesVerified ? '; your line uses verified figures, which replace these' : ''}.`,
  };
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

/**
 * A closed table carries the class `cg-closed`, NOT the `hidden` attribute. The site's base layer
 * hides [hidden] with !important, and an !important rule in a layer cannot be overridden from
 * outside it, so a table closed with the attribute could never be shown to a printer. Measured:
 * the print rule existed and the tables stayed hidden in all three engines.
 */
const cardShell = (id: string, o: { q: string; title: string; plot: string; big?: string; extra?: string; cap: string; tbl: string; paper?: boolean; open: boolean }): string => `
  <article class="cg-card cg-${id}"${o.paper ? ' data-paper' : ''} data-cg-card="${id}">
    <p class="cg-q">${o.q}</p>
    ${o.big === undefined ? `<h4 class="cg-t" data-cg="title">${o.title}</h4>` : ''}
    <figure class="cg-plot" data-cg="plot">${o.plot}</figure>
    ${o.big === undefined ? '' : `<p class="cg-big">${o.big}</p><h4 class="cg-t" data-cg="title">${o.title}</h4>`}
    ${o.extra ?? ''}
    <div class="cg-foot"><p class="cg-cap">${o.cap}</p>
      <button type="button" class="cg-tbl-btn" aria-expanded="${o.open}" aria-controls="cgTbl-${id}">Table</button></div>
    <div class="cg-tbl${o.open ? '' : ' cg-closed'}" id="cgTbl-${id}" data-cg="table" tabindex="0" role="region" aria-label="Table: ${esc(o.q)}">${o.tbl}</div>
  </article>`;

const legendDot = (kind: 'fill' | 'ring'): string => (kind === 'fill'
  ? '<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="var(--cg-accent)"/></svg>'
  : '<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="3.8" fill="none" stroke="var(--cg-neutral)" stroke-width="1.5"/></svg>');

/**
 * The second price box is usable only once the first price exists. Until then it is disabled
 * and says why, so it can never draw a cost the strip above does not show.
 */
export const secondUsable = (state: GraphsState): boolean => parseAssumedPrice(state.priceText) !== null;
export const secondNote = (state: GraphsState): string => (secondUsable(state)
  ? '€ per certificate. Your first price is the box above.'
  : 'Type your first price in the box above. This one then makes a range.');

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

export type GraphWidths = Record<'steps' | 'cascade' | 'share' | 'markup' | 'charged' | 'cost' | 'phase' | 'origins', number>;

/**
 * The whole section. `widths` are the pixel widths the page measured for each card's plot; the
 * module never measures anything itself.
 */
export function renderGraphs(
  model: GraphsModel | GraphsRefusal, state: GraphsState, widths: GraphWidths, phase?: PhaseModel,
): string {
  const head = `<div class="cg-head"><h3 class="cg-h">The same shipment, drawn</h3>
    <p class="cg-sub">For the line above. Hover or focus a mark for its exact figure.</p></div>`;
  if (typeof model === 'string') {
    return `<section class="cg" aria-label="Graphs">${head}<p class="cg-none">${model === 'no-estimate'
      ? 'Nothing to draw: this line has no estimate in any year. The reason is in the cards above.'
      : 'Nothing to draw: this line has no estimate in at least one year. The reason is in the cards above.'}</p></section>`;
  }
  const m = model, Y = m.years;
  const yi = state.chargedYear === null ? Y.length - 1 : Math.max(0, Math.min(Y.length - 1, state.chargedYear));
  const asAt = `as at ${formatPackDate(m.priceAsAt)}`;
  const cost = costParts(m, widths.cost, state);
  const unpriced = unpricedQuarters(m);

  const steps = cardShell('steps', {
    q: 'Certificates, year by year', title: sentenceSteps(m), plot: wrap(widths.steps, plotSteps(m, widths.steps)),
    cap: `Law as published · ${formatPackDate(m.packDate)}. A cost appears only where a certificate price is published.`,
    open: !!state.open.steps,
    tbl: table({ head: ['Year', 'Certificates', `Change on ${Y[0].year}`, 'Cost'],
      rows: Y.map((y) => [y.year, n3(y.certificates), y.riseOnFirstPct === null ? '—' : new D(y.riseOnFirstPct).isZero() ? '0%' : `${new D(y.riseOnFirstPct).isNegative() ? '' : '+'}${pct1(y.riseOnFirstPct)}`,
        y.costEur !== null ? eur(y.costEur) : `none published for imports in ${y.priceQuarter}`]) }),
  });

  const share = cardShell('share', {
    paper: true, q: 'How much of the rise is the mark-up?', title: sentenceShare(m),
    big: m.split ? `${formatDecimal(m.usesDefault ? m.split.markupSharePct : '0', 1, true)}<small>%</small>` : '—',
    plot: wrap(widths.share, plotShare(m, widths.share, 'cgShare')),
    cap: m.split ? `${n1(m.split.markup)} of ${n1(m.split.rise)} certificates. The rest is free allocation.` : 'The counts above stand.',
    open: !!state.open.share,
    tbl: table(m.split ? { head: ['Cause', 'Certificates'],
      rows: [['Mark-up', plus(m.split.markup)], ['Less free allocation retained', plus(m.split.factor)], ['Lower benchmark', plus(m.split.benchmark)], ['Total rise', plus(m.split.rise)]] }
      : { head: ['Cause', 'Certificates'], rows: [['Not divided for this line', '—']] }),
  });

  const markup = cardShell('markup', {
    q: 'What does the mark-up add?', title: sentenceMarkup(m), plot: wrap(widths.markup, plotMarkup(m, widths.markup, 'cgMarkup')),
    cap: m.usesDefault
      ? "Top: the line as priced. Ring: the engine given the Commission's base value as a verified figure. A real verified figure can be higher or lower than that base."
      : 'The ring is the count from your verified figures.',
    open: !!state.open.markup,
    tbl: table({ head: ['Year', 'Mark-up', 'As priced', 'Base as verified', 'Mark-up adds'],
      rows: Y.map((y) => [y.year, y.markupPct !== null ? `${esc(y.markupPct)}%` : 'none', n3(y.certificates), n3(y.certificatesAtBase), plus(y.markupAdds)]) }),
  });

  const charged = cardShell('charged', {
    paper: true, q: 'How much of the emissions is charged?', title: sentenceCharged(m, yi),
    plot: wrap(widths.charged, plotCharged(m, widths.charged, yi)),
    extra: `<div class="cg-mini" role="group" aria-label="Year">${Y.map((y, j) => `<button type="button" data-cg-year="${j}" aria-pressed="${j === yi}">${y.year}</button>`).join('')}</div>
      <div class="cg-legend" data-cg="legend">${chargedLegend(m, yi)}</div>`,
    cap: 'One cell = 1% of the emissions counted for this shipment, rounded to whole cells.',
    open: !!state.open.charged,
    tbl: table(tableCharged(m)),
  });

  const costCard = cardShell('cost', {
    q: 'What would it cost at my own price?', title: cost.title, plot: cost.plot,
    extra: `<div class="cg-second"><label for="cgSecond">A second price, to see a range</label>
        <input id="cgSecond" type="number" min="0" step="any" inputmode="decimal" autocomplete="off" aria-describedby="cgSecondNote" value="${esc(state.secondText)}"${secondUsable(state) ? '' : ' disabled'} />
        <span id="cgSecondNote" data-cg="second-note">${secondNote(state)}</span></div>
      <div class="cg-legend">
        <span><svg width="12" height="12" aria-hidden="true"><rect x="4.5" y="1" width="3" height="10" fill="var(--cg-ink)"/></svg>Published price for this import's quarter</span>
        <span><svg width="16" height="12" aria-hidden="true"><path d="M1 6h14" stroke="var(--cg-markup)" stroke-width="2"/></svg>Your own price</span>
        <span><svg width="16" height="12" aria-hidden="true"><path d="M1 6h14" stroke="var(--cg-markup)" stroke-width="2" stroke-dasharray="3 3"/></svg>Yours, where none is published</span></div>`,
    cap: `Your price is your assumption, not a forecast. It stays on this page.${unpriced.length ? ` Certificate price for imports in ${listOf(unpriced, 'and')}: none published · ${asAt}.` : ''}`,
    open: !!state.open.cost, tbl: cost.table,
  });
  const cascade = cardShell('cascade', {
    q: 'Why does it rise?', title: sentenceCascade(m), plot: wrap(widths.cascade, plotCascade(m, widths.cascade)),
    extra: `<div class="cg-legend">${cascadeLegend(m)}</div>`,
    cap: `One dot = ${formatDecimal(String(cascadeUnit(Math.max(...Y.map((y) => Number(y.certificates))))), 1, false)} certificate${cascadeUnit(Math.max(...Y.map((y) => Number(y.certificates)))) === 1 ? '' : 's'}, rounded; the table is exact.${m.usesDefault ? ' The mark-up no longer applies with verified data.' : ''}`,
    open: !!state.open.cascade,
    tbl: table({ head: ['Year', 'Certificates', ...CAUSES.map((c) => causeLabel(m, c.key))],
      rows: Y.map((y, i) => [y.year, n3(y.certificates), ...CAUSES.map((c) => (i === 0 ? '—' : m.causes[i] ? plus(causePart(m.causes[i]!, c.key)) : 'not divided'))]),
      caption: `Changes are since ${Y[0].year}.` }),
  });

  const phaseCard = phase ? cardShell('phase', {
    paper: true, q: 'How fast does free allocation go?', title: sentencePhase(phase), plot: wrap(widths.phase, plotPhase(phase, widths.phase)),
    extra: `<div class="cg-legend"><span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="var(--cg-ink)"/></svg>Years computed for this line</span><span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="3.8" fill="none" stroke="var(--cg-neutral)" stroke-width="1.8"/></svg>Legislated, not computed here</span></div>`,
    cap: 'Directive 2003/87/EC Art 10a(1a): the share of free allocation retained. Default values are published to 2028 only, so no certificate count is drawn after it.',
    open: !!state.open.phase,
    tbl: table({ head: ['Year', 'Share retained', 'Computed for this line'], rows: phase.rows.map((r) => [r.year, sharePct(r.factor), r.computable ? 'yes' : 'no']) }),
  }) : '';

  // THE ORIGINS ARE COMPUTED AFTER THE REST IS ON SCREEN (one engine call per origin), so the
  // card is drawn with its question and a placeholder, and the page fills its slots.
  const origins = `
  <article class="cg-card cg-origins" data-cg-card="origins">
    <p class="cg-q">Does the origin matter?</p>
    <h4 class="cg-t" data-cg="title">Comparing every origin's default value…</h4>
    <figure class="cg-plot" data-cg="plot"></figure>
    <div class="cg-foot"><p class="cg-cap" data-cg="cap"></p>
      <button type="button" class="cg-tbl-btn" aria-expanded="${!!state.open.origins}" aria-controls="cgTbl-origins">Table</button></div>
    <div class="cg-tbl${state.open.origins ? '' : ' cg-closed'}" id="cgTbl-origins" data-cg="table" tabindex="0" role="region" aria-label="Table: Does the origin matter?"></div>
  </article>`;
  return `<section class="cg" aria-label="Graphs">${head}<div class="cg-board">${steps}${cascade}${share}${markup}${charged}${costCard}${phaseCard}${origins}</div><div class="cg-tip" data-cg="tip" aria-hidden="true"></div></section>`;
}
