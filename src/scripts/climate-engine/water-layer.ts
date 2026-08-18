/**
 * water-layer.ts — the ward's water, as animated surfaces in the city scene.
 *
 * RENDER ONLY, STILL — but the sentence that followed is no longer true, and the
 * change is worth naming here because this file is where a reader looks for it.
 * This module draws OSM water polygons ({ward}-water.json, fetched by
 * scripts/fetch-water.py) and touches nothing in the physics. It used to add that
 * SimLayers.water "stays zero", and that the sim's water terms (sim-ts.ts
 * ventilation + relaxation) were gated behind the calibration protocol.
 *
 * THAT GATE WAS OPENED ON 2026-08-13. `rasterizeWardWater` (ward-raster.ts) now fills
 * the layer from these same polygons, so the terms are live and the ward mean has
 * moved. The protocol ran rather than being bypassed: docs/heat-map-water-layer.md
 * carries the before/after against ECOSTRESS. What is still true is the SPLIT — this
 * file is the look, the rasteriser is the physics, and they share only the artefact.
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
import { buildDepthField } from './water-depth';

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

/** The frame the depth field covers. Matches CLIP_M*2 in scripts/fetch-water.py,
 *  so a polygon clipped at the artefact's edge is clipped at the field's edge. */
const FIELD_SIZE_M = 1520;

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
function depthTexture(data: WaterData): THREE.DataTexture {
  const field = buildDepthField(data.polys, FIELD_SIZE_M);
  const texture = new THREE.DataTexture(field.data, field.n, field.n, THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
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
): WaterLayer | null {
  const geometries: THREE.BufferGeometry[] = [];
  for (const poly of data.polys) {
    const geometry = ringGeometry(poly.p);
    if (!geometry) continue;
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
      uFieldSize: { value: FIELD_SIZE_M },
      uView: viewU,
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,                  /* buildings occlude; water never does */
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
