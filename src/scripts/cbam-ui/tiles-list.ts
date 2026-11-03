// src/scripts/cbam-ui/tiles-list.ts
// The Shipment list view's tiles (spec §5.4): Total, Annual de minimis per year, one plate per line.
// Pure functions returning HTML strings, the same pattern as every other CBAM renderer.
//
// THE RULE FOR EVERY TILE IN THIS FILE. The honesty markup inside a tile — each cb-tag span, each
// <p class="cb-sub"> sentence, the attest label, cb-fig / cb-n / cb-u / cb-cost, cb-prov — is
// emitted byte-for-byte as the pre-redesign cards emitted it, because tests/unit/cbam-render.test.mjs
// pins it exactly, closed at both ends, against paraphrase. The b- classes go on the tile shell and
// on new presentational elements only. Restyle a cb-* hook in cbam-bento.css; never rename it here.
//
// The prose helpers below moved here from cbam-app.ts, which imports them back: the List tiles,
// the Estimate draft card, the #cbStatus announcement and the print document must say a verdict
// with ONE spelling, and they can only do that if they read the same function.
import Decimal from 'decimal.js';
import type { Line, Totals, YearThreshold } from '../cbam-lines.ts';
import { esc, eur, num } from './format.ts';
import { ILL, insertIll } from './illustrations.ts';

/**
 * The 50 t de minimis figure itself lives in the consolidated Art 2(3); this is the amending act
 * that put it there. Both threshold cards cite it (single-line and per-year) — one constant so
 * the citation can't drift between them.
 */
export const AMENDED_BY_2025_2083 = 'as amended by Reg (EU) 2025/2083';

/**
 * How a threshold sector KEY is said on either threshold card — and, where a card names several,
 * in the order it says them. An ordered list rather than a map, because it settles both questions
 * at once and they are both load-bearing.
 *
 * THE PROSE IS NOT THE KEY, and no transformation gets from one to the other. `iron_and_steel` is
 * said "iron & steel" (an ampersand, not "and"), and `fertilisers` is said "fertiliser" (singular,
 * from a plural key). A `.replace(/_/g, ' ')` — the obvious shortcut — is wrong on two of the four
 * keys the shipped pack contains, which is why unknown keys below are not passed through one.
 *
 * THE ORDER IS NOT THE PACK'S. The shipped 2026 row lists cement, aluminium, fertilisers,
 * iron_and_steel; the per-year verdict has always read cement, iron & steel, aluminium and
 * fertiliser. Rendering in pack order would have silently re-ordered live legal copy. So known
 * sectors are named in THIS list's order, whatever order the row happens to store them in. The
 * single-line card names one sector and so has no order to get wrong — it needs only the prose.
 */
export const SECTOR_PROSE: ReadonlyArray<readonly [key: string, prose: string]> = [
  ['cement', 'cement'],
  ['iron_and_steel', 'iron & steel'],
  ['aluminium', 'aluminium'],
  ['fertilisers', 'fertiliser'],
];

/**
 * "cement, iron & steel, aluminium and fertiliser" — a threshold row's sectors, said the way the
 * cards say them. PLAIN TEXT, escaped by the caller: the ampersand in 'iron & steel' has to
 * reach esc() as a bare '&' to come out as '&amp;', and a key arriving from pack JSON is
 * untrusted input that must be escaped like any other.
 *
 * TWO CALLERS, AND ONE OF THEM HANDS IT A SINGLE SECTOR. renderYearThreshold passes a whole row's
 * `includedSectors`; renderThreshold passes `[t.sector]`, the one sector its line belongs to. The
 * `< 2` branch below is what serves that call — it returns the bare prose with no "and" — so it
 * is not dead code guarding only the empty row, and must not be narrowed to a length-0 test.
 *
 * AN UNKNOWN KEY IS PRINTED VERBATIM, underscores and all. Not prettified: this file cannot know
 * what the Commission calls a sector it has never seen, and the two counter-examples above prove
 * a mechanical guess gets it wrong more often than not. A key rendered raw reads as a datum and
 * tells a maintainer to add a line to SECTOR_PROSE; a key rendered as "organic chemicals" reads
 * as reviewed copy and would ship a name nobody chose, on the one sentence in this card that
 * states what was actually measured. Awkward and honest over fluent and possibly wrong.
 *
 * Unknowns are named LAST, in the row's own order — they cannot be placed in a prose order that
 * does not yet include them, and appending keeps the four known sectors reading exactly as they
 * always have when a fifth is added.
 *
 * An empty row yields '' and the sentence reads "Your imports for…". Deliberately unguarded: HTML
 * collapses the doubled space, and there is no honest word to substitute for a list of sectors a
 * rule declined to name. A row that measures nothing is a pack defect, and the card would already
 * be reporting 0 t beside it.
 */
export const sectorList = (sectors: readonly string[]): string => {
  const known = SECTOR_PROSE.filter(([key]) => sectors.includes(key)).map(([, prose]) => prose);
  const unknown = sectors.filter((s) => !SECTOR_PROSE.some(([key]) => key === s));
  const names = [...known, ...unknown];
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/**
 * The per-year card's own tag text — for BOTH branches of the union, including the year that has
 * no threshold row in this tool's pack. Reused by #cbStatus's multi-line announcement (renderAll, initCbam)
 * for the same reason totalsTag is: with the results panel's aria-live turned off in multi-line
 * mode, the announcement is the only thing a screen-reader user hears — and a year's verdict can
 * flip from "indeterminate" to "below threshold" as a DIRECT result of the user ticking their own
 * attestation checkbox. Reusing this function, rather than a second phrasing in the announcement,
 * is what keeps the spoken verdict from ever disagreeing with the card's own.
 *
 * Takes the FULL `YearThreshold` union, not just its `ruleFound: true` member: the announcement
 * must say something for a year with no threshold row too — a sighted user gets an explicit "Year
 * not covered" card for it, and silently skipping that year in the announcement would be the
 * same "sighted users only" gap this whole reuse pattern exists to close, just a milder one
 * (omission, not misstatement).
 */
export const yearVerdictTag = (y: YearThreshold): string => {
  if (!y.ruleFound) return 'Year not covered';
  return y.state === 'above_threshold' ? 'Above threshold' : y.state === 'below_threshold' ? 'Below threshold' : 'Indeterminate';
};

/**
 * "N line(s) has/have no estimate and is/are excluded…" — the pluralisation was duplicated
 * verbatim at both renderTotals call sites below; one helper means it can only disagree with
 * itself if this function's own logic is wrong, not by the two copies drifting apart.
 *
 * Also reused by initCbam's #cbStatus announcement (renderAll) — the multi-line panel's
 * aria-live region is turned off (see renderAll's own doc), so this note is the ONLY way a
 * screen-reader user learns a line was refused; a refusal only sighted users learn about is not
 * a refusal. Reusing this exact function, rather than writing the announcement's own phrasing,
 * is what keeps the spoken text from ever disagreeing with the visible card about which lines
 * were excluded or how many.
 */
export const refusedLineNote = (refusedLines: number) =>
  `${refusedLines} line${refusedLines === 1 ? ' has' : 's have'} no estimate and ${
    refusedLines === 1 ? 'is' : 'are'} excluded from this total.`;

/**
 * The totals card's own tag text — "What-if · CSCF unpublished" vs "Priced". Also reused by the
 * #cbStatus announcement (renderAll), for the same reason refusedLineNote is: with the panel's
 * aria-live off in multi-line mode, the announcement is the only thing a screen-reader user
 * hears, and it must not state a pending, assumed-CSCF scenario as a settled euro figure when
 * the visible card right next to it says otherwise — the exact false-certainty failure the §4
 * caveats and the cscf_pending status exist to prevent everywhere else in this file.
 */
export const totalsTag = (anyPending: boolean) => (anyPending ? 'What-if · CSCF unpublished' : 'Priced');

type FoundYear = Extract<YearThreshold, { ruleFound: true }>;

/**
 * The uncovered-year sentence, already escaped. One spelling for the draft card and the List tile.
 *
 * It says what the TOOL carries, not what the law publishes. Reg (EU) 2023/956 Art 2a sets 50 t
 * per calendar year with no end date, so "no threshold has been published" is false for every
 * year; the pack's threshold table is simply finite, and only a year past its last row lands here.
 */
export const noRuleSentence = (calendarYear: number): string =>
  `This tool does not carry the de minimis threshold for ${esc(String(calendarYear))}, so it shows no verdict rather than assume one.`;

/**
 * The verdict sentence for a year with a published rule — the text inside its <p class="cb-sub">.
 * Moved verbatim out of renderYearThreshold so the List tile and the draft card share it.
 */
export function yearSentence(y: FoundYear): string {
  const above = y.state === 'above_threshold';
  const below = y.state === 'below_threshold';
  // Art 2(3) is a MASS test over four sectors, so a hydrogen or electricity line is rightly
  // outside the basis — and the verdict used to generalise that into "an importer owes nothing
  // for the year". MEASURED: 40 t cement + 1000 t hydrogen rendered "owes nothing for 2026"
  // beside EUR 525,302.23 (the hydrogen line alone was EUR 523,015.36) on the same page.
  // COUNTED, NEVER EXPLAINED PER LINE: two filters run in series (ours on rule.includedSectors,
  // aggregateThresholdBasis's own massSectors) and eligibleLineCount's own doc warns they agree
  // today only by coincidence of the shipped 2026 row, so naming a cause for a specific line
  // would be a claim this card cannot support. It says how many, and what the test measures.
  const excluded = y.linesInYear - y.eligibleLineCount;
  const outside = excluded === 0 ? '' : ` ${excluded} of your ${y.linesInYear} lines for ${esc(String(y.calendarYear))} ${excluded === 1 ? 'is' : 'are'} outside that test — goods not measured by mass for de minimis, such as hydrogen and electricity, are chargeable regardless. This verdict does not mean you owe nothing.`;
  const sub = above
    ? `The listed ${esc(String(y.calendarYear))} imports exceed the threshold; the exemption does not apply.`
    : below
      // The sectors come from the CARD (y.includedSectors, straight off the year's own threshold
      // row) — they used to be four words typed into this string. The row is data: the day the
      // Commission widens it, this sentence would have gone on naming the old four beside a mass
      // computed from the new set, stating the wrong basis with nothing to catch it. See
      // sectorList for why the prose is a table rather than a transformation of the keys, and why
      // its order is not the row's.
      ? `Your ${esc(sectorList(y.includedSectors))} imports for ${esc(String(y.calendarYear))} total ${num(y.knownEligibleMassT)}&nbsp;t, below the ${num(y.thresholdT)}&nbsp;t threshold for those sectors.${outside} This verdict rests on your attested statement that the list is complete — it is your completeness claim, verified by no one, not by the Commission or by us.`
      : `Under the threshold so far, but unattested. Tick the box only if this list is genuinely every ${esc(String(y.calendarYear))} CBAM import; the verdict is only as good as that statement.`;
  return sub;
}

/** The completeness checkbox, or '' when the year is above the threshold (a fact needs no attestation). */
export function attestControl(y: FoundYear): string {
  const above = y.state === 'above_threshold';
  const attest = above ? '' : `
    <label class="cb-attest">
      <input type="checkbox" data-attest="${esc(String(y.calendarYear))}" ${y.attested ? 'checked' : ''} />
      These are all my ${esc(String(y.calendarYear))} imports of CBAM goods
    </label>`;
  return attest;
}

/**
 * The de minimis ruler: 0 to the next whole multiple of the threshold at or above the mass, and
 * never less than twice the threshold, so the threshold mark is always visible and never at the end.
 * Percentages to 1 dp, ROUND_HALF_UP. Null when either value is not a readable non-negative number
 * (or the threshold is not positive): the tile then draws no ruler, never a guessed one.
 */
export function rulerScale(massT: string, thresholdT: string): { fillPct: string; markPct: string; maxT: string } | null {
  let m: Decimal;
  let t: Decimal;
  try { m = new Decimal(massT); t = new Decimal(thresholdT); } catch { return null; }
  if (!m.isFinite() || !t.isFinite() || m.isNeg() || t.lte(0)) return null;
  const max = t.times(Decimal.max(2, m.div(t).ceil()));
  const pct = (x: Decimal) => x.div(max).times(100).toFixed(1, Decimal.ROUND_HALF_UP);
  return { fillPct: pct(m), markPct: pct(t), maxT: max.toString() };
}

/**
 * One Annual de minimis plate per calendar year in the list (spec §5.4). The successor of
 * renderYearThreshold on the List view: same tag, same sentence, same checkbox, same citation,
 * drawn as a tile with the eligible mass as its numeral and a ruler against the threshold.
 */
export function yearTile(y: YearThreshold): string {
  const year = esc(String(y.calendarYear));
  if (!y.ruleFound) return `
    <section class="b-t b-s2 cb-thresh">
      <div class="b-t-h"><div><h2 class="b-t-ti">Annual de minimis, ${year}.</h2></div>
        <span class="cb-tag pending">${esc(yearVerdictTag(y))}</span></div>
      <p class="cb-sub">${noRuleSentence(y.calendarYear)}</p>
    </section>`;
  const above = y.state === 'above_threshold';
  const below = y.state === 'below_threshold';
  // The same tones as renderYearThreshold: indeterminate is 'pending', never the 'ok' of a real verdict.
  const tone = above ? 'unavail' : below ? 'ok' : 'pending';
  const n = y.eligibleLineCount;
  const r = rulerScale(y.knownEligibleMassT, y.thresholdT);
  const ruler = r ? `
      <div class="b-thr" aria-hidden="true"><b style="width:${r.fillPct}%"></b><em style="left:${r.markPct}%"></em></div>
      <p class="b-t-foot num"><span>0</span><span>${num(y.thresholdT)} t threshold</span><span>${num(r.maxT)} t</span></p>` : '';
  const plate = `
    <section class="b-t b-s2 cb-thresh">
      <div class="b-t-h"><div><h2 class="b-t-ti">Annual de minimis, ${year}.</h2><p class="b-t-sub">Eligible mass · ${n} line${n === 1 ? '' : 's'}</p></div>
        <span class="cb-tag ${tone}">${esc(yearVerdictTag(y))}</span></div>
      <div class="b-mid num">${num(y.knownEligibleMassT)}<span class="b-u">t</span></div>${ruler}
      <p class="cb-sub">${yearSentence(y)}</p>
      ${attestControl(y)}
      <p class="cb-prov">${esc(y.sourceLocator)} · ${AMENDED_BY_2025_2083}</p>
    </section>`;
  // Plan 05, P5-3: the needle sits near the top of the arc, so it is drawn only where the verdict is "above".
  return above ? insertIll(plate, ILL.gauge, 'b-t') : plate;
}

/**
 * The summed exposure. A total containing any what-if is itself a what-if, and a total with no
 * priced lines at all (Totals.certificates === '0' both for "genuinely zero" and "nothing was
 * summed", per that field's own doc in cbam-lines.ts) must never render as a confirmed zero —
 * hence its own states below, distinct from a real "Priced" verdict at 0.
 *
 * pricedLines === 0 is itself two different situations, distinguishable from Totals' EXISTING
 * fields with no new signal needed: refusedLines === 0 means no line was even entered yet (a
 * neutral empty state — nobody has done anything wrong); refusedLines > 0 means every entered
 * line failed closed (a real "nothing here priced" warning). Showing the same red tag for both
 * would make an empty form look like a form full of refusals.
 *
 * Rail phase 4: drawn as the List's hero tile. The tag span, figure block, sentences and exempt note
 * are the pre-redesign card's, byte for byte; `shares` are the priced, non-exempt lines' shares of
 * this total, in list order, for the stack bar.
 */
export function totalTile(t: Totals, exempt: Totals | null = null, shares: readonly string[] = []): string {
  // C2 (audit 2026-11-02): lines an attested below-threshold year exempts are summed apart and
  // shown OUTSIDE the total. Before, "Below threshold" sat beside a total that still billed them.
  const exemptNote = exempt && exempt.pricedLines > 0
    ? `<p class="cb-sub cb-exempt"><b>Exempt if your list is complete:</b> ${exempt.pricedLines} line${
        exempt.pricedLines === 1 ? '' : 's'} below the de minimis threshold for the year you attested, ${
        num(exempt.certificates)} certificates${exempt.costEur ? ` · ${eur(exempt.costEur)}` : ''}${
        exempt.anyPending ? ' (a what-if: the CSCF is unpublished)' : ''} — not included in the total.</p>`
    : '';
  const head = (sub: string, tone: string, tag: string) => `
      <div class="b-t-h"><div><h2 class="b-t-ti">Total.</h2><p class="b-t-sub">${sub}</p></div>
        <span class="cb-tag ${tone}">${esc(tag)}</span></div>`;
  const actions = `
      <div class="b-row2"><button type="button" class="btn b-add" data-goto="export">Export</button><button type="button" class="btn b-ghost" data-goto="estimate">Add a line</button></div>`;
  if (t.pricedLines === 0 && t.refusedLines === 0 && exemptNote) return `
    <section class="b-t b-s2 b-hero cb-total">${head('Total exposure', 'ok', 'Below threshold')}
      <p class="cb-sub">Nothing owed on the lines listed, on your statement that they are all your imports for the year.</p>
      ${exemptNote}${actions}
    </section>`;

  if (t.pricedLines === 0 && t.refusedLines === 0) return `
    <section class="b-t b-s2 b-hero cb-total">${head('Total exposure', 'pending', 'No lines yet')}
      <p class="cb-sub">Add at least one line to see a total.</p>
    </section>`;

  if (t.pricedLines === 0) return `
    <section class="b-t b-s2 b-hero cb-total">${head('Total exposure', 'unavail', 'Nothing priced')}
      <p class="cb-sub">No line has a priced estimate, so there is no total to show — not even a zero. ${
        refusedLineNote(t.refusedLines)}</p>
      ${exemptNote}${actions}
    </section>`;

  const tone = t.anyPending ? 'pending' : 'ok';
  const tag = totalsTag(t.anyPending);
  const bar = shares.length
    ? `<div class="b-stackbar" aria-hidden="true">${shares.map((s) => `<b style="flex:${esc(s)}"></b>`).join('')}</div>`
    : '';
  const figures = `
    <section class="b-t b-s2 b-hero cb-total">${head(`Total exposure · ${t.pricedLines} line${t.pricedLines === 1 ? '' : 's'}`, tone, tag)}
      <div class="cb-fig"><span class="cb-n">${num(t.certificates)}</span></div>
      <div class="cb-u">certificates</div>
      ${t.costEur ? `<div class="cb-cost">${eur(t.costEur)}</div>`
        : '<div class="cb-sub">No € total — at least one line has no published certificate price.</div>'}
      ${t.refusedLines ? `<p class="cb-sub cb-warn">${refusedLineNote(t.refusedLines)}</p>` : ''}
      ${exemptNote}${bar}${actions}
    </section>`;
  return insertIll(figures, ILL.box, 'b-t');
}

/**
 * A line's share of the total, in percent to 1 dp (ROUND_HALF_UP), or null when there is no real
 * positive total to be a share of — a zero or unreadable total gives no share, never "0%".
 */
export function shareOfTotal(part: string, total: string): string | null {
  let p: Decimal;
  let t: Decimal;
  try { p = new Decimal(part); t = new Decimal(total); } catch { return null; }
  if (!p.isFinite() || !t.isFinite() || p.isNeg() || t.lte(0)) return null;
  return p.div(t).times(100).toFixed(1, Decimal.ROUND_HALF_UP);
}

/** The strings cbam-app.ts computes for a line (see renderLineCard): carried into the plate verbatim. */
export interface LinePlateParts { result: string; attestation: string; delta: string; tierLabel: string }
/** What the List knows about a line beyond its estimate. All optional: a bare plate is still honest. */
export interface LinePlateContext { goodName?: string; sharePct?: string | null; exempt?: boolean }

/**
 * The tier chip. Colour marks provenance only (spec §3): bronze for the Commission's default
 * values and mark-up, cyan for the importer's verified figures, and the mixed tier wears both,
 * each on the half it describes. Switched with `never`, so a fourth tier is a build error here.
 */
function tierChip(tier: Line['tier'], label: string): string {
  const chip = (tone: 'bronze' | 'cyan', text: string) => `<span class="chip ${tone}"><i aria-hidden="true"></i>${esc(text)}</span>`;
  switch (tier) {
    case 'default+markup': return chip('bronze', label);
    case 'actual-verified': return chip('cyan', label);
    case 'verified-direct+default-indirect': return chip('cyan', 'Verified direct') + chip('bronze', 'Commission indirect');
    default: {
      // A tier this build does not know draws no chip: the raw value is never echoed into the markup.
      // (The unit suite also builds lines with no `tier` at all, which predate the field.)
      const _exhaustive: never = tier;
      void _exhaustive;
      return '';
    }
  }
}

const lineHead = (line: Line, index: number, chips: string, goodName: string | undefined, summary: string) => `
      <div class="b-t-h"><h2 class="b-t-ti">Line ${index + 1}.</h2><span class="b-chips">${chips}</span></div>
      ${goodName ? `<p class="b-pass-name" title="${esc(goodName)}">${esc(goodName)}</p>` : ''}
      <p class="b-t-sub num cb-line-sum">${summary}</p>`;

const removeButton = (line: Line, index: number) =>
  `<button type="button" class="b-rm cb-line-x" data-remove="${esc(line.id)}" aria-label="Remove line ${index + 1}">Remove</button>`;

/** One plate per line (spec §5.4): the tile shell around the line's own result card. */
export function linePlate(line: Line, index: number, parts: LinePlateParts, ctx: LinePlateContext = {}): string {
  const share = ctx.exempt
    ? '<p class="b-share-row">Exempt if your list is complete · not in the total</p>'
    : ctx.sharePct
      ? `<div class="b-share-row"><span>Share of the total</span><span class="num">${esc(ctx.sharePct)}%</span></div><div class="b-share" aria-hidden="true"><b style="width:${esc(ctx.sharePct)}%"></b></div>`
      : '';
  return `
    <article class="b-t b-pass cb-line" data-line="${esc(line.id)}">${lineHead(line, index, tierChip(line.tier, parts.tierLabel), ctx.goodName,
      `${esc(line.cn)} · ${esc(line.country)} · ${esc(line.route)} · ${num(line.massT)} t · ${esc(line.date)}`)}
      ${share}
      ${parts.result}
      ${parts.attestation}
      ${parts.delta}
      ${removeButton(line, index)}
    </article>`;
}

/**
 * A line whose estimate THREW (safeEstimates in cbam-app.ts): its reason, verbatim, in place of
 * the figures, and no chip — no tier priced it. The summary keeps the old card's three fields.
 */
export function refusedLinePlate(line: Line, index: number, message: string, goodName?: string): string {
  return `
    <article class="b-t b-pass cb-line" data-line="${esc(line.id)}">${lineHead(line, index, '', goodName,
      `${esc(line.cn)} · ${esc(line.country)} · ${num(line.massT)} t`)}
      <div class="cb-res cb-unavail"><div class="cb-tag unavail">No estimate</div>
      <p class="cb-reason">${esc(message)}</p></div>
      ${removeButton(line, index)}
    </article>`;
}

/** thresholdByYear threw: the error, verbatim, where the year tiles would be. */
export function thresholdErrorTile(message: string): string {
  return `
    <section class="b-t b-s2 cb-thresh-error"><h2 class="b-t-ti">Annual de minimis.</h2>
      <div class="cb-res cb-unavail"><div class="cb-tag unavail">Threshold error</div>
      <p class="cb-reason">${esc(message)}</p></div>
    </section>`;
}

/** The List view: Total and the year tiles in one bento row, the line plates in three columns. */
export function listView(p: { total: string; years: string; plates: string }): string {
  return `<div class="b-bento b-list">${p.total}${p.years}</div><div class="b-bento b-c3">${p.plates}</div>`;
}
