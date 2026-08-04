/**
 * road-layer.ts — the ward's roads, drawn in the city scene.
 *
 * RENDER ONLY, in the exact sense water-layer.ts means it: this draws
 * {ward}-roads.json and touches neither the simulation's layers nor its
 * intervention targeting. See road-ribbon.ts for the widths, where they came
 * from, and why the model's own road width is a different quantity that must
 * stay different.
 *
 * One mesh, one draw call, and no per-frame work: the fade rides the facade's
 * `uGrow` uniform, so roads assemble with the buildings rather than on a clock
 * of their own. Flat ink, no shading — a road is the ABSENCE of the city, and
 * anything lit competes with the massing it exists to separate.
 */
import * as THREE from 'three';
import type { RoadsData } from './heat-map-model';
import { buildRoadMesh } from './road-ribbon';

export interface RoadLayer {
  readonly mesh: THREE.Mesh;
  /** ways actually drawn — for the honesty readout, never a hardcoded count */
  readonly ways: number;
  dispose(): void;
}

const VERT = /* glsl */ `
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/* #39555c — the stage's ink. Cool enough to sit under the cyan massing, dark
   enough to read against the basemap, and nowhere near the temperature ramp. */
const FRAG = /* glsl */ `
  precision highp float;
  uniform float uGrow;
  void main() {
    gl_FragColor = vec4(0.224, 0.333, 0.361, 0.85 * min(1.0, uGrow * 1.6));
  }`;

/**
 * @param groundAt drawn ground height at a point in the ward frame, or a flat
 *   () => 0 when there is no terrain artefact. Per vertex — roads run downhill.
 */
export function createRoadLayer(
  data: RoadsData,
  growU: { value: number },
  groundAt: (x: number, y: number) => number,
): RoadLayer | null {
  const built = buildRoadMesh(data, groundAt);
  if (!built) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(built.indices, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: { uGrow: growU },       /* SHARED with the facade's grow-in */
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,                /* buildings occlude; roads never do */
    side: THREE.DoubleSide,           /* a mitre can wind either way */
  });

  return {
    mesh: new THREE.Mesh(geometry, material),
    ways: built.ways,
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
