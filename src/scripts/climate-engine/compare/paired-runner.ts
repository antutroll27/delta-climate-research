import { createPairedScenarioCache, runPairedScenarioCore } from './paired-core.ts';
import type { PairedScenarioState } from '../scenario/scenario-state.ts';

export type {
  MetricValue,
  PairedBackendVersion,
  PairedResult,
  ReleaseEvidence,
  WardScenarioResult,
} from './paired-protocol.ts';

/**
 * Emergency direct path. Browser callers load this module only if the paired worker
 * is unavailable; it still yields every bounded solver slice.
 */
export async function runPairedScenario(state: PairedScenarioState, signal?: AbortSignal) {
  return runPairedScenarioCore(state, createPairedScenarioCache(), {
    signal,
    backendVersion: 'ts-main-cooperative-v1',
  });
}
