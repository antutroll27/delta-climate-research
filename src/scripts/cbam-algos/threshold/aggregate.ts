import Decimal from 'decimal.js'
import { DomainError } from '../errors/domain-error'
import type { ImportCompleteness } from './evaluate'

export const importSectors = [
  'cement',
  'aluminium',
  'fertilisers',
  'iron_and_steel',
  'electricity',
  'hydrogen',
] as const

export type ImportSector = typeof importSectors[number]

export interface ThresholdSelector {
  importerOrgId: string
  calendarYear: number
}

export interface ImportMassEntry extends ThresholdSelector {
  id: string
  sector: ImportSector
  netMassT: string
  sourceSha256: string
}

export interface AnnualImportLedgerStatus extends ThresholdSelector {
  id: string
  completeness: ImportCompleteness
}

export interface ThresholdBasis extends ThresholdSelector {
  ledgerStatusVersionId: string
  completeness: ImportCompleteness
  knownEligibleMassT: string
  entryIds: string[]
  entryHashes: string[]
}

const massSectors = new Set<ImportSector>([
  'cement',
  'aluminium',
  'fertilisers',
  'iron_and_steel',
])

export function aggregateThresholdBasis(
  selector: ThresholdSelector,
  entries: readonly ImportMassEntry[],
  status: AnnualImportLedgerStatus,
): ThresholdBasis {
  if (status.importerOrgId !== selector.importerOrgId ||
      status.calendarYear !== selector.calendarYear) {
    throw new DomainError('THRESHOLD_INDETERMINATE')
  }

  const selected = entries.filter(entry =>
    entry.importerOrgId === selector.importerOrgId &&
    entry.calendarYear === selector.calendarYear &&
    massSectors.has(entry.sector),
  ).sort((left, right) => left.id.localeCompare(right.id))

  return {
    ...selector,
    ledgerStatusVersionId: status.id,
    completeness: status.completeness,
    knownEligibleMassT: selected
      .reduce((sum, entry) => sum.plus(entry.netMassT), new Decimal(0))
      .toString(),
    entryIds: selected.map(entry => entry.id),
    entryHashes: selected.map(entry => entry.sourceSha256),
  }
}
