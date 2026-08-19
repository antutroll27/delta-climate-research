import Decimal from 'decimal.js'
import { isDomainError } from '../errors/domain-error'
import { parseNonNegativeDecimal, parseRegulatoryDate } from './input'
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
   *                 that default can come from the residual bucket — reported by
   *                 `residualIndirectDefault` below, NOT by this field. Setting 'residual' here
   *                 would claim the audited direct figure rests on a world average, and would
   *                 fire a note that says exactly that.
   * A residual-derived number LOOKS exactly like a country-specific one; if we do not say which,
   * we let a user believe the Commission priced their country's good when it did not.
   */
  originBasis: 'country' | 'residual' | null
  /**
   * True only where a substituted INDIRECT (electricity) default was drawn from the residual
   * bucket — i.e. on a 'verified-direct+default-indirect' line whose importer left electricity
   * unattested and whose origin the Commission does not list.
   *
   * A second field rather than a second value of `originBasis`, because a mixed line has TWO
   * bases and that field names one. It fires MIXED_RESIDUAL_INDIRECT_NOTE — scoped to the
   * electricity half, saying the direct half is unaffected — on a line that was PRICED. A refused
   * line gets no note however this field is set, because the sentence describes a figure that
   * line does not have.
   *
   * Absent on the defaults path, whose whole figure rests on one basis and which discloses it
   * through `originBasis` exactly as before. The two can therefore never both be set today.
   */
  residualIndirectDefault?: boolean
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

export type EstimateFailureCode =
  | 'BAD_MASS'
  | 'BAD_DATE'
  | 'INVALID_PACK'
  | 'NO_DIRECT_DEFAULT'
  | 'NO_INDIRECT_ROUTE'
  | 'NO_BENCHMARK'
  | 'NO_CERTIFICATE_PRICE'
  | 'NO_CBAM_FACTOR'
  | 'NO_CSCF'
  | 'AMBIGUOUS_REGULATION'

export interface EstimateFailure {
  code: EstimateFailureCode
  selector: string | null
  message: string
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
   * Electricity. Free allocation is nil by Art 1(2) fiat, so the figure IS final even in 2026
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
      failure: EstimateFailure
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
      // EMPTY ON EVERY ARM, and that is the point: this function runs for refusals too, so a note
      // attached here is printed over a card that may carry no figure at all. Both residual
      // disclosures are claims ABOUT A FIGURE — RESIDUAL_BASIS_NOTE says "this figure uses its
      // residual default", MIXED_RESIDUAL_INDIRECT_NOTE describes where an indirect figure came
      // from — so both are attached in the priced branch below, the only region that produces one.
      // Nothing replaces RESIDUAL_BASIS_NOTE on a refusal: it sits on the DEFAULTS path, where the
      // importer attested nothing, so there is no true input-claim left to make. (The renderer's
      // ATTESTED_NOTE survives the same refusal for exactly that reason — it describes an input.)
      //
      // The basis still travels on every arm, one field up: `originBasis` names the ATTEMPT rather
      // than an output, so it stays true on a refusal and the UI can still say which sheet was
      // being read. Dropping the sentence drops no fact the stamp does not still carry.
      //
      // Gating in the priced branch rather than filtering at the sink also covers refusals raised
      // OUTSIDE this module: `unavailableEstimate` builds its stamp here and returns without ever
      // entering that branch, so no caller can reintroduce the note by passing
      // originBasis: 'residual' — and two of them can. estimate-from-pack's `indirect/` arm raises
      // its refusal AFTER a non-null residual direct factor has been selected, and the API service
      // reads the basis from the frozen snapshot, so neither is covered by the "`factor` is null
      // there" argument an earlier draft of this comment gave for all outside refusals. The first
      // is unreachable on today's browser pack: of the residual bucket's 780 direct rows, 672 have
      // no indirect coverage at all (so nothing can mismatch) and the remaining 108 each find
      // their own route in that coverage, leaving the route-mismatch arm 0 hits over its entire
      // 17,028-estimate space. The gate does not rest on that holding.
      notes: [],
    },
  }
}

export const RESIDUAL_BASIS_NOTE =
  'The Commission does not publish a default for this good from this country of origin, so ' +
  'this figure uses its "Other Countries and Territories" residual default — a world-average ' +
  'value, not your country\'s own.'

/**
 * The residual disclosure for a MIXED line, where RESIDUAL_BASIS_NOTE would be a false statement.
 *
 * That note says "this figure" rests on the world-average bucket. On a
 * 'verified-direct+default-indirect' line only the electricity half does; the direct half is the
 * importer's own attested number, which the verified path never derives from a default (see
 * estimateFromPack — the corpus is not consulted for it at all, so no residual value can reach
 * it, and free allocation is keyed on CN, route and date rather than origin). Firing the other
 * note here would tell an importer their audited figure is a world average.
 *
 * Deliberately says the same two things about the BUCKET in the same words as its neighbour — it
 * is the same bucket — while scoping the claim to electricity and naming what is untouched.
 */
export const MIXED_RESIDUAL_INDIRECT_NOTE =
  'The electricity default substituted on this line is the Commission\'s "Other Countries and ' +
  'Territories" residual — a world-average value, not your country\'s own. Your direct figure ' +
  'is unaffected: it is your own attested claim.'

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

/**
 * Names the PHASE-OUT SCHEDULE as the gap, and UNDER-charging as the harm.
 *
 * `resolveCbamFactor` misses only when the year has no row, and the rows are the Art 10a(1a)
 * schedule of how much free allocation each year still retains: 0.975 in 2026 falling to 0 in
 * 2034, and then nothing, because "beyond 2034 the schedule simply ends. We do not extrapolate a
 * tail." Nothing here is a benchmark — this lookup runs BEFORE any benchmark is resolved — so
 * reporting it as a missing benchmark sent a reader to hunt a table that had not been read yet.
 *
 * The harm direction is checked against the numbers rather than guessed. The factor enters as a
 * multiplier on the deduction (`weighted.mul(cbam.factor)` in sefa), so carrying on without it is
 * arithmetically identical to a factor of 1 — and 1 exceeds every value the schedule ever takes,
 * the largest being 2026's 0.975. Guessing therefore deducts more free allocation than any
 * scheduled year grants, which shrinks the bill rather than inflating it.
 */
export const NO_CBAM_FACTOR_REASON =
  'The free-allocation factor schedule does not reach the year this import falls in, so no ' +
  'figure is shown. That factor is the share of the benchmark deduction a year still grants, ' +
  'and it runs down to a final year and stops rather than levelling off, so carrying on ' +
  'without it would apply the deduction at full strength — more free allocation than any ' +
  'scheduled year grants — and undercharge the importer.'

/**
 * Names the CROSS-SECTORAL CORRECTION as the gap, and separates it from the state it is most
 * likely to be confused with.
 *
 * "The Commission has not published the CSCF for this year" is NOT this refusal. That is the
 * `pending` resolution, and it does not refuse at all — it returns 'cscf_pending', a labelled
 * what-if at the 2021-25 factor with no final figure. Writing the unpublished case into this
 * sentence would have described a different answer entirely, on the one surface where the two
 * must not blur.
 *
 * What DOES reach here is a year the tables do not model at all (`cscf/<year>`) and a row
 * claiming 'published' while carrying no value (`cscf/<year>/published-no-value`). Both prefixes
 * are caught by the one arm, so the wording says no USABLE factor rather than none published.
 *
 * Same harm direction as its neighbour above, by the same arithmetic — the CSCF is the other
 * multiplier on the deduction — and here the tempting guess has a name: it was 1.0 for 2021-25.
 * That is exactly why CscfResolution's `pending` arm carries no `value` field, so the compiler
 * rather than a convention stops us assuming it, and why resolveCscf's own rule is that "silence
 * is never 1.0".
 */
export const NO_CSCF_REASON =
  'The rules this case was calculated against hold no usable cross-sectoral correction factor ' +
  'for the year this import falls in, so no figure is shown. A year the Commission has not ' +
  'corrected yet is a different answer and is reported as one, a labelled what-if with no ' +
  'final figure, so an absent factor must not be read as the 1.0 that applied to 2021-25: ' +
  'that would deduct free allocation uncorrected and undercharge the importer.'

const AMBIGUOUS_REASON =
  'The published rules give more than one value for this good, so no figure is shown until ' +
  'the conflict is resolved.'

const FAILURE_MESSAGES: Record<EstimateFailureCode, string> = {
  BAD_MASS: 'Enter a finite, non-negative mass before requesting an estimate.',
  BAD_DATE: BAD_DATE_REASON,
  INVALID_PACK: 'The regulatory pack contains an invalid numeric input, so no estimate is shown.',
  NO_DIRECT_DEFAULT: 'No applicable direct default value is published for this selector.',
  NO_INDIRECT_ROUTE: 'No indirect default value is published for this production route.',
  NO_BENCHMARK: NO_BENCHMARK_REASON,
  NO_CERTIFICATE_PRICE: NO_PRICE_REASON,
  NO_CBAM_FACTOR: NO_CBAM_FACTOR_REASON,
  NO_CSCF: NO_CSCF_REASON,
  AMBIGUOUS_REGULATION: AMBIGUOUS_REASON,
}

export function failureMessage(code: EstimateFailureCode): string {
  return FAILURE_MESSAGES[code]
}

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
  code: EstimateFailureCode = failureCodeForSelector(selector),
): CertificateEstimate {
  return {
    ...baseOf(input, tables),
    status: 'unavailable',
    failure: { code, selector, message: reason || failureMessage(code) },
    reason: reason || failureMessage(code),
    selector,
  }
}

function failureCodeForSelector(selector: string | null): EstimateFailureCode {
  if (selector?.startsWith('mass/')) return 'BAD_MASS'
  if (selector?.startsWith('date/') || selector?.startsWith('quarter/')) return 'BAD_DATE'
  if (selector?.startsWith('default/')) return 'NO_DIRECT_DEFAULT'
  if (selector?.startsWith('indirect/')) return 'NO_INDIRECT_ROUTE'
  if (selector?.startsWith('benchmark/')) return 'NO_BENCHMARK'
  if (selector?.startsWith('certificate-price/')) return 'NO_CERTIFICATE_PRICE'
  if (selector?.startsWith('cbam-factor/')) return 'NO_CBAM_FACTOR'
  if (selector?.startsWith('cscf/')) return 'NO_CSCF'
  return 'NO_BENCHMARK'
}

export function estimateCertificates(
  input: CertificateEstimateInput,
  tables: FreeAllocationTables,
): CertificateEstimate {
  const base = baseOf(input, tables)

  const quantity = parseNonNegativeDecimal(input.quantityT)
  if (!quantity.ok) {
    return unavailableEstimate(
      input, tables, failureMessage('BAD_MASS'), `mass/${input.customsLineId}`, 'BAD_MASS',
    )
  }
  const emissions = parseNonNegativeDecimal(input.emissionsTco2e)
  const indirect = parseNonNegativeDecimal(input.indirectTco2e ?? '0')
  if (!emissions.ok || !indirect.ok) {
    return unavailableEstimate(
      input, tables, failureMessage('INVALID_PACK'), `emissions/${input.customsLineId}`, 'INVALID_PACK',
    )
  }
  const importDate = parseRegulatoryDate(input.importDate)
  if (!importDate.ok) {
    return unavailableEstimate(
      input, tables, failureMessage('BAD_DATE'), `date/${input.importDate}`, 'BAD_DATE',
    )
  }

  const safeInput: CertificateEstimateInput = {
    ...input,
    quantityT: quantity.value.toString(),
    emissionsTco2e: emissions.value.toString(),
    indirectTco2e: indirect.value.toString(),
    importDate: importDate.day,
  }

  if (safeInput.emissionsType === 'indirect') {
    return unavailableEstimate(safeInput, tables, INDIRECT_UNSUPPORTED, null, 'NO_BENCHMARK')
  }

  const year = importDate.year
  try {
    const adjustment = sefa({
      cnCode: safeInput.cnCode,
      scope: safeInput.scope,
      routeIndicator: safeInput.routeIndicator,
      year,
      date: safeInput.importDate,
      precursors: safeInput.precursors,
    }, tables)

    const quarter = quarterOf(safeInput.importDate)
    const price = resolveCertificatePrice(tables, quarter)
    const priceEur = price.status === 'published' ? price.priceEur : null

    const notes = [
      // Always empty today — baseOf attaches nothing on any arm — and kept so that anything ever
      // added there still leads, which is the order the two gates below are positioned against.
      ...base.stamp.notes,
      // HERE, NOT IN baseOf, for the same reason as its neighbour below, and FIRST for the same
      // reason: this is where `...base.stamp.notes` used to splice it in, so a priced line's notes
      // stay byte-identical in order and content to what they were when baseOf attached it.
      //
      // "…so THIS FIGURE uses its 'Other Countries and Territories' residual default" is a claim
      // about an OUTPUT. baseOf runs on every arm, so a refused defaults-path line from an origin
      // the Commission does not list printed that sentence over a card showing no figure — and as
      // its SOLE note, the two standing disclosures further down being priced-only already.
      // Reproduced on MO (Macao, unlisted) clinker 25231000 route (B) at 2027-03-15, which refuses
      // on certificate-price/2027-Q1 because the pack prices 2026 quarters only. Swept over the
      // shipped pack — every (CN, route) pair it prices, two residual origins against two listed
      // controls, three dates, both emission scopes, all three of the defaults, mixed and verified
      // paths — 704 of 44,136 estimates carried it into a refusal (668 on certificate-price/, 36
      // on benchmark/), and moving it here is the whole of what those 704 lose.
      //
      // Unlike the mixed case there is no replacement to make. That line's ATTESTED_NOTE survives
      // a refusal because it describes what the importer TYPED; on the defaults path the importer
      // typed nothing, so the residual sentence is the only claim available and it is a claim
      // about the missing number.
      ...(input.originBasis === 'residual' ? [RESIDUAL_BASIS_NOTE] : []),
      // HERE, NOT IN baseOf, and the position inside this array is chosen so that a priced line's
      // notes are byte-identical to what they were when it was attached there.
      //
      // The note is a claim about the OUTPUT — "the electricity default substituted on this line
      // IS the residual" describes the provenance of the indirect figure. Everything after this
      // point produces a figure; the catch below produces none. The substitution genuinely did
      // happen on a refused line (the indirect figure is computed before the price lookup fails),
      // so "was substituted" is literally accurate — but the card shows no figure, so a sentence
      // about that figure's provenance has no referent, and reads as a disclosure about a number
      // the reader is left hunting for.
      //
      // The tier survives such a refusal (it is decided before estimateCertificates is entered),
      // which is exactly why this was reachable: FJ/FR cement at a 2027 date substitutes the
      // residual electricity default, stamps the mixed tier, then refuses on certificate-price/.
      //
      // ATTESTED_NOTE, over in the renderer, correctly survives the same refusal because it
      // describes the INPUT the importer typed — true whether or not anything could be priced.
      // That is the line between the two, not squeamishness about saying too much.
      ...(input.residualIndirectDefault ? [MIXED_RESIDUAL_INDIRECT_NOTE] : []),
      'Art 9 deduction for a carbon price paid in the country of origin is not modelled (the implementing act is still a draft), so this figure is conservative.',
      'Certificate rounding is not settled in law; decimal certificate-equivalents are shown.',
    ]
    if (safeInput.indirectTco2e && !new Decimal(safeInput.indirectTco2e).isZero()) {
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
            safeInput.emissionsTco2e, safeInput.quantityT,
            adjustment.scenario.valueTco2ePerT, priceEur, safeInput.indirectTco2e,
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
        figure: figureFrom(safeInput.emissionsTco2e, safeInput.quantityT, '0', priceEur, safeInput.indirectTco2e),
      }
    }
    return {
      ...base,
      stamp,
      ...priced,
      status: 'ok',
      cscf: adjustment.cscf,
      figure: figureFrom(
        safeInput.emissionsTco2e, safeInput.quantityT, adjustment.valueTco2ePerT, priceEur,
        safeInput.indirectTco2e,
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
      // present. Four are split out; the dispatch now lives in failureCodeForSelector, and
      // FAILURE_MESSAGES maps each code back to the wording below.
      //
      // ONLY benchmark/ AND sefa/ FALL THROUGH to NO_BENCHMARK, and they are not the same case.
      // benchmark/ is what the fallback was written for. sefa/ is not: its single selector
      // (`sefa/<cn>/full-product-scope-with-precursors`) fires when a caller passes precursors
      // alongside a full-product scope, where Column B already covers them and adding them would
      // double-count the deduction — the benchmark resolved perfectly, so "the rules do not give
      // a benchmark" is the wrong sentence for it, not a defensible one. It is left on the
      // fallback anyway because NO PRODUCTION CALLER CAN REACH IT: estimateCertificates has three
      // call sites, estimate-from-pack passes `precursors: []` at both of its, and the API
      // service loads precursors only when the scope is 'process_only'. Splitting it would add a
      // string nothing can print. Whoever makes it reachable owes it its own reason.
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
      // the 2,401 was named as a missing benchmark until BAD_DATE_REASON.
      //
      // Every arm of failureCodeForSelector tests a DISTINCT prefix, so its order carries no
      // meaning and no arm can shadow another. Keep it that way: an exact-match arm added above
      // a prefix arm that subsumes it would make the lower one unreachable without failing a test.
      const code = error.code === 'REGULATION_AMBIGUOUS'
        ? 'AMBIGUOUS_REGULATION'
        : failureCodeForSelector(selector)
      return unavailableEstimate(safeInput, tables, failureMessage(code), selector, code)
    }
    throw error
  }
}
