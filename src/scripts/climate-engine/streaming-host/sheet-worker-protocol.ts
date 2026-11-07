/**
 * sheet-worker-protocol.ts — what the page asks the sheet worker, and what it answers. Types only (plus tiny helpers), so
 * the worker and its client agree at compile time and node can import it.
 *
 * The worker does the three jobs that used to stall the main thread for 0.9 s on desktop and ~3 s at 4x slowdown when a
 * ward loaded (city-streaming P0): the JSON parse + raster + spatial index of `loadWard`'s continuation (`prepare`, ~0.5 s
 * of that), the LOD0 extrusion (`mesh`, ~0.5 s bevelled) and the LOD1 massing (`massing`).
 */
import type { SimLayers } from '../types.ts';
import type { Spatial } from '../heat-map-model.ts';
import type { TerrainField } from '../terrain.ts';
import type { ExploreDeviceTier } from '../explore/runtime-budget.ts';
import type { MassingMesh, PackedMesh } from '../streaming/prism-mesh.ts';
import type { BevelMesh } from './bevel-core.ts';

export interface SurfaceInput { readonly n: number; readonly veg: Float32Array; readonly albedo: Float32Array }

export type WorkerRequest =
  | { readonly op: 'prepare'; readonly id: number; readonly key: string; readonly wardText: string; readonly roadsText: string | null;
      readonly means: { readonly fvc: number; readonly albedo: number }; readonly surface: SurfaceInput | null }
  | { readonly op: 'mesh'; readonly id: number; readonly key: string; readonly wardText: string; readonly tier: ExploreDeviceTier;
      readonly terrain: TerrainField | null;
      /** The contact-occlusion bake rides along (0.3 s of main thread otherwise): its texel count and near radius. */
      readonly ao: { readonly n: number; readonly nearM: number } | null }
  | { readonly op: 'massing'; readonly id: number; readonly key: string; readonly wardText: string }
  | { readonly op: 'forget'; readonly key: string };

export type WorkerReply =
  | { readonly op: 'prepared'; readonly id: number; readonly base: SimLayers; readonly spatial: Spatial; readonly buildings: number; readonly ms: number }
  | { readonly op: 'meshed'; readonly id: number; readonly mesh: PackedMesh | BevelMesh; readonly ao: Uint8Array | null; readonly ms: number }
  | { readonly op: 'massed'; readonly id: number; readonly mesh: MassingMesh; readonly ms: number }
  | { readonly op: 'failed'; readonly id: number; readonly message: string };

/** The LOD0 mesh of each tier: bevelled floats on `full`, the 30-byte packing below it. */
export const meshKindOf = (tier: ExploreDeviceTier): 'bevel' | 'packed' => (tier === 'full' ? 'bevel' : 'packed');
