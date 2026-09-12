/**
 * The study wards THAT SHIP DATA — the standards-facing ward list.
 *
 * The ward set is no longer written here. It lives in `src/data/cities.ts` as a
 * country → city → ward registry, because it was previously hard-coded in four
 * places, one of which was the type `WardId = 'ballygunge' | 'baruipur' |
 * 'barrackpore'` — which made a second city a type change rather than a data
 * change. This file now derives from that registry and keeps its own exported
 * shape, because 14 consumers read it.
 *
 * WHY THIS IS NOT SIMPLY `allWards()`. The registry describes what EXISTS;
 * this list drives what we PUBLISH. Every consumer below joins a ward to
 * artefacts on disk, and Bengaluru has none of them yet:
 *
 *   · ward-record.ts:readProvenance reads public/heat-map/data/{id}-provenance
 *     .json and throws ENOENT — that is /api/wards/{id}/metadata.json, the
 *     NGSI-LD entities, the OGC items, CityJSON and the whole /attribution page
 *   · stac.ts publishes one Item per ward × product, each asserting assets that
 *     would 404
 *   · public/3d-tiles/{id}/tileset.json and data/geometry/heights-overture.json
 *     have no Bengaluru entries
 *   · the analysis CRS is not even the same UTM zone — Kolkata derives to
 *     EPSG:32645, Bengaluru to EPSG:32643
 *
 * Publishing a ward before its artefacts exist is the quiet kind of wrong: the
 * catalogue would advertise data that is not there. So the gate is publication,
 * not identity, and it is stated as one line that Task 7 deletes once Task 8's
 * artefact gate passes — at which point the standards surface must also stop
 * assuming a single UTM zone and a single provenance root.
 */
import { wardsOfCity, type WardRecord } from './cities.ts';

export type Ward = WardRecord;

/**
 * The cities whose artefacts are built and served.
 *
 * Bengaluru joins this list in TASK 7 (export the artefacts), which is gated by
 * TASK 8 (the artefact gate) — not before, and not by anyone who merely wants
 * to see six wards on the page. A line whose whole purpose is to be deleted
 * should name the work that deletes it.
 */
const PUBLISHED_CITIES: readonly string[] = ['kolkata'];

/** Kept a readonly array, and in registry order, because every consumer maps,
 *  finds or flat-maps over it (getStaticPaths, the STAC catalogue, the OGC
 *  collections, /attribution). */
export const WARDS: readonly Ward[] = PUBLISHED_CITIES.flatMap((c) => [...wardsOfCity(c)]);

/** Lookup by id. Returns undefined for an unknown id rather than throwing. */
export function wardById(id: string): Ward | undefined {
  return WARDS.find(w => w.id === id);
}

/** Legacy shape for call sites that still index by id. */
export const WARD_MAP: Readonly<Record<string, Ward>> =
  Object.fromEntries(WARDS.map(w => [w.id, w]));

/**
 * Ward metres → WGS-84. The exact inverse of `to_local` in
 * scripts/fetch-buildings.py, which is where the local frame is created:
 *
 *     mx, my = 111_320 · cos(lat), 110_540          (scripts/_types.m_per_deg)
 *     x, y   = (lon − clon) · mx, (lat − clat) · my
 *
 * so inverting it recovers the ORIGINAL Overture coordinate rather than
 * re-deriving one. Checked against the raw parquet on 2026-08-04, comparing
 * vertex means on both sides of the pipeline: median 0.016 m, p95 0.036 m,
 * 98.4 % within 5 cm. The residue is the shipped JSON's coordinate rounding,
 * not the transform.
 *
 * `y` is NORTHWARD, the house convention — the same `y` a building row carries
 * and the same value the scene uses as world z (see climate-engine/terrain.ts).
 *
 * A caveat that belongs here and not on screen: the RENDER places these points
 * in Web Mercator while this conversion is linear in latitude, so a drawn
 * building can sit up to ~4 m from the coordinate reported here at the window's
 * edge. The number is the more faithful of the two.
 */
export function wardLatLon(
  origin: { readonly lat: number; readonly lon: number }, x: number, y: number,
): { lat: number; lon: number } {
  return {
    lat: origin.lat + y / 110_540,
    lon: origin.lon + x / (111_320 * Math.cos((origin.lat * Math.PI) / 180)),
  };
}

/**
 * The UI's rendering of the above. Five decimals ≈ 1.1 m — coarser than the
 * transform, and deliberately so: this is the centroid of a footprint traced
 * from imagery, and a sixth decimal would claim 11 cm of siting accuracy that
 * the FOOTPRINT does not have, however exact the arithmetic is.
 */
export function formatLatLon(lat: number, lon: number, separator = ', '): string {
  return `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}${separator}`
       + `${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
}
