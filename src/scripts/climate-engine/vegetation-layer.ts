import * as THREE from 'three';
import { HAZE_GLSL, srgbLinear } from './explore/look-shading';
import { CLAY } from './explore/look';

/** The editorial look's holders, shared with the relief renderer (explore/look.ts). */
export interface VegetationLook {
  studio: { value: number };
  haze: { value: number };
  hazeCol: { value: THREE.Color };
}

export type Species = 'neem' | 'gulmohar' | 'palm';
export interface TreeInstance { x: number; y: number; h: number; species: Species; r: number; }
export interface TreesFile { ward: string; grid: number; sizeM: number; retrieved: string; trees: TreeInstance[]; }

export interface VegetationLayer {
  readonly group: THREE.Group;
  setVisible(v: boolean): void;
  /**
   * The CROWNS and their blob shadows, without the trunks.
   *
   * Two switches over one group, because the layer tree offers two rows over one
   * measurement: the tree instances, and the canopy those instances carry. A
   * shadow follows its crown rather than its trunk — it is the canopy's shadow, a
   * disc scaled from `crownR` — so hiding one without the other would leave a
   * ward's worth of shade cast by nothing.
   */
  setCanopyVisible(v: boolean): void;
  setTime(seconds: number, wind: number, windFrom: number): void;
  /** Editorial look only: Clay swaps to the planting crowns, Dark keeps the classic ones. */
  setStudio?(studio: boolean): void;
  dispose(): void;
}

/** The on-disk row format written by scripts/_trees.py. The order is the contract. */
export const TREE_COLS = ['x_m', 'y_m', 'h_dm', 'r_dm', 'species'] as const;
const SPECIES_NAMES: readonly Species[] = ['neem', 'gulmohar', 'palm'];

export function asTreesFile(raw: unknown): TreesFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  /* ONE FORMAT, AND THE OLD ONE IS REFUSED. A reader that also accepted the old
     object rows would hide a half-migrated artefact set: some wards would render
     and nothing would say the rest were stale. The rows are decoded here, at the
     boundary, so everything that draws a tree still sees TreeInstance objects. */
  if (!Array.isArray(d.cols) || d.cols.length !== TREE_COLS.length
      || d.cols.some((c, i) => c !== TREE_COLS[i])) return null;
  if (!Array.isArray(d.speciesNames)) return null;
  const names = d.speciesNames as unknown[];
  if (names.some((n) => !SPECIES_NAMES.includes(n as Species))) return null;
  if (!Array.isArray(d.trees)) return null;
  const trees: TreeInstance[] = [];
  for (const row of d.trees) {
    if (!Array.isArray(row) || row.length !== TREE_COLS.length) return null;
    const [x, y, hDm, rDm, s] = row as unknown[];
    if (typeof x !== 'number' || typeof y !== 'number' || typeof hDm !== 'number'
        || typeof rDm !== 'number' || typeof s !== 'number' || !Number.isInteger(s)
        /* JSON.parse turns 1e400 into Infinity, which would land in the instance matrix. */
        || ![x, y, hDm, rDm].every(Number.isFinite)) return null;
    const species = names[s];
    if (species === undefined) return null;
    trees.push({ x, y, h: hDm / 10, species: species as Species, r: rDm / 10 });
  }
  return {
    ward: typeof d.ward === 'string' ? d.ward : '',
    grid: typeof d.grid === 'number' ? d.grid : 0,
    sizeM: typeof d.sizeM === 'number' ? d.sizeM : 0,
    retrieved: typeof d.retrieved === 'string' ? d.retrieved : '',
    trees,
  };
}

/* ── The editorial Clay planting (explore/look.ts). ──────────────────────────── */
/** Crown underside value, × the albedo at the bottom of the ball (1 = no form shading). */
const CROWN_UNDER = 0.24;
/** The infographic's pale greens (LEAF → MOSS, lifted toward PALE in the lighter trees). */
const CROWN_LEAF = '#7fae78', CROWN_MOSS = '#5f8f4e', CROWN_PALE = '#a9c99a';
/** A deeper, fuller moss (MOSS → DEEP, highlight HI). On its own it read heavy. */
const CROWN_MOSS_FULL = '#457d37', CROWN_DEEP = '#2f5f26', CROWN_HI = '#5f9e4f';
/** Each crown sits this far from the full moss toward the pale greens: the founder's
    middle ground between the pale infographic and the contrast pass. */
const CROWN_PALE_SHARE = 0.65;
/** Clay trunk: a lighter bark, so a trunk does not read as a hole in the paper. */
const STUDIO_TRUNK = 0x7a6a58;
/** Clay blob under each crown: firmer than Dark's, a contact edge straight down. */
const STUDIO_BLOB_OPACITY = 0.60;

function addWind(material: THREE.Material, look?: VegetationLook, crownForm = false): { uTime: { value: number }; uWind: { value: THREE.Vector2 } } {
  const uTime = { value: 0 }, uWind = { value: new THREE.Vector2(0, 0) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uWind = uWind;
    if (look) {
      shader.uniforms.uHaze = look.haze; shader.uniforms.uHazeCol = look.hazeCol;
      shader.fragmentShader = 'uniform float uHaze; uniform vec3 uHazeCol;\n' + HAZE_GLSL + shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        'gl_FragColor.rgb=mix(gl_FragColor.rgb,uHazeCol,lookHaze()*uHaze);\n#include <dithering_fragment>');
    }
    /* A soft darker UNDERSIDE on each crown (unit-ball height, so it is the same
       under every sun — form shading, not a shadow). It buys back the value
       contrast the pale greens give up, without darkening the tops. */
    if (look && crownForm) {
      shader.fragmentShader = 'varying float vCrownY;\n' + shader.fragmentShader.replace('#include <color_fragment>',
        `#include <color_fragment>\ndiffuseColor.rgb*=mix(${CROWN_UNDER.toFixed(2)},1.0,smoothstep(-0.4,1.0,vCrownY));`);
      shader.vertexShader = 'varying float vCrownY;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrownY=position.y;');
    }
    shader.vertexShader = `uniform float uTime;\nuniform vec2 uWind;\n` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       // Unit cone spans y in [-0.5, 0.5], apex at +0.5: bite toward the top.
       float swayMask = clamp((position.y + 1.0) * 0.5, 0.0, 1.0);
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
  look?: VegetationLook,
): VegetationLayer | null {
  void growU;
  if (!data || data.trees.length === 0) return null;
  const group = new THREE.Group();
  const ground = groundAt ?? (() => 0);
  const dummy = new THREE.Object3D();
  const trees = data.trees;
  const n = trees.length;

  // Discrete-minimal render: every tree is a flat-shaded ROUNDED crown (faceted
  // icosphere) on a short trunk, instanced. The individual tree is illustrative
  // (not surveyed), so a moderate exaggeration keeps them legible at the twin's
  // overhead camera — the earlier per-species GLB render was invisible specks.
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
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
    const crownR = Math.max(t.r, treeH * 0.34);
    const trunkH = treeH * 0.30;
    const trunkR = crownR * 0.16;

    // rounded crown: a ball of radius crownR sitting atop the trunk (slightly overlapping)
    dummy.position.set(t.x, g + trunkH + crownR * 0.85, t.y);
    dummy.scale.set(crownR, crownR * 1.05, crownR);
    dummy.rotation.set(0, (t.x * 13.1 + t.y * 7.7) % 6.283, 0);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);

    const jitter = ((t.x * 12.9898 + t.y * 78.233) * 43758.5453) % 1;
    /* Lightness centre 0.42 -> 0.36 (2026-08-13). The canopy read too bright once
       the basemap became OBOS Slate: these crowns were tuned over the old
       near-neutral rgb(12,12,12) dark style, and the same green sits several stops
       hotter against a violet-black ground. Only the CENTRE moves — the ±0.08
       spread stays, because that per-tree variation is what keeps 9,542 instanced
       crowns from reading as one flat carpet. */
    color.setHSL(0.34 + (jitter - 0.5) * 0.03, 0.5 + (jitter - 0.5) * 0.1, 0.36 + (jitter - 0.5) * 0.08);
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
    const crownR = Math.max(t.r, treeH * 0.34);
    dummy.position.set(t.x, ground(t.x, t.y) + 0.05, t.y);
    dummy.scale.set(crownR * 2.1, 1, crownR * 2.1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    shadows.setMatrixAt(i, dummy.matrix);
  });
  shadows.instanceMatrix.needsUpdate = true;
  group.add(shadows);

  /* ── Editorial look, Clay only: the infographic's planting. ──────────────────
     The classic crown is a 1-subdivision faceted ball at lightness 0.36 — on a
     light map, at the overhead camera, that is a dark speck. These are the same
     80-triangle ball, SMOOTH-shaded (3 subdivisions looked no rounder at this
     camera and cost ~4 ms a frame over 9,542 instances at stress resolution; 2
     cost ~1.3 ms), 12 % larger, lower and squatter, and coloured by the same
     per-tree jitter, so the spread that stops 9,542 crowns reading as one carpet
     is kept. Same positions, same count, same sway: the illustration changes,
     the data does not. */
  let soft: THREE.InstancedMesh | null = null;
  let softGeo: THREE.BufferGeometry | null = null;
  let softMat: THREE.MeshLambertMaterial | null = null;
  let softWind: ReturnType<typeof addWind> | null = null;
  let studioOn = false;
  if (look) {
    softGeo = new THREE.IcosahedronGeometry(1, 1);
    /* LAMBERT, no specular — and this, not the colour, was the "washed-out" look.
       A smooth ball seen obliquely is mostly grazing surface, and a standard
       material's Fresnel sheen adds equal R, G and B there: on a dark green it
       greyed the crowns (albedo chroma .56 rendered at .41). Matte is also what
       the clay infographic's planting is. */
    softMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    softWind = addWind(softMat, look, true);
    soft = new THREE.InstancedMesh(softGeo, softMat, n);
    const leaf = srgbLinear(CROWN_LEAF), moss = srgbLinear(CROWN_MOSS), pale = srgbLinear(CROWN_PALE);
    const mossFull = srgbLinear(CROWN_MOSS_FULL), deep = srgbLinear(CROWN_DEEP), hi = srgbLinear(CROWN_HI);
    const tmp = new THREE.Color();
    trees.forEach((t, i) => {
      const g = ground(t.x, t.y);
      const treeH = Math.max(4, t.h) * 1.4;
      const crownR = Math.max(t.r, treeH * 0.34) * 1.12;
      const trunkH = treeH * 0.30;
      /* Lowered and squashed (same footprint) so roofs and their heat tint stand
         clear of the crown from the oblique camera. */
      dummy.position.set(t.x, g + trunkH + crownR * CLAY.crownLift, t.y);
      dummy.scale.set(crownR, crownR * CLAY.crownSquash, crownR);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      soft!.setMatrixAt(i, dummy.matrix);
      const jitter = Math.abs(((t.x * 12.9898 + t.y * 78.233) * 43758.5453) % 1);
      /* Two greens per tree from the one jitter — the pale infographic green and
         the fuller moss — mixed CROWN_PALE_SHARE of the way to the pale one. The
         moss alone closed the saturation gap to classic (chroma .37 vs .52) but
         read heavy; the pale alone read washed out. Value and chroma only. */
      const paleGreen = tmp.copy(leaf).lerp(moss, jitter * 0.8).lerp(pale, (1 - jitter) * 0.12);
      color.copy(mossFull).lerp(deep, jitter * 0.7).lerp(hi, (1 - jitter) * 0.3);
      color.lerp(paleGreen, CROWN_PALE_SHARE);
      soft!.setColorAt(i, color);
    });
    soft.instanceMatrix.needsUpdate = true;
    if (soft.instanceColor) soft.instanceColor.needsUpdate = true;
    soft.visible = false;
    group.add(soft);
  }
  let canopyOn = true;
  const applyStudio = (): void => {
    if (!soft) return;
    soft.visible = studioOn && canopyOn;
    crowns.visible = !studioOn && canopyOn;
    trunkMat.color.set(studioOn ? STUDIO_TRUNK : 0x5a4632);
    shadowMat.opacity = studioOn ? STUDIO_BLOB_OPACITY : 0.55;
  };

  return {
    group,
    setVisible(v) { group.visible = v; },
    setCanopyVisible(v) { canopyOn = v; crowns.visible = v; shadows.visible = v; applyStudio(); },
    setTime(seconds, wind_, windFrom) {
      const rad = (windFrom * Math.PI) / 180;
      const mag = Math.min(0.5, wind_ / 30) * 0.4;
      wind.uTime.value = seconds;
      wind.uWind.value.set(Math.sin(rad) * mag, Math.cos(rad) * mag);
      if (softWind) { softWind.uTime.value = seconds; softWind.uWind.value.copy(wind.uWind.value); }
    },
    ...(look ? { setStudio(v: boolean) { studioOn = v; applyStudio(); } } : {}),
    dispose() {
      softGeo?.dispose(); softMat?.dispose(); soft?.dispose();
      crownGeo.dispose(); trunkGeo.dispose(); crownMat.dispose(); trunkMat.dispose(); crowns.dispose(); trunks.dispose();
      shadowTex.dispose(); quad.dispose(); shadowMat.dispose(); shadows.dispose();
    },
  };
}

export function assertVegetationLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`vegetation: ${m}`); };
  const header = { ward: 'x', grid: 140, sizeM: 1400, retrieved: 'd',
    cols: [...TREE_COLS], speciesNames: ['neem', 'gulmohar', 'palm'] };
  ok(asTreesFile(null) === null, 'null rejected');
  ok(asTreesFile({ ...header, speciesNames: ['oak'], trees: [[0, 0, 50, 10, 0]] }) === null, 'unknown species name rejected');
  ok(asTreesFile({ ...header, trees: [{ x: 1, y: 2, h: 6, species: 'palm', r: 2 }] }) === null, 'old object rows rejected');
  const f = asTreesFile({ ...header, trees: [[1, 2, 60, 20, 2]] });
  ok(f !== null && f.trees[0].species === 'palm' && f.trees[0].h === 6 && f.trees[0].r === 2, 'valid rows accepted');
  // No-data path only: constructing InstancedMeshes requires a WebGL-capable
  // renderer context that node does not provide, so real-data construction is
  // NOT exercised here (it is covered by the headless-browser screenshot check).
  ok(createVegetationLayer(null, { value: 1 }) === null, 'no data -> null layer');
}
