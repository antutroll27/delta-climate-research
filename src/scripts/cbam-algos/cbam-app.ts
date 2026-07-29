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
import { estimateFromPack, routesFor, type EstimatorPack } from './estimator/estimate-from-pack.ts';
import type { CertificateEstimate } from './cbam/certificate-estimate.ts';

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

/** The subtraction, shown as terms rather than a single opaque number. */
function renderWaterfall(e: Extract<CertificateEstimate, { terms: unknown }>, fig: {
  faaTco2e: string; netTco2e: string; certificates: string; costEur: string | null;
}): string {
  return `
    <div class="cb-water">
      <div class="cb-row"><span>Embedded emissions</span><b>${num(e.emissionsTco2e)} tCO₂e</b></div>
      <div class="cb-row"><span>− Free allocation</span><b>${num(fig.faaTco2e)} tCO₂e</b></div>
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
          the last value actually set (2021–25). The real figure cannot be higher, and may be lower.
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
      });
      out!.innerHTML = renderResult(e);
    } catch (err) {
      // A DomainError is the engine refusing, and it names what is missing. Show it
      // rather than a generic failure — the reason is the useful part.
      out!.innerHTML = `<div class="cb-res cb-unavail">
        <div class="cb-tag unavail">No estimate</div>
        <p class="cb-reason">${esc((err as Error).message)}</p></div>`;
    }
  }

  const onPick = async () => { if (await ensurePack()) { syncRoutes(); run(); } };
  cn.addEventListener('change', onPick);
  cn.addEventListener('focus', () => { void ensurePack(); }, { once: true });
  country.addEventListener('change', onPick);
  date.addEventListener('change', onPick);
  route.addEventListener('change', run);
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
