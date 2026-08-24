import * as THREE from 'three';

const COUNT = 1500;
const BOX = 1500;
const TOP = 550;

export interface Rain {
  lines: THREE.LineSegments;
  update(dt: number): void;
}

export function makeRain(): Rain {
  const pos = new Float32Array(COUNT * 2 * 3);
  const meta = new Float32Array(COUNT * 4); // x, y, z, speed
  const len = new Float32Array(COUNT);
  for (let k = 0; k < COUNT; k++) {
    meta[k * 4] = (Math.random() * 2 - 1) * BOX;
    meta[k * 4 + 1] = Math.random() * TOP;
    meta[k * 4 + 2] = (Math.random() * 2 - 1) * BOX;
    meta[k * 4 + 3] = 70 + Math.random() * 60;
    len[k] = 7 + Math.random() * 9;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x9fd8dd, transparent: true, opacity: 0.2, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.name = 'rain';
  return {
    lines,
    update(dt: number) {
      for (let k = 0; k < COUNT; k++) {
        let y = meta[k * 4 + 1] - meta[k * 4 + 3] * dt;
        if (y < 0) y += TOP;
        meta[k * 4 + 1] = y;
        const o = k * 6;
        pos[o] = meta[k * 4]; pos[o + 1] = y; pos[o + 2] = meta[k * 4 + 2];
        pos[o + 3] = meta[k * 4]; pos[o + 4] = y + len[k]; pos[o + 5] = meta[k * 4 + 2];
      }
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    },
  };
}
