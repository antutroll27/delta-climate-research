/** Meshes for the real Dubai site: readable terrain, and extruded footprints. */
import * as THREE from 'three';
import { type SiteData, TERRAIN_EXAG, estimateHeight, ringArea, sampleGround } from './dubai';

/**
 * Terrain mesh.
 *
 * WHY A SHADER AND NOT VERTEX COLOURS. The previous build coloured by elevation
 * alone into a MeshStandardMaterial, and against a near-black page the result was
 * invisible: you could not tell a basin from a ridge. Real relief here is 5.66 m
 * over 7.68 km, so elevation banding has almost nothing to band. What makes flat
 * ground legible is SLOPE — hillshading — so the surface is lit analytically by a
 * low sun and the elevation ramp only tints it.
 */
export function buildTerrain(site: SiteData): THREE.Mesh {
  const { n, domainM, h, bcr } = site;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  const step = domainM / (n - 1);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      pos[k * 3] = -domainM / 2 + i * step;
      pos[k * 3 + 1] = h[k] * TERRAIN_EXAG;
      pos[k * 3 + 2] = -domainM / 2 + j * step;
      uv[k * 2] = i / (n - 1);
      uv[k * 2 + 1] = j / (n - 1);
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let t = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[t++] = a; idx[t++] = c; idx[t++] = b;
      idx[t++] = b; idx[t++] = c; idx[t++] = d;
    }
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // Elevation and built-fraction ride along as attributes so the shader can tint
  // sabkha, sand and built ground differently without a texture fetch.
  const elev = new Float32Array(n * n);
  const built = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) { elev[k] = h[k]; built[k] = bcr[k]; }
  geo.setAttribute('aElev', new THREE.BufferAttribute(elev, 1));
  geo.setAttribute('aBuilt', new THREE.BufferAttribute(built, 1));
  geo.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uLow: { value: new THREE.Color(0x4a6570).convertSRGBToLinear() },
      uMid: { value: new THREE.Color(0xb0a389).convertSRGBToLinear() },
      uHigh: { value: new THREE.Color(0xe4dac2).convertSRGBToLinear() },
      uBuilt: { value: new THREE.Color(0x8b8b88).convertSRGBToLinear() },
      uSun: { value: new THREE.Vector3(0.55, 0.42, 0.72).normalize() },
      uRange: { value: new THREE.Vector2(-2.0, 8.6) },
    },
    vertexShader: /* glsl */ `
      attribute float aElev;
      attribute float aBuilt;
      varying float vElev; varying float vBuilt; varying vec3 vN; varying vec3 vW;
      void main() {
        vElev = aElev; vBuilt = aBuilt;
        vN = normalize(normalMatrix * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uLow, uMid, uHigh, uBuilt, uSun;
      uniform vec2 uRange;
      varying float vElev; varying float vBuilt; varying vec3 vN; varying vec3 vW;
      void main() {
        float t = clamp((vElev - uRange.x) / max(uRange.y - uRange.x, 0.001), 0.0, 1.0);
        vec3 col = mix(uLow, uMid, smoothstep(0.0, 0.55, t));
        col = mix(col, uHigh, smoothstep(0.55, 1.0, t));
        col = mix(col, uBuilt, clamp(vBuilt, 0.0, 1.0) * 0.65);
        // Analytic hillshade. This is what makes 5 m of relief readable at all.
        vec3 nrm = normalize(vN);
        float lambert = clamp(dot(nrm, normalize(uSun)), 0.0, 1.0);
        float ambient = 0.72 + 0.28 * nrm.y;
        col *= (ambient + 1.05 * lambert);
        // grazing-angle rim so the diorama edge reads against the black page
        float rim = pow(1.0 - abs(nrm.y), 3.0);
        col += rim * vec3(0.05, 0.09, 0.10);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  return mesh;
}

/**
 * Buildings: every real footprint extruded to an estimated height.
 *
 * Built by hand rather than with ExtrudeGeometry — 13,577 separate
 * ExtrudeGeometry calls plus a merge is slow and allocates heavily, while walls
 * and a triangulated roof are a few hundred lines of arithmetic and land in one
 * buffer. Roofs are triangulated with ShapeUtils so concave footprints survive.
 */
export function buildBuildings(site: SiteData): THREE.Mesh {
  const verts: number[] = [];
  const norms: number[] = [];
  const shade: number[] = [];
  const tmp = new THREE.Vector2();

  site.rings.forEach((p, ri) => {
    const nv = p.length / 2;
    if (nv < 3) return;
    const area = ringArea(p);
    if (area < 12) return;
    const height = estimateHeight(area, ri + 1);

    // Ground under the footprint, on the exaggerated surface.
    let gx = 0, gy = 0;
    for (let i = 0; i < nv; i++) { gx += p[i * 2]; gy += p[i * 2 + 1]; }
    const base = sampleGround(site, gx / nv, gy / nv) * TERRAIN_EXAG - 0.5;
    const top = base + height;

    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < nv; i++) contour.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
    if (THREE.ShapeUtils.area(contour) < 0) contour.reverse();

    // walls
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i], b = contour[(i + 1) % contour.length];
      tmp.set(b.y - a.y, -(b.x - a.x)).normalize();
      const nx = tmp.x, nz = tmp.y;
      const quad = [
        a.x, base, a.y, b.x, base, b.y, b.x, top, b.y,
        a.x, base, a.y, b.x, top, b.y, a.x, top, a.y,
      ];
      for (let q = 0; q < quad.length; q += 3) {
        verts.push(quad[q], quad[q + 1], quad[q + 2]);
        norms.push(nx, 0, nz);
        // vertical gradient: darker at the base, so massing reads without AO
        shade.push(0.55 + 0.45 * ((quad[q + 1] - base) / Math.max(height, 0.001)));
      }
    }
    // roof
    for (const tri of THREE.ShapeUtils.triangulateShape(contour, [])) {
      for (const vi of tri) {
        const v = contour[vi];
        verts.push(v.x, top, v.y);
        norms.push(0, 1, 0);
        shade.push(1.0);
      }
    }
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  geo.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: new THREE.Color(0xbdb3a0).convertSRGBToLinear() },
      uRoof: { value: new THREE.Color(0xe8dfc9).convertSRGBToLinear() },
      uSun: { value: new THREE.Vector3(0.55, 0.42, 0.72).normalize() },
    },
    vertexShader: /* glsl */ `
      attribute float aShade;
      varying float vShade; varying vec3 vN;
      void main() {
        vShade = aShade; vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uBase, uRoof, uSun;
      varying float vShade; varying vec3 vN;
      void main() {
        vec3 nrm = normalize(vN);
        vec3 col = mix(uBase, uRoof, clamp(nrm.y, 0.0, 1.0));
        float lambert = clamp(dot(nrm, normalize(uSun)), 0.0, 1.0);
        col *= (0.55 + 0.80 * lambert) * vShade;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'buildings';
  return mesh;
}
