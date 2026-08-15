import Decimal from 'decimal.js'
import { isDomainError } from '../errors/domain-error'
import { quarterOf, resolveCertificatePrice } from './resolve-fa'
import { sefa, type BenchmarkScope, type SefaInput, type SefaTerms } from './sefa'
import type { FreeAllocationTables } from './types'

/**
 * Certificates and cost, after the free-allocation adjustment (dossier A1 + A8).
 *
 *   net certificates = max(0, embedded emissions − SEFA × mass)
 *   cost             = net × the quarter's certificate price
 *
 * Emissions come from the frozen calculation snapshot; this module never recomputes them.
 * The snapshot is the thing the ledger hashed and a verifier can walk back, and a second
 * arithmetic path over the same inputs is a second chance to disagree with it.
 *
 * THREE STATES, and the distinction is the whole point:
 *   'ok'            — a real figure. Only possible once the CSCF is published.
 *   'cscf_pending'  — no final figure exists (2026-2030). A labelled what-if only.
 *   'unavailable'   — we cannot compute it at all, and we say which input is missing.
 *
 * 'unavailable' exists so that failing closed is a FIRST-CLASS ANSWER rather than an error.
 * A missing benchmark is not a bug to be surfaced as a broken page; it is the regulation
 * declining to price that good, and the honest response is to show no number and name the
 * gap. Anything else pressures us toward inventing one.
 *
 * NOT modelled: the Art 9 deduction for a carbon price already paid in the country of
 * origin. The implementing act is still a draft, so the estimate is conservative by omission
 * and says so on every figure.
 */

export type DataTier = 'actual-verified' | 'default+markup'

export interface CertificateEstimateInput {
  /** From the frozen snapshot. */
  emissionsTco2e: string
  quantityT: string
  /** Which benchmark column the emissions scope calls for. See BenchmarkScope. */
  scope: BenchmarkScope
  tier: DataTier
  /** The free-allocation benchmark is a DIRECT-emission benchmark (see below). */
  emissionsType: 'direct' | 'indirect'
  cnCode: string
  routeIndicator: string
  importDate: string
  precursors: SefaInput['precursors']
  /**
   * Indirect (electricity) embedded emissions for the line, when the good's sector charges them
   * (cement, fertilisers, hydrogen). Absent or '0' for the direct-only sectors. Kept SEPARATE
   * from emissionsTco2e because the free-allocation benchmark applies to the direct figure
   * alone; summing them first would silently deduct a direct benchmark from electricity.
   */
  indirectTco2e?: string
  /**
   * Where the DEFAULT that produced these emissions came from:
   *  - 'country'  — the origin's own published values
   *  - 'residual' — the Commission's "Other Countries and Territories" sheet, i.e. a
   *                 world-average bucket, because the origin has no published value for this good
   *  - null       — not a default-derived figure (verified actual)
   * A residual-derived number LOOKS exactly like a country-specific one; if we do not say which,
   * we let a user believe the Commission priced their country's good when it did not.
   */
  originBasis: 'country' | 'residual' | null
  /** Provenance, carried through to the stamp. */
  snapshotHash: string
  linePackage: string
  customsLineId: string
}

export interface EstimateFigure {
  faaTco2e: string
  netTco2e: string
  certificates: string
  costEur: string | null
  /**
   * The indirect (electricity) component carried into the charge, and the full embedded total.
   * Free allocation is a DIRECT-emission benchmark, so indirect emissions receive no deduction
   * and pass through to the charge in full — netTco2e already includes them.
   */
  indirectTco2e: string
  totalEmbeddedTco2e: string
}

export interface ProvenanceStamp {
  tier: DataTier
  /** See CertificateEstimateInput.originBasis. The UI must distinguish 'residual'. */
  originBasis: 'country' | 'residual' | null
  rulePackages: string[]
  sources: string[]
  snapshotHash: string
  /** The figure is never final while any input is provisional. The UI must render this. */
  provisional: boolean
  notes: string[]
}

interface EstimateBase {
  emissionsTco2e: string
  quantityT: string
  customsLineId: string
  stamp: ProvenanceStamp
}

interface Priced {
  terms: SefaTerms
  priceQuarter: string
  priceStatus: 'published' | 'pending'
  priceEur: string | null
}

export type CertificateEstimate =
  | (EstimateBase & Priced & { status: 'ok'; cscf: string; figure: EstimateFigure })
  /**
   * Electricity. Free allocation is nil by Art 2(2) fiat, so the figure IS final even in 2026
   * — the unpublished CSCF cannot change a zero the law sets outright. Distinct from 'ok'
   * because there is no CSCF to report and claiming one would be a false statement.
   */
  | (EstimateBase & Priced & {
      status: 'zero_by_fiat'
      locator: string
      figure: EstimateFigure
    })
  | (EstimateBase & Priced & {
      status: 'cscf_pending'
      cscfYear: number
      /** A labelled what-if at the 2021-25 CSCF. Never the figure. */
      scenario: { assumedCscf: string } & EstimateFigure
    })
  | (EstimateBase & {
      status: 'unavailable'
      /** Which input the regulation does not give us. Shown to the user verbatim. */
      reason: string
      selector: string | null
    })

/** Free allocation is granted against DIRECT (process) emissions. */
const INDIRECT_UNSUPPORTED =
  'This line reports indirect (electricity) emissions. The free-allocation benchmarks are ' +
  'direct-emission benchmarks, so no certificate estimate is shown rather than deducting a ' +
  'benchmark that does not apply to them.'

function figureFrom(
  emissionsTco2e: string,
  quantityT: string,
  sefaPerT: string,
  price: string | null,
  indirectTco2e = '0',
): EstimateFigure {
  const faa = new Decimal(sefaPerT).mul(quantityT)
  // Free allocation can exceed the good's own emissions (a clean producer against a dirtier
  // benchmark). The regulation surrenders certificates, never issues them: the floor is zero.
  // The floor is applied to the DIRECT side alone: a generous direct benchmark must not wipe out
  // indirect emissions it was never granted against.
  const indirect = new Decimal(indirectTco2e)
  const net = Decimal.max(0, new Decimal(emissionsTco2e).minus(faa)).plus(indirect)
  return {
    faaTco2e: faa.toFixed(),
    netTco2e: net.toFixed(),
    indirectTco2e: indirect.toFixed(),
    totalEmbeddedTco2e: new Decimal(emissionsTco2e).plus(indirect).toFixed(),
    // Certificate rounding is not settled in law (see the dossier's open questions), so this
    // reports decimal certificate-equivalents rather than inventing a rounding rule.
    // toFixed() (not toString()) so a tiny residual renders as 0.0000001, never as '1e-7'.
    certificates: net.toFixed(),
    // toFixed(2) so a euro amount keeps both places: '12944.50', never '12944.5'.
    costEur: price === null ? null : net.mul(price).toFixed(2, Decimal.ROUND_HALF_UP),
  }
}

function baseOf(
  input: CertificateEstimateInput,
  tables: FreeAllocationTables,
): EstimateBase {
  return {
    emissionsTco2e: input.emissionsTco2e,
    quantityT: input.quantityT,
    customsLineId: input.customsLineId,
    stamp: {
      tier: input.tier,
      originBasis: input.originBasis,
      rulePackages: [input.linePackage, `${tables.packageId}@${tables.packageVersion}`],
      sources: [...new Set(tables.sources.map(source => source.id))].sort(),
      snapshotHash: input.snapshotHash,
      provisional: true,
      // Unconditional, and set HERE rather than in the priced branch so it survives on every
      // arm — including 'unavailable'. A residual-sourced number is indistinguishable from a
      // country-specific one unless we say so, on the same surface as the number.
      notes: input.originBasis === 'residual' ? [RESIDUAL_BASIS_NOTE] : [],
    },
  }
}

export const RESIDUAL_BASIS_NOTE =
  'The Commission does not publish a default for this good from this country of origin, so ' +
  'this figure uses its "Other Countries and Territories" residual default — a world-average ' +
  'value, not your country\'s own.'

export const NO_BENCHMARK_REASON =
  'The published rules do not give a free-allocation benchmark for this good, production ' +
  'route, year or quarter, so no figure is shown.'
/**
 * Names the BENCHMARK as present deliberately — that is the sentence that stops a reader hunting
 * a table that was never empty, which is the whole defect this constant exists to fix.
 *
 * It does NOT claim the default value is present, though an earlier draft did. A verified line
 * has no default by construction: estimateFromPack's verified branch never consults the corpus,
 * because "a missing published default is not a refusal, it is the ordinary case an importer
 * collects data for". True for every caller today, since none passes `verified` — and false the
 * moment one does. A string in a file whose job is to stop the product overclaiming should not
 * be carrying a clause with an expiry date. The benchmark claim holds on both paths: an attested
 * figure replaces the default, never the benchmark.
 */
export const NO_PRICE_REASON =
  'The Commission has not published the CBAM certificate price for the quarter this import ' +
  'falls in, so no figure is shown. The good and its benchmark are present — only the price ' +
  'is missing, and prices are published quarterly in arrears.'
const AMBIGUOUS_REASON =
  'The published rules give more than one value for this good, so no figure is shown until ' +
  'the conflict is resolved.'

/**
 * Build the 'unavailable' answer for a lookup that failed closed OUTSIDE this module — the
 * caller resolving a precursor's route against the database, for instance. Same shape, same
 * discipline: no number, and the gap is named.
 */
export function unavailableEstimate(
  input: CertificateEstimateInput,
  tables: FreeAllocationTables,
  reason: string,
  selector: string | null,
): CertificateEstimate {
  return { ...baseOf(input, tables), status: 'unavailable', reason, selector }
}

export function estimateCertificates(
  input: CertificateEstimateInput,
  tables: FreeAllocationTables,
): CertificateEstimate {
  const base = baseOf(input, tables)

  if (input.emissionsType === 'indirect') {
    return { ...base, status: 'unavailable', reason: INDIRECT_UNSUPPORTED, selector: null }
  }

  const year = Number(input.importDate.slice(0, 4))
  try {
    const adjustment = sefa({
      cnCode: input.cnCode,
      scope: input.scope,
      routeIndicator: input.routeIndicator,
      year,
      date: input.importDate,
      precursors: input.precursors,
    }, tables)

    const quarter = quarterOf(input.importDate)
    const price = resolveCertificatePrice(tables, quarter)
    const priceEur = price.status === 'published' ? price.priceEur : null

    const notes = [
      ...base.stamp.notes,
      'Art 9 deduction for a carbon price paid in the country of origin is not modelled (the implementing act is still a draft), so this figure is conservative.',
      'Certificate rounding is not settled in law; decimal certificate-equivalents are shown.',
    ]
    if (input.indirectTco2e && !new Decimal(input.indirectTco2e).isZero()) {
      notes.push(
        'Indirect (electricity) emissions are included in the charge and receive NO free ' +
        'allocation: the benchmarks are direct-emission benchmarks.',
      )
    }
    if (price.status === 'pending') {
      notes.push(`The Commission has not published the ${quarter} certificate price, so no cost is shown.`)
    }
    if (adjustment.status === 'cscf_pending') {
      notes.push(`The cross-sectoral correction factor for ${adjustment.year} is unpublished, so no final figure exists for this import.`)
    }

    const priced: Priced = {
      terms: adjustment.terms,
      priceQuarter: quarter,
      priceStatus: price.status,
      priceEur,
    }
    const stamp = { ...base.stamp, notes }

    if (adjustment.status === 'cscf_pending') {
      return {
        ...base,
        stamp,
        ...priced,
        status: 'cscf_pending',
        cscfYear: adjustment.year,
        scenario: {
          assumedCscf: adjustment.scenario.assumedCscf,
          ...figureFrom(
            input.emissionsTco2e, input.quantityT,
            adjustment.scenario.valueTco2ePerT, priceEur, input.indirectTco2e,
          ),
        },
      }
    }
    if (adjustment.status === 'zero_by_fiat') {
      return {
        ...base,
        stamp,
        ...priced,
        status: 'zero_by_fiat',
        locator: adjustment.locator,
        figure: figureFrom(input.emissionsTco2e, input.quantityT, '0', priceEur, input.indirectTco2e),
      }
    }
    return {
      ...base,
      stamp,
      ...priced,
      status: 'ok',
      cscf: adjustment.cscf,
      figure: figureFrom(
        input.emissionsTco2e, input.quantityT, adjustment.valueTco2ePerT, priceEur,
        input.indirectTco2e,
      ),
    }
  } catch (error) {
    // The regulation does not give us an input (no benchmark for this good/route, no factor
    // for this year, no price for this quarter, or two rows where there must be one). That is
    // an answer, not a crash: show no number and name the gap. Anything that is NOT a
    // regulatory lookup failure is a real fault and must keep propagating.
    if (isDomainError(error) &&
        (error.code === 'REGULATION_NOT_FOUND' || error.code === 'REGULATION_AMBIGUOUS')) {
      const selector = typeof error.details.selector === 'string' ? error.details.selector : null
      // WHICH TABLE IS EMPTY IS ALREADY KNOWN — the selector's first segment says so, and this
      // block used to throw that away and name the benchmark for all of them. Six namespaces
      // reach here (benchmark/, sefa/, cbam-factor/, cscf/, quarter/, certificate-price/), and
      // for a 2027 import the answer was "no free-allocation benchmark" beside a selector
      // reading `certificate-price/2027-Q1` — sending the reader to hunt a benchmark that is
      // present. Only the price is split out here, because that is the one a user meets.
      //
      // Measured over the shipped pack through estimateFromPack — every (CN, route) the form
      // offers, one origin each (the origin moves the emissions figure, never which table is
      // consulted), at four dates in each of 2026, 2027 and 2028. Of 17,484 estimates: 7,680
      // refused on certificate-price/, every one of them 2027 or 2028, because the pack prices
      // 2026 quarters only; 5,964 refused on benchmark/, which this wording already named
      // correctly; 3,840 priced. The other four namespaces produced nothing. cbam-factor/ and
      // cscf/ both cover 2026-2028, and a date outside those years has no default factor
      // either, so estimateFromPack refuses with its own default/ before this engine is
      // entered. sefa/ needs precursors, which estimateFromPack never passes. quarter/ needs a
      // month outside 1-12, which <input type="date"> cannot emit — it does fire on a
      // hand-built date, and is mis-named exactly the same way, but no user can reach it.
      return {
        ...base,
        status: 'unavailable',
        reason: error.code === 'REGULATION_AMBIGUOUS'
          ? AMBIGUOUS_REASON
          : selector?.startsWith('certificate-price/') ? NO_PRICE_REASON : NO_BENCHMARK_REASON,
        selector,
      }
    }
    throw error
  }
}
