import type { FreeAllocationTables } from '../cbam/types'
import type { LegalSource } from '../regulatory/types'

export type DefaultValueCell =
  | { state: 'value'; baseIntensity: string; sourceMarker: 'numeric' | 'literal_zero' }
  | { state: 'unpublished'; marker: 'dash' | 'blank' | 'not_applicable' }
  | { state: 'pointer'; marker: 'see_below' }

export interface DefaultValueRecord {
  scopeCode: string
  codeLevel: 4 | 6 | 8 | 10
  originCountry: string
  emissionsType: 'direct' | 'indirect'
  productionRoute: string
  sourceProductionRoute: string
  reportingYear: number
  markupPct: string
  sourceId: string
  sourceLocator: string
  cell: DefaultValueCell
}

export interface RegulatoryPackageIdentity {
  schemaVersion: 2
  id: string
  version: string
  supersedes: string
  validFrom: string
  validTo: string | null
  regulatoryBasis: string[]
}

export interface GeneratedSource {
  id: string
  version: string
  packageSha256: string
  workbookSha256?: string
}

export interface EstimatorPackV2 {
  schemaVersion: 2
  identity: RegulatoryPackageIdentity
  generatedAt: string
  generatedFrom: GeneratedSource[]
  publishedOriginSheets: string[]
  classifications: Array<{ code: string; description: string }>
  defaultValues: DefaultValueRecord[]
  benchmarks: FreeAllocationTables['benchmarks']
  cbamFactors: FreeAllocationTables['cbamFactors']
  cscf: FreeAllocationTables['cscf']
  prices: FreeAllocationTables['prices']
  thresholds: Array<{
    id: string
    calendarYear: number
    thresholdT: string
    includedSectors: string[]
    sourceId: string
    sourceLocator: string
  }>
  sources: LegalSource[]
}

export interface PreparedEstimatorPack {
  source: EstimatorPackV2
  directBySelector: Map<string, DefaultValueRecord[]>
  indirectBySelector: Map<string, DefaultValueRecord[]>
  /**
   * The reporting years the pack actually publishes default values for — the corpus's own
   * statement of which years it covers. Built here rather than scanned per call: the miss case
   * (an uncovered year) is the one that walks all 76,428 rows, and it is also the exact case
   * routesFor exists to answer, measured at 0.358 ms against 0.000011 ms for this set.
   */
  reportingYears: Set<number>
  benchmarksByScope: Map<string, FreeAllocationTables['benchmarks']>
  cbamFactorByYear: Map<number, FreeAllocationTables['cbamFactors'][number]>
  cscfByYear: Map<number, FreeAllocationTables['cscf'][number]>
  priceByQuarter: Map<string, FreeAllocationTables['prices'][number]>
  thresholdByYear: Map<number, EstimatorPackV2['thresholds'][number]>
}

export interface LoadedEstimatorPack {
  pack: EstimatorPackV2
  packSha256: string
  prepared: PreparedEstimatorPack
}

const preparedCache = new WeakMap<EstimatorPackV2, PreparedEstimatorPack>()

export class PackValidationError extends Error {
  readonly name = 'PackValidationError'

  constructor(readonly issues: readonly string[]) {
    super(`Invalid CBAM estimator pack: ${issues.slice(0, 4).join('; ')}`)
  }
}

const DECIMAL = /^\d+(?:\.\d+)?$/
const SHA256 = /^[0-9a-f]{64}$/
const DAY = /^\d{4}-\d{2}-\d{2}/
const COUNTRY = /^([A-Z]{2}|OTHER)$/

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function array(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function decimal(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL.test(value)
}

function validCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY.test(value)) return false
  const day = value.slice(0, 10)
  const [year, month, date] = day.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, date))
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === date
}

function push(issues: string[], condition: boolean, message: string): void {
  if (!condition && issues.length < 100) issues.push(message)
}

function duplicateKeys<T>(rows: readonly T[], keyOf: (row: T) => string): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of rows) {
    const key = keyOf(row)
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }
  return [...duplicates]
}

/** Validate unknown JSON before any selector or arithmetic sees it. */
export function validateEstimatorPack(value: unknown): EstimatorPackV2 {
  const issues: string[] = []
  if (!object(value)) throw new PackValidationError(['top level must be an object'])

  push(issues, value.schemaVersion === 2, 'schemaVersion must be exactly 2')
  push(issues, object(value.identity), 'identity must be an object')
  push(issues, validCalendarDay(value.generatedAt), 'generatedAt must begin with a valid calendar day')

  const requiredArrays = [
    'generatedFrom', 'publishedOriginSheets', 'classifications', 'defaultValues', 'benchmarks',
    'cbamFactors', 'cscf', 'prices', 'thresholds', 'sources',
  ] as const
  for (const name of requiredArrays) push(issues, array(value[name]), `${name} must be an array`)
  if (issues.length > 0) throw new PackValidationError(issues)

  const pack = value as unknown as EstimatorPackV2
  const identity = pack.identity
  push(issues, identity.schemaVersion === 2, 'identity.schemaVersion must be 2')
  push(issues, nonEmpty(identity.id), 'identity.id is required')
  push(issues, nonEmpty(identity.version), 'identity.version is required')
  push(issues, nonEmpty(identity.supersedes), 'identity.supersedes is required')
  push(issues, validCalendarDay(identity.validFrom), 'identity.validFrom must be a valid ISO date')
  push(issues, identity.validTo === null || validCalendarDay(identity.validTo), 'identity.validTo must be null or a valid ISO date')
  push(issues, Array.isArray(identity.regulatoryBasis) && identity.regulatoryBasis.length >= 2,
    'identity.regulatoryBasis must cite the base and correcting instruments')

  const sourceIds = new Set<string>()
  for (const [index, source] of pack.sources.entries()) {
    push(issues, object(source), `sources[${index}] must be an object`)
    if (!object(source)) continue
    push(issues, nonEmpty(source.id), `sources[${index}].id is required`)
    push(issues, nonEmpty(source.title), `sources[${index}].title is required`)
    push(issues, nonEmpty(source.url), `sources[${index}].url is required`)
    push(issues, typeof source.sha256 === 'string' && SHA256.test(source.sha256),
      `sources[${index}].sha256 must be a lowercase SHA-256`)
    push(issues, source.sha256 !== '0'.repeat(64), `sources[${index}].sha256 cannot be a placeholder`)
    push(issues, validCalendarDay(source.retrievedAt), `sources[${index}].retrievedAt must be a valid ISO date`)
    push(issues, nonEmpty(source.locator), `sources[${index}].locator is required`)
    if (typeof source.id === 'string') sourceIds.add(source.id)
  }
  push(issues, sourceIds.size === pack.sources.length, 'source ids must be unique')
  for (const id of identity.regulatoryBasis) {
    push(issues, sourceIds.has(id), `identity.regulatoryBasis references unknown source ${id}`)
  }

  for (const [index, source] of pack.generatedFrom.entries()) {
    push(issues, nonEmpty(source.id), `generatedFrom[${index}].id is required`)
    push(issues, nonEmpty(source.version), `generatedFrom[${index}].version is required`)
    push(issues, SHA256.test(source.packageSha256), `generatedFrom[${index}].packageSha256 is invalid`)
    push(issues, source.workbookSha256 === undefined || SHA256.test(source.workbookSha256),
      `generatedFrom[${index}].workbookSha256 is invalid`)
  }

  const originSheets = new Set(pack.publishedOriginSheets)
  push(issues, originSheets.size === pack.publishedOriginSheets.length, 'publishedOriginSheets contains duplicates')
  for (const origin of originSheets) {
    push(issues, /^[A-Z]{2}$/.test(origin), `published origin ${origin} must be ISO alpha-2`)
  }

  const classifications = new Set<string>()
  for (const [index, row] of pack.classifications.entries()) {
    push(issues, /^\d{4}(?:\d{2}){0,3}$/.test(row.code), `classifications[${index}].code is invalid`)
    push(issues, [4, 6, 8, 10].includes(row.code.length), `classifications[${index}].code has invalid length`)
    push(issues, nonEmpty(row.description), `classifications[${index}].description is required`)
    classifications.add(row.code)
  }
  push(issues, classifications.size === pack.classifications.length, 'classification codes must be unique')

  const valueKeys = new Set<string>()
  const directScopes = new Set<string>()
  for (const [index, row] of pack.defaultValues.entries()) {
    const prefix = `defaultValues[${index}]`
    push(issues, /^\d{4}(?:\d{2}){0,3}$/.test(row.scopeCode), `${prefix}.scopeCode is invalid`)
    push(issues, [4, 6, 8, 10].includes(row.codeLevel) && row.scopeCode.length === row.codeLevel,
      `${prefix}.codeLevel must match scopeCode`)
    push(issues, COUNTRY.test(row.originCountry), `${prefix}.originCountry is invalid`)
    push(issues, row.emissionsType === 'direct' || row.emissionsType === 'indirect', `${prefix}.emissionsType is invalid`)
    push(issues, row.productionRoute === 'default' || /^(?:\([A-Z0-9]+\))+$/.test(row.productionRoute),
      `${prefix}.productionRoute is invalid`)
    push(issues, typeof row.sourceProductionRoute === 'string', `${prefix}.sourceProductionRoute is required`)
    push(issues, Number.isInteger(row.reportingYear) && row.reportingYear >= 2026 && row.reportingYear <= 2028,
      `${prefix}.reportingYear is invalid`)
    push(issues, decimal(row.markupPct), `${prefix}.markupPct must be a non-negative decimal`)
    push(issues, sourceIds.has(row.sourceId), `${prefix}.sourceId references an unknown source`)
    push(issues, nonEmpty(row.sourceLocator), `${prefix}.sourceLocator is required`)

    if (!object(row.cell)) {
      push(issues, false, `${prefix}.cell must be an object`)
    } else if (row.cell.state === 'value') {
      push(issues, decimal(row.cell.baseIntensity), `${prefix}.cell.baseIntensity is invalid`)
      push(issues, row.cell.sourceMarker === 'numeric' || row.cell.sourceMarker === 'literal_zero',
        `${prefix}.cell.sourceMarker is invalid`)
      if (row.cell.sourceMarker === 'literal_zero') {
        push(issues, row.cell.baseIntensity === '0', `${prefix} literal_zero must carry exactly "0"`)
      } else {
        push(issues, row.cell.baseIntensity !== '0', `${prefix} numeric marker cannot carry zero`)
      }
    } else if (row.cell.state === 'unpublished') {
      push(issues, ['dash', 'blank', 'not_applicable'].includes(row.cell.marker), `${prefix}.cell.marker is invalid`)
      push(issues, !('baseIntensity' in row.cell), `${prefix} unpublished cell cannot carry a value`)
    } else if (row.cell.state === 'pointer') {
      push(issues, row.cell.marker === 'see_below', `${prefix} pointer marker must be see_below`)
      push(issues, !('baseIntensity' in row.cell), `${prefix} pointer cell cannot carry a value`)
    } else {
      push(issues, false, `${prefix}.cell.state is invalid`)
    }

    const key = valueSelectorKey(row)
    push(issues, !valueKeys.has(key), `${prefix} duplicates selector ${key}`)
    valueKeys.add(key)
    if (row.emissionsType === 'direct') directScopes.add(row.scopeCode)
  }
  for (const code of classifications) {
    push(issues, [...directScopes].some(scope => code.startsWith(scope)),
      `classification ${code} has no applicable direct-value state`)
  }

  for (const [index, row] of pack.benchmarks.entries()) {
    push(issues, /^\d+$/.test(row.scopeCode) && row.scopeCode.length === row.codeLevel,
      `benchmarks[${index}] has invalid scope/codeLevel`)
    push(issues, decimal(row.bmTco2ePerT), `benchmarks[${index}].bmTco2ePerT is invalid`)
    push(issues, sourceIds.has(row.sourceId), `benchmarks[${index}].sourceId is unknown`)
    push(issues, validCalendarDay(row.validFrom), `benchmarks[${index}].validFrom is invalid`)
    push(issues, row.validTo === null || validCalendarDay(row.validTo), `benchmarks[${index}].validTo is invalid`)
  }
  const benchmarkDuplicates = duplicateKeys(pack.benchmarks,
    row => [row.scopeCode, row.benchmarkColumn, row.routeIndicator, row.validFrom, row.validTo].join('/'))
  push(issues, benchmarkDuplicates.length === 0, `duplicate benchmark selectors: ${benchmarkDuplicates.slice(0, 3).join(', ')}`)

  validateUniqueSeries(issues, pack.cbamFactors, row => String(row.year), 'cbamFactors', sourceIds)
  validateUniqueSeries(issues, pack.cscf, row => String(row.year), 'cscf', sourceIds)
  validateUniqueSeries(issues, pack.prices, row => row.quarter, 'prices', sourceIds)
  validateUniqueSeries(issues, pack.thresholds, row => String(row.calendarYear), 'thresholds', sourceIds)

  for (const [index, row] of pack.cbamFactors.entries()) {
    push(issues, decimal(row.factor), `cbamFactors[${index}].factor is invalid`)
  }
  for (const [index, row] of pack.cscf.entries()) {
    push(issues, row.status === 'pending' || row.status === 'published', `cscf[${index}].status is invalid`)
    push(issues, row.status === 'published' ? decimal(row.value) : row.value === null,
      `cscf[${index}] value/status disagree`)
  }
  for (const [index, row] of pack.prices.entries()) {
    push(issues, /^\d{4}-Q[1-4]$/.test(row.quarter), `prices[${index}].quarter is invalid`)
    push(issues, row.status === 'published' ? decimal(row.priceEur) : row.priceEur === null,
      `prices[${index}] value/status disagree`)
  }
  for (const [index, row] of pack.thresholds.entries()) {
    push(issues, decimal(row.thresholdT), `thresholds[${index}].thresholdT is invalid`)
    push(issues, row.includedSectors.length > 0, `thresholds[${index}].includedSectors is empty`)
  }

  if (issues.length > 0) throw new PackValidationError(issues)
  return pack
}

function validateUniqueSeries<T extends { sourceId: string }>(
  issues: string[],
  rows: readonly T[],
  keyOf: (row: T) => string,
  name: string,
  sourceIds: ReadonlySet<string>,
): void {
  const duplicates = duplicateKeys(rows, keyOf)
  push(issues, duplicates.length === 0, `${name} selectors must be unique: ${duplicates.join(', ')}`)
  for (const [index, row] of rows.entries()) {
    push(issues, sourceIds.has(row.sourceId), `${name}[${index}].sourceId is unknown`)
  }
}

export function valueIndexKey(
  originCountry: string,
  reportingYear: number,
  productionRoute: string,
): string {
  return `${originCountry}\u0000${reportingYear}\u0000${productionRoute}`
}

export function valueSelectorKey(row: DefaultValueRecord): string {
  return [
    row.scopeCode, row.originCountry, row.emissionsType, row.productionRoute, row.reportingYear,
  ].join('\u0000')
}

export function benchmarkIndexKey(column: 'A' | 'B', route: string): string {
  return `${column}\u0000${route}`
}

/** Build read-only-by-convention indexes once after validation. */
export function prepareEstimatorPack(pack: EstimatorPackV2): PreparedEstimatorPack {
  const cached = preparedCache.get(pack)
  if (cached) return cached
  const directBySelector = new Map<string, DefaultValueRecord[]>()
  const indirectBySelector = new Map<string, DefaultValueRecord[]>()
  const reportingYears = new Set<number>()
  for (const row of pack.defaultValues) {
    reportingYears.add(row.reportingYear)
    const target = row.emissionsType === 'direct' ? directBySelector : indirectBySelector
    const key = valueIndexKey(row.originCountry, row.reportingYear, row.productionRoute)
    const rows = target.get(key)
    if (rows) rows.push(row)
    else target.set(key, [row])
  }

  const benchmarksByScope = new Map<string, FreeAllocationTables['benchmarks']>()
  for (const row of pack.benchmarks) {
    const key = benchmarkIndexKey(row.benchmarkColumn, row.routeIndicator)
    const rows = benchmarksByScope.get(key)
    if (rows) rows.push(row)
    else benchmarksByScope.set(key, [row])
  }

  const prepared = {
    source: pack,
    directBySelector,
    indirectBySelector,
    reportingYears,
    benchmarksByScope,
    cbamFactorByYear: uniqueMap(pack.cbamFactors, row => row.year),
    cscfByYear: uniqueMap(pack.cscf, row => row.year),
    priceByQuarter: uniqueMap(pack.prices, row => row.quarter),
    thresholdByYear: uniqueMap(pack.thresholds, row => row.calendarYear),
  }
  preparedCache.set(pack, prepared)
  return prepared
}

function uniqueMap<K, T>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T> {
  return new Map(rows.map(row => [keyOf(row), row]))
}

export function validateAndPrepareEstimatorPack(value: unknown): PreparedEstimatorPack {
  return prepareEstimatorPack(validateEstimatorPack(value))
}
