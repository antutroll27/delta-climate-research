/**
 * The CBAM estimator's browser controller.
 *
 * WHAT THIS FILE IS AND IS NOT. Everything under cbam-algos/ EXCEPT this file was
 * copied byte-for-byte from the GeoCBAM SaaS and must never be edited here — it
 * is regulatory arithmetic guarded by 58 tests in its home repo, and two copies
 * that drift mean two different legal answers under one brand. This file is the
 * only original code: it loads the pack, drives the form, and renders whichever
 * branch of `CertificateEstimate` the engine returns.
 *
 * THE RENDERER IS THE RISKY PART, NOT THE MATHS. The portability dossier warned
 * that rebuilding the UI means re-implementing the honesty states by hand, and it
 * was right to. The mitigation is that the engine returns a four-branch
 * discriminated union and `renderResult` switches on it exhaustively, with a
 * `never` assertion in the default arm — so adding a fifth status upstream breaks
 * the build here rather than silently rendering nothing. tests/unit/cbam-render
 * asserts each branch shows what it is obliged to.
 *
 * THE FIVE NON-NEGOTIABLES (dossier §7) and where they live:
 *   1. framing banner ................ markup, always visible, not JS-dependent
 *   2. fail-closed refusal ........... `unavailable` renders NO figure at all
 *   3. CSCF-pending stays labelled ... `cscf_pending` renders a scenario, never a figure
 *   4. no filing/validation claim .... nothing here says "declaration" or "filed"
 *   5. residual-basis note travels ... stamp.notes rendered verbatim, every branch
 */
import {
  estimateFromPack, resolveThreshold, routesFor, selectIndirectFactorFromPack,
  type EstimatorInput, type EstimatorPack, type ThresholdView,
} from './estimator/estimate-from-pack.ts';
import type { CertificateEstimate } from './cbam/certificate-estimate.ts';
import {
  csvRows, lineFingerprint, packSnapshotHash, sumTotals, thresholdByYear, toCsv, yearOf,
  type Line, type Totals, type YearThreshold,
} from '../cbam-lines.ts';

const PACK_URL = '/cbam/estimator-pack.json';

/** The pack is 7.2 MB raw. Fetched once, on first interaction, never at page load. */
let packPromise: Promise<EstimatorPack> | null = null;
function loadPack(): Promise<EstimatorPack> {
  packPromise ??= fetch(PACK_URL).then((r) => {
    if (!r.ok) throw new Error(`rule pack unavailable (HTTP ${r.status})`);
    return r.json() as Promise<EstimatorPack>;
  });
  return packPromise;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Country names for the origin select. Falls back to the bare code. */
let regionNames: Intl.DisplayNames | null = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* older runtime */ }
const countryName = (code: string) => {
  if (code === 'OTHER') return 'Other countries and territories (residual)';
  try { return regionNames?.of(code) ?? code; } catch { return code; }
};

/**
 * tCO2e and certificate counts carry long decimal tails; 3 dp is plenty to read.
 *
 * Blank input is special-cased AHEAD of `Number()`: `Number('')` is `0`, and — the gap the first
 * fix here missed — so is `Number('   ')`. Both are a genuine JS quirk (`Number()` trims the
 * string before parsing, same as `parseFloat`), not a missing-value signal, so blank input used
 * to sail through `Number.isFinite` and render as a confirmed "0", indistinguishable from a real
 * zero the engine computed. `s.trim() === ''` catches both; it does NOT catch a real number with
 * incidental whitespace around it (`' 100 '` still parses to 100 and renders normally — only
 * whitespace with no digits in it counts as blank). Every caller before Task 5 fed this engine
 * output (always a real numeric string); `Line.massT` is free-typed by the user with no format
 * guarantee and can be left blank or cleared to spaces, and that must read as missing input, not
 * as a claimed zero — the same rule `Totals.certificates`'s own doc already states for "nothing
 * was summed." Other non-numeric input (never reachable from the engine, only from a user's
 * stray keystrokes in `Line`) still falls through to the `esc(s)` branch below, unchanged:
 * showing exactly what was typed beats hiding it behind a fabricated number.
 */
const num = (s: string, dp = 3) => {
  if (s.trim() === '') return '—';
  const n = Number(s);
  // esc() on the fallback: every other path into innerHTML in this file is escaped,
  // and this is the only one that returns its argument verbatim.
  return Number.isFinite(n) ? n.toLocaleString('en-GB', { maximumFractionDigits: dp }) : esc(s);
};
/**
 * ALWAYS returns a printable string, never `null` — every call site embeds the return directly
 * in a template (`${eur(x)}`), and `null` interpolated into a template literal prints the
 * literal three characters "null" onto the page, which is a worse failure than what this
 * function exists to prevent. Every call site today decides whether to call `eur` at all by
 * checking the ORIGINAL input first (`t.costEur ? eur(t.costEur) : fallback`) — this function's
 * job is only to make whatever value reaches it safe to print. Blank input — `''`, and (the gap
 * the first fix here missed) whitespace-only strings like `'   '`, which are TRUTHY in JS and so
 * pass every call site's `t.costEur ? eur(t.costEur) : fallback` guard exactly like a real value
 * would — and other non-finite input (never reachable from the engine, which only ever produces
 * `null` or a real Decimal string; only a future caller that skips that guard could reach this)
 * render as the same '—' placeholder `num` uses, not as `Number('garbage')` → `NaN` → the
 * literal string `'€NaN'`, or `Number('   ')` → `0` → an invented `'€0.00'`, either printed as
 * though it were money.
 */
const eur = (s: string | null): string => {
  if (s === null || s.trim() === '') return '—';
  const n = Number(s);
  return Number.isFinite(n)
    ? `€${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
};

/**
 * The card shell. Every branch renders one, so the status tag is the ONLY thing
 * distinguishing a priced line from a refusal at a glance — which is why the tag
 * text is passed in per branch rather than derived.
 */
const card = (tone: 'ok' | 'pending' | 'unavail', tag: string, body: string) => `
  <section class="cb-card cb-res">
    <div class="cb-card-head">
      <h3 class="cb-card-label">Certificate exposure</h3>
      <span class="cb-tag ${tone}">${esc(tag)}</span>
    </div>
    ${body}
  </section>`;

/** The figure block. Never rendered by `unavailable` — see NON-NEGOTIABLE 2. */
const figure = (certs: string, costEur: string | null) => `
  <div class="cb-fig"><span class="cb-n">${num(certs)}</span></div>
  <div class="cb-u">certificates</div>
  ${costEur ? `<div class="cb-cost">${eur(costEur)}</div>` : ''}`;

/* ── the provenance stamp — rendered on EVERY branch, refusals included ─────── */
function renderStamp(e: CertificateEstimate): string {
  const s = e.stamp;
  const rows: [string, string][] = [
    ['Data tier', s.tier === 'actual-verified' ? 'Verified actual' : 'Commission default + mark-up'],
    ['Origin basis', s.originBasis === 'residual' ? 'Residual bucket' :
                     s.originBasis === 'country' ? "Origin's own published value" : '—'],
    ['Rule packages', s.rulePackages.join(' · ') || '—'],
    // A real snapshot is a 64-char sha256 and wants truncating; the browser build's
    // is the literal 'browser-prototype', and a blind slice(0,16) rendered that as
    // "browser-prototyp", which reads as a typo rather than a hash.
    ['Snapshot', s.snapshotHash.length > 24 ? `${s.snapshotHash.slice(0, 16)}…` : s.snapshotHash],
  ];
  return `
    <div class="cb-stamp">
      <div class="cb-stamp-h">Provenance</div>
      ${rows.map(([k, v]) => `<div class="cb-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
      ${s.provisional ? '<div class="cb-prov">Provisional — at least one input is not final</div>' : ''}
      ${s.notes.length ? `<ul class="cb-notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </div>`;
}

/**
 * The 50 t de minimis figure itself lives in the consolidated Art 2(3); this is the amending act
 * that put it there. Both threshold cards cite it (single-line and per-year) — one constant so
 * the citation can't drift between them.
 */
const AMENDED_BY_2025_2083 = 'as amended by Reg (EU) 2025/2083';

/**
 * Where this ONE line sits against the annual de minimis threshold — Reg (EU)
 * 2023/956 Art 2(3) as amended by Reg (EU) 2025/2083, 50 t per importer per
 * calendar year across cement, iron & steel, aluminium and fertilisers.
 *
 * WHY THIS CARD EXISTS AT ALL. Below the threshold an importer owes nothing, and
 * without it the tool quoted a four-figure cost to someone who may be exempt —
 * an error in the most expensive direction, on a page whose argument is that it
 * says what it cannot compute.
 *
 * WHY IT NEVER SAYS "EXEMPT". The engine evaluates this line with completeness
 * 'partial', because a single line is not an annual total. One line can PROVE you
 * are above 50 t; nothing here can prove you are below it, since we cannot see
 * the rest of the year's imports. So the states are "above" and "indeterminate",
 * and indeterminate is reported as what it is — a question we cannot close —
 * rather than dressed up as good news.
 */
export function renderThreshold(t: ThresholdView): string {
  const above = t.state === 'above_threshold';
  // 'pending' (amber), not 'ok' (green): an unresolved verdict is not good news. This line can
  // only ever land here or on 'above_threshold' (see the doc above), so there is no 'ok' tone to
  // reach from this function at all — reserved for renderYearThreshold's genuine below_threshold.
  return `
    <section class="cb-card cb-thresh">
      <div class="cb-card-head">
        <h3 class="cb-card-label">Annual de minimis</h3>
        <span class="cb-tag ${above ? 'unavail' : 'pending'}">${above ? 'Above threshold' : 'Indeterminate'}</span>
      </div>
      <div class="cb-water">
        <div class="cb-row"><span>This line</span><b>${num(t.knownEligibleMassT)} t</b></div>
        <div class="cb-row"><span>Threshold · ${esc(String(t.calendarYear))}</span><b>${num(t.thresholdT)} t</b></div>
        <div class="cb-row"><span>Sector</span><b>${esc(t.sector.replace(/_/g, ' '))}</b></div>
      </div>
      <p class="cb-sub">${above
        ? `This line alone exceeds the ${num(t.thresholdT)}&nbsp;t annual threshold, so the exemption
           does not apply and the exposure below stands.`
        : `Below ${num(t.thresholdT)}&nbsp;t an importer owes nothing for the year. This is ONE line,
           not your annual total, so it cannot show you are under the threshold — only that this
           line by itself does not cross it. Add your other ${esc(t.sector.replace(/_/g, ' '))}
           imports for ${esc(String(t.calendarYear))} before relying on the exemption.`}</p>
      <p class="cb-prov">${esc(t.sourceLocator)} · ${AMENDED_BY_2025_2083}</p>
    </section>`;
}

/**
 * The per-year card's own tag text — for BOTH branches of the union, including the year that has
 * no published rule at all. Reused by #cbStatus's multi-line announcement (renderAll, initCbam)
 * for the same reason totalsTag is: with the results panel's aria-live turned off in multi-line
 * mode, the announcement is the only thing a screen-reader user hears — and a year's verdict can
 * flip from "indeterminate" to "below threshold" as a DIRECT result of the user ticking their own
 * attestation checkbox. Reusing this function, rather than a second phrasing in the announcement,
 * is what keeps the spoken verdict from ever disagreeing with the card's own.
 *
 * Takes the FULL `YearThreshold` union, not just its `ruleFound: true` member: the announcement
 * must say something for a year with no published rule too — a sighted user gets an explicit "No
 * published rule" card for it, and silently skipping that year in the announcement would be the
 * same "sighted users only" gap this whole reuse pattern exists to close, just a milder one
 * (omission, not misstatement).
 */
const yearVerdictTag = (y: YearThreshold): string => {
  if (!y.ruleFound) return 'No published rule';
  return y.state === 'above_threshold' ? 'Above threshold' : y.state === 'below_threshold' ? 'Below threshold' : 'Indeterminate';
};

/**
 * One card per calendar year present in the line list. This is the multi-line counterpart of
 * renderThreshold above: a single line can only ever be "indeterminate", because one line is not
 * a year. Here the user can attest the list IS the year, which is what unlocks below_threshold —
 * the verdict then says on every surface that it rests on their statement, not on ours.
 *
 * `YearThreshold` is a real discriminated union on `ruleFound` (cbam-lines.ts) — checking
 * `y.ruleFound` below narrows every field this function reads for the rest of its body, with no
 * hand-rolled type guard needed. There used to be one here (`hasPublishedRule`/
 * `FoundYearThreshold`); it type-checked, but it narrowed against a FLAT interface whose optional
 * fields didn't actually correlate with `ruleFound`, so `{ ruleFound: true, ... }` with every
 * other field omitted passed the compiler and crashed at `y.state.replace` in production. The
 * union now makes that object impossible to construct in the first place.
 */
export function renderYearThreshold(y: YearThreshold): string {
  if (!y.ruleFound) return `
    <section class="cb-card cb-thresh">
      <div class="cb-card-head">
        <h3 class="cb-card-label">Annual de minimis · ${esc(String(y.calendarYear))}</h3>
        <span class="cb-tag pending">${esc(yearVerdictTag(y))}</span>
      </div>
      <p class="cb-sub">No de minimis threshold has been published for ${esc(String(y.calendarYear))}. We show no verdict rather than assume one.</p>
    </section>`;

  const above = y.state === 'above_threshold';
  const below = y.state === 'below_threshold';
  // 'pending' for indeterminate, not 'ok': an unresolved verdict must not wear the same green
  // as a genuine below-threshold answer — see renderThreshold's identical fix just above.
  const tone = above ? 'unavail' : below ? 'ok' : 'pending';
  const tag = yearVerdictTag(y);
  const attest = above ? '' : `
    <label class="cb-attest">
      <input type="checkbox" data-attest="${esc(String(y.calendarYear))}" ${y.attested ? 'checked' : ''} />
      These are all my ${esc(String(y.calendarYear))} imports of CBAM goods
    </label>`;
  const sub = above
    ? `The listed ${esc(String(y.calendarYear))} imports exceed the threshold; the exemption does not apply.`
    : below
      ? `Below the threshold an importer owes nothing for ${esc(String(y.calendarYear))}. This verdict rests on your attested statement that the list is complete — it is your completeness claim, verified by no one, not by the Commission or by us.`
      : `Under the threshold so far, but unattested. Tick the box only if this list is genuinely every ${esc(String(y.calendarYear))} CBAM import; the verdict is only as good as that statement.`;
  return `
    <section class="cb-card cb-thresh">
      <div class="cb-card-head">
        <h3 class="cb-card-label">Annual de minimis · ${esc(String(y.calendarYear))}</h3>
        <span class="cb-tag ${tone}">${esc(tag)}</span>
      </div>
      <div class="cb-water">
        <div class="cb-row"><span>Eligible mass · ${y.eligibleLineCount} line${y.eligibleLineCount === 1 ? '' : 's'}</span><b>${num(y.knownEligibleMassT)} t</b></div>
        <div class="cb-row"><span>Threshold</span><b>${num(y.thresholdT)} t</b></div>
      </div>
      <p class="cb-sub">${sub}</p>
      ${attest}
      <p class="cb-prov">${esc(y.sourceLocator)} · ${AMENDED_BY_2025_2083}</p>
    </section>`;
}

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
const refusedLineNote = (refusedLines: number) =>
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
const totalsTag = (anyPending: boolean) => (anyPending ? 'What-if · CSCF unpublished' : 'Priced');

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
 */
export function renderTotals(t: Totals): string {
  if (t.pricedLines === 0 && t.refusedLines === 0) return `
    <section class="cb-card cb-res cb-total">
      <div class="cb-card-head">
        <h3 class="cb-card-label">Total exposure</h3>
        <span class="cb-tag pending">No lines yet</span>
      </div>
      <p class="cb-sub">Add at least one line to see a total.</p>
    </section>`;

  if (t.pricedLines === 0) return `
    <section class="cb-card cb-res cb-total">
      <div class="cb-card-head">
        <h3 class="cb-card-label">Total exposure</h3>
        <span class="cb-tag unavail">Nothing priced</span>
      </div>
      <p class="cb-sub">No line has a priced estimate, so there is no total to show — not even a zero. ${
        refusedLineNote(t.refusedLines)}</p>
    </section>`;

  const tone = t.anyPending ? 'pending' : 'ok';
  const tag = totalsTag(t.anyPending);
  return `
    <section class="cb-card cb-res cb-total">
      <div class="cb-card-head">
        <h3 class="cb-card-label">Total exposure · ${t.pricedLines} line${t.pricedLines === 1 ? '' : 's'}</h3>
        <span class="cb-tag ${tone}">${esc(tag)}</span>
      </div>
      <div class="cb-fig"><span class="cb-n">${num(t.certificates)}</span></div>
      <div class="cb-u">certificates</div>
      ${t.costEur ? `<div class="cb-cost">${eur(t.costEur)}</div>`
        : '<div class="cb-sub">No € total — at least one line has no published certificate price.</div>'}
      ${t.refusedLines ? `<p class="cb-sub cb-warn">${refusedLineNote(t.refusedLines)}</p>` : ''}
    </section>`;
}

/** The subtraction, shown as terms rather than a single opaque number. */
function renderWaterfall(e: Extract<CertificateEstimate, { terms: unknown }>, fig: {
  faaTco2e: string; netTco2e: string; certificates: string; costEur: string | null;
  indirectTco2e?: string;
}): string {
  // The indirect row is rendered SEPARATELY and after the deduction, because that
  // is where it sits in the arithmetic: free allocation is a direct-emission
  // benchmark, so indirect emissions receive none of it and pass into the charge
  // in full. Folding them into "embedded emissions" would show a deduction being
  // taken against electricity that was never granted against it.
  const indirect = fig.indirectTco2e && Number(fig.indirectTco2e) > 0
    ? `<div class="cb-row"><span>+ Indirect (electricity) · no free allocation</span><b>${
        num(fig.indirectTco2e)} tCO₂e</b></div>`
    : '';
  return `
    <div class="cb-water">
      <div class="cb-row"><span>Embedded emissions (direct)</span><b>${num(e.emissionsTco2e)} tCO₂e</b></div>
      <div class="cb-row"><span>− Free allocation</span><b>${num(fig.faaTco2e)} tCO₂e</b></div>
      ${indirect}
      <div class="cb-row cb-net"><span>= Chargeable</span><b>${num(fig.netTco2e)} tCO₂e</b></div>
      <div class="cb-row"><span>CBAM factor ${esc(String(e.terms.cbamFactorYear))}</span><b>${esc(e.terms.cbamFactor)}</b></div>
      <div class="cb-row"><span>Certificate price ${esc(e.priceQuarter)}</span><b>${
        e.priceEur ? eur(e.priceEur) : 'not published'}${e.priceStatus === 'pending' ? ' (pending)' : ''}</b></div>
    </div>`;
}

/**
 * Render one estimate. Exhaustive by construction — the `never` in the default
 * arm means a new status upstream is a compile error here, not a blank panel.
 */
export function renderResult(e: CertificateEstimate): string {
  switch (e.status) {
    case 'ok':
      return card('ok', 'Priced', `
        ${figure(e.figure.certificates, e.figure.costEur)}
        <div class="cb-sub">Cross-sectoral correction factor ${esc(e.cscf)}</div>
        ${renderWaterfall(e, e.figure)}${renderStamp(e)}`);

    case 'zero_by_fiat':
      // Electricity. Free allocation is nil because Art 2(2) says so, not because a
      // calculation produced zero — so this figure IS final even in 2026, and saying
      // "CSCF pending" here would be wrong in the other direction.
      return card('ok', 'Priced · free allocation nil by law', `
        ${figure(e.figure.certificates, e.figure.costEur)}
        <div class="cb-sub">No free allocation applies · ${esc(e.locator)}</div>
        ${renderWaterfall(e, e.figure)}${renderStamp(e)}`);

    case 'cscf_pending':
      // NON-NEGOTIABLE 3. The Commission has not published the cross-sectoral
      // correction factor for this year, so no final figure exists. What is shown is
      // explicitly a what-if at the last CSCF actually set (1.0, for 2021-25). The
      // word "what-if" and the assumed factor are in the markup, not a tooltip.
      return card('pending', `What-if · CSCF for ${e.cscfYear} unpublished`, `
        ${figure(e.scenario.certificates, e.scenario.costEur)}
        <p class="cb-sub cb-warn">
          Not a final figure. The Commission has not published the cross-sectoral correction
          factor for ${esc(String(e.cscfYear))}; this assumes CSCF&nbsp;=&nbsp;${esc(e.scenario.assumedCscf)},
          the largest the factor can legally be (the last value actually set, 2021–25). CSCF only
          ever reduces the free allocation that offsets a bill, so this is a floor: the real
          figure cannot be lower, and may be higher.
        </p>
        ${renderWaterfall(e, e.scenario)}${renderStamp(e)}`);

    case 'unavailable':
      // NON-NEGOTIABLE 2. No number. Not zero, not a placeholder, not a range — the
      // rules do not price this line and the honest output is to say which rule is
      // missing. 183 of 574 offered goods land here, 181 of them iron and steel.
      // Note this branch calls neither figure() nor renderWaterfall(): the card is
      // styled as an answer because it IS one, but it carries no number anywhere.
      return card('unavail', 'No estimate', `
        <p class="cb-reason">${esc(e.reason)}</p>
        ${e.selector ? `<div class="cb-sel"><span>Missing rule</span><code>${esc(e.selector)}</code></div>` : ''}
        <p class="cb-sub">We show no deduction rather than guess one. Picking a nearby benchmark
           would produce a number that looks authoritative and is not.</p>
        ${renderStamp(e)}`);

    default: {
      // A new status upstream must break the build here rather than render nothing.
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}

/** A line's header plus the ordinary result card, with a remove control. */
export function renderLineCard(line: Line, e: CertificateEstimate, index: number): string {
  return `
    <article class="cb-line" data-line="${esc(line.id)}">
      <div class="cb-line-head">
        <span class="cb-line-n">Line ${index + 1}</span>
        <span class="cb-line-sum">${esc(line.cn)} · ${esc(line.country)} · ${esc(line.route)} · ${num(line.massT)} t · ${esc(line.date)}</span>
        <button type="button" class="cb-line-x" data-remove="${esc(line.id)}" aria-label="Remove line ${index + 1}">Remove</button>
      </div>
      ${renderResult(e)}
    </article>`;
}

/**
 * Pulls the certificates/cost pair the print table needs out of whichever branch carried them —
 * the table's own small mirror of csvRows's figuresOf (cbam-lines.ts), which this file cannot
 * import since it is not exported there. `never` in the default arm keeps this exhaustive against
 * CertificateEstimate the same way renderResult's own switch is, just above.
 */
function tableFigures(e: CertificateEstimate): { certs: string | null; costEur: string | null } {
  switch (e.status) {
    case 'ok':
    case 'zero_by_fiat': return { certs: e.figure.certificates, costEur: e.figure.costEur };
    case 'cscf_pending': return { certs: e.scenario.certificates, costEur: e.scenario.costEur };
    case 'unavailable': return { certs: null, costEur: null };
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}

/**
 * A source's own sha256, read from the pack's `sources` list by id rather than hardcoded — a
 * hardcoded value would silently go stale, and reading the WRONG field of the pack is just as
 * dangerous as hardcoding: `generatedFrom[].workbookSha256` and `sources[].sha256` are both real
 * digests of real artefacts, but a regulation id (`ir-2025-2620`) and a Commission WORKBOOK id
 * (`ec-benchmarks-workbook-v1`) name different documents, and printing one under the other's
 * label is a false provenance claim even though every character of the hash is correct.
 *
 * Four `sources` entries (`dir-2003-87-art-10a-1a`, `dr-2019-331-art-14-6`, `reg-2023-956`,
 * `ec-certificate-price-page`) still carry the pack's "not yet retrieved" placeholder — 64
 * zeros — because no digest has been pinned for them yet. Printing that string verbatim would
 * read as a real hash computed over a real download; it is not one, so it is called out by name
 * instead of allowed through as though it were.
 */
function sourceHash(pack: Pick<EstimatorPack, 'sources'>, sourceId: string): string {
  const found = pack.sources.find((s) => s.id === sourceId);
  if (!found) return 'not present in this pack';
  if (/^0+$/.test(found.sha256)) return 'not yet pinned — no digest recorded for this source';
  return found.sha256;
}

/**
 * A line that entered the estimate but whose `estimateFromPack` call THREW rather than returning
 * a discriminated `CertificateEstimate` (see `safeEstimates` in `initCbam` — rare, but the old
 * single-line `run()` caught exactly this for a reason). Not folded into `CertificateEstimate`'s
 * own union, which this file does not own — that type is vendored. This lets `buildPrintDocument`
 * keep `lines` and `results` PARALLEL even for a line the engine refused to evaluate at all,
 * matching `csvRows`'s and `thresholdByYear`'s own throw-named idiom in cbam-lines.ts. Without
 * this arm, a thrown line had exactly two bad options: drop it from the document silently (§3
 * requires "every line as entered" — see the design doc) or let one bad line crash the whole
 * export for every other line on the sheet.
 */
export interface LineEstimateFailure {
  failed: true;
  message: string;
}

/**
 * The printable audit document — §4 is the point of the whole file: what the figures above
 * CANNOT tell you, stated plainly rather than left for a reader to infer from a methodology PDF.
 *
 * `generatedOn` is passed in rather than read from `new Date()` inside this function, so the
 * document stays a pure function of its inputs — reproducible in a test, and the caller's clock
 * read once for the whole session rather than once per render.
 */
export function buildPrintDocument(input: {
  lines: readonly Line[];
  results: readonly (CertificateEstimate | LineEstimateFailure)[];
  yearCards: readonly YearThreshold[];
  totals: Totals;
  packSnapshot: string;
  rulePackages: readonly string[];
  pack: Pick<EstimatorPack, 'sources'>;
  generatedOn: string;
}): string {
  const { lines, results, yearCards, totals, packSnapshot, rulePackages, pack, generatedOn } = input;
  if (lines.length !== results.length) {
    // Matches csvRows's own idiom in cbam-lines.ts: name the mismatch loudly rather than let
    // `results[i]!` below hand back a bare `undefined` with nothing to debug from.
    throw new Error(
      `buildPrintDocument: ${lines.length} line(s) but ${results.length} result(s) — every line `
      + 'must have exactly one CertificateEstimate (or LineEstimateFailure), in the same order, '
      + 'before it can be printed',
    );
  }

  const lineRows = lines.map((l, i) => {
    const r = results[i]!;
    if ('failed' in r) {
      // Same eight columns as the ordinary row below, so the table stays rectangular — only the
      // certificates/cost/authority cells differ, carrying the reason instead of a figure.
      return `<tr>
        <td>${esc(l.cn)}</td><td>${esc(l.country)}</td><td>${esc(l.route)}</td>
        <td>${num(l.massT)}</td><td>${esc(l.date)}</td>
        <td>no estimate (error)</td>
        <td>—</td>
        <td class="cbp-loc">${esc(r.message)}</td>
      </tr>`;
    }
    const e = r;
    const pending = e.status === 'cscf_pending';
    const { certs, costEur } = tableFigures(e);
    const bm = 'terms' in e ? e.terms.benchmarks[0] : null;
    return `<tr>
      <td>${esc(l.cn)}</td><td>${esc(l.country)}</td><td>${esc(l.route)}</td>
      <td>${num(l.massT)}</td><td>${esc(l.date)}</td>
      <td>${certs === null ? 'no estimate' : `${num(certs)}${pending ? ' (what-if)' : ''}`}</td>
      <td>${costEur ? eur(costEur) : '—'}</td>
      <td class="cbp-loc">${bm ? esc(bm.sourceLocator) : ('selector' in e && e.selector ? `missing: ${esc(e.selector)}` : '—')}</td>
    </tr>`;
  }).join('');

  const verdicts = yearCards.map((y) => y.ruleFound
    ? `<li>${esc(String(y.calendarYear))}: <b>${esc(yearVerdictTag(y))}</b> at ${num(y.knownEligibleMassT)} t of ${num(y.thresholdT)} t — completeness box ${y.attested ? 'TICKED by the user' : 'not ticked'}.</li>`
    : `<li>${esc(String(y.calendarYear))}: <b>${esc(yearVerdictTag(y))}</b> — no de minimis threshold published; no verdict.</li>`).join('');

  return `
    <h1>CBAM certificate exposure — provisional estimate</h1>
    <p class="cbp-sub">Generated ${esc(generatedOn)} · deltaclimate.earth/cbam/cbam-calculator · not a filing, not verified data</p>

    <h2>1 · What you asked</h2>
    <table><thead><tr><th>CN</th><th>Origin</th><th>Route</th><th>Mass t</th><th>Import date</th>
      <th>Certificates</th><th>Cost</th><th>Benchmark authority</th></tr></thead>
      <tbody>${lineRows}</tbody></table>

    <h2>2 · What we computed</h2>
    <p>Total: <b>${num(totals.certificates)} certificates</b>${
      totals.costEur ? ` · <b>${eur(totals.costEur)}</b>` : ' · no € total (a certificate price is unpublished)'}${
      totals.anyPending ? ' — a <b>what-if</b>, because the CSCF is unpublished (see §4)' : ''}. ${
      totals.refusedLines ? `${totals.refusedLines} line(s) refused and excluded.` : ''}</p>
    <ul>${verdicts || '<li>No de minimis verdict — no eligible lines.</li>'}</ul>

    <h2>3 · On what authority</h2>
    <ul>
      <li>Rule packages: ${rulePackages.map((r) => `<code>${esc(r)}</code>`).join(' · ')}</li>
      <li>Data snapshot: <code>${esc(packSnapshot)}</code> — SHA-256 over the pack's
        generation timestamp and both Commission source-workbook hashes (below).</li>
      <li>IR (EU) 2025/2620 (free allocation), the enacted regulation itself:
        <code>${esc(sourceHash(pack, 'ir-2025-2620'))}</code></li>
      <li>IR (EU) 2025/2621 (default values), the enacted regulation itself:
        <code>${esc(sourceHash(pack, 'ir-2025-2621'))}</code></li>
      <li>Commission Benchmarks workbook — an informational transcription of the 2025/2620 Annex,
        not the binding text: <code>${esc(sourceHash(pack, 'ec-benchmarks-workbook-v1'))}</code></li>
      <li>Commission Default Values workbook — an informational transcription of 2025/2621's
        Annex I, not the binding text: <code>${esc(sourceHash(pack, 'ec-default-values-workbook-v1'))}</code></li>
      <li>Per-line benchmark authority is printed in the table above; the CBAM factor is
        Dir 2003/87/EC Art 10a(1a) (free allocation retained).</li>
    </ul>

    <h2>4 · What this does not tell you</h2>
    <ul>
      <li>The cross-sectoral correction factor (CSCF) for 2026–2030 is unpublished. CSCF only
        ever reduces the free allocation that offsets a bill — it can subtract, never add — so
        every figure above assumes the largest free allocation legally possible (CSCF&nbsp;=&nbsp;1,
        the last value the Commission actually set). Each figure above is therefore a floor: the
        real bill cannot be lower than what is shown, and may be higher once the true factor is
        published.</li>
      <li>Article 9 deductions for a carbon price paid in the country of origin are not modelled
        (the implementing act is still a draft), so figures do not credit any such payment.</li>
      <li>Any below-threshold verdict rests on the user's own statement of completeness, ticked
        in the tool. No one has verified that list.</li>
      <li>Line fingerprints cover inputs as entered; no source document exists behind them. They
        are not customs provenance.</li>
    </ul>`;
}

/**
 * Which route should be selected once the published list changes, given what the
 * user had picked before.
 *
 * WHY THIS IS NOT "just keep the old value if it is still there". Rebuilding the
 * route <select> makes the browser select its first option, so changing only the
 * import date used to revert (B) to (A) and move the headline figure from 58.148
 * to 71.465 certificates — 23% — with nothing saying so. Restoring the previous
 * value fixes that case but leaves the other one: when the published list changes
 * and the user's route is gone, index 0 is still auto-selected and we price a
 * route they never chose.
 *
 * So auto-selection itself is the defect, and the rule is:
 *   one published route  → select it; there is no choice to make
 *   several              → '' , and the caller shows the idle prompt until the
 *                          user picks. Route materially changes the figure, and
 *                          choosing one for them is a guess this tool does not make.
 *   previous still valid → keep it, whatever the trigger was.
 */
export function nextRoute(published: readonly string[], previous: string): string {
  if (published.length === 1) return published[0]!;
  return published.includes(previous) ? previous : '';
}

/**
 * THE ONE place that stamps the real pack snapshot onto an estimate, replacing the vendored
 * engine's literal `'browser-prototype'` placeholder. Every result `initCbam` renders — the
 * single-line preview (`run()`) AND every multi-line estimate (`estimateLine()`) — must pass
 * through here, and both do.
 *
 * WHY THIS IS ITS OWN FUNCTION, NOT TWO IDENTICAL LINES. It used to be two: `estimateLine()` set
 * `e.stamp.snapshotHash = snapshot` for every line added in multi-line mode, but `run()` — the
 * path taken on first page load and again whenever `lines` empties back out, i.e. what a
 * first-time visitor and anyone who removes their last line actually sees — called
 * `estimateFromPack` directly and never decorated its result at all. Two call sites doing the
 * same one-line assignment is exactly the shape that drifts: one of them gets the decoration
 * added, the other doesn't, and nothing enforces they move together. Mutating `e.stamp` in place
 * (matching `estimateLine`'s original approach) rather than spreading a new object: `stamp` is a
 * nested object the vendored engine allocates fresh per call, so this never reaches into a shared
 * or cached instance.
 *
 * `snapshotHash` is passed in, not read from a closure, so this is a pure function callable (and
 * tested) with no DOM and no `initCbam` state at all.
 *
 * BEFORE THE PACK RESOLVES: `initCbam`'s `snapshot` variable starts at `''` and is only ever set
 * — atomically, in the same synchronous continuation as `pack` itself — once `loadPack()` and
 * `packSnapshotHash()` have BOTH succeeded inside `ensurePack`. Every call site that can reach
 * this function today only does so after its own `pack` truthiness check, so by construction
 * `snapshotHash` is always a real 64-hex-char digest by the time either caller gets here. The
 * fallback below is insurance for this function outliving that guarantee, not evidence it is
 * reachable today: printing `''` in its place would read as though the stamp made NO claim at
 * all, which is a worse failure than the placeholder it replaces — §4 exists to make an honest
 * claim, not a blank one — so an unresolved snapshot gets its own honest, visibly-unfinished
 * label instead of silently falling through to '' or quietly keeping 'browser-prototype'.
 *
 * THE FALLBACK TEXT IS DELIBERATELY ≤ 24 CHARACTERS. `renderStamp` (above) truncates any
 * `snapshotHash` longer than 24 chars to its first 16 with an ellipsis, on the assumption that
 * anything that long is a hash worth shortening — the same assumption that used to mangle the
 * vendored `'browser-prototype'` placeholder into "browser-prototyp" before that function's own
 * length check was added. A longer, more explanatory fallback sentence here would walk straight
 * back into that bug, truncated mid-word into something that reads as a garbled hash rather than
 * a sentence. Keeping this short is not a style choice; it is the second half of the same fix.
 */
export function decorateSnapshot(e: CertificateEstimate, snapshotHash: string): CertificateEstimate {
  e.stamp.snapshotHash = snapshotHash || 'not yet computed';
  return e;
}

/**
 * One verified per-tonne figure as the FORM should judge it, or null.
 *
 * DELIBERATELY LOOSER THAN THE ENGINE'S OWN GATE, and the looseness is the design. The
 * authority on what may be priced is `verifiedPerT` in estimate-from-pack.ts — a vendored
 * function this file cannot import (it is not exported) and must not copy, because a copied
 * regex is a second rule that drifts from the first. That gate is stricter than this one: it
 * refuses '0x10', '1_000', '5.' and '+5', all of which `Number()` happily reads. Those reach
 * the engine and come back as a REFUSAL CARD naming the input — fail-closed, just one step
 * later and in a different place on screen. What this catches is the ordinary case — prose, an
 * empty field, Infinity — where an inline message beside the field beats a refused card.
 *
 * SIGNS PASS THROUGH ON PURPOSE. `Number('-1')` is perfectly finite, so a negative figure is
 * NOT this function's refusal to make: it must reach the caller's own `< 0` test, which is what
 * gives a negative its own specific message ("enter zero if the verified figure really is nil")
 * rather than the generic "not a number".
 *
 * ZERO IS LEGAL. A 100%-scrap EAF producer genuinely attests a near-zero figure, and this is
 * exactly the importer the verified tier exists to reward — a falsy check here would refuse the
 * best-documented line on the form.
 */
function verifiedFigure(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** What the verified panel contributes to a draft Line, or the reason it cannot.
 *  Pure on purpose: the form handler stays thin and THIS carries the tests.
 *
 *  OMITS, NEVER EMITS AN EMPTY STRING, for the two optional fields. estimate-from-pack.ts's
 *  verified path tests `indirectTco2ePerT !== undefined` BEFORE it calls verifiedPerT, so an
 *  ABSENT indirect figure skips the branch and the line prices normally, while `''` reaches the
 *  shape gate, fails it, and refuses the WHOLE line as unavailable. lineFingerprint splits the
 *  same two apart on purpose (`?? null`). A handler that wrote `seeIndirect: el.value`
 *  unconditionally would turn every blank optional field into a refused line. */
export function parseVerifiedFields(v: {
  tier: string; direct: string; indirect: string; attested: boolean; ref: string;
}): { ok: Partial<Line> & { tier: Line['tier'] } } | { error: string } {
  // Every other field is ignored on this branch, not merely unused: a user who filled the panel
  // in and then changed their mind back to the Commission defaults must not have the abandoned
  // figures ride along into the line. This branch is the ONLY thing keeping them out: the form
  // deliberately does NOT clear the panel on a switch back to defaults (see syncVerifiedRows —
  // clearing it would let one stray arrow-key `change` destroy the user's typing), so the inputs
  // are still full of the abandoned claim every time this runs.
  if (v.tier !== 'actual-verified') return { ok: { tier: 'default+markup' } };

  // Trim before every test below. `Number('   ')` is 0, so an untrimmed whitespace-only field
  // would pass the "is it a number" check as a confident, attested zero nobody typed.
  const direct = v.direct.trim();
  const indirect = v.indirect.trim();
  const ref = v.ref.trim();

  if (!direct) {
    return { error: 'Enter your verified direct emissions in tCO₂e per tonne of good, '
      + 'or switch this line back to the Commission defaults.' };
  }
  const d = verifiedFigure(direct);
  if (d === null) {
    return { error: `Verified direct emissions must be a number of tCO₂e per tonne — `
      + `“${direct}” is not one.` };
  }
  if (d < 0) {
    return { error: 'Verified direct emissions cannot be negative — enter zero if the '
      + 'verified figure really is nil.' };
  }

  if (indirect) {
    const i = verifiedFigure(indirect);
    if (i === null) {
      return { error: `Verified indirect emissions must be a number of tCO₂e per tonne — `
        + `“${indirect}” is not one. Leave the field empty if you are not claiming one.` };
    }
    if (i < 0) {
      return { error: 'Verified indirect emissions cannot be negative — enter zero, or leave '
        + 'the field empty if you are not claiming one.' };
    }
  }

  // Checked LAST, after the figures, so the message a user sees is about the field they are
  // still filling in rather than a tick they have not reached yet.
  if (!v.attested) {
    return { error: 'Tick the attestation — it is what puts this claim, and any reference you '
      + 'cite for it, into the export. This tool transcribes the claim; it cannot check it.' };
  }

  const ok: Partial<Line> & { tier: Line['tier'] } = {
    tier: 'actual-verified',
    // The string AS ENTERED (trimmed), never the parsed number re-stringified: `Number('2.50')`
    // round-trips to '2.5', and lineFingerprint hashes this value — an audit trail must pin what
    // the importer typed, not this file's idea of the same quantity.
    seeDirect: direct,
  };
  if (indirect) ok.seeIndirect = indirect;
  if (ref) ok.verifiedRef = ref;
  return { ok };
}

/**
 * The `verified` input a line's TIER implies — derived from `l.tier`, never from whether the
 * figures happen to look truthy.
 *
 * WHY THAT DISTINCTION IS LOAD-BEARING: if a line says 'actual-verified' but no `verified`
 * object reaches estimateFromPack, the engine takes the defaults path and stamps
 * `tier: 'default+markup'`. csvRows' guard then THROWS at export time — killing the entire
 * file over one line — instead of the user seeing a refusal on that line's card. So a verified
 * tier ALWAYS produces an object, even a hopeless one (`directTco2ePerT: ''`, which the engine's
 * own verifiedPerT refuses by name). The refusal belongs to the engine; this function's only
 * job is making sure the engine is the one asked.
 */
export function verifiedInputOf(
  l: Pick<Line, 'tier' | 'seeDirect' | 'seeIndirect'>,
): EstimatorInput['verified'] {
  if (l.tier !== 'actual-verified') return undefined;
  return {
    directTco2ePerT: l.seeDirect ?? '',
    // Spread, not `indirectTco2ePerT: l.seeIndirect` — see parseVerifiedFields' own note: the
    // engine branches on `!== undefined`, so a present-but-undefined key is NOT the same as an
    // absent one to a reader, and writing it explicitly invites someone to "simplify" it into
    // an empty string later.
    ...(l.seeIndirect !== undefined ? { indirectTco2ePerT: l.seeIndirect } : {}),
  };
}

/* ── wiring ────────────────────────────────────────────────────────────────── */
export function initCbam(): void {
  const cn = $<HTMLInputElement>('cbCn'), country = $<HTMLSelectElement>('cbCountry');
  const route = $<HTMLSelectElement>('cbRoute'), mass = $<HTMLInputElement>('cbMass');
  const date = $<HTMLInputElement>('cbDate'), out = $('cbOut'), status = $('cbStatus');
  const list = $<HTMLDataListElement>('cbCnList'), prov = $('cbProv');
  const scope = $<HTMLSelectElement>('cbScope'), scopeRow = $('cbScopeRow');
  const tier = $<HTMLSelectElement>('cbTier'), verifiedRow = $('cbVerifiedRow');
  const seeDirect = $<HTMLInputElement>('cbSeeDirect'), seeIndirectRow = $('cbSeeIndirectRow');
  const seeIndirect = $<HTMLInputElement>('cbSeeIndirect'), attest = $<HTMLInputElement>('cbAttest');
  const ref = $<HTMLInputElement>('cbRef');
  const add = $<HTMLButtonElement>('cbAdd'), csvBtn = $<HTMLButtonElement>('cbCsv');
  const docBtn = $<HTMLButtonElement>('cbDoc'), printEl = $('cbPrint');
  const outWrap = $('cbOutWrap');
  if (!cn || !country || !route || !mass || !date || !out || !status) return;

  /**
   * GUARD AGAINST DOUBLE INIT. The page's <script> calls `boot()` directly AND listens for
   * `astro:page-load` — and that event fires on the INITIAL load too, not only on a soft
   * navigation (Astro's ClientRouter dispatches it every time, first paint included). So on a
   * plain first visit, `initCbam()` used to run TWICE against the same DOM.
   *
   * That was harmless through Task 5: `run()` just re-read six `.value`s off the DOM on every
   * call, so two redundant listeners produced the same idempotent output. It stopped being
   * harmless the moment `lines`/`attested`/`fingerprints`/`lastPairs` became real state living
   * IN THIS CLOSURE (Task 6) — two closures wired to the same buttons each hold their OWN copy
   * of that state, mint different `crypto.randomUUID()` ids for what the user sees as "the same"
   * line, and both attach a `click` listener to #cbAdd/#cbOut/#cbCsv/#cbDoc. One add click adds a
   * line to BOTH closures' arrays; whichever renders last is the only one visible; a Remove click
   * only ever matches the id in the closure that rendered it, so the OTHER closure silently keeps
   * a line the screen no longer shows — and an export reads whichever closure's listener happens
   * to fire, which can (and, verified while exercising this page, did) export a line the user had
   * already removed. The fix is a guard on the form root itself, not a module-level flag: a
   * module-level flag would wrongly survive a REAL soft navigation that swaps in a fresh DOM
   * subtree and genuinely needs its own initCbam() call. Astro's default swap does not preserve
   * this page's nodes (no `transition:persist` here), so a genuine re-navigation always presents
   * a `cn` with no `data-cbam-wired` and re-inits correctly.
   */
  if (cn.dataset.cbamWired) return;
  cn.dataset.cbamWired = 'true';

  let pack: EstimatorPack | null = null;

  // The first state this controller has held. lines[] is the source of truth in
  // multi-line mode; the six form fields become the editor for the NEXT line.
  // With lines empty the app behaves exactly as it always has (single draft line,
  // vendored single-line threshold card) — that path is pinned by the existing
  // unit tests and stays byte-compatible.
  const lines: Line[] = [];
  const attested = new Set<number>();
  const fingerprints = new Map<string, string>();
  let snapshot = '';
  // The last thing renderAll actually put on screen, kept so onCsv/onDoc export EXACTLY that —
  // not a fresh recomputation that could, in principle, disagree with it. estimateFromPack is a
  // pure function of (pack, line) with nothing engine-side touching the clock or randomness (see
  // estimate-from-pack.ts), so a fresh recompute is byte-identical today; this cache makes that an
  // invariant of the code rather than a fact someone has to keep re-verifying by reading the
  // engine. `lines` only ever changes inside onAdd/onOutClick, and both call renderAll
  // synchronously right after mutating it — so by the time a user can click Export, lastPairs is
  // always in sync with `lines`.
  let lastPairs: ReturnType<typeof safeEstimates> = [];

  async function ensurePack(): Promise<EstimatorPack | null> {
    if (pack) return pack;
    status!.textContent = 'Loading published rule values…';
    // Both awaits land in local variables first, and `pack`/`snapshot` are only assigned once
    // BOTH succeed. If packSnapshotHash threw after `pack` had already been set directly, the
    // top-of-function `if (pack) return pack;` short-circuit on the NEXT call would hand back a
    // pack whose snapshot never got computed, with no retry — silently pinning every future
    // estimate's provenance stamp to the empty string this closure starts with.
    let loaded: EstimatorPack;
    let hash: string;
    try {
      loaded = await loadPack();
      hash = await packSnapshotHash(loaded);
    } catch (err) {
      status!.textContent = `Could not load the rule pack: ${(err as Error).message}`;
      return null;
    }
    pack = loaded;
    snapshot = hash;
    // 574 goods; the datalist is the whole corpus, filtered natively by the browser.
    if (list) list.innerHTML = pack.classifications
      .map((c) => `<option value="${esc(c.code)}">${esc(c.description)}</option>`).join('');
    const origins = [...new Set(pack.defaultFactors.map((f) => f.originCountry))]
      .sort((a, b) => (a === 'OTHER' ? 1 : b === 'OTHER' ? -1 : countryName(a).localeCompare(countryName(b))));
    country!.innerHTML = '<option value="" disabled selected>Select origin…</option>'
      + origins.map((c) => `<option value="${esc(c)}">${esc(countryName(c))}</option>`).join('');
    if (prov) prov.textContent = 'Rules: '
      + pack.generatedFrom.map((s) => `${s.id}@${s.version}`).join(' · ');
    status!.textContent = '';
    return pack;
  }

  function syncRoutes(): void {
    // Read the user's pick BEFORE the rebuild wipes it.
    const prev = route!.value;
    // The select explains its own dependency rather than showing a bare dash — an
    // empty disabled box reads as broken, this reads as an instruction (doc §6).
    if (!pack || !cn!.value || !country!.value) {
      route!.innerHTML = '<option value="">Choose a good and origin first</option>';
      route!.disabled = true; return;
    }
    const year = Number(date!.value.slice(0, 4)) || 2026;
    const rs = routesFor(pack, cn!.value, country!.value, year);
    route!.disabled = rs.length === 0;
    if (!rs.length) { route!.innerHTML = '<option value="">no route published for this pairing</option>'; return; }
    const opts = rs.map((r) => `<option value="${esc(r)}">${r === 'default' ? 'single route' : esc(r)}</option>`).join('');
    const want = nextRoute(rs, prev);
    // want === '' means the pairing publishes several routes and the user has not
    // chosen among them. A disabled placeholder holds the selection empty, and
    // run() falls through to the idle prompt rather than pricing a guess.
    route!.innerHTML = (want ? '' : '<option value="" disabled selected>Select a production route…</option>') + opts;
    if (want) route!.value = want;
  }

  /**
   * The emissions-scope control only exists for goods the Commission publishes an
   * indirect default for — cement, fertilisers and sintered iron ore. Everywhere
   * else it is a no-op (the engine returns 0 either way), and a control that
   * cannot change the answer is noise on a form this dense.
   *
   * IT DEFAULTS TO INCLUDING INDIRECT. The definitive regime covers indirect
   * emissions for those sectors, so direct-only is an understatement there, not a
   * simpler view — for cement it drops 6.6 tCO₂e and €497 on a 100 t line. The
   * control exists so someone with verified direct-only data can say so, not so
   * the tool can quietly answer low by default.
   */
  function syncScope(): void {
    if (!scope || !scopeRow) return;
    const has = !!pack && !!cn!.value && !!country!.value && !!route!.value
      && selectIndirectFactorFromPack(pack, {
        cn: cn!.value, country: country!.value, route: route!.value,
        massT: mass!.value || '1', date: date!.value,
      }) !== null;
    scopeRow.hidden = !has;
  }

  /**
   * Shows the verified panel on tier, and the verified INDIRECT field only when the indirect
   * side is actually in play — the verified panel open, AND #cbScopeRow visible (i.e. the
   * Commission publishes an indirect default for this good at all), AND the scope select set to
   * direct_and_indirect. Same rule the defaults path uses, so the two tiers ask for the same
   * scope of figure for the same good.
   *
   * IT CLEARS EXACTLY ONE FIELD, AND THE ASYMMETRY IS THE POINT: one hidden value can still
   * price, the other three cannot, so only the dangerous one is destroyed.
   *
   *   - #cbSeeIndirect IS cleared whenever the indirect ROW hides. On the VERIFIED path that
   *     figure is the importer's OWN number and the engine adds it on `emissionsScope` alone —
   *     no pack lookup, nothing else gates it. So a value left behind an invisible row (type 0.4
   *     for cement, then switch the good to steel) would silently inflate every later estimate
   *     with a number the user can no longer see, let alone correct. Fail closed. (On the
   *     DEFAULTS path a hidden scope control is harmless by contrast: the engine finds no
   *     published indirect factor and returns 0 either way.)
   *   - #cbSeeDirect, #cbAttest and #cbRef are NOT cleared when the tier switches back to the
   *     defaults. Nothing stale can price through them: parseVerifiedFields returns on the tier
   *     alone and reads no other field on that branch, and verifiedInputOf returns undefined, so
   *     the whole panel is inert while it is hidden. Clearing them would buy nothing and cost the
   *     user their work — #cbTier has only two options, and in Firefox a CLOSED <select> fires
   *     `change` on every arrow step, so a keyboard user pressing ↓ then ↑ lands back exactly
   *     where they started having silently destroyed a typed figure, a ticked attestation and a
   *     verifier reference, with no undo.
   *
   * CALL ORDER MATTERS: it reads `scopeRow.hidden`, which syncScope() computes, so every call
   * site runs it AFTER syncScope() rather than before.
   */
  function syncVerifiedRows(): void {
    if (!tier || !verifiedRow) return;
    const on = tier.value === 'actual-verified';
    verifiedRow.hidden = !on;
    const indirectOn = on && !!scopeRow && !scopeRow.hidden
      && scope?.value === 'direct_and_indirect';
    if (seeIndirectRow) seeIndirectRow.hidden = !indirectOn;
    if (!indirectOn && seeIndirect) seeIndirect.value = '';
  }

  /**
   * The five verified fields, parsed. THE SINGLE READ POINT — run() (the live preview) and
   * draftLine() (the line that gets added) both go through this exact call, so the preview can
   * never show one number while the added line carries another. They already differed on the
   * date (run() previews without one; draftLine() refuses a NaN year) and that difference is
   * deliberate and visible; a difference in the attested FIGURES would not be either.
   */
  const readVerified = () => parseVerifiedFields({
    tier: tier?.value ?? 'default+markup',
    direct: seeDirect?.value ?? '',
    indirect: seeIndirect?.value ?? '',
    attested: !!attest?.checked,
    ref: ref?.value ?? '',
  });

  function run(): void {
    if (!pack || !cn!.value || !country!.value || !route!.value || !mass!.value) {
      out!.innerHTML = '<p class="cb-idle">Choose a good, origin, route and mass to see the provisional exposure.</p>';
      return;
    }
    // REFUSE AN IMPOSSIBLE MASS RATHER THAN PRICING IT. `min="0"` on the input is
    // inert here — there is no form and no submit, so constraint validation never
    // runs and the `input` event fires anyway. A mass of -500 t used to render
    // "-682 tCO₂e embedded" and a confident "0 certificates · €0.00": nonsense
    // input wearing the shape of a computed answer, which is exactly what the
    // fail-closed rule exists to stop. Checked here, not against the markup's
    // `min`, so that editing the .astro cannot silently disarm it.
    const massT = Number(mass!.value);
    if (!Number.isFinite(massT) || massT < 0) {
      out!.innerHTML = '<p class="cb-idle">Net mass must be a number of tonnes, zero or greater.</p>';
      return;
    }
    // The verified panel is read through the SAME parse the added line uses (readVerified's own
    // doc), and its refusals render in the SAME idle-prompt shape as the mass refusal above —
    // an instruction about the field to fix, never a figure computed around the problem. Placed
    // before the estimate rather than beside it so an unattested or unreadable claim can never
    // reach the engine at all: half a verified panel is not a cheaper estimate, it is no
    // estimate.
    const v = readVerified();
    if ('error' in v) {
      out!.innerHTML = `<p class="cb-idle">${esc(v.error)}</p>`;
      return;
    }
    try {
      const e = decorateSnapshot(estimateFromPack(pack, {
        cn: cn!.value, country: country!.value, route: route!.value,
        massT: mass!.value, date: date!.value,
        emissionsScope: (scope?.value as 'direct' | 'direct_and_indirect') ?? 'direct_and_indirect',
        verified: verifiedInputOf(v.ok),
      }), snapshot);
      // The threshold statement needs only the good and the mass, so it survives a
      // selector the estimate itself cannot price — a refused line still gets told
      // whether it is even in scope for CBAM this year. It renders ABOVE the
      // exposure because "you may owe nothing at all" outranks "here is what you
      // would owe".
      const t = resolveThreshold(pack, { cn: cn!.value, massT: mass!.value, date: date!.value });
      out!.innerHTML = (t ? renderThreshold(t) : '') + renderResult(e);
    } catch (err) {
      // A DomainError is the engine refusing, and it names what is missing. Show it
      // rather than a generic failure — the reason is the useful part.
      out!.innerHTML = `<div class="cb-res cb-unavail">
        <div class="cb-tag unavail">No estimate</div>
        <p class="cb-reason">${esc((err as Error).message)}</p></div>`;
    }
  }

  /** One line's estimate, decorated with the real pack snapshot via the single shared
   * decoration point (decorateSnapshot, above) that run() also calls. */
  function estimateLine(l: Line): CertificateEstimate {
    const e = estimateFromPack(pack!, {
      cn: l.cn, country: l.country, route: l.route,
      massT: l.massT, date: l.date, emissionsScope: l.scope,
      // From the line's TIER, not from the form and not from whether its figures look truthy —
      // see verifiedInputOf's doc for why the alternative ends in a thrown export instead of a
      // rendered refusal. `lines` outlives the form values that produced them, so this must
      // read the line, and only the line.
      verified: verifiedInputOf(l),
    });
    return decorateSnapshot(e, snapshot);
  }

  /**
   * Why draftLine() reports its reason through a variable instead of writing #cbStatus itself:
   * onAdd() writes that element unconditionally when the draft comes back null, so a specific
   * message written here would be overwritten by the generic one a line later — visible for no
   * frames at all. This keeps ONE writer of #cbStatus on the add path (onAdd), which simply
   * prefers the specific reason when there is one. Reset at the top of every draftLine() call so
   * a stale reason from a previous click can never be reported against this one.
   */
  let draftReason: string | null = null;

  /**
   * Builds the next line from the form's current values, or null if the line is not ready to
   * add. Mirrors run()'s own "impossible mass" refusal (checked here, not left to the markup's
   * inert `min="0"`, for the same reason run() gives).
   *
   * ALSO REFUSES AN UNRESOLVED DATE. yearOf(l) is NaN for an empty or malformed
   * <input type="date"> value, and a NaN-year line joins NO year's threshold card
   * (yearOf's own doc: NaN can't be filtered from a Set by equality, and a lookup keyed on
   * NaN always misses) while still appearing in the line list and the CSV — silently absent
   * from the one card whose job is telling the user whether they owe anything, with nothing
   * on screen explaining why. The date field ships with a real default (2026-03-15, see the
   * .astro markup), so this only refuses a line whose date the user has actively cleared.
   */
  function draftLine(): Line | null {
    draftReason = null;
    if (!pack || !cn!.value || !country!.value || !route!.value || !mass!.value) return null;
    const massT = Number(mass!.value);
    if (!Number.isFinite(massT) || massT < 0) return null;
    // The verified panel's contribution — the tier, and on the verified branch the attested
    // figures and any reference — or the reason it cannot contribute one. Its refusals are
    // SPECIFIC ("tick the attestation", "that is not a number"), unlike the four checks above,
    // whose shared "complete the line first" message names every field at once because none of
    // them can say which one the user meant to fill.
    const v = readVerified();
    if ('error' in v) { draftReason = v.error; return null; }
    const l: Line = {
      id: crypto.randomUUID(), cn: cn!.value, country: country!.value, route: route!.value,
      scope: (scope?.value as Line['scope']) ?? 'direct_and_indirect',
      massT: mass!.value, date: date!.value,
      // Spread LAST and unconditionally: `tier` is required on Line (see its doc in
      // cbam-lines.ts) and v.ok is typed to always carry one, so the compiler — not a default
      // written here — is what guarantees every line states which tier priced it. The optional
      // seeIndirect/verifiedRef keys are ABSENT rather than empty when unused; that distinction
      // is load-bearing all the way down (parseVerifiedFields' doc, lineFingerprint's `?? null`).
      ...v.ok,
    };
    if (Number.isNaN(yearOf(l))) return null;
    return l;
  }

  /**
   * A refused line comes back as status 'unavailable' and renders its own card.
   * A THROWN DomainError is rarer (the coverage sweep saw zero across 2,870
   * pairs) but the old run() caught it for a reason — one bad line must not
   * blank the other nine. Thrown lines render the same fallback the single-line
   * path used, and are excluded from totals (see renderAll) but still appear in
   * the printable document, marked, per §3 ("every line as entered" — see
   * buildPrintDocument's LineEstimateFailure arm).
   */
  function safeEstimates(ls: readonly Line[]) {
    return ls.map((l) => {
      try { return { l, e: estimateLine(l), err: null as string | null }; }
      catch (err) { return { l, e: null, err: (err as Error).message }; }
    });
  }

  /**
   * KNOWN, ACCEPTED, COSMETIC RACE (quality review item 7): if an onAdd() is still in flight
   * (awaiting ensurePack/lineFingerprint) when the user removes their ONLY existing line, `lines`
   * drops to 0 and this branch fires — the panel flashes to the single-line preview for the
   * moment before the pending add resolves and flips it back to the multi-line view. Final state
   * is correct either way; nothing here is stale or wrong, just briefly cosmetically wrong. Not
   * fixed: avoiding it needs a new piece of shared "adds in flight" state and a decision about
   * what the empty-but-pending panel should show meanwhile, for a rare interleaving (two
   * deliberate, independent clicks landing within the same fingerprint-hashing window) whose
   * worst outcome is a sub-second flicker. Documented per review guidance, not papered over.
   */
  function renderAll(): void {
    if (!lines.length) {
      lastPairs = [];
      // Single-line mode keeps its ORIGINAL, tested contract: the whole panel is one aria-live
      // region, because a refusal only sighted users learn about is not a refusal (the .astro
      // file's own framing-banner comment). Restore "polite" in case a prior multi-line render
      // (below) turned it off.
      outWrap?.setAttribute('aria-live', 'polite');
      // MUST clear #cbStatus here too — found on review of f04b95b. Once that commit made
      // #cbStatus the authoritative channel for screen-reader users in multi-line mode (the panel
      // itself goes aria-live="off" while lines exist), a stale summary left here after the list
      // empties back out is no longer a cosmetic stale line-count next to a live panel — it is a
      // stale euro figure ("1 line in this estimate... €5,882.98.") announced as current to
      // exactly the users who have no other way to learn it is gone, sitting right next to a
      // panel whose OWN aria-live is restored to "polite" and will correctly (re)announce
      // whatever run() puts there. Clearing avoids double-announcing on top of that restored
      // region rather than composing a redundant second summary here.
      status!.textContent = '';
      run();
      return;
    }
    const pairs = safeEstimates(lines);
    lastPairs = pairs;
    const ok = pairs.filter((p) => p.e !== null);
    const totals = sumTotals(ok.map((p) => p.e!));

    // thresholdByYear THROWS on any in-scope line missing a fingerprint (its own doc: this
    // fires inside the per-year map, so one bad line discards EVERY year's card, not just its
    // own). run() already has a try/catch for exactly this shape of failure; match it here too
    // — and, unlike leaving out!.innerHTML untouched on a caught error (which would silently
    // leave whatever was on screen from the PREVIOUS render looking current), replace the
    // year-card region with a visible error so a stale render is never mistaken for a fresh one.
    // Captured outside the try (rather than only building yearsHtml inline) so the SAME verdicts
    // that produced the visible year cards are also available below for the #cbStatus
    // announcement — one computation, read twice, rather than a second thresholdByYear call that
    // could disagree with the first if `attested`/`fingerprints` changed between them (they can't,
    // synchronously, but a second call would still be two chances to drift instead of one).
    let years: YearThreshold[] = [];
    let yearsHtml: string;
    try {
      years = thresholdByYear(lines, fingerprints, attested, pack!);
      yearsHtml = years.map(renderYearThreshold).join('');
    } catch (err) {
      yearsHtml = `<div class="cb-res cb-unavail">
        <div class="cb-tag unavail">Threshold error</div>
        <p class="cb-reason">${esc((err as Error).message)}</p></div>`;
      // years stays [] — the announcement below must not claim a verdict computed from data that
      // just failed to compute.
    }

    // MULTI-LINE MODE NARROWS THE LIVE REGION (quality review item 5). #cbOut's aria-live was
    // written for the single-line preview, where one edit replaces one card. In multi-line mode
    // the SAME region holds every year card, every line card, every waterfall and provenance
    // stamp, and renderAll replaces all of it on every add, remove and attest toggle — so a
    // screen-reader user ticking ONE checkbox got the ENTIRE, ever-growing panel read back. This
    // file already fixed the identical shape of problem once (see the mass-input debounce below:
    // a screen-reader user "heard the whole result... once per keystroke"); there is no debounce
    // lever here — these are discrete clicks, not rapid typing — so instead the panel's live
    // region is turned OFF for the duration of multi-line mode, and #cbStatus (its own, already
    // separately-live region) carries a short, current summary instead: the line count, as
    // before, plus the headline total when one exists. TRADE-OFF, taken deliberately: a
    // screen-reader user no longer hears per-line detail automatically after each edit — they
    // still can, by navigating into the (unchanged, still fully marked-up) panel — in exchange
    // for not being read a wall of cards after every single click.
    outWrap?.setAttribute('aria-live', 'off');
    out!.innerHTML = yearsHtml + renderTotals(totals) + pairs.map((p, i) => p.e
      ? renderLineCard(p.l, p.e, i)
      : `<article class="cb-line" data-line="${esc(p.l.id)}">
           <div class="cb-line-head">
             <span class="cb-line-n">Line ${i + 1}</span>
             <span class="cb-line-sum">${esc(p.l.cn)} · ${esc(p.l.country)} · ${num(p.l.massT)} t</span>
             <button type="button" class="cb-line-x" data-remove="${esc(p.l.id)}"
               aria-label="Remove line ${i + 1}">Remove</button>
           </div>
           <div class="cb-res cb-unavail"><div class="cb-tag unavail">No estimate</div>
           <p class="cb-reason">${esc(p.err!)}</p></div>
         </article>`).join('');
    csvBtn && (csvBtn.disabled = false);
    docBtn && (docBtn.disabled = false);

    // With the panel's aria-live off, this sentence is the ONLY thing a screen-reader user hears
    // after an add/remove/attest action — so it must carry every fact that changes what the
    // visible panel is telling the user to do or believe, not just the line count. Two omissions
    // found on review, both fixed by reusing the SAME functions the visible cards use (so the
    // spoken text cannot drift from what a sighted user sees):
    //   - totalsTag(): ~94% of real answers are cscf_pending. Stating the euro figure with no
    //     qualifier tells a screen-reader user it is a settled bill when the card right next to
    //     it says "What-if · CSCF unpublished" — the exact false-certainty failure the §4
    //     caveats, the cscf_pending status and the zero_by_fiat/ok split all exist to prevent
    //     everywhere else in this file, reintroduced here for one group of users only.
    //   - refusedLineNote(): a refusal only sighted users learn about is not a refusal. A line
    //     that produced no estimate was previously silent-absent from everything a screen-reader
    //     user perceives once the panel itself went aria-live="off".
    // A third fact is included for the same reason: a year's threshold verdict can flip from
    // "indeterminate" to "below threshold" as a DIRECT result of the very checkbox the user just
    // ticked (see onOutClick's focus-restore, which returns focus to that same checkbox) — the
    // checkbox's own checked/unchecked state is announced by the screen reader natively, but that
    // announcement does not say what the tick actually DID to the year's verdict, and nothing
    // else in aria-live="off" mode would. yearVerdictTag() reuses the exact tag text the card
    // itself shows, for the same anti-drift reason as the other two — every year, NOT filtered to
    // `ruleFound`: a year with no published rule gets an explicit "No published rule" card for
    // sighted users, and silently dropping it here would be the same gap, just a milder one
    // (omission rather than misstatement).
    const yearVerdicts = years
      .map((y) => `${y.calendarYear} ${yearVerdictTag(y).toLowerCase()}`)
      .join('; ');
    const totalsHeadline = totals.pricedLines > 0
      ? ` ${totalsTag(totals.anyPending)}: ${num(totals.certificates)} certificates${
          totals.costEur ? `, ${eur(totals.costEur)}` : ''}.`
      : '';
    const refusedNote = totals.refusedLines ? ` ${refusedLineNote(totals.refusedLines)}` : '';
    status!.textContent = `${lines.length} line${lines.length === 1 ? '' : 's'} in this estimate.`
      + (yearVerdicts ? ` Threshold ${yearVerdicts}.` : '')
      + totalsHeadline
      + refusedNote;
  }

  async function onAdd(): Promise<void> {
    // Disabled for the FULL duration of this call (quality review item 6) — not a "no duplicate
    // lines" rule. Two lines with identical fields can be a legitimate estimate (two separate
    // shipments of the same good), so deliberate re-adding must stay possible; this only closes
    // the double-click window: two rapid clicks on #cbAdd before the first click's async
    // ensurePack/lineFingerprint settled used to add the same drafted line twice, under two
    // different UUIDs. The outer try/finally guarantees re-enabling on every exit — the early
    // "pack failed to load" return, the "form incomplete" return, the fingerprint failure below,
    // and the success path alike.
    if (add) add.disabled = true;
    try {
      if (!await ensurePack()) return;
      const l = draftLine();
      if (!l) {
        status!.textContent = draftReason
          ?? 'Complete the line first: good, origin, route, a non-negative mass and a valid import date.';
        return;
      }
      try {
        // Every other fallible async path in this file reports a failure to #cbStatus (ensurePack
        // does; onDoc's thresholdByYear catch does). This one didn't (quality review item 1): with
        // crypto.subtle.digest forced to reject, clicking Add did nothing visible at all — no
        // line, no status change, the rejection reaching only devtools. lineFingerprint can
        // genuinely fail (no secure context, a disabled Web Crypto API, the same class of failure
        // any other await here already guards against), and the user needs to be told, not left
        // clicking a button that appears to do nothing.
        fingerprints.set(l.id, await lineFingerprint(l));
      } catch (err) {
        status!.textContent = `Could not add the line: ${(err as Error).message}`;
        return;
      }
      lines.push(l);
      // The set of lines for this line's year just changed, so any EXISTING attestation for that
      // year was a claim about a list that no longer matches what's on screen — see the symmetric
      // drop in onOutClick's remove branch for the full rule and why "drop only when the year
      // empties" is not enough.
      const year = yearOf(l);
      if (!Number.isNaN(year)) attested.delete(year);
      renderAll();
    } finally {
      if (add) add.disabled = false;
    }
  }

  /**
   * ATTESTATION-INVALIDATION RULE: a calendar year's "these are all my imports" tick is dropped
   * the moment the set of LINES belonging to that year changes at all — on every add into that
   * year and on every remove out of it — not merely when the year's line count reaches zero.
   *
   * Why the stronger rule: `attested` is a bare `Set<number>` keyed by calendar year, with no
   * memory of WHICH lines were on screen when it was ticked. Consider: add a 2026 line, tick "all
   * my 2026 imports", remove that line, add a DIFFERENT 2026 line. A "drop only when empty" rule
   * clears the attestation at step 3 (the year *did* empty) — but nothing stops the sequence "tick
   * → remove line A → add line B → add line C" from leaving the tick set the whole time, and the
   * final list (B, C) was never the list the user attested to. The set changing at all, in either
   * direction, invalidates the claim: it was a statement about ONE specific list, and any edit
   * produces a different list the user has not confirmed is complete. Ticking is cheap (one
   * click) and the spec is explicit that this tool must never assert completeness on the user's
   * behalf — re-attesting after every edit is the honest cost of that rule, not friction to
   * engineer away.
   */
  function onOutClick(ev: Event): void {
    // closest(), not a direct getAttribute() read off ev.target (quality review item 4): the
    // Remove button is text-only today, so ev.target IS the button on every real click — but
    // that is an accident of today's markup, not a guarantee. The moment anyone adds an icon or
    // wraps the label in a <span>, a click lands on that CHILD, ev.target's own data-remove is
    // absent, and the click silently does nothing. closest() walks up to the element that
    // actually carries the attribute, on the button itself or any descendant of it.
    const t = ev.target as HTMLElement;
    const removeBtn = t?.closest?.<HTMLElement>('[data-remove]') ?? null;
    if (removeBtn) {
      const rm = removeBtn.getAttribute('data-remove')!;
      const i = lines.findIndex((l) => l.id === rm);
      if (i >= 0) {
        const [removed] = lines.splice(i, 1);
        fingerprints.delete(rm);
        const year = yearOf(removed!);
        if (!Number.isNaN(year)) attested.delete(year);
      }
      if (!lines.length) { csvBtn && (csvBtn.disabled = true); docBtn && (docBtn.disabled = true); }
      renderAll();
      // renderAll rebuilds #cbOut via innerHTML, destroying the Remove button just clicked and
      // dropping keyboard focus to <body> (quality review item 2 — the attest branch below got
      // this fix; this branch didn't). Deterministic target: splice() shifts every later line
      // down by one, so the button now sitting at the removed line's own index `i` is the line
      // that visually took its place — focus that. If `i` ran past the end (the removed line was
      // the last one and others remain), Math.min falls back to the new last Remove button. If no
      // lines remain, both are absent and focus falls to the Add button, the only actionable
      // control left once the panel returns to the single-line preview.
      const remaining = out!.querySelectorAll<HTMLButtonElement>('[data-remove]');
      (remaining[Math.min(i, remaining.length - 1)] ?? add)?.focus();
      return;
    }
    const attestBox = t?.closest?.<HTMLInputElement>('[data-attest]') ?? null;
    if (attestBox) {
      const at = attestBox.getAttribute('data-attest')!;
      attestBox.checked ? attested.add(Number(at)) : attested.delete(Number(at));
      renderAll();
      // renderAll rebuilds #cbOut via innerHTML, which destroys the checkbox the user just
      // clicked/toggled with the keyboard and drops focus to <body>. The checkbox's identity
      // survives the rebuild as its data-attest value (derived from the year, not the DOM node
      // itself), so re-find it by that and restore focus — otherwise a keyboard user loses their
      // place on every single tick.
      out!.querySelector<HTMLInputElement>(`[data-attest="${CSS.escape(at)}"]`)?.focus();
    }
  }

  function onCsv(): void {
    if (!lines.length || !pack) return;
    // Exports exactly what renderAll last put on screen (see lastPairs's own doc above) — not a
    // fresh recomputation. Thrown lines are excluded: csvRows requires `lines` and `results` to
    // stay parallel, and there is no CertificateEstimate to put in a thrown line's slot (contrast
    // buildPrintDocument below, which — because §3 requires "every line as entered" — gained a
    // LineEstimateFailure arm precisely so it does NOT have to drop those lines the way the CSV
    // does; the CSV is the working artefact, not the record of everything the user typed).
    const ok = lastPairs.filter((p) => p.e !== null);
    if (!ok.length) {
      status!.textContent = 'No line has a priced estimate; nothing to export.';
      return;
    }
    // csvRows and toCsv BOTH throw by design — on a lines/results length mismatch, on a line
    // whose tier disagrees with the tier that priced it, on a multi-benchmark line, on a ragged
    // row (their own docs). Uncaught, every one of those left the Export button silently dead:
    // no file, no message, the reason reaching devtools alone. Report it the way every other
    // fallible path in this file already does (ensurePack, onAdd's fingerprint catch, onDoc's
    // thresholdByYear catch) — through #cbStatus, naming what refused. The message is the
    // engine's own; a generic "export failed" would tell the user nothing they could act on.
    let csv: string;
    try {
      csv = toCsv(csvRows(ok.map((p) => p.l), ok.map((p) => p.e!), fingerprints, snapshot, pack));
    } catch (err) {
      status!.textContent = `Could not export the CSV: ${(err as Error).message}`;
      return;
    }
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `cbam-estimate-${new Date().toISOString().slice(0, 10)}.csv`;
    // Appended before the click (Firefox requires the anchor be connected to the document for a
    // synthetic click to trigger the download), removed right after (the click's default action
    // is already queued by then, so removal does not cancel it).
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking the object URL immediately after click() cancels the download in several
    // browsers — the click schedules an async save/navigation that has not necessarily read the
    // blob yet, and revoking pulls the data out from under it. Deferred well past any plausible
    // read, rather than on the same tick.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function onDoc(): void {
    if (!lines.length || !pack || !printEl) return;
    // Same export-what-was-shown discipline as onCsv (see lastPairs's doc above), but §3 requires
    // "every line as entered" in §1 of the document — so, unlike the CSV, a thrown line is NOT
    // dropped; it is carried through as a LineEstimateFailure so `lines`/`results` stay parallel
    // and the line still appears, marked, rather than vanishing with no trace while still being
    // counted in the year cards below (which are computed from ALL lines, not just priced ones).
    const results: (CertificateEstimate | LineEstimateFailure)[] = lastPairs.map((p) =>
      p.e ?? { failed: true, message: p.err ?? 'unknown error' });
    const priced = lastPairs.filter((p) => p.e !== null).map((p) => p.e!);
    if (!priced.length) {
      status!.textContent = 'No line has a priced estimate; nothing to export.';
      return;
    }
    let years: YearThreshold[];
    try {
      years = thresholdByYear(lines, fingerprints, attested, pack);
    } catch (err) {
      status!.textContent = `Could not build the document: ${(err as Error).message}`;
      return;
    }
    // Same exposure as onCsv's, found the same way: buildPrintDocument throws on a
    // lines/results length mismatch (its own guard), and an uncaught throw here would leave
    // #cbPrint holding the PREVIOUS export's markup while the print dialog never opens — a
    // silently dead button, and a stale document waiting for the next Ctrl+P. Caught before the
    // `cb-printing` class is added, so a failure cannot strand the page in a printable-wrong
    // state either.
    let html: string;
    try {
      html = buildPrintDocument({
        lines, results,
        yearCards: years,
        totals: sumTotals(priced),
        packSnapshot: snapshot,
        rulePackages: priced[0]?.stamp.rulePackages ?? [],
        pack, generatedOn: new Date().toISOString().slice(0, 10),
      });
    } catch (err) {
      status!.textContent = `Could not build the document: ${(err as Error).message}`;
      return;
    }
    printEl.innerHTML = html;

    // `cb-printing` MUST NOT be able to outlive this call (quality review item 3). It used to
    // depend solely on `afterprint` firing — but a feature policy denying window.print(), a
    // browser extension no-op'ing it, or any flow that doesn't complete the print round trip
    // leaves it on <html> forever. It is invisible on screen (the CSS that reacts to it is
    // `@media print` only), so nothing SHOWS this happened — until the next time this page is
    // printed by ANY means, Ctrl+P included, when the user gets this stale audit document (or a
    // blank page) instead of whatever they actually asked to print. `cleanup` is idempotent and
    // reachable from three independent paths, so no single missing event can strand the class:
    //   1. `afterprint` — the normal, complete round trip.
    //   2. `matchMedia('print')`'s `change` event — fires around the real print/preview lifecycle
    //      in Chromium and Firefox even in some cases where `afterprint` is suppressed.
    //   3. A hard timeout — the last-resort net under both, for the pathological case where
    //      nothing above ever fires at all (e.g. printing is silently blocked outright).
    let cleaned = false;
    let fallbackTimer = 0;
    const mql = window.matchMedia?.('print') ?? null;
    const onMqlChange = (e: MediaQueryListEvent) => { if (!e.matches) cleanup(); };
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.documentElement.classList.remove('cb-printing');
      window.removeEventListener('afterprint', cleanup);
      mql?.removeEventListener('change', onMqlChange);
      clearTimeout(fallbackTimer);
    };
    document.documentElement.classList.add('cb-printing');
    window.addEventListener('afterprint', cleanup, { once: true });
    mql?.addEventListener('change', onMqlChange);
    // 30s: generous enough not to race a user genuinely still deciding in a real print dialog
    // (matchMedia already covers that transition in the browsers that support it), short enough
    // that a silently-blocked print does not leave the page in a printable-wrong state for long.
    fallbackTimer = window.setTimeout(cleanup, 30_000);
    try {
      window.print();
    } catch (err) {
      // window.print() can throw synchronously (a feature policy denying it, for one) — clean up
      // immediately rather than wait for any of the above to do it.
      cleanup();
      status!.textContent = `Could not open the print dialog: ${(err as Error).message}`;
    }
  }

  // route/scope/mass/date/cn/country changes preview the draft line only while `lines` is empty
  // (the single-line path, byte-compatible with the pre-Task-6 behaviour); once lines exist, the
  // form is purely the editor for the NEXT prospective line and must not touch the multi-line
  // render underneath it.
  const refresh = () => { if (!lines.length) run(); };
  // syncVerifiedRows() ALWAYS runs after syncScope(), never before: it reads the `scopeRow.hidden`
  // that syncScope() has just computed, and running it first would judge the indirect field
  // against the PREVIOUS good's scope row for one turn — showing an indirect input for a good
  // with no indirect side, or hiding (and therefore clearing) one the user is entitled to.
  const onPick = async () => {
    if (await ensurePack()) { syncRoutes(); syncScope(); syncVerifiedRows(); refresh(); }
  };
  route.addEventListener('change', () => { syncScope(); syncVerifiedRows(); refresh(); });
  scope?.addEventListener('change', () => { syncVerifiedRows(); refresh(); });
  tier?.addEventListener('change', () => { syncVerifiedRows(); refresh(); });
  cn.addEventListener('change', onPick);
  cn.addEventListener('focus', () => { void ensurePack(); }, { once: true });
  country.addEventListener('change', onPick);
  date.addEventListener('change', onPick);
  // DEBOUNCED, because #cbOut sits inside aria-live="polite". Bound directly to
  // `input`, typing "1250" re-rendered the panel four times and a screen-reader
  // user heard the whole result — tag, figure, waterfall, provenance — read out
  // once per keystroke. Switching to `change` would cost nothing but stops the
  // figure tracking as you type, which is worse on a calculator.
  let massTimer: number | undefined;
  const bounce = () => {
    clearTimeout(massTimer);
    massTimer = window.setTimeout(refresh, 250);
  };
  mass.addEventListener('input', bounce);
  // The verified figures are typed the same way a mass is, into the same aria-live panel, so
  // they share the same debounce — and the same single timer, so typing in one field cancels a
  // pending render from another rather than queueing a second one.
  seeDirect?.addEventListener('input', bounce);
  seeIndirect?.addEventListener('input', bounce);
  // #cbRef is DELIBERATELY NOT WIRED. The reference is transcribed, never validated and never
  // priced — it cannot move the preview by a cent or flip a refusal to a figure. Re-rendering on
  // it would re-announce the entire estimate into the aria-live panel once per 250 ms of typing
  // a verifier's report ID, which is the exact failure the mass debounce above exists to stop.
  // It is read, with the rest of the panel, when the line is actually added.
  // A tick is one discrete action, not typing — announce it immediately, as the year-card
  // attestation checkbox already does.
  attest?.addEventListener('change', refresh);
  // ONCE, AT WIRING TIME, and not only on the first user interaction: Firefox (and bfcache
  // restores generally) repopulate <select> and <input> values across a reload, so #cbTier can
  // come back reading 'actual-verified' while #cbVerifiedRow is still `hidden` from the markup —
  // invisible fields feeding a verified line. This reconciles the panel with whatever the browser
  // restored before any of it can reach an estimate.
  syncVerifiedRows();
  add?.addEventListener('click', () => { void onAdd(); });
  csvBtn?.addEventListener('click', onCsv);
  docBtn?.addEventListener('click', onDoc);
  out.addEventListener('click', onOutClick);
  out.addEventListener('change', onOutClick);
}
