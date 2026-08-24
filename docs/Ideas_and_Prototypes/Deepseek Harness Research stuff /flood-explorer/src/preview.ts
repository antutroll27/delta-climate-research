import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadSite, TERRAIN_EXAG } from './dubai';
import { buildTerrain, buildBuildings } from './dubai-geometry';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050606);
scene.fog = new THREE.Fog(0x050606, 3200, 9000);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 5, 40000);
camera.position.set(1250, 620, 1450);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.target.set(-150, 30, -250);
scene.add(new THREE.HemisphereLight(0x4a5a60, 0x0a0f11, 0.7));
const sun = new THREE.DirectionalLight(0xffe6c4, 1.5); sun.position.set(2400, 1900, 3100); scene.add(sun);

const t0 = performance.now();
const site = await loadSite();
const tLoad = performance.now() - t0;
const t1 = performance.now();
const terrain = buildTerrain(site); scene.add(terrain);
const buildings = buildBuildings(site); scene.add(buildings);
const tGeo = performance.now() - t1;

const tri = (buildings.geometry.getAttribute('position').count / 3) | 0;
document.getElementById('hud')!.innerHTML =
  `DUBAI CREEK · <b>${site.n}²</b> @ ${site.cellM} m · ${(site.domainM/1000).toFixed(2)} km<br>` +
  `relief <b>${site.meta.reliefM.toFixed(2)} m</b> · vertical exaggeration <b>×${TERRAIN_EXAG}</b><br>` +
  `footprints <b>${site.meta.count.toLocaleString()}</b> · ${tri.toLocaleString()} triangles<br>` +
  `load ${tLoad.toFixed(0)} ms · geometry ${tGeo.toFixed(0)} ms<br>` +
  `<span style="color:#b08d57">heights ESTIMATED — no open per-building height exists for Dubai</span>`;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
