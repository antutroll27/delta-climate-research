import type maplibregl from 'maplibre-gl';
import type { Ambient, RoadsData, WaterData, WardData } from '../heat-map-model.ts';
import type { TerrainField } from '../terrain.ts';
import type { TreesFile } from '../vegetation-layer.ts';
import type { WardFrame } from '../ward-frame.ts';
import type { BuildingMeta } from './building-pick.ts';
/* Type-only, and it has to stay that way: landmark-layer.ts is pure arithmetic
   over a structural clip matrix and imports no three, so this contract keeps the
   no-three guarantee tests/unit/heat-explore-module-boundary.test.mjs asserts. */
import type { LandmarkLabel, LandmarkPick } from './landmark-layer.ts';
import type { ExploreDeviceTier } from './runtime-budget.ts';
import type { SunPlacement } from './sun-lighting.ts';

export interface ReliefWardBundle {
  /**
   * The ward's id. The renderer needs it to know whether an authored glTF city
   * exists for this ward, and `WardData` deliberately does not carry one: it is
   * the geometry payload the solver and the picker share, not an identity.
   */
  wardId: string;
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
  /**
   * Where the sun is, for the hour this phase describes.
   *
   * CARRIED, NOT DERIVED. The renderer could call `sunPlacement` itself from
   * `phase` — and then the compass dial and the key light would be two answers to
   * one question again, which is the defect this field exists to close. One
   * `sunPlacement` call in heat-map-app.ts feeds the dial, this, and the sky.
   *
   * A plain vector, not a THREE.Vector3: `heat-map-app.ts` and this contract are
   * the analytical core and must stay free of three.js — see
   * tests/unit/heat-explore-module-boundary.test.mjs.
   *
   * It changes NO physics. `sun` and `kRad` in the solve are ward-wide scalars.
   */
  sun: SunPlacement;
}

export interface ReliefSelection {
  building: BuildingMeta | null;
  nearestCooling: { x: number; z: number; distM: number } | null;
}

export interface ReliefRenderer {
  readonly layer: maplibregl.CustomLayerInterface;
  setWard(bundle: ReliefWardBundle): void;
  /** Resolves once the ward last passed to `setWard` has its buildings in the scene —
   *  or was superseded, or the renderer was disposed. Never rejects, never hangs on a
   *  ward that will not finish: the loader waits on it, so it must always settle. */
  buildingsReady(): Promise<void>;
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
  /* ── THE LANDMARKS: the only buildings whose height the instrument asserts BY
     NAME, and therefore the only ones that must cite a source for it.

     Both read the renderer's own clip matrix, exactly as `pick` and `project` do,
     because that matrix is rebuilt inside `render()` from what MapLibre hands the
     custom layer and cannot be reached from out here. A caller holding its own
     copy would be a second projection, which is how a frame drifts.

     Empty and null on the extrusion path: Kolkata ships no authored model, so it
     has no landmark nodes, and that is an answer rather than a missing feature. */
  landmarkLabels(width: number, height: number): LandmarkLabel[];
  pickLandmark(x: number, y: number, width: number, height: number,
               radiusPx?: number): LandmarkPick | null;
  dispose(): void;
}

export interface ReliefRendererOptions {
  map: maplibregl.Map;
  reducedMotion: boolean;
  simulationGridSize: number;
  terrainGridSize: number;
  /**
   * Decides one thing only: whether the ~2.3 MB of image-based ambience is worth
   * fetching and convolving here. `imageBasedLightingAllowed` in sun-lighting.ts
   * holds the rule. Everything that carries meaning runs on every tier.
   *
   * A FUNCTION, AND THE VALUE FORM WAS A MEASURED BUG. `runtimeTier` starts at
   * 'balanced' and is only promoted to 'full' inside `initSimHost`, which runs from
   * `resetSim` — after the ward has loaded. `ensureRelief` fires much earlier, off
   * `capsReady` directly, so a renderer handed the VALUE captured 'balanced'
   * forever and the dome was never fetched once: measured with a request listener,
   * zero `.hdr` requests over a full boot and a phase switch, on a machine that
   * classifies as tier 2. Reading it late is what makes the gate mean what it says.
   */
  deviceTier: () => ExploreDeviceTier;
}
