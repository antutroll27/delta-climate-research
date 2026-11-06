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
    this.sourceFor = null;
    this.field = new Float32Array(count);
    this.scratch = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      this.field[index] = equilibriumC(params, layers.albedo[index], layers.veg[index], layers.built[index]);
    }
  }

  setParams(params: Partial<SimParams>): void {
    if (!this.params) return;
    Object.assign(this.params, params);
    this.sourceFor = null;
  }

  /** Per-cell source term of the relaxation, independent of dt and of temperature:
   *  S(1-albedo)sun - L veg + Q built + store + kRad tSky + h wind tAir. Rebuilt only on reset() or setParams():
   *  the layers are READ AT reset(), so editing layer arrays in place mid-run is not seen (no caller does; pass new
   *  layers through reset()). The summation order differs from stepGeneral, so results are bit-identical on every
   *  shipped area (layers quantised to 1/255 or 1/100) and at most one float32 step apart on continuous-valued layers. */
  private source = new Float64Array(0);
  private sourceFor: SimParams | null = null;
  private anyWater = false;
  private scaled = new Float64Array(0);
  private scaledDt = Number.NaN;

  private prepare(p: SimParams, layers: SimLayers, count: number): void {
    if (this.sourceFor === p && this.source.length === count) return;   // setParams()/reset() null sourceFor
    const source = this.source.length === count ? this.source : new Float64Array(count);
    let anyWater = false;
    for (let i = 0; i < count; i += 1) {
      source[i] = p.S * (1 - layers.albedo[i]) * p.sun - p.L * layers.veg[i] + p.Q * layers.built[i] + p.store + p.kRad * p.tSky + p.h * p.wind * p.tAir;
      if (layers.water[i] !== 0) anyWater = true;
    }
    this.source = source; this.sourceFor = p; this.anyWater = anyWater; this.scaledDt = Number.NaN;
  }

  step(dt: number, steps = 1): void {
    if (!this.grid || !this.layers || !this.params || steps <= 0) return;
    const { n } = this.grid;
    const p = this.params;
    const layers = this.layers;
    const safeDt = stableDt(p, dt);
    const count = n * n;
    this.prepare(p, layers, count);
    if (this.anyWater) { this.stepGeneral(n, p, layers, safeDt, steps); return; }
    /* THE WATER-FREE PATH (WATER_LAYER_ENABLED is false, so the solver is handed zeros): the relaxation reduces to
         next = t*a0 + dtD*(sum of four neighbours) + dt*source[i],  clamped to [0, 80]
       with the interior loop free of per-cell branches; the clamped (edge-replicated) neighbours are handled on the
       border ring only. a0 = 1 - dt(4D + kRad + h wind). The no-ventilation-factor decision (2026-10-05) is kept:
       the convective term is h*wind. */
    if (this.scaledDt !== safeDt) {
      if (this.scaled.length !== count) this.scaled = new Float64Array(count);
      for (let i = 0; i < count; i += 1) this.scaled[i] = safeDt * this.source[i];
      this.scaledDt = safeDt;
    }
    const scaled = this.scaled;
    const dtD = safeDt * p.D, a0 = 1 - safeDt * (4 * p.D + p.kRad + p.h * p.wind);
    const edge = (f: Float32Array, s: Float32Array, y: number, x: number): void => {
      const i = y * n + x;
      const west = x > 0 ? i - 1 : i, east = x < n - 1 ? i + 1 : i, north = y > 0 ? i - n : i, south = y < n - 1 ? i + n : i;
      const v = f[i] * a0 + dtD * (f[west] + f[east] + f[north] + f[south]) + scaled[i];
      s[i] = v < 0 ? 0 : v > 80 ? 80 : v;
    };
    for (let iteration = 0; iteration < steps; iteration += 1) {
      const f = this.field, s = this.scratch;
      for (let x = 0; x < n; x += 1) { edge(f, s, 0, x); edge(f, s, n - 1, x); }
      for (let y = 1; y < n - 1; y += 1) {
        const row = y * n;
        edge(f, s, y, 0); edge(f, s, y, n - 1);
        for (let i = row + 1, end = row + n - 1; i < end; i += 1) {
          const v = f[i] * a0 + dtD * (f[i - 1] + f[i + 1] + f[i - n] + f[i + n]) + scaled[i];
          s[i] = v < 0 ? 0 : v > 80 ? 80 : v;
        }
      }
      this.field = s; this.scratch = f;
    }
    if (this.field.length !== count) throw new Error('HeatSim field was unexpectedly resized.');
  }

  /** The original stencil, kept for a non-zero water layer (the 0.35 relaxation toward tAir - 1.5). */
  private stepGeneral(n: number, p: SimParams, layers: SimLayers, safeDt: number, steps: number): void {
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
          /* NO PER-CELL VENTILATION FACTOR (removed 2026-10-05). The convective term
             was multiplied by `max(0.15, 1 − 0.55·built + 0.65·water)`, which no fit
             had ever seen: it ran the displayed ward mean +0.2 to +1.1 K warm of the
             calibrated equation the bands describe, and measured against ECOSTRESS it
             made within-ward skill WORSE, not better (r 0.267 → 0.261, paired 95 % CI
             of the loss [0.004, 0.009], all three wards). The convective term is now
             the calibrated `h·wind`. docs/evidence/known-limitations.md §18. */
          const ventilation = p.wind;
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
