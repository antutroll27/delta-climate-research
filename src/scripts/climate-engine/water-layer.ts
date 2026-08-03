/**
 * water-layer.ts — the ward's water, as animated surfaces in the city scene.
 *
 * RENDER ONLY. This module draws OSM water polygons ({ward}-water.json, fetched
 * by scripts/fetch-water.py); it deliberately does NOT touch SimLayers.water,
 * which stays zero. The simulation already carries water terms (sim-ts.ts
 * ventilation + relaxation) that activate the moment that layer is filled — and
 * activating them changes the published ward mean, so that step is gated behind
 * the calibration protocol, not smuggled in with a visual feature.
 *
 * THE ANIMATION RIDES EXISTING REPAINTS. No rAF of its own: the caller advances
 * uTime inside the MapLibre custom-layer render callback, which runs when the
 * map repaints — continuously during the idle orbit and drags, and at the sim
 * bridge's cadence otherwise. When nothing else on the page moves, the water
 * slows to that same heartbeat, which is the perf ethos applied literally.
 * Under prefers-reduced-motion the caller never advances uTime: still water.
 *
 * One mesh, one draw call: rings become ShapeGeometries, merged. Rivers get a
 * slow directional drift via a per-vertex flag; ponds shimmer in place.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WaterData } from './heat-map-model';

export interface WaterLayer {
  readonly mesh: THREE.Mesh;
  /** advance the shimmer; call from the render loop with seconds */
  setTime(seconds: number): void;
  dispose(): void;
}

/** Water sits just above the heat overlay (y=0.6) and below every roof. */
const SURFACE_Y = 0.9;

const VERT = /* glsl */ `
  attribute float aFlow;
  varying vec2 vPos;
  varying float vFlow;
  void main() {
    vPos = vec2(position.x, position.z);
    vFlow = aFlow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uGrow;
  varying vec2 vPos;
  varying float vFlow;
  void main() {
    /* ~12 m wavelength; rivers drift their whole pattern downstream. */
    vec2 p = vPos * 0.085;
    float t = uTime;
    p.y += t * 0.32 * vFlow;

    float w1 = sin(p.x * 1.7 + p.y * 2.3 + t * 1.05);
    float w2 = sin(p.x * 2.9 - p.y * 1.3 - t * 0.65 + 1.7);
    float rip = (w1 + w2) * 0.5;                       /* -1..1 broad swell */
    float w3 = sin((p.x + p.y) * 4.3 + t * 1.8);
    float glint = smoothstep(0.78, 0.98, w3 * (0.55 + 0.45 * rip));

    vec3 deep = vec3(0.030, 0.118, 0.128);             /* the stage's dark teal */
    vec3 lit  = vec3(0.435, 0.792, 0.839);             /* brand cyan #6fcad6 */
    vec3 col = mix(deep, lit, 0.10 + 0.07 * rip);
    col += lit * glint * 0.30;                         /* sparse moving glints */

    gl_FragColor = vec4(col, 0.78 * min(1.0, uGrow * 1.6));
  }`;

export function createWaterLayer(
  data: WaterData,
  growU: { value: number },
): WaterLayer | null {
  const geos: THREE.BufferGeometry[] = [];
  for (const poly of data.polys) {
    const p = poly.p;
    if (p.length < 6) continue;
    /* Same frame convention as the building extrusions: file y (north) becomes
       shape -y, and rotateX(-PI/2) lays the sheet flat onto the map. */
    const shape = new THREE.Shape();
    shape.moveTo(p[0], -p[1]);
    for (let i = 2; i + 1 < p.length; i += 2) shape.lineTo(p[i], -p[i + 1]);
    let g: THREE.ShapeGeometry;
    try { g = new THREE.ShapeGeometry(shape); } catch { continue; }
    g.rotateX(-Math.PI / 2);
    const n = g.attributes.position.count;
    const flow = new Float32Array(n).fill(poly.k === 'river' ? 1 : 0);
    g.setAttribute('aFlow', new THREE.BufferAttribute(flow, 1));
    geos.push(g);
  }
  if (!geos.length) return null;

  const merged = mergeGeometries(geos, false);
  geos.forEach(g => g.dispose());
  if (!merged) return null;

  const timeU = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: timeU, uGrow: growU },   /* uGrow SHARED with the facade */
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,                          /* buildings occlude; water never does */
  });
  const mesh = new THREE.Mesh(merged, material);
  mesh.position.y = SURFACE_Y;
  mesh.renderOrder = 0;                         /* after the heat overlay's -1 */

  return {
    mesh,
    setTime(seconds: number) { timeU.value = seconds; },
    dispose() { merged.dispose(); material.dispose(); },
  };
}
