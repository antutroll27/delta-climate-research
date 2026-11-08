/**
 * halo-sim-host.ts — a HeatSimHost that solves a 2,800 m sheet on its 3,675 m halo grid and answers on the sheet's own.
 *
 * heat-map-app.ts drives one `HeatSimHost` (the GPU solver, the CPU worker, or the static fallback) with 384-cell requests
 * and reads 384-cell snapshots. A streamed sheet must be SOLVED on 504 cells, its 384-cell core plus a 60-cell ring of
 * the neighbours' real ground (halo-solve.ts), and DISPLAYED and COUNTED on the core alone. This adapter is that seam:
 * the page keeps asking for its own sheet and never sees the ring.
 *
 *   reset(384-cell request)
 *     -> assemble the 504-cell layers from the request's layers (the core, with any scenario already applied) and the
 *        neighbours' baseline layers (`supply`, null = none loaded yet: every edge then reflects)
 *     -> inner.reset({ 504 cells, 3,675 m, those layers })
 *     -> snapshot: the field cropped to the core, the statistics taken over the core only (`coreStats`, never `sim.stats()`
 *        of the 504-cell grid, which would count every ring cell twice across a seam), the sheet's own grid version.
 *
 * A request that is not a sheet's (any other size) passes straight through, so Kolkata and Bengaluru are untouched even if
 * this adapter were wired in front of them.
 */
import { gridFor } from '../types.ts';
import type { HeatSimHost, HeatSimRequest, HeatSimSnapshot } from '../sim-protocol.ts';
import {
  SHEET_HALO, assembleHaloLayers, coreStats, extractCore, haloGridSpec,
  type HaloGeometry, type NeighbourLayers,
} from './halo-solve.ts';

const SHEET_SIZE_M = 2_800;

/** The neighbours' baseline layers around the sheet being solved, or null while none are known. */
export type HaloSupply = () => NeighbourLayers | null;

/** A sheet's own request: the 2,800 m square on its 384-cell grid. */
export function isSheetRequest(request: HeatSimRequest, g: HaloGeometry = SHEET_HALO): boolean {
  return request.sizeM === SHEET_SIZE_M && request.grid.n === g.coreN;
}

export function createHaloSimHost(inner: HeatSimHost, supply: HaloSupply, g: HaloGeometry = SHEET_HALO): HeatSimHost {
  let thresholdC = 40;
  let wrapping = false;

  const core = (snapshot: HeatSimSnapshot): HeatSimSnapshot => ({
    generation: snapshot.generation,
    backend: snapshot.backend,
    field: extractCore(g, snapshot.field),
    stats: coreStats(g, snapshot.field, thresholdC),
    gridVersion: gridFor(SHEET_SIZE_M)!.version,
  });

  return {
    get backend() { return inner.backend; },
    async reset(request: HeatSimRequest): Promise<HeatSimSnapshot> {
      if (!isSheetRequest(request, g)) { wrapping = false; return inner.reset(request); }
      wrapping = true;
      thresholdC = request.thresholdC;
      const { layers } = assembleHaloLayers(g, request.layers, supply() ?? {});
      const spec = haloGridSpec();
      const snapshot = await inner.reset({ ...request, grid: spec, sizeM: spec.n * spec.cellMeters, layers });
      return core(snapshot);
    },
    async advance(generation: number, steps: number): Promise<HeatSimSnapshot | null> {
      const snapshot = await inner.advance(generation, steps);
      return snapshot === null || !wrapping ? snapshot : core(snapshot);
    },
    dispose(): void { inner.dispose(); },
  };
}
