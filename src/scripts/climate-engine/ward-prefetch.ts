/**
 * PREFETCH THE CITY'S OTHER WARDS ONCE THE FIRST HAS LOADED.
 *
 * Measured on production (Kolkata wards) under Slow 4G: switching back to a ward
 * already visited took 393 ms; to one not yet visited, 2,238 and 2,176 ms.
 *
 * WHAT THIS BUYS, AND WHAT IT DOES NOT. Every ward file loads through a plain
 * fetch, so fetching the same URLs in the background puts their bodies in the HTTP
 * cache. The deployment sends `max-age=0, must-revalidate`, so a prefetched switch
 * still revalidates each file, but gets 304s with no body (measured in Chrome). It
 * does NOT take the 393 ms revisit path: a revisit is served from loadWard's
 * in-memory caches with no request and no parse, while a prefetched first visit
 * still parses and decodes everything.
 *
 * The cost is data the reader may never use: two sibling wards, about 3.4-4.0 MB
 * raw per Bengaluru visit. So this backs off for Save-Data and 2G, fetches one ward
 * at a time, and is aborted the moment a real ward load begins.
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

/** Fetch ward by ward, each ward's files together, until done or aborted. Never rejects. */
export async function runPrefetch(plan: readonly (readonly string[])[], fetchImpl: typeof fetch,
  signal: AbortSignal): Promise<void> {
  for (const urls of plan) {
    if (signal.aborted) break;
    await Promise.allSettled(urls.map(async (url) => {
      const response = await fetchImpl(url, { signal, priority: 'low' });
      /* READ THE BODY. Chrome caches an unread body anyway (measured), but that is an
         engine detail; reading it is what guarantees a complete entry everywhere. */
      await response.arrayBuffer();
    }));
  }
}
