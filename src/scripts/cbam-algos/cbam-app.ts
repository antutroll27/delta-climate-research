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
  type EstimatorPack, type ThresholdView,
} from './estimator/estimate-from-pack.ts';
import type { CertificateEstimate } from './cbam/certificate-estimate.ts';
import type { Line, Totals, YearThreshold } from '../cbam-lines.ts';

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

/** tCO2e and certificate counts carry long decimal tails; 3 dp is plenty to read. */
const num = (s: string, dp = 3) => {
  const n = Number(s);
  // esc() on the fallback: every other path into innerHTML in this file is escaped,
  // and this is the only one that returns its argument verbatim.
  return Number.isFinite(n) ? n.toLocaleString('en-GB', { maximumFractionDigits: dp }) : esc(s);
};
const eur = (s: string | null) =>
  s === null ? null : `€${Number(s).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
      <p class="cb-prov">${esc(t.sourceLocator)} · as amended by Reg (EU) 2025/2083</p>
    </section>`;
}

/**
 * YearThreshold marks state/knownEligibleMassT/thresholdT/sourceLocator/entryIds/entryHashes
 * optional because thresholdByYear only populates them when ruleFound is true (see its doc in
 * cbam-lines.ts). A `y.state!` at every use site records no reason a reader can check; this type
 * guard narrows once, so a future field the resolver forgets to populate is a compile error at
 * the call site that reads it, not an `undefined` reaching num().
 */
type FoundYearThreshold = YearThreshold & Required<Pick<YearThreshold,
  'state' | 'knownEligibleMassT' | 'thresholdT' | 'sourceLocator' | 'entryIds' | 'entryHashes'>>;
function hasPublishedRule(y: YearThreshold): y is FoundYearThreshold {
  return y.ruleFound;
}

/**
 * One card per calendar year present in the line list. This is the multi-line counterpart of
 * renderThreshold above: a single line can only ever be "indeterminate", because one line is not
 * a year. Here the user can attest the list IS the year, which is what unlocks below_threshold —
 * the verdict then says on every surface that it rests on their statement, not on ours.
 */
export function renderYearThreshold(y: YearThreshold): string {
  if (!hasPublishedRule(y)) return `
    <section class="cb-card cb-thresh">
      <div class="cb-card-head">
        <h3 class="cb-card-label">Annual de minimis · ${esc(String(y.calendarYear))}</h3>
        <span class="cb-tag pending">No published rule</span>
      </div>
      <p class="cb-sub">No de minimis threshold has been published for ${esc(String(y.calendarYear))}. We show no verdict rather than assume one.</p>
    </section>`;

  const above = y.state === 'above_threshold';
  const below = y.state === 'below_threshold';
  // 'pending' for indeterminate, not 'ok': an unresolved verdict must not wear the same green
  // as a genuine below-threshold answer — see renderThreshold's identical fix just above.
  const tone = above ? 'unavail' : below ? 'ok' : 'pending';
  const tag = above ? 'Above threshold' : below ? 'Below threshold' : 'Indeterminate';
  const attest = above ? '' : `
    <label class="cb-attest">
      <input type="checkbox" data-attest="${esc(String(y.calendarYear))}" ${y.attested ? 'checked' : ''} />
      These are all my ${esc(String(y.calendarYear))} imports of CBAM goods
    </label>`;
  const sub = above
    ? `The listed ${esc(String(y.calendarYear))} imports exceed the threshold; the exemption does not apply.`
    : below
      ? `Below the threshold an importer owes nothing for ${esc(String(y.calendarYear))}. This verdict rests on your attested statement that the list is complete — it is your completeness claim, verified by no one.`
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
      <p class="cb-prov">${esc(y.sourceLocator)} · as amended by Reg (EU) 2025/2083</p>
    </section>`;
}

/**
 * The summed exposure. A total containing any what-if is itself a what-if, and a total with no
 * priced lines at all (Totals.certificates === '0' both for "genuinely zero" and "nothing was
 * summed", per that field's own doc in cbam-lines.ts) must never render as a confirmed zero —
 * hence its own state below, distinct from a real "Priced" verdict at 0.
 */
export function renderTotals(t: Totals): string {
  if (t.pricedLines === 0) return `
    <section class="cb-card cb-res cb-total">
      <div class="cb-card-head">
        <h3 class="cb-card-label">Total exposure</h3>
        <span class="cb-tag unavail">Nothing priced</span>
      </div>
      <p class="cb-sub">No line has a priced estimate, so there is no total to show — not even a zero.${
        t.refusedLines ? ` ${t.refusedLines} line${t.refusedLines === 1 ? ' has' : 's have'} no estimate and ${t.refusedLines === 1 ? 'is' : 'are'} excluded.` : ''}</p>
    </section>`;

  const tone = t.anyPending ? 'pending' : 'ok';
  const tag = t.anyPending ? 'What-if · CSCF unpublished' : 'Priced';
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
      ${t.refusedLines ? `<p class="cb-sub cb-warn">${t.refusedLines} line${t.refusedLines === 1 ? ' has' : 's have'} no estimate and ${t.refusedLines === 1 ? 'is' : 'are'} excluded from this total.</p>` : ''}
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
 * A regulation's workbook sha256, read from the pack's own generatedFrom list rather than
 * hardcoded — a hardcoded value would silently go stale (or be wrong from the start; two
 * candidate hashes drafted for this function did not match the shipped pack at all) and the
 * document would then print a false provenance claim on the one surface whose entire purpose is
 * provenance. Falls back to a stated absence, never to a fabricated-looking value.
 */
function ojWorkbookHash(pack: Pick<EstimatorPack, 'generatedFrom'>, sourceId: string): string {
  return pack.generatedFrom.find((s) => s.id === sourceId)?.workbookSha256 ?? 'not present in this pack';
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
  results: readonly CertificateEstimate[];
  yearCards: readonly YearThreshold[];
  totals: Totals;
  packSnapshot: string;
  rulePackages: readonly string[];
  pack: Pick<EstimatorPack, 'generatedFrom'>;
  generatedOn: string;
}): string {
  const { lines, results, yearCards, totals, packSnapshot, rulePackages, pack, generatedOn } = input;
  if (lines.length !== results.length) {
    // Matches csvRows's own idiom in cbam-lines.ts: name the mismatch loudly rather than let
    // `results[i]!` below hand back a bare `undefined` with nothing to debug from.
    throw new Error(
      `buildPrintDocument: ${lines.length} line(s) but ${results.length} result(s) — every line `
      + 'must have exactly one CertificateEstimate, in the same order, before it can be printed',
    );
  }

  const lineRows = lines.map((l, i) => {
    const e = results[i]!;
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

  const verdicts = yearCards.map((y) => hasPublishedRule(y)
    ? `<li>${esc(String(y.calendarYear))}: <b>${esc(y.state.replace(/_/g, ' '))}</b> at ${num(y.knownEligibleMassT)} t of ${num(y.thresholdT)} t — completeness box ${y.attested ? 'TICKED by the user' : 'not ticked'}.</li>`
    : `<li>${esc(String(y.calendarYear))}: no de minimis threshold published; no verdict.</li>`).join('');

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
        generation timestamp and both Commission source-workbook hashes.</li>
      <li>IR (EU) 2025/2620 (free allocation): <code>${esc(ojWorkbookHash(pack, 'eu-cbam-2026-free-allocation'))}</code></li>
      <li>IR (EU) 2025/2621 (default values): <code>${esc(ojWorkbookHash(pack, 'eu-cbam-2026-defaults-v2'))}</code></li>
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

/* ── wiring ────────────────────────────────────────────────────────────────── */
export function initCbam(): void {
  const cn = $<HTMLInputElement>('cbCn'), country = $<HTMLSelectElement>('cbCountry');
  const route = $<HTMLSelectElement>('cbRoute'), mass = $<HTMLInputElement>('cbMass');
  const date = $<HTMLInputElement>('cbDate'), out = $('cbOut'), status = $('cbStatus');
  const list = $<HTMLDataListElement>('cbCnList'), prov = $('cbProv');
  const scope = $<HTMLSelectElement>('cbScope'), scopeRow = $('cbScopeRow');
  if (!cn || !country || !route || !mass || !date || !out || !status) return;

  let pack: EstimatorPack | null = null;

  async function ensurePack(): Promise<EstimatorPack | null> {
    if (pack) return pack;
    status!.textContent = 'Loading published rule values…';
    try {
      pack = await loadPack();
    } catch (err) {
      status!.textContent = `Could not load the rule pack: ${(err as Error).message}`;
      return null;
    }
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
    try {
      const e = estimateFromPack(pack, {
        cn: cn!.value, country: country!.value, route: route!.value,
        massT: mass!.value, date: date!.value,
        emissionsScope: (scope?.value as 'direct' | 'direct_and_indirect') ?? 'direct_and_indirect',
      });
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

  const onPick = async () => { if (await ensurePack()) { syncRoutes(); syncScope(); run(); } };
  route.addEventListener('change', () => { syncScope(); run(); });
  scope?.addEventListener('change', run);
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
  mass.addEventListener('input', () => {
    clearTimeout(massTimer);
    massTimer = window.setTimeout(run, 250);
  });
}
