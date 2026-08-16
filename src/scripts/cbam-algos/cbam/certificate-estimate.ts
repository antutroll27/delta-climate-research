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

/**
 * Which data a figure rests on. A legal claim, not a label: the mark-up exists to price
 * not-having-data, so the tier is the field that says whether it was applied and to what.
 *
 * 'verified-direct+default-indirect' is a line whose importer attested their PROCESS emissions and
 * supplied no electricity figure, so the Commission's published indirect default — mark-up
 * included — stood in for the half they did not attest. Spelled out rather than 'mixed' because
 * the tier lands verbatim in the export an auditor reads, where which half came from where is the
 * whole question. Stamped only when a default actually stood in: a good for which the Commission
 * publishes no indirect default at all (iron & steel, aluminium) prices that component at zero
 * because zero is the published answer, and stays 'actual-verified'.
 */
export type DataTier = 'actual-verified' | 'default+markup' | 'verified-direct+default-indirect'

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
   *  - null       — the figure this field describes rests on no default. Every 'actual-verified'
   *                 line, and also 'verified-direct+default-indirect', whose DIRECT figure is the
   *                 importer's own. That third tier's INDIRECT half does rest on a default, and
   *                 that default can come from the residual bucket, so such a line carries no
   *                 residual note today and the tier is the only thing disclosing the
   *                 substitution. Narrower disclosure than the note gives, and named here rather
   *                 than left to be discovered.
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
  'route or year, so no figure is shown.'
/**
 * Names the BENCHMARK as present deliberately — that is the sentence that stops a reader hunting
 * a table that was never empty, which is the whole defect this constant exists to fix.
 *
 * It does NOT claim the default value is present, though an earlier draft did. A verified line's
 * DIRECT figure has no default behind it by construction: estimateFromPack's verified branch
 * never consults the corpus for it, because "a missing published default is not a refusal, it is
 * the ordinary case an importer collects data for". (Its INDIRECT half does consult the corpus,
 * when the importer attested process emissions alone — see DataTier's third tier — so the claim
 * would not even be uniformly false, which is worse.) A string in a file whose job is to stop the
 * product overclaiming should not be carrying a clause with an expiry date. The benchmark claim
 * holds on both paths: an attested figure replaces a default, never the benchmark.
 */
export const NO_PRICE_REASON =
  'The Commission has not published the CBAM certificate price for the quarter this import ' +
  'falls in, so no figure is shown. The good and its benchmark are present — only the price ' +
  'is missing, and prices are published quarterly in arrears.'

/**
 * Blames the SNAPSHOT, not the regulation — the distinction is the whole point.
 *
 * `benchmarkScopeOf` fails closed only for a verified-actual snapshot carrying no
 * `intensityScope`. Migration 0007 added `operator_report_good.intensity_scope` as NOT NULL
 * DEFAULT 'all_in', and the engine's basis type requires the field, so every snapshot frozen
 * since then has one of the two values: a snapshot that predates 0007 is the only thing that
 * reaches this. The published rules are not missing anything here, and saying they were would
 * send a reader to the corpus for a gap that is in our own stored data.
 *
 * The remedy is named for the same reason NO_PRICE_REASON names the publication cadence: this
 * is a SaaS surface whose user can act on it, and recalculating the case re-reads the scope
 * from the source good (immutable, so it cannot drift) and repopulates the basis.
 */
export const NO_SNAPSHOT_SCOPE_REASON =
  'This case\'s frozen snapshot predates the intensity-scope field, so it does not record ' +
  'whether its emissions figure covers the whole product or this installation\'s process ' +
  'alone, and no figure is shown. The two are priced against different benchmark columns, so ' +
  'guessing the scope would deduct a benchmark the importer never declared. Recalculating ' +
  'the case repopulates the scope.'

/**
 * Names the ROUTE as the gap, and OVER-charging as the harm. Both corrections matter.
 *
 * A combined-method precursor always carries a `defaultFactorVersionId` by construction, so
 * its default value is present — it is what produced the emissions figure in the first place.
 * What fails is resolving that id and the precursor's `cnCodeVersionId` back to a CN code and
 * a production route inside the case's pinned rule package, which is exactly what the selector
 * (`precursor/<cnCodeVersionId>/<defaultFactorVersionId>`) reports.
 *
 * And the harm runs the other way from the obvious guess. Precursors never touch the emissions
 * figure at this site — that is read from the frozen snapshot and never recomputed. They enter
 * only the SEFA deduction (Eq 4), each at its own Column B benchmark, which the route selects.
 * Dropping one therefore shrinks the deduction and RAISES the bill; sefa() refuses for the same
 * reason, because "a smaller deduction is a bigger bill charged to the importer on our
 * authority". Claiming this understates emissions would invert the direction of the harm.
 */
export const NO_PRECURSOR_REASON =
  'One of this good\'s precursors cannot be resolved back to its own CN code and production ' +
  'route in the rule package this case was calculated against, so no figure is shown. The ' +
  'route selects the precursor\'s benchmark, so carrying on without it would drop that ' +
  'precursor\'s free allocation and overcharge the importer.'

/**
 * Blames the DATE, not a table — nothing here is empty.
 *
 * `quarterOf` refuses a year that is not four digits or a month outside 1-12, so what reaches
 * this constant is an unreadable import date. Reported as a missing benchmark it sent the reader
 * to hunt an Annex row that had resolved perfectly a moment earlier.
 *
 * Scoped to the PRICE deliberately. An earlier draft added "the benchmark in force depends on
 * it", which is false: `quarterOf` has exactly one caller (the price lookup below), while
 * `resolveBenchmark` matches on active(validFrom, validTo, date) — the day, not the quarter. The
 * quarter is the price's key and nothing else's, and the price table is keyed by quarter
 * ('2026-Q1'), one row per quarter.
 *
 * No remedy is named, unlike NO_PRICE_REASON and NO_SNAPSHOT_SCOPE_REASON. <input type="date">
 * cannot emit month 13, so whoever reads this did not type the date — a caller passed it — and
 * telling them to correct what they entered would address the wrong person.
 */
export const BAD_DATE_REASON =
  'The import date is not a readable calendar date, so the quarter it falls in cannot be ' +
  'determined and no figure is shown. The CBAM certificate price is published per quarter, ' +
  'so without a readable date there is no price to apply.'

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
      // present. Two are split out here: the price, which is the one a user meets, and the
      // quarter, whose gap is not a table at all but the import date itself.
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
      // month outside 1-12, which <input type="date"> cannot emit, so no user meets it — but a
      // hand-built date does, and it is not rare there: over 576 (CN, route) pairs, one origin
      // each, at six out-of-range-month dates, 2,401 of 3,456 estimates refused on quarter/ and
      // the other 1,055 refused on benchmark/ before quarterOf was ever reached. Every one of
      // the 2,401 was named as a missing benchmark until BAD_DATE_REASON below.
      return {
        ...base,
        status: 'unavailable',
        reason: error.code === 'REGULATION_AMBIGUOUS'
          ? AMBIGUOUS_REASON
          : selector?.startsWith('certificate-price/') ? NO_PRICE_REASON
          : selector?.startsWith('quarter/') ? BAD_DATE_REASON
          : NO_BENCHMARK_REASON,
        selector,
      }
    }
    throw error
  }
}
