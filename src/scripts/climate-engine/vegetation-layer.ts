import * as THREE from 'three';

export type Species = 'neem' | 'gulmohar' | 'palm';
export interface TreeInstance { x: number; y: number; h: number; species: Species; r: number; }
export interface TreesFile { ward: string; grid: number; sizeM: number; retrieved: string; trees: TreeInstance[]; }
export interface SpeciesAsset { geometry: THREE.BufferGeometry; material: THREE.Material; baseHeight: number; }
export type SpeciesAssets = Record<Species, SpeciesAsset>;

export interface VegetationLayer {
  readonly group: THREE.Group;
  setVisible(v: boolean): void;
  setTime(seconds: number, wind: number, windFrom: number): void;
  dispose(): void;
}

const SPECIES: Species[] = ['neem', 'gulmohar', 'palm'];

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
       float swayMask = clamp((position.y - 1.0) * 0.25, 0.0, 1.0);
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
  species: SpeciesAssets | null,
  _growU: { value: number },
  groundAt: ((x: number, y: number) => number) | null = null,
): VegetationLayer | null {
  if (!data || !species || data.trees.length === 0) return null;
  const group = new THREE.Group();
  const winds: Array<{ uTime: { value: number }; uWind: { value: THREE.Vector2 } }> = [];
  const owned: Array<{ dispose(): void }> = [];
  const dummy = new THREE.Object3D();
  const ground = groundAt ?? (() => 0);

  for (const sp of SPECIES) {
    const list = data.trees.filter((t) => t.species === sp);
    if (list.length === 0) continue;
    const asset = species[sp];
    const mat = asset.material.clone();
    winds.push(addWind(mat));
    const inst = new THREE.InstancedMesh(asset.geometry, mat, list.length);
    list.forEach((t, i) => {
      const s = t.h / asset.baseHeight;
      dummy.position.set(t.x, ground(t.x, t.y), t.y);
      dummy.scale.setScalar(s);
      dummy.rotation.set(0, (t.x * 13.1 + t.y * 7.7) % 6.283, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    owned.push({ dispose: () => { mat.dispose(); inst.dispose(); } });
  }

  const shadowTex = blobShadowTexture();
  const quad = new THREE.PlaneGeometry(1, 1); quad.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 });
  const shadows = new THREE.InstancedMesh(quad, shadowMat, data.trees.length);
  shadows.renderOrder = -1;
  data.trees.forEach((t, i) => {
    dummy.position.set(t.x, ground(t.x, t.y) + 0.05, t.y);
    dummy.scale.set(t.r * 2.2, 1, t.r * 2.2);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    shadows.setMatrixAt(i, dummy.matrix);
  });
  shadows.instanceMatrix.needsUpdate = true;
  group.add(shadows);
  owned.push({ dispose: () => { shadowTex.dispose(); quad.dispose(); shadowMat.dispose(); shadows.dispose(); } });

  return {
    group,
    setVisible(v) { group.visible = v; },
    setTime(seconds, wind, windFrom) {
      const rad = (windFrom * Math.PI) / 180;
      const mag = Math.min(0.5, wind / 30) * 0.4;
      for (const w of winds) { w.uTime.value = seconds; w.uWind.value.set(Math.sin(rad) * mag, Math.cos(rad) * mag); }
    },
    dispose() { for (const o of owned) o.dispose(); },
  };
}

export function assertVegetationLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`vegetation: ${m}`); };
  ok(asTreesFile(null) === null, 'null rejected');
  ok(asTreesFile({ trees: [{ x: 0, y: 0, h: 5, species: 'oak', r: 1 }] }) === null, 'bad species rejected');
  const f = asTreesFile({ ward: 'x', grid: 140, sizeM: 1400, retrieved: 'd', trees: [{ x: 1, y: 2, h: 6, species: 'palm', r: 2 }] });
  ok(f !== null && f.trees[0].species === 'palm', 'valid accepted');
  ok(createVegetationLayer(f, null, { value: 1 }) === null, 'no species assets -> null layer');
  ok(createVegetationLayer(null, null, { value: 1 }) === null, 'no data -> null layer');
}
