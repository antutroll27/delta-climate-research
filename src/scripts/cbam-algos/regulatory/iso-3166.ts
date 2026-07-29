/**
 * The officially assigned ISO 3166-1 alpha-2 codes.
 *
 * This exists to answer exactly one regulatory question: **is this origin a real country code
 * the Commission could have priced, or is it junk?** The distinction drives the residual-bucket
 * fallback in `resolveDefaultFactor`:
 *
 * - A valid code the Commission does not list individually (e.g. NP) resolves to the workbook's
 *   "Other Countries and Territories" residual defaults, stamped as such.
 * - A code that is NOT assigned (a typo like `XX`, a user-assigned range, a truncated field)
 *   fails closed. It must never silently receive world-average defaults: a misspelled origin
 *   that quietly produces a plausible number is the most expensive kind of wrong we can ship.
 *
 * Includes territories and dependencies (HK, MO, TW, PR, …), not just sovereign states: they are
 * genuine trade origins with their own customs identity, and several are individually listed in
 * the Commission's workbook.
 *
 * Source: ISO 3166-1 officially assigned alpha-2 codes. Deliberately NOT derived from
 * `src/components/riskmap/iso-numeric.ts`, which is a strict subset (194 entries — only the
 * countries that have a world-atlas 110m polygon to tint, so it lacks TW/HK/MO among others).
 * That map's test asserts the subset relationship, so the two cannot drift apart.
 */
const ASSIGNED_ALPHA2 = new Set<string>([
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ',
  'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW',
  'CX', 'CY', 'CZ',
  'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
  'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT',
  'GU', 'GW', 'GY',
  'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP',
  'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
  'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS',
  'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'OM',
  'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY',
  'QA',
  'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ',
  'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'UM', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
  'WF', 'WS',
  'YE', 'YT',
  'ZA', 'ZM', 'ZW',
])

/** The sentinel origin for the Commission's residual "Other Countries and Territories" sheet. */
export const OTHER_ORIGIN = 'OTHER'

/**
 * True only for an officially assigned ISO 3166-1 alpha-2 code. `OTHER` is deliberately NOT
 * assigned-true: it is our sentinel for the residual bucket, not a country an importer declares.
 */
export function isAssignedAlpha2(code: string): boolean {
  return ASSIGNED_ALPHA2.has(code)
}

export const assignedAlpha2Count = ASSIGNED_ALPHA2.size

/**
 * The same codes, sorted, as a frozen list. Exists so the DB-side CHECK on `plot.country`
 * (migration 0018) can be GENERATED from this set rather than hand-copied — and so a drift
 * test can prove the constraint still matches it. Two hand-maintained copies of a 249-entry
 * list would silently diverge; the one that mattered would be whichever we forgot.
 */
export const assignedAlpha2Codes: readonly string[] = Object.freeze([...ASSIGNED_ALPHA2].sort())
