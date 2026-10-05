/**
 * The ward mean the page DISPLAYS, for a list of observation rows.
 *
 * WHY THIS EXISTS. Every published accuracy figure scores the closed-form
 * equilibrium `(gain + kRad·tSky + h·wind·tAir) / (kRad + h·wind)` at the ward's
 * mean surface (fit-ward-scale.py `predict`, heat-map-model.ts `eqMeanFromMeans`).
 * The solver the page runs is not that equation: `TsHeatSim.step` (and its GPU
 * twin) multiplies the convective term by a per-cell ventilation factor
 * `max(0.15, 1 − 0.55·built + 0.65·water)`, so a built cell sheds heat to the air
 * more slowly than the calibrated equation assumes, and adds lateral diffusion.
 * The number on screen therefore is not the number the bands were fitted on.
 * This drives the SHIPPED solver — the same layers, params and mask path the app
 * uses — for each row, so the difference can be measured instead of argued.
 *
 *   node --import tsx scripts/displayed-field-means.mjs <rows.json> <out.json>
 *
 * Called by scripts/measure-displayed-vs-calibrated.py, which owns the rows, the
 * published scorer and the statistics. This file only runs the instrument.
 *
 * rows.json: { rows: [{ ward, phase, tAir, rh, wind, cloud, sun, month, hour }] }
 *            `wind` is the MODEL wind (already wind/3, clamped) and `cloud` a
 *            0–1 fraction, as ward-observations.json stores them.
 * out.json:  { rows: [{ first, settled, eqTs, steps, lit }] }
 *   first    ward mean after RESET_BURST steps — what the first frame shows, and
 *            all the never-animating static host ever shows;
 *   settled  ward mean once the solver has stopped moving — what an animating
 *            page converges to after it keeps advancing;
 *   eqTs     the calibrated equation at the SAME params and the solver grid's own
 *            ward-mean surface: the undamped reference, so `settled − eqTs` is
 *            the solver's own departure, free of any surface-mean difference.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const E = join(ROOT, 'src/scripts/climate-engine');
const M = await import(join(E, 'heat-map-model.ts'));
const T = await import(join(E, 'types.ts'));
const R = await import(join(E, 'ward-raster.ts'));
const WM = await import(join(E, 'ward-mask.ts'));
const { TsHeatSim } = await import(join(E, 'sim-ts.ts'));
const { resolve } = await import(join(E, 'scope/resolve.ts'));
const DATA = join(ROOT, 'public/heat-map/data');

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node --import tsx scripts/displayed-field-means.mjs <rows.json> <out.json>');
  process.exit(2);
}

/** Converged when a further CHUNK steps moves the ward mean by less than this, K. */
const SETTLE_TOL_K = 1e-4;
const CHUNK = 400;
const MAX_STEPS = 40_000;

const wards = new Map();
async function wardSetup(id) {
  if (wards.has(id)) return wards.get(id);
  const ward = JSON.parse(readFileSync(join(DATA, `${id}.json`), 'utf8'));
  const n = T.requireGrid(ward.sizeM).n;
  /* The surface PNG decoded exactly as loadSurfaceRaster does: north-up PNG into
     the south-up sim grid, R → veg on [0, 1], G → albedo on [0, 0.5]. */
  const { data, info } = await sharp(join(DATA, `${id}-surface.png`)).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== info.height) throw new Error(`${id}: surface PNG is not square`);
  const sn = info.width, veg = new Float32Array(sn * sn), albedo = new Float32Array(sn * sn);
  for (let row = 0; row < sn; row++) {
    const src = row * sn, dst = (sn - 1 - row) * sn;
    for (let col = 0; col < sn; col++) {
      const s = (src + col) * 4;
      veg[dst + col] = data[s] / 255;
      albedo[dst + col] = (data[s + 1] / 255) * 0.5;
    }
  }
  // Canopy and water are passed as the app passes them in effect: both are gated
  // off in production (CANOPY_BLEND_STRENGTH 0, WATER_LAYER_ENABLED false).
  const layers = R.rasterWardBase(ward, { fvc: NaN, albedo: NaN }, { n: sn, veg, albedo }, null, null);
  let mask = null;
  try {
    const raw = JSON.parse(readFileSync(join(DATA, `${id}-ward.json`), 'utf8'));
    mask = WM.asWardMask(raw, { area: id, sizeM: ward.sizeM, n, buildings: ward.b.length });
    if (!mask) throw new Error(`${id}: ward mask refused`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;            // no polygon: the square IS the ward
  }
  const cells = mask?.cells;
  let a = 0, v = 0, b = 0, k = 0;
  for (let i = 0; i < n * n; i++) {
    if (cells && !cells[i]) continue;
    a += layers.albedo[i]; v += layers.veg[i]; b += layers.built[i]; k++;
  }
  const s = { ward, n, layers, mask, means: { albedo: a / k, veg: v / k, built: b / k },
    climate: resolve(`in/kolkata/${id}`).climate };
  wards.set(id, s);
  return s;
}

const ZERO_IV = { trees: 0, roof: 0, parks: 0, facades: 0 };
const spec = JSON.parse(readFileSync(inPath, 'utf8'));
const out = [];
const t0 = Date.now();
for (const [i, r] of spec.rows.entries()) {
  const w = await wardSetup(r.ward);
  /* The app's own parameter path. `wind × 3` hands currentParams a raw-looking
     speed that its own `/3` clamp returns to the row's model wind exactly (the
     row's value is already inside [0.3, 2.5]); `cloud` goes back to percent. */
  const live = { tAir: r.tAir, rh: r.rh, wind: r.wind * 3, cloud: r.cloud * 100, feels: 0 };
  const p = M.currentParams({
    live, phase: 'peak', path: '2025', climate: w.climate, iv: ZERO_IV,
    clock: { month: r.month, hour: r.hour }, sunNow: r.phase === 'night' ? 0 : r.sun,
  });
  if (Math.abs(p.wind - r.wind) > 1e-9) throw new Error(`row ${i}: wind round-trip ${p.wind} vs ${r.wind}`);
  const sim = new TsHeatSim();
  sim.reset({ n: w.n, sizeM: w.ward.sizeM }, w.layers, p);
  sim.step(1, M.RESET_BURST);
  const first = WM.fieldStats(sim.temperature(), w.mask, 40).meanC;
  let prev = first, steps = M.RESET_BURST, settled = NaN;
  while (steps < MAX_STEPS) {
    sim.step(1, CHUNK);
    steps += CHUNK;
    const now = WM.fieldStats(sim.temperature(), w.mask, 40).meanC;
    if (Math.abs(now - prev) < SETTLE_TOL_K) { settled = now; break; }
    prev = now;
  }
  if (!Number.isFinite(settled)) throw new Error(`row ${i}: did not settle in ${MAX_STEPS} steps`);
  out.push({ first, settled, eqTs: M.eqMeanFromMeans(w.means, p), steps, lit: p.sun > 0 });
  sim.dispose();
  if ((i + 1) % 25 === 0 || i + 1 === spec.rows.length) {
    console.log(`  [${i + 1}/${spec.rows.length}] ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}
writeFileSync(outPath, JSON.stringify({ rows: out }));
