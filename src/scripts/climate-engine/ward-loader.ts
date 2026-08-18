import type { RoadsData, WardData, WaterData } from './heat-map-model.ts';
import type { WardId } from './wards.ts';

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

const cache = new Map<WardId, Promise<LoadedWard>>();

async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`);
  return response.json() as Promise<T>;
}

export function loadWard(id: WardId, signal?: AbortSignal): Promise<LoadedWard> {
  if (!signal && cache.has(id)) return cache.get(id)!;
  const load = Promise.all([
    json<WardData>(`/heat-map/data/${id}.json`, signal),
    json<RoadsData>(`/heat-map/data/${id}-roads.json`, signal).catch(() => ({ ways: [] })),
    json<WaterData>(`/heat-map/data/${id}-water.json`, signal).catch(() => ({ polys: [] })),
  ]).then(([ward, roads, water]) => ({ ward, roads, water }));
  if (!signal) cache.set(id, load);
  return load;
}
