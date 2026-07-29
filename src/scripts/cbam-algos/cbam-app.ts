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
  return Number.isFinite(n) ? n.toLocaleString('en-GB', { maximumFractionDigits: dp }) : s;
};
const eur = (s: string | null) =>
  s === null ? null : `€${Number(s).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
      return `
        <div class="cb-res cb-ok">
          <div class="cb-tag ok">Priced</div>
          <div class="cb-fig"><span class="cb-n">${num(e.figure.certificates)}</span><span class="cb-u">certificates</span></div>
          ${e.figure.costEur ? `<div class="cb-cost">${eur(e.figure.costEur)}</div>` : ''}
          <div class="cb-sub">Cross-sectoral correction factor ${esc(e.cscf)}</div>
          ${renderWaterfall(e, e.figure)}${renderStamp(e)}
        </div>`;

    case 'zero_by_fiat':
      // Electricity. Free allocation is nil because Art 2(2) says so, not because a
      // calculation produced zero — so this figure IS final even in 2026, and saying
      // "CSCF pending" here would be wrong in the other direction.
      return `
        <div class="cb-res cb-ok">
          <div class="cb-tag ok">Priced · free allocation nil by law</div>
          <div class="cb-fig"><span class="cb-n">${num(e.figure.certificates)}</span><span class="cb-u">certificates</span></div>
          ${e.figure.costEur ? `<div class="cb-cost">${eur(e.figure.costEur)}</div>` : ''}
          <div class="cb-sub">No free allocation applies · ${esc(e.locator)}</div>
          ${renderWaterfall(e, e.figure)}${renderStamp(e)}
        </div>`;

    case 'cscf_pending':
      // NON-NEGOTIABLE 3. The Commission has not published the cross-sectoral
      // correction factor for this year, so no final figure exists. What is shown is
      // explicitly a what-if at the last CSCF actually set (1.0, for 2021-25). The
      // word "scenario" and the assumed factor are in the markup, not a tooltip.
      return `
        <div class="cb-res cb-pending">
          <div class="cb-tag pending">What-if · CSCF for ${esc(String(e.cscfYear))} unpublished</div>
          <div class="cb-fig"><span class="cb-n">${num(e.scenario.certificates)}</span><span class="cb-u">certificates</span></div>
          ${e.scenario.costEur ? `<div class="cb-cost">${eur(e.scenario.costEur)}</div>` : ''}
          <div class="cb-sub cb-warn">
            Not a final figure. The Commission has not published the cross-sectoral correction
            factor for ${esc(String(e.cscfYear))}; this assumes CSCF&nbsp;=&nbsp;${esc(e.scenario.assumedCscf)},
            the last value actually set (2021–25). The real figure cannot be higher, and may be lower.
          </div>
          ${renderWaterfall(e, e.scenario)}${renderStamp(e)}
        </div>`;

    case 'unavailable':
      // NON-NEGOTIABLE 2. No number. Not zero, not a placeholder, not a range — the
      // rules do not price this line and the honest output is to say which rule is
      // missing. 183 of 574 offered goods land here, 181 of them iron and steel.
      return `
        <div class="cb-res cb-unavail">
          <div class="cb-tag unavail">No estimate — the rules do not price this line</div>
          <p class="cb-reason">${esc(e.reason)}</p>
          ${e.selector ? `<div class="cb-sel"><span>Missing rule</span><code>${esc(e.selector)}</code></div>` : ''}
          <p class="cb-sub">We show no deduction rather than guess one. Picking a nearby benchmark
             would produce a number that looks authoritative and is not.</p>
          ${renderStamp(e)}
        </div>`;

    default: {
      // A new status upstream must break the build here rather than render nothing.
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
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
    if (!pack || !cn!.value || !country!.value) { route!.innerHTML = '<option value="">—</option>'; route!.disabled = true; return; }
    const year = Number(date!.value.slice(0, 4)) || 2026;
    const rs = routesFor(pack, cn!.value, country!.value, year);
    route!.disabled = rs.length === 0;
    route!.innerHTML = rs.length
      ? rs.map((r) => `<option value="${esc(r)}">${r === 'default' ? 'single route' : esc(r)}</option>`).join('')
      : '<option value="">no route published for this pairing</option>';
  }

  function run(): void {
    if (!pack || !cn!.value || !country!.value || !route!.value || !mass!.value) {
      out!.innerHTML = '<p class="cb-idle">Choose a good, an origin, a route and a mass.</p>';
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
  mass.addEventListener('input', run);
}
