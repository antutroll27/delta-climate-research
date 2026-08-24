import * as THREE from 'three';
import { GRID, DOMAIN } from './sim';
import { makeGridGeometry } from './terrain';

const VERT = /* glsl */ `
uniform sampler2D uH;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;
varying float vD;
varying vec3 vW;
void main() {
  float h = texture2D(uH, uv).r;
  float d = mix(texture2D(uA, uv).r, texture2D(uB, uv).r, uMix);
  vD = d;
  vec3 p = position;
  p.y = h + d - 0.04;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uCine;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uBg;
varying float vD;
varying vec3 vW;
void main() {
  if (vD <= 0.004) discard;
  float dn = clamp(vD / 2.4, 0.0, 1.0);
  vec3 col = mix(uShallow, uMid, smoothstep(0.0, 0.32, dn));
  col = mix(col, uDeep, smoothstep(0.32, 1.0, dn));
  float w1 = sin(vW.x * 0.11 + uTime * 1.4) + sin(vW.z * 0.127 - uTime * 1.1);
  float w2 = sin((vW.x + vW.z) * 0.052 + uTime * 0.8);
  vec3 n = normalize(vec3(w1 * 0.04, 1.0, w2 * 0.035));
  vec3 V = normalize(cameraPosition - vW);
  vec3 L = normalize(vec3(0.35, 0.8, 0.30));
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  float spec = pow(max(dot(reflect(-L, n), V), 0.0), 90.0);
  col += fres * vec3(0.30, 0.45, 0.48) * (0.22 + 0.60 * uCine);
  col += spec * (0.10 + 0.90 * uCine) * vec3(0.85, 0.98, 1.0);
  float a = smoothstep(0.004, 0.07, vD) * (0.60 + 0.28 * uCine);
  float dist = length(cameraPosition - vW);
  float fade = smoothstep(2300.0, 3100.0, dist);
  col = mix(col, uBg, fade);
  a *= (1.0 - fade);
  gl_FragColor = vec4(col, a);
}
`;

export interface Water {
  mesh: THREE.Mesh;
  setSnapshots(a: THREE.Texture, b: THREE.Texture, mix: number): void;
  setTime(t: number): void;
  setCine(on: boolean): void;
}

export function makeWater(H: Float32Array): Water {
  const geo = makeGridGeometry();
  const hTex = new THREE.DataTexture(H, GRID, GRID, THREE.RedFormat, THREE.FloatType);
  hTex.magFilter = THREE.NearestFilter;
  hTex.minFilter = THREE.NearestFilter;
  hTex.needsUpdate = true;
  const lin = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();
  const uniforms = {
    uH: { value: hTex },
    uA: { value: hTex as THREE.Texture },
    uB: { value: hTex as THREE.Texture },
    uMix: { value: 0 },
    uTime: { value: 0 },
    uCine: { value: 1 },
    uShallow: { value: lin(0x6fcad6) },
    uMid: { value: lin(0x0e3d42) },
    uDeep: { value: lin(0x06181f) },
    uBg: { value: lin(0x050606) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'water';
  return {
    mesh,
    setSnapshots(a, b, mix) {
      uniforms.uA.value = a;
      uniforms.uB.value = b;
      uniforms.uMix.value = mix;
    },
    setTime(t) { uniforms.uTime.value = t; },
    setCine(on) { uniforms.uCine.value = on ? 1 : 0; },
  };
}

export function snapshotTexture(depth: Float32Array): THREE.DataTexture {
  const t = new THREE.DataTexture(depth, GRID, GRID, THREE.RedFormat, THREE.FloatType);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
