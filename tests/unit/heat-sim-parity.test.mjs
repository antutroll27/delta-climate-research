import test from 'node:test';
import assert from 'node:assert/strict';

const { TsHeatSim } = await import('../../src/scripts/climate-engine/sim-ts.ts');
const { CANONICAL_GRID_N, DEFAULT_PARAMS, STORE_NIGHT, equilibriumC, stableDt } = await import('../../src/scripts/climate-engine/types.ts');
const { RESET_BURST } = await import('../../src/scripts/climate-engine/heat-map-model.ts');

/*
 * GPU ↔ TypeScript solver parity — the contract in
 * docs/superpowers/specs/2026-08-07-heat-map-correctness-resilience-design.md §7.6.
 *
 * The two solvers publish the SAME numbers under the same banner: whichever one a
 * device happens to get, the °C the reader is shown is presented as the canonical
 * heat-model-v1 result. Nothing in the repository checked that claim, and nothing
 * can check it in a browser-free unit run — WebGL2 float render targets do not
 * exist under Node.
 *
 * So this transcribes sim-gpu-webgl2.ts's fragment shader into an fp32-emulated
 * CPU kernel: Math.fround after every operation (GLSL highp float is IEEE-754
 * binary32, while JavaScript computes in binary64 and only rounds on store into
 * a Float32Array), CLAMP_TO_EDGE neighbour sampling, and GLSL's left-to-right
 * evaluation order preserved term by term. What survives is exactly the class of
 * error a transcription can carry: a reordered term, a dropped coefficient, a
 * wrapped instead of clamped boundary, a mix() argument the wrong way round.
 *
 * The ceilings below are the spec's acceptance ceilings, not calibration targets.
 * Real ward geometry measures ~2.3e-5 K maximum difference, so a generous
 * threshold still catches any structural error while leaving room for genuine
 * fp32-vs-fp64 accumulation over 600 relaxation steps.
 */

const f = Math.fround;

/**
 * One texel of sim-gpu-webgl2.ts's FRAGMENT shader, evaluated in fp32.
 *
 *   float lap  = Tl + Tr + Tb + Tt - 4.0 * T;
 *   float vent = uWind * max(0.15, 1.0 - 0.55 * Ly.b + 0.65 * Ly.a);
 *   float dT   = uD*lap + uS*(1.0-Ly.r)*uSun - uKRad*(T-uTSky)
 *              - uL*Ly.g - uH*vent*(T-uTAir) + uQ*Ly.b + uStore;
 *   float Tn   = mix(T + uDt*dT, uTAir - 1.5, Ly.a * .35);
 *   outColor   = vec4(clamp(Tn, 0.0, 80.0), 0.0, 0.0, 1.0);
 *
 * `mix(x, y, a)` is `x*(1-a) + y*a` by the GLSL ES specification.
 */
function gpuTexel(T, Tl, Tr, Tb, Tt, albedo, veg, built, water, u) {
  const lap = f(f(f(f(Tl + Tr) + Tb) + Tt) - f(4 * T));
  const ventBase = Math.max(0.15, f(f(1 - f(0.55 * built)) + f(0.65 * water)));
  const vent = f(u.wind * ventBase);
  let dT = f(u.D * lap);
  dT = f(dT + f(f(u.S * f(1 - albedo)) * u.sun));
  dT = f(dT - f(u.kRad * f(T - u.tSky)));
  dT = f(dT - f(u.L * veg));
  dT = f(dT - f(f(u.h * vent) * f(T - u.tAir)));
  dT = f(dT + f(u.Q * built));
  dT = f(dT + u.store);
  const advanced = f(T + f(u.dt * dT));
  const a = f(water * 0.35);
  const Tn = f(f(advanced * f(1 - a)) + f(f(u.tAir - 1.5) * a));
  return Math.min(80, Math.max(0, Tn));
}

/**
 * The ping-pong loop of WebGl2HeatSim.step, in fp32.
 *
 * Neighbour addressing reproduces CLAMP_TO_EDGE: the shader samples
 * `vUv ± vec2(uTexel, 0)` with vUv at the texel centre `(i + 0.5) / n` and
 * uTexel `1 / n`, so an off-grid sample resolves to the edge texel itself —
 * the same reflected-boundary stencil sim-ts.ts writes as `x > 0 ? x - 1 : x`.
 * Every uniform is rounded on upload, because gl.uniform1f takes a binary32.
 */
function runEmulatedGpu(n, layers, params, steps, dt) {
  const u = {
    dt: f(stableDt(params, dt)),
    D: f(params.D), S: f(params.S), sun: f(params.sun), kRad: f(params.kRad),
    tSky: f(params.tSky), L: f(params.L), h: f(params.h), wind: f(params.wind),
    Q: f(params.Q), tAir: f(params.tAir), store: f(params.store),
  };
  // Seeded exactly as WebGl2HeatSim.reset seeds its float texture.
  let front = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    front[i] = equilibriumC(params, layers.albedo[i], layers.veg[i], layers.built[i]);
  }
  let back = new Float32Array(n * n);
  for (let step = 0; step < steps; step++) {
    for (let y = 0; y < n; y++) {
      const below = y > 0 ? y - 1 : y;
      const above = y < n - 1 ? y + 1 : y;
      for (let x = 0; x < n; x++) {
        const west = x > 0 ? x - 1 : x;
        const east = x < n - 1 ? x + 1 : x;
        const i = y * n + x;
        back[i] = gpuTexel(
          front[i], front[y * n + west], front[y * n + east],
          front[below * n + x], front[above * n + x],
          layers.albedo[i], layers.veg[i], layers.built[i], layers.water[i], u,
        );
      }
    }
    const previous = front; front = back; back = previous;
  }
  return front;
}

/**
 * Synthetic but structurally honest ward: a dense built core, a vegetated park,
 * a river reaching the edge, and a bright roof patch. It has to touch every term
 * — albedo, veg, built and water — and it has to put real geometry against all
 * four boundaries, because a wrapped instead of clamped edge is invisible on a
 * uniform field.
 */
function syntheticWard(n) {
  const albedo = new Float32Array(n * n);
  const veg = new Float32Array(n * n);
  const built = new Float32Array(n * n);
  const water = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const u = x / (n - 1), v = y / (n - 1);
      const core = Math.max(0, 1 - Math.hypot(u - 0.42, v - 0.55) * 3.1);
      const park = Math.max(0, 1 - Math.hypot(u - 0.78, v - 0.24) * 4.4);
      const river = Math.max(0, 1 - Math.abs(v - 0.12 - 0.34 * u) * 11);
      built[i] = Math.min(1, core * 1.15);
      veg[i] = Math.min(1, park * 1.3 + 0.06);
      water[i] = Math.min(1, river);
      albedo[i] = Math.min(0.9, 0.18 + 0.34 * ((x + y) % 7 === 0 ? 1 : 0) + 0.1 * veg[i]);
    }
  }
  return { albedo, veg, built, water };
}

function stats(field, thresholdC = 40) {
  let sum = 0, peak = -Infinity, above = 0;
  for (const value of field) { sum += value; if (value > peak) peak = value; if (value > thresholdC) above += 1; }
  return { meanC: sum / field.length, peakC: peak, fracAbove: above / field.length };
}

function compareSolvers(n, steps, params) {
  const layers = syntheticWard(n);
  const ts = new TsHeatSim();
  ts.reset({ n, cellMeters: 1400 / n }, layers, params);
  ts.step(1, steps);
  const cpu = ts.temperature();
  const gpu = runEmulatedGpu(n, layers, params, steps, 1);

  let sumSquared = 0, maxAbs = 0;
  for (let i = 0; i < cpu.length; i++) {
    const d = Math.abs(cpu[i] - gpu[i]);
    sumSquared += d * d;
    if (d > maxAbs) maxAbs = d;
  }
  const a = stats(cpu), b = stats(gpu);
  ts.dispose();
  return {
    meanDelta: Math.abs(a.meanC - b.meanC),
    peakDelta: Math.abs(a.peakC - b.peakC),
    rms: Math.sqrt(sumSquared / cpu.length),
    hotAreaDeltaPp: Math.abs(a.fracAbove - b.fracAbove) * 100,
    maxAbs,
    cpuStats: a,
  };
}

/* §7.6 acceptance ceilings. These are ceilings, not targets: if a change makes a
   solver need them widened, the change is wrong, not the threshold. */
const CEILING = { mean: 0.02, peak: 0.05, rms: 0.03, hotAreaPp: 0.1 };

/* The canonical configuration, not a convenient one: the 192-cell analytical grid
   and the same RESET_BURST relaxation the instrument actually runs, so fp32
   accumulation is measured over the real number of steps rather than a sample. */
test('the GPU stencil and the TypeScript solver agree after a full relaxation burst', () => {
  const d = compareSolvers(CANONICAL_GRID_N, RESET_BURST, DEFAULT_PARAMS);

  // The comparison is only meaningful on a field with real structure in it.
  assert.ok(d.cpuStats.peakC - d.cpuStats.meanC > 4, `field must have contrast (got ${(d.cpuStats.peakC - d.cpuStats.meanC).toFixed(2)} K)`);
  assert.ok(d.cpuStats.fracAbove > 0.01 && d.cpuStats.fracAbove < 0.9, `hot-area fraction must be discriminating (got ${d.cpuStats.fracAbove.toFixed(3)})`);

  assert.ok(d.meanDelta <= CEILING.mean, `mean parity ${d.meanDelta.toExponential(2)} K exceeds ${CEILING.mean} K`);
  assert.ok(d.peakDelta <= CEILING.peak, `peak parity ${d.peakDelta.toExponential(2)} K exceeds ${CEILING.peak} K`);
  assert.ok(d.rms <= CEILING.rms, `field RMS parity ${d.rms.toExponential(2)} K exceeds ${CEILING.rms} K`);
  assert.ok(d.hotAreaDeltaPp <= CEILING.hotAreaPp, `hot-area parity ${d.hotAreaDeltaPp.toFixed(4)} pp exceeds ${CEILING.hotAreaPp} pp`);
});

test('parity holds for the nocturnal storage phase too', () => {
  const night = { ...DEFAULT_PARAMS, store: STORE_NIGHT, sun: 0, tAir: 28, tSky: 14 };
  const d = compareSolvers(64, 400, night);
  assert.ok(d.meanDelta <= CEILING.mean, `night mean parity ${d.meanDelta.toExponential(2)} K exceeds ${CEILING.mean} K`);
  assert.ok(d.peakDelta <= CEILING.peak, `night peak parity ${d.peakDelta.toExponential(2)} K exceeds ${CEILING.peak} K`);
  assert.ok(d.rms <= CEILING.rms, `night field RMS parity ${d.rms.toExponential(2)} K exceeds ${CEILING.rms} K`);
});
