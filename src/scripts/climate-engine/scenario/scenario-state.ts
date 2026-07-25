import type { WardId } from '../wards.ts';

export type ComparePhase = 'peak' | 'retained';

export interface CoverageScenario {
  /** Percent of ranked modelled corridor cells. */
  trees: number;
  /** Percent of modelled roof stock. */
  roofs: number;
  /**
   * Planted-area share of the 196 ha study window.
   * Retired from Compare: pinned to 0 so the paired result cannot carry a lever
   * the interface does not expose. The coverage maths stays intact for the day
   * the control returns.
   */
  parks: number;
  /** Percent of modelled façade programme intensity. */
  facades: number;
}

export interface PairedScenarioState {
  a: WardId;
  b: WardId;
  coverage: CoverageScenario;
  phase: ComparePhase;
  contract: 'paired-coverage-v1';
  forcing: string;
}

export const ILLUSTRATIVE_COVERAGE: CoverageScenario = {
  trees: 55,
  roofs: 65,
  parks: 0,
  facades: 35,
};

export const DEFAULT_PAIRED_SCENARIO: PairedScenarioState = {
  a: 'ballygunge',
  b: 'baruipur',
  coverage: ILLUSTRATIVE_COVERAGE,
  phase: 'peak',
  contract: 'paired-coverage-v1',
  forcing: 'delta-screening-reference-v1',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const quantize = (value: number, step: number) => Math.round(value / step) * step;

export function normalizeCoverage(input: Partial<CoverageScenario>): CoverageScenario {
  return {
    trees: quantize(clamp(Number(input.trees ?? ILLUSTRATIVE_COVERAGE.trees), 0, 100), 1),
    roofs: quantize(clamp(Number(input.roofs ?? ILLUSTRATIVE_COVERAGE.roofs), 0, 100), 5),
    // parks is retired from Compare — force 0 so a stale ?parks= link cannot
    // apply an intervention with no visible control.
    parks: 0,
    facades: Number(quantize(clamp(Number(input.facades ?? ILLUSTRATIVE_COVERAGE.facades), 0, 100), 0.1).toFixed(1)),
  };
}

export function zeroCoverage(): CoverageScenario {
  return { trees: 0, roofs: 0, parks: 0, facades: 0 };
}

export function coverageIsZero(coverage: CoverageScenario): boolean {
  return coverage.trees === 0 && coverage.roofs === 0 && coverage.parks === 0 && coverage.facades === 0;
}
