/**
 * Footprint rasterisation and the per-cell surface layers the heat sim runs on.
 *
 * `built` is derived from real building footprints. `veg` and `albedo` come from
 * a measured Sentinel-2 texture (surface-raster.ts) — they used to be generated
 * by a hash function here, which meant two of `eqCell`'s three inputs were
 * invented and every within-ward pattern on the map was decoration.
 */
import { CANONICAL_GRID_N, type SimLayers } from './types.ts';
import type { WardData } from './heat-map-model.ts';
import { resample, type SurfaceMeans, type SurfaceRaster } from './surface-raster.ts';

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
  for (const building of ward.b) {
    const vertices: Array<readonly [number, number]> = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let index = 1; index + 1 < building.length; index += 2) {
      const x = building[index];
      const y = building[index + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      vertices.push([x, y]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (vertices.length < 3) continue;
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
  const built = new Float32Array(n * n);
  for (let index = 0; index < built.length; index++) built[index] = COVERAGE_BY_BITS[sampleBits[index]];
  return built;
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
 */
export function rasterWardBase(
  ward: WardData,
  means: SurfaceMeans,
  surface: SurfaceRaster | null = null,
): SimLayers {
  const n = CANONICAL_GRID_N;
  const count = n * n;
  const built = rasterizeWardBuilt(ward, n);
  const water = new Float32Array(count);

  const veg = surface
    ? resample(surface.veg, surface.n, n)
    : new Float32Array(count).fill(means.fvc);
  const albedo = surface
    ? resample(surface.albedo, surface.n, n)
    : new Float32Array(count).fill(means.albedo);

  return { albedo, veg, built, water };
}
