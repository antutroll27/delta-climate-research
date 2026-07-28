/**
 * GPU HeatSim — the tier-2 `gpu` backend from caps.ts.
 *
 * Finite-difference step as a fragment-shader ping-pong between two float
 * render targets, driven by the page's existing WebGLRenderer (one context —
 * the field texture is consumed by the render layer directly, zero per-frame
 * readback; readback happens only in temperature()/stats(), throttled by the
 * caller). Requires render-to-float (EXT_color_buffer_float) — exactly what
 * caps.ts probes as `floatRenderTargets`; construction throws SimUnsupported
 * otherwise and the caller falls back to the `ts` backend.
 *
 * Physics + stability bounds live in types.ts (shared with future backends).
 */
import {
  DataTexture,
  FloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  WebGLRenderer,
  Texture,
} from './../three-runtime';
import {
  DEFAULT_PARAMS, stableDt, equilibriumC,
  type GridSpec, type HeatSim, type SimLayers, type SimParams, type SimStats,
} from './types';

export class SimUnsupported extends Error {}

// convenience re-export so consumers of the engine get the tuned defaults too
export { DEFAULT_PARAMS } from './types';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// One explicit-Euler step. Layers: R=albedo G=veg B=built A=water.
const STEP_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tT, tLayers;
  uniform float uTexel, uDt, uD, uS, uSun, uKRad, uTSky, uL, uH, uWind, uQ, uTAir;
  // nocturnal storage release; zero by day. Must mirror sim-ts.ts and eqCell —
  // a GPU/CPU divergence here shows up as the two backends disagreeing at night.
  uniform float uStore;
  void main(){
    float T  = texture2D(tT, vUv).r;
    float Tl = texture2D(tT, vUv - vec2(uTexel, 0.0)).r;
    float Tr = texture2D(tT, vUv + vec2(uTexel, 0.0)).r;
    float Tb = texture2D(tT, vUv - vec2(0.0, uTexel)).r;
    float Tt = texture2D(tT, vUv + vec2(0.0, uTexel)).r;
    vec4  Ly = texture2D(tLayers, vUv);
    float lap = Tl + Tr + Tb + Tt - 4.0 * T;
    // local ventilation: dense built shelters (stiller air, retains its extreme),
    // water/open exposes to the river breeze — spatial wind, not a single scalar.
    // ponytail: linear morphology proxy; swap for a sky-view/frontal-area field if we ever raster it.
    float vent = uWind * max(0.15, 1.0 - 0.55 * Ly.b + 0.65 * Ly.a);
    float dT = uD * lap
             + uS * (1.0 - Ly.r) * uSun
             - uKRad * (T - uTSky)
             - uL * Ly.g
             - uH * vent * (T - uTAir)
             + uQ * Ly.b
             + uStore;
    // water cells relax hard toward air temp (thermal mass shortcut)
    float Tn = T + uDt * dT;
    Tn = mix(Tn, uTAir - 1.5, Ly.a * 0.35);
    gl_FragColor = vec4(clamp(Tn, 0.0, 80.0), 0.0, 0.0, 1.0);
  }`;

export class GpuHeatSim implements HeatSim {
  private renderer: WebGLRenderer;
  private front!: WebGLRenderTarget;
  private back!: WebGLRenderTarget;
  private layersTex!: DataTexture;
  private mat!: ShaderMaterial;
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private n = 0;
  private params: SimParams = { ...DEFAULT_PARAMS };
  private readback: Float32Array | null = null; // cache; invalidated by step()

  constructor(renderer: WebGLRenderer) {
    if (!renderer.extensions.get('EXT_color_buffer_float')) {
      throw new SimUnsupported('render-to-float unavailable — use the ts backend');
    }
    this.renderer = renderer;
    this.mat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: STEP_FRAG, depthTest: false, depthWrite: false, uniforms: {
      tT: { value: null }, tLayers: { value: null }, uTexel: { value: 0 }, uDt: { value: 1 },
      uD: { value: 0 }, uS: { value: 0 }, uSun: { value: 0 }, uKRad: { value: 0 }, uTSky: { value: 0 },
      uL: { value: 0 }, uH: { value: 0 }, uWind: { value: 0 }, uQ: { value: 0 }, uTAir: { value: 0 },
      uStore: { value: 0 },
    }});
    this.scene.add(new Mesh(new PlaneGeometry(2, 2), this.mat));
  }

  /** the live field texture for the render layer (R channel = °C); null before reset(). */
  get texture(): Texture | null { return this.front ? this.front.texture : null; }
  get gridN(): number { return this.n; }

  reset(grid: GridSpec, layers: SimLayers, params: SimParams): void {
    this.disposeTargets();
    this.n = grid.n;
    this.params = { ...params };
    const rtOpts = { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false, stencilBuffer: false };
    this.front = new WebGLRenderTarget(grid.n, grid.n, rtOpts);
    this.back = new WebGLRenderTarget(grid.n, grid.n, rtOpts);

    // pack layers RGBA + seed the field at per-cell equilibrium (no cold start)
    const n2 = grid.n * grid.n;
    const packed = new Float32Array(n2 * 4);
    const seed = new Float32Array(n2 * 4);
    for (let i = 0; i < n2; i++) {
      packed[i * 4] = layers.albedo[i]; packed[i * 4 + 1] = layers.veg[i];
      packed[i * 4 + 2] = layers.built[i]; packed[i * 4 + 3] = layers.water[i];
      seed[i * 4] = equilibriumC(params, layers.albedo[i], layers.veg[i], layers.built[i]);
    }
    this.layersTex = new DataTexture(packed, grid.n, grid.n, RGBAFormat, FloatType);
    this.layersTex.needsUpdate = true;
    const seedTex = new DataTexture(seed, grid.n, grid.n, RGBAFormat, FloatType);
    seedTex.needsUpdate = true;
    // blit the seed into BOTH targets via a copy pass (uDt=0 ⇒ pure transport)
    const u = this.mat.uniforms;
    u.tLayers.value = this.layersTex; u.uTexel.value = 1 / grid.n;
    u.tT.value = seedTex; u.uDt.value = 0;
    for (const rt of [this.front, this.back]) {
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this.scene, this.cam);
    }
    this.renderer.setRenderTarget(null);
    seedTex.dispose();
    this.readback = null;
  }

  setParams(p: Partial<SimParams>): void { Object.assign(this.params, p); }

  step(dt: number, steps = 1): void {
    if (!this.front) return;
    const p = this.params;
    const u = this.mat.uniforms;
    u.uDt.value = stableDt(p, dt);
    u.uD.value = p.D; u.uS.value = p.S; u.uSun.value = p.sun; u.uKRad.value = p.kRad;
    u.uTSky.value = p.tSky; u.uL.value = p.L; u.uH.value = p.h; u.uWind.value = p.wind;
    u.uQ.value = p.Q; u.uTAir.value = p.tAir; u.uStore.value = p.store;
    const prevRT = this.renderer.getRenderTarget();
    for (let i = 0; i < steps; i++) {
      u.tT.value = this.front.texture;
      this.renderer.setRenderTarget(this.back);
      this.renderer.render(this.scene, this.cam);
      [this.front, this.back] = [this.back, this.front];
    }
    this.renderer.setRenderTarget(prevRT);
    this.readback = null;
  }

  temperature(): Float32Array {
    if (!this.readback) {
      const px = new Float32Array(this.n * this.n * 4);
      this.renderer.readRenderTargetPixels(this.front, 0, 0, this.n, this.n, px);
      const out = new Float32Array(this.n * this.n);
      for (let i = 0; i < out.length; i++) out[i] = px[i * 4];
      this.readback = out;
    }
    return this.readback;
  }

  stats(thresholdC = 40): SimStats {
    const t = this.temperature();
    let sum = 0, peak = -Infinity, above = 0;
    for (let i = 0; i < t.length; i++) { const v = t[i]; sum += v; if (v > peak) peak = v; if (v > thresholdC) above++; }
    return { meanC: sum / t.length, peakC: peak, fracAbove: above / t.length, thresholdC };
  }

  private disposeTargets(): void {
    this.front?.dispose(); this.back?.dispose(); this.layersTex?.dispose();
  }

  dispose(): void {
    this.disposeTargets();
    this.mat.dispose();
    this.scene.traverse((o) => { (o as Mesh).geometry?.dispose?.(); });
  }
}
