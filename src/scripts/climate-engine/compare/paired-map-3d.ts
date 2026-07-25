import * as THREE from 'three';
import { detectHeatCaps, type HeatCaps } from '../caps.ts';
import { RAMP_MAX, RAMP_MIN, type RoadsData, type WardData } from '../heat-map-model.ts';
import type { WardScenarioResult } from './paired-runner.ts';

export type ObservatoryViewMode = 'relief' | 'top';

export interface ObservatoryState {
  mode: ObservatoryViewMode;
  motion: boolean;
  motionAvailable: boolean;
  renderer: 'three' | 'canvas';
  tier: HeatCaps['tier'];
}

export interface ObservatoryProbe {
  temperatureC: number;
}

export interface PairedThermalObservatory {
  update(a: WardScenarioResult, b: WardScenarioResult): Promise<void>;
  reset(): void;
  setView(mode: ObservatoryViewMode): void;
  setMotion(enabled: boolean): void;
  dispose(): void;
}

interface ObservatoryOptions {
  root: HTMLElement;
  canvasA: HTMLCanvasElement;
  canvasB: HTMLCanvasElement;
  initialA: WardScenarioResult;
  initialB: WardScenarioResult;
  onState: (state: ObservatoryState) => void;
  onFallback: (reason: string) => void;
  onProbe?: (slot: 'a' | 'b', probe: ObservatoryProbe | null) => void;
}

interface SharedView {
  yaw: number;
  pitch: number;
  zoom: number;
}

interface CameraTween {
  from: SharedView;
  to: SharedView;
  startedAt: number;
  duration: number;
}

interface FieldUniforms {
  uFieldA: { value: THREE.DataTexture };
  uFieldB: { value: THREE.DataTexture };
  uMix: { value: number };
  uTime: { value: number };
  uSize: { value: number };
  uHeatMin: { value: number };
  uHeatMax: { value: number };
}

interface PreparedWard {
  result: WardScenarioResult;
  buildingGeometry: THREE.BufferGeometry;
  roadGeometry: THREE.BufferGeometry;
}

const DEFAULT_VIEW: SharedView = { yaw: -0.3, pitch: 0.92, zoom: 1 };
const TOP_VIEW: SharedView = { yaw: 0, pitch: 0.035, zoom: 1 };
const TRANSITION_MS = 720;
const CAMERA_TWEEN_MS = 520;
const IDLE_ORBIT_RAD_PER_SECOND = 0.0048;
const IDLE_RESUME_MS = 4200;
const MIN_ZOOM = 0.72;
// At this distance the 1.4 km ward still has a useful contextual frame, while
// individual blocks and thermal corridors become inspectable.
const MAX_ZOOM = 3.2;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const easeOutQuint = (value: number) => 1 - Math.pow(1 - value, 5);

function createFieldTexture(field: Float32Array): THREE.DataTexture {
  const n = Math.round(Math.sqrt(field.length));
  const bytes = new Uint8Array(n * n * 4);
  for (let index = 0; index < field.length; index += 1) {
    const encoded = Math.round(clamp((field[index] - RAMP_MIN) / (RAMP_MAX - RAMP_MIN), 0, 1) * 255);
    const offset = index * 4;
    bytes[offset] = encoded;
    bytes[offset + 1] = encoded;
    bytes[offset + 2] = encoded;
    bytes[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(bytes, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function cleanFootprint(building: number[]): THREE.Vector2[] {
  const footprint: THREE.Vector2[] = [];
  for (let index = 1; index < building.length - 1; index += 2) {
    const x = Number(building[index]);
    const y = Number(building[index + 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) footprint.push(new THREE.Vector2(x, -y));
  }
  if (
    footprint.length > 3
    && footprint[0].distanceToSquared(footprint[footprint.length - 1]) < 0.001
  ) {
    footprint.pop();
  }
  return footprint;
}

function pushTriangle(
  positions: number[],
  normals: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  normal: THREE.Vector3,
): void {
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let index = 0; index < 3; index += 1) normals.push(normal.x, normal.y, normal.z);
}

function buildBuildingGeometry(ward: WardData, tier: HeatCaps['tier']): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const stride = tier === 1 && ward.b.length > 3200 ? 2 : 1;
  const up = new THREE.Vector3(0, 1, 0);

  for (let buildingIndex = 0; buildingIndex < ward.b.length; buildingIndex += stride) {
    const building = ward.b[buildingIndex];
    const footprint = cleanFootprint(building);
    if (footprint.length < 3) continue;
    const height = clamp(Number(building[0]) || 7, 3.5, tier === 2 ? 48 : 34);
    let faces: number[][];
    try {
      faces = THREE.ShapeUtils.triangulateShape(footprint, []);
    } catch {
      continue;
    }
    for (const face of faces) {
      const a = footprint[face[0]];
      const b = footprint[face[1]];
      const c = footprint[face[2]];
      pushTriangle(
        positions,
        normals,
        new THREE.Vector3(a.x, height, a.y),
        new THREE.Vector3(b.x, height, b.y),
        new THREE.Vector3(c.x, height, c.y),
        up,
      );
    }
    for (let edge = 0; edge < footprint.length; edge += 1) {
      const next = (edge + 1) % footprint.length;
      const a = footprint[edge];
      const b = footprint[next];
      const edgeX = b.x - a.x;
      const edgeZ = b.y - a.y;
      const length = Math.max(0.001, Math.hypot(edgeX, edgeZ));
      const normal = new THREE.Vector3(-edgeZ / length, 0, edgeX / length);
      const a0 = new THREE.Vector3(a.x, 0, a.y);
      const b0 = new THREE.Vector3(b.x, 0, b.y);
      const a1 = new THREE.Vector3(a.x, height, a.y);
      const b1 = new THREE.Vector3(b.x, height, b.y);
      pushTriangle(positions, normals, a0, b0, b1, normal);
      pushTriangle(positions, normals, a0, b1, a1, normal);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildRoadGeometry(roads: RoadsData): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const road of roads.ways) {
    for (let index = 0; index < road.p.length - 3; index += 2) {
      positions.push(
        road.p[index], 0.75, -road.p[index + 1],
        road.p[index + 2], 0.75, -road.p[index + 3],
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

async function prepareWard(result: WardScenarioResult, tier: HeatCaps['tier']): Promise<PreparedWard> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return {
    result,
    buildingGeometry: buildBuildingGeometry(result.wardData, tier),
    roadGeometry: buildRoadGeometry(result.roads),
  };
}

function buildingMaterial(uniforms: FieldUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms },
    vertexShader: `
      varying vec3 vLocal;
      varying vec3 vNormalView;
      void main() {
        vLocal = position;
        vNormalView = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uFieldA;
      uniform sampler2D uFieldB;
      uniform float uMix;
      uniform float uSize;
      varying vec3 vLocal;
      varying vec3 vNormalView;
      vec3 ramp(float t) {
        vec3 c0=vec3(.435,.792,.839), c1=vec3(.624,.725,.541);
        vec3 c2=vec3(.690,.553,.341), c3=vec3(.831,.420,.290), c4=vec3(.898,.282,.302);
        return t<.35?mix(c0,c1,t/.35):t<.6?mix(c1,c2,(t-.35)/.25):t<.8?mix(c2,c3,(t-.6)/.2):mix(c3,c4,min((t-.8)/.2,1.));
      }
      void main() {
        vec2 uv = clamp(vec2(vLocal.x / uSize + 0.5, -vLocal.z / uSize + 0.5), 0.0, 1.0);
        float heat = mix(texture2D(uFieldA, uv).r, texture2D(uFieldB, uv).r, uMix);
        vec3 normal = normalize(vNormalView);
        float directional = 0.66 + 0.34 * max(dot(normal, normalize(vec3(-0.45, 0.8, 0.3))), 0.0);
        float top = smoothstep(0.55, 0.85, normal.y);
        vec3 mineral = vec3(0.14, 0.22, 0.22);
        vec3 body = mix(mineral, ramp(heat), 0.62 + top * 0.24);
        float floorBand = 1.0 - smoothstep(0.04, 0.09, abs(fract(vLocal.y / 3.2) - 0.5));
        body *= directional * mix(0.94, 1.08, top);
        body = mix(body, body * 1.18, floorBand * (1.0 - top) * 0.22);
        gl_FragColor = vec4(body, 1.0);
      }
    `,
  });
}

function thermalMaterial(uniforms: FieldUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform sampler2D uFieldA;
      uniform sampler2D uFieldB;
      uniform float uMix;
      uniform float uHeatMin;
      uniform float uHeatMax;
      varying vec2 vUv;
      varying float vHeat;
      void main() {
        vUv = uv;
        float encoded = mix(texture2D(uFieldA, uv).r, texture2D(uFieldB, uv).r, uMix);
        vHeat = mix(uHeatMin, uHeatMax, encoded);
        vec3 transformed = position;
        transformed.z += 3.0 + encoded * 24.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uHeatMin;
      varying vec2 vUv;
      varying float vHeat;
      vec3 ramp(float t) {
        vec3 c0=vec3(.435,.792,.839), c1=vec3(.624,.725,.541);
        vec3 c2=vec3(.690,.553,.341), c3=vec3(.831,.420,.290), c4=vec3(.898,.282,.302);
        return t<.35?mix(c0,c1,t/.35):t<.6?mix(c1,c2,(t-.35)/.25):t<.8?mix(c2,c3,(t-.6)/.2):mix(c3,c4,min((t-.8)/.2,1.));
      }
      void main() {
        float t = clamp((vHeat - ${RAMP_MIN.toFixed(1)}) / ${(RAMP_MAX - RAMP_MIN).toFixed(1)}, 0.0, 1.0);
        float interval = fract((vHeat - uHeatMin) / 2.0);
        float contourDistance = min(interval, 1.0 - interval);
        float contour = 1.0 - smoothstep(0.035, 0.095, contourDistance);
        float sheen = 0.5 + 0.5 * sin((vUv.x * 9.0 + vUv.y * 6.0) * 6.283 + uTime * 0.22);
        vec3 color = ramp(t) * (0.96 + sheen * 0.045);
        float edge = smoothstep(0.0, 0.045, min(min(vUv.x, 1.0-vUv.x), min(vUv.y, 1.0-vUv.y)));
        gl_FragColor = vec4(color, (0.20 + contour * 0.18 + sheen * 0.018) * edge);
      }
    `,
  });
}

function particleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uMotion: { value: 1 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: `
      attribute float aPhase;
      attribute float aHeat;
      uniform float uTime;
      uniform float uMotion;
      uniform float uPixelRatio;
      varying float vAlpha;
      varying float vHeat;
      void main() {
        float cycle = fract(aPhase + uTime * 0.035);
        vec3 transformed = position;
        transformed.y += 7.0 + cycle * 76.0 * uMotion;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp((3.8 * uPixelRatio) * (550.0 / -mvPosition.z), 1.2, 5.5);
        vAlpha = sin(cycle * 3.14159) * uMotion;
        vHeat = aHeat;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      varying float vHeat;
      void main() {
        float radius = distance(gl_PointCoord, vec2(0.5));
        if (radius > 0.5) discard;
        vec3 cool = vec3(.435,.792,.839);
        vec3 hot = vec3(.898,.282,.302);
        vec3 color = mix(cool, hot, smoothstep(0.45, 1.0, vHeat));
        gl_FragColor = vec4(color, vAlpha * smoothstep(0.5, 0.08, radius) * 0.55);
      }
    `,
  });
}

function buildParticles(field: Float32Array, ward: WardData, tier: HeatCaps['tier']): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  if (tier < 2) return geometry;
  const n = Math.round(Math.sqrt(field.length));
  const half = ward.sizeM / 2;
  const candidates: Array<{ index: number; value: number }> = [];
  for (let y = 2; y < n - 2; y += 5) {
    for (let x = 2; x < n - 2; x += 5) {
      const index = y * n + x;
      if (field[index] >= 37.5) candidates.push({ index, value: field[index] });
    }
  }
  candidates.sort((a, b) => b.value - a.value);
  const selected = candidates.slice(0, 220);
  const positions = new Float32Array(selected.length * 3);
  const phases = new Float32Array(selected.length);
  const heats = new Float32Array(selected.length);
  selected.forEach((candidate, item) => {
    const x = candidate.index % n;
    const y = Math.floor(candidate.index / n);
    positions[item * 3] = -half + x / (n - 1) * ward.sizeM;
    positions[item * 3 + 1] = 34 + ((item * 17) % 11);
    positions[item * 3 + 2] = -(-half + y / (n - 1) * ward.sizeM);
    phases[item] = ((item * 47) % 101) / 101;
    heats[item] = clamp((candidate.value - RAMP_MIN) / (RAMP_MAX - RAMP_MIN), 0, 1);
  });
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aHeat', new THREE.BufferAttribute(heats, 1));
  return geometry;
}

class WardScene {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 1, 1, 8000);
  readonly raycaster = new THREE.Raycaster();
  private result: WardScenarioResult;
  private uniforms: FieldUniforms;
  private currentTexture: THREE.DataTexture;
  private nextTexture: THREE.DataTexture | null = null;
  private transitionStartedAt = 0;
  private buildings: THREE.Mesh;
  private roads: THREE.LineSegments;
  private surface: THREE.Mesh;
  private particles: THREE.Points;
  private particleMat: THREE.ShaderMaterial;
  private field: Float32Array;
  private readonly tier: HeatCaps['tier'];
  private readonly dpr: number;

  constructor(canvas: HTMLCanvasElement, prepared: PreparedWard, caps: HeatCaps) {
    this.canvas = canvas;
    this.result = prepared.result;
    this.field = prepared.result.field;
    this.tier = caps.tier;
    this.dpr = caps.tier === 2 ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 1.18);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: caps.tier === 2,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.dpr);
    this.scene.background = new THREE.Color(0x071719);
    this.scene.fog = new THREE.FogExp2(0x071719, 0.00016);

    this.currentTexture = createFieldTexture(prepared.result.field);
    this.uniforms = {
      uFieldA: { value: this.currentTexture },
      uFieldB: { value: this.currentTexture },
      uMix: { value: 0 },
      uTime: { value: 0 },
      uSize: { value: prepared.result.wardData.sizeM },
      uHeatMin: { value: RAMP_MIN },
      uHeatMax: { value: RAMP_MAX },
    };

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(prepared.result.wardData.sizeM * 1.08, prepared.result.wardData.sizeM * 1.08),
      new THREE.MeshBasicMaterial({ color: 0x0a2022 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    this.scene.add(ground);

    this.buildings = new THREE.Mesh(prepared.buildingGeometry, buildingMaterial(this.uniforms));
    this.buildings.renderOrder = 1;
    this.scene.add(this.buildings);

    this.roads = new THREE.LineSegments(
      prepared.roadGeometry,
      new THREE.LineBasicMaterial({ color: 0x8ab2a6, transparent: true, opacity: 0.32 }),
    );
    this.roads.renderOrder = 1;
    this.scene.add(this.roads);

    const visualSegments = caps.tier === 2 ? 191 : 95;
    this.surface = new THREE.Mesh(
      new THREE.PlaneGeometry(prepared.result.wardData.sizeM, prepared.result.wardData.sizeM, visualSegments, visualSegments),
      thermalMaterial(this.uniforms),
    );
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.renderOrder = 2;
    this.scene.add(this.surface);

    this.particleMat = particleMaterial();
    this.particleMat.uniforms.uPixelRatio.value = this.dpr;
    this.particles = new THREE.Points(
      buildParticles(prepared.result.field, prepared.result.wardData, caps.tier),
      this.particleMat,
    );
    this.particles.renderOrder = 3;
    this.scene.add(this.particles);
  }

  get wardId(): WardScenarioResult['ward'] {
    return this.result.ward;
  }

  replacePrepared(prepared: PreparedWard): void {
    this.result = prepared.result;
    this.field = prepared.result.field;
    this.uniforms.uSize.value = prepared.result.wardData.sizeM;
    this.buildings.geometry.dispose();
    this.buildings.geometry = prepared.buildingGeometry;
    this.roads.geometry.dispose();
    this.roads.geometry = prepared.roadGeometry;
    this.currentTexture.dispose();
    this.nextTexture?.dispose();
    this.currentTexture = createFieldTexture(prepared.result.field);
    this.nextTexture = null;
    this.uniforms.uFieldA.value = this.currentTexture;
    this.uniforms.uFieldB.value = this.currentTexture;
    this.uniforms.uMix.value = 0;
    this.particles.geometry.dispose();
    this.particles.geometry = buildParticles(prepared.result.field, prepared.result.wardData, this.tier);
  }

  beginFieldTransition(result: WardScenarioResult, startedAt: number, animate: boolean): void {
    this.result = result;
    this.field = result.field;
    const next = createFieldTexture(result.field);
    if (!animate) {
      this.currentTexture.dispose();
      this.nextTexture?.dispose();
      this.currentTexture = next;
      this.nextTexture = null;
      this.uniforms.uFieldA.value = next;
      this.uniforms.uFieldB.value = next;
      this.uniforms.uMix.value = 0;
    } else {
      this.nextTexture?.dispose();
      this.nextTexture = next;
      this.uniforms.uFieldA.value = this.currentTexture;
      this.uniforms.uFieldB.value = next;
      this.uniforms.uMix.value = 0;
      this.transitionStartedAt = startedAt;
    }
    this.particles.geometry.dispose();
    this.particles.geometry = buildParticles(result.field, result.wardData, this.tier);
  }

  updateFrame(time: number, visualTime: number, motion: boolean): boolean {
    this.uniforms.uTime.value = visualTime;
    this.particleMat.uniforms.uTime.value = visualTime;
    this.particleMat.uniforms.uMotion.value = motion ? 1 : 0;
    if (!this.nextTexture) return false;
    const progress = clamp((time - this.transitionStartedAt) / TRANSITION_MS, 0, 1);
    this.uniforms.uMix.value = easeOutQuint(progress);
    if (progress >= 1) {
      this.currentTexture.dispose();
      this.currentTexture = this.nextTexture;
      this.nextTexture = null;
      this.uniforms.uFieldA.value = this.currentTexture;
      this.uniforms.uFieldB.value = this.currentTexture;
      this.uniforms.uMix.value = 0;
      return false;
    }
    return true;
  }

  render(view: SharedView): void {
    const width = Math.max(1, Math.floor(this.canvas.clientWidth));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight));
    if (this.canvas.width !== Math.floor(width * this.dpr) || this.canvas.height !== Math.floor(height * this.dpr)) {
      this.renderer.setSize(width, height, false);
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const radius = 2350 / view.zoom;
    const sinPitch = Math.sin(view.pitch);
    this.camera.position.set(
      Math.sin(view.yaw) * sinPitch * radius,
      Math.cos(view.pitch) * radius + 40,
      Math.cos(view.yaw) * sinPitch * radius,
    );
    this.camera.lookAt(0, 20, 0);
    this.renderer.render(this.scene, this.camera);
    this.canvas.dataset.mapView = `${view.yaw.toFixed(3)},${view.pitch.toFixed(3)},${view.zoom.toFixed(2)}`;
  }

  probe(clientX: number, clientY: number): ObservatoryProbe | null {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.surface, false)[0];
    if (!hit?.uv) return null;
    const n = Math.round(Math.sqrt(this.field.length));
    const x = clamp(Math.round(hit.uv.x * (n - 1)), 0, n - 1);
    const y = clamp(Math.round(hit.uv.y * (n - 1)), 0, n - 1);
    return { temperatureC: this.field[y * n + x] };
  }

  dispose(): void {
    this.currentTexture.dispose();
    this.nextTexture?.dispose();
    this.buildings.geometry.dispose();
    (this.buildings.material as THREE.Material).dispose();
    this.roads.geometry.dispose();
    (this.roads.material as THREE.Material).dispose();
    this.surface.geometry.dispose();
    (this.surface.material as THREE.Material).dispose();
    this.particles.geometry.dispose();
    this.particleMat.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh && object !== this.buildings && object !== this.surface) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material.dispose();
      }
    });
    this.renderer.dispose();
  }
}

class ObservatoryRuntime implements PairedThermalObservatory {
  private sceneA: WardScene;
  private sceneB: WardScene;
  private readonly options: ObservatoryOptions;
  private readonly caps: HeatCaps;
  private view: SharedView = { ...DEFAULT_VIEW };
  private mode: ObservatoryViewMode = 'relief';
  private motion: boolean;
  private tween: CameraTween | null = null;
  private frame = 0;
  private dirty = true;
  private lastFrameAt = 0;
  private lastRenderedAt = 0;
  private visualTime = 0;
  private visible = true;
  private disposed = false;
  private interacting = false;
  private resumeOrbitAt = 0;
  private updateGeneration = 0;
  private readonly cleanup: Array<() => void> = [];
  private readonly activePointers = new Map<number, { x: number; y: number; slot: 'a' | 'b'; moved: boolean }>();

  constructor(options: ObservatoryOptions, caps: HeatCaps, sceneA: WardScene, sceneB: WardScene) {
    this.options = options;
    this.caps = caps;
    this.sceneA = sceneA;
    this.sceneB = sceneB;
    this.motion = caps.animate;
    this.bindCanvas(options.canvasA, 'a');
    this.bindCanvas(options.canvasB, 'b');
    const onVisibility = () => {
      this.visible = document.visibilityState !== 'hidden';
      if (this.visible) this.invalidate();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', onVisibility));
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(([entry]) => {
        this.visible = entry.isIntersecting && document.visibilityState !== 'hidden';
        if (this.visible) this.invalidate();
      }, { threshold: 0.02 });
      observer.observe(options.root);
      this.cleanup.push(() => observer.disconnect());
    }
    const onResize = () => this.invalidate();
    window.addEventListener('resize', onResize);
    this.cleanup.push(() => window.removeEventListener('resize', onResize));
    this.emitState();
    this.invalidate();
  }

  private emitState(): void {
    this.options.onState({
      mode: this.mode,
      motion: this.motion,
      motionAvailable: this.caps.animate,
      renderer: 'three',
      tier: this.caps.tier,
    });
  }

  private bindCanvas(canvas: HTMLCanvasElement, slot: 'a' | 'b'): void {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY, slot, moved: false });
      this.interacting = true;
      this.resumeOrbitAt = performance.now() + IDLE_RESUME_MS;
      canvas.dataset.interacting = 'true';
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll: true });
      this.invalidate();
    };
    const onPointerMove = (event: PointerEvent) => {
      const pointer = this.activePointers.get(event.pointerId);
      if (!pointer) {
        if (event.pointerType === 'mouse') this.options.onProbe?.(slot, (slot === 'a' ? this.sceneA : this.sceneB).probe(event.clientX, event.clientY));
        return;
      }
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) pointer.moved = true;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      this.tween = null;
      this.mode = 'relief';
      this.view.yaw -= dx * 0.006;
      this.view.pitch = clamp(this.view.pitch + dy * 0.004, 0.38, 1.28);
      this.emitState();
      this.invalidate();
    };
    const endPointer = (event: PointerEvent) => {
      this.activePointers.delete(event.pointerId);
      this.interacting = this.activePointers.size > 0;
      this.resumeOrbitAt = performance.now() + IDLE_RESUME_MS;
      canvas.dataset.interacting = 'false';
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      this.invalidate();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      this.tween = null;
      this.view.zoom = clamp(this.view.zoom * (event.deltaY > 0 ? 0.9 : 1.1), MIN_ZOOM, MAX_ZOOM);
      this.resumeOrbitAt = performance.now() + IDLE_RESUME_MS;
      this.invalidate();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      let handled = true;
      this.tween = null;
      this.mode = 'relief';
      if (event.key === 'ArrowLeft') this.view.yaw += 0.08;
      else if (event.key === 'ArrowRight') this.view.yaw -= 0.08;
      else if (event.key === 'ArrowUp') this.view.pitch = clamp(this.view.pitch - 0.06, 0.38, 1.28);
      else if (event.key === 'ArrowDown') this.view.pitch = clamp(this.view.pitch + 0.06, 0.38, 1.28);
      else if (event.key === '+' || event.key === '=') this.view.zoom = clamp(this.view.zoom * 1.1, MIN_ZOOM, MAX_ZOOM);
      else if (event.key === '-' || event.key === '_') this.view.zoom = clamp(this.view.zoom * 0.9, MIN_ZOOM, MAX_ZOOM);
      else if (event.key === '0') this.reset();
      else handled = false;
      if (handled) {
        event.preventDefault();
        this.resumeOrbitAt = performance.now() + IDLE_RESUME_MS;
        this.emitState();
        this.invalidate();
      }
    };
    const onPointerLeave = () => {
      if (!this.interacting) this.options.onProbe?.(slot, null);
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      this.options.onFallback('The 3D graphics context was interrupted. Canvas relief remains available.');
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('webglcontextlost', onContextLost);
    this.cleanup.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endPointer);
      canvas.removeEventListener('pointercancel', endPointer);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('webglcontextlost', onContextLost);
    });
  }

  private queueFrame(): void {
    if (this.disposed || !this.visible || this.frame) return;
    this.frame = requestAnimationFrame(this.onFrame);
  }

  private invalidate(): void {
    this.dirty = true;
    this.queueFrame();
  }

  private onFrame = (time: number) => {
    this.frame = 0;
    if (this.disposed || !this.visible) return;
    const elapsed = this.lastFrameAt ? Math.min(50, time - this.lastFrameAt) : 0;
    this.lastFrameAt = time;
    const targetFrameMs = this.caps.tier === 2 ? 1000 / 60 : 1000 / 30;
    let cameraMoving = false;
    if (this.tween) {
      const progress = clamp((time - this.tween.startedAt) / this.tween.duration, 0, 1);
      const eased = easeOutQuint(progress);
      this.view = {
        yaw: THREE.MathUtils.lerp(this.tween.from.yaw, this.tween.to.yaw, eased),
        pitch: THREE.MathUtils.lerp(this.tween.from.pitch, this.tween.to.pitch, eased),
        zoom: THREE.MathUtils.lerp(this.tween.from.zoom, this.tween.to.zoom, eased),
      };
      cameraMoving = progress < 1;
      if (!cameraMoving) this.tween = null;
    } else if (this.motion && this.mode === 'relief' && !this.interacting && time >= this.resumeOrbitAt) {
      this.view.yaw += IDLE_ORBIT_RAD_PER_SECOND * (elapsed / 1000);
      cameraMoving = true;
    }
    if (this.motion) this.visualTime += elapsed / 1000;
    const transitionA = this.sceneA.updateFrame(time, this.visualTime, this.motion);
    const transitionB = this.sceneB.updateFrame(time, this.visualTime, this.motion);
    const continuous = this.motion || this.interacting || this.tween !== null || transitionA || transitionB || cameraMoving;
    const shouldRender = this.dirty || (continuous && time - this.lastRenderedAt >= targetFrameMs - 1);
    if (shouldRender) {
      this.sceneA.render(this.view);
      this.sceneB.render(this.view);
      this.lastRenderedAt = time;
      this.dirty = false;
    }
    if (continuous) this.queueFrame();
  };

  async update(a: WardScenarioResult, b: WardScenarioResult): Promise<void> {
    const generation = ++this.updateGeneration;
    const identitiesChanged = this.sceneA.wardId !== a.ward || this.sceneB.wardId !== b.ward;
    if (identitiesChanged) {
      const [preparedA, preparedB] = await Promise.all([
        prepareWard(a, this.caps.tier),
        prepareWard(b, this.caps.tier),
      ]);
      if (generation !== this.updateGeneration || this.disposed) {
        preparedA.buildingGeometry.dispose();
        preparedA.roadGeometry.dispose();
        preparedB.buildingGeometry.dispose();
        preparedB.roadGeometry.dispose();
        return;
      }
      this.sceneA.replacePrepared(preparedA);
      this.sceneB.replacePrepared(preparedB);
    } else {
      const now = performance.now();
      this.sceneA.beginFieldTransition(a, now, this.caps.animate);
      this.sceneB.beginFieldTransition(b, now, this.caps.animate);
    }
    this.invalidate();
  }

  reset(): void {
    this.mode = 'relief';
    this.tween = {
      from: { ...this.view },
      to: { ...DEFAULT_VIEW },
      startedAt: performance.now(),
      duration: this.caps.animate ? CAMERA_TWEEN_MS : 1,
    };
    this.resumeOrbitAt = performance.now() + IDLE_RESUME_MS;
    this.emitState();
    this.invalidate();
  }

  setView(mode: ObservatoryViewMode): void {
    this.mode = mode;
    this.tween = {
      from: { ...this.view },
      to: { ...(mode === 'top' ? TOP_VIEW : DEFAULT_VIEW) },
      startedAt: performance.now(),
      duration: this.caps.animate ? CAMERA_TWEEN_MS : 1,
    };
    this.resumeOrbitAt = performance.now() + IDLE_RESUME_MS;
    this.emitState();
    this.invalidate();
  }

  setMotion(enabled: boolean): void {
    this.motion = this.caps.animate && enabled;
    this.resumeOrbitAt = performance.now() + IDLE_RESUME_MS;
    this.emitState();
    this.invalidate();
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.cleanup.forEach((dispose) => dispose());
    this.sceneA.dispose();
    this.sceneB.dispose();
  }
}

export async function mountPairedThermalObservatory(
  options: ObservatoryOptions,
): Promise<PairedThermalObservatory | null> {
  const caps = await detectHeatCaps();
  if (caps.tier === 0) {
    options.onFallback('Adaptive rendering selected the Canvas relief view for this device.');
    return null;
  }
  try {
    const [preparedA, preparedB] = await Promise.all([
      prepareWard(options.initialA, caps.tier),
      prepareWard(options.initialB, caps.tier),
    ]);
    const sceneA = new WardScene(options.canvasA, preparedA, caps);
    const sceneB = new WardScene(options.canvasB, preparedB, caps);
    options.canvasA.dataset.threeReady = 'true';
    options.canvasB.dataset.threeReady = 'true';
    return new ObservatoryRuntime(options, caps, sceneA, sceneB);
  } catch (error) {
    options.onFallback(`3D enhancement unavailable: ${(error as Error).message}`);
    return null;
  }
}
