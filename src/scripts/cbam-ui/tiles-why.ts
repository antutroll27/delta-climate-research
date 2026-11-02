// src/scripts/cbam-ui/tiles-why.ts
/**
 * Why it changes (spec §5.3): the graphs as bento tiles. These replace cbam-graphs.ts's
 * renderGraphs and its card shell.
 *
 * Pure: HTML strings from the graphs model. Every figure is the model's and every sentence is
 * cbam-graphs.ts's own builder. What is new here is only the drawing: HTML bars, a waffle,
 * columns and a strip, each on a zero-based scale, in place of the SVG arc, capsules, line and
 * stems. The cost rows stay the SVG plotCost draws: one euro scale, square marks only.
 *
 * THE MARK CONTRACT IS KEPT. Every mark is focusable (tabindex 0), named (role img and an
 * aria-label), and carries data-tip (the exact figure, which cbam-graphs-dom.ts shows on hover and
 * focus) and data-v (the exact value the tests and the e2e read). The hooks the e2e reads
 * (cg-card, data-cg-card, cg-t, cg-big, cg-plot, cg-tbl, cg-tbl-btn, data-cg, cg-tip, #cgSecond,
 * data-cg-year, data-country, data-shared, data-computable, data-charged) sit beside the b-
 * design classes (spec §6.4).
 */
import Decimal from 'decimal.js';
import { formatDecimal, formatPackDate } from '../cbam-outlook.ts';
import {
  CAUSES, causeLabel, causePart, cascadeLegend, cascadeUnit, chargedCells, chargedLegend, chargedTip,
  costParts, esc, eur, listOf, n1, n3, offShared, pct1, plotCascade, plotSteps, plus, renderTable,
  secondNote, secondUsable, sentenceCascade, sentenceCharged, sentenceMarkup, sentenceOrigins,
  sentencePhase, sentenceShare, sentenceSteps, sharePct, tableCharged, unpricedQuarters, wrap,
  type GraphsModel, type GraphsRefusal, type GraphsState, type OriginsModel, type PhaseModel,
} from '../cbam-graphs.ts';

const D = Decimal.clone({ precision: 60 });

/** A mark drawn in HTML: exactly the attributes of cbam-graphs.ts's SVG `mark`, in its order. */
const htmlMark = (tag: 'div' | 'i', cls: string, tip: string, value: string, inner: string, extra = ''): string =>
  `<${tag} class="cg-m${cls ? ` ${cls}` : ''}" tabindex="0" role="img" aria-label="${esc(tip.replace(/\n/g, '. '))}" data-tip="${esc(tip)}" data-v="${esc(value)}"${extra ? ` ${extra}` : ''}>${inner}</${tag}>`;

/** A plot's container: a named group, as the SVG plots' <svg role="group" aria-label>. */
const fig = (cls: string, alt: string, inner: string, extra = ''): string =>
  `<div class="cg-fig${cls ? ` ${cls}` : ''}" role="group" aria-label="${esc(alt)}"${extra ? ` ${extra}` : ''}>${inner}</div>`;

/* ── the plots ─────────────────────────────────────────────────────────────── */

/** Mark-up share: one bar, the mark-up's part against the rest of the rise. Empty when there is no share to show. */
export function shareBar(m: GraphsModel): string {
  if (!m.split) return fig('b-split b-split-sm', 'The change is not divided into causes.', '');
  const alt = `${pct1(m.split.markupSharePct)} of the rise is mark-up.`;
  const share = Math.max(0, Math.min(1, Number(m.split.markupSharePct) / 100));
  if (share <= 0) return fig('b-split b-split-sm', alt, '');
  const grow = (v: Decimal): string => v.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed();
  const rest = new D(m.split.factor).plus(m.split.benchmark);
  const inner = `<span class="b-sp b-sp-bz" style="flex-grow:${grow(new D(m.split.markup))}"><span class="num">${n1(m.split.markup)}</span></span>${
    rest.isZero() ? '' : `<span class="b-sp b-sp-on" style="flex-grow:${grow(rest)}"></span>`}`;
  return fig('', alt, htmlMark('div', 'b-split b-split-sm',
    `${pct1(m.split.markupSharePct)} of the rise\n${n1(m.split.markup)} of ${n1(m.split.rise)} certificates`,
    m.split.markupSharePct, inner, `data-t="${share.toFixed(5)}"`));
}

/** The tallest column's height in px. Every column is drawn on this one zero-based scale. */
const MC_BAR = 180;

/**
 * What the mark-up adds: one column per year, the count as priced, split into the mark-up (bronze)
 * and the count with the Commission's base value entered as verified. data-y1/data-y0 are the two
 * tops measured down from the scale's top, so y0 − y1 is the mark-up's length.
 */
export function markupColumns(m: GraphsModel): string {
  const Y = m.years;
  const max = Math.max(1e-9, ...Y.map((y) => Number(y.certificates)));
  const px = (v: string): number => (Number(v) / max) * MC_BAR;
  const cols = Y.map((y) => {
    const adds = !new D(y.markupAdds).isZero();
    const total = px(y.certificates), base = px(y.certificatesAtBase);
    const y1 = MC_BAR - total, y0 = MC_BAR - base;
    const tip = adds
      ? `${y.year}: mark-up ${y.markupPct ?? ''}% adds ${n3(y.markupAdds)}\nas priced: ${n3(y.certificates)}\nthe base value entered as verified: ${n3(y.certificatesAtBase)}`
      : `${y.year}: ${n3(y.certificates)} certificates\nno mark-up is applied`;
    const label = new D(y.markupAdds).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).isZero() ? 'under 0.1' : `+${n1(y.markupAdds)}`;
    const bar = `<span class="b-mc-bar" style="height:${total.toFixed(3)}px">${adds
      ? `<b class="b-mc-mk" style="flex-grow:${(y0 - y1).toFixed(3)}"><em class="num">${label}</em></b>` : ''}<i style="flex-grow:${base.toFixed(3)}"></i></span>`;
    return htmlMark('div', 'b-mc', tip, y.markupAdds,
      `<span class="b-mc-top num">${n1(y.certificates)}</span>${bar}<span class="b-mc-y num">${y.year}</span><span class="b-t-sub">${
        y.markupPct !== null ? `mark-up ${esc(y.markupPct)}%` : 'no mark-up'}</span>`,
      `data-y1="${y1.toFixed(3)}" data-y0="${y0.toFixed(3)}" data-certificates="${esc(y.certificates)}"`);
  }).join('');
  return fig('b-mcols', `Mark-up adds ${Y.map((y) => `${n1(y.markupAdds)} in ${y.year}`).join(', ')} certificates.`, cols, `style="--n:${Y.length}"`);
}

/**
 * Charged: 100 cells, the shown year's share lit. `data-cells` holds every year's count of lit
 * cells, so the page switches years by toggling classes, with no redraw.
 */
export function waffle(m: GraphsModel, yearIndex: number): string {
  const yi = Math.max(0, Math.min(m.years.length - 1, yearIndex));
  const cells = m.years.map((y) => (y.chargedPct === null ? 0 : chargedCells(y.chargedPct)));
  const y = m.years[yi];
  const dots = Array.from({ length: 100 }, (_, k) => `<i${k < cells[yi] ? ' class="on"' : ''}></i>`).join('');
  return fig('', `${cells[yi]} of 100 cells are certificates in ${y.year}.`,
    htmlMark('div', 'b-waffle', chargedTip(y), y.chargedPct ?? '', dots,
      `data-charged="${cells[yi]}" data-cg="charged-mark" data-cells="${cells.join(',')}"`));
}

/** Free allocation: the legislated schedule as columns; solid where this line has a figure. */
export function phaseColumns(phase: PhaseModel): string {
  const cols = phase.rows.map((f) => {
    const tip = `${f.year}: ${sharePct(f.factor)} of free allocation retained\n${f.locator}\n${
      f.computable ? 'the engine computes this line for this year' : 'legislated; no certificate count is computed here for this year'}`;
    const h = D.max(0, D.min(100, new D(f.factor).times(100))).toFixed();
    return htmlMark('div', `b-ph${f.computable ? ' b-ph-on' : ''}`, tip, f.factor,
      `<span class="b-ph-bar"><b style="height:${h}%"></b></span><span class="num">${f.year}</span><em class="num">${sharePct(f.factor)}</em>`,
      `data-computable="${f.computable}"`);
  }).join('');
  return fig('b-phase', `Share of free allocation retained: ${phase.rows.map((f) => `${f.year} ${sharePct(f.factor)}`).join(', ')}.`,
    cols, `style="--n:${phase.rows.length}"`);
}

/**
 * Does the origin matter: every origin on one zero-based strip (position = value ÷ the highest),
 * the visitor's own enlarged, and the shared figure marked. Drawn only for kind 'chart', as
 * before: a flat spread, or one or two origins, is said in words and not drawn as if it mattered.
 */
export function originStrip(o: OriginsModel): string {
  if (o.kind !== 'chart') return '';
  const O = o.rows, me = O.find((r) => r.country === o.ownCountry);
  // With a shared figure, the named extremes are those of the others, as the sentence says.
  const named = o.shared ? offShared(o) : O, lo = named[0], hi = named[named.length - 1];
  const top = new D(O[O.length - 1].certificates);
  const at = (v: string): string => (top.isZero() ? '0.0000' : new D(v).div(top).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));
  const pos = (v: string): string => `left:calc(14px + (100% - 28px) * ${at(v)})`;
  const dots = O.map((r) => htmlMark('i', r === me ? 'b-me' : '', `${r.name}: ${n3(r.certificates)} certificates on default values, ${o.year}`,
    r.certificates, '', `data-country="${esc(r.country)}" style="${pos(r.certificates)}"`)).join('');
  const band = o.shared
    ? `<span class="b-strip-band" data-shared="${o.mode.count}" aria-hidden="true" style="${pos(o.mode.certificates)}">${o.mode.count} origins at ${n1(o.mode.certificates)}</span>` : '';
  const big = `<p class="b-orig-big num"><span>${n1(lo.certificates)}<small>${esc(lo.name)}</small></span><span class="b-arrow" aria-hidden="true">→</span><span>${
    n1(hi.certificates)}<small>${esc(hi.name)}</small></span>${me ? `<span class="b-me-big">${esc(me.name)} ${n1(me.certificates)}</span>` : ''}</p>`;
  const alt = `${O.length} origins ranked by certificates on default values, from ${n1(O[0].certificates)} to ${n1(O[O.length - 1].certificates)}${
    o.shared ? `; ${o.mode.count} of them at ${n1(o.mode.certificates)}` : ''}.`;
  return `${big}${fig('b-strip', alt, dots + band)}`;
}

/** The origins tile's body, for the page to fill once the origins have been computed. */
export function originsTileParts(o: OriginsModel | null): { title: string; plot: string; table: string; cap: string } {
  if (!o) return { title: 'No origin publishes a default value for this good and route in this year.', plot: '', table: '', cap: '' };
  return {
    title: sentenceOrigins(o),
    plot: originStrip(o),
    table: renderTable({ head: ['Origin', `Certificates, ${o.year}`], rows: o.rows.map((r) => [esc(r.name), n3(r.certificates)]) }),
    cap: `The Commission's default values for each origin, ${o.rows.length} published for this good and route. Where goods come from is a fact of the shipment, not a setting${o.usesVerified ? '; your line uses verified figures, which replace these' : ''}.`,
  };
}

/* ── the tiles ─────────────────────────────────────────────────────────────── */

/** The pixel widths the page measured for the tiles whose plot is an SVG. The HTML plots size themselves. */
export type WhyWidths = Record<'steps' | 'cascade' | 'cost', number>;

interface TileOpts {
  span: 2 | 4; hero?: boolean; title: string; sub?: string; head?: string; big?: string;
  sentence: string; plot: string; extra?: string; cap: string; tbl: string; open: boolean;
}

/**
 * One tile. A closed table carries the class `cg-closed`, NOT the `hidden` attribute: the site's
 * base layer hides [hidden] with !important, which no print rule could undo (measured in all three
 * engines when the graphs were built).
 */
const tile = (id: string, o: TileOpts): string => `
  <section class="b-t b-s${o.span}${o.hero ? ' b-hero' : ''} cg-card cg-${id}" data-cg-card="${id}" aria-labelledby="cgQ-${id}">
    <div class="b-t-h"><div><h2 class="b-t-ti cg-q" id="cgQ-${id}">${o.title}</h2>${o.sub ? `<p class="b-t-sub">${o.sub}</p>` : ''}</div>${o.head ?? ''}</div>
    ${o.big === undefined ? '' : `<p class="b-mega num cg-big">${o.big}</p>`}
    <p class="b-lead cg-t" data-cg="title">${o.sentence}</p>
    <figure class="cg-plot" data-cg="plot">${o.plot}</figure>
    ${o.extra ?? ''}
    <div class="b-t-foot cg-foot"><p class="cg-cap" data-cg="cap">${o.cap}</p>
      <button type="button" class="cg-tbl-btn" aria-expanded="${o.open}" aria-controls="cgTbl-${id}">Show as table</button></div>
    <div class="cg-tbl${o.open ? '' : ' cg-closed'}" id="cgTbl-${id}" data-cg="table" tabindex="0" role="region" aria-label="Table: ${esc(o.title)}">${o.tbl}</div>
  </section>`;

const dot = (fill: string): string => `<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="${fill}"/></svg>`;
const ring = (stroke: string): string => `<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="3.8" fill="none" stroke="${stroke}" stroke-width="1.8"/></svg>`;

/**
 * The whole Why view's content. `widths` are the pixel widths the page measured for the SVG
 * plots; this module never measures anything itself.
 */
export function renderWhy(model: GraphsModel | GraphsRefusal, state: GraphsState, widths: WhyWidths, phase?: PhaseModel): string {
  if (typeof model === 'string') {
    return `<section class="cg" aria-label="Graphs"><div class="b-bento"><div class="b-t b-s4"><p class="cg-none">${model === 'no-estimate'
      ? 'Nothing to draw: this line has no estimate in any year. The reason is in Three years.'
      : 'Nothing to draw: this line has no estimate in at least one year. The reason is in Three years.'}</p></div></div></section>`;
  }
  const m = model, Y = m.years;
  const yi = state.chargedYear === null ? Y.length - 1 : Math.max(0, Math.min(Y.length - 1, state.chargedYear));
  const asAt = `as at ${formatPackDate(m.priceAsAt)}`;
  const cost = costParts(m, widths.cost, state);
  const unpriced = unpricedQuarters(m);

  // D2 (spec §11): the year-step chart and the dot cascade. Task 8 of the phase-3 plan deletes
  // these two tiles; until then they are drawn here, unchanged in content.
  const maxCount = Math.max(...Y.map((y) => Number(y.certificates)));
  const steps = tile('steps', {
    span: 4, title: 'Certificates, year by year.', sentence: sentenceSteps(m), plot: wrap(widths.steps, plotSteps(m, widths.steps)),
    cap: `Law as published · ${formatPackDate(m.packDate)}. A cost appears only where a certificate price is published.`,
    open: !!state.open.steps,
    tbl: renderTable({ head: ['Year', 'Certificates', `Change on ${Y[0].year}`, 'Cost'],
      rows: Y.map((y) => [y.year, n3(y.certificates), y.riseOnFirstPct === null ? '—' : new D(y.riseOnFirstPct).isZero() ? '0%' : `${new D(y.riseOnFirstPct).isNegative() ? '' : '+'}${pct1(y.riseOnFirstPct)}`,
        y.costEur !== null ? eur(y.costEur) : `none published for imports in ${y.priceQuarter}`]) }),
  });
  const cascade = tile('cascade', {
    span: 4, title: 'Why does it rise?', sentence: sentenceCascade(m), plot: wrap(widths.cascade, plotCascade(m, widths.cascade)),
    extra: `<div class="cg-legend">${cascadeLegend(m)}</div>`,
    cap: `One dot = ${formatDecimal(String(cascadeUnit(maxCount)), 1, false)} certificate${cascadeUnit(maxCount) === 1 ? '' : 's'}, rounded; the table is exact.${m.usesDefault ? ' The mark-up no longer applies with verified data.' : ''}`,
    open: !!state.open.cascade,
    tbl: renderTable({ head: ['Year', 'Certificates', ...CAUSES.map((c) => causeLabel(m, c.key))],
      rows: Y.map((y, i) => [y.year, n3(y.certificates), ...CAUSES.map((c) => (i === 0 ? '—' : m.causes[i] ? plus(causePart(m.causes[i]!, c.key)) : 'not divided'))]),
      caption: `Changes are since ${Y[0].year}.` }),
  });

  const share = tile('share', {
    span: 2, hero: true, title: 'Mark-up share.',
    big: m.split ? `${formatDecimal(m.usesDefault ? m.split.markupSharePct : '0', 1, true)}<span class="b-u">%</span>` : '—',
    sentence: sentenceShare(m), plot: shareBar(m),
    cap: m.split ? `${n1(m.split.markup)} of ${n1(m.split.rise)} certificates. The rest is free allocation.` : 'The counts in Three years stand.',
    open: !!state.open.share,
    tbl: renderTable(m.split ? { head: ['Cause', 'Certificates'],
      rows: [['Mark-up', plus(m.split.markup)], ['Less free allocation retained', plus(m.split.factor)], ['Lower benchmark', plus(m.split.benchmark)], ['Total rise', plus(m.split.rise)]] }
      : { head: ['Cause', 'Certificates'], rows: [['Not divided for this line', '—']] }),
  });

  const charged = tile('charged', {
    span: 2, title: 'Charged.', sub: 'Certificates per 100 tCO₂e of emissions counted.',
    head: `<div class="b-seg cg-mini" role="group" aria-label="Year">${Y.map((y, j) => `<button type="button" data-cg-year="${j}" aria-pressed="${j === yi}">${y.year}</button>`).join('')}</div>`,
    sentence: sentenceCharged(m, yi), plot: waffle(m, yi),
    extra: `<div class="cg-legend" data-cg="legend">${chargedLegend(m, yi)}</div>`,
    cap: 'One cell = 1% of the emissions counted for this shipment, rounded to whole cells.',
    open: !!state.open.charged, tbl: renderTable(tableCharged(m)),
  });

  const markup = tile('markup', {
    span: 2, title: 'What the mark-up adds.', sentence: sentenceMarkup(m), plot: markupColumns(m),
    cap: m.usesDefault
      ? "Bronze: what the mark-up adds, as priced. Below it: the engine given the Commission's base value as a verified figure. A real verified figure can be higher or lower than that base."
      : 'The column is the count from your verified figures.',
    open: !!state.open.markup,
    tbl: renderTable({ head: ['Year', 'Mark-up', 'As priced', 'Base as verified', 'Mark-up adds'],
      rows: Y.map((y) => [y.year, y.markupPct !== null ? `${esc(y.markupPct)}%` : 'none', n3(y.certificates), n3(y.certificatesAtBase), plus(y.markupAdds)]) }),
  });

  const phaseTile = phase ? tile('phase', {
    span: 2, title: 'Free allocation.', sentence: sentencePhase(phase), plot: phaseColumns(phase),
    extra: `<div class="cg-legend"><span>${dot('var(--cg-ink)')}Years computed for this line</span><span>${ring('var(--cg-neutral)')}Legislated, not computed here</span></div>`,
    cap: 'Directive 2003/87/EC Art 10a(1a): the share of free allocation retained. Default values are published to 2028 only, so no certificate count is drawn after it.',
    open: !!state.open.phase,
    tbl: renderTable({ head: ['Year', 'Share retained', 'Computed for this line'], rows: phase.rows.map((r) => [r.year, sharePct(r.factor), r.computable ? 'yes' : 'no']) }),
  }) : '';

  // THE ORIGINS ARE COMPUTED AFTER THE REST IS ON SCREEN (one engine call per origin), so the
  // tile is drawn with its question and a placeholder, and the page fills its slots.
  const origins = tile('origins', {
    span: 4, title: 'Does the origin matter?', sentence: 'Comparing every origin\'s default value…', plot: '', cap: '', tbl: '',
    open: !!state.open.origins,
  });

  const costTile = tile('cost', {
    span: 4, title: 'What would it cost at my own price?', sentence: cost.title, plot: cost.plot,
    extra: `<div class="cg-second"><label for="cgSecond">A second price, to see a range</label>
        <input id="cgSecond" type="number" min="0" step="any" inputmode="decimal" autocomplete="off" aria-describedby="cgSecondNote" value="${esc(state.secondText)}"${secondUsable(state) ? '' : ' disabled'} />
        <span id="cgSecondNote" data-cg="second-note">${secondNote(state)}</span></div>
      <div class="cg-legend">
        <span><svg width="12" height="12" aria-hidden="true"><rect x="4.5" y="1" width="3" height="10" fill="var(--cg-ink)"/></svg>Published price for this import's date</span>
        <span><svg width="16" height="12" aria-hidden="true"><path d="M1 6h14" stroke="var(--cg-markup)" stroke-width="2"/></svg>Your own price</span>
        <span><svg width="16" height="12" aria-hidden="true"><path d="M1 6h14" stroke="var(--cg-markup)" stroke-width="2" stroke-dasharray="3 3"/></svg>Yours, where none is published</span></div>`,
    cap: `Your price is your assumption, not a forecast. It stays on this page.${unpriced.length ? ` Certificate price for imports in ${listOf(unpriced, 'and')}: none published · ${asAt}.` : ''}`,
    open: !!state.open.cost, tbl: cost.table,
  });

  return `<section class="cg" aria-label="Graphs"><p class="cg-sub">Hover or focus a mark for its exact figure.</p><div class="b-bento cg-board">${
    steps}${cascade}${share}${charged}${markup}${phaseTile}${origins}${costTile}</div><div class="cg-tip" data-cg="tip" aria-hidden="true"></div></section>`;
}
