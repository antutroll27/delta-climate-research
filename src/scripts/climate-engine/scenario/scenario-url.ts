import { nextDistinctArea } from '../scope/registry.ts';
import { fromLegacyWard, toLegacyWard } from '../scope/legacy.ts';
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

/**
 * A shared Compare link → the state it names.
 *
 * `a` AND `b` ARRIVE IN EITHER SPELLING. Every link already in the world says
 * `?a=ballygunge`; the state is now an `AreaKey`. `fromLegacyWard` accepts both and
 * maps them to the same area, so a bookmark keeps addressing the ground it always
 * did. Reaching for `isAreaKey` here instead would have been the quiet disaster:
 * every legacy link would still have LOADED, and shown a different pair.
 *
 * The fallback to the default is deliberate and unchanged in shape — a Compare page
 * that refuses to render on a mistyped id helps nobody — but it is now reached only
 * by a value that is neither a key nor a known alias.
 */
export function parsePairedScenario(search: string): PairedScenarioState {
  const params = new URLSearchParams(search);
  const a = fromLegacyWard(params.get('a')) ?? DEFAULT_PAIRED_SCENARIO.a;
  const bCandidate = fromLegacyWard(params.get('b')) ?? DEFAULT_PAIRED_SCENARIO.b;
  /* Falls back WITHIN a's own city, never to the default pair: `DEFAULT.b` is a
     Kolkata ward, and handing it to a request for some other city would answer with
     a cross-city comparison — two climates, two currencies, one of them shipping no
     artefacts. Null (a city of one area) yields a === b, which
     `runPairedScenarioCore` refuses BY NAME rather than papering over. */
  const b = bCandidate === a ? (nextDistinctArea(a) ?? a) : bCandidate;
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

/**
 * The state → the link. Emits the LEGACY spelling wherever one exists, so a link
 * written today and one bookmarked before the scope migration are the same string —
 * see `toLegacyWard`, which owns that decision for the writer and the reader alike.
 */
export function serializePairedScenario(state: PairedScenarioState): string {
  const params = new URLSearchParams({
    a: toLegacyWard(state.a),
    b: toLegacyWard(state.b),
    trees: String(state.coverage.trees),
    roof: String(state.coverage.roofs),
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
