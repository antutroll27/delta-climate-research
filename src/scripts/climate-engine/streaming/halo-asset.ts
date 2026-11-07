/**
 * halo-asset.ts — the neighbours' solver ground around one sheet, at rest.
 *
 * A halo asset is, per neighbour direction, that neighbour's four baseline layers (albedo, vegetation, built, water)
 * quantised to 1/255, the format PLAN 3.1 gives the baked `-halo.bin`. Until the pipeline bakes that file (P2c) the page
 * derives the same thing from each neighbour's own bundle: `quantiseLayers` is the one place the rounding happens, so a
 * baked file and a derived one are the same bytes. One byte per cell is 590 KB a layer set, 4.7 MB for eight neighbours,
 * against 19 MB as floats; `expandLayers` widens one set back for the solve (P0 section 1, note 3c: 1/255 is below the
 * layers' own 8-bit PNG noise).
 */
import type { SimLayers } from '../types.ts';
import { DIRECTIONS, type Direction } from './sheet-topology.ts';
import type { NeighbourLayers } from './halo-solve.ts';

export interface QuantisedLayers {
  readonly albedo: Uint8Array;
  readonly veg: Uint8Array;
  readonly built: Uint8Array;
  readonly water: Uint8Array;
}

export type HaloAsset = Readonly<Partial<Record<Direction, QuantisedLayers>>>;

const LAYERS = ['albedo', 'veg', 'built', 'water'] as const;

export function quantiseLayers(layers: SimLayers): QuantisedLayers {
  const out = {} as { -readonly [K in keyof QuantisedLayers]: QuantisedLayers[K] };
  for (const k of LAYERS) {
    const src = layers[k], q = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) q[i] = Math.max(0, Math.min(255, Math.round(src[i]! * 255)));
    out[k] = q;
  }
  return out;
}

export function expandLayers(q: QuantisedLayers): SimLayers {
  const out = {} as { -readonly [K in keyof SimLayers]: SimLayers[K] };
  for (const k of LAYERS) {
    const src = q[k], f = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) f[i] = src[i]! / 255;
    out[k] = f;
  }
  return out;
}

/** The solver's NeighbourLayers for an asset: the quantised layers themselves, read through `/ 255` by `assembleHaloLayers`
 *  (no 19 MB of floats per solve, and the same values `expandLayers` would give). */
export const neighboursOf = (asset: HaloAsset): NeighbourLayers => asset;

export const haloAssetBytes = (asset: HaloAsset): number => {
  let n = 0;
  for (const d of DIRECTIONS) { const q = asset[d]; if (q) for (const k of LAYERS) n += q[k].byteLength; }
  return n;
};
