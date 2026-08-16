import Decimal from 'decimal.js'
import { isAssignedAlpha2, OTHER_ORIGIN } from '../regulatory/iso-3166'
import { sectorForCn } from '../cbam/sector'
import { evaluateThreshold, type ThresholdState } from '../threshold/evaluate'
import {
  estimateCertificates,
  unavailableEstimate,
  type CertificateEstimate,
  type CertificateEstimateInput,
  type DataTier,
} from '../cbam/certificate-estimate'
import type { FreeAllocationTables } from '../cbam/types'

const NO_DEFAULT_REASON =
  'The Commission publishes no default value for this good, origin, production route or year, ' +
  'so no estimate is shown. Actual verified data would be entered in a case, not here.'

const NO_INDIRECT_ROUTE_REASON =
  'The Commission publishes indirect (electricity) default values for this good and origin, but ' +
  'none for the production route declared, so no estimate is shown. Pricing the electricity ' +
  'component at zero would understate the bill without saying so.'

const BAD_VERIFIED_REASON =
  'A verified emissions figure must be a readable number of tCO2e per tonne of good, and cannot ' +
  'be negative, so no estimate is shown. Reading a missing, unreadable, infinite or negative ' +
  'figure as anything at all would put a number on a liability the figure does not support.'

const BAD_MASS_REASON =
  'Net mass must be a readable number of tonnes and cannot be negative, so no estimate is ' +
  'shown. Reading a missing, unreadable, infinite or negative mass as anything at all would ' +
  'scale a real tariff by a quantity nobody entered, and would decide the de minimis ' +
  'threshold the same way.'

/**
 * The estimator prototype's compute path: a default-values estimate, in the browser, over the
 * shipped pack, through the SAME engine prod runs (`estimateCertificates`). "Prototype" is about
 * where it runs, not the maths — identical engine, identical published values, same fail-closed
 * behaviour. Defaults path, plus attested verified figures (both scope full_product → Column B);
 * Column A / process-level data stays the workspace's job.
 *
 * The pack is the browser-shipped shape (see scripts/build-estimator-pack.mts): full-shape
 * benchmarks + slimmed default factors + the factor/CSCF/price/source series.
 */

export interface EstimatorPack {
  generatedFrom: Array<{ id: string; version: string; workbookSha256?: string }>
  generatedAt?: string
  classifications: Array<{ code: string; description: string }>
  defaultFactors: Array<{
    scopeCode: string
    originCountry: string
    emissionsType: 'direct' | 'indirect'
    productionRoute: string
    reportingYear: number
    baseIntensity: string
    markupPct: string
  }>
  benchmarks: FreeAllocationTables['benchmarks']
  cbamFactors: FreeAllocationTables['cbamFactors']
  cscf: FreeAllocationTables['cscf']
  prices: FreeAllocationTables['prices']
  sources: FreeAllocationTables['sources']
  thresholds: Array<{
    id: string
    calendarYear: number
    thresholdT: string
    includedSectors: string[]
    sourceLocator: string
  }>
}

export interface EstimatorInput {
  cn: string
  country: string
  route: string
  massT: string
  /** import date; the reporting year is its first four characters. */
  date: string
  /**
   * 'direct' (process only) or 'direct_and_indirect' (adds the electricity default the
   * Commission publishes for cement, fertilisers and hydrogen). Defaults to 'direct', which is
   * the only scope the definitive period charges for iron & steel and aluminium.
   */
  emissionsScope?: 'direct' | 'direct_and_indirect'
  /**
   * The importer's own VERIFIED specific embedded emissions, per tonne of good. A figure supplied
   * here carries NO mark-up — the mark-up exists to price not-having-data, and this is the
   * regulation's designed reward for having it. That reward is per FIGURE, not per line: the
   * default-values corpus is still consulted for any half the importer did not attest, and what
   * it returns keeps its mark-up (see indirectTco2ePerT).
   * The figure must be the WHOLE good's embedded emissions (precursors included): that scope
   * is what keeps the line on Column B. Process-only figures are Column A territory — the
   * workspace's job, never this estimator's.
   * Both figures are validated HERE, by this estimator, and a bad one is REFUSED — see
   * nonNegativeDecimal. Nothing upstream guards them: no caller passes `verified` yet, so there
   * is no UI validation to inherit, and the engine's floor clamp is not that guard either (it
   * clamps the direct side alone, then adds indirect on top).
   */
  verified?: {
    directTco2ePerT: string
    /**
     * Read only when emissionsScope includes indirect — same gate as the defaults path.
     *
     * OPTIONAL, and its absence is a real answer rather than a hole: omitted and '' both mean "I
     * did not attest this", and both fall back to the published indirect default with its
     * mark-up, stamping the line 'verified-direct+default-indirect'. Only a value that is present
     * and unreadable refuses. They used to disagree — '' refused while an omitted key priced
     * electricity at zero on a line still stamped fully verified.
     */
    indirectTco2ePerT?: string
  }
}

/** The default-values corpus spells a route-independent good as 'default'; the Annex uses ''. */
function benchmarkRoute(productionRoute: string): string {
  return productionRoute === 'default' ? '' : productionRoute
}

function faTablesOf(pack: EstimatorPack): FreeAllocationTables {
  const fa = pack.generatedFrom.find(s => s.id.includes('free-allocation'))
  return {
    packageId: fa?.id ?? 'eu-cbam-2026-free-allocation',
    packageVersion: fa?.version ?? 'v1',
    benchmarks: pack.benchmarks,
    cbamFactors: pack.cbamFactors,
    cscf: pack.cscf,
    prices: pack.prices,
    sources: pack.sources,
  }
}

function dvPackageId(pack: EstimatorPack): string {
  const dv = pack.generatedFrom.find(s => s.id.includes('defaults'))
  return `${dv?.id ?? 'eu-cbam-2026-defaults'}@${dv?.version ?? 'v1'}`
}


/**
 * Which origins' rows may answer for a declared origin, in priority order.
 *
 * Mirrors `resolveDefaultFactor` in lib/regulatory: the declared country's own rows always win;
 * the Commission's residual bucket ('OTHER') answers only for a REAL but unlisted alpha-2 code;
 * a junk origin gets nothing and the caller fails closed. The workspace and this prototype must
 * never disagree about which rules apply.
 */
function originsFor(pack: EstimatorPack, country: string): string[] {
  if (country === OTHER_ORIGIN) return [OTHER_ORIGIN] // the explicit "not individually listed" choice
  if (!isAssignedAlpha2(country)) return []
  // The residual bucket prices origins the Commission does not list. If this origin has a sheet
  // of its own, its silence about a particular good is deliberate — the workbook marked the value
  // N/A, or published it as zero — and must fail closed, not borrow a world average.
  const listed = pack.defaultFactors.some(f => f.originCountry === country)
  return listed ? [country] : [country, OTHER_ORIGIN]
}

/**
 * The direct-factor routes available for a good and origin in a year — the ONLY routes the form
 * may offer. Never free-typed: a route the corpus does not list has no default and no benchmark.
 */
/**
 * Does the pack OFFER this CN as a good? Mirrors the server's classification gate
 * (resolveClassification in lib/regulatory/resolve.ts, which every server resolution runs
 * before touching a factor): an exact listing wins, else the longest 4- or 6-digit listing that
 * prefixes it, else the good is not one this package prices.
 *
 * The estimator skipped this entirely and matched factors directly. That agreed with the server
 * only while classifications and factor scopes shared a granularity; the sweep could not see the
 * disagreement because its selector filter excluded every heading-level scope. Both directions
 * were reachable through the free-text CN field: before the pack was expanded, typing an 8-digit
 * code the server would classify by its heading returned "no default" here; after expansion,
 * typing a heading the server would refuse to classify would have priced here.
 */
function isOfferedGood(pack: EstimatorPack, cn: string): boolean {
  if (pack.classifications.some(c => c.code === cn)) return true
  return pack.classifications.some(c =>
    c.code.length < cn.length && [4, 6].includes(c.code.length) && cn.startsWith(c.code))
}

/**
 * The factor rows whose scope covers this CN, deepest published scope only — the server's rule
 * (the candidates filter inside resolveDefaultFactor, lib/regulatory/resolve.ts — cited by
 * FUNCTION, not by line, because this reference has already rotted twice: a line range points
 * at whatever happens to sit there after the next unrelated edit above it): a CN is covered by
 * its own code or any prefix the
 * Commission published at, and the most specific scope governs.
 *
 * The pack estimator used to require scopeCode === cn. That agreed with the server only while
 * the pack offered goods at exactly its factors' granularity; the moment classifications moved
 * to benchmark (8-digit) granularity over heading-level factors, exact matching would report
 * "no published default" for goods the Commission does publish.
 */
function factorsCovering(
  pack: EstimatorPack, cn: string, origin: string, year: number,
): EstimatorPack['defaultFactors'] {
  if (!isOfferedGood(pack, cn)) return []
  const covering = pack.defaultFactors.filter(f =>
    f.originCountry === origin && f.emissionsType === 'direct' &&
    f.reportingYear === year && cn.startsWith(f.scopeCode))
  const deepest = Math.max(...covering.map(f => f.scopeCode.length), -1)
  return covering.filter(f => f.scopeCode.length === deepest)
}

export function routesFor(pack: EstimatorPack, cn: string, country: string, year: number): string[] {
  for (const origin of originsFor(pack, country)) {
    const routes = new Set(factorsCovering(pack, cn, origin, year).map(f => f.productionRoute))
    // Only fall through to the residual bucket when the declared origin lists nothing at all.
    if (routes.size > 0) return [...routes].sort()
  }
  return []
}

/**
 * A provisional default-values estimate for one good. Emissions come from the direct default
 * (marked up), the free-allocation deduction from the same engine the workspace uses. A good with
 * no published direct default, or no benchmark for its route, returns the engine's `unavailable`
 * — the estimator never invents a number.
 */
/**
 * Which published default the estimator would apply, or null if the corpus prices nothing for
 * this selector. Exported so it can be diffed against the server's resolveDefaultFactor
 * (differential.test.ts): the two engines answer the same regulatory question over the same
 * rows, and a silent divergence would quote a user one figure in the form and another on the
 * case. Kept as the single selection path estimateFromPack itself uses — a copy would prove
 * nothing about the code that actually runs.
 */
export function selectFactorFromPack(
  pack: EstimatorPack,
  input: EstimatorInput,
): EstimatorPack['defaultFactors'][number] | null {
  const year = Number(input.date.slice(0, 4))
  for (const origin of originsFor(pack, input.country)) {
    const factor = factorsCovering(pack, input.cn, origin, year)
      .find(f => f.productionRoute === input.route)
    if (factor) return factor
  }
  return null
}

export interface ThresholdView {
  state: ThresholdState
  knownEligibleMassT: string
  thresholdT: string
  calendarYear: number
  sector: string
  sourceLocator: string
}

/**
 * Where this ONE line sits against the de minimis threshold (Reg (EU) 2023/956 Art 2(3)).
 *
 * The threshold is ANNUAL and per importer, so a single line can only ever prove the "above"
 * case: 60 t in one consignment is already past 50 t whatever else the year holds. Below that,
 * the honest state is INDETERMINATE, never "exempt" — which is exactly what evaluateThreshold
 * returns for a 'partial' view, and why completeness is hard-coded to 'partial' here.
 *
 * Returns null when the good's sector is unknown or the sector is not one the threshold covers
 * (hydrogen and electricity are absent from the 2026 row), because there is then no threshold
 * statement to make rather than a favourable one to assume — and, for the same reason, when the
 * net mass is not one this estimator can read (see the gate below).
 */
export function resolveThreshold(
  pack: EstimatorPack,
  input: { cn: string; massT: string; date: string },
): ThresholdView | null {
  const year = Number(input.date.slice(0, 4))
  const rule = pack.thresholds.find(t => t.calendarYear === year)
  if (!rule) return null
  const sector = sectorForCn(input.cn)
  if (!sector || !rule.includedSectors.includes(sector)) return null
  // `null`, not `state: 'indeterminate'`. An indeterminate view still renders a card carrying the
  // sector, the threshold value and a source locator — a partial legal claim assembled around a
  // mass nobody can read, and ThresholdRulerCard.vue prints knownEligibleMassT raw at 52px, which
  // is how 'Infinity' reached a user as their eligible mass. This overloads null, which already
  // means "no threshold rule this year" (and, at the store, "the pack has not loaded"), and that
  // is fine: the sole caller renders the card under `v-if="threshold"` (EstimateView), so every
  // meaning renders nothing, and the estimate's own refusal is what names the mass as the problem.
  if (!nonNegativeDecimal(input.massT)) return null
  const evaluated = evaluateThreshold({
    knownEligibleMassT: input.massT,
    completeness: 'partial',
    thresholdT: rule.thresholdT,
  })
  return { ...evaluated, calendarYear: rule.calendarYear, sector, sourceLocator: rule.sourceLocator }
}

/**
 * Three outcomes, not two, and the distinction is load-bearing.
 *
 * `none` means the Commission publishes no indirect default for this good at all — true of iron
 * & steel and aluminium, which must keep pricing with indirect 0. `route-mismatch` means rows DO
 * exist for this good, origin and year but none is published for the route the importer declared.
 * Those are different facts and they need different answers: the first is silence, the second is
 * a refusal. Collapsing them into `null` is exactly how the over-charge this replaces stayed
 * invisible — the lookup could not tell "nothing published" from "I picked the wrong row".
 */
export type IndirectLookup =
  | { kind: 'found'; factor: EstimatorPack['defaultFactors'][number] }
  | { kind: 'none' }
  | { kind: 'route-mismatch' }

/**
 * The indirect (electricity) default for this selector.
 *
 * THE ROUTE IS PART OF THE MATCH. An earlier version left it out, on the stated grounds that
 * "indirect rows are published per good, not per production route". The shipped corpus disagrees:
 * 597 of its 8,310 indirect rows carry a real route indicator ((A) 495, (B) 102). Those rows fall
 * in 510 of the 8,217 (good, origin, year) groups — but only 93 groups hold more than ONE row, and
 * the route can only decide anything there. In 90 of the 93 the value differs by route; in the
 * other 3 both rows carry the same figure, so the route corrects the provenance rather than the
 * price. Saying "510 groups are route-keyed" overstates the exposure: the other 417 hold a single
 * row and could never have differed.
 *
 * Without the route, `.find()` returned whichever row sorted first — the dearer one, in every
 * affected case — so a route-(A) line was priced with route (B)'s electricity and over-charged.
 * On Algerian cement clinker that was EUR 165.79 per 100 t, with the downstream line-export CSV
 * (its `benchmark_route` column) naming route (A) beside route (B)'s figure — an audit artefact
 * naming one route and pricing another. Six of the 93 are a second shape, absent from that
 * telling: a route-INDEPENDENT 'default' row charged to a line that declared a route.
 *
 * Matching strictly loses nothing, and the guarantee is wider than the affected groups. All 8,217
 * indirect groups carry exactly the route set their direct counterpart carries, so every one of
 * the 8,310 selectors that resolved before still resolves — measured as a SET, not a count, over
 * the whole pack. It also makes the lookup deterministic: with the route included no candidate set
 * can hold more than one row, so this file's own rule ("a tie is REGULATION_AMBIGUOUS, never a
 * first-match") stops being violated rather than narrowed.
 *
 * Fewer than 90 estimates move, though. The pack prices 2026 quarters only, so 2027 and 2028
 * import dates refuse on the missing certificate price before the indirect factor is ever read:
 * 30 estimates change end-to-end, all in 2026, and the other 60 corrections are real but latent.
 */
export function selectIndirectFactorFromPack(
  pack: EstimatorPack,
  input: EstimatorInput,
): IndirectLookup {
  const year = Number(input.date.slice(0, 4))
  for (const origin of originsFor(pack, input.country)) {
    if (!isOfferedGood(pack, input.cn)) return { kind: 'none' }
    const covering = pack.defaultFactors.filter(f =>
      f.originCountry === origin && f.emissionsType === 'indirect' &&
      f.reportingYear === year && input.cn.startsWith(f.scopeCode))
    if (covering.length === 0) continue
    // Deepest published scope first, matching the direct lookup, so an indirect figure can never
    // rest on a broader scope than the direct one it accompanies.
    const deepest = Math.max(...covering.map(f => f.scopeCode.length))
    const atDepth = covering.filter(f => f.scopeCode.length === deepest)
    const found = atDepth.find(f => f.productionRoute === input.route)
    if (found) return { kind: 'found', factor: found }
    // Rows exist for this good but not for this route. Returning `none` here would price the
    // whole electricity component at zero with no signal — an under-charge, and the third silent
    // fail-open on a page whose governing rule is fail-closed. Refuse instead.
    return { kind: 'route-mismatch' }
  }
  return { kind: 'none' }
}

/**
 * The Commission's published indirect (electricity) default for this line, already priced:
 * base intensity, its mark-up, times the net mass. `none` and `route-mismatch` pass straight
 * through from the lookup, because the two paths differ only in which stamp the refusal carries.
 *
 * ONE copy of the mark-up arithmetic, called from BOTH paths. The defaults path always needed it;
 * the verified path needs the identical figure whenever an importer attested their process
 * emissions and left electricity alone. Two copies of a tax calculation is how two copies come to
 * disagree, and this file has already paid for that once — the line facts the two paths used to
 * stamp separately drifted silently, down to a fabricated snapshotHash on one of them.
 */
type IndirectDefaultFigure =
  | { kind: 'priced'; indirectTco2e: string }
  | { kind: 'none' }
  | { kind: 'route-mismatch' }

function indirectDefaultFigure(
  pack: EstimatorPack, input: EstimatorInput,
): IndirectDefaultFigure {
  const indirect = selectIndirectFactorFromPack(pack, input)
  if (indirect.kind !== 'found') return indirect
  return {
    kind: 'priced',
    indirectTco2e: new Decimal(indirect.factor.baseIntensity)
      .mul(new Decimal(1).plus(new Decimal(indirect.factor.markupPct).div(100)))
      .mul(input.massT).toFixed(),
  }
}

/**
 * A non-negative decimal this estimator may price, or null when it may not. Used for the
 * verified per-tonne figures AND for net mass — one predicate, because they want exactly the
 * same rule and two similar ones is how they drift apart.
 *
 * There is no guard upstream and none downstream that speaks this language, so this is the one
 * that counts. `new Decimal('')` and `new Decimal('abc')` THROW, and they throw inside
 * estimateFromPack — before estimateCertificates is entered — so they escape that function's
 * fail-closed boundary entirely and reach the browser as an unhandled exception rather than a
 * refusal that names the gap. 'NaN' and 'Infinity' do not throw; they propagate through the
 * arithmetic and print as certificates and a euro cost. And the engine's floor clamp catches
 * none of it: figureFrom clamps the DIRECT side alone and then ADDS the indirect figure
 * (certificate-estimate.ts:154), so a negative value priced a NEGATIVE bill (-394.58
 * certificates, -EUR 29,735.55 on a real line; -EUR 331.58 via a -100 t mass). Nor is Decimal
 * itself the guard: it reads '0x10' as 16 and '1_000' as 1000, which is why the shape gate
 * below runs before it rather than after.
 *
 * Refusing, not clamping: a nonsense input silently turned into a priceable number is how a
 * wrong tax liability gets acted on. Zero is legal for both callers — a genuinely clean producer
 * attests it, and a 0 t line costs EUR 0.00, which is arithmetic rather than fabrication.
 */
export function nonNegativeDecimal(value: string): Decimal | null {
  // The SHAPE gate runs FIRST, because Decimal reads far more than a tonnage field ever emits:
  // it honours JS radix prefixes and numeric separators, so '0x10' parsed as 16 and priced
  // 1,474.42 certificates / EUR 111,112.29 — a confident bill off a string this function's own
  // refusal calls unreadable. '0b101' → 5, '0o17' → 15, '1_000' → 1000, all the same way. Same
  // bug class as '' and 'abc': a number nobody typed.
  //
  // Optional sign, digits with at most one point, optional decimal exponent. The sign branch is
  // load-bearing in BOTH directions: '-1' must still reach the lt(0) check below so it keeps its
  // negative-figure reason and selector, and '-0' must still pass through to price as zero. A
  // leading '+' and a trailing bare '.' ('5.') are refused here, deliberately — no numeric field
  // produces them, and under a fail-closed stance an odd shape is a question, not a value.
  if (!/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(value)) return null
  let parsed: Decimal
  try {
    parsed = new Decimal(value)
  } catch {
    return null
  }
  // Kept behind the shape gate as defence in depth, not because the gate is doubted:
  // isFinite() rejects NaN and +/-Infinity; lt(0) rejects negatives while letting '0' and '-0' by.
  if (!parsed.isFinite() || parsed.lt(0)) return null
  return parsed
}

export function estimateFromPack(pack: EstimatorPack, input: EstimatorInput): CertificateEstimate {
  const year = Number(input.date.slice(0, 4))
  const tables = faTablesOf(pack)

  // The line facts both paths stamp identically, built ONCE. They used to be written out twice,
  // and the copies drifted silently: a fabricated snapshotHash on the verified path survived
  // mutation testing while the defaults path pinned the real one.
  //
  // `tier` carries the defaults-path value and the verified path overrides it. `originBasis` is
  // absent on purpose — it is a provenance CLAIM about where a figure came from, so each path
  // must state its own rather than inherit one neither chose.
  const baseInput: Omit<CertificateEstimateInput, 'originBasis'> = {
    emissionsTco2e: '0',
    quantityT: input.massT,
    scope: 'full_product',
    tier: 'default+markup',
    emissionsType: 'direct',
    cnCode: input.cn,
    routeIndicator: benchmarkRoute(input.route),
    importDate: input.date,
    precursors: [],
    indirectTco2e: '0',
    snapshotHash: 'browser-prototype',
    linePackage: dvPackageId(pack),
    customsLineId: 'estimator-prototype',
  }

  // ABOVE the branch, deliberately: both paths multiply by mass, so gating inside either would
  // leave the other open. `tier` reports what the CALLER asked for — the refusal produces no
  // figure, so there is nothing to attribute and `originBasis` is null on either path.
  if (!nonNegativeDecimal(input.massT)) {
    const tier = input.verified ? 'actual-verified' as const : 'default+markup' as const
    return unavailableEstimate(
      { ...baseInput, tier, originBasis: null }, tables, BAD_MASS_REASON,
      `mass/${input.cn}/${input.date}`,
    )
  }

  // An attested figure replaces the DEFAULT, not the benchmark. The DIRECT figure deliberately
  // does not depend on `factor`: on this path a missing published default is not a refusal, it is
  // the ordinary case an importer collects data for. (The corpus IS consulted here, for an
  // indirect half the importer did not attest — but never for the direct one.) A missing
  // BENCHMARK still refuses, from inside estimateCertificates, exactly as before.
  if (input.verified) {
    // No published default backs the DIRECT figure, so there is no default basis to report on it:
    // null is what CertificateEstimateInput.originBasis names for a figure resting on no default,
    // and what prod's originBasisOf() returns for every method but official_default.
    // 'country' was not merely redundant — DisclosureCard.vue renders the row on truthiness and
    // would tell the importer their own audited figure is "the origin's own published default".
    //
    // It stays null on a 'verified-direct+default-indirect' line too, whose indirect half DOES
    // rest on a default and can draw it from the residual bucket. The field describes one basis
    // and that line has two, so the honest options were both imperfect: 'residual' would fire
    // RESIDUAL_BASIS_NOTE over an estimate whose direct figure is the importer's own audited
    // number. The tier carries the disclosure instead. Narrower than the note, and named as a
    // known gap rather than left to be found.
    const verifiedStamp = { ...baseInput, tier: 'actual-verified' as const, originBasis: null }
    const mass = new Decimal(input.massT)

    const direct = nonNegativeDecimal(input.verified.directTco2ePerT)
    if (!direct) {
      return unavailableEstimate(verifiedStamp, tables, BAD_VERIFIED_REASON, `verified/${input.cn}/directTco2ePerT`)
    }

    // Same gate as the defaults path: the indirect figure is only READ when the scope charges
    // for it, so it is only judged then — refusing over a value that never enters the estimate
    // would name a gap the user cannot close. On a 'direct' line nothing below runs, nothing
    // stands in for anything, and the tier stays what the attestation makes it.
    let indirectTco2e = '0'
    let tier: DataTier = 'actual-verified'
    if (input.emissionsScope === 'direct_and_indirect') {
      const attested = input.verified.indirectTco2ePerT
      // ABSENCE, spelled two ways, and they used to disagree. An omitted key priced electricity
      // at zero and still stamped the line fully verified; '' refused. Both mean "I did not
      // supply this", and omitting the key is the one a caller reaches by doing nothing — so the
      // lax reading was the reachable one. A value that is PRESENT and unreadable is a different
      // fact and still refuses below: a typo must not be quietly promoted into a default.
      if (attested !== undefined && attested !== '') {
        const indirect = nonNegativeDecimal(attested)
        if (!indirect) {
          return unavailableEstimate(verifiedStamp, tables, BAD_VERIFIED_REASON, `verified/${input.cn}/indirectTco2ePerT`)
        }
        indirectTco2e = indirect.mul(mass).toFixed()
      } else {
        // Nothing attested for electricity, so the Commission's published default stands in —
        // WITH its mark-up, priced by the same expression the defaults path uses. The mark-up
        // belongs here: it prices not-having-data, and on this half the importer does not have
        // data. Attesting the process figure earns the mark-up's removal from the process figure,
        // and nowhere else. Pricing this component at zero, which is what happened before, is a
        // silent under-charge on a page whose governing rule is fail-closed.
        const fallback = indirectDefaultFigure(pack, input)
        if (fallback.kind === 'route-mismatch') {
          return unavailableEstimate(
            verifiedStamp, tables, NO_INDIRECT_ROUTE_REASON,
            `indirect/${input.cn}/${input.country}/${input.route}/${year}`,
          )
        }
        if (fallback.kind === 'priced') {
          indirectTco2e = fallback.indirectTco2e
          // Stamped ONLY where a default actually stood in. `none` means the Commission publishes
          // no indirect default for this good at all (iron & steel, aluminium), so zero is the
          // published answer rather than a substitution — claiming a default was applied there
          // would tell an auditor to go looking for one that does not exist.
          tier = 'verified-direct+default-indirect'
        }
      }
    }

    return estimateCertificates({
      ...verifiedStamp,
      tier,
      // toFixed(), never toString(): a small attested figure must render as 0.0000000001, not
      // as the exponential '1e-10' certificate-estimate.ts:162 warns about.
      emissionsTco2e: direct.mul(mass).toFixed(),
      indirectTco2e,
    }, tables)
  }

  const factor = selectFactorFromPack(pack, input)
  // Which basis the figure rests on — the origin's own published default, or the Commission's
  // world-average residual bucket. The user is told either way (see RESIDUAL_BASIS_NOTE).
  const originBasis = factor?.originCountry === OTHER_ORIGIN ? 'residual' as const : 'country' as const

  if (!factor) {
    // No published direct default → 'unavailable' explicitly. The engine only reports
    // unavailable on a missing BENCHMARK; a missing default with emissions of 0 would look like
    // a real zero-cost figure, which it is not.
    return unavailableEstimate({ ...baseInput, originBasis }, tables, NO_DEFAULT_REASON, `default/${input.cn}/${input.country}/${input.route}/${year}`)
  }

  const markedUp = new Decimal(factor.baseIntensity)
    .mul(new Decimal(1).plus(new Decimal(factor.markupPct).div(100)))
  const emissions = markedUp.mul(input.massT).toFixed()

  // Indirect is opt-in and silent when the Commission publishes nothing for the good: asking for
  // it must never fabricate a component, and must never fail a good that has only a direct row.
  // A route MISMATCH is not that case — see IndirectLookup — and refuses.
  let indirectTco2e = '0'
  if (input.emissionsScope === 'direct_and_indirect') {
    const indirect = indirectDefaultFigure(pack, input)
    if (indirect.kind === 'route-mismatch') {
      return unavailableEstimate(
        { ...baseInput, originBasis }, tables, NO_INDIRECT_ROUTE_REASON,
        `indirect/${input.cn}/${input.country}/${input.route}/${year}`,
      )
    }
    if (indirect.kind === 'priced') indirectTco2e = indirect.indirectTco2e
  }

  return estimateCertificates({ ...baseInput, originBasis, emissionsTco2e: emissions, indirectTco2e }, tables)
}
