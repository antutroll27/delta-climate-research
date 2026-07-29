import Decimal from 'decimal.js'

export type ImportCompleteness = 'complete' | 'partial' | 'unknown'
export type ThresholdState = 'above_threshold' | 'below_threshold' | 'indeterminate'

export function evaluateThreshold(input: {
  knownEligibleMassT: string
  completeness: ImportCompleteness
  thresholdT?: string
}): { state: ThresholdState; knownEligibleMassT: string; thresholdT: string } {
  const thresholdT = input.thresholdT ?? '50'
  const above = new Decimal(input.knownEligibleMassT).gt(thresholdT)
  return {
    state: above
      ? 'above_threshold'
      : input.completeness === 'complete'
        ? 'below_threshold'
        : 'indeterminate',
    knownEligibleMassT: input.knownEligibleMassT,
    thresholdT,
  }
}
