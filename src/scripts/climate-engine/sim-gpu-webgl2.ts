import { DEFAULT_PARAMS, equilibriumC, stableDt, type GridSpec, type HeatSim, type SimLayers, type SimParams, type SimStats } from './types';

export class SimUnsupported extends Error {}

const VERTEX = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * .5 + .5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D tT, tLayers;
uniform float uTexel, uDt, uD, uS, uSun, uKRad, uTSky, uL, uH, uWind, uQ, uTAir, uStore;
out vec4 outColor;
void main() {
  float T  = texture(tT, vUv).r;
  float Tl = texture(tT, vUv - vec2(uTexel, 0.0)).r;
  float Tr = texture(tT, vUv + vec2(uTexel, 0.0)).r;
  float Tb = texture(tT, vUv - vec2(0.0, uTexel)).r;
  float Tt = texture(tT, vUv + vec2(0.0, uTexel)).r;
  vec4 Ly = texture(tLayers, vUv);
  float lap = Tl + Tr + Tb + Tt - 4.0 * T;
  float vent = uWind * max(0.15, 1.0 - 0.55 * Ly.b + 0.65 * Ly.a);
  float dT = uD * lap + uS * (1.0 - Ly.r) * uSun - uKRad * (T - uTSky)
    - uL * Ly.g - uH * vent * (T - uTAir) + uQ * Ly.b + uStore;
  float Tn = mix(T + uDt * dT, uTAir - 1.5, Ly.a * .35);
  outColor = vec4(clamp(Tn, 0.0, 80.0), 0.0, 0.0, 1.0);
}`;

function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const value = gl.createShader(type);
  if (!value) throw new SimUnsupported('Unable to allocate a GPU shader.');
  gl.shaderSource(value, source); gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new SimUnsupported(gl.getShaderInfoLog(value) || 'GPU shader compilation failed.');
  return value;
}

function program(gl: WebGL2RenderingContext): WebGLProgram {
  const value = gl.createProgram();
  if (!value) throw new SimUnsupported('Unable to allocate a GPU program.');
  const vert = shader(gl, gl.VERTEX_SHADER, VERTEX);
  const frag = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  gl.attachShader(value, vert); gl.attachShader(value, frag); gl.linkProgram(value);
  gl.deleteShader(vert); gl.deleteShader(frag);
  if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new SimUnsupported(gl.getProgramInfoLog(value) || 'GPU program linking failed.');
  return value;
}

/**
 * Float-texture, ping-pong GPU solver with no Three.js renderer dependency.
 * It mirrors sim-ts.ts exactly and keeps its context isolated from MapLibre's
 * rendering context; field readback remains explicitly demand-driven.
 */
export class WebGl2HeatSim implements HeatSim {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private front: WebGLTexture | null = null;
  private back: WebGLTexture | null = null;
  private layers: WebGLTexture | null = null;
  private frontBuffer: WebGLFramebuffer | null = null;
  private backBuffer: WebGLFramebuffer | null = null;
  private n = 0;
  private params: SimParams = { ...DEFAULT_PARAMS };
  private readback: Float32Array | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new SimUnsupported('WebGL2 float render targets are unavailable.');
    this.gl = gl;
    this.program = program(gl);
  }

  reset(grid: GridSpec, layers: SimLayers, params: SimParams): void {
    this.disposeTargets();
    this.n = grid.n;
    this.params = { ...params };
    const packed = new Float32Array(grid.n * grid.n * 4);
    const seed = new Float32Array(grid.n * grid.n * 4);
    for (let i = 0; i < grid.n * grid.n; i++) {
      packed[i * 4] = layers.albedo[i]; packed[i * 4 + 1] = layers.veg[i];
      packed[i * 4 + 2] = layers.built[i]; packed[i * 4 + 3] = layers.water[i];
      seed[i * 4] = equilibriumC(params, layers.albedo[i], layers.veg[i], layers.built[i]);
      seed[i * 4 + 3] = 1;
    }
    this.layers = this.texture(packed);
    this.front = this.texture(seed);
    this.back = this.texture(seed);
    this.frontBuffer = this.framebuffer(this.front);
    this.backBuffer = this.framebuffer(this.back);
    this.readback = null;
  }

  setParams(params: Partial<SimParams>): void { Object.assign(this.params, params); }

  /**
   * A lost GL context does not throw — it silently no-ops.
   *
   * Browsers evict the least-recently-used context under pressure and this page
   * holds three (MapLibre, the relief renderer, this solver), so a phone or a
   * laptop waking from sleep can lose it at any moment. Every GL call then
   * becomes a no-op INCLUDING readPixels, which leaves the destination
   * Float32Array untouched at zero. Nothing throws, the snapshot passes its
   * generation check, and the instrument reports a confident "mean 0.0 °C /
   * peak 0.0 °C" under a badge still reading GPU SIM.
   *
   * Throwing is what makes that survivable: GpuHeatSimHost.reset/.advance turn
   * a throw into demoteSimHost(), which rebuilds on the CPU worker and relabels
   * the badge CPU SIM. The reader keeps a working instrument and a true label.
   */
  private assertContext(): void {
    if (this.gl.isContextLost()) throw new SimUnsupported('GPU context lost.');
  }

  step(dt: number, steps = 1): void {
    this.assertContext();
    if (!this.front || !this.back || !this.layers || !this.frontBuffer || !this.backBuffer) return;
    const gl = this.gl;
    const p = this.params;
    gl.useProgram(this.program);
    this.uniform('uTexel', 1 / this.n); this.uniform('uDt', stableDt(p, dt));
    this.uniform('uD', p.D); this.uniform('uS', p.S); this.uniform('uSun', p.sun); this.uniform('uKRad', p.kRad);
    this.uniform('uTSky', p.tSky); this.uniform('uL', p.L); this.uniform('uH', p.h); this.uniform('uWind', p.wind);
    this.uniform('uQ', p.Q); this.uniform('uTAir', p.tAir); this.uniform('uStore', p.store);
    this.sampler('tLayers', this.layers, 1);
    gl.viewport(0, 0, this.n, this.n);
    for (let i = 0; i < steps; i++) {
      this.sampler('tT', this.front, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.backBuffer);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      [this.front, this.back] = [this.back, this.front];
      [this.frontBuffer, this.backBuffer] = [this.backBuffer, this.frontBuffer];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.readback = null;
  }

  temperature(): Float32Array {
    this.assertContext();
    if (this.readback) return this.readback;
    const gl = this.gl;
    const rgba = new Float32Array(this.n * this.n * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.frontBuffer);
    gl.readPixels(0, 0, this.n, this.n, gl.RGBA, gl.FLOAT, rgba);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const field = new Float32Array(this.n * this.n);
    for (let i = 0; i < field.length; i++) field[i] = rgba[i * 4];
    this.readback = field;
    return field;
  }

  stats(thresholdC = 40): SimStats {
    const field = this.temperature();
    let sum = 0, peak = -Infinity, above = 0;
    for (const temperature of field) { sum += temperature; if (temperature > peak) peak = temperature; if (temperature > thresholdC) above++; }
    return { meanC: sum / field.length, peakC: peak, fracAbove: above / field.length, thresholdC };
  }

  dispose(): void {
    this.disposeTargets();
    this.gl.deleteProgram(this.program);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private texture(data: Float32Array): WebGLTexture {
    const gl = this.gl;
    const value = gl.createTexture();
    if (!value) throw new SimUnsupported('Unable to allocate a GPU texture.');
    gl.bindTexture(gl.TEXTURE_2D, value);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.n, this.n, 0, gl.RGBA, gl.FLOAT, data);
    return value;
  }

  private framebuffer(texture: WebGLTexture): WebGLFramebuffer {
    const gl = this.gl;
    const value = gl.createFramebuffer();
    if (!value) throw new SimUnsupported('Unable to allocate a GPU framebuffer.');
    gl.bindFramebuffer(gl.FRAMEBUFFER, value);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new SimUnsupported('GPU framebuffer is incomplete.');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return value;
  }

  private uniform(name: string, value: number): void {
    this.gl.uniform1f(this.gl.getUniformLocation(this.program, name), value);
  }

  private sampler(name: string, texture: WebGLTexture, unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(this.program, name), unit);
  }

  private disposeTargets(): void {
    const gl = this.gl;
    for (const value of [this.front, this.back, this.layers]) if (value) gl.deleteTexture(value);
    for (const value of [this.frontBuffer, this.backBuffer]) if (value) gl.deleteFramebuffer(value);
    this.front = this.back = this.layers = null;
    this.frontBuffer = this.backBuffer = null;
    this.readback = null;
  }
}
