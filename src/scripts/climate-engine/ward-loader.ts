import type { RoadsData, WardData } from './heat-map-model.ts';
import type { WardId } from './wards.ts';

export interface LoadedWard {
  ward: WardData;
  roads: RoadsData;
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
  ]).then(([ward, roads]) => ({ ward, roads }));
  if (!signal) cache.set(id, load);
  return load;
}
