import type { RoadsData, WardData, WaterData } from './heat-map-model.ts';
import type { WardId } from './wards.ts';

export interface LoadedWard {
  ward: WardData;
  roads: RoadsData;
  /** OSM open water. In the SOLVE since 2026-08-13 (rasterizeWardWater), not just
   *  the scene — so Compare must load it or it would score a different ward from
   *  the one the map draws. Absent degrades to no water, never to a rejection. */
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
