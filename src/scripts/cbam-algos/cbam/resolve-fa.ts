import { DomainError } from '../errors/domain-error'
import type {
  BenchmarkVersion,
  CscfResolution,
  FreeAllocationTables,
  PriceResolution,
} from './types'

/**
 * Fail-closed lookups into the free-allocation reference data.
 *
 * Same discipline as lib/regulatory/resolve.ts: a miss is REGULATION_NOT_FOUND, never a
 * default; a tie is REGULATION_AMBIGUOUS, never a first-match. The one deliberate exception
 * is the CSCF and the certificate price, where "not published yet" is a legitimate state of
 * the world rather than a lookup failure — those return a `pending` resolution the caller
 * must handle, and the type system will not let it be ignored.
 */

/**
 * A calendar day, not an instant. The corpus stores validity bounds as UTC timestamps
 * ('2026-01-01T00:00:00.000Z') while an import date is a plain day ('2026-01-01'), and the
 * package contract's isoDate regex is unanchored so BOTH shapes are legal. Comparing them as
 * raw strings is only sound when the shapes match: with the same prefix the shorter string
 * sorts first, which silently saved the validTo edge and silently broke the validFrom edge —
 * a window's opening day sorted AFTER its own bound and dropped out, so 1 January 2026 refused
 * every good with a message asserting the rule did not exist.
 *
 * Reducing both sides to the day is not a workaround for awkward data: the definitive regime
 * "shall apply from 1 January 2026" (Reg (EU) 2023/956 Art 36(3)) — a day, not an instant.
 * It also makes this immune to whichever shape the data carries, which is the protection that
 * matters while both shapes remain legal.
 *
 * TWIN: lib/regulatory/resolve.ts has its own active() for the classification gate. The two are
 * not deduplicated, and nothing in this repo records a plan to; treat this comment as the record
 * and change both together, whichever one you touch.
 *
 * Neither copy leans on its callers for the shape. The twin's one caller,
 * api/services/regulatory-repository.ts's dateOnly(), puts every bound AND the import date through
 * toISOString().slice(0, 10), so on that path the shapes agree before the resolver sees them —
 * but that is a property of that caller, not a contract the resolver states or the types enforce.
 * The twin is the wider blast radius if it is ever wrong: requireActiveEnactedPackage gates the
 * whole rule package, so 1 January 2026 refuses EVERY good rather than merely every benchmark.
 */
const day = (s: string) => s.slice(0, 10)

function active(from: string, to: string | null, date: string): boolean {
  const d = day(date)
  return day(from) <= d && (to === null || d <= day(to))
}

export interface BenchmarkSelector {
  cnCode: string
  column: 'A' | 'B'
  routeIndicator: string
  date: string
}

/**
 * Resolve a benchmark by CN code and production route.
 *
 * Two fallbacks, both grounded in how the Annex is actually written:
 *
 * 1. ROUTE. A benchmark row with an empty route indicator is ROUTE-INDEPENDENT: the Annex
 *    lists one value for the good and it applies whichever way it was produced. So an exact
 *    route match wins, and failing that the route-independent row applies. This is not a
 *    guess — it is what an unqualified Annex row means. Where the Annex DOES enumerate routes
 *    and none matches the declared one (e.g. Column B for 72083800 lists only (C)/(D)/(E)),
 *    there is no route-independent row to fall back to and the lookup fails closed.
 *
 * 2. CN. Some goods are listed at heading level rather than at 8 digits, so an exact-8 lookup
 *    under-covers. The most specific listed prefix wins; an equal-length tie is ambiguous
 *    rather than arbitrary.
 */
export function resolveBenchmark(
  tables: FreeAllocationTables,
  selector: BenchmarkSelector,
): BenchmarkVersion {
  const inScope = tables.benchmarks.filter(row =>
    row.benchmarkColumn === selector.column &&
    active(row.validFrom, row.validTo, selector.date) &&
    selector.cnCode.startsWith(row.scopeCode) &&
    row.scopeCode.length === row.codeLevel)

  const exactRoute = inScope.filter(row => row.routeIndicator === selector.routeIndicator)
  const routeIndependent = inScope.filter(row => row.routeIndicator === '')
  const candidates = exactRoute.length > 0 ? exactRoute : routeIndependent

  const longest = Math.max(...candidates.map(row => row.scopeCode.length), -1)
  const matches = candidates.filter(row => row.scopeCode.length === longest)

  if (matches.length === 0) {
    throw new DomainError('REGULATION_NOT_FOUND', {
      selector: [
        'benchmark', selector.cnCode, `column-${selector.column}`,
        selector.routeIndicator || 'route-independent', selector.date,
      ].join('/'),
    })
  }
  if (matches.length !== 1) {
    throw new DomainError('REGULATION_AMBIGUOUS', {
      benchmarkIds: matches.map(row => row.id).sort(),
    })
  }
  return matches[0]
}

export function resolveCbamFactor(
  tables: FreeAllocationTables,
  year: number,
): { factor: string; sourceId: string; sourceLocator: string } {
  const matches = tables.cbamFactors.filter(row => row.year === year)
  if (matches.length === 0) {
    // Beyond 2034 the schedule simply ends. We do not extrapolate a tail.
    throw new DomainError('REGULATION_NOT_FOUND', { selector: `cbam-factor/${year}` })
  }
  if (matches.length !== 1) {
    throw new DomainError('REGULATION_AMBIGUOUS', {
      cbamFactorIds: matches.map(row => row.id).sort(),
    })
  }
  const { factor, sourceId, sourceLocator } = matches[0]
  return { factor, sourceId, sourceLocator }
}

/**
 * Resolve the cross-sectoral correction factor.
 *
 * A year the Commission has not yet corrected returns `pending` — that is the honest state,
 * not an error. A year that is not modelled at all is an error: silence is never 1.0.
 */
export function resolveCscf(tables: FreeAllocationTables, year: number): CscfResolution {
  const matches = tables.cscf.filter(row => row.year === year)
  if (matches.length === 0) {
    throw new DomainError('REGULATION_NOT_FOUND', { selector: `cscf/${year}` })
  }
  if (matches.length !== 1) {
    throw new DomainError('REGULATION_AMBIGUOUS', { cscfIds: matches.map(row => row.id).sort() })
  }
  const row = matches[0]
  if (row.status === 'published') {
    if (row.value === null) {
      // The DB parity CHECK makes this unreachable from seeded data; a hand-built table in a
      // test could still get here, and a published-with-no-value row must never become 1.0.
      throw new DomainError('REGULATION_NOT_FOUND', { selector: `cscf/${year}/published-no-value` })
    }
    return {
      status: 'published',
      value: row.value,
      sourceId: row.sourceId,
      sourceLocator: row.sourceLocator,
    }
  }
  return {
    status: 'pending',
    year,
    sourceId: row.sourceId,
    sourceLocator: row.sourceLocator,
  }
}

/** '2026-03-14' → '2026-Q1'. */
export function quarterOf(date: string): string {
  const year = date.slice(0, 4)
  const month = Number(date.slice(5, 7))
  // isInteger BEFORE the range check, and it is not redundant with it. A single-digit month
  // makes slice(5, 7) read '1-' rather than '01', Number('1-') is NaN, and NaN < 1 || NaN > 12
  // is false || false — so '2027-1-15' cleared this guard and returned the STRING '2027-QNaN'.
  // No price row matches that, so the refusal surfaced two layers down as
  // certificate-price/2027-QNaN and was answered "the good and its benchmark are present, only
  // the price is missing" — every clause false for a date nobody can read.
  //
  // Deliberately NOT a whole-date regex like /^\d{4}-\d{2}-\d{2}$/. Callers may pass a UTC
  // timestamp as well as a plain day — active() above was built to take either — and
  // '2026-01-01T00:00:00.000Z'.slice(5, 7) is '01', which must keep resolving. Verified: it
  // still returns 2026-Q1 and prices normally.
  if (!/^\d{4}$/.test(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new DomainError('REGULATION_NOT_FOUND', { selector: `quarter/${date}` })
  }
  return `${year}-Q${Math.ceil(month / 3)}`
}

export function resolveCertificatePrice(
  tables: FreeAllocationTables,
  quarter: string,
): PriceResolution {
  const matches = tables.prices.filter(row => row.quarter === quarter)
  if (matches.length === 0) {
    throw new DomainError('REGULATION_NOT_FOUND', { selector: `certificate-price/${quarter}` })
  }
  if (matches.length !== 1) {
    throw new DomainError('REGULATION_AMBIGUOUS', { priceIds: matches.map(row => row.id).sort() })
  }
  const row = matches[0]
  if (row.status === 'published') {
    if (row.priceEur === null) {
      throw new DomainError('REGULATION_NOT_FOUND', {
        selector: `certificate-price/${quarter}/published-no-value`,
      })
    }
    return { status: 'published', quarter, priceEur: row.priceEur, sourceId: row.sourceId }
  }
  return { status: 'pending', quarter, sourceId: row.sourceId }
}
