// src/scripts/cbam-ui/tiles-estimate.ts
// The Estimate view's result tiles (spec §5.1): Certificates (the inverted hero), Chargeable (the
// card is the bar), Three years (a stacked deck) and Provenance (the snapshot as dots). Pure
// functions returning HTML strings, like every renderer on this page, so cbam-render.test.mjs can
// render and assert. Every tile renders every state its model can return (spec §6.1).
//
// HOOKS (spec §6.4). The e2e suite reads .cb-fig, .cb-n, .cb-cost, .cb-res, .cb-tag inside #cbOut.
// They sit on the hero ALONE, beside the b- classes, so `#cbOut .cb-n` stays one element. The deck
// carries no cb-ol-* class: cbam-lines.spec.ts reads .cb-ol-n and .cb-ol-yr page-wide.
//
// WHAT IS HANDED IN, NOT BUILT HERE: the de minimis card (renderDraftThreshold) and the
// attestation (renderAttestation(…, hasFigure(e))). cbam-render.test.mjs pins, by source text,
// that cbam-app.ts calls those exactly as it always has; this module only places their output.
import Decimal from 'decimal.js';
import type { CertificateEstimate, DataTier, EstimateFigure } from '../cbam-algos/cbam/certificate-estimate.ts';
import {
  formatDecimal, formatPackDate, renderOutlookNotes, unpricedYears, type Outlook, type OutlookFigureYear,
} from '../cbam-outlook.ts';
import { MIXED_RESIDUAL_INDIRECT_NOTE, RESIDUAL_BASIS_NOTE } from '../cbam-algos/cbam/certificate-estimate.ts';
import { renderFingerprint } from './fingerprint.ts';
import { ILL, insertIll } from './illustrations.ts';
import {
  esc, eur, inputRefusal, num, originBasisLabel, renderPriceRow, snapshotLabel, tierLabel, whatIfTag,
} from './format.ts';

type Priced = Exclude<CertificateEstimate, { status: 'unavailable' }>;

/** The engine's figure for a priced line: the final figure, or the labelled what-if. */
const figureOf = (e: Priced): EstimateFigure => (e.status === 'cscf_pending' ? e.scenario : e.figure);

/** Colour law (spec §3): bronze = Commission default, cyan = verified, ink = neither alone. */
export function tierTone(tier: DataTier): 'bronze' | 'cyan' | 'ink' {
  switch (tier) {
    case 'default+markup': return 'bronze';
    case 'actual-verified': return 'cyan';
    case 'verified-direct+default-indirect': return 'ink';
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

/** The status tag, in renderResult's own words: the tag is what tells a figure from a refusal. */
function statusTag(e: CertificateEstimate, hook = 'cb-tag'): string {
  let tone: 'ok' | 'pending' | 'unavail';
  let text: string;
  switch (e.status) {
    case 'ok': tone = 'ok'; text = 'Priced'; break;
    case 'zero_by_fiat': tone = 'ok'; text = 'Priced · free allocation nil by law'; break;
    case 'cscf_pending': return whatIfTag(e.cscfYear, hook);
    case 'unavailable': tone = 'unavail'; text = 'No estimate'; break;
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
  return `<span class="b-tag${hook ? ` ${hook}` : ''} ${tone}">${esc(text)}</span>`;
}

function hero(e: CertificateEstimate, importDate: string, attestation: string): string {
  // Colour is provenance only: a refusal has no Commission figure to mark, so its chip is neutral ink.
  const tone = e.status === 'unavailable' ? 'ink' : tierTone(e.stamp.tier);
  const head = '<div class="b-t-h"><div><h3 class="b-t-ti">Certificates.</h3>'
    + `<p class="b-t-sub">Import of ${esc(formatPackDate(importDate))}</p></div>`
    + `<span class="chip ${tone}"><i></i>${esc(tierLabel(e.stamp.tier))}</span></div>`;
  if (e.status === 'unavailable') {
    // NON-NEGOTIABLE 2: no figure block, no cost, no zero. The reason and the selector, verbatim.
    const sel = e.selector
      ? `<div class="cb-sel"><span>${inputRefusal(e.selector) ? 'Refused input' : 'Missing rule'}</span>`
        + `<code>${esc(e.selector)}</code></div>`
      : '';
    return `<section class="b-t b-hero b-s2 cb-res cb-unavail">${head}<div class="b-tags">${statusTag(e)}</div>`
      + `<p class="cb-reason">${esc(e.reason)}</p>${sel}`
      + '<p class="b-t-sub">We show no deduction rather than guess one. Picking a nearby benchmark '
      + 'would produce a number that looks authoritative and is not.</p>'
      + `${attestation}</section>`;
  }
  const f = figureOf(e);
  let note: string;
  switch (e.status) {
    case 'ok':
      note = `<p class="b-t-sub">Cross-sectoral correction factor ${esc(e.cscf)}</p>`;
      break;
    case 'zero_by_fiat':
      note = `<p class="b-t-sub">No free allocation applies · ${esc(e.locator)}</p>`;
      break;
    case 'cscf_pending':
      // NON-NEGOTIABLE 3, word for word renderResult's paragraph (a twin test compares the two).
      note = '<p class="b-t-sub cb-warn">Not a final figure. The Commission has not published the '
        + `cross-sectoral correction factor for ${esc(String(e.cscfYear))}; this assumes `
        + `CSCF&nbsp;=&nbsp;${esc(e.scenario.assumedCscf)}, the largest the factor can legally be `
        + '(the last value actually set, 2021–25). CSCF only ever reduces the free allocation that '
        + 'offsets a bill, so this is a floor: the real figure cannot be lower, and may be higher.</p>';
      break;
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
  return `<section class="b-t b-hero b-s2 cb-res">${head}`
    + `<div class="b-mega cb-fig"><span class="cb-n">${num(f.certificates)}</span></div>`
    + '<p class="b-t-sub cb-u">certificates</p>'
    + `<div class="b-tags">${f.costEur ? `<span class="b-tag cb-cost">${eur(f.costEur)}</span>` : ''}${statusTag(e)}</div>`
    + `${renderPriceRow(e)}${note}${attestation}</section>`;
}

export interface ChargeableSplit { chargeablePct: string; restPct: string; floored: boolean }

/**
 * The share of the embedded emissions that is charged, to 1 dp half up, and its complement (so
 * the two always sum to 100.0). Null when nothing is embedded: no share is invented. `floored`
 * is the engine's own floor, max(0, direct − free allocation): FA larger than the direct term.
 */
export function chargeableSplit(directTco2e: string, f: EstimateFigure): ChargeableSplit | null {
  const total = new Decimal(f.totalEmbeddedTco2e);
  if (!total.isFinite() || total.lte(0)) return null;
  const pct = new Decimal(f.netTco2e).div(total).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  return {
    chargeablePct: pct.toFixed(1),
    restPct: new Decimal(100).minus(pct).toFixed(1),
    floored: new Decimal(f.faaTco2e).gt(directTco2e),
  };
}

/** Under this share the fill cannot hold its own text, so it is drawn as a strip (decision 5). */
const LOW_SHARE = 40;

/**
 * Decision 4A. When the SMALLER of the two shares is under this, the proportional blocks leave it a
 * sliver too narrow for its own label (8.2 % of a 560 px tile is ~30 px), so the tile draws a
 * full-width bar to scale with two label tiles beneath it. From this share up to its complement the
 * tile is the card it always was.
 */
const STRIP_BELOW = 20;

/**
 * Which layout the Chargeable tile takes for a displayed chargeable share (1 dp, as chargeableSplit
 * returns it): 'strip' when the smaller share is under 20 %, so chargeable under 20.0 or over 80.0;
 * exactly 20.0 and 80.0 are still blocks. No split (nothing embedded) stays on the blocks: there is
 * no share to draw to scale and none is invented.
 */
export function splitLayout(chargeablePct: string | null): 'blocks' | 'strip' {
  if (chargeablePct === null) return 'blocks';
  const smaller = Decimal.min(chargeablePct, new Decimal(100).minus(chargeablePct));
  return smaller.lt(STRIP_BELOW) ? 'strip' : 'blocks';
}

function chargeable(e: CertificateEstimate): string {
  // No priced figure, no tile: an empty plate with a bare title would claim a share it does not have.
  if (e.status === 'unavailable') return '';
  const f = figureOf(e);
  const split = chargeableSplit(e.emissionsTco2e, f);
  const low = !split || Number(split.chargeablePct) < LOW_SHARE;
  const share = (v: string | undefined): string => (v === undefined ? '—' : `${v}<span class="b-u">%</span>`);
  // The indirect term is its OWN tag, never folded into "embedded" (pinned in cbam-render.test.mjs).
  const indirect = Number(f.indirectTco2e) > 0
    ? `<span class="b-tag">+ Indirect (electricity) · no free allocation · ${num(f.indirectTco2e)} tCO₂e</span>`
    : '';
  // A what-if figure wears the hero's tag wherever it is drawn (the e2e hook stays on the hero alone).
  const whatIf = e.status === 'cscf_pending' ? statusTag(e, '') : '';
  // Floored: free allocation exceeds the direct emissions, so "100 − chargeable" is NOT its share.
  // Print the terms renderWaterfall printed instead of a percentage that would be false.
  const rest = split?.floored
    ? '<h3 class="b-t-ti">Free allocation.</h3>'
      + '<dl class="kv">'
      + `<div><dt>− Free allocation</dt><dd>${num(f.faaTco2e)} tCO₂e</dd></div>`
      + `<div><dt>= Chargeable</dt><dd>${num(f.netTco2e)} tCO₂e</dd></div>`
      + `<div><dt>CBAM factor ${esc(String(e.terms.cbamFactorYear))}</dt><dd>${esc(e.terms.cbamFactor)}</dd></div></dl>`
      + '<p class="b-t-sub">Free allocation exceeds the direct emissions, so the direct charge is zero. It never goes below zero.</p>'
    : '<h3 class="b-t-ti">Free allocation.</h3>'
      + `<div class="b-mid">${share(split?.restPct)}</div>`
      + `<p class="b-t-sub">${num(f.faaTco2e)} tCO₂e · CBAM factor ${esc(String(e.terms.cbamFactorYear))} ${esc(e.terms.cbamFactor)}</p>`;
  const tags = `<div class="b-tags">${whatIf}<span class="b-tag">Embedded emissions (direct) · ${num(e.emissionsTco2e)} tCO₂e</span>${indirect}</div>`;
  const tone = tierTone(e.stamp.tier);
  if (split && splitLayout(split.chargeablePct) === 'strip') {
    // Decision 4A. The bar is true to scale, with no minimum width on either segment (the widths are
    // the displayed shares, which sum to 100). The label tiles sit beneath it, each with all the room
    // it needs. Floored: the free-allocation tile carries the terms, never a percentage.
    const freeBody = split.floored
      ? rest.replace('<h3 class="b-t-ti">Free allocation.</h3>', '')
      : `<div class="b-mid">${share(split.restPct)}</div>`
        + `<p class="b-t-sub">${num(f.faaTco2e)} tCO₂e · CBAM factor ${esc(String(e.terms.cbamFactorYear))} ${esc(e.terms.cbamFactor)}</p>`;
    const label = split.floored
      ? `${split.chargeablePct}% chargeable, the rest covered by free allocation`
      : `${split.chargeablePct}% chargeable, ${split.restPct}% free allocation`;
    const stripHtml = `<section class="b-t b-fill b-s2 b-fill-${tone} b-fill-strip">`
      + `<div class="b-sp-bar" role="img" aria-label="${label}">`
      + `<i class="b-sp-bc" style="width:${split.chargeablePct}%"></i><i class="b-sp-bf" style="width:${split.restPct}%"></i></div>`
      + '<div class="b-sp-lg">'
      + `<div class="b-sp-c"><h3 class="b-t-ti">Chargeable.</h3><div class="b-mid">${share(split.chargeablePct)}</div>`
      + `<p class="b-t-sub">${num(f.netTco2e)} tCO₂e</p></div>`
      + `<div class="b-sp-f"><h3 class="b-t-ti">Free allocation.</h3>${freeBody}</div></div>`
      + `${tags}</section>`;
    // No drawing on the strip: the reference has no such layout (decision 4A is later), its two label tiles
    // have no room for a 180 px factory beside a 44 px numeral, and a unit test pins their markup byte for byte.
    return stripHtml;
  }
  const blocksHtml = `<section class="b-t b-fill b-s2 b-fill-${tone}${low ? ' b-fill-low' : ''}" `
    + `style="--share:${split ? split.chargeablePct : '0'}%">`
    + '<i class="b-fl-bar" aria-hidden="true"></i>'
    + '<div class="b-fl-in"><h3 class="b-t-ti">Chargeable.</h3>'
    + `<div class="b-mid">${share(split?.chargeablePct)}</div>`
    + `<p class="b-t-sub">${num(f.netTco2e)} tCO₂e</p></div>`
    + '<div class="b-fl-rest">'
    + `${tags}${rest}</div></section>`;
  return insertIll(insertIll(blocksHtml, ILL.fac, 'b-fl-in'), ILL.vou, 'b-fl-rest');
}

/** The deck's shell; paintOutlook (cbam-app.ts) fills [data-deck] from the outlook it computes. */
const DECK_SHELL = '<section class="b-t b-s2 b-yrs" aria-live="off">'
  + '<button type="button" class="b-go" data-goto="three-years" aria-label="Open Three years">'
  + '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4 10 10 4M5 4h5v5"/></svg></button>'
  + '<h3 class="b-t-ti">Three years.</h3><div data-deck></div></section>';

const PROVENANCE_EMPTY = '<section class="b-t b-s2 b-prov"><div class="b-pv"><h3 class="b-t-ti">Provenance.</h3></div></section>';

/** NON-NEGOTIABLE 5: the stamp on every branch, refusals included. Notes fold (spec §5.1). */
function provenance(e: CertificateEstimate): string {
  const s = e.stamp;
  const rows: [string, string][] = [
    ['Data tier', tierLabel(s.tier)],
    ['Origin basis', originBasisLabel(s.originBasis)],
    ['Rule packages', s.rulePackages.join(' · ') || '—'],
    ['Snapshot', snapshotLabel(s.snapshotHash)],
  ];
  // The residual-bucket disclosures are claims about the figure itself: printed open, as the old card
  // printed them. Every other note folds.
  const isResidual = (n: string): boolean => n === RESIDUAL_BASIS_NOTE || n === MIXED_RESIDUAL_INDIRECT_NOTE;
  const items = (ns: readonly string[]): string => ns.map((n) => `<li class="foot">${esc(n)}</li>`).join('');
  const open = s.notes.filter(isResidual);
  const folded = s.notes.filter((n) => !isResidual(n));
  const notes = (open.length ? `<ul class="notes cb-notes">${items(open)}</ul>` : '')
    + (folded.length
      ? `<details class="disc quiet"><summary><span>Notes · ${folded.length}</span>`
        + `<span class="chev" aria-hidden="true">›</span></summary><ul class="notes cb-notes">${items(folded)}</ul></details>`
      : '');
  return `<section class="b-t b-s2 b-prov">${renderFingerprint(s.snapshotHash)}<div class="b-pv">`
    + '<h3 class="b-t-ti">Provenance.</h3>'
    + `<dl class="kv">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
    + (s.provisional ? '<p class="b-t-sub cb-prov">Provisional — at least one input is not final</p>' : '')
    + `${notes}</div></section>`;
}

export interface EstimateTilesInput {
  estimate: CertificateEstimate;
  /** The form's import date (ISO day), for "Import of 15 Mar 2026". */
  importDate: string;
  /** renderDraftThreshold's output, '' when no card is owed. Rendered first: its copy says "below". */
  threshold: string;
  /** renderAttestation(…, hasFigure(e))'s output, '' for a default line. Placed whole in the hero. */
  attestation: string;
}

export function renderEstimateTiles(t: EstimateTilesInput): string {
  const thresh = t.threshold ? `<div class="b-s2 b-legacy cb-out">${t.threshold}</div>` : '';
  return thresh + hero(t.estimate, t.importDate, t.attestation) + chargeable(t.estimate) + DECK_SHELL
    + provenance(t.estimate);
}

/** Every pre-engine state (incomplete form, no route, mass or verified refusal): the message, escaped. */
export function renderEstimateIdle(message: string): string {
  return `<section class="b-t b-hero b-s2"><h3 class="b-t-ti">Certificates.</h3><p class="cb-idle">${esc(message)}</p></section>`
    + DECK_SHELL + PROVENANCE_EMPTY;
}

/** The engine threw (a DomainError names what is missing): show it, never a generic failure. */
export function renderEstimateThrown(message: string): string {
  return '<section class="b-t b-hero b-s2 cb-res cb-unavail"><div class="b-t-h"><h3 class="b-t-ti">Certificates.</h3>'
    + `<span class="b-tag cb-tag unavail">No estimate</span></div><p class="cb-reason">${esc(message)}</p></section>`
    + DECK_SHELL + PROVENANCE_EMPTY;
}

/* ── the Three-years deck (filled into [data-deck] by paintOutlook) ──────────── */

/** "+29.6%", "−3.1%", "0.0%": exact, one decimal, half up (the strip's own rule). */
const signedPct = (v: string): string => {
  const text = formatDecimal(v, 1, true);
  return text.startsWith('−') || new Decimal(v).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).isZero()
    ? `${text}%` : `+${text}%`;
};

const yearList = (ys: readonly number[]): string => (ys.length <= 1
  ? ys.join('')
  : `${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]}`);

/**
 * The deck: one plate per covered year, the count to 1 dp (the strip's precision), or "No
 * estimate" with the engine's reason beneath. Counts only, never euros: the costs live on the
 * Three years view, which states whose price each one is.
 */
export function renderDeck(view: Outlook | null, massT: string): string {
  if (!view) return '';
  const figs = view.years.filter((y): y is OutlookFigureYear => y.kind === 'figure');
  const allDefault = figs.length > 0 && figs.every((y) => y.tier === 'default+markup');
  const markups = figs.map((y) => y.directMarkupPct);
  const markup = figs.length === view.years.length && markups.every((m): m is string => m !== null)
    ? ` Mark-up ${markups.map((m) => formatDecimal(m, 2, false)).join(' → ')}%.`
    : '';
  const plates = view.years.map((y, i) => (y.kind === 'figure'
    ? `<li class="b-st b-st${i}"><span>${y.year}</span><b>${formatDecimal(y.certificates, 1, true)}</b></li>`
    : `<li class="b-st b-st${i} b-st-none"><span>${y.year}</span><b>No estimate</b></li>`)).join('');
  const foot: string[] = [];
  const first = view.years[0];
  const last = view.years[view.years.length - 1];
  if (first.kind === 'figure' && last.kind === 'figure' && last !== first && last.riseOnFirstPct !== null) {
    foot.push(`${signedPct(last.riseOnFirstPct)} by ${last.year}`);
  }
  const unpriced = unpricedYears(view);
  if (unpriced.length) foot.push(`No certificate price published for the ${yearList(unpriced)} imports`);
  const reasons = new Map<string, number[]>();
  for (const y of view.years) {
    if (y.kind === 'refused') reasons.set(y.reason, [...(reasons.get(y.reason) ?? []), y.year]);
  }
  const why = [...reasons].map(([r, ys]) => `<p class="b-help">${yearList(ys)}: ${esc(r)}</p>`).join('');
  return `<p class="b-t-sub">Same line, same ${esc(massT)} t.${markup}</p>`
    + `<ol class="b-stack ${allDefault ? 'b-stack-bz' : 'b-stack-ink'}">${plates}</ol>`
    + (foot.length ? `<p class="b-t-foot">${foot.map(esc).join(' · ')}</p>` : '')
    + why
    // The strip's own notes (the CSCF caveat, each pending price row's locator), under the deck's class:
    // the counts are never shown without them, and cb-ol-note stays off the deck (e2e reads cb-ol-*).
    + renderOutlookNotes(view).replace(/cb-ol-note/g, 'b-help');
}
