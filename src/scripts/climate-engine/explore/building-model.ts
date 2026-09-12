/**
 * building-model.ts — buildings as a Draco-compressed glTF, with extrusion as
 * the fallback.
 *
 * WHY A MODEL AND NOT EXTRUSION. The Blender scenes carry landmark massing and
 * authored form that a footprint ring cannot express — an extruded outline can
 * never be a stepped dome.
 *
 * WHY THE RINGS STILL SHIP. The solver rasterises them into `built`, and
 * building-pick.ts projects their centroids to hit-test a click. Picking never
 * touched the mesh, so swapping the geometry breaks no interaction.
 *
 * WHY THE FALLBACK IS FREE. The rings are already loaded for those two reasons,
 * so a ward with no model degrades to exactly what Kolkata renders today rather
 * than to nothing.
 *
 * ── TWO TRAPS, BOTH MEASURED, BOTH OF WHICH RENDER PERFECTLY WHEN WRONG ──
 *
 * 1. +Z POINTS SOUTH. Blender is Z-up; the glTF exporter rotates to Y-up, so a
 *    vertex arrives as `(x_east, z_up, -y_north)`. An earlier draft of this file
 *    documented it as `x east / y up / z north`, which is a NORTH–SOUTH MIRROR,
 *    and a mirror renders perfectly: every building closed, every height right,
 *    the city reflected about its own centre line. No symmetric statistic sees
 *    it — min, max, mean, sd and |lo+hi| are all identical under the mirror, and
 *    `check-bangalore-artefacts.py` passes mirrored data (measured: exit 0).
 *
 *    Settled numerically instead, against three published landmarks in
 *    `mg-road.glb` converted through the frame gate's own `blr.to_local`:
 *
 *      landmark                     +Z = north   +Z = south
 *      M. Chinnaswamy Stadium          744.1 m       20.5 m
 *      UB Tower                        576.4 m        5.3 m
 *      Subhas Chandra Bose Tower       302.5 m       20.2 m
 *
 *    `wardLocalFromModel` is that result, and `MODEL_TO_SCENE` is DERIVED from
 *    it rather than written out again — so the mesh transform and the landmark
 *    positions cannot disagree, and a mirror would have to be introduced in both
 *    at once. `tests/unit/bangalore-building-model.test.mjs` places the three
 *    landmarks; `scripts/check-bangalore-frame.py` is the artefact-side gate.
 *    This project has shipped a mirrored render once, and the retraction of that
 *    finding was itself wrong. Settle orientation by numbers, never by eye.
 *
 * 2. `name.startsWith('lm.')` MATCHES NOTHING. `GLTFLoader.createUniqueName`
 *    runs every node name through `PropertyBinding.sanitizeNodeName`, whose
 *    `_RESERVED_CHARS_RE` includes `\.`. The GLB genuinely contains
 *    `lm.ub-tower` — three.js hands you `lmub-tower`. A `lm.` matcher reports
 *    ZERO landmarks in every ward and silently folds all 47 into the bulk group:
 *    no error, nothing visibly missing, the signature feature just gone.
 *    `landmarkNamesByLoadedName` therefore replays `createUniqueName` over the
 *    raw names and keys the result by what three.js will actually produce.
 */
import * as THREE from 'three';

/** glTF node-name prefix marking a published landmark. The dot does NOT survive
 *  three.js's node-name sanitiser — see trap 2 above. */
const LANDMARK_PREFIX = 'lm.';

/**
 * Wards that ship `public/heat-map/models/<ward>.glb`.
 *
 * A LIST RATHER THAN A PROBE, for two reasons. It keeps a Kolkata ward from
 * issuing a 404 and from downloading the GLTF/Draco chunk at all, and it lets
 * the renderer decide synchronously whether to extrude — extruding 11,025
 * bevelled footprints and then throwing them away is the cost this avoids.
 * It cannot drift from the directory: the unit test asserts the two are equal.
 */
export const MODEL_WARDS: readonly string[] = ['indiranagar', 'mg-road', 'whitefield'];

export function hasBuildingModel(ward: string): boolean {
  return MODEL_WARDS.includes(ward);
}

/** A point in the ward frame the rest of the instrument speaks: x east, y NORTH. */
export interface WardLocalPoint {
  /** metres east of the ward centre */
  readonly x: number;
  /** metres NORTH of the ward centre */
  readonly y: number;
  /** metres above the model datum */
  readonly up: number;
}

/**
 * glTF vertex → ward-local metres. THE ONE PLACE THE AXIS SIGN IS WRITTEN.
 *
 * Blender's Z-up scene leaves glTF holding `(x_east, z_up, -y_north)`, so the
 * recovery is `x = position.x`, `y = -position.z`. Measured: see trap 1.
 */
export function wardLocalFromModel(x: number, y: number, z: number): WardLocalPoint {
  return { x, y: -z, up: y };
}

/**
 * Per-axis scale taking the glTF frame to the scene frame `(east, up, north)`.
 *
 * DERIVED, NOT RESTATED. Writing `(1, 1, -1)` here by hand would be a second
 * copy of the sign rule, free to disagree with `wardLocalFromModel` — which is
 * exactly the shape of the bug this module exists to prevent. Probing the
 * function with a unit vector makes the two one fact.
 */
const UNIT = wardLocalFromModel(1, 1, 1);
export const MODEL_TO_SCENE: readonly [number, number, number] = [UNIT.x, UNIT.up, UNIT.y];

/** True when `MODEL_TO_SCENE` reverses handedness, so triangle winding must flip. */
const MIRRORS_HANDEDNESS = MODEL_TO_SCENE[0] * MODEL_TO_SCENE[1] * MODEL_TO_SCENE[2] < 0;

export interface LandmarkNode {
  /** landmark id with the `lm.` prefix stripped, e.g. `ub-tower` */
  readonly name: string;
  readonly object: THREE.Object3D;
  /** centroid, metres east of the ward centre */
  readonly x: number;
  /** centroid, metres NORTH of the ward centre */
  readonly y: number;
  /** roof height above the model datum, metres — measured off the geometry */
  readonly topM: number;
  /** authored height from the node's glTF `extras` (0 until Task 11 exports them) */
  readonly heightM: number;
  /** provenance string from the node's glTF `extras` */
  readonly source: string;
}

export interface BuildingModel {
  /** every mesh in the ward, already in scene-local metres: x east, y up, z NORTH */
  readonly buildings: THREE.Group;
  /** one entry per `lm.` node, in the same frame */
  readonly landmarks: readonly LandmarkNode[];
}

/**
 * Map the node names three.js will produce back to the raw glTF names, for the
 * landmark nodes only.
 *
 * `sanitize` is a parameter rather than an import so the unit test can feed in
 * the REAL `THREE.PropertyBinding.sanitizeNodeName` and prove the matcher
 * against the actual transformation, instead of against a guess at it.
 *
 * The uniquifying loop replays `GLTFParser.createUniqueName` exactly — first
 * occurrence keeps the sanitised name, the nth gets `_<n-1>` — because it runs
 * over ALL nodes, so a plain building could claim a name a landmark then
 * collides with. Replaying it is the only way the pairing stays exact.
 */
export function landmarkNamesByLoadedName(
  rawNames: readonly string[],
  sanitize: (name: string) => string,
): Map<string, string> {
  const used = new Map<string, number>();
  const out = new Map<string, string>();
  for (const raw of rawNames) {
    const base = sanitize(raw);
    const seen = used.get(base);
    const loaded = seen === undefined ? base : `${base}_${seen + 1}`;
    used.set(base, seen === undefined ? 0 : seen + 1);
    if (raw.startsWith(LANDMARK_PREFIX)) out.set(loaded, raw);
  }
  return out;
}

/** Reverse every triangle's winding, in place, on a NON-INDEXED geometry. */
function reverseWinding(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  const array = position.array as Float32Array;
  for (let vertex = 0; vertex + 2 < position.count; vertex += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const b = (vertex + 1) * 3 + axis, c = (vertex + 2) * 3 + axis;
      const swap = array[b]; array[b] = array[c]; array[c] = swap;
    }
  }
  position.needsUpdate = true;
}

/**
 * Bake the glTF → ward frame into the geometry itself, rather than carrying it
 * on a node with a negative scale.
 *
 * WHY BAKED. Everything downstream reads raw vertex positions: the facade
 * shader samples the heat field at `position.xz`, the landmark centroids come
 * from a Box3, and `building-pick.ts` speaks ward metres. A node-level
 * `scale.z = -1` would leave all of them one unmentioned sign away from the
 * mirror — the same scene-node trap that shipped on the Dubai terrain.
 *
 * WHY NON-INDEXED FIRST. The GLB carries POSITION and nothing else: no normals,
 * no materials. The merged mesh is welded (indiranagar: 124,950 positions for
 * 157,877 triangles), so `computeVertexNormals` on it would smooth every
 * building's corners into a blob. Splitting to per-face vertices first gives
 * exact flat normals — and matches the extrusion path, which is non-indexed too.
 *
 * WHY THE WINDING FLIP. The bake mirrors one axis, which reverses triangle
 * orientation; without the flip every face is back-facing and the normals point
 * into the building.
 */
function bakeWardLocal(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const source = object.geometry as THREE.BufferGeometry;
    const geometry = source.index ? source.toNonIndexed() : source;
    geometry.scale(MODEL_TO_SCENE[0], MODEL_TO_SCENE[1], MODEL_TO_SCENE[2]);
    if (MIRRORS_HANDEDNESS) reverseWinding(geometry);
    geometry.computeVertexNormals();
    if (geometry !== source) source.dispose();
    object.geometry = geometry;
  });
}

interface GltfNodeJson { name?: string; extras?: Record<string, unknown> }

/**
 * Fetch and decode `<ward>.glb`, or return null so the caller extrudes instead.
 *
 * EVERY FAILURE RETURNS NULL. A ward with no model, an offline fetch, a corrupt
 * buffer, a missing Draco decoder — all of them must land on the extrusion path
 * that Kolkata already renders, never on an exception that leaves the map empty.
 */
export async function loadBuildingModel(
  ward: string, signal?: AbortSignal,
): Promise<BuildingModel | null> {
  if (!hasBuildingModel(ward)) return null;
  try {
    const response = await fetch(`/heat-map/models/${ward}.glb`, { signal });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    /* Loaded at use, not at import: a Kolkata ward never downloads the glTF or
       Draco chunks, and the relief bundle does not grow for a path it skips. */
    const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/loaders/DRACOLoader.js'),
    ]);
    const loader = new GLTFLoader();
    /* The same decoder asset river-scene.ts already streams — a separate,
       cacheable file fetched only when something is actually decoded. */
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    loader.setDRACOLoader(draco);
    const gltf = await loader.parseAsync(buffer, '');
    draco.dispose();

    const nodes = ((gltf.parser.json as { nodes?: GltfNodeJson[] }).nodes ?? []);
    const rawByLoaded = landmarkNamesByLoadedName(
      nodes.map((node) => node.name ?? ''), THREE.PropertyBinding.sanitizeNodeName,
    );
    const extrasByRaw = new Map<string, Record<string, unknown>>();
    for (const node of nodes) if (node.name) extrasByRaw.set(node.name, node.extras ?? {});

    const buildings = new THREE.Group();
    const landmarks: LandmarkNode[] = [];
    const box = new THREE.Box3();
    for (const child of [...gltf.scene.children]) {
      bakeWardLocal(child);
      buildings.add(child);
      const raw = rawByLoaded.get(child.name);
      if (!raw) continue;
      /* Ward-local straight off the baked geometry, so the number the landmark
         layer labels is the number the mesh is drawn at. */
      box.setFromObject(child);
      const extras = extrasByRaw.get(raw) ?? {};
      landmarks.push({
        name: raw.slice(LANDMARK_PREFIX.length),
        object: child,
        x: (box.min.x + box.max.x) / 2,
        y: (box.min.z + box.max.z) / 2,
        topM: box.max.y,
        heightM: Number(extras.height_m ?? 0) || 0,
        source: String(extras.height_source ?? ''),
      });
    }
    return { buildings, landmarks };
  } catch {
    return null;
  }
}
