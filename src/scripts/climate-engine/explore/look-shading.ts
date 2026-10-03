/**
 * look-shading.ts — the shared pieces of the editorial look (see look.ts).
 *
 * Two things live here because more than one material needs them:
 *   · HAZE_GLSL — aerial perspective from screen depth. NOT `scene.fog`: this
 *     renderer replaces the camera's matrices with MapLibre's, so three's fog
 *     would key off the wrong distance. `gl_FragCoord.z` is the depth the GPU
 *     actually used, which is the right "how far" here. The banked lesson from
 *     the August pass (attic/heat-fx): haze toward a LIGHT COOL tone reads as
 *     depth; haze toward black reads as gloom.
 *   · makeContactAO — the footprints, rasterised and blurred twice, as a texture
 *     in the heat field's own texel convention (u = x/size + .5, v = y/size + .5,
 *     row 0 at the south edge, no flip) so it cannot mirror against the field.
 *     It is sun-independent by construction: a soft pool where a block meets the
 *     ground, the same under every sky. It is not a shadow and claims no shade.
 */
import * as THREE from 'three';

/** Where in the depth buffer the haze starts and saturates. Tuned at pitch 60. */
export const HAZE_GLSL = /* glsl */ `
  float lookHaze(){ return smoothstep(0.975, 0.9995, gl_FragCoord.z); }
`;

/** sRGB hex → a linear THREE.Color, for colours fed straight into a shader. */
export function srgbLinear(hex: string): THREE.Color {
  return new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
}

/**
 * sRGB hex → a THREE.Color holding the RAW display components, for shaders that
 * write gl_FragColor directly (ShaderMaterials here never include
 * colorspace_fragment) or that mix after a standard material's own conversion.
 */
export function displayColor(hex: string): THREE.Color {
  return new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace);
}

/** Separable box blur, in place over `src` into `dst`, radius `r` texels. */
function boxBlur(src: Float32Array, dst: Float32Array, n: number, r: number): void {
  if (r < 1) { dst.set(src); return; }
  const tmp = new Float32Array(n * n);
  const w = 2 * r + 1;
  for (let y = 0; y < n; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * n + Math.min(n - 1, Math.max(0, x))];
    for (let x = 0; x < n; x++) {
      tmp[y * n + x] = acc / w;
      acc += src[y * n + Math.min(n - 1, x + r + 1)] - src[y * n + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < n; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(n - 1, Math.max(0, y)) * n + x];
    for (let y = 0; y < n; y++) {
      dst[y * n + x] = acc / w;
      acc += tmp[Math.min(n - 1, y + r + 1) * n + x] - tmp[Math.max(0, y - r) * n + x];
    }
  }
}

/** Three box passes ≈ a gaussian. */
function softBlur(mask: Float32Array, n: number, r: number): Float32Array {
  const a = new Float32Array(n * n), b = new Float32Array(n * n);
  boxBlur(mask, a, n, r); boxBlur(a, b, n, r); boxBlur(b, a, n, r);
  return a;
}

/** Even-odd scanline fill of one ring (ward metres, x east / y north) into `mask`. */
function fillRing(mask: Float32Array, ring: readonly number[], start: number, n: number, sizeM: number): void {
  const pts: number[] = [];
  for (let i = start; i + 1 < ring.length; i += 2) {
    pts.push((ring[i] / sizeM + 0.5) * n, (ring[i + 1] / sizeM + 0.5) * n);
  }
  const k = pts.length / 2;
  if (k < 3) return;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < k; i++) { y0 = Math.min(y0, pts[i * 2 + 1]); y1 = Math.max(y1, pts[i * 2 + 1]); }
  const xs: number[] = [];
  for (let row = Math.max(0, Math.floor(y0)); row <= Math.min(n - 1, Math.ceil(y1)); row++) {
    const cy = row + 0.5;
    xs.length = 0;
    for (let i = 0, j = k - 1; i < k; j = i++) {
      const ya = pts[i * 2 + 1], yb = pts[j * 2 + 1];
      if ((ya > cy) === (yb > cy)) continue;
      xs.push(pts[i * 2] + ((cy - ya) / (yb - ya)) * (pts[j * 2] - pts[i * 2]));
    }
    xs.sort((a, b) => a - b);
    for (let m = 0; m + 1 < xs.length; m += 2) {
      for (let col = Math.max(0, Math.ceil(xs[m] - 0.5)); col <= Math.min(n - 1, Math.floor(xs[m + 1] - 0.5)); col++) {
        mask[row * n + col] = 1;
      }
    }
  }
}

/**
 * Bake the contact-occlusion texture for a ward.
 *
 * @param buildings `wardData.b` rows: [height, x0, y0, x1, y1, …] in ward metres.
 * @param sizeM     the ward's edge length; the texture spans it exactly.
 * @param n         texels per side.
 * @param nearM     radius of the tight contact blur, metres.
 */
export function makeContactAO(buildings: readonly (readonly number[])[], sizeM: number, n: number, nearM: number): THREE.DataTexture {
  const mask = new Float32Array(n * n);
  for (const b of buildings) fillRing(mask, b, 1, n, sizeM);
  const texelM = sizeM / n;
  const near = softBlur(mask, n, Math.max(1, Math.round(nearM / texelM)));
  const far = softBlur(mask, n, Math.max(1, Math.round(8 / texelM)));
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    /* Outside a footprint only: under the block the ground is hidden anyway, and
       zeroing it keeps the wall's neighbour sample from reading its own interior. */
    const outside = 1 - mask[i];
    data[i * 4] = Math.round(255 * Math.min(1, near[i] * 1.6) * outside);
    data[i * 4 + 1] = Math.round(255 * Math.min(1, far[i] * 1.4) * outside);
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
