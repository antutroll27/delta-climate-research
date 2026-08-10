/**
 * Measured per-cell vegetation and albedo, loaded from a Sentinel-2 texture.
 *
 * WHAT THIS REPLACES. `rasterWardBase` used to synthesise both layers from a
 * hash:
 *
 *     const noise = 0.5 + 0.5 * stableGridNoise01(x, y);
 *     veg[i]    = vegetationBaseline * (1 - mask) * noise;
 *     albedo[i] = 0.32 - 0.12 * mask + 0.06 * noise;
 *
 * Two of the three inputs to `eqCell` were invented. The physics was fine and
 * the ward means were roughly right, but a park and a car park differed only by
 * their hash — so every within-ward pattern the map drew was decoration.
 *
 * Sentinel-2 measures both at 10 m: 140×140 cells over a 1400 m ward, against a
 * 192×192 display grid. `scripts/export-surface-rasters.py` composites five
 * years, pins each channel's ward mean to the DC-URS scalar, and writes a PNG.
 *
 * THE LEVEL IS NOT OURS TO SET. The ward means in data/dc-urs/inputs.json are
 * what DC-URS scores on and what the specification governs. The exporter shifts
 * each channel so its mean reproduces that scalar exactly; `assertSurfaceMatches`
 * re-checks it here, in the browser, against the same inputs the score reads.
 * Pattern from measurement, level from the approved scalar.
 *
 * WHEN THE TEXTURE IS MISSING the caller falls back to a UNIFORM field at the
 * measured ward mean — not to noise. A flat field is an honest statement that we
 * know the average and not the pattern. Re-deriving a plausible-looking pattern
 * would put invented structure back on the map, which is the whole thing this
 * module exists to remove.
 */

/** Channel encoding, mirroring `quantise`/`dequantise` in the exporter. */
const VEG_LO = 0, VEG_HI = 1;
const ALB_LO = 0, ALB_HI = 0.5;

/** Only reached when dc-urs-inputs.json is unavailable — a mid-range urban value. */
const DEFAULT_ALBEDO = 0.2;

export interface SurfaceRaster {
  /** side length of the square source grid (140 for a 1400 m ward at 10 m) */
  readonly n: number;
  /** vegetation fraction per source cell, row-major, n*n */
  readonly veg: Float32Array;
  /** broadband albedo per source cell, row-major, n*n */
  readonly albedo: Float32Array;
}

/** Mean of a Float32Array — used only to verify the pinned ward level. */
function mean(a: Float32Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i];
  return a.length ? total / a.length : 0;
}

/**
 * Decode the exported PNG into two float layers.
 *
 * R carries vegetation fraction, G carries albedo, each 8-bit over its own
 * range — albedo gets 0..0.5 because land albedo cannot reach 1 and a 0..1
 * range would throw away a bit of precision for nothing.
 */
export async function loadSurfaceRaster(ward: string, signal?: AbortSignal): Promise<SurfaceRaster | null> {
  try {
    const response = await fetch(`/heat-map/data/${ward}-surface.png`, { signal });
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const n = bitmap.width;
    // Square by construction. A non-square texture means the exporter changed
    // shape without this reader following, and sampling would silently skew.
    if (n !== bitmap.height) {
      bitmap.close();
      throw new Error(`surface texture for ${ward} is ${bitmap.width}×${bitmap.height}, not square`);
    }
    const canvas = new OffscreenCanvas(n, n);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) { bitmap.close(); return null; }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data } = context.getImageData(0, 0, n, n);

    const veg = new Float32Array(n * n);
    const albedo = new Float32Array(n * n);
    /* ROW ORDER IS FLIPPED HERE, and it is not cosmetic.

       The PNG is north-up: scripts/export-surface-rasters.py reads a north-up COG
       through rasterio and saves it unrotated, so its row 0 is the window's NORTH
       edge. That is the right convention for a geospatial raster and should stay.

       Every grid in the simulation is the opposite: `ward-raster.ts`'s `sampleY`
       is `-half + gridY * cellM`, so row 0 is the SOUTH edge — and `toCell`,
       `cellIndexAt`, `water-depth` and `cooling-surfaces` all agree with it.

       Reading the PNG row-major into that grid put vegetation and albedo in the
       MIRROR IMAGE of the cell they belong to. Every eqCell(albedo, veg, built)
       was combining a cell's real built fraction with another cell's greenery.
       Measured on the committed Ballygunge artefacts: corr(veg, built) is +0.071
       as it was loaded and −0.398 once flipped. Dense building means low
       vegetation, so only the negative one is physical.

       Flip the READER, not the exporter: the reader is the side that knows the
       simulation's row order, and flipping the PNG would make the artefact
       disagree with every other geospatial tool that opens it. */
    for (let row = 0; row < n; row++) {
      const src = row * n, dst = (n - 1 - row) * n;
      for (let col = 0; col < n; col++) {
        const s = (src + col) * 4;
        veg[dst + col] = (data[s] / 255) * (VEG_HI - VEG_LO) + VEG_LO;
        albedo[dst + col] = (data[s + 1] / 255) * (ALB_HI - ALB_LO) + ALB_LO;
      }
    }
    return { n, veg, albedo };
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return null;
    return null;
  }
}

/**
 * Resample a source layer onto the square display grid, bilinearly.
 *
 * 140 → 192 is an upsample, so bilinear is the honest choice: nearest would
 * introduce 1.4-cell stair-stepping that reads as real structure and is purely
 * an artefact of the resample.
 */
export function resample(source: Float32Array, sourceN: number, targetN: number): Float32Array {
  const out = new Float32Array(targetN * targetN);
  const scale = (sourceN - 1) / Math.max(1, targetN - 1);
  for (let y = 0; y < targetN; y++) {
    const sourceY = y * scale;
    const y0 = Math.min(sourceN - 1, Math.floor(sourceY));
    const y1 = Math.min(sourceN - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < targetN; x++) {
      const sourceX = x * scale;
      const x0 = Math.min(sourceN - 1, Math.floor(sourceX));
      const x1 = Math.min(sourceN - 1, x0 + 1);
      const fx = sourceX - x0;
      const top = source[y0 * sourceN + x0] * (1 - fx) + source[y0 * sourceN + x1] * fx;
      const bottom = source[y1 * sourceN + x0] * (1 - fx) + source[y1 * sourceN + x1] * fx;
      out[y * targetN + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return out;
}

/**
 * Throw if the texture's ward mean has drifted from the scalar DC-URS scores on.
 *
 * This is the browser-side half of the exporter's invariant. It exists because
 * the two can drift independently: someone re-runs build-dcurs-inputs.py and
 * not the exporter, and the map is then drawn from one vintage of measurement
 * while the score is computed from another. Nothing about that is visible on
 * screen — both look measured — so it has to be asserted, not eyeballed.
 *
 * The tolerance is 8-bit quantisation plus the resample, which cannot move a
 * MEAN over ~19k cells by more than a small fraction of one step.
 */
export function assertSurfaceMatches(
  surface: SurfaceRaster,
  fvcTarget: number,
  albedoTarget: number,
  tolerance = 0.01,
): void {
  const vegError = Math.abs(mean(surface.veg) - fvcTarget);
  const albedoError = Math.abs(mean(surface.albedo) - albedoTarget);
  if (vegError > tolerance) {
    throw new Error(
      `surface texture vegetation mean ${mean(surface.veg).toFixed(4)} differs from the DC-URS `
      + `input ${fvcTarget.toFixed(4)} by ${vegError.toFixed(4)}. The map and the score are `
      + `reading different measurements — re-run scripts/export-surface-rasters.py.`);
  }
  if (albedoError > tolerance) {
    throw new Error(
      `surface texture albedo mean ${mean(surface.albedo).toFixed(4)} differs from the DC-URS `
      + `input ${albedoTarget.toFixed(4)} by ${albedoError.toFixed(4)}. Re-run `
      + `scripts/export-surface-rasters.py.`);
  }
}

/**
 * The measured ward means, from the same file the resilience score reads.
 *
 * Module-level cache because both entry points want it — the explorer and the
 * paired comparison — and it is one small file that never changes within a
 * session.
 */
let inputsPromise: Promise<Record<string, { fvc: { value: number }; albedo: { value: number } }> | null> | null = null;

function loadInputs(): Promise<Record<string, { fvc: { value: number }; albedo: { value: number } }> | null> {
  inputsPromise ??= fetch('/heat-map/data/dc-urs-inputs.json')
    .then(r => (r.ok ? r.json() : null))
    .then(j => j?.wards ?? null)
    .catch(() => null);
  return inputsPromise;
}

export interface WardSurface {
  readonly means: SurfaceMeans;
  readonly surface: SurfaceRaster | null;
}

/** The measured ward means DC-URS scores on. */
export interface SurfaceMeans {
  readonly fvc: number;
  readonly albedo: number;
}

/**
 * Everything the sim needs to build a measured surface for one ward.
 *
 * Pairs the texture with the ward means from dc-urs-inputs.json and verifies
 * they agree BEFORE either reaches the model. Both callers go through here so
 * the check cannot be skipped on one path and not the other — which is exactly
 * how the map and the score would end up drawn from different vintages.
 *
 * A failed check discards the texture rather than the score: flat-at-the-mean
 * is a smaller, honest loss, and it is visible as an absence of detail rather
 * than as detail that is quietly wrong.
 */
export async function loadWardSurface(ward: string, signal?: AbortSignal): Promise<WardSurface> {
  const [inputs, surface] = await Promise.all([loadInputs(), loadSurfaceRaster(ward, signal)]);
  const record = inputs?.[ward];
  const means: SurfaceMeans = {
    fvc: record?.fvc.value ?? 0,
    albedo: record?.albedo.value ?? DEFAULT_ALBEDO,
  };
  if (!surface || !record) return { means, surface: null };
  try {
    assertSurfaceMatches(surface, means.fvc, means.albedo);
    return { means, surface };
  } catch (error) {
    console.error(error);
    return { means, surface: null };
  }
}

/**
 * Canopy height per source cell, loaded from a `{ward}-canopy.png` texture.
 *
 * R channel carries height quantised over 0..CANOPY_HI metres, the same
 * north-up-PNG / south-up-grid mismatch as the surface texture applies here
 * too, so `loadCanopyRaster` applies the identical row flip.
 */
export interface CanopyRaster {
  readonly ward: string;
  /** side length of the square source grid */
  readonly n: number;
  /** quantisation ceiling in metres for this raster */
  readonly hi: number;
  /** canopy height in metres per source cell, row-major, n*n */
  readonly height: Float32Array;
}

/**
 * Quantisation ceiling for canopy height, in metres.
 *
 * CROSS-FILE CONSTANT: must match `CANOPY_HI` in `scripts/fetch-canopy.py`
 * (not yet written). If either side changes this value without the other,
 * every dequantised height silently rescales.
 */
const CANOPY_HI = 30;

/** Runtime-validate an untyped object as a CanopyRaster before it reaches the sim. */
export function asCanopyRaster(raw: unknown, ward: string): CanopyRaster | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const n = d.n, hi = d.hi, height = d.height;
  if (typeof n !== 'number' || typeof hi !== 'number') return null;
  if (!(height instanceof Float32Array) || height.length !== n * n) return null;
  return { ward, n, hi, height };
}

/**
 * Decode the exported canopy PNG into a float height layer.
 *
 * Mirrors `loadSurfaceRaster`'s decode path and its mandatory north→south row
 * flip: the PNG is north-up on disk, the sim grid is south-up, so row 0 of
 * the source is written to row (n-1) of the output.
 */
export async function loadCanopyRaster(ward: string, signal?: AbortSignal): Promise<CanopyRaster | null> {
  try {
    const response = await fetch(`/heat-map/data/${ward}-canopy.png`, { signal });
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const n = bitmap.width;
    if (n !== bitmap.height) {
      bitmap.close();
      throw new Error(`canopy texture for ${ward} is ${bitmap.width}×${bitmap.height}, not square`);
    }
    const canvas = new OffscreenCanvas(n, n);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) { bitmap.close(); return null; }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data } = context.getImageData(0, 0, n, n);

    const height = new Float32Array(n * n);
    // Same flip as loadSurfaceRaster: PNG row 0 = NORTH, sim grid row 0 = SOUTH.
    for (let row = 0; row < n; row++) {
      const src = row * n, dst = (n - 1 - row) * n;
      for (let col = 0; col < n; col++) {
        const s = (src + col) * 4;
        height[dst + col] = (data[s] / 255) * CANOPY_HI; // R channel, dequantised to metres
      }
    }
    return { ward, n, hi: CANOPY_HI, height };
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return null;
    return null;
  }
}

/** ponytail: one runnable check */
export function assertCanopyLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`canopy: ${m}`); };
  ok(asCanopyRaster(null, 'x') === null, 'null rejected');
  ok(asCanopyRaster({ n: 4 }, 'x') === null, 'missing height rejected');
  ok(asCanopyRaster({ ward: 'x', n: 2, hi: 30, height: new Float32Array(3) }, 'x') === null, 'wrong length rejected');
  const good = asCanopyRaster({ ward: 'x', n: 2, hi: 30, height: new Float32Array(4).fill(5) }, 'x');
  ok(good !== null && good.height[0] === 5, 'valid accepted');
}

/** ponytail: one runnable check */
export function assertSurfaceLogic(): void {
  const a = (ok: boolean, m: string) => { if (!ok) throw new Error(`surface-raster: ${m}`); };

  // A constant field must survive resampling unchanged — the cheapest way to
  // catch an off-by-one in the bilinear index arithmetic.
  const flat = new Float32Array(4 * 4).fill(0.25);
  const up = resample(flat, 4, 8);
  a(up.every(v => Math.abs(v - 0.25) < 1e-6), 'resampling a constant must not change it');
  a(up.length === 64, 'resample must return targetN²');

  // Corners are the samples most likely to be dropped by a bad scale factor.
  const ramp = new Float32Array([0, 1, 2, 3]);   // 2×2
  const r = resample(ramp, 2, 3);
  a(Math.abs(r[0] - 0) < 1e-6, 'top-left corner must be preserved exactly');
  a(Math.abs(r[8] - 3) < 1e-6, 'bottom-right corner must be preserved exactly');
  a(Math.abs(r[4] - 1.5) < 1e-6, 'centre of a 2×2 ramp must be the mean of its corners');

  // The invariant check must actually fire — a guard that never trips is worse
  // than none, because it reads as protection.
  const fake: SurfaceRaster = { n: 2, veg: new Float32Array([0.5, 0.5, 0.5, 0.5]),
                                albedo: new Float32Array([0.2, 0.2, 0.2, 0.2]) };
  assertSurfaceMatches(fake, 0.5, 0.2);
  let threw = false;
  try { assertSurfaceMatches(fake, 0.9, 0.2); } catch { threw = true; }
  a(threw, 'a drifted vegetation mean must throw, not pass quietly');
}
