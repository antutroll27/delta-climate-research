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
 * WHAT THE MESH COST IS (P3b, replacing P0's estimates with the meshes the worker really builds). `full` keeps the bevel:
 * 128.0 vertices a building of 48 B (no `uv`) = 131.1 MB for E4. `balanced` and `low` draw the flat packed prism: 29.2
 * vertices a building, 36.4 B all in (30 B of attributes plus the index) = 22.6 MB for E4. P0 had priced them at 153 / 59.4 /
 * 39.6 MB; the packed mesh is cheaper than its 32 B target because it has no bottom cap and shares its roof vertices.
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

export type Source = 'P0' | 'P3b-measured' | 'plan' | 'estimate';

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
  /** GPU cost of one sheet's LOD1 massing, MB: the WORST sheet (E4), P3b-measured; see LOD1_WORST_SHEET_MB. */
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

/**
 * P3b-measured, from the meshes the worker really builds (tests/unit/prism-mesh.test.mjs, streaming-host/bevel-core.ts):
 *   BEVELLED  `full`. E4: 2,731,890 vertices (128.0 a building) of 48 bytes (position 12, normal 12, aDelay 4, aH 4, aCtr 8,
 *             aG 4, aIn 4; no `uv`, the shader reads none) = 131.1 MB. P0 priced the 56-byte mesh with `uv` at 153 MB.
 *   PACKED    `balanced` and `low`. E4: 622,500 vertices (29.2 a building: 4 per wall edge + the roof ring, no bottom, no bevel)
 *             of 30 bytes in seven attributes (streaming/prism-mesh.ts) plus the u32 index (46.5 indices a building, 6.4
 *             bytes a vertex on average) = 22.64 MB, 36.4 bytes a vertex all in. P0's estimate for the same tier was 39.6 MB.
 */
const BEVELLED: MeshCostModel = { verticesPerBuilding: 128, bytesPerVertex: 48 };
const PACKED: MeshCostModel = { verticesPerBuilding: 29.2, bytesPerVertex: 36.4 };

/**
 * One sheet's LOD1 grey massing, MB, P3b-measured: E4 (21,342 buildings, the densest sheet) is 9.65 MB; the other 31 shipped
 * sheets are 0.20 to 5.46 MB with a mean of 2.36 MB (0.45 KB a building at most). The table holds the WORST sheet so a ring of
 * eight cannot be under-priced; the page adds up the real bytes it holds (tests/unit/prism-mesh.test.mjs).
 */
const LOD1_WORST_SHEET_MB = 10;

export const SHEET_BUDGETS: Readonly<Record<ExploreDeviceTier, TierBudget>> = Object.freeze({
  full: {
    /* crossFade is OFF (P3b). A kept LOD0 mesh is tinted by the page's CURRENT heat field, sampled in the old sheet's
       coordinates, so for the length of a cross-fade the old sheet would show the wrong sheet's heat. The old sheet becomes its
       grey massing in the same frame the new one appears instead (city-stream.ts builds that massing before the swap). */
    gpuCeilingMB: 500, baselineMB: 44, lod0: BEVELLED, lod1MeshMB: LOD1_WORST_SHEET_MB, maxLod0Sheets: 3,
    ring: 'ring8', crossFade: false, prefetch: 'heading-lod0', releasesCpuCopy: true,
    sources: { gpuCeilingMB: 'plan', baselineMB: 'estimate', lod0: 'P3b-measured', lod1MeshMB: 'P3b-measured', maxLod0Sheets: 'plan' },
  },
  balanced: {
    gpuCeilingMB: 250, baselineMB: 21, lod0: PACKED, lod1MeshMB: LOD1_WORST_SHEET_MB, maxLod0Sheets: 2,
    ring: 'ring8', crossFade: false, prefetch: 'heading-lod0', releasesCpuCopy: true,
    sources: { gpuCeilingMB: 'plan', baselineMB: 'P0', lod0: 'P3b-measured', lod1MeshMB: 'P3b-measured', maxLod0Sheets: 'plan' },
  },
  low: {
    /* "LOD1 on demand" in PLAN 3.2 is read here as: the four edge neighbours' massing, fetched after the current sheet is
       ready. Nothing of LOD0 is fetched ahead. */
    gpuCeilingMB: 150, baselineMB: 21, lod0: PACKED, lod1MeshMB: LOD1_WORST_SHEET_MB, maxLod0Sheets: 1,
    ring: 'edge4', crossFade: false, prefetch: 'none', releasesCpuCopy: true,
    sources: { gpuCeilingMB: 'plan', baselineMB: 'P0', lod0: 'P3b-measured', lod1MeshMB: 'P3b-measured', maxLod0Sheets: 'plan' },
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
