import { areaKeysInCity, isDrawable, nextDistinctKey, splitKey, type AreaKey } from '../scope/registry.ts';
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

/** Can the instrument draw this area? Dubai's areas are registered but not drawable. */
const drawable = (key: AreaKey): boolean => {
  const { country, city, area } = splitKey(key);
  return isDrawable(country, city, area);
};

// drawable(b) here and .filter(drawable) below are defensive: no registered city mixes
// drawable and undrawable areas today, so no test can observe them. They matter the day one does.
/** Is `b` a valid partner for `a`: drawable, in a's own city, and not a itself? */
const pairsWith = (a: AreaKey, b: AreaKey): boolean =>
  b !== a && drawable(b) && areaKeysInCity(a).includes(b);

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
 * by a value that is neither a key nor a known alias, or names an area the
 * instrument cannot draw.
 *
 * `b` MUST SHARE a's CITY. The ward page's Compare link carries only `a`, and this
 * used to fill a missing `b` with DEFAULT.b — a Kolkata ward — whatever the city, so
 * every Bengaluru ward opened a cross-city pair that fails the grid check (2026-09-23
 * audit, item 2). A given `b` is kept only if it pairs with `a`. A `b` that repeats
 * `a` falls to the first other area in a's city, as it always did, though only a
 * drawable one now qualifies; any other missing or unusable `b` takes DEFAULT.b if
 * THAT pairs with `a`, else that same first other area. Together these keep every
 * existing Kolkata link byte-identical. Null there (a city of one drawable area)
 * yields a === b, which `runPairedScenarioCore` refuses BY NAME rather than
 * papering over.
 */
export function parsePairedScenario(search: string): PairedScenarioState {
  const params = new URLSearchParams(search);
  const parsedA = fromLegacyWard(params.get('a'));
  const a = parsedA !== null && drawable(parsedA) ? parsedA : DEFAULT_PAIRED_SCENARIO.a;
  const parsedB = fromLegacyWard(params.get('b'));
  const b = parsedB !== null && pairsWith(a, parsedB) ? parsedB
    : parsedB !== a && pairsWith(a, DEFAULT_PAIRED_SCENARIO.b) ? DEFAULT_PAIRED_SCENARIO.b
    : (nextDistinctKey(areaKeysInCity(a).filter(drawable), a) ?? a);
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
