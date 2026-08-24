import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import '@fontsource-variable/mona-sans';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/600.css';
import './style.css';
import {
  GRID, CELL, DOMAIN, RAIN_STEPS,
  synthesizeTerrain, priorityFlood, buildModel,
  computeSnapshot, lerpDepth, extentMetrics, handIndex, handExtent,
} from './sim';
import { buildTerrain, buildBuildings, worldToCell } from './terrain';
import { makeWater, snapshotTexture } from './water';
import { makeRain } from './rain';
import { els } from './hud';

const BG = 0x050606;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 2200, 3600);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2, 9000);
camera.position.set(1050, 800, 1250);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 120;
controls.maxDistance = 3400;
controls.target.set(0, 0, 0);
controls.enabled = false;

scene.add(new THREE.HemisphereLight(0x3a4a50, 0x0a0f11, 0.85));
const sun = new THREE.DirectionalLight(0xcfe8ec, 1.1);
sun.position.set(600, 900, 350);
scene.add(sun);

// ---- data (synthetic terrain, production algorithm) ----
const H = synthesizeTerrain();
const S = priorityFlood(H);
const dep = buildModel(H, S);
const snaps = RAIN_STEPS.map((mm) => computeSnapshot(H, dep, mm));
const snapTex = snaps.map(snapshotTexture);
const curDepth = new Float32Array(GRID * GRID);
// Independent extent method for the truth tab (HAND, Nobre et al. 2016). NOT a
// perturbed copy of the solver's own output — see sim.ts:handIndex for why that
// mattered. Recomputed per rainfall, so the metrics move with the scenario.
const hand = handIndex(H, dep);
let obs = handExtent(hand, 0);

// ---- meshes ----
const terrain = buildTerrain(H);
scene.add(terrain);
const buildings = buildBuildings(H);
scene.add(buildings);
const water = makeWater(H);
scene.add(water.mesh);

let drainLines: THREE.LineSegments;
{
  const pts: number[] = [];
  for (let c = 0; c < GRID * GRID; c++) {
    if (dep.acc[c] < 60) continue;
    const nx = dep.next[c];
    if (nx < 0) continue;
    const i = c % GRID, j = (c / GRID) | 0;
    const ni = nx % GRID, nj = (nx / GRID) | 0;
    pts.push(-DOMAIN / 2 + i * CELL, H[c] + 0.5, -DOMAIN / 2 + j * CELL);
    pts.push(-DOMAIN / 2 + ni * CELL, H[nx] + 0.5, -DOMAIN / 2 + nj * CELL);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  drainLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x6fcad6, transparent: true, opacity: 0.16, depthWrite: false }));
  drainLines.visible = false;
  scene.add(drainLines);
}

// The HAND extent changes with rainfall, so the scan-tier point cloud is
// preallocated once and redrawn by moving the draw range — no per-frame
// geometry churn.
const obsPos = new THREE.Float32BufferAttribute(new Float32Array(GRID * GRID * 3), 3);
obsPos.setUsage(THREE.DynamicDrawUsage);
const obsGeo = new THREE.BufferGeometry();
obsGeo.setAttribute('position', obsPos);
const obsPoints = new THREE.Points(obsGeo, new THREE.PointsMaterial({ color: 0xecedf0, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.75, depthWrite: false }));
obsPoints.visible = false;
obsPoints.frustumCulled = false;
scene.add(obsPoints);

function refreshObs(rainMm: number): void {
  obs = handExtent(hand, rainMm);
  const arr = obsPos.array as Float32Array;
  let w = 0;
  for (let c = 0; c < GRID * GRID; c++) {
    if (obs[c] <= 0.05) continue;
    const i = c % GRID, j = (c / GRID) | 0;
    arr[w++] = -DOMAIN / 2 + i * CELL;
    arr[w++] = H[c] + 1.2;
    arr[w++] = -DOMAIN / 2 + j * CELL;
  }
  obsGeo.setDrawRange(0, w / 3);
  obsPos.needsUpdate = true;
}

const rain = makeRain();
scene.add(rain.lines);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.38, 0.65, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---- state ----
let cine = true;
let truthOn = false;
let pinCell = -1;
let introDone = false;
const INTRO_MS = 8000;
let introT = 0;
const pinWorld = new THREE.Vector3();
const projV = new THREE.Vector3();

function lerpNum(a: number, b: number, t: number): number { return a + (b - a) * t; }

function updateTotals(): void {
  let wet = 0, maxd = 0;
  for (let k = 0; k < GRID * GRID; k++) {
    const d = curDepth[k];
    if (d > 0.05) { wet++; if (d > maxd) maxd = d; }
  }
  els.totArea.textContent = ((wet * CELL * CELL) / 1e6).toFixed(2) + ' km²';
  els.totMax.textContent = maxd.toFixed(2) + ' m';
  els.totPop.textContent = Math.round(wet * 38).toLocaleString('en-US');
}

function updateTruth(): void {
  const m = extentMetrics(curDepth, obs);
  els.mCsi.textContent = m.csi.toFixed(3);
  els.mF1.textContent = m.f1.toFixed(3);
  els.mPod.textContent = m.pod.toFixed(3);
  els.mFar.textContent = m.far.toFixed(3);
}

function applyRain(f: number): void {
  const v = Math.max(0, Math.min(RAIN_STEPS.length - 1, f));
  const iA = Math.min(Math.floor(v), RAIN_STEPS.length - 1);
  const iB = Math.min(iA + 1, RAIN_STEPS.length - 1);
  const t = iB === iA ? 0 : v - iA;
  water.setSnapshots(snapTex[iA], snapTex[iB], t);
  lerpDepth(snaps[iA], snaps[iB], t, curDepth);
  const mm = Math.round(lerpNum(RAIN_STEPS[iA], RAIN_STEPS[iB], t));
  els.rainMm.textContent = String(mm);
  els.rainRate.textContent = `≈ ${(mm / 6).toFixed(1)} mm/h over 6 h · snapshots ${iA}/${iB}`;
  refreshObs(mm);
  updateTotals();
  if (truthOn) updateTruth();
  if (pinCell >= 0) updatePinReadout();
}

function setCine(on: boolean): void {
  cine = on;
  bloom.enabled = on;
  water.setCine(on);
  rain.lines.visible = on || !introDone;
  renderer.toneMappingExposure = on ? 1.12 : 1.0;
  els.qualityChip.textContent = on ? 'CINEMATIC ON' : 'FAST PIPELINE';
  els.cineToggle.textContent = on ? 'CINEMATIC TIER · ON' : 'CINEMATIC TIER · OFF';
}

function setTruth(on: boolean): void {
  truthOn = on;
  obsPoints.visible = on;
  els.truthCard.classList.toggle('hidden', !on);
  els.truthToggle.innerHTML = `TRUTH [T] <em>${on ? 'ON' : 'OFF'}</em>`;
  els.truthToggle.classList.toggle('active', on);
  if (on) updateTruth();
}

function updatePinReadout(): void {
  const d = curDepth[pinCell];
  els.pinDepth.textContent = d.toFixed(2);
  const i = pinCell % GRID, j = (pinCell / GRID) | 0;
  els.pinCell.textContent = `E ${String(i).padStart(3, '0')} · N ${String(GRID - 1 - j).padStart(3, '0')} · ELEV ${H[pinCell].toFixed(1)} m`;
  els.pinChipVal.textContent = d.toFixed(2) + ' m';
}

function updatePinChip(): void {
  if (pinCell < 0) return;
  const i = pinCell % GRID, j = (pinCell / GRID) | 0;
  pinWorld.set(-DOMAIN / 2 + i * CELL, H[pinCell] + curDepth[pinCell], -DOMAIN / 2 + j * CELL);
  projV.copy(pinWorld).project(camera);
  if (projV.z > 1) { els.pinChip.classList.add('hidden'); return; }
  els.pinChip.classList.remove('hidden');
  els.pinChip.style.left = (projV.x * 0.5 + 0.5) * window.innerWidth + 'px';
  els.pinChip.style.top = (-projV.y * 0.5 + 0.5) * window.innerHeight + 'px';
}

// ---- picking ----
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function pickCell(ev: PointerEvent): number {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(terrain, false)[0];
  if (!hit) return -1;
  const { i, j } = worldToCell(hit.point.x, hit.point.z);
  return j * GRID + i;
}

// ---- events ----
els.rainSlider.addEventListener('input', () => applyRain(parseFloat(els.rainSlider.value)));
document.querySelectorAll<HTMLButtonElement>('.presets button').forEach((b) =>
  b.addEventListener('click', () => {
    const p = b.dataset.preset!;
    els.rainSlider.value = p;
    applyRain(parseFloat(p));
  }));
els.cineToggle.addEventListener('click', () => setCine(!cine));
els.truthToggle.addEventListener('click', () => setTruth(!truthOn));
els.layerWater.addEventListener('change', () => { water.mesh.visible = els.layerWater.checked; });
els.layerDrain.addEventListener('change', () => { drainLines.visible = els.layerDrain.checked; });
els.layerTerrain.addEventListener('change', () => { terrain.visible = buildings.visible = els.layerTerrain.checked; });
els.resetCam.addEventListener('click', () => {
  camera.position.set(1050, 800, 1250);
  controls.target.set(0, 0, 0);
});
els.skip.addEventListener('click', () => { introT = INTRO_MS; });
window.addEventListener('keydown', (e) => {
  if (e.key === 't' || e.key === 'T') setTruth(!truthOn);
  if (e.key === 'c' || e.key === 'C') setCine(!cine);
});
let downX = 0, downY = 0;
renderer.domElement.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
  const c = pickCell(e);
  if (c >= 0) {
    pinCell = c;
    els.pinEmpty.classList.add('hidden');
    els.pinBody.classList.remove('hidden');
    updatePinReadout();
  }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  const c = pickCell(e);
  if (c < 0) { els.cursor.textContent = 'E — · N — · ELEV — m'; return; }
  const i = c % GRID, j = (c / GRID) | 0;
  els.cursor.textContent = `E ${String(i).padStart(3, '0')} · N ${String(GRID - 1 - j).padStart(3, '0')} · ELEV ${H[c].toFixed(1)} m · DEPTH ${curDepth[c].toFixed(2)} m`;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---- intro (storm-day fly-in -> orbit) ----
const camPath = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-1750, 26, -1350),
  new THREE.Vector3(-700, 240, -380),
  new THREE.Vector3(1050, 800, 1250),
]);
const tgtPath = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 8, -1000),
  new THREE.Vector3(0, 12, -150),
  new THREE.Vector3(0, 0, 0),
]);
function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
function finishIntro(): void {
  if (introDone) return;
  introDone = true;
  els.root.classList.remove('loading');
  els.skip.classList.add('hidden');
  camera.position.set(1050, 800, 1250);
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  controls.enabled = true;
  setCine(cine);
}

// ---- loop ----
const clock = new THREE.Clock();
const camTmp = new THREE.Vector3();
let frames = 0, fpsT = 0;
function frame(): void {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (!introDone) {
    introT += dt * 1000;
    const u = Math.min(1, introT / INTRO_MS);
    const e = easeInOutCubic(u);
    camPath.getPoint(e, camera.position);
    tgtPath.getPoint(e, camTmp);
    camera.lookAt(camTmp);
    bloom.enabled = true;
    water.setCine(true);
    if (u >= 1) finishIntro();
  } else {
    controls.update();
  }
  rain.update(dt);
  water.setTime(t);
  updatePinChip();
  composer.render();
  frames++; fpsT += dt;
  if (fpsT >= 1) {
    els.fps.textContent = Math.round(frames / fpsT) + ' fps';
    frames = 0; fpsT = 0;
  }
}

// ---- boot ----
els.rainSlider.value = '6'; // APR-2024 preset during intro
applyRain(6);
setCine(true);
frame();
