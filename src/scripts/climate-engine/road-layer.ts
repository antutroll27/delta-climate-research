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
import { displayColor, HAZE_GLSL } from './explore/look-shading';
import { CLAY, clayFor } from './explore/look';

export interface RoadLayer {
  readonly mesh: THREE.Mesh;
  /** ways actually drawn — for the honesty readout, never a hardcoded count */
  readonly ways: number;
  /** Editorial look only: Clay draws the wider ribbons, Dark the classic ones. */
  setStudio?(studio: boolean): void;
  /** Editorial look only: a phone-sized frame draws wider, darker Clay ribbons (look.ts `clayFor`). */
  setPhone?(phone: boolean): void;
  dispose(): void;
}

const VERT = /* glsl */ `
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/* #39555c — the stage's ink. Cool enough to sit under the cyan massing, dark
   enough to read against the basemap, and nowhere near the temperature ramp.
   The roads shipped until 2026-10-02, kept unchanged for `?look=classic`. */
const FRAG_CLASSIC = /* glsl */ `
  precision highp float;
  uniform float uGrow;
  void main() {
    gl_FragColor = vec4(0.224, 0.333, 0.361, 0.85 * min(1.0, uGrow * 1.6));
  }`;

/* The editorial roads (explore/look.ts): the same flat ink in Dark; in Clay a mid
   warm-grey asphalt (CLAY.asphalt), so a street reads as a cut in the paper
   rather than a drawn line. Hazed like everything else in Clay. */
const FRAG = /* glsl */ `
  precision highp float;
  uniform float uGrow, uStudio, uHaze, uRoadA;
  uniform vec3 uAsphalt, uHazeCol;
  ${HAZE_GLSL}
  void main() {
    bool stu = uStudio > 0.5;
    vec3 col = stu ? uAsphalt : vec3(0.224, 0.333, 0.361);
    col = mix(col, uHazeCol, lookHaze() * uHaze);
    gl_FragColor = vec4(col, (stu ? uRoadA : 0.85) * min(1.0, uGrow * 1.6));
  }`;

/**
 * @param groundAt drawn ground height at a point in the ward frame, or a flat
 *   () => 0 when there is no terrain artefact. Per vertex — roads run downhill.
 */
export function createRoadLayer(
  data: RoadsData,
  growU: { value: number },
  groundAt: (x: number, y: number) => number,
  look?: { studio: { value: number }; haze: { value: number }; hazeCol: { value: THREE.Color } },
): RoadLayer | null {
  const built = buildRoadMesh(data, groundAt);
  if (!built) return null;

  const toGeometry = (m: { positions: Float32Array; indices: Uint32Array | Uint16Array }): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    return g;
  };
  const geometry = toGeometry(built);
  /* Editorial Clay only: a DRAWN width boost (look.ts `clayFor(phone).roadWidth` —
     wider on phones, where the classic ribbons thin to hairlines). Dark keeps the
     classic ribbons, so the wide set is swapped in by `setStudio`. It is built on
     first use, for the frame it is drawn in, and rebuilt when the frame crosses
     the phone line (`setPhone`): the one look value that is geometry rather than
     a uniform. */
  let phone = false, studio = false;
  let wide: THREE.BufferGeometry | null = null, wideIsPhone: boolean | null = null;
  const buildWide = (p: boolean): THREE.BufferGeometry | null => {
    const m = buildRoadMesh(data, groundAt, clayFor(p).roadWidth);
    return m ? toGeometry(m) : null;
  };
  const wideNow = (): THREE.BufferGeometry => {
    if (wideIsPhone !== phone) { wide?.dispose(); wide = buildWide(phone); wideIsPhone = phone; }
    return wide ?? geometry;
  };
  const asphalt = { value: displayColor(clayFor(false).asphalt) };

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uGrow: growU,                   /* SHARED with the facade's grow-in */
      ...(look ? { uStudio: look.studio, uHaze: look.haze, uHazeCol: look.hazeCol, uAsphalt: asphalt, uRoadA: { value: CLAY.roadAlpha } } : {}),
    },
    vertexShader: VERT,
    fragmentShader: look ? FRAG : FRAG_CLASSIC,
    transparent: true,
    depthWrite: false,                /* buildings occlude; roads never do */
    side: THREE.DoubleSide,           /* a mitre can wind either way */
  });

  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    ways: built.ways,
    ...(look ? {
      setStudio(v: boolean) { studio = v; mesh.geometry = v ? wideNow() : geometry; },
      setPhone(p: boolean) {
        phone = p;
        asphalt.value.copy(displayColor(clayFor(p).asphalt));
        if (studio) mesh.geometry = wideNow();
      },
    } : {}),
    dispose() { geometry.dispose(); wide?.dispose(); material.dispose(); },
  };
}
