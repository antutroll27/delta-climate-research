export const domainErrorCodes = [
  'REGULATION_NOT_FOUND',
  'REGULATION_AMBIGUOUS',
  'EVIDENCE_CHAIN_INVALID',
  'CAPABILITY_REQUIRED',
  'SEPARATION_OF_DUTIES',
  'RESERVATION_EXPIRED',
  'RESERVATION_CONFLICT',
  'THRESHOLD_BELOW',
  'THRESHOLD_INDETERMINATE',
  'SNAPSHOT_STALE',
  'SNAPSHOT_ALREADY_APPROVED',
  'SUPERSESSION_REQUIRED',
  'FORBIDDEN_OR_NOT_FOUND',
] as const

export type DomainErrorCode = typeof domainErrorCodes[number]
export type SafeDetails = Readonly<Record<
  string,
  string | number | boolean | readonly string[]
>>

export class DomainError extends Error {
  readonly name = 'DomainError'

  constructor(
    readonly code: DomainErrorCode,
    readonly details: SafeDetails = {},
    cause?: unknown,
  ) {
    super(code, cause instanceof Error ? { cause } : undefined)
  }

  toJSON() {
    return { error: this.code, details: this.details }
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError
}
