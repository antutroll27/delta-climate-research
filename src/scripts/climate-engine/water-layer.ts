/**
 * water-layer.ts — the ward's water, as animated surfaces in the city scene.
 *
 * RENDER ONLY. This module draws water polygons and, for Bengaluru, open drain and
 * stream centrelines ({ward}-water.json) and touches nothing in the physics. The
 * solver's water terms exist, but `WATER_LAYER_ENABLED` is false: feeding them was
 * measured and made agreement with ECOSTRESS worse (docs/evidence/known-limitations.md
 * §7). An earlier version of this header said that gate was opened; it was closed again.
 *
 * WHAT MAKES IT READ AS WATER AND NOT A BLUE HOLE. Three things, all derived
 * from geometry alone — no bathymetry, no API, nothing invented:
 *
 *   depth      water-depth.ts turns distance-from-shore into a field, so large
 *              bodies darken toward their middles and tanks stay shallow. The
 *              same field, quantised, gives the cut-paper contour bands.
 *   ripples    two crossed wave trains, plus a third for glint. Rivers drift
 *              their whole pattern downstream; still water shimmers in place.
 *   light      an analytic normal from those waves, lit by a sun direction and
 *              viewed from the map's own camera, giving a specular streak that
 *              swings as you orbit. That is the "reflection" — a real one needs
 *              a render-to-texture pass this shared GL context has no room for,
 *              and at this scale a moving highlight sells it better anyway.
 *
 * THE ANIMATION RIDES EXISTING REPAINTS. No rAF of its own: the caller advances
 * uTime inside the MapLibre custom-layer render callback, which runs when the
 * map repaints — continuously during the idle orbit and drags, and at the sim
 * bridge's cadence otherwise. Under prefers-reduced-motion the caller never
 * advances uTime: still water, correct depth, no motion.
 *
 * One mesh, one draw call: rings become ShapeGeometries, merged.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WaterData } from './heat-map-model';
import { buildDepthField, openLines, waterFieldM } from './water-depth';
import { buildRibbonMesh } from './road-ribbon';
import { displayColor, HAZE_GLSL } from './explore/look-shading';
import { CLAY } from './explore/look';

/**
 * The editorial look's holders (explore/look.ts), shared with the relief renderer.
 * Absent — `?look=classic` — the classic shader is used unchanged.
 */
export interface WaterLook {
  studio: { value: number };
  /** unit vector, scene frame (+x east, +y up, +z north) — the real sun */
  sun: { value: THREE.Vector3 };
  /** what a grazing view reflects: the environment's horizon */
  sky: { value: THREE.Color };
  haze: { value: number };
  hazeCol: { value: THREE.Color };
}

export interface WaterLayer {
  readonly mesh: THREE.Mesh;
  /** advance the shimmer; call from the render loop with seconds */
  setTime(seconds: number): void;
  /** point the specular streak — bearing and pitch in degrees, from the map */
  setView(bearingDeg: number, pitchDeg: number): void;
  dispose(): void;
}

/** Water sits just above the heat overlay (y=0.6) and below every roof. */
const SURFACE_Y = 0.9;

/**
 * How wide a drawn centreline is. ILLUSTRATIVE, NOT MEASURED: no open source gives
 * Bengaluru drain widths (OSM tags one of 38 MG Road reaches). 3 m is the Blender
 * scenes' STREAM_WIDTH_M, so the web map and the offline renders agree.
 */
export const WATER_LINE_WIDTH_M = 3;

const VERT = /* glsl */ `
  attribute float aFlow;
  varying vec2 vPos;
  varying float vFlow;
  void main() {
    vPos = vec2(position.x, position.z);
    vFlow = aFlow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/** The water shipped until 2026-10-02, kept unchanged for `?look=classic`. Its
    sun is a FIXED north-east direction; the editorial `FRAG` below uses the real one. */
const FRAG_CLASSIC = /* glsl */ `
  precision highp float;
  uniform sampler2D tDepth;
  uniform float uTime;
  uniform float uGrow;
  uniform float uFieldSize;
  uniform vec3  uView;
  varying vec2 vPos;
  varying float vFlow;

  /* Turquoise, shallow to deep. Kept close to the stage's cyan at the shore so
     the water belongs to the map, and running green-blue into the dark so a
     river reads as depth rather than as a hole cut in the ground. */
  const vec3 SHORE = vec3(0.639, 0.898, 0.867);
  const vec3 MID   = vec3(0.165, 0.655, 0.616);
  const vec3 DEEP  = vec3(0.024, 0.267, 0.310);

  /* Depth terraces. Not hard steps: floor() gives a cut-paper edge, which reads
     as a rendering artefact on something that is supposed to be liquid. Instead
     each band is crossed with a smoothstep, so the colour passes through every
     intermediate shade and only LINGERS near the band centres. The result still
     reads as layered depth, with nothing anywhere to catch the eye as a line. */
  const float BANDS = 5.0;

  float waves(vec2 p, float t, out vec2 slope) {
    float a = sin(p.x * 1.7 + p.y * 2.3 + t * 1.05);
    float b = sin(p.x * 2.9 - p.y * 1.3 - t * 0.65 + 1.7);
    slope = vec2(
      1.7 * cos(p.x * 1.7 + p.y * 2.3 + t * 1.05) + 2.9 * cos(p.x * 2.9 - p.y * 1.3 - t * 0.65 + 1.7),
      2.3 * cos(p.x * 1.7 + p.y * 2.3 + t * 1.05) - 1.3 * cos(p.x * 2.9 - p.y * 1.3 - t * 0.65 + 1.7)
    );
    return (a + b) * 0.5;
  }

  void main() {
    /* Depth is sampled in the ward's own metre frame, so it stays put while the
       ripples move over it — the contours are the ground, not the animation. */
    vec2 uv = vPos / uFieldSize + 0.5;
    float depth = texture2D(tDepth, uv).r;

    vec2 p = vPos * 0.085;
    p.y += uTime * 0.32 * vFlow;                 /* rivers carry their pattern */
    vec2 slope;
    float swell = waves(p, uTime, slope);

    /* Deep water is calmer at the surface and the shallows chop — so ripple
       amplitude falls with depth, which also keeps the contour edges legible. */
    float chop = mix(1.0, 0.45, depth);

    /* Terrace, then dissolve the terrace. smoothstep on the fraction is flat at
       both ends of each band, so the shade eases out of one layer and into the
       next with a continuous derivative — no seam exists to be seen, even where
       the ripple pushes the boundary about. */
    float t = depth * BANDS + swell * 0.06 * chop;
    float shade = (floor(t) + smoothstep(0.0, 1.0, fract(t))) / BANDS;

    vec3 col = shade < 0.5
      ? mix(SHORE, MID, shade * 2.0)
      : mix(MID, DEEP, (shade - 0.5) * 2.0);

    /* Where the shade is changing fastest — the middle of a crossing — lift it a
       little. That is the old contour seam, kept as a soft sheen rather than a
       drawn line: it says "a layer passed here" without ever hardening. */
    float crossing = 1.0 - abs(fract(t) * 2.0 - 1.0);
    col += SHORE * 0.05 * crossing * crossing;

    /* Shore lightening — shallow margins catch the light everywhere. */
    col = mix(col, SHORE, 0.30 * (1.0 - smoothstep(0.0, 0.28, depth)));

    /* Analytic normal from the wave slope, then a specular streak from a fixed
       sun toward the map's actual view direction, so the highlight swings as
       the map orbits instead of sitting painted on. */
    vec3 n = normalize(vec3(-slope.x * 0.035 * chop, 1.0, -slope.y * 0.035 * chop));
    vec3 sun = normalize(vec3(0.45, 0.72, -0.35));
    float spec = pow(max(dot(reflect(-sun, n), normalize(uView)), 0.0), 34.0);
    col += vec3(0.85, 0.97, 0.95) * spec * 0.55;

    /* Grazing angles reflect more — the cheap Fresnel that stops flat water
       looking like paint when the camera pitches over. */
    float fres = pow(1.0 - max(dot(n, normalize(uView)), 0.0), 3.0);
    col += SHORE * fres * 0.20;

    float alpha = mix(0.66, 0.90, depth) * min(1.0, uGrow * 1.6);
    gl_FragColor = vec4(col, alpha);
  }`;

/* ── The editorial water (the default). ONE pass, one draw, like the classic
   shader: no reflection target, no refraction copy — the GL context is
   MapLibre's. What changes against classic:
     sun        the real solar direction, the same vector that aims the key light,
                so the glint sits where the compass says the sun is;
     Fresnel    a grazing view now turns toward the SKY's colour (Schlick, F0 .02)
                instead of brightening toward the shore tint;
     absorption colour follows Beer–Lambert on the shore-distance field — exp(−kd)
                — so depth is a continuous deepening, not five terraces;
     shore      the margin fades in over the first metres of the field, so the
                water edge is soft against the ground instead of cut out. */
const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tDepth;
  uniform float uTime, uGrow, uFieldSize, uStudio, uHaze, uMaxDistM, uKS;
  uniform vec3 uView, uSun, uSky, uHazeCol;
  uniform vec3 uShallowS, uDeepS;
  varying vec2 vPos;
  varying float vFlow;
  ${HAZE_GLSL}
  const vec3 SHALLOW_D = vec3(0.420, 0.760, 0.740);
  const vec3 DEEP_D    = vec3(0.045, 0.300, 0.340);

  float waves(vec2 p, float t, out vec2 slope) {
    float a = sin(p.x * 1.7 + p.y * 2.3 + t * 1.05);
    float b = sin(p.x * 2.9 - p.y * 1.3 - t * 0.65 + 1.7);
    slope = vec2(
      1.7 * cos(p.x * 1.7 + p.y * 2.3 + t * 1.05) + 2.9 * cos(p.x * 2.9 - p.y * 1.3 - t * 0.65 + 1.7),
      2.3 * cos(p.x * 1.7 + p.y * 2.3 + t * 1.05) - 1.3 * cos(p.x * 2.9 - p.y * 1.3 - t * 0.65 + 1.7)
    );
    return (a + b) * 0.5;
  }

  void main() {
    vec2 uv = vPos / uFieldSize + 0.5;
    float depth = texture2D(tDepth, uv).r;
    vec2 p = vPos * 0.085;
    p.y += uTime * 0.32 * vFlow;
    vec2 slope;
    waves(p, uTime, slope);
    float chop = mix(1.0, 0.45, depth);
    bool stu = uStudio > 0.5;

    /* Beer–Lambert on METRES from shore (the field is normalised to the ward's
       widest water; uMaxDistM undoes that), so a tank and a river shelve alike:
       the colour has sunk ~63 % by 18 m out, wherever that water is. */
    float dM = depth * uMaxDistM;
    float absorb = 1.0 - exp(-dM / (stu ? uKS : 18.0));
    vec3 col = mix(stu ? uShallowS : SHALLOW_D, stu ? uDeepS : DEEP_D, absorb);

    vec3 n = normalize(vec3(-slope.x * 0.03 * chop, 1.0, -slope.y * 0.03 * chop));
    vec3 v = normalize(uView);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    col = mix(col, uSky, clamp(fres * (stu ? 0.55 : 0.7), 0.0, 0.5));

    vec3 sun = normalize(uSun);
    float spec = pow(max(dot(reflect(-sun, n), v), 0.0), 60.0);
    col += (stu ? vec3(0.98, 0.98, 0.95) : vec3(0.85, 0.97, 0.95)) * spec * (stu ? 0.30 : 0.45) * smoothstep(0.0, 0.25, sun.y);

    col = mix(col, uHazeCol, lookHaze() * uHaze);
    /* The margin fades in over its first ~5 m, so the edge is soft, not cut. */
    float shore = smoothstep(0.0, 5.0, dM);
    float alpha = mix(0.74, 0.94, absorb) * mix(0.30, 1.0, shore) * min(1.0, uGrow * 1.6);
    gl_FragColor = vec4(col, alpha);
  }`;

/** Ring → a flat ShapeGeometry in the scene's frame, or null if degenerate. */
function ringGeometry(flat: readonly number[]): THREE.ShapeGeometry | null {
  if (flat.length < 6) return null;
  /* Same frame convention as the building extrusions: file y (north) becomes
     shape -y, and rotateX(-PI/2) lays the sheet flat onto the map. */
  const shape = new THREE.Shape();
  shape.moveTo(flat[0], -flat[1]);
  for (let i = 2; i + 1 < flat.length; i += 2) shape.lineTo(flat[i], -flat[i + 1]);
  try {
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  } catch {
    return null;
  }
}

/** The shore-distance field, as a single-channel texture the shader samples. */
function depthTexture(data: WaterData): THREE.DataTexture & { maxDistM?: number } {
  const field = buildDepthField(data.polys, waterFieldM(data));
  const texture = new THREE.DataTexture(field.data, field.n, field.n, THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return Object.assign(texture, { maxDistM: field.maxDistM });
}

/**
 * @param groundAt Optional ground height, metres, at a point in the ward frame.
 *   Each water body is seated at the ground beneath ITS OWN centroid — a single
 *   flat sheet would bury half the ponds and float the rest once the ground has
 *   relief. Seated per body rather than per vertex because a pond's surface is
 *   level even when the land around it is not; per-vertex displacement would tilt
 *   water downhill, which is the one thing water visibly never does.
 */
export function createWaterLayer(
  data: WaterData,
  growU: { value: number },
  groundAt: ((x: number, y: number) => number) | null = null,
  look?: WaterLook,
): WaterLayer | null {
  const geometries: THREE.BufferGeometry[] = [];
  for (const poly of data.polys) {
    const geometry = ringGeometry(poly.p);
    if (!geometry) continue;
    /* The shader reads only position and aFlow. Dropping the rest lets rings merge
       with centreline ribbons, which carry nothing else. */
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    const count = geometry.attributes.position.count;
    const flow = new Float32Array(count).fill(poly.k === 'river' ? 1 : 0);
    geometry.setAttribute('aFlow', new THREE.BufferAttribute(flow, 1));
    if (groundAt) {
      let cx = 0, cy = 0;
      for (let i = 0; i < poly.p.length; i += 2) { cx += poly.p[i]; cy += poly.p[i + 1]; }
      const n = poly.p.length / 2;
      geometry.translate(0, groundAt(cx / n, cy / n), 0);
    }
    geometries.push(geometry);
  }
  /* OPEN CENTRELINES, as ribbons that follow the land — a drain runs downhill, unlike
     a pond's level surface — through the same builder roads use. They flow. */
  const ribbons = buildRibbonMesh(openLines(data), () => WATER_LINE_WIDTH_M / 2,
    groundAt ?? (() => 0), 0);
  if (ribbons) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(ribbons.positions, 3));
    g.setIndex(new THREE.BufferAttribute(ribbons.indices, 1));
    g.setAttribute('aFlow', new THREE.BufferAttribute(
      new Float32Array(ribbons.positions.length / 3).fill(1), 1));
    geometries.push(g);
  }
  if (!geometries.length) return null;

  const merged = mergeGeometries(geometries, false);
  geometries.forEach(g => g.dispose());
  if (!merged) return null;

  const tDepth = depthTexture(data);
  const timeU = { value: 0 };
  const viewU = { value: new THREE.Vector3(0, 1, 0) };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDepth: { value: tDepth },
      uTime: timeU,
      uGrow: growU,                     /* SHARED with the facade's grow-in */
      uFieldSize: { value: waterFieldM(data) },
      uView: viewU,
      ...(look ? {
        uMaxDistM: { value: Math.max(1, tDepth.maxDistM ?? 1) },
        uStudio: look.studio, uSun: look.sun, uSky: look.sky, uHaze: look.haze, uHazeCol: look.hazeCol,
        /* Clay: a soft teal-green shallows into a deep teal (CLAY.water*). */
        uShallowS: { value: displayColor(CLAY.waterShallow) }, uDeepS: { value: displayColor(CLAY.waterDeep) },
        uKS: { value: CLAY.waterK },
      } : {}),
    },
    vertexShader: VERT,
    fragmentShader: look ? FRAG : FRAG_CLASSIC,
    transparent: true,
    depthWrite: false,                  /* buildings occlude; water never does */
    side: THREE.DoubleSide,             /* a ribbon mitre can wind either way */
  });
  const mesh = new THREE.Mesh(merged, material);
  mesh.position.y = SURFACE_Y;
  mesh.renderOrder = 0;                 /* after the heat overlay's -1 */

  return {
    mesh,
    setTime(seconds: number) { timeU.value = seconds; },
    setView(bearingDeg: number, pitchDeg: number) {
      /* The map's camera as a direction in the scene's frame. Pitch 0 looks
         straight down, so the vertical component is cos(pitch). Taken from the
         map rather than the three camera because that camera has a hand-assigned
         projection matrix and no usable world transform. */
      const bearing = (bearingDeg * Math.PI) / 180;
      const pitch = (pitchDeg * Math.PI) / 180;
      viewU.value.set(
        Math.sin(bearing) * Math.sin(pitch),
        Math.cos(pitch),
        -Math.cos(bearing) * Math.sin(pitch),
      ).normalize();
    },
    dispose() { merged.dispose(); material.dispose(); tDepth.dispose(); },
  };
}
