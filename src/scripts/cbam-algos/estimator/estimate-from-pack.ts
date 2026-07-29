import Decimal from 'decimal.js'
import { isAssignedAlpha2, OTHER_ORIGIN } from '../regulatory/iso-3166'
import {
  estimateCertificates,
  unavailableEstimate,
  type CertificateEstimate,
  type CertificateEstimateInput,
} from '../cbam/certificate-estimate'
import type { FreeAllocationTables } from '../cbam/types'

const NO_DEFAULT_REASON =
  'The Commission publishes no default value for this good, origin, production route or year, ' +
  'so no estimate is shown. Actual verified data would be entered in a case, not here.'

/**
 * The estimator prototype's compute path: a default-values estimate, in the browser, over the
 * shipped pack, through the SAME engine prod runs (`estimateCertificates`). "Prototype" is about
 * where it runs, not the maths — identical engine, identical published values, same fail-closed
 * behaviour. Defaults path only (scope full_product → Column B); actual/verified data is the
 * workspace's job.
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
}

export interface EstimatorInput {
  cn: string
  country: string
  route: string
  massT: string
  /** import date; the reporting year is its first four characters. */
  date: string
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
 * (lib/regulatory/resolve.ts:124-128): a CN is covered by its own code or any prefix the
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

export function estimateFromPack(pack: EstimatorPack, input: EstimatorInput): CertificateEstimate {
  const year = Number(input.date.slice(0, 4))
  const factor = selectFactorFromPack(pack, input)
  // Which basis the figure rests on — the origin's own published default, or the Commission's
  // world-average residual bucket. The user is told either way (see RESIDUAL_BASIS_NOTE).
  const originBasis = factor?.originCountry === OTHER_ORIGIN ? 'residual' as const : 'country' as const

  const tables = faTablesOf(pack)
  const baseInput: CertificateEstimateInput = {
    emissionsTco2e: '0',
    quantityT: input.massT,
    scope: 'full_product',
    tier: 'default+markup',
    originBasis,
    emissionsType: 'direct',
    cnCode: input.cn,
    routeIndicator: benchmarkRoute(input.route),
    importDate: input.date,
    precursors: [],
    snapshotHash: 'browser-prototype',
    linePackage: dvPackageId(pack),
    customsLineId: 'estimator-prototype',
  }

  if (!factor) {
    // No published direct default → 'unavailable' explicitly. The engine only reports
    // unavailable on a missing BENCHMARK; a missing default with emissions of 0 would look like
    // a real zero-cost figure, which it is not.
    return unavailableEstimate(baseInput, tables, NO_DEFAULT_REASON, `default/${input.cn}/${input.country}/${input.route}/${year}`)
  }

  const markedUp = new Decimal(factor.baseIntensity)
    .mul(new Decimal(1).plus(new Decimal(factor.markupPct).div(100)))
  const emissions = markedUp.mul(input.massT).toFixed()

  return estimateCertificates({ ...baseInput, emissionsTco2e: emissions }, tables)
}
