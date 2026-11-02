// src/scripts/cbam-ui/tiles-years.ts
/**
 * Three years (spec §5.2): the year plates, the visitor's own price, why it rises, the working.
 *
 * These replace cbam-outlook.ts's renderOutlook and its parts. The model stays there: outlook(),
 * outlookWhy() (every word of "why it rises"), renderOutlookRows (the working), renderOutlookNotes
 * and renderOutlookPriceNote. This file lays those out as tiles and decides no figure and no
 * sentence of its own, except the plate's cost block, moved here unchanged from renderYearCost.
 *
 * Pure: HTML strings from an Outlook, so node:test holds every state against the real pack.
 * The class hooks the e2e suite reads (cb-ol, cb-ol-yr, cb-ol-n, cb-ol-d, cb-ol-h, cb-ol-stack,
 * cb-ol-legend, cb-ol-work, cb-ol-scroll, cb-ol-price, cb-card-label, cb-tag) sit beside the b-
 * design classes (spec §6.4).
 *
 * THE PARTS THE PRICE CHANGES SIT IN data-ol SLOTS, as before, so the page refills them while the
 * visitor types without replacing #cbOlPrice (which would drop the caret mid-number) or the
 * <details> (which would close it). See yearsPriceSlots.
 */
import Decimal from 'decimal.js';
import { esc } from './format.ts';
import {
  assumedCost, formatCount, formatEuros, formatPackDate, formatPrice, formatSignedPct, outlookWhy,
  parseAssumedPrice, renderOutlookNotes, renderOutlookPriceNote, renderOutlookRows, unpricedYears,
  type Outlook, type OutlookFigureYear, type OutlookWhyRow,
} from '../cbam-outlook.ts';

/**
 * How many of ten dots a mark-up lights: ONE DOT PER 10%, and only when the mark-up is a whole
 * number of tens. 5,278 rows of the pack carry a 1% mark-up (28080000, nitric acid, is one); on
 * this scale it would light no dot and read as "no mark-up", so it is said in words and not drawn.
 */
export function markupDots(pct: string): number | null {
  let d: Decimal;
  try { d = new Decimal(pct); } catch { return null; }
  if (!d.isFinite() || d.isNegative() || d.greaterThan(100) || !d.mod(10).isZero()) return null;
  return d.div(10).toNumber();
}

/** The mark-up the engine applied this year: the working table's rule, direct default first. */
function plateMarkup(y: OutlookFigureYear): string {
  const pct = y.directMarkupPct ?? y.indirectMarkupPct;
  if (pct === null) return '';
  const what = y.directMarkupPct !== null ? 'Mark-up' : 'Electricity mark-up';
  const n = markupDots(pct);
  const dots = n === null ? '' : `<span class="b-d10 b-bz" aria-hidden="true">${
    Array.from({ length: 10 }, (_, i) => `<i${i < n ? ' class="on"' : ''}></i>`).join('')}</span>`;
  return `<p class="b-mk"><span>${what} ${esc(pct)}%</span>${dots}</p>`;
}

function plateCost(y: OutlookFigureYear, view: Outlook, assumed: string | null): string {
  // A PUBLISHED PRICE IS NEVER REPLACED. The engine's cost comes first and the visitor's number
  // is not consulted at all for that year.
  if (y.costEur !== null && y.price.priceEur !== null) {
    return `<span class="b-tag num cb-ol-e">${formatEuros(y.costEur)}</span>
      <span class="b-t-sub cb-ol-s">price published, ${formatPrice(y.price.priceEur)}</span>`;
  }
  if (assumed !== null) {
    return `<span class="b-tag num cb-ol-e cb-ol-mine">${formatEuros(assumedCost(y.certificates, assumed))}</span>
      <span class="b-t-sub cb-ol-s">at your assumed ${formatPrice(assumed)} · not a published price</span>`;
  }
  // ABOUT THIS YEAR'S OWN QUARTER, the period the import falls in (M2): never the price's period.
  return `<span class="b-t-sub cb-ol-s">Certificate price · imports in ${esc(y.price.quarter)}</span>
      <span class="b-tag b-none cb-ol-e">none published</span>
      <span class="b-t-sub cb-ol-s">as at ${esc(formatPackDate(view.priceAsAt))}</span>`;
}

/** The year plates. A refused year shows the engine's reason, verbatim, and no figure. */
export function renderYearPlates(view: Outlook, assumed: string | null): string {
  const firstYear = view.years[0].year;
  return view.years.map((y, i) => {
    if (y.kind === 'refused') {
      return `<li class="b-t b-yr cb-ol-yr cb-ol-refused">
        <div class="b-t-h"><h3 class="b-t-ti num cb-ol-y">${y.year}.</h3></div>
        <p class="b-mid cb-ol-none">No estimate</p>
        <p class="b-t-sub cb-ol-reason">${esc(y.reason)}</p>
      </li>`;
    }
    const delta = y.year !== firstYear && y.riseOnFirstPct !== null
      ? `<span class="b-t-sub cb-ol-d">${formatSignedPct(y.riseOnFirstPct)} on ${firstYear}</span>` : '';
    return `<li class="b-t b-yr cb-ol-yr${i === 0 ? ' b-hero' : ''}">
        <div class="b-t-h"><h3 class="b-t-ti num cb-ol-y">${y.year}.</h3>${delta}</div>
        <p class="b-mid num cb-ol-n">${formatCount(y.certificates)}</p>
        <p class="b-t-sub">certificates</p>
        <div class="b-yr-cost cb-ol-p">${plateCost(y, view, assumed)}</div>
        ${plateMarkup(y)}
      </li>`;
  }).join('');
}

const SEGMENT: Record<OutlookWhyRow['key'], string> = {
  markup: 'b-sp-bz cb-ol-s1', factor: 'b-sp-ink cb-ol-s2', benchmark: 'b-sp-ink2 cb-ol-s3',
};
const SWATCH: Record<OutlookWhyRow['key'], string> = { markup: 'cb-ol-s1', factor: 'cb-ol-s2', benchmark: 'cb-ol-s3' };

/**
 * "Why it rises." The split bar and its legend, or, where the change is not divided, the reason.
 * A refused year renders no tile: each plate above carries the engine's own reason.
 */
export function renderYearsWhy(view: Outlook): string {
  const why = outlookWhy(view);
  switch (why.kind) {
    case 'none':
      return '';
    case 'withheld':
      return `<section class="b-t b-s4 b-rise cb-ol-why" aria-labelledby="cbOlWhyT">
      <h3 class="b-t-ti" id="cbOlWhyT">Not divided into causes.</h3>
      <p class="b-lead2 cb-ol-nosplit">${why.sentence}</p>
    </section>`;
    case 'split': {
      // A part that is zero draws no segment; its legend row still stands and says so.
      const bar = why.rows.filter((r) => !new Decimal(r.value).isZero()).map((r) => `<span class="b-sp ${SEGMENT[r.key]}" style="flex-grow:${
        new Decimal(r.value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed()}"><span class="num">+${formatCount(r.value)}</span></span>`).join('');
      const aria = why.rows.map((r) => `${r.label} ${formatCount(r.value)}`).join(', ');
      const legend = why.rows.map((r) => `<li>
        <span class="cb-ol-sw ${SWATCH[r.key]}" aria-hidden="true"></span>
        <span>${r.title}<small>${r.sub}</small></span>
        <b>${new Decimal(r.value).isZero() ? '0.0' : `+${formatCount(r.value)}`}</b>
      </li>`).join('');
      return `<section class="b-t b-s4 b-rise cb-ol-why" aria-labelledby="cbOlWhyT">
      <div class="b-t-h"><div><h3 class="b-t-ti cb-ol-h" id="cbOlWhyT">Why it rises.</h3>
        <p class="b-t-sub cb-ol-hs">Of ${formatCount(why.rise)} extra certificates by ${why.lastYear}.</p></div></div>
      <div class="b-split cb-ol-stack" role="img" aria-label="${esc(aria)}">${bar}</div>
      <ul class="cb-ol-legend">${legend}</ul>
    </section>`;
    }
    default: {
      const _exhaustive: never = why;
      return _exhaustive;
    }
  }
}

/**
 * The whole Three years view's content. `priceText` is what the visitor typed in the price box,
 * restored into the box when the view is rebuilt; it is never read from anywhere but the caller's
 * own variable. `workingOpen` carries the <details> state across a rebuild.
 */
export function renderYears(view: Outlook, priceText = '', workingOpen = false): string {
  const assumed = parseAssumedPrice(priceText);
  const hasFigures = view.years.some((y) => y.kind === 'figure');
  const priceBox = unpricedYears(view).length > 0;
  const first = view.years[0].year;
  const last = view.years[view.years.length - 1].year;
  return `<section class="cb-ol" aria-labelledby="cbOlTitle">
  <header class="cb-ol-head"><h2 class="cb-card-label" id="cbOlTitle">The same shipment, ${first} to ${last}</h2>
    <span class="b-tag cb-tag pending">Law as published · ${esc(formatPackDate(view.packDate))}</span></header>
  <div class="b-bento">
    <ol class="cb-ol-years" data-ol="years">${renderYearPlates(view, assumed)}</ol>
    <section class="b-t b-own cb-ol-price" aria-labelledby="cbOlPriceT"${priceBox ? '' : ' hidden'}>
      <h3 class="b-t-ti" id="cbOlPriceT">Your own price.</h3>
      <label class="b-t-sub" for="cbOlPrice">Your own price assumption, € per certificate</label>
      <div class="b-pricebox"><span aria-hidden="true">€</span>
        <input id="cbOlPrice" class="cb-ol-px num" type="number" min="0" step="any" inputmode="decimal"
          placeholder="e.g. 80" autocomplete="off" aria-describedby="cbOlPriceNote" value="${esc(priceText)}" />
        <em aria-hidden="true">per certificate</em></div>
      <p class="b-t-foot" id="cbOlPriceNote" data-ol="pricenote">${renderOutlookPriceNote(view, priceText)}</p>
    </section>
    ${renderYearsWhy(view)}
    <section class="b-t b-s4 b-work" aria-labelledby="cbOlWorkT"${hasFigures ? '' : ' hidden'}>
      <h3 class="b-t-ti" id="cbOlWorkT">The working.</h3>
      <p class="b-t-sub">Year by year, exact.</p>
      <details class="cb-ol-work"${workingOpen ? ' open' : ''}${hasFigures ? '' : ' hidden'}>
        <summary>Show the working</summary>
        <div class="cb-ol-scroll" tabindex="0" role="region" aria-label="The working, year by year">
          <table class="b-wk num">
            <thead><tr><td></td>${view.years.map((y) => `<th scope="col">${y.year}</th>`).join('')}</tr></thead>
            <tbody data-ol="rows">${renderOutlookRows(view, assumed)}</tbody>
          </table>
        </div>
      </details>
      <div class="cb-ol-notes">${renderOutlookNotes(view)}</div>
    </section>
  </div>
</section>`;
}

/**
 * The three slots the visitor's price can change. The page refills these when the price box is
 * typed in, and leaves everything else — the box itself above all — exactly where it is.
 */
export function yearsPriceSlots(view: Outlook, priceText: string): Record<'years' | 'rows' | 'pricenote', string> {
  const assumed = parseAssumedPrice(priceText);
  return {
    years: renderYearPlates(view, assumed),
    rows: renderOutlookRows(view, assumed),
    pricenote: renderOutlookPriceNote(view, priceText),
  };
}
