/**
 * PREFETCH THE CITY'S OTHER WARDS ONCE THE FIRST HAS LOADED.
 *
 * Measured on production under Slow 4G: switching back to a ward already visited
 * took 393 ms; to one not yet visited, 2,238 and 2,176 ms. The difference is the
 * first download. Every ward file loads through a plain fetch — the ward JSON,
 * the GLB and the surface PNG alike — so fetching the same URLs in the background
 * warms exactly the cache a switch reads, and the switch takes the revisit path.
 *
 * The cost is data the reader may never use (about 1.5-1.9 MB per Bengaluru
 * visit), so this backs off for Save-Data and 2G, fetches one ward at a time, and
 * is aborted the moment a real ward load begins.
 *
 * Three-free on purpose, and pinned by heat-explore-module-boundary.test.mjs: the
 * model URL comes from scope/paths.ts, never from the explore model loader.
 */
import { areaKeysInCity, splitKey, type AreaKey } from './scope/registry.ts';
import { modelPath, paths } from './scope/paths.ts';

export interface PrefetchConnection {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

/** False on Save-Data, or on a connection too slow to spend data on a guess. */
export function shouldPrefetch(connection: PrefetchConnection | undefined): boolean {
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
}

/** One URL list per other ward in the city: the files a switch to that ward fetches. */
export function prefetchPlan(key: AreaKey): string[][] {
  return areaKeysInCity(key)
    .filter((sibling) => sibling !== key)
    .flatMap((sibling): string[][] => {
      const p = paths(sibling);
      if (p === null) return [];
      /* The same files a switch fetches for a ward, so every one of them is warm:
         loadWard's JSON, surface-raster's two PNGs, and the layers manifest that
         renderSources (heat-map-app.ts) re-reads on every switch. */
      const urls = [p.ward, p.terrain, p.water, p.roads, p.labels, p.provenance,
        p.trees, p.surface, p.canopy, p.layers, p.pv];
      const model = modelPath(splitKey(sibling).area);
      return [model === null ? urls : [...urls, model]];
    });
}

/** Fetch ward by ward, each ward's files together. Resolves with how many completed. */
export async function runPrefetch(plan: readonly (readonly string[])[], fetchImpl: typeof fetch,
  signal: AbortSignal): Promise<number> {
  let fetched = 0;
  for (const urls of plan) {
    if (signal.aborted) break;
    const results = await Promise.allSettled(urls.map(async (url) => {
      const response = await fetchImpl(url, { signal, priority: 'low' } as RequestInit);
      /* READ THE BODY. An unread response can leave the cache entry incomplete, and a
         half-warmed cache is the one outcome worse than not prefetching at all. */
      await response.arrayBuffer();
    }));
    fetched += results.filter((result) => result.status === 'fulfilled').length;
  }
  return fetched;
}
