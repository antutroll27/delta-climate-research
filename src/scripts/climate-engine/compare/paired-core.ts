import { runTsFieldCooperatively, type CooperativeFieldRequest } from '../sim-cooperative.ts';
import { CANONICAL_GRID_N, CANONICAL_GRID_VERSION, HEAT_METRICS_VERSION, greenReferenceContrastC, type SimLayers, type SimParams, type SimStats } from '../types.ts';
import { applyInterventions, buildSpatial, computeCost, currentParamsForReference, RESET_BURST, type Ambient, type RoadsData, type Spatial, type WardData } from '../heat-map-model.ts';
import { loadArea } from '../ward-loader.ts';
import { rasterWardBase } from '../ward-raster.ts';
import { loadAreaSurface } from '../surface-raster.ts';
import type { AreaKey } from '../scope/registry.ts';
import { coverageToInterventions, deliveredQuantities } from '../scenario/coverage.ts';
import type { PairedScenarioState } from '../scenario/scenario-state.ts';
import { SimulationCancelled } from '../sim-cooperative.ts';
import { assertPairedResult, type MetricValue, type PairedBackendVersion, type PairedJobStage, type PairedResult, type ReleaseEvidence, type WardScenarioResult } from './paired-protocol.ts';
import { resolveReferenceForcing, type CompareReferenceForcing } from './reference-forcing.ts';
import { resolve, requireCosts } from '../scope/resolve.ts';

/* ────────────────────────────────────────────────────────────────────────────
   THE SCOPE COMPARE RUNS IN — the city's park-cooling radius and the country's
   unit costs. NOT A DECLARATION ANY MORE, which is the note.

   Two module-level constants stood here: `CLIMATE` and `COSTS`, both
   `resolve('in/kolkata/ballygunge')`. Task 5 wrote them and said Task 7 would make
   them derive; this is that, and the pin could not have survived the migration
   honestly. `PairedScenarioState` used to carry two `WardId`s, so hard-coding
   Kolkata restated a constraint the types already imposed. It carries two
   `AreaKey`s now, which can name any registered city — and a pinned scope would
   have gone on applying Kolkata's 50 m cooling radius and rupee prices to whatever
   else was on screen, computing cleanly the whole way and printing a plausible
   number. That is the failure mode this codebase keeps paying for.

   So each side of the comparison resolves its OWN scope, in `runWard`, where the
   area is known. `requireCosts` therefore runs per area rather than at module load
   — a country with no adopted cost basis now fails when that country is asked for,
   with a message naming it, rather than at import for everyone.

   `currentParamsForReference` is deliberately NOT given a scope. It takes an
   explicit `Ambient` from a named forcing record, so it reads neither the fallback
   air temperature nor the warming table — the two constants a scope would supply
   it. Adding a parameter it does not read would be a decoration that later readers
   would have to disprove.
   ──────────────────────────────────────────────────────────────────────────── */

interface PreparedWard {
  wardData: WardData;
  roads: RoadsData;
  base: SimLayers;
  spatial: Spatial;
}

interface FieldResult { field: Float32Array; stats: SimStats; }
interface BaselineResult { stats: SimStats; }

export interface PairedRunOptions {
  signal?: AbortSignal;
  backendVersion: PairedBackendVersion;
  onStage?: (stage: PairedJobStage) => void;
  isCancelled?: () => boolean;
  nowIso?: () => string;
  runField?: (request: CooperativeFieldRequest) => Promise<FieldResult>;
}

/**
 * Cache the IN-FLIGHT promise (that de-duplication is the whole point) but never
 * cache a rejection.
 *
 * Without this, one superseded run — a slider dragged during Compare's first
 * seconds is enough — poisons its key for the lifetime of the worker: every
 * later caller is handed the same settled rejection, the solver is never
 * re-entered, the spinner clears with no error, the evidence cells stay at "—",
 * and Retry is inert because it re-enters the poisoned key. Compare is silently
 * dead for the session.
 *
 * The identity guard matters: by the time a rejection settles, a newer attempt
 * may already own the key, and deleting blindly would evict a healthy entry.
 */
function evictOnRejection<K, V>(cache: Map<K, Promise<V>>, key: K, pending: Promise<V>): void {
  pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
}

/** Worker-lifetime caches. Scenario fields intentionally never enter this cache. */
export interface PairedScenarioCache {
  /** Ward geometry, raster and spatial index, de-duplicated per area. */
  ward(id: AreaKey): Promise<PreparedWard>;
  /** The reference solve for a ward/forcing/phase key, de-duplicated while in flight
   *  and evicted if it rejects — see evictOnRejection. */
  baseline(key: string, create: () => Promise<FieldResult>): Promise<BaselineResult>;
  clear(): void;
}

export function createPairedScenarioCache(): PairedScenarioCache {
  const prepared = new Map<AreaKey, Promise<PreparedWard>>();
  const baselines = new Map<string, Promise<BaselineResult>>();

  return {
    async ward(id) {
      const cached = prepared.get(id);
      if (cached) return cached;
      const pending = (async () => {
        const [loaded, surface] = await Promise.all([loadArea(id), loadAreaSurface(id)]);
        const base = rasterWardBase(loaded.ward, surface.means, surface.surface, null, loaded.water);
        return { wardData: loaded.ward, roads: loaded.roads, base, spatial: buildSpatial(loaded.ward, base, loaded.roads) };
      })();
      prepared.set(id, pending);
      evictOnRejection(prepared, id, pending);
      return pending;
    },

    baseline(key, create) {
      const cached = baselines.get(key);
      if (cached) return cached;
      // Baseline fields are not rendered. Retaining only statistics keeps the
      // worker cache bounded while preserving the exact comparison evidence.
      const pending = create().then(({ stats }) => ({ stats }));
      baselines.set(key, pending);
      evictOnRejection(baselines, key, pending);
      return pending;
    },

    clear() {
      prepared.clear();
      baselines.clear();
    },
  };
}

function assertNotCancelled(options: PairedRunOptions): void {
  if (options.signal?.aborted || options.isCancelled?.()) throw new SimulationCancelled();
}

function hotMetric(value: number, phase: PairedScenarioState['phase']): MetricValue {
  return phase === 'peak'
    ? { state: 'evaluated', value: value * 100, unit: 'percent' }
    : { state: 'not-evaluated', reason: 'The retained phase does not evaluate the >40°C threshold.' };
}

function baselineKey(id: AreaKey, forcing: CompareReferenceForcing, phase: PairedScenarioState['phase']): string {
  return [id, forcing.id, phase, 'heat-model-v1', CANONICAL_GRID_VERSION].join(':');
}

async function field(layers: SimLayers, params: SimParams, sizeM: number, options: PairedRunOptions): Promise<FieldResult> {
  return (options.runField ?? runTsFieldCooperatively)({
    grid: { n: CANONICAL_GRID_N, cellMeters: sizeM / CANONICAL_GRID_N },
    layers,
    params,
    steps: RESET_BURST,
    thresholdC: 40,
    signal: options.signal,
    isCancelled: options.isCancelled,
  });
}

async function runWard(
  id: AreaKey,
  prepared: PreparedWard,
  state: PairedScenarioState,
  forcing: CompareReferenceForcing,
  cache: PairedScenarioCache,
  options: PairedRunOptions,
): Promise<WardScenarioResult> {
  assertNotCancelled(options);
  /* THIS area's scope, not the page's. See the header: a comparison can now name
     two cities, and a shared radius or a shared currency would be applied to both
     without a word. */
  const scope = resolve(id);
  const costs = requireCosts(scope);
  const interventions = coverageToInterventions(state.coverage);
  const phase = state.phase === 'peak' ? 'peak' : 'night';
  const forcingValues: Ambient = forcing.values[state.phase];
  const baselineParams = currentParamsForReference(forcingValues, phase, { trees: 0, roof: 0, parks: 0, facades: 0 });
  const scenarioParams = currentParamsForReference(forcingValues, phase, interventions);
  options.onStage?.('solving-baselines');
  const baseline = await cache.baseline(baselineKey(id, forcing, state.phase), () => field(prepared.base, baselineParams, prepared.wardData.sizeM, options));
  assertNotCancelled(options);
  options.onStage?.('solving-scenarios');
  const scenarioLayers = applyInterventions(prepared.base, interventions, prepared.spatial, scope.climate.parkRadiusM);
  const scenario = await field(scenarioLayers, scenarioParams, prepared.wardData.sizeM, options);
  assertNotCancelled(options);
  const baselineHot = hotMetric(baseline.stats.fracAbove, state.phase);
  const scenarioHot = hotMetric(scenario.stats.fracAbove, state.phase);
  const hotAreaChange = baselineHot.state === 'evaluated' && scenarioHot.state === 'evaluated'
    ? { state: 'evaluated' as const, value: scenarioHot.value - baselineHot.value, unit: 'percentage-points' as const }
    : { state: 'not-evaluated' as const, reason: 'The retained phase does not evaluate hot-area change.' };
  const evidence: ReleaseEvidence = {
    forcingId: forcing.id,
    forcingStatus: forcing.status,
    modelVersion: 'heat-model-v1',
    gridVersion: CANONICAL_GRID_VERSION,
    dataVersion: 'ward-geometry-v1',
    stockBasis: 'modelled-stock-v1',
    backendVersion: options.backendVersion,
    metricsVersion: HEAT_METRICS_VERSION,
    screening: true,
  };
  return {
    ward: id,
    wardData: prepared.wardData,
    roads: prepared.roads,
    field: scenario.field,
    baselineMeanC: baseline.stats.meanC,
    scenarioMeanC: scenario.stats.meanC,
    coolingC: baseline.stats.meanC - scenario.stats.meanC,
    baselineHotAreaPct: baselineHot,
    scenarioHotAreaPct: scenarioHot,
    hotAreaChangePp: hotAreaChange,
    greenReferenceContrastC: greenReferenceContrastC(scenario.stats.meanC, scenarioParams),
    capitalCost: computeCost(interventions, prepared.spatial, costs),
    delivered: deliveredQuantities(state.coverage, prepared.spatial),
    evidence,
  };
}

export async function runPairedScenarioCore(state: PairedScenarioState, cache: PairedScenarioCache, options: PairedRunOptions): Promise<PairedResult> {
  if (state.a === state.b) throw new Error('A valid comparison requires two distinct wards.');
  const forcing = resolveReferenceForcing(state.forcing);
  if (!forcing) throw new Error('The requested reference forcing record is unavailable.');
  assertNotCancelled(options);
  options.onStage?.('loading-inputs');
  const [preparedA, preparedB] = await Promise.all([cache.ward(state.a), cache.ward(state.b)]);
  assertNotCancelled(options);
  options.onStage?.('preparing-wards');
  const a = await runWard(state.a, preparedA, state, forcing, cache, options);
  const b = await runWard(state.b, preparedB, state, forcing, cache, options);
  assertNotCancelled(options);
  options.onStage?.('assembling-evidence');
  const result: PairedResult = {
    a,
    b,
    forcing,
    settledAt: (options.nowIso ?? (() => new Date().toISOString()))(),
    contract: 'paired-coverage-v1',
  };
  assertPairedResult(result);
  return result;
}
