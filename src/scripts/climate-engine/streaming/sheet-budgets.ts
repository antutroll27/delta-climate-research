/**
 * sheet-budgets.ts — what a device tier may hold of a streamed city, in ONE typed table.
 *
 * Whole-city streaming (PLAN section 3.2) keeps the current sheet at full detail (LOD0), its neighbours as grey block
 * massing (LOD1), and a small "halo" asset (the neighbours' solver ground) for the seam-free solve. Every number the
 * sheet manager and the caches act on is below, with where it comes from. Pure: no DOM, no three.js.
 *
 *   MEASURED  = city-streaming P0-RESULTS.md (Canal Ring, E4, the densest sheet: 21,342 buildings)
 *   PLAN      = PLAN.md section 3.2 (a proposal the founder accepted; the real-phone check replaces it)
 *   ESTIMATE  = nobody has measured it yet; P3b measures and replaces it
 *
 * WHAT THE MESH COST IS. P0 section 2b/3: E4's merged building mesh is 128.0 vertices per building today (bevelled) and
 * 58.0 without the bevel; a vertex is 56 B with today's 8 attributes, 48 B without `uv` (the shader reads none), 32 B
 * with the compact packing. That gives 153 MB / 59.4 MB / 39.6 MB for E4, which is what `lod0MeshMB` returns for it.
 * The CPU copy of those arrays is NOT in the numbers: P0 section 3 found three.js keeps it after upload (182 MB at E4)
 * and `releaseCpuCopyAfterUpload` (explore/gpu-resident.ts, on the feat/ams-followups line) frees it, so the budget
 * assumes the release. A tier that cannot release has to subtract that copy from its ceiling.
 */
import type { ExploreDeviceTier } from '../explore/runtime-budget.ts';

/** Save-Data or a 2G/slow-2G connection is `constrained`; everything else is `fast` (PLAN 3.3: "Wi-Fi/4G"). */
export type NetworkClass = 'fast' | 'constrained';

/** How much of the neighbour ring is drawn as massing: all eight, or the four edge-sharing sheets (n, e, s, w). */
export type RingShape = 'ring8' | 'edge4';

/** Whether the full bundle of the sheet the camera is heading for may be fetched ahead of time. Always needs a `fast`
 *  network (PLAN 3.3: no Save-Data, not 2G); `none` never prefetches. */
export type PrefetchPolicy = 'heading-lod0' | 'none';

export interface MeshCostModel {
  /** vertices per building in the merged mesh (MEASURED, P0 2b) */
  readonly verticesPerBuilding: number;
  /** bytes per vertex across all attributes (MEASURED, P0 2b) */
  readonly bytesPerVertex: number;
}

export interface TierBudget {
  /** The whole page's GPU ceiling, MapLibre included, in MB (PLAN 3.2). */
  readonly gpuCeilingMB: number;
  /** Everything on the GPU that is not a sheet mesh: MapLibre buffers and tiles, heat/AO/terrain textures, the 504 solver
   *  textures. MEASURED 36 MB on desktop and ~21 MB at a phone viewport (P0 section 3); +8 for the 504-cell GPU solver's two
   *  float textures on `full` (ESTIMATE, 504 x 504 x 16 B x 2). */
  readonly baselineMB: number;
  /** LOD0 mesh model of this tier (bevelled on `full`, no bevel and no `uv` on `balanced`, compact packing on `low`). */
  readonly lod0: MeshCostModel;
  /** GPU cost of one sheet's LOD1 massing, MB (ESTIMATE: the plan sizes the file at 50-100 KB, nobody has built the mesh). */
  readonly lod1MeshMB: number;
  /** Parsed LOD0 bundles kept in the JS heap, current sheet included (PLAN 3.2). */
  readonly maxLod0Sheets: number;
  readonly ring: RingShape;
  /** The old and the new sheet's meshes coexist for a cross-fade (PLAN 3.2; `full` only, and only if the ceiling allows). */
  readonly crossFade: boolean;
  readonly prefetch: PrefetchPolicy;
  /** Bytes of fetched sheet files held before they are parsed, MB. Basis: E4's artefacts are 2.7 MB raw
   *  (MEASURED: ward 1.83 + roads 0.20 + surface 0.14 + trees 0.34 + water 0.13 + terrain 0.05) + the halo asset, per sheet. */
  readonly fetchCacheMB: number;
}

/** MEASURED: bytes per vertex of today's 8-attribute bevelled mesh, the no-`uv` mesh, and the compact packing (P0 2b). */
const BEVELLED: MeshCostModel = { verticesPerBuilding: 128, bytesPerVertex: 56 };
const FLAT: MeshCostModel = { verticesPerBuilding: 58, bytesPerVertex: 48 };
const FLAT_PACKED: MeshCostModel = { verticesPerBuilding: 58, bytesPerVertex: 32 };

export const SHEET_BUDGETS: Readonly<Record<ExploreDeviceTier, TierBudget>> = Object.freeze({
  full: {
    gpuCeilingMB: 500, baselineMB: 44, lod0: BEVELLED, lod1MeshMB: 4, maxLod0Sheets: 3,
    ring: 'ring8', crossFade: true, prefetch: 'heading-lod0', fetchCacheMB: 10,
  },
  balanced: {
    gpuCeilingMB: 250, baselineMB: 24, lod0: FLAT, lod1MeshMB: 4, maxLod0Sheets: 2,
    ring: 'ring8', crossFade: false, prefetch: 'heading-lod0', fetchCacheMB: 6,
  },
  low: {
    /* "LOD1 on demand" in PLAN 3.2 is read here as: the four edge neighbours' massing, fetched after the current sheet is
       ready. Nothing of LOD0 is fetched ahead. */
    gpuCeilingMB: 150, baselineMB: 24, lod0: FLAT_PACKED, lod1MeshMB: 4, maxLod0Sheets: 1,
    ring: 'edge4', crossFade: false, prefetch: 'none', fetchCacheMB: 3,
  },
});

const BYTES_PER_MB = 1_000_000;

/** GPU megabytes of one sheet's merged LOD0 mesh on this tier. E4 (21,342 buildings): 153 / 59.4 / 39.6 MB. */
export function lod0MeshMB(tier: ExploreDeviceTier, buildings: number): number {
  const { verticesPerBuilding, bytesPerVertex } = SHEET_BUDGETS[tier].lod0;
  return (buildings * verticesPerBuilding * bytesPerVertex) / BYTES_PER_MB;
}

/** The camera-crossing trigger's numbers (PLAN 5.1 item 4). */
export const CROSSING = Object.freeze({
  /** The map centre must be this far inside the new sheet, measured to the nearest edge of that sheet, so a camera
   *  hovering on a seam never flaps. */
  hysteresisM: 200,
  /** ...and the gesture must have been over (no pointer down, inertia settled) this long. */
  idleMs: 400,
});

/** Failed fetches are retried on their own after these gaps, then left to an explicit retry (3 attempts in all). */
export const RETRY_BACKOFF_MS: readonly number[] = Object.freeze([2_000, 8_000]);
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

/** After this long without the sheet, the full loading plate replaces the quiet rise (PLAN 5.2: "past ~1.2 s"). */
export const PLATE_AFTER_MS = 1_200;
