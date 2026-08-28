import type maplibregl from 'maplibre-gl';
import type { Ambient, RoadsData, WaterData, WardData } from '../heat-map-model.ts';
import type { TerrainField } from '../terrain.ts';
import type { TreesFile } from '../vegetation-layer.ts';
import type { WardFrame } from '../ward-frame.ts';
import type { BuildingMeta } from './building-pick.ts';

export interface ReliefWardBundle {
  wardData: WardData;
  roads: RoadsData;
  water: WaterData;
  terrain: TerrainField | null;
  mercatorOrigin: { x: number; y: number; z: number };
  frame: WardFrame;
  veg: TreesFile | null;
}

export interface ReliefFieldUpdate {
  field: Float32Array;
  coolingMask: Uint8Array | Float32Array | null;
  ramp: readonly [number, number];
}

export interface ReliefVisualState {
  mode: 'relief' | 'iso';
  environment: 'dark' | 'studio';
  tintMode: number;
  grow: number;
  overlayOpacity: number;
  live: Ambient | null;
  phase: 'peak' | 'night';
}

export interface ReliefSelection {
  building: BuildingMeta | null;
  nearestCooling: { x: number; z: number; distM: number } | null;
}

export interface ReliefRenderer {
  readonly layer: maplibregl.CustomLayerInterface;
  setWard(bundle: ReliefWardBundle): void;
  updateField(update: ReliefFieldUpdate): void;
  setVisualState(state: ReliefVisualState): void;
  setSelection(selection: ReliefSelection): void;
  /* ── THE PER-LAYER SWITCHES THE LAYER TREE DRIVES ────────────────────────────
     Four sibling methods in `setVegetationVisible`'s idiom rather than one
     `setLayerVisible(id, on)`, because the renderer must not learn the layer
     registry's vocabulary: `scope/layers.ts` is a UI model — what the tree offers
     and why a row is greyed — and a renderer that took a `LayerId` would have to
     be edited every time a row was added, whether or not it drew anything new.
     heat-map-app.ts owns the translation, in one exhaustive `switch`.

     The renderer REMEMBERS these across a ward change. `rebuildWard` throws the
     city mesh and the vegetation group away and builds new ones, so a state held
     only in the caller would silently revert on the next ward switch — which is
     the shape of bug the caller would then have to remember to work around. */
  setVegetationVisible(visible: boolean): void;
  /** The crowns and the blob shadows under them — the canopy, leaving the trunks. */
  setCanopyVisible(visible: boolean): void;
  /** Whether building geometry is drawn at all. */
  setBuildingsVisible(visible: boolean): void;
  /** Extruded to their measured heights, or flattened to footprint slabs. */
  setBuildingsExtruded(extruded: boolean): void;
  pick(x: number, y: number, width: number, height: number, radiusPx?: number): number;
  project(x: number, y: number, z: number, width: number, height: number): { x: number; y: number; w: number };
  dispose(): void;
}

export interface ReliefRendererOptions {
  map: maplibregl.Map;
  reducedMotion: boolean;
  simulationGridSize: number;
  terrainGridSize: number;
}
