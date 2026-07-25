import { isWardId, nextDistinctWard } from '../wards.ts';
import {
  DEFAULT_PAIRED_SCENARIO,
  normalizeCoverage,
  type PairedScenarioState,
} from './scenario-state.ts';

const numeric = (params: URLSearchParams, key: string, fallback: number) => {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

export function parsePairedScenario(search: string): PairedScenarioState {
  const params = new URLSearchParams(search);
  const requestedA = params.get('a');
  const requestedB = params.get('b');
  const a = isWardId(requestedA) ? requestedA : DEFAULT_PAIRED_SCENARIO.a;
  const bCandidate = isWardId(requestedB) ? requestedB : DEFAULT_PAIRED_SCENARIO.b;
  const b = bCandidate === a ? nextDistinctWard(a) : bCandidate;
  const phase = params.get('phase') === 'retained' ? 'retained' : 'peak';
  return {
    a,
    b,
    coverage: normalizeCoverage({
      trees: numeric(params, 'trees', DEFAULT_PAIRED_SCENARIO.coverage.trees),
      roofs: numeric(params, 'roof', DEFAULT_PAIRED_SCENARIO.coverage.roofs),
      parks: numeric(params, 'parks', DEFAULT_PAIRED_SCENARIO.coverage.parks),
      facades: numeric(params, 'facades', DEFAULT_PAIRED_SCENARIO.coverage.facades),
    }),
    phase,
    contract: 'paired-coverage-v1',
    forcing: params.get('forcing') || DEFAULT_PAIRED_SCENARIO.forcing,
  };
}

export function serializePairedScenario(state: PairedScenarioState): string {
  const params = new URLSearchParams({
    a: state.a,
    b: state.b,
    trees: String(state.coverage.trees),
    roof: String(state.coverage.roofs),
    parks: String(state.coverage.parks),
    facades: String(state.coverage.facades),
    phase: state.phase,
    contract: state.contract,
    forcing: state.forcing,
    grid: 'hm-grid-192-v1',
    data: 'ward-geometry-v1',
    stock: 'modelled-stock-v1',
    backend: 'ts-v1',
  });
  return params.toString();
}
