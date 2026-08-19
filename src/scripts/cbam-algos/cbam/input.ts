import Decimal from 'decimal.js'

export type RegulatoryDate =
  | { ok: true; day: string; year: number; quarter: string }
  | { ok: false; code: 'BAD_DATE' }

export type ParsedDecimal =
  | { ok: true; value: Decimal }
  | {
      ok: false
      code: 'EMPTY_NUMBER' | 'INVALID_NUMBER' | 'NON_FINITE_NUMBER' | 'NEGATIVE_NUMBER'
    }

/**
 * Optional sign, digits with at most one point, optional decimal exponent.
 *
 * A TRAILING BARE POINT ('5.') IS REFUSED, and the `\d+` after the point rather than `\d*` is the
 * whole of that. No numeric field produces it, and under a fail-closed stance an odd shape is a
 * question rather than a value — the same reasoning that refuses '0x10' (which Decimal reads as
 * 16) and '1_000' (which it reads as 1000). A leading '+' is refused for the same reason. '.5'
 * stays legal, via the second alternation branch.
 *
 * The sign branch is load-bearing in BOTH directions: '-1' must still reach the negative check so
 * it keeps its own refusal code, and '-0' must still pass through to price as zero.
 */
const DECIMAL_INPUT = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/

/** Parse a calendar date once; all regulatory windows compare normalized days. */
export function parseRegulatoryDate(value: string): RegulatoryDate {
  if (typeof value !== 'string' || value.length < 10) return { ok: false, code: 'BAD_DATE' }
  const day = value.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, code: 'BAD_DATE' }
  if (value.length > 10 && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return { ok: false, code: 'BAD_DATE' }
  }

  const [year, month, date] = day.split('-').map(Number)
  const calendar = new Date(Date.UTC(year, month - 1, date))
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== date
  ) return { ok: false, code: 'BAD_DATE' }

  return { ok: true, day, year, quarter: `${year}-Q${Math.ceil(month / 3)}` }
}

/** Parse user-entered mass without accepting JavaScript's radix/coercion syntax. */
export function parseNonNegativeDecimal(value: string): ParsedDecimal {
  if (typeof value !== 'string' || value.trim() === '') return { ok: false, code: 'EMPTY_NUMBER' }
  const input = value.trim()
  if (!DECIMAL_INPUT.test(input)) return { ok: false, code: 'INVALID_NUMBER' }

  let parsed: Decimal
  try {
    parsed = new Decimal(input)
  } catch {
    return { ok: false, code: 'INVALID_NUMBER' }
  }
  if (!parsed.isFinite()) return { ok: false, code: 'NON_FINITE_NUMBER' }
  if (parsed.isNegative() && !parsed.isZero()) return { ok: false, code: 'NEGATIVE_NUMBER' }
  return { ok: true, value: parsed.isZero() ? new Decimal(0) : parsed }
}

export function normalizedRegulatoryDay(value: string): string | null {
  const parsed = parseRegulatoryDate(value)
  return parsed.ok ? parsed.day : null
}
