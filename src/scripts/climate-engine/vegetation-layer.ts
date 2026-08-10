import * as THREE from 'three';

export type Species = 'neem' | 'gulmohar' | 'palm';
export interface TreeInstance { x: number; y: number; h: number; species: Species; r: number; }
export interface TreesFile { ward: string; grid: number; sizeM: number; retrieved: string; trees: TreeInstance[]; }

export interface VegetationLayer {
  readonly group: THREE.Group;
  setVisible(v: boolean): void;
  setTime(seconds: number, wind: number, windFrom: number): void;
  dispose(): void;
}

export function asTreesFile(raw: unknown): TreesFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.trees)) return null;
  const trees: TreeInstance[] = [];
  for (const t of d.trees) {
    if (!t || typeof t !== 'object') return null;
    const o = t as Record<string, unknown>;
    if (typeof o.x !== 'number' || typeof o.y !== 'number' || typeof o.h !== 'number' || typeof o.r !== 'number') return null;
    if (o.species !== 'neem' && o.species !== 'gulmohar' && o.species !== 'palm') return null;
    trees.push({ x: o.x, y: o.y, h: o.h, species: o.species, r: o.r });
  }
  return {
    ward: typeof d.ward === 'string' ? d.ward : '',
    grid: typeof d.grid === 'number' ? d.grid : 0,
    sizeM: typeof d.sizeM === 'number' ? d.sizeM : 0,
    retrieved: typeof d.retrieved === 'string' ? d.retrieved : '',
    trees,
  };
}

function addWind(material: THREE.Material): { uTime: { value: number }; uWind: { value: THREE.Vector2 } } {
  const uTime = { value: 0 }, uWind = { value: new THREE.Vector2(0, 0) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uWind = uWind;
    shader.vertexShader = `uniform float uTime;\nuniform vec2 uWind;\n` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       // Unit cone spans y in [-0.5, 0.5], apex at +0.5: bite toward the top.
       float swayMask = clamp(position.y + 0.5, 0.0, 1.0);
       float phase = uTime + transformed.x * 0.15 + transformed.z * 0.15;
       transformed.x += sin(phase) * uWind.x * swayMask;
       transformed.z += cos(phase * 0.9) * uWind.y * swayMask;`,
    );
  };
  return { uTime, uWind };
}

function blobShadowTexture(): THREE.Texture {
  const s = 64, cv = new OffscreenCanvas(s, s), g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}

export function createVegetationLayer(
  data: TreesFile | null,
  growU: { value: number },
  groundAt: ((x: number, y: number) => number) | null = null,
): VegetationLayer | null {
  void growU;
  if (!data || data.trees.length === 0) return null;
  const group = new THREE.Group();
  const ground = groundAt ?? (() => 0);
  const dummy = new THREE.Object3D();
  const trees = data.trees;
  const n = trees.length;

  // Discrete-minimal render: every tree is a flat-shaded cone crown on a short
  // trunk, instanced. The individual tree is illustrative (not surveyed), so a
  // moderate exaggeration keeps them legible at the twin's overhead camera —
  // the earlier per-species GLB render was invisible (tiny dark specks).
  const crownGeo = new THREE.ConeGeometry(1, 1, 7);
  const trunkGeo = new THREE.CylinderGeometry(0.7, 1.0, 1, 5);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x5db98a, roughness: 0.85, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9, flatShading: true });
  const wind = addWind(crownMat);

  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, n);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
  const color = new THREE.Color();

  trees.forEach((t, i) => {
    const g = ground(t.x, t.y);
    const treeH = Math.max(4, t.h) * 1.4;
    const crownH = treeH * 0.72;
    const crownR = Math.max(t.r, treeH * 0.32);
    const trunkH = treeH * 0.28;
    const trunkR = crownR * 0.14;

    dummy.position.set(t.x, g + trunkH + crownH / 2, t.y);
    dummy.scale.set(crownR, crownH, crownR);
    dummy.rotation.set(0, (t.x * 13.1 + t.y * 7.7) % 6.283, 0);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);

    const jitter = ((t.x * 12.9898 + t.y * 78.233) * 43758.5453) % 1;
    color.setHSL(0.34 + (jitter - 0.5) * 0.03, 0.5 + (jitter - 0.5) * 0.1, 0.42 + (jitter - 0.5) * 0.08);
    crowns.setColorAt(i, color);

    dummy.position.set(t.x, g + trunkH / 2, t.y);
    dummy.scale.set(trunkR, trunkH, trunkR);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
  });
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  trunks.instanceMatrix.needsUpdate = true;
  group.add(crowns, trunks);

  const shadowTex = blobShadowTexture();
  const quad = new THREE.PlaneGeometry(1, 1); quad.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 });
  const shadows = new THREE.InstancedMesh(quad, shadowMat, n);
  shadows.renderOrder = -1;
  trees.forEach((t, i) => {
    const treeH = Math.max(4, t.h) * 1.4;
    const crownR = Math.max(t.r, treeH * 0.32);
    dummy.position.set(t.x, ground(t.x, t.y) + 0.05, t.y);
    dummy.scale.set(crownR * 2.0, 1, crownR * 2.0);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    shadows.setMatrixAt(i, dummy.matrix);
  });
  shadows.instanceMatrix.needsUpdate = true;
  group.add(shadows);

  return {
    group,
    setVisible(v) { group.visible = v; },
    setTime(seconds, wind_, windFrom) {
      const rad = (windFrom * Math.PI) / 180;
      const mag = Math.min(0.5, wind_ / 30) * 0.4;
      wind.uTime.value = seconds;
      wind.uWind.value.set(Math.sin(rad) * mag, Math.cos(rad) * mag);
    },
    dispose() {
      crownGeo.dispose(); trunkGeo.dispose(); crownMat.dispose(); trunkMat.dispose(); crowns.dispose(); trunks.dispose();
      shadowTex.dispose(); quad.dispose(); shadowMat.dispose(); shadows.dispose();
    },
  };
}

export function assertVegetationLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`vegetation: ${m}`); };
  ok(asTreesFile(null) === null, 'null rejected');
  ok(asTreesFile({ trees: [{ x: 0, y: 0, h: 5, species: 'oak', r: 1 }] }) === null, 'bad species rejected');
  const f = asTreesFile({ ward: 'x', grid: 140, sizeM: 1400, retrieved: 'd', trees: [{ x: 1, y: 2, h: 6, species: 'palm', r: 2 }] });
  ok(f !== null && f.trees[0].species === 'palm', 'valid accepted');
  // No-data path only: constructing InstancedMeshes requires a WebGL-capable
  // renderer context that node does not provide, so real-data construction is
  // NOT exercised here (it is covered by the headless-browser screenshot check).
  ok(createVegetationLayer(null, { value: 1 }) === null, 'no data -> null layer');
}
