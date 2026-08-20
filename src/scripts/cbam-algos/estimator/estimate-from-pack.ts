import Decimal from 'decimal.js'
import { DomainError } from '../errors/domain-error'
import { isAssignedAlpha2, OTHER_ORIGIN } from '../regulatory/iso-3166'
import { sectorForCn } from '../cbam/sector'
import { parseNonNegativeDecimal, parseRegulatoryDate } from '../cbam/input'
import { evaluateThreshold, type ThresholdState } from '../threshold/evaluate'
import {
  BAD_DATE_REASON,
  estimateCertificates,
  failureMessage,
  unavailableEstimate,
  type CertificateEstimate,
  type CertificateEstimateInput,
  type DataTier,
} from '../cbam/certificate-estimate'
import type { FreeAllocationTables } from '../cbam/types'
import {
  prepareEstimatorPack,
  valueIndexKey,
  type DefaultValueRecord,
  type EstimatorPackV2,
  type PreparedEstimatorPack,
} from './pack-v2'

/**
 * The estimator prototype's compute path: a default-values estimate, in the browser, over the
 * shipped pack, through the SAME engine prod runs (`estimateCertificates`). "Prototype" is about
 * where it runs, not the maths — identical engine, identical published values, same fail-closed
 * behaviour. Defaults path, plus attested verified figures (both scope full_product → Column B);
 * Column A / process-level data stays the workspace's job.
 *
 * The pack is the browser-shipped schemaVersion-2 shape (see pack-v2.ts and
 * scripts/build-dv-package-v3.py): validated on load, indexed once, and carrying each Annex cell's
 * STATE rather than only its value — a published figure, an unpublished dash/blank/N-A, or a
 * see-below pointer. That distinction is the whole reason for v2: v1 could only ship cells that
 * held numbers, so a listed origin's silence and a listed origin's zero were the same absence.
 */
export type EstimatorPack = EstimatorPackV2

/** A record whose Annex cell actually holds a figure — the only kind that may price anything. */
type ValueRecord = DefaultValueRecord & {
  cell: Extract<DefaultValueRecord['cell'], { state: 'value' }>
}

export interface EstimatorInput {
  cn: string
  country: string
  route: string
  massT: string
  date: string
  emissionsScope?: 'direct' | 'direct_and_indirect'
  /** Exact response-byte hash supplied by the validated browser loader. */
  packSha256?: string
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

/**
 * Three outcomes, not two, and the distinction is load-bearing.
 *
 * `none` means the Commission publishes no default for THIS GOOD at all, which must keep pricing
 * with indirect 0. It is a per-good fact and not a per-sector one — measured on the shipped pack,
 * the sectors with no published indirect value anywhere are aluminium (0 rows across its 24 goods)
 * and hydrogen (0 across its 1). Iron & steel is NOT one of them, though this comment said so for
 * a while: 26011200, agglomerated iron ore, carries 84 published indirect values over 28 origin
 * sheets and prices live (IN 5.5, CN 6.6, DZ 3.3 tCO2e on a 100 t line). It is one good in 221, so
 * `none` is still the answer almost everywhere in that sector — but reading a sector off it is how
 * the claim went wrong, and asking per good is what the type is for. `route-mismatch` means rows
 * DO exist for this good, origin and year but none is published for the route the importer
 * declared. Those are different facts and they need different answers: the first is
 * silence, the second is a refusal. Collapsing them into `null` is exactly how the over-charge
 * this replaces stayed invisible — the lookup could not tell "nothing published" from "I picked
 * the wrong row".
 *
 * `availableRoutes` says WHICH routes the corpus does price, so a caller can name the choice
 * rather than only the refusal. It is populated from cells in the `value` state only: an
 * unpublished cell is not an alternative a user could pick.
 */
export type IndirectLookup =
  | { kind: 'found'; factor: ValueRecord }
  | { kind: 'none' }
  | { kind: 'route-mismatch'; availableRoutes: string[] }

/** The default-values corpus spells a route-independent good as 'default'; the Annex uses ''. */
function benchmarkRoute(productionRoute: string): string {
  return productionRoute === 'default' ? '' : productionRoute
}

function faTablesOf(pack: EstimatorPack): FreeAllocationTables {
  const fa = pack.generatedFrom.find(source => source.id.includes('free-allocation'))
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
  return `${pack.identity.id}@${pack.identity.version}`
}

/**
 * Which origins' rows may answer for a declared origin, in priority order.
 *
 * Mirrors `resolveDefaultFactor` in lib/regulatory: the declared country's own rows always win;
 * the Commission's residual bucket ('OTHER') answers for a REAL alpha-2 code the country's own
 * sheet does not price; a junk origin gets nothing and the caller fails closed. The workspace and
 * this prototype must never disagree about which rules apply.
 *
 * v2 CHANGED WHAT "the sheet is silent" MEANS, and this is the one place it shows. Under v1 a
 * listed origin never fell through, because the pack could only carry cells that held numbers, so
 * an absent row and an N/A row were indistinguishable and fail-closed was the only safe reading.
 * v2 carries the cell STATE, so the two are now separate facts: a numeric value (INCLUDING a
 * literal zero) is the origin's own answer and stops the search, while an unpublished dash/blank/
 * N-A or a see-below pointer falls through to the residual row, which is what the corrected Annex
 * directs. An ABSENT row keeps v1's reading and still fails closed — this order says WHICH sheets
 * may answer, and `lookupValue` says when the second one is allowed to.
 * `publishedOriginSheets` — not "has any row" — is what makes a country listed.
 */
function originOrder(pack: EstimatorPack, country: string): string[] {
  if (country === OTHER_ORIGIN) return [OTHER_ORIGIN] // the explicit "not individually listed" choice
  if (!isAssignedAlpha2(country)) return []
  return pack.publishedOriginSheets.includes(country) ? [country, OTHER_ORIGIN] : [OTHER_ORIGIN]
}

/**
 * Does the pack OFFER this CN as a good? Mirrors the server's classification gate
 * (resolveClassification in lib/regulatory/resolve.ts, which every server resolution runs
 * before touching a factor): an exact listing wins, else the longest shorter listing that
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
  if (pack.classifications.some(row => row.code === cn)) return true
  return pack.classifications.some(row => row.code.length < cn.length && cn.startsWith(row.code))
}

/**
 * The rows whose scope covers this CN, deepest published scope only — the server's rule (the
 * candidates filter inside resolveDefaultFactor, lib/regulatory/resolve.ts — cited by FUNCTION,
 * not by line, because this reference has already rotted twice): a CN is covered by its own code
 * or any prefix the Commission published at, and the most specific scope governs.
 *
 * The pack estimator used to require scopeCode === cn. That agreed with the server only while the
 * pack offered goods at exactly its rows' granularity; the moment classifications moved to TARIC
 * (10-digit) granularity over heading-level rows, exact matching would report "no published
 * default" for goods the Commission does publish.
 */
function rowsAt(
  prepared: PreparedEstimatorPack,
  emissionsType: 'direct' | 'indirect',
  origin: string,
  year: number,
  route: string,
  cn: string,
): DefaultValueRecord[] {
  const index = emissionsType === 'direct'
    ? prepared.directBySelector
    : prepared.indirectBySelector
  const covering = (index.get(valueIndexKey(origin, year, route)) ?? [])
    .filter(row => cn.startsWith(row.scopeCode))
  const deepest = Math.max(...covering.map(row => row.codeLevel), -1)
  return covering.filter(row => row.codeLevel === deepest)
}

/**
 * The figure a candidate row set holds, or null when it holds none.
 *
 * Split out of `valueAt` because a caller sometimes has to ask the rows a SECOND question, and
 * null cannot answer it: an unpublished dash and an absent row both produce null, and those are
 * different regulatory facts (see `lookupValue`). Handing the same array to both questions is
 * what stops the two answers drifting apart.
 */
function valueOf(rows: DefaultValueRecord[], selector: string): ValueRecord | null {
  if (rows.length > 1) {
    // This file's own rule: a tie is REGULATION_AMBIGUOUS, never a first-match.
    throw new DomainError('REGULATION_AMBIGUOUS', { selector })
  }
  const row = rows[0]
  return row?.cell.state === 'value' ? row as ValueRecord : null
}

function valueAt(
  prepared: PreparedEstimatorPack,
  emissionsType: 'direct' | 'indirect',
  origin: string,
  year: number,
  route: string,
  cn: string,
): ValueRecord | null {
  return valueOf(
    rowsAt(prepared, emissionsType, origin, year, route, cn),
    `${emissionsType}/${cn}/${origin}/${route}/${year}`,
  )
}

function availableRoutesAt(
  prepared: PreparedEstimatorPack,
  emissionsType: 'direct' | 'indirect',
  cn: string,
  origin: string,
  year: number,
): string[] {
  const index = emissionsType === 'direct'
    ? prepared.directBySelector
    : prepared.indirectBySelector
  // The empty route yields the key's stable prefix — built through valueIndexKey rather than
  // re-spelling its separator here, because two spellings of one key format is how an index and
  // its reader come to disagree silently.
  const prefix = valueIndexKey(origin, year, '')
  const routes = [...index.keys()]
    .filter(key => key.startsWith(prefix))
    .map(key => key.slice(prefix.length))
  return [...new Set(routes)]
    .filter(route => valueAt(prepared, emissionsType, origin, year, route, cn) !== null)
    .sort()
}

/**
 * The published default for this selector, or why there is none.
 *
 * THE ROUTE IS PART OF THE MATCH. An earlier version left it out of the INDIRECT lookup, on the
 * stated grounds that "indirect rows are published per good, not per production route". The
 * shipped corpus disagrees, and without the route `.find()` returned whichever row sorted first —
 * the dearer one, in every affected case — so a route-(A) line was priced with route (B)'s
 * electricity and over-charged, with the downstream line-export CSV (its `benchmark_route`
 * column) naming route (A) beside route (B)'s figure: an audit artefact naming one route and
 * pricing another. Matching strictly also makes the lookup deterministic, so the candidate set
 * can never hold more than one row and the ambiguity rule stops being violated rather than
 * narrowed.
 */
function lookupValue(
  pack: EstimatorPack,
  emissionsType: 'direct' | 'indirect',
  input: Pick<EstimatorInput, 'cn' | 'country' | 'route'>,
  year: number,
): IndirectLookup {
  if (!isOfferedGood(pack, input.cn)) return { kind: 'none' }
  const prepared = prepareEstimatorPack(pack)
  const origins = originOrder(pack, input.country)
  for (const origin of origins) {
    const rows = rowsAt(prepared, emissionsType, origin, year, input.route, input.cn)
    const found = valueOf(rows, `${emissionsType}/${input.cn}/${origin}/${input.route}/${year}`)
    if (found) return { kind: 'found', factor: found }
    // TWO SILENCES, AND ONLY ONE OF THEM FALLS THROUGH.
    //
    // An unpublished dash/blank/N-A or a see-below pointer is a cell the Commission LOOKED AT and
    // declined to fill; the corrected Annex directs those to the residual row, so the loop
    // continues. A literal zero is a value and was returned above, so it stops the search — that
    // is the Mali hydrogen trap, and it stays shut.
    //
    // NO ROW AT ALL is the other silence: this origin's sheet does not carry the good on this
    // selector, and the residual sheet may not answer for it. The residual row prices ORIGINS the
    // Commission does not list; it does not backfill GOODS a listed origin's sheet omits (the
    // rule this file shares with resolveDefaultFactor in lib/regulatory/resolve.ts, whose
    // `mayUseResidual = !originIsListed && ...` says the same thing on the server). Fail closed.
    //
    // Failing closed is a BREAK, not a return: it stops the residual sheet answering, and leaves
    // WHICH refusal to the same code every other refusal goes through. Returning early here
    // instead would have had to re-derive `availableRoutes` from this origin alone, which
    // re-decides a second question — 'route-mismatch' vs 'none' — while fixing the first, and
    // measurably moved 84 indirect selectors from refusing to pricing electricity at zero.
    //
    // The OTHER_ORIGIN clause is stated but not load-bearing TODAY, written down so a reader does
    // not go hunting for behaviour it protects: `originOrder` always puts the residual sheet last,
    // so breaking on it and running out of origins are the same thing, and dropping the clause
    // leaves the whole suite green (measured — an equivalent mutant, not a coverage gap). It says
    // the rule the loop obeys — the residual sheet is a sheet to fall through TO, never one to
    // fail closed on — so a future reordering cannot make the sentinel refuse itself.
    if (rows.length === 0 && origin !== OTHER_ORIGIN) break
  }

  const availableRoutes = [...new Set(origins.flatMap(origin =>
    availableRoutesAt(prepared, emissionsType, input.cn, origin, year),
  ))].sort()
  // Rows exist for this good but not for this route. Returning `none` here would price the whole
  // electricity component at zero with no signal — an under-charge, and a silent fail-open on a
  // page whose governing rule is fail-closed. Refuse instead.
  return availableRoutes.length > 0
    ? { kind: 'route-mismatch', availableRoutes }
    : { kind: 'none' }
}

/**
 * The production routes the form may offer for a good in a year — the ONLY routes it may offer.
 *
 * ONE INVARIANT, on two axes, and an offered route satisfies both: the corpus must NAME the route
 * for this good (a benchmark row whose scope covers the CN, or a default-value row that does), and
 * the corpus must be able to RESOLVE a Column-B benchmark for it. Naming without resolution is a
 * dead end — a route that can only ever refuse — and this function does not offer dead ends.
 *
 * Both axes are decided by the corpus, which is why no gate, expert mode or policy lives here.
 */
export function routesFor(
  pack: EstimatorPack,
  cn: string,
  country: string,
  year: number,
): string[] {
  if (!isOfferedGood(pack, cn) || !Number.isInteger(year)) return []
  const prepared = prepareEstimatorPack(pack)
  if (!packCoversYear(prepared, year)) return []
  const origins = originOrder(pack, country)
  const covering = coveringBenchmarks(prepared, cn)

  // AXIS 1 — NAMED. Every route the corpus mentions for this good, from either table.
  //
  // The default-value half of this used to be the whole answer, filtered down to routes whose
  // `lookupValue(...).kind === 'found'`, justified by a docblock asserting that "a route the
  // corpus does not list has no default AND no benchmark". That equivalence is false: the
  // Commission publishes default values for 8 routes and benchmarks for 11, so 421 of 572 goods
  // gained at least one route the engine prices perfectly well (measured for India; also 421 for
  // DZ and CN, with a different split). On 72061000 the single offered route carried the LARGEST
  // free-allocation deduction of the three available, so the omission under-charged by up to 2.9x.
  const named = new Set(origins.flatMap(origin =>
    availableRoutesAt(prepared, 'direct', cn, origin, year),
  ))
  for (const row of covering) if (row.routeIndicator !== '') named.add(row.routeIndicator)

  // AXIS 2 — RESOLVABLE. Mirrors resolveBenchmark (lib/cbam/resolve-fa.ts): an exact-route row
  // resolves, and failing that a ROUTE-INDEPENDENT row (`routeIndicator === ''`) does, because an
  // unqualified Annex row applies whatever route is declared. Column B because the estimator
  // prices whole goods; Column A is process-level and cannot carry one of these lines.
  //
  // This axis is why offering needs no gate, and the reason is not the one an earlier draft of
  // this comment gave. It claimed a route with no benchmark "has no free-allocation term at all,
  // so resolveBenchmark refuses" — false, and misleading: the route-independent fallback means a
  // good with no row for the declared route can still price, as 73181535 and five siblings do at
  // 77.485 certificates on 1.9 t/t verified with no route-specific row anywhere. The true reason
  // is that a route failing THIS test can never produce a figure for anyone, on either tier, so
  // offering it could only ever waste the user's time — and, once the defaults-tier refusal
  // starts telling them their verified figures would price the line, actively mislead them.
  const columnB = new Set(covering
    .filter(row => row.benchmarkColumn === 'B')
    .map(row => row.routeIndicator))
  return [...named]
    .filter(route => columnB.has(route === 'default' ? '' : route) || columnB.has(''))
    .sort()
}

/**
 * Does the corpus cover this reporting year at all?
 *
 * THE INVARIANT THAT WENT MISSING. Before routesFor grew its benchmark limb it was purely
 * defaults-driven, and the defaults limb year-gates because its rows are keyed by reportingYear.
 * So "the pack publishes no defaults for this year" implicitly meant "no routes", and the offer
 * list closed itself in an uncovered year without anyone writing the rule down. Widening to the
 * benchmark limb silently dropped that, because benchmark rows are open-ended: 1,671 of the
 * pack's 2,465 rows carry `validTo: null` and the rest run to 2030-12-31, so they name routes for
 * years the Commission has published no default values, no certificate price and no CSCF for.
 * Measured at 2029: 51,362 of 69,784 (good, origin) pairings were offered routes, and 0 of 12,710
 * sampled offers could price. Stating the rule explicitly is the fix.
 *
 * `reportingYears` is the corpus's own statement of its coverage, not a policy written here — the
 * same discipline as the rest of this file, where every gate is decided by the data.
 *
 * NOT the row-validity gate, and that is deliberate. Mirroring resolveBenchmark's `active()` onto
 * the benchmark limb — intersecting each row's validFrom/validTo with the calendar year — was
 * implemented and measured first, because the two limbs disagreeing about validity looks like the
 * defect. On the shipped corpus it is unobservable: all 397 rows that expire on 2027-12-31 have an
 * exact successor row for the same (scopeCode, codeLevel, column, routeIndicator) in the
 * 2028-01-01→2030-12-31 window — 397 of 397, with 0 rows left without a successor — so the union
 * of offered routes is bit-identical in every year from 2026 to 2030, and the years it does close
 * (2024, 2025, 2031+) this gate closes anyway. It was dropped rather than kept as an equivalent
 * mutant no test can exercise. If the corpus ever ships an expiring row with no successor, add it
 * then, against a real input.
 */
function packCoversYear(prepared: PreparedEstimatorPack, year: number): boolean {
  return prepared.reportingYears.has(year)
}

/**
 * Every benchmark row whose scope covers a good — the corpus's whole say about it, both columns
 * and both route-specific and route-independent rows, left for the caller to split.
 *
 * `scopeCode.length === codeLevel` is resolveBenchmark's own self-consistency guard on the row,
 * repeated rather than assumed.
 *
 * Deliberately NOT reduced to the deepest scope — as a FORWARD GUARD, not a repair. Measured on
 * the shipped corpus: 0 goods carry route-specific benchmark rows at mixed scope depths, so a
 * deepest-scope reduction would drop 0 route offers today and nothing here is fixing an observed
 * loss. The guard is kept because `resolveBenchmark` splits by route BEFORE taking its longest
 * match, so each route resolves at its own depth: were the corpus ever to list a route only at a
 * 4-digit heading row while another route had an 8-digit row, that route would still resolve, and
 * narrowing here would stop offering it.
 *
 * Validity dates are not filtered HERE, and the reason the earlier note gave for that was the
 * wrong one. It said resolveBenchmark "applies `active()` itself at the moment it matters" — true
 * of the resolver, but it left the offer list with no year test on this limb at all, which is how
 * routes came to be offered for years the corpus does not cover. The year test now lives in
 * routesFor, on the corpus's own coverage (`packCoversYear`), not on these rows' windows; see that
 * function for why the row-window gate was measured, found unobservable, and dropped.
 */
function coveringBenchmarks(prepared: PreparedEstimatorPack, cn: string) {
  return prepared.source.benchmarks.filter(row => cn.startsWith(row.scopeCode)
    && row.scopeCode.length === row.codeLevel)
}

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
): ValueRecord | null {
  const date = parseRegulatoryDate(input.date)
  if (!date.ok) return null
  const lookup = lookupValue(pack, 'direct', input, date.year)
  return lookup.kind === 'found' ? lookup.factor : null
}

/** The indirect (electricity) default for this selector, or why there is none. */
export function lookupIndirectFactorFromPack(
  pack: EstimatorPack,
  input: EstimatorInput,
): IndirectLookup {
  const date = parseRegulatoryDate(input.date)
  if (!date.ok) return { kind: 'none' }
  return lookupValue(pack, 'indirect', input, date.year)
}

/**
 * The same lookup under its historical name. Kept returning the full IndirectLookup rather than a
 * nullable record, because the distinction between `none` and `route-mismatch` is what the store's
 * scope control reads (`kind !== 'none'` keeps the control visible so the user can reach the
 * refusal that explains it). Narrowing it to a nullable record would collapse the two facts the
 * type exists to separate.
 */
export function selectIndirectFactorFromPack(
  pack: EstimatorPack,
  input: EstimatorInput,
): IndirectLookup {
  return lookupIndirectFactorFromPack(pack, input)
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
 * import date or the net mass is not one this estimator can read.
 *
 * `null`, not `state: 'indeterminate'`, for the unreadable-mass case. An indeterminate view still
 * renders a card carrying the sector, the threshold value and a source locator — a partial legal
 * claim assembled around a mass nobody can read, and ThresholdRulerCard.vue prints
 * knownEligibleMassT raw at 52px, which is how 'Infinity' reached a user as their eligible mass.
 * This overloads null, which already means "no threshold rule this year" (and, at the store, "the
 * pack has not loaded"), and that is fine: the sole caller renders the card under
 * `v-if="threshold"` (EstimateView), so every meaning renders nothing, and the estimate's own
 * refusal is what names the mass as the problem.
 */
export function resolveThreshold(
  pack: EstimatorPack,
  input: { cn: string; massT: string; date: string },
): ThresholdView | null {
  const date = parseRegulatoryDate(input.date)
  const mass = parseNonNegativeDecimal(input.massT)
  if (!date.ok || !mass.ok) return null
  const rule = prepareEstimatorPack(pack).thresholdByYear.get(date.year)
  if (!rule) return null
  const sector = sectorForCn(input.cn)
  if (!sector || !rule.includedSectors.includes(sector)) return null
  // TRIMMED, but otherwise the user's own digits. evaluateThreshold hands whatever it gets
  // straight to Decimal, which throws on '  100  ' — safe only while this file's own regex
  // rejected surrounding whitespace outright, which the shared parser no longer does. Trimming is
  // the whole of what has to change: `mass.value.toFixed()` would also work arithmetically but
  // renormalises the number, so a user who typed 100.50 would be shown 100.5 as their eligible
  // mass. ThresholdRulerCard.vue prints this value raw at 52px, so it must stay the figure the
  // user actually entered.
  const evaluated = evaluateThreshold({
    knownEligibleMassT: input.massT.trim(),
    completeness: 'partial',
    thresholdT: rule.thresholdT,
  })
  return { ...evaluated, calendarYear: rule.calendarYear, sector, sourceLocator: rule.sourceLocator }
}

/**
 * A non-negative decimal this estimator may price, or null when it may not. Used for the
 * verified per-tonne figures AND for net mass — one predicate, because they want exactly the
 * same rule and two similar ones is how they drift apart.
 *
 * A thin adapter over parseNonNegativeDecimal (lib/cbam/input.ts), which is now the single shape
 * gate the whole engine shares. The reasoning it encodes: `new Decimal('')` and
 * `new Decimal('abc')` THROW, and they throw inside estimateFromPack — before
 * estimateCertificates is entered — so they escape that function's fail-closed boundary entirely
 * and reach the browser as an unhandled exception rather than a refusal that names the gap. 'NaN'
 * and 'Infinity' do not throw; they propagate through the arithmetic and print as certificates
 * and a euro cost. And the engine's floor clamp catches none of it: figureFrom clamps the DIRECT
 * side alone and then ADDS the indirect figure, so a negative value priced a NEGATIVE bill
 * (-394.58 certificates, -EUR 29,735.55 on a real line; -EUR 331.58 via a -100 t mass). Nor is
 * Decimal itself the guard: it reads '0x10' as 16 and '1_000' as 1000, which is why the SHAPE
 * gate runs before it rather than after — '0x10' parsed as 16 once priced 1,474.42 certificates /
 * EUR 111,112.29, a confident bill off a string this function's own refusal calls unreadable.
 *
 * Refusing, not clamping: a nonsense input silently turned into a priceable number is how a
 * wrong tax liability gets acted on. Zero is legal for both callers — a genuinely clean producer
 * attests it, and a 0 t line costs EUR 0.00, which is arithmetic rather than fabrication.
 */
export function nonNegativeDecimal(value: string): Decimal | null {
  const parsed = parseNonNegativeDecimal(value)
  return parsed.ok ? parsed.value : null
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
  | {
      kind: 'priced'
      indirectTco2e: string
      /**
       * Whether the row this figure came from is the Commission's residual bucket rather than the
       * declared origin's own sheet. Reported ALONGSIDE the figure, not derived by the callers:
       * `originOrder` decides which sheet answers, and re-deriving that from the selector is how
       * two answers to one question come to disagree.
       *
       * Additive on purpose. The defaults path reads `kind` and `indirectTco2e` only, so it
       * cannot see this field and its behaviour is unchanged — it already discloses its own basis
       * through `originBasis`, which it computes from the DIRECT factor.
       */
      residualOrigin: boolean
    }
  | { kind: 'none' }
  | { kind: 'route-mismatch' }

function indirectDefaultFigure(
  pack: EstimatorPack, input: EstimatorInput, mass: Decimal,
): IndirectDefaultFigure {
  const indirect = lookupIndirectFactorFromPack(pack, input)
  if (indirect.kind === 'route-mismatch') return { kind: 'route-mismatch' }
  if (indirect.kind !== 'found') return { kind: 'none' }
  return {
    kind: 'priced',
    indirectTco2e: new Decimal(indirect.factor.cell.baseIntensity)
      .mul(new Decimal(1).plus(new Decimal(indirect.factor.markupPct).div(100)))
      .mul(mass).toFixed(),
    residualOrigin: indirect.factor.originCountry === OTHER_ORIGIN,
  }
}

/**
 * The line facts every path stamps identically, built ONCE. They used to be written out twice,
 * and the copies drifted silently: a fabricated snapshotHash on the verified path survived
 * mutation testing while the defaults path pinned the real one.
 *
 * `tier` carries the defaults-path value and the verified path overrides it. `originBasis` is a
 * provenance CLAIM about where a figure came from, so each path passes its own rather than
 * inheriting one neither chose.
 */
function baseInput(
  pack: EstimatorPack,
  input: EstimatorInput,
  quantityT: string,
  importDate: string,
  originBasis: 'country' | 'residual' | null,
): CertificateEstimateInput {
  return {
    emissionsTco2e: '0',
    quantityT,
    scope: 'full_product',
    tier: 'default+markup',
    originBasis,
    emissionsType: 'direct',
    cnCode: input.cn,
    routeIndicator: benchmarkRoute(input.route),
    importDate,
    precursors: [],
    indirectTco2e: '0',
    snapshotHash: input.packSha256 ?? 'unsealed-pack',
    linePackage: dvPackageId(pack),
    customsLineId: 'estimator-prototype',
  }
}

export function estimateFromPack(pack: EstimatorPack, input: EstimatorInput): CertificateEstimate {
  const tables = faTablesOf(pack)
  const parsedMass = parseNonNegativeDecimal(input.massT)
  const date = parseRegulatoryDate(input.date)

  // ABOVE the branch, deliberately: every path multiplies by mass, so gating inside one would
  // leave the others open. `tier` reports what the CALLER asked for — the refusal produces no
  // figure, so there is nothing to attribute and `originBasis` is null on either path.
  const refusalTier: DataTier = input.verified ? 'actual-verified' : 'default+markup'
  const provisional: CertificateEstimateInput = {
    ...baseInput(pack, input, input.massT, date.ok ? date.day : input.date, null),
    tier: refusalTier,
  }
  if (!parsedMass.ok) {
    return unavailableEstimate(
      provisional, tables, failureMessage('BAD_MASS'), `mass/${input.cn}/${input.date}`, 'BAD_MASS',
    )
  }
  if (!date.ok) {
    // BAD_DATE_REASON, the SAME sentence certificate-estimate.ts gives a `quarter/` refusal, not
    // a second one written for this gate. The fact is identical — the import date cannot be read
    // — and the only thing this gate changes is that it is caught earlier, before the engine is
    // entered. Two sentences for one fact is how a user comes to think there are two problems.
    return unavailableEstimate(
      provisional, tables, BAD_DATE_REASON, `date/${input.date}`, 'BAD_DATE',
    )
  }
  const mass = parsedMass.value

  // THE PACK DECIDES WHAT IS AN OFFERED GOOD, and it decides it ONCE, above the branch, for the
  // same reason the mass and date gates sit here: a gate inside one path leaves the other open.
  // The verified path never consulted isOfferedGood at all, so a CN the pack does not classify
  // still priced whenever the BENCHMARK matched on prefix — the direct figure comes from the
  // attestation, so no default lookup ever stood in its way. 25070080 returned 190 tCO2e with a
  // full provenance stamp. Fail-open in a fail-closed engine. CBM's own form cannot reach it
  // (chosenCn requires an exact classification AND routesFor returns []), but the engine is a
  // vendored artefact whose other consumer takes the CN as free text, so the gate belongs here.
  //
  // NOT_A_COVERED_GOOD, not NO_DIRECT_DEFAULT. The defaults path reached this same verdict
  // through lookupValue's own isOfferedGood check and reported it as a missing default, whose
  // message ends by telling the importer that their own verified figures do not depend on that
  // default. That was true while this path priced; closing the fail-open made it a lie for
  // exactly the codes this gate catches, and a refusal that sends someone to commission an audit
  // it will then also refuse costs more than the fail-open did. One fact, one code, ONE call
  // site — the two paths cannot drift apart because there is only one of them here.
  //
  // `refusalTier`, so each path reports the tier the CALLER asked for: a verified-path refusal
  // stamped 'default+markup' would tell an auditor a line resting on the importer's own attested
  // figure was a defaults-path line. The selector names what was actually judged — the CN's
  // classification — so origin, route and year are absent from it, never having been consulted.
  //
  // lookupValue's own isOfferedGood check STAYS. It is unreachable from here now, but it also
  // guards selectFactorFromPack and lookupIndirectFactorFromPack, which callers reach directly.
  if (!isOfferedGood(pack, input.cn)) {
    return unavailableEstimate(
      { ...baseInput(pack, input, mass.toFixed(), date.day, null), tier: refusalTier },
      tables, failureMessage('NOT_A_COVERED_GOOD'),
      `classification/${input.cn}`, 'NOT_A_COVERED_GOOD',
    )
  }

  // An attested figure replaces the DEFAULT, not the benchmark. The DIRECT figure deliberately
  // does not depend on the published default: on this path a missing published default is not a
  // refusal, it is the ordinary case an importer collects data for. (The corpus IS consulted
  // here, for an indirect half the importer did not attest — but never for the direct one.) A
  // missing BENCHMARK still refuses, from inside estimateCertificates, exactly as before.
  if (input.verified) {
    // No published default backs the DIRECT figure, so there is no default basis to report on it:
    // null is what CertificateEstimateInput.originBasis names for a figure resting on no default,
    // and what prod's originBasisOf() returns for every method but official_default.
    // 'country' was not merely redundant — DisclosureCard.vue renders the row on truthiness and
    // would tell the importer their own audited figure is "the origin's own published default".
    //
    // It stays null on a 'verified-direct+default-indirect' line too, whose indirect half DOES
    // rest on a default and can draw it from the residual bucket. The field describes one basis
    // and that line has two, so 'residual' would fire RESIDUAL_BASIS_NOTE over an estimate whose
    // direct figure is the importer's own audited number. The substitution is disclosed by
    // `residualIndirectDefault` instead — a separate field firing a note scoped to the electricity
    // half — so the two bases are reported separately rather than one standing in for both.
    const verifiedStamp: CertificateEstimateInput = {
      ...baseInput(pack, input, mass.toFixed(), date.day, null),
      tier: 'actual-verified',
    }

    const direct = nonNegativeDecimal(input.verified.directTco2ePerT)
    if (!direct) {
      return unavailableEstimate(
        verifiedStamp, tables, failureMessage('BAD_VERIFIED'),
        `verified/${input.cn}/directTco2ePerT`, 'BAD_VERIFIED',
      )
    }

    // Same gate as the defaults path: the indirect figure is only READ when the scope charges
    // for it, so it is only judged then — refusing over a value that never enters the estimate
    // would name a gap the user cannot close. On a 'direct' line nothing below runs, nothing
    // stands in for anything, and the tier stays what the attestation makes it.
    let indirectTco2e = '0'
    let tier: DataTier = 'actual-verified'
    // Set ONLY where a default actually stood in AND that default was the residual bucket's, so
    // it stays false on every arm where nothing was substituted — an attested electricity figure,
    // a 'direct' scope, a good with no published indirect default at all.
    let residualIndirectDefault = false
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
          return unavailableEstimate(
            verifiedStamp, tables, failureMessage('BAD_VERIFIED'),
            `verified/${input.cn}/indirectTco2ePerT`, 'BAD_VERIFIED',
          )
        }
        indirectTco2e = indirect.mul(mass).toFixed()
      } else {
        // Nothing attested for electricity, so the Commission's published default stands in —
        // WITH its mark-up, priced by the same expression the defaults path uses. The mark-up
        // belongs here: it prices not-having-data, and on this half the importer does not have
        // data. Attesting the process figure earns the mark-up's removal from the process figure,
        // and nowhere else. Pricing this component at zero, which is what happened before, is a
        // silent under-charge on a page whose governing rule is fail-closed.
        const fallback = indirectDefaultFigure(pack, { ...input, date: date.day }, mass)
        if (fallback.kind === 'route-mismatch') {
          return unavailableEstimate(
            verifiedStamp, tables, failureMessage('NO_INDIRECT_ROUTE'),
            `indirect/${input.cn}/${input.country}/${input.route}/${date.year}`, 'NO_INDIRECT_ROUTE',
          )
        }
        if (fallback.kind === 'priced') {
          indirectTco2e = fallback.indirectTco2e
          // Stamped ONLY where a default actually stood in. `none` means the Commission publishes
          // no indirect default for THIS GOOD at all, so zero is the published answer rather than
          // a substitution — claiming a default was applied there would tell an auditor to go
          // looking for one that does not exist. Measured on the shipped pack, the sectors with no
          // published indirect value anywhere are aluminium and hydrogen; iron & steel is not one,
          // because 26011200 carries 84 of them and reaches this branch priced.
          tier = 'verified-direct+default-indirect'
          // Same gate, one question further: WHOSE default stood in. The tier says a substitution
          // happened; this says the substituted value is a world average rather than the origin's
          // own, which is the part an importer cannot see in the number.
          residualIndirectDefault = fallback.residualOrigin
        }
      }
    }

    return estimateCertificates({
      ...verifiedStamp,
      tier,
      residualIndirectDefault,
      // toFixed(), never toString(): a small attested figure must render as 0.0000000001, not
      // as the exponential '1e-10' certificate-estimate.ts warns about.
      emissionsTco2e: direct.mul(mass).toFixed(),
      indirectTco2e,
    }, tables)
  }

  const direct = lookupValue(pack, 'direct', input, date.year)
  if (direct.kind !== 'found') {
    // No published direct default → 'unavailable' explicitly. The engine only reports
    // unavailable on a missing BENCHMARK; a missing default with emissions of 0 would look like
    // a real zero-cost figure, which it is not.
    return unavailableEstimate(
      baseInput(pack, input, mass.toFixed(), date.day, null),
      tables,
      failureMessage('NO_DIRECT_DEFAULT'),
      `default/${input.cn}/${input.country}/${input.route}/${date.year}`,
      'NO_DIRECT_DEFAULT',
    )
  }

  // Which basis the figure rests on — the origin's own published default, or the Commission's
  // world-average residual bucket. The user is told either way (see RESIDUAL_BASIS_NOTE).
  const originBasis = direct.factor.originCountry === OTHER_ORIGIN ? 'residual' as const : 'country' as const
  const safeBase = baseInput(pack, input, mass.toFixed(), date.day, originBasis)
  const markedUp = new Decimal(direct.factor.cell.baseIntensity)
    .mul(new Decimal(1).plus(new Decimal(direct.factor.markupPct).div(100)))
  const emissionsTco2e = markedUp.mul(mass).toFixed()

  // Indirect is opt-in and silent when the Commission publishes nothing for the good: asking for
  // it must never fabricate a component, and must never fail a good that has only a direct row.
  // A route MISMATCH is not that case — see IndirectLookup — and refuses.
  let indirectTco2e = '0'
  if (input.emissionsScope === 'direct_and_indirect') {
    const indirect = indirectDefaultFigure(pack, { ...input, date: date.day }, mass)
    if (indirect.kind === 'route-mismatch') {
      return unavailableEstimate(
        safeBase, tables, failureMessage('NO_INDIRECT_ROUTE'),
        `indirect/${input.cn}/${input.country}/${input.route}/${date.year}`, 'NO_INDIRECT_ROUTE',
      )
    }
    if (indirect.kind === 'priced') indirectTco2e = indirect.indirectTco2e
  }

  return estimateCertificates({ ...safeBase, emissionsTco2e, indirectTco2e }, tables)
}
