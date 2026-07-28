/**
 * Ward identity and presentation. NOT physical inputs.
 *
 * `vegetationBaseline` used to live here — 0.12 / 0.62 / 0.28, hand-set archetype
 * values carried over from the original prototype, with no citation and no
 * Sourced<T> wrapper while every other input in the system had both. They
 * disagreed with the measured Sentinel-2 fvc by +0.21 / −0.17 / +0.03, in
 * opposite directions, so the page scored Ballygunge on fvc 0.33 while heating it
 * on veg 0.12. Vegetation now comes from surface-raster.ts, measured, with the
 * ward mean pinned to the value DC-URS scores on.
 */
export type WardId = 'ballygunge' | 'baruipur' | 'barrackpore';

export interface WardMeta {
  id: WardId;
  name: string;
  descriptor: string;
  zone: string;
  coord: string;
  lat: number;
  lon: number;
}

export const WARDS: Record<WardId, WardMeta> = {
  ballygunge: {
    id: 'ballygunge', name: 'Ballygunge', descriptor: 'dense urban core',
    zone: 'Urban Core, Ward 68', coord: '22.528° N, 88.366° E',
    lat: 22.528, lon: 88.3659,
  },
  baruipur: {
    id: 'baruipur', name: 'Baruipur', descriptor: 'peri-urban fringe',
    zone: 'Peri-Urban Fringe', coord: '22.365° N, 88.432° E',
    lat: 22.3654, lon: 88.4319,
  },
  barrackpore: {
    id: 'barrackpore', name: 'Barrackpore', descriptor: 'industrial river corridor',
    zone: 'Industrial River Corridor', coord: '22.762° N, 88.371° E',
    lat: 22.7621, lon: 88.3713,
  },
};

export const WARD_IDS = Object.freeze(Object.keys(WARDS) as WardId[]);

export function isWardId(value: string | null | undefined): value is WardId {
  return typeof value === 'string' && value in WARDS;
}

export function nextDistinctWard(ward: WardId): WardId {
  return WARD_IDS.find((candidate) => candidate !== ward) ?? 'baruipur';
}
