import Decimal from 'decimal.js'
import { DomainError } from '../errors/domain-error'
import { resolveBenchmark, resolveCbamFactor, resolveCscf } from './resolve-fa'
import type { FreeAllocationTables } from './types'

/**
 * SEFA — the specific embedded free allocation, per tonne of good (IR (EU) 2025/2620).
 *
 *   Eq 2 (actual-data path):  SFAProc = CBAM_y × CSCF_y × BM_A(process)
 *   Eq 4 (complex good):      SEFA    = SFAProc + Σ (mass_i × SEFA_i)     ← recursive
 *   Eq 6 (default path):      SEFA    = CBAM_y × CSCF_y × BM_B(good)
 *
 * This is the deduction that keeps imports symmetric with EU producers who still receive
 * free ETS allowances. It is subtracted from embedded emissions before certificates are
 * counted, so getting it wrong moves the bill, not a report line.
 *
 * Three ways this goes wrong, all guarded here:
 *   - Column A vs Column B is determinative, not cosmetic (a cement grinder's Column A is 0).
 *   - CBAM_y is free allocation RETAINED (0.975 in 2026), not the phase-in complement.
 *   - The CSCF is unpublished for 2026-2030. It is NOT 1.0 by default; see below.
 */

// Matches lib/engine/v3/calc.ts. The two modules never share a call path, but a figure that
// disagreed with the ledger's arithmetic at the 34th significant digit would be a bug nobody
// could explain, so the configuration is deliberately identical.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN })

/** IR (EU) 2025/2620 Art 1(2): electricity's adjustment is zero by fiat, not by benchmark. */
const ELECTRICITY_CN = '27160000'
const ELECTRICITY_LOCATOR = 'IR (EU) 2025/2620 Art 1(2): electricity free allocation is nil'

/** The CSCF applied to 2021-25 allocations. Named here ONLY so the what-if can be labelled. */
const CSCF_2021_25 = '1'

export interface SefaPrecursor {
  cnCode: string
  routeIndicator: string
  /** Tonnes of precursor per tonne of the good. */
  quantityPerTonne: string
}

/**
 * Which benchmark column the law points at.
 *
 * This is decided by the SCOPE of the emissions figure being deducted from, NOT by whether
 * the figure was verified. Getting this wrong is the most expensive bug available here:
 *
 * - 'full_product' → Column B. The emissions figure already embeds the good's precursors, so
 *   the deduction must be the full product benchmark. This is the official-default path AND
 *   the `all_in` verified-actual path (the DB default for an operator report: a measured
 *   intensity that already includes precursor emissions).
 * - 'process_only' → Column A + Eq 4. The emissions figure covers this installation's process
 *   alone and the precursors are carried separately, so the deduction is the process benchmark
 *   plus each precursor's own benchmark. This is the `direct_only` combined method.
 *
 * Deducting a process-only benchmark from an all-in emissions figure leaves precursor
 * emissions in the chargeable total with no matching free allocation, and over-charges the
 * importer several-fold. For a cement grinder (Column A = 0) it removes the deduction
 * entirely.
 */
export type BenchmarkScope = 'full_product' | 'process_only'

export interface SefaInput {
  cnCode: string
  scope: BenchmarkScope
  routeIndicator: string
  year: number
  date: string
  precursors: readonly SefaPrecursor[]
}

export interface SefaTerm {
  label: string
  cnCode: string
  benchmarkColumn: 'A' | 'B'
  routeIndicator: string
  benchmarkTco2ePerT: string
  /** Tonnes of this precursor per tonne of the good; '1' for the good's own process term. */
  quantityPerTonne: string
  sourceLocator: string
}

export interface SefaTerms {
  cbamFactor: string
  cbamFactorYear: number
  cbamFactorLocator: string
  cscfLocator: string
  benchmarks: SefaTerm[]
}

export type SefaResult =
  | { status: 'ok'; valueTco2ePerT: string; cscf: string; terms: SefaTerms }
  /** Electricity (Art 1(2)): nil free allocation by law, not by calculation. No CSCF involved. */
  | { status: 'zero_by_fiat'; valueTco2ePerT: '0'; locator: string; terms: SefaTerms }
  | {
      status: 'cscf_pending'
      year: number
      terms: SefaTerms
      /**
       * A labelled what-if, never the figure. The CSCF is unpublished, so no final SEFA
       * exists; this shows what the number would be at the last CSCF the Commission actually
       * set (1.0, for 2021-25), so a user can size their exposure without being handed a
       * fabricated certainty. Presentation must render it as a scenario.
       */
      scenario: { assumedCscf: string; valueTco2ePerT: string }
    }

function benchmarkTerm(
  tables: FreeAllocationTables,
  input: { cnCode: string; column: 'A' | 'B'; routeIndicator: string; date: string },
  label: string,
  quantityPerTonne: string,
): SefaTerm {
  const row = resolveBenchmark(tables, {
    cnCode: input.cnCode,
    column: input.column,
    routeIndicator: input.routeIndicator,
    date: input.date,
  })
  return {
    label,
    cnCode: input.cnCode,
    benchmarkColumn: row.benchmarkColumn,
    routeIndicator: row.routeIndicator,
    benchmarkTco2ePerT: row.bmTco2ePerT,
    quantityPerTonne,
    sourceLocator: row.sourceLocator,
  }
}

/**
 * Collect every benchmark this good depends on, then multiply once.
 *
 * Collecting first is what makes the failure mode correct: if ONE precursor benchmark is
 * missing, the whole SEFA is unavailable (REGULATION_NOT_FOUND) rather than silently
 * becoming a smaller deduction — and a smaller deduction is a bigger bill charged to the
 * importer on our authority.
 */
export function sefa(input: SefaInput, tables: FreeAllocationTables): SefaResult {
  const cbam = resolveCbamFactor(tables, input.year)
  const cscf = resolveCscf(tables, input.year)

  if (input.cnCode === ELECTRICITY_CN) {
    // Zero regardless of factor, CSCF or benchmark — the regulation says so outright, so a
    // bug upstream cannot produce a plausible non-zero here.
    //
    // This is its own status, NOT 'ok' with a fabricated cscf of '0'. The earlier version
    // returned exactly that, and the UI dutifully reported "CSCF published · CSCF 0" — a
    // false statement about a regulation whose CSCF is unpublished. A zero by fiat and a
    // zero by arithmetic are different claims and must not share a shape.
    return {
      status: 'zero_by_fiat',
      valueTco2ePerT: '0',
      locator: ELECTRICITY_LOCATOR,
      terms: {
        cbamFactor: cbam.factor,
        cbamFactorYear: input.year,
        cbamFactorLocator: cbam.sourceLocator,
        cscfLocator: ELECTRICITY_LOCATOR,
        benchmarks: [],
      },
    }
  }

  const column = input.scope === 'full_product' ? 'B' : 'A'
  const benchmarks: SefaTerm[] = [
    benchmarkTerm(
      tables,
      { cnCode: input.cnCode, column, routeIndicator: input.routeIndicator, date: input.date },
      input.scope === 'full_product' ? 'good (Column B, full product)' : 'process (Column A)',
      '1',
    ),
  ]

  if (input.scope === 'process_only') {
    // Eq 4. Each precursor is valued at its OWN full-product benchmark (Column B), which
    // already embeds that precursor's own precursors — so one level terminates correctly and
    // recursing further would double-count.
    for (const precursor of input.precursors) {
      benchmarks.push(benchmarkTerm(
        tables,
        {
          cnCode: precursor.cnCode,
          column: 'B',
          routeIndicator: precursor.routeIndicator,
          date: input.date,
        },
        `precursor ${precursor.cnCode}`,
        precursor.quantityPerTonne,
      ))
    }
  } else if (input.precursors.length > 0) {
    // Column B already covers the whole product, precursors included. Adding them on top
    // would double-count the deduction and under-charge.
    throw new DomainError('REGULATION_NOT_FOUND', {
      selector: `sefa/${input.cnCode}/full-product-scope-with-precursors`,
      reason: 'COLUMN_B_ALREADY_COVERS_PRECURSORS',
    })
  }

  const terms: SefaTerms = {
    cbamFactor: cbam.factor,
    cbamFactorYear: input.year,
    cbamFactorLocator: cbam.sourceLocator,
    cscfLocator: cscf.sourceLocator,
    benchmarks,
  }

  const weighted = benchmarks.reduce(
    (sum, term) => sum.plus(new Decimal(term.benchmarkTco2ePerT).mul(term.quantityPerTonne)),
    new Decimal(0),
  )
  const withFactor = weighted.mul(cbam.factor)

  if (cscf.status === 'pending') {
    // No final SEFA exists. The union gives the caller nowhere to read a value from.
    return {
      status: 'cscf_pending',
      year: input.year,
      terms,
      scenario: {
        assumedCscf: CSCF_2021_25,
        valueTco2ePerT: withFactor.mul(CSCF_2021_25).toString(),
      },
    }
  }

  return {
    status: 'ok',
    valueTco2ePerT: withFactor.mul(cscf.value).toString(),
    cscf: cscf.value,
    terms,
  }
}
