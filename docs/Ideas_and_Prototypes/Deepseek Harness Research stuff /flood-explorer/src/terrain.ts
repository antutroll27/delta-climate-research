import * as THREE from 'three';
import { GRID, CELL, DOMAIN, mulberry32 } from './sim';

// Grid geometry shared by terrain + water. Vertex k === cell k; uv row j === data row j
// (no flip: DataTexture v=0 is row 0, our j=0 is the south coast).

export function makeGridGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(GRID * GRID * 3);
  const uv = new Float32Array(GRID * GRID * 2);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const k = j * GRID + i;
      pos[k * 3] = -DOMAIN / 2 + i * CELL;
      pos[k * 3 + 1] = 0;
      pos[k * 3 + 2] = -DOMAIN / 2 + j * CELL;
      uv[k * 2] = i / (GRID - 1);
      uv[k * 2 + 1] = j / (GRID - 1);
    }
  }
  const idx = new Uint32Array((GRID - 1) * (GRID - 1) * 6);
  let t = 0;
  for (let j = 0; j < GRID - 1; j++) {
    for (let i = 0; i < GRID - 1; i++) {
      const a = j * GRID + i, b = a + 1, c = a + GRID, d = c + 1;
      idx[t++] = a; idx[t++] = c; idx[t++] = b;
      idx[t++] = b; idx[t++] = c; idx[t++] = d;
    }
  }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function smooth01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export function buildTerrain(H: Float32Array): THREE.Mesh {
  const geo = makeGridGeometry();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let k = 0; k < GRID * GRID; k++) pos.setY(k, H[k]);
  pos.needsUpdate = true;
  const col = new Float32Array(GRID * GRID * 3);
  const cLow = new THREE.Color(0x1b2429);
  const cMid = new THREE.Color(0x27333a);
  const cHigh = new THREE.Color(0x44545c);
  const tmp = new THREE.Color();
  for (let k = 0; k < GRID * GRID; k++) {
    const t01 = Math.min(1, Math.max(0, H[k] / 38));
    tmp.copy(cLow).lerp(cMid, smooth01(t01 / 0.55)).lerp(cHigh, smooth01((t01 - 0.55) / 0.45));
    col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  return mesh;
}

export function worldToCell(x: number, z: number): { i: number; j: number } {
  const i = Math.min(GRID - 1, Math.max(0, Math.round((x + DOMAIN / 2) / CELL)));
  const j = Math.min(GRID - 1, Math.max(0, Math.round((z + DOMAIN / 2) / CELL)));
  return { i, j };
}

export function buildBuildings(H: Float32Array): THREE.InstancedMesh {
  const rnd = mulberry32(0x00c17a5);
  const clusters: Array<[number, number, number]> = [
    [0.36, 0.31, 200], [0.61, 0.41, 170], [0.45, 0.54, 150],
    [0.56, 0.24, 160], [0.40, 0.43, 140], [0.68, 0.55, 120],
  ];
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, 900);
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const Sv = new THREE.Vector3();
  const P = new THREE.Vector3();
  const AXIS = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  let n = 0;
  for (const [fx, fy, rad] of clusters) {
    const cx = (fx - 0.5) * DOMAIN, cz = (fy - 0.5) * DOMAIN;
    for (let t = 0; t < 110 && n < 900; t++) {
      const ang = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * rad;
      const x = cx + Math.cos(ang) * rr, z = cz + Math.sin(ang) * rr;
      const { i, j } = worldToCell(x, z);
      const k = j * GRID + i;
      const h = H[k];
      if (h < 0.6) continue;
      const hx = H[j * GRID + Math.min(GRID - 1, i + 1)] - H[j * GRID + Math.max(0, i - 1)];
      const hz = H[Math.min(GRID - 1, j + 1) * GRID + i] - H[Math.max(0, j - 1) * GRID + i];
      if (Math.hypot(hx, hz) > 2.4) continue;
      const w = 9 + rnd() * 14, d = 9 + rnd() * 14;
      const ht = 3.5 + rnd() * rnd() * 17;
      P.set(x, h + ht / 2 - 0.3, z);
      Sv.set(w, ht, d);
      Q.setFromAxisAngle(AXIS, (rnd() - 0.5) * 0.5);
      M.compose(P, Q, Sv);
      mesh.setMatrixAt(n, M);
      const v = 0.16 + rnd() * 0.10;
      col.setRGB(v * 1.05, v * 1.12, v * 1.18);
      mesh.setColorAt(n, col);
      n++;
    }
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = 'buildings';
  return mesh;
}
