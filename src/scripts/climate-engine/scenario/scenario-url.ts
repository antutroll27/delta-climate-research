import { wardById } from '../../../data/wards.ts';
import { gridVersion } from '../types.ts';
import { isWardId, nextDistinctWard } from '../wards.ts';
import {
  DEFAULT_PAIRED_SCENARIO,
  normalizeCoverage,
  type PairedScenarioState,
} from './scenario-state.ts';

/**
 * The wards `parsePairedScenario` FALLS BACK TO must themselves be published.
 *
 * The requested ward is gated by `isWardId` below; the default it falls back to
 * was not, so an unpublished default would sail straight through the guard that
 * exists to stop exactly this — and put a 404 behind Compare's OPENING view,
 * before the reader has touched a control.
 *
 * Inert while both defaults are Kolkata wards. THE EVENT THAT MAKES IT LIVE IS
 * PUBLISHING A SECOND CITY, because that is when `PUBLISHED_CITIES` and this
 * literal pair can disagree. Same trade `nextDistinctWard` makes in
 * climate-engine/wards.ts: fail at module load, naming the constant to fix,
 * rather than in a visitor's browser.
 *
 * Exported so the refusal can be exercised with a ward that is NOT published —
 * a module-load assertion that only ever runs on good input is not a gate.
 */
export function assertDefaultScenarioPublished(
  scenario: Pick<PairedScenarioState, 'a' | 'b'> = DEFAULT_PAIRED_SCENARIO,
): void {
  for (const side of ['a', 'b'] as const) {
    const ward = scenario[side];
    if (!isWardId(ward)) {
      throw new RangeError(
        `DEFAULT_PAIRED_SCENARIO.${side} names "${ward}", which is not a published ward, `
        + 'so Compare would open on artefacts that 404. Fix DEFAULT_PAIRED_SCENARIO in '
        + 'scenario-state.ts, or PUBLISHED_CITIES in src/data/wards.ts.',
      );
    }
  }
}

assertDefaultScenarioPublished();

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
      // parks is retired — normalizeCoverage pins it to 0, so any legacy
      // ?parks= value in an old link is ignored rather than silently applied.
      facades: numeric(params, 'facades', DEFAULT_PAIRED_SCENARIO.coverage.facades),
    }),
    phase,
    contract: 'paired-coverage-v1',
    forcing: params.get('forcing') || DEFAULT_PAIRED_SCENARIO.forcing,
  };
}

export function serializePairedScenario(state: PairedScenarioState): string {
  /* The grid stamp comes from A's ward, not from a literal — the same ward
     `assertPairedResult` sizes the pair against. One stamp stays truthful for a
     two-ward link because a pair whose wards disagree on grid is refused there.
     An unidentifiable ward omits the stamp rather than asserting a grid it
     cannot know; `parsePairedScenario` never reads this back, so a missing
     stamp costs a reader provenance, while a wrong one would mislabel a run. */
  const wardA = wardById(state.a);
  const params = new URLSearchParams({
    a: state.a,
    b: state.b,
    trees: String(state.coverage.trees),
    roof: String(state.coverage.roofs),
    facades: String(state.coverage.facades),
    phase: state.phase,
    contract: state.contract,
    forcing: state.forcing,
    ...(wardA ? { grid: gridVersion(wardA.footprintM) } : {}),
    data: 'ward-geometry-v1',
    stock: 'modelled-stock-v1',
    backend: 'ts-v1',
  });
  return params.toString();
}
