import type { RoadsData, WardData, WaterData } from './heat-map-model.ts';
import { paths } from './scope/paths.ts';
import type { AreaKey } from './scope/registry.ts';

export interface LoadedWard {
  ward: WardData;
  roads: RoadsData;
  /** OSM open water, loaded so Compare scores the same ward the map draws.
   *
   *  NOT IN THE SOLVE. `WATER_LAYER_ENABLED` is false, so `rasterWardBase` discards
   *  this and hands the solver zeros — feeding it was measured and made agreement
   *  with ECOSTRESS worse (known-limitations.md §7). It is still fetched, and
   *  deliberately not gated here: the flag is the ONE place that decision lives, and
   *  a second copy in the loader is how the two drift apart the day someone flips it.
   *  The cost of being wrong in this direction is 1.5–9 KB of cached JSON per ward;
   *  the cost of the other is Compare silently scoring a ward with no water in it.
   *
   *  Absent degrades to no water, never to a rejection. */
  water: WaterData;
}

/* Keyed by AREA KEY, not by bare id, and that is the only shape written or read
   here. A cache written under one shape and read under another never hits: it
   re-fetches for ever, silently, and looks exactly like a cache that is working. */
const cache = new Map<AreaKey, Promise<LoadedWard>>();

async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`);
  return response.json() as Promise<T>;
}

/**
 * Every artefact one area needs, from `scope/paths.ts` and nowhere else.
 *
 * TWO OF THE THREE FETCHES SWALLOW THEIR FAILURE, because an area may legitimately
 * have no roads and no water — so a mis-built URL here would not throw, it would
 * hand back an empty ward that renders and scores as though the ground were bare.
 * That is why the URLs are no longer interpolated: the id is hierarchical now, and
 * `/heat-map/data/in/kolkata/ballygunge-water.json` 404s into `{ polys: [] }`
 * without a word.
 *
 * AN AREA THAT SHIPS NOTHING IS REJECTED, NOT FETCHED. `paths()` returns null for
 * Dubai, and a null here means the registry says there is no artefact to ask for —
 * firing three requests that are guaranteed to 404 would put the half-rendered
 * city back on screen, which is the state this whole seam exists to make
 * unreachable. The rejection is deliberately NOT cached: it is an authoring fault,
 * not a transient one, and a cached rejection would outlive the fix.
 */
export function loadArea(key: AreaKey, signal?: AbortSignal): Promise<LoadedWard> {
  if (!signal && cache.has(key)) return cache.get(key)!;
  const p = paths(key);
  if (p === null) {
    return Promise.reject(new Error(
      `ward-loader: "${key}" ships no artefacts, so there is nothing to load. `
      + 'Fetching anyway would 404 into an empty ward that still renders'));
  }
  const load = Promise.all([
    json<WardData>(p.ward, signal),
    json<RoadsData>(p.roads, signal).catch(() => ({ ways: [] })),
    json<WaterData>(p.water, signal).catch(() => ({ polys: [] })),
  ]).then(([ward, roads, water]) => ({ ward, roads, water }));
  if (!signal) cache.set(key, load);
  return load;
}
