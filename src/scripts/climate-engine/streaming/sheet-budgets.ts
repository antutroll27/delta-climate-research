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
 * THE CPU ROW. P0 section 3 found three.js keeps a CPU copy of every vertex array after upload: ArrayBuffers were 181.6 MB
 * (bevelled), 98 MB (no bevel) and 88 MB (no `uv`) at E4, the same bytes as the GL buffers plus ~29 MB of other arrays.
 * `releaseCpuCopyAfterUpload` (explore/gpu-resident.ts) frees it. Every tier here REQUIRES the release (`releasesCpuCopy`);
 * `tabMeshMB` is what a tab holds with or without it, and a test shows `low` cannot meet its ceiling without it.
 *
 * Every field carries a `source` so nobody mistakes a guess for a measurement: 'P0' (measured), 'plan' (PLAN.md 3.2, a
 * proposal the real-phone check replaces) or 'estimate' (unmeasured; P3b replaces it).
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

export type Source = 'P0' | 'plan' | 'estimate';

export interface TierBudget {
  /** The whole page's GPU ceiling, MapLibre included, in MB (PLAN 3.2). */
  readonly gpuCeilingMB: number;
  /** Everything on the GPU that is not a sheet mesh: MapLibre buffers and tiles, heat/AO/terrain textures. P0 section 3
   *  measured 36 MB on desktop (7.6 buffers + 28 textures) and ~21 MB at a phone viewport (6.5 + 14); the CPU-solver tiers
   *  use the phone figure. `full` adds 8 MB for the 504-cell GPU solver's two float textures (504 x 504 x 16 B x 2, an
   *  ESTIMATE), so its 44 is part measured, part estimate and is marked 'estimate'. */
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
  /** The tier frees the CPU copy of every uploaded vertex array (gpu-resident.ts). Required: see the CPU row above. */
  readonly releasesCpuCopy: boolean;
  /** Where each number above comes from. */
  readonly sources: Readonly<{
    gpuCeilingMB: Source; baselineMB: Source; lod0: Source; lod1MeshMB: Source; maxLod0Sheets: Source;
  }>;
}

/** MEASURED: bytes per vertex of today's 8-attribute bevelled mesh, the no-`uv` mesh, and the compact packing (P0 2b). */
const BEVELLED: MeshCostModel = { verticesPerBuilding: 128, bytesPerVertex: 56 };
const FLAT: MeshCostModel = { verticesPerBuilding: 58, bytesPerVertex: 48 };
const FLAT_PACKED: MeshCostModel = { verticesPerBuilding: 58, bytesPerVertex: 32 };

export const SHEET_BUDGETS: Readonly<Record<ExploreDeviceTier, TierBudget>> = Object.freeze({
  full: {
    gpuCeilingMB: 500, baselineMB: 44, lod0: BEVELLED, lod1MeshMB: 4, maxLod0Sheets: 3,
    ring: 'ring8', crossFade: true, prefetch: 'heading-lod0', releasesCpuCopy: true,
    sources: { gpuCeilingMB: 'plan', baselineMB: 'estimate', lod0: 'P0', lod1MeshMB: 'estimate', maxLod0Sheets: 'plan' },
  },
  balanced: {
    gpuCeilingMB: 250, baselineMB: 21, lod0: FLAT, lod1MeshMB: 4, maxLod0Sheets: 2,
    ring: 'ring8', crossFade: false, prefetch: 'heading-lod0', releasesCpuCopy: true,
    sources: { gpuCeilingMB: 'plan', baselineMB: 'P0', lod0: 'P0', lod1MeshMB: 'estimate', maxLod0Sheets: 'plan' },
  },
  low: {
    /* "LOD1 on demand" in PLAN 3.2 is read here as: the four edge neighbours' massing, fetched after the current sheet is
       ready. Nothing of LOD0 is fetched ahead. */
    gpuCeilingMB: 150, baselineMB: 21, lod0: FLAT_PACKED, lod1MeshMB: 4, maxLod0Sheets: 1,
    ring: 'edge4', crossFade: false, prefetch: 'none', releasesCpuCopy: true,
    sources: { gpuCeilingMB: 'plan', baselineMB: 'P0', lod0: 'P0', lod1MeshMB: 'estimate', maxLod0Sheets: 'plan' },
  },
});

const BYTES_PER_MB = 1_000_000;

/** GPU megabytes of one sheet's merged LOD0 mesh on this tier. E4 (21,342 buildings): 153 / 59.4 / 39.6 MB. */
export function lod0MeshMB(tier: ExploreDeviceTier, buildings: number): number {
  const { verticesPerBuilding, bytesPerVertex } = SHEET_BUDGETS[tier].lod0;
  return (buildings * verticesPerBuilding * bytesPerVertex) / BYTES_PER_MB;
}

/**
 * Megabytes a tab holds for one sheet's merged mesh: the GL buffers, plus the CPU typed-array copy unless the tier releases
 * it. P0: E4 held 181.6 MB of ArrayBuffers beside 152 MB of GL buffers on the bevelled build.
 */
export function tabMeshMB(tier: ExploreDeviceTier, buildings: number): number {
  const gl = lod0MeshMB(tier, buildings);
  return SHEET_BUDGETS[tier].releasesCpuCopy ? gl : 2 * gl;
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
