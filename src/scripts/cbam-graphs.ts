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
  estimateFromPack, lookupIndirectFactorFromPack, selectFactorFromPack,
  type EstimatorInput, type EstimatorPack,
} from './cbam-algos/estimator/estimate-from-pack.ts';
import {
  assumedCost, formatDecimal, formatPackDate, parseAssumedPrice,
  type Outlook, type OutlookFigureYear,
} from './cbam-outlook.ts';

const D = Decimal.clone({ precision: 60 });

/* ── the model ─────────────────────────────────────────────────────────────── */

export interface GraphYear {
  year: number;
  certificates: string;
  embeddedTco2e: string;
  allocationTco2e: string;
  /** The engine's cost, where a price is published for the entered date's quarter. */
  costEur: string | null;
  priceEur: string | null;
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
  years: GraphYear[];
  /** True when any part of the line rests on a default value, so a mark-up is applied. */
  usesDefault: boolean;
  split: { rise: string; markup: string; factor: string; benchmark: string; markupSharePct: string } | null;
  /** Each published price row, as the engine prices this line in that quarter. */
  published: { quarter: string; priceEur: string; costEur: string }[];
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

/** The first day of a quarter's middle month plus fourteen: a date inside 'YYYY-Qn'. */
function dateInQuarter(quarter: string): string | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  return m ? `${m[1]}-${String((Number(m[2]) - 1) * 3 + 2).padStart(2, '0')}-15` : null;
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
      markupPct: y.directMarkupPct ?? y.indirectMarkupPct,
      certificatesAtBase: base,
      markupAdds: new D(y.certificates).minus(base).toFixed(),
      chargedPct: embedded.isZero() ? null : new D(y.certificates).dividedBy(embedded).times(100).toFixed(6),
      stepRise: i ? new D(y.certificates).minus(F[i - 1].certificates).toFixed() : null,
      riseOnFirstPct: y.riseOnFirstPct,
    };
  });

  const s = view.split;
  const published: GraphsModel['published'] = [];
  for (const row of pack.prices) {
    if (row.status !== 'published' || row.priceEur === null) continue;
    const date = dateInQuarter(row.quarter);
    if (!date) continue;
    const e = estimateFromPack(pack, { ...input, date });
    if (e.status === 'unavailable') continue;
    const cost = (e.status === 'cscf_pending' ? e.scenario : e.figure).costEur;
    if (cost !== null) published.push({ quarter: row.quarter, priceEur: row.priceEur, costEur: cost });
  }
  return {
    massT: input.massT,
    packDate: view.packDate,
    years,
    usesDefault: F.some((y) => y.directMarkupPct !== null || y.indirectMarkupPct !== null),
    // A rise of zero has no shares to speak of, so it is treated like a withheld split.
    split: s && !new D(s.rise).isZero() ? {
      rise: s.rise, markup: s.moreEmissions, factor: s.factorPart, benchmark: s.benchmarkPart,
      markupSharePct: new D(s.moreEmissions).dividedBy(s.rise).times(100).toFixed(6),
    } : null,
    published,
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
const yearList = (years: number[]): string =>
  (years.length <= 1 ? years.join('') : `${years.slice(0, -1).join(', ')} or ${years[years.length - 1]}`);
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
  const mass = `${esc(m.massT)} t`;
  if (diff.isZero()) return `The same ${mass} needs <b>the same</b> certificates in ${last.year} as in ${first.year}.`;
  const word = diff.isNegative() ? 'fewer' : 'more';
  if (last.riseOnFirstPct === null) {
    // The first year's count is zero, so there is no percentage to give.
    return `The same ${mass} needs <b>${n1(diff.abs().toFixed())} ${word}</b> certificates in ${last.year} than in ${first.year}.`;
  }
  const shown = new D(last.riseOnFirstPct).abs().toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  // A change too small to show at one decimal place is said in certificates, not as "0.0%".
  if (shown.isZero()) return `The same ${mass} needs <b>${n3(diff.abs().toFixed())} ${word}</b> certificates in ${last.year} than in ${first.year}.`;
  return `The same ${mass} needs <b>${shown.toFixed(1)}% ${word}</b> certificates in ${last.year} than in ${first.year}.`;
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
  return `On default values the mark-up adds <b>${n1(last.markupAdds)}</b> certificates in ${last.year}. It no longer applies with verified data.`;
}

export function sentenceCharged(m: GraphsModel, yearIndex: number): string {
  const y = m.years[Math.max(0, Math.min(m.years.length - 1, yearIndex))];
  if (y.chargedPct === null) return `No emissions are counted on this line in ${y.year}.`;
  const k = chargedCells(y.chargedPct);
  if (k === 0) return `In ${y.year}, free allocation covers <b>all</b> of the emissions counted. No certificates are due.`;
  if (k === 100) return `In ${y.year}, certificates cover <b>all</b> of the emissions counted.`;
  return `In ${y.year}, certificates cover <b>${k} of every 100</b> tonnes of emissions counted. Free allocation covers the other ${100 - k}.`;
}

/** The visitor's prices, in order, with unusable entries dropped. Zero, one or two of them. */
export function assumedRange(priceText: string, secondText: string): string[] {
  const out = [parseAssumedPrice(priceText), parseAssumedPrice(secondText)].filter((p): p is string => p !== null);
  return out.sort((a, b) => new D(a).cmp(b)).filter((p, i, all) => i === 0 || !new D(p).equals(all[i - 1]));
}

export function sentenceCost(m: GraphsModel, prices: string[]): string {
  const last = m.years[m.years.length - 1];
  const unpriced = m.years.filter((y) => y.costEur === null).map((y) => y.year);
  const none = unpriced.length ? `no ${yearList(unpriced)} price is published` : 'every year here has a published price';
  if (prices.length === 0) {
    return unpriced.length
      ? `No certificate price is published for ${yearList(unpriced).replace(' or ', ' and ')}. Type your own price above to see a cost.`
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
  const Y = m.years, asAt = `as at ${formatPackDate(m.packDate)}`;
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
      ? `${eur(y.costEur)} at the published ${price(y.priceEur)}` : `certificate price: none published, ${asAt}`}`;
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
        <text class="cg-faint" x="${cx}" y="${cy + 31}" text-anchor="middle" font-size="9.5">${narrow ? formatPackDate(m.packDate) : asAt}</text>`;
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
      s += `<text class="cg-num" x="${cx - cw / 2 - 7}" y="${(y0 + y1) / 2 + 4}" text-anchor="end" font-size="11">+${n1(y.markupAdds)}</text>`;
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
  : `${y.year}: certificates ${pct1(y.chargedPct)} of emissions counted\nfree allocation covers the rest`);

/** Cost at the visitor's own price: one row per year on a shared euro scale. Square marks only. */
export function plotCost(m: GraphsModel, w: number, prices: string[]): Plot {
  const Y = m.years, asAt = `as at ${formatPackDate(m.packDate)}`;
  const narrow = w < 300, rowH = 74, L = narrow ? 46 : 98, R = 10, top = 14, h = top + rowH * Y.length + 8;
  const lo = prices[0] ?? null, hi = prices.length > 1 ? prices[1] : null;
  const values = [...m.published.map((p) => Number(p.costEur)), ...Y.flatMap((y) => prices.map((p) => Number(assumedCost(y.certificates, p))))];
  const sx0 = scaleFromZero(Math.max(1, ...values) * 1.16, w - L - R);
  const sx = (v: string): number => L + sx0(Number(v));
  let s = '';
  Y.forEach((y, i) => {
    const cy = top + rowH * i + rowH / 2, open = y.costEur === null;
    s += `<text class="cg-lab" x="0" y="${cy + 4}" font-size="11">${y.year}</text>
      ${narrow ? '' : `<text class="cg-faint" x="0" y="${cy + 20}" font-size="9">${open ? 'none published' : 'published price'}</text>`}
      <line class="cg-hair" x1="${L}" x2="${w - R}" y1="${cy + 0.5}" y2="${cy + 0.5}"/>`;
    if (lo === null) return;
    const cLo = assumedCost(y.certificates, lo), cHi = hi === null ? cLo : assumedCost(y.certificates, hi);
    const xLo = sx(cLo), xHi = sx(cHi);
    const tip = `${y.year}: your ${price(lo)}${hi === null ? '' : ` to ${price(hi)}`}\n${eur(cLo)}${hi === null ? '' : ` to ${eur(cHi)}`}\nyour assumption, not a published price${open ? `\ncertificate price: none published, ${asAt}` : ''}`;
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
  // The published prices: flat ticks on the first year's track, on the same euro scale.
  const cy0 = top + rowH / 2;
  m.published.forEach((p) => {
    const cx = sx(p.costEur);
    s += mark(`${p.quarter.replace('-', ' ')}: published ${price(p.priceEur)}\n${eur(p.costEur)} for this shipment`, p.costEur,
      `<rect x="${cx - 1.5}" y="${cy0 - 10}" width="3" height="20" fill="var(--cg-ink)" data-x="${cx.toFixed(3)}"/><rect x="${cx - 9}" y="${cy0 - 14}" width="18" height="28" fill="transparent"/>`, 'data-cg="published"');
  });
  if (m.published.length && lo === null) {
    const p = m.published[0];
    s += `<text class="cg-num" x="${sx(p.costEur) - 8}" y="${cy0 - 13}" text-anchor="end" font-size="11">${eur0(p.costEur)}</text>`;
  }
  return { h, svg: s, alt: prices.length ? `Cost at your own price for each year.` : 'Published costs only; no price of your own is entered.' };
}

/* ── tables ────────────────────────────────────────────────────────────────── */

interface Table { head: string[]; rows: (string | number)[][]; caption?: string }
const table = (t: Table): string => `<table>
  <thead><tr>${t.head.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead>
  <tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}</tbody>
  ${t.caption ? `<caption>${t.caption}</caption>` : ''}</table>`;

export function tableCost(m: GraphsModel, prices: string[]): Table {
  return {
    head: ['Year', ...prices.map((p) => `At your ${price(p)}`), 'Published'],
    rows: m.years.map((y, i) => [y.year, ...prices.map((p) => eur(assumedCost(y.certificates, p))),
      y.costEur !== null ? (i === 0 && m.published.length ? m.published.map((p) => `${p.quarter.slice(5)} ${eur(p.costEur)}`).join(' · ') : eur(y.costEur)) : 'none published']),
  };
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

/** The cost card's changing parts, for the page to refill while a price is being typed. */
export function costParts(m: GraphsModel, w: number, state: GraphsState): { title: string; plot: string; table: string } {
  const prices = assumedRange(state.priceText, state.secondText);
  return { title: sentenceCost(m, prices), plot: wrap(w, plotCost(m, w, prices)), table: table(tableCost(m, prices)) };
}

/** The waffle card's changing parts, for a year switch. */
export function chargedLegend(m: GraphsModel, yearIndex: number): string {
  const y = m.years[yearIndex];
  const charged = y.chargedPct === null ? null : new D(y.chargedPct);
  return `<span>${legendDot('fill')}Certificates to surrender <b>${charged ? pct1(charged.toFixed()) : '—'}</b></span>
    <span>${legendDot('ring')}Free allocation <b>${charged ? pct1(D.max(0, new D(100).minus(charged)).toFixed()) : '—'}</b></span>`;
}

/**
 * The whole section. `widths` are the pixel widths the page measured for each card's plot; the
 * module never measures anything itself.
 */
export function renderGraphs(
  model: GraphsModel | GraphsRefusal, state: GraphsState, widths: Record<'steps' | 'share' | 'markup' | 'charged' | 'cost', number>,
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
  const asAt = `as at ${formatPackDate(m.packDate)}`;
  const cost = costParts(m, widths.cost, state);
  const unpriced = Y.filter((y) => y.costEur === null).map((y) => y.year);

  const steps = cardShell('steps', {
    q: 'Certificates, year by year', title: sentenceSteps(m), plot: wrap(widths.steps, plotSteps(m, widths.steps)),
    cap: `Law as published · ${asAt}. A cost appears only where a certificate price is published.`,
    open: !!state.open.steps,
    tbl: table({ head: ['Year', 'Certificates', `Change on ${Y[0].year}`, 'Cost'],
      rows: Y.map((y) => [y.year, n3(y.certificates), y.riseOnFirstPct === null ? '—' : `${new D(y.riseOnFirstPct).isNegative() ? '' : '+'}${pct1(y.riseOnFirstPct)}`,
        y.costEur !== null ? eur(y.costEur) : `none published · ${asAt}`]) }),
  });

  const share = cardShell('share', {
    paper: true, q: 'How much of the rise is the mark-up?', title: sentenceShare(m),
    big: m.split ? `${formatDecimal(m.usesDefault ? m.split.markupSharePct : '0', 1, true)}<small>%</small>` : '—',
    plot: wrap(widths.share, plotShare(m, widths.share, 'cgShare')),
    cap: m.split ? `${n1(m.split.markup)} of ${n1(m.split.rise)} certificates. The rest is free allocation.` : 'The counts above stand.',
    open: !!state.open.share,
    tbl: table(m.split ? { head: ['Cause', 'Certificates'],
      rows: [['Mark-up', `+${n3(m.split.markup)}`], ['Less free allocation retained', `+${n3(m.split.factor)}`], ['Lower benchmark', `+${n3(m.split.benchmark)}`], ['Total rise', `+${n3(m.split.rise)}`]] }
      : { head: ['Cause', 'Certificates'], rows: [['Not divided for this line', '—']] }),
  });

  const markup = cardShell('markup', {
    q: 'What does the mark-up add?', title: sentenceMarkup(m), plot: wrap(widths.markup, plotMarkup(m, widths.markup, 'cgMarkup')),
    cap: m.usesDefault
      ? "Top: the line as priced. Ring: the engine given the Commission's base value as a verified figure. A real verified figure can be higher or lower than that base."
      : 'The ring is the count from your verified figures.',
    open: !!state.open.markup,
    tbl: table({ head: ['Year', 'Mark-up', 'As priced', 'Base as verified', 'Mark-up adds'],
      rows: Y.map((y) => [y.year, y.markupPct !== null ? `${esc(y.markupPct)}%` : 'none', n3(y.certificates), n3(y.certificatesAtBase), `+${n3(y.markupAdds)}`]) }),
  });

  const charged = cardShell('charged', {
    paper: true, q: 'How much of the emissions is charged?', title: sentenceCharged(m, yi),
    plot: wrap(widths.charged, plotCharged(m, widths.charged, yi)),
    extra: `<div class="cg-mini" role="group" aria-label="Year">${Y.map((y, j) => `<button type="button" data-cg-year="${j}" aria-pressed="${j === yi}">${y.year}</button>`).join('')}</div>
      <div class="cg-legend" data-cg="legend">${chargedLegend(m, yi)}</div>`,
    cap: 'One cell = 1% of the emissions counted for this shipment, rounded to whole cells.',
    open: !!state.open.charged,
    tbl: table({ head: ['Year', 'Emissions counted', 'Free allocation', 'Certificates', 'Charged'],
      rows: Y.map((y) => [y.year, n3(y.embeddedTco2e), n3(y.allocationTco2e), n3(y.certificates), y.chargedPct === null ? '—' : pct1(y.chargedPct)]), caption: 'tCO₂e and certificates.' }),
  });

  const costCard = cardShell('cost', {
    q: 'What would it cost at my own price?', title: cost.title, plot: cost.plot,
    extra: `<div class="cg-second"><label for="cgSecond">A second price, to see a range</label>
        <input id="cgSecond" type="number" min="0" step="any" inputmode="decimal" autocomplete="off" value="${esc(state.secondText)}" />
        <span>€ per certificate. Your first price is the box above.</span></div>
      <div class="cg-legend">
        <span><svg width="12" height="12" aria-hidden="true"><rect x="4.5" y="1" width="3" height="10" fill="var(--cg-ink)"/></svg>Published price</span>
        <span><svg width="16" height="12" aria-hidden="true"><path d="M1 6h14" stroke="var(--cg-markup)" stroke-width="2"/></svg>Your own price</span>
        <span><svg width="16" height="12" aria-hidden="true"><path d="M1 6h14" stroke="var(--cg-markup)" stroke-width="2" stroke-dasharray="3 3"/></svg>Yours, where none is published</span></div>`,
    cap: `Your price is your assumption, not a forecast. It stays on this page.${unpriced.length ? ` Certificate price for ${yearList(unpriced).replace(' or ', ' and ')}: none published · ${asAt}.` : ''}`,
    open: !!state.open.cost, tbl: cost.table,
  });
  return `<section class="cg" aria-label="Graphs">${head}<div class="cg-board">${steps}${share}${markup}${charged}${costCard}</div><div class="cg-tip" data-cg="tip" aria-hidden="true"></div></section>`;
}
