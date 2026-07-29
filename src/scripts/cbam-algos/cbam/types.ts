import type { LegalSource } from '../regulatory/types'

/**
 * Free-allocation adjustment reference data (IR (EU) 2025/2620), in memory.
 *
 * Numerics are strings for the same reason they are strings everywhere else in the
 * regulatory layer: this is money and emissions, and a float round-trip is a silent
 * data change. They enter decimal.js and leave as strings.
 */

export interface BenchmarkVersion {
  id: string
  rulePackageId: string
  scopeCode: string
  codeLevel: 2 | 4 | 6 | 8
  /** A = process benchmark (actual-data path, Eq 2). B = full product benchmark (defaults, Eq 6). */
  benchmarkColumn: 'A' | 'B'
  /** '' when the good has a single route; '(C)', '(D)', … otherwise. */
  routeIndicator: string
  bmTco2ePerT: string
  sourceId: string
  sourceLocator: string
  validFrom: string
  validTo: string | null
}

export interface CbamFactorVersion {
  id: string
  rulePackageId: string
  year: number
  /** Free allocation RETAINED (Dir 2003/87/EC Art 10a(1a)): 0.975 in 2026 → 0 in 2034. */
  factor: string
  sourceId: string
  sourceLocator: string
}

export interface CscfVersion {
  id: string
  rulePackageId: string
  year: number
  value: string | null
  status: 'published' | 'pending'
  sourceId: string
  sourceLocator: string
}

export interface CertificatePriceVersion {
  id: string
  rulePackageId: string
  /** '2026-Q1' … */
  quarter: string
  priceEur: string | null
  status: 'published' | 'pending'
  publicationDate: string | null
  sourceId: string
  sourceLocator: string
}

export interface FreeAllocationTables {
  packageId: string
  packageVersion: string
  benchmarks: BenchmarkVersion[]
  cbamFactors: CbamFactorVersion[]
  cscf: CscfVersion[]
  prices: CertificatePriceVersion[]
  sources: LegalSource[]
}

/**
 * The CSCF gate, as a type (dossier A7).
 *
 * The `pending` arm carries no `value` field at all, so `resolveCscf(...).value` does not
 * typecheck until the caller has narrowed on `status`. The cross-sectoral correction factor
 * is unpublished for 2026-2030; it was 1.0 for 2021-25, and that is precisely why the
 * compiler — not a code-review convention — has to be the thing that stops us assuming it.
 */
export type CscfResolution =
  | { status: 'published'; value: string; sourceId: string; sourceLocator: string }
  | { status: 'pending'; year: number; sourceId: string; sourceLocator: string }

export type PriceResolution =
  | { status: 'published'; quarter: string; priceEur: string; sourceId: string }
  | { status: 'pending'; quarter: string; sourceId: string }
