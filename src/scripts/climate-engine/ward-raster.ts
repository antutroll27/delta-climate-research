/**
 * Footprint rasterisation and the per-cell surface layers the heat sim runs on.
 *
 * `built` is derived from real building footprints. `veg` and `albedo` come from
 * a measured Sentinel-2 texture (surface-raster.ts) — they used to be generated
 * by a hash function here, which meant two of `eqCell`'s three inputs were
 * invented and every within-ward pattern on the map was decoration.
 */
import { CANONICAL_GRID_N, CANOPY_BLEND_STRENGTH, WATER_LAYER_ENABLED, type SimLayers } from './types.ts';
import type { WardData, WaterData } from './heat-map-model.ts';
import { resample, type CanopyRaster, type SurfaceMeans, type SurfaceRaster } from './surface-raster.ts';

const SAMPLE_OFFSETS = [0.25, 0.75] as const;
const COVERAGE_BY_BITS = [0, 0.25, 0.25, 0.5, 0.25, 0.5, 0.5, 0.75, 0.25, 0.5, 0.5, 0.75, 0.5, 0.75, 0.75, 1] as const;

function pointOnSegment(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
  if (Math.abs(cross) > 1e-9) return false;
  return x >= Math.min(ax, bx) - 1e-9
    && x <= Math.max(ax, bx) + 1e-9
    && y >= Math.min(ay, by) - 1e-9
    && y <= Math.max(ay, by) + 1e-9;
}

function pointInPolygon(x: number, y: number, vertices: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let current = 0, previous = vertices.length - 1; current < vertices.length; previous = current++) {
    const [ax, ay] = vertices[previous];
    const [bx, by] = vertices[current];
    if (pointOnSegment(x, y, ax, ay, bx, by)) return true;
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/**
 * Stamp one closed ring's 2×2 subsamples into a shared coverage bitfield.
 *
 * `flat` is the ring's own storage and `start` names where its coordinate pairs
 * begin — 1 for a building row, whose leading element is the height, and 0 for a
 * water polygon's `p`. The two artefacts differ in that one number and in
 * nothing else, so the rasterisation is written once: a second copy of this
 * arithmetic is how the water layer and the built layer would come to disagree
 * about where a cell boundary is, and the disagreement would be invisible.
 *
 * Bits are OR'd, never counted, so overlapping rings — two footprints sharing a
 * wall, a pond digitised twice — cover a subsample once rather than twice.
 */
function stampRing(
  sampleBits: Uint8Array,
  flat: ArrayLike<number>,
  start: number,
  half: number,
  cellM: number,
  n: number,
): void {
  const vertices: Array<readonly [number, number]> = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let index = start; index + 1 < flat.length; index += 2) {
    const x = flat[index];
    const y = flat[index + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    vertices.push([x, y]);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (vertices.length < 3) return;
  const startX = Math.max(0, Math.floor((minX + half) / cellM) - 1);
  const endX = Math.min(n - 1, Math.floor((maxX + half) / cellM) + 1);
  const startY = Math.max(0, Math.floor((minY + half) / cellM) - 1);
  const endY = Math.min(n - 1, Math.floor((maxY + half) / cellM) + 1);
  for (let gridY = startY; gridY <= endY; gridY++) {
    for (let gridX = startX; gridX <= endX; gridX++) {
      const cellIndex = gridY * n + gridX;
      let bit = 1;
      for (const offsetY of SAMPLE_OFFSETS) {
        const sampleY = -half + (gridY + offsetY) * cellM;
        for (const offsetX of SAMPLE_OFFSETS) {
          const sampleX = -half + (gridX + offsetX) * cellM;
          if (pointInPolygon(sampleX, sampleY, vertices)) sampleBits[cellIndex] |= bit;
          bit <<= 1;
        }
      }
    }
  }
}

/** Subsample bitfield → per-cell area fraction. Four samples, so quarters. */
function coverageFromBits(sampleBits: Uint8Array): Float32Array {
  const coverage = new Float32Array(sampleBits.length);
  for (let index = 0; index < coverage.length; index++) coverage[index] = COVERAGE_BY_BITS[sampleBits[index]];
  return coverage;
}

/**
 * Deterministic 2×2 supersampled footprint coverage.
 *
 * Native Canvas antialiasing differs between browser engines, which made the
 * same comparison URL produce slightly different roof areas and hot-cell
 * counts in Chromium and WebKit. Keeping analytical rasterisation in pure
 * arithmetic makes the canonical grid independent of the display engine.
 */
export function rasterizeWardBuilt(ward: WardData, n = CANONICAL_GRID_N): Float32Array {
  if (!Number.isInteger(n) || n <= 0) throw new Error('Ward raster size must be a positive integer.');
  const half = ward.sizeM / 2;
  const cellM = ward.sizeM / n;
  const sampleBits = new Uint8Array(n * n);
  for (const building of ward.b) stampRing(sampleBits, building, 1, half, cellM, n);
  return coverageFromBits(sampleBits);
}

/**
 * Deterministic 2×2 supersampled OPEN-WATER coverage, from {ward}-water.json.
 *
 * A FRACTION OF CELL AREA, not a boolean, and that is the whole contract: the
 * solver multiplies by this number twice (`sim-ts.ts`, `1 - 0.55*built +
 * 0.65*water` on the ventilation and `water*0.35` on the relaxation toward
 * `tAir - 1.5`), so a boolean would model a 12 m tank and a 200 m river reach as
 * the same cell. Same convention as `built` for the same reason.
 *
 * UNTIL 2026-08-13 THIS DID NOT EXIST and `SimLayers.water` shipped as an
 * all-zero array. The water terms above were written, plumbed to the GPU
 * (`sim-gpu-webgl2.ts`) and dead, so every pond in three wards was solved as
 * warm land. The polygons had been on disk since the render-only water layer
 * shipped; nothing read them into the physics.
 *
 * IT STILL DOES NOT REACH THE SOLVER. `rasterWardBase` gates this call behind
 * `WATER_LAYER_ENABLED`, which is false — feeding the layer was measured and made
 * agreement with ECOSTRESS worse. This function is nonetheless real, exported,
 * unit-tested and mirrored in scripts/_water.py under a parity oracle, because the
 * measurement is what makes the decision reversible. docs/heat-map-water-layer.md
 * is the before/after; types.ts is the argument.
 *
 * `sizeM` is passed rather than read off a ward, because the water artefact is a
 * sibling file with its own loader and the caller already holds both. The
 * polygons are clipped to ±760 m by scripts/fetch-water.py while the raster
 * covers ±sizeM/2 (700 m), so the overhang simply falls outside the cell range —
 * `stampRing` clamps, it does not wrap.
 */
export function rasterizeWardWater(
  water: WaterData | null,
  sizeM: number,
  n = CANONICAL_GRID_N,
): Float32Array {
  if (!Number.isInteger(n) || n <= 0) throw new Error('Ward raster size must be a positive integer.');
  const half = sizeM / 2;
  const cellM = sizeM / n;
  const sampleBits = new Uint8Array(n * n);
  for (const poly of water?.polys ?? []) stampRing(sampleBits, poly.p, 0, half, cellM, n);
  return coverageFromBits(sampleBits);
}

/**
 * Footprint and surface-layer preparation for the canonical analytical grid.
 *
 * `surface` is the measured Sentinel-2 texture at its own resolution (140² for a
 * 1400 m ward); it is resampled onto the 192² display grid here. `means` is the
 * measured ward average of each layer — the same scalars in
 * data/dc-urs/inputs.json that the resilience score reads.
 *
 * WHEN `surface` IS NULL the layers are FLAT at those means. That is deliberate:
 * a uniform field states plainly that we know the ward average and not the
 * within-ward pattern. The previous fallback multiplied the mean by a hash, which
 * produced convincing-looking structure with no measurement behind it — the map
 * showed hot and cool blocks that were an artefact of `Math.imul`.
 *
 * Vegetation is NOT re-scaled by the built mask. The satellite already sees the
 * roofs: a cell that is 90 % building measures low NDVI because it IS mostly
 * roof, so multiplying by `(1 - built)` would subtract the same buildings twice
 * and drive dense cells to a vegetation floor no city has.
 *
 * THE CANOPY RASTER NO LONGER TOUCHES `veg`. `CANOPY_BLEND_STRENGTH` is 0, so the
 * call below is an identity: the canopy raster is RENDER-ONLY, driving the rendered
 * tree layer and nothing in the temperature solve. The call is kept rather than
 * deleted so the decision lives in exactly one constant. Why 0: see
 * `blendCanopyIntoVeg`'s docblock below, and types.ts.
 *
 * `water` IS NOT IN THE TEMPERATURE SOLVE EITHER, and for the same shape of reason.
 * `WATER_LAYER_ENABLED` is false, so the call below produces the all-zero layer this
 * function shipped from the beginning — but it is now a MEASURED zero rather than an
 * unwritten allocation. Turning it on degrades agreement with ECOSTRESS in proportion
 * to each ward's open-water fraction, and raises an already over-drawn spatial
 * amplitude; the sim's relaxation term turns out to pin wet cells to `tAir - 1.5`
 * rather than nudge them, which is a daytime assumption applied at night. The numbers
 * and the four arguments are on `WATER_LAYER_ENABLED` in types.ts.
 *
 * A null `water` — no artefact, a failed fetch — degrades to the same zero layer, so
 * the ward solves as dry rather than refusing to solve.
 */
export function rasterWardBase(
  ward: WardData,
  means: SurfaceMeans,
  surface: SurfaceRaster | null = null,
  canopy: CanopyRaster | null = null,
  water: WaterData | null = null,
): SimLayers {
  const n = CANONICAL_GRID_N;
  const count = n * n;
  const built = rasterizeWardBuilt(ward, n);
  const waterFraction = WATER_LAYER_ENABLED
    ? rasterizeWardWater(water, ward.sizeM, n)
    : new Float32Array(count);

  let veg = surface
    ? resample(surface.veg, surface.n, n)
    : new Float32Array(count).fill(means.fvc);
  if (canopy) veg = blendCanopyIntoVeg(veg, resample(canopy.height, canopy.n, n), CANOPY_BLEND_STRENGTH);
  const albedo = surface
    ? resample(surface.albedo, surface.n, n)
    : new Float32Array(count).fill(means.albedo);

  return { albedo, veg, built, water: waterFraction };
}

/**
 * Redistribute the vegetation field toward measured canopy height WITHOUT moving
 * the ward mean. NDVI-derived veg conflates grass/crops/canopy; the CHM adds the
 * vertical dimension. We nudge each cell toward a canopy-weighted target, then
 * re-centre so the sum (hence ward-mean FVC, a CEO-governed scalar) is unchanged.
 * `strength` in [0,1] controls how far the pattern moves. Mean-neutral by
 * construction, so `assertSurfaceMatches` and the DC-URS scalar stay valid.
 *
 * DISABLED IN PRODUCTION SINCE 2026-08-12: `CANOPY_BLEND_STRENGTH` is 0. The rationale
 * above is the HYPOTHESIS this operator was built on, kept because it is the thing that
 * was tested. It did not survive the test. Measured against ECOSTRESS over 34 near-nadir
 * scenes / 87 ward-scenes / 3 wards, agreement degrades monotonically with strength:
 * r_veg 0.2380 at 0 -> 0.1987 at 0.5, r_physics 0.2154 -> 0.2076. The one metric that
 * improved (anomaly RMSE 1.8358 -> 1.8061) improved by COMPRESSING an amplitude the model
 * already over-draws ~2x — chiefly through the [0,1] clamps below, which bite 3-10% of
 * cells — so it is error reduction by damping, not by pattern skill. At 0.5 the implied
 * tree:grass veg ratio was 4.9-8.1x against Schwaab et al. 2021's published 2-4x, while
 * raw NDVI FVC sits in band at 2.0-2.7x. And the operator is EXACTLY scale-invariant in
 * height — `blend(2h)` equals `blend(h)` bit-for-bit, since `vMean * canopy[i] / cMean`
 * cancels magnitude — so it never consumed canopy height at all, only the normalised
 * canopy pattern, which is precisely what it degrades.
 *
 * The function is DELIBERATELY LEFT INTACT, general, and unit-tested at explicit non-zero
 * strengths: the decision is one constant in types.ts, so re-enabling it is a one-line
 * change that must be justified by re-running the sweep. Do not change the `strength`
 * default here to 0 — the default is the function's, the shipped value is the caller's,
 * and collapsing them would hide which one the measurement was about.
 * See docs/evidence/known-limitations.md §1.
 */
export function blendCanopyIntoVeg(veg: Float32Array, canopy: Float32Array, strength = 0.5): Float32Array {
  const count = veg.length;
  if (canopy.length !== count) return veg;
  let vSum = 0, cSum = 0;
  for (let i = 0; i < count; i++) { vSum += veg[i]; cSum += canopy[i]; }
  if (cSum <= 0) return veg;
  const vMean = vSum / count, cMean = cSum / count;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const target = vMean * (canopy[i] / cMean);
    out[i] = Math.min(1, Math.max(0, veg[i] + strength * (target - veg[i])));
  }
  let oSum = 0; for (let i = 0; i < count; i++) oSum += out[i];
  const delta = (vSum - oSum) / count;
  for (let i = 0; i < count; i++) out[i] = Math.min(1, Math.max(0, out[i] + delta));
  return out;
}
