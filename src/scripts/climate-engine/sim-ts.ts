/**
 * Portable HeatSim backend.
 *
 * This is intentionally small and deterministic. It mirrors the GPU stencil so
 * Compare remains usable when float render targets are unavailable. It runs on
 * the canonical analytical grid; callers decide when to yield around work.
 */
import {
  equilibriumC,
  stableDt,
  type GridSpec,
  type HeatSim,
  type SimLayers,
  type SimParams,
  type SimStats,
} from './types.ts';

export class TsHeatSim implements HeatSim {
  private grid: GridSpec | null = null;
  private layers: SimLayers | null = null;
  private params: SimParams | null = null;
  private field = new Float32Array(0);
  private scratch = new Float32Array(0);

  reset(grid: GridSpec, layers: SimLayers, params: SimParams): void {
    const count = grid.n * grid.n;
    if (
      layers.albedo.length !== count || layers.veg.length !== count ||
      layers.built.length !== count || layers.water.length !== count
    ) {
      throw new RangeError('HeatSim layers must match the grid size.');
    }
    this.grid = { ...grid };
    this.layers = layers;
    this.params = { ...params };
    this.field = new Float32Array(count);
    this.scratch = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      this.field[index] = equilibriumC(params, layers.albedo[index], layers.veg[index], layers.built[index]);
    }
  }

  setParams(params: Partial<SimParams>): void {
    if (!this.params) return;
    Object.assign(this.params, params);
  }

  step(dt: number, steps = 1): void {
    if (!this.grid || !this.layers || !this.params || steps <= 0) return;
    const { n } = this.grid;
    const p = this.params;
    const layers = this.layers;
    const safeDt = stableDt(p, dt);
    const count = n * n;

    for (let iteration = 0; iteration < steps; iteration += 1) {
      for (let y = 0; y < n; y += 1) {
        const north = y > 0 ? y - 1 : y;
        const south = y < n - 1 ? y + 1 : y;
        for (let x = 0; x < n; x += 1) {
          const west = x > 0 ? x - 1 : x;
          const east = x < n - 1 ? x + 1 : x;
          const index = y * n + x;
          const temperature = this.field[index];
          const laplacian = this.field[y * n + west] + this.field[y * n + east]
            + this.field[north * n + x] + this.field[south * n + x] - 4 * temperature;
          const ventilation = p.wind * Math.max(0.15, 1 - 0.55 * layers.built[index] + 0.65 * layers.water[index]);
          const delta = p.D * laplacian
            + p.S * (1 - layers.albedo[index]) * p.sun
            - p.kRad * (temperature - p.tSky)
            - p.L * layers.veg[index]
            - p.h * ventilation * (temperature - p.tAir)
            + p.Q * layers.built[index]
            // nocturnal storage release; zero by day (see SimParams.store)
            + p.store;
          const next = temperature + safeDt * delta;
          this.scratch[index] = Math.max(0, Math.min(80, next * (1 - layers.water[index] * 0.35)
            + (p.tAir - 1.5) * layers.water[index] * 0.35));
        }
      }
      const previous = this.field;
      this.field = this.scratch;
      this.scratch = previous;
    }

    if (this.field.length !== count) throw new Error('HeatSim field was unexpectedly resized.');
  }

  temperature(): Float32Array {
    return this.field;
  }

  stats(thresholdC = 40): SimStats {
    if (this.field.length === 0) return { meanC: 0, peakC: 0, fracAbove: 0, thresholdC };
    let sum = 0;
    let peak = -Infinity;
    let above = 0;
    for (const value of this.field) {
      sum += value;
      peak = Math.max(peak, value);
      if (value > thresholdC) above += 1;
    }
    return { meanC: sum / this.field.length, peakC: peak, fracAbove: above / this.field.length, thresholdC };
  }

  dispose(): void {
    this.grid = null;
    this.layers = null;
    this.params = null;
    this.field = new Float32Array(0);
    this.scratch = new Float32Array(0);
  }
}
