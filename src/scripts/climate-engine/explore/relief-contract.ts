import type maplibregl from 'maplibre-gl';
import type { Ambient, RoadsData, WaterData, WardData } from '../heat-map-model.ts';
import type { TerrainField } from '../terrain.ts';
import type { WardFrame } from '../ward-frame.ts';
import type { BuildingMeta } from './building-pick.ts';

export interface ReliefWardBundle {
  wardData: WardData;
  roads: RoadsData;
  water: WaterData;
  terrain: TerrainField | null;
  mercatorOrigin: { x: number; y: number; z: number };
  frame: WardFrame;
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
