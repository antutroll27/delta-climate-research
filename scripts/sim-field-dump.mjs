/**
 * Run the SHIPPED solver on supplied layers and dump the resulting field.
 *
 * WHY THIS EXISTS. `scripts/measure-spatial-accuracy.py` scores the model against
 * ECOSTRESS by evaluating the per-cell EQUILIBRIUM — the closed-form steady state
 * of the energy balance, one cell at a time. That is not what ships. The browser
 * runs `TsHeatSim`, which adds a lateral diffusion term (`D * laplacian`) and
 * relaxes for RESET_BURST steps. Its steady state is a screened Poisson equation,
 * i.e. the per-cell equilibrium SMOOTHED at a length of sqrt(D/k) cells — with the
 * shipped D = 2.5, kRad = 0.01 and h = 0.05 that is roughly 6.5 cells, about 47 m.
 *
 * So every published within-ward statistic describes a field the user never sees:
 * un-diffused, and therefore rougher and higher-amplitude than the map. This
 * script closes that gap by running the REAL solver rather than a second copy of
 * it — a reimplementation would drift, and the drift would look like a result.
 *
 * Layers arrive as JSON from the Python side, which already knows how to build
 * them from the shipped artefacts. Nothing is recomputed here.
 *
 *   node --experimental-strip-types scripts/sim-field-dump.mjs <in.json> <out.json>
 *
 * in.json:  { n, steps, params: {...SimParams}, layers: { albedo, veg, built, water } }
 * out.json: { n, field: [...], sd, mean }
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node scripts/sim-field-dump.mjs <in.json> <out.json>');
  process.exit(2);
}

const { TsHeatSim } = await import('../src/scripts/climate-engine/sim-ts.ts');
const M = await import('../src/scripts/climate-engine/heat-map-model.ts');

const spec = JSON.parse(readFileSync(inPath, 'utf8'));
const n = spec.n ?? M.SIM_N;
const count = n * n;

for (const k of ['albedo', 'veg', 'built', 'water']) {
  const a = spec.layers?.[k];
  if (!Array.isArray(a) || a.length !== count) {
    throw new Error(`layer ${k}: expected ${count} numbers, got ${a?.length}`);
  }
}
const layers = {
  albedo: Float32Array.from(spec.layers.albedo),
  veg: Float32Array.from(spec.layers.veg),
  built: Float32Array.from(spec.layers.built),
  water: Float32Array.from(spec.layers.water),
};

/* The params the page uses, not a hand-rolled set: currentParams applies the
   wind clamp, the humidity gate on L and the night storage term, and getting any
   of those wrong here would make the comparison meaningless. */
const params = spec.params;

const sim = new TsHeatSim();
sim.reset({ n }, layers, params);
sim.step(1, spec.steps ?? M.RESET_BURST);
const field = Array.from(sim.temperature());

const mean = field.reduce((s, v) => s + v, 0) / field.length;
const sd = Math.sqrt(field.reduce((s, v) => s + (v - mean) ** 2, 0) / field.length);

writeFileSync(outPath, JSON.stringify({ n, mean, sd, field }));
console.log(`  ${outPath}  n=${n}  mean ${mean.toFixed(2)} C  spatial SD ${sd.toFixed(3)} K`);
