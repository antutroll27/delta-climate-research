/** A ward as a GeoJSON Feature: the analysis footprint as a Polygon, the record as properties. */
import type { Ward } from '../../data/wards.ts';
import { LICENCE_BLOCK } from './odbl.ts';
import { wardRecord, type WardRecord } from './ward-record.ts';

export interface WardFeature {
  readonly type: 'Feature';
  readonly id: string;
  readonly licence: typeof LICENCE_BLOCK;
  /** Licences that override `licence` for one property — the boundary polygon. */
  readonly propertyLicences?: { readonly boundary: { readonly licence: string; readonly uri: string; readonly attribution: string; readonly note: string } };
  readonly bbox: WardRecord['bbox'];
  readonly geometry: { readonly type: 'Polygon'; readonly coordinates: readonly (readonly (readonly [number, number])[])[] };
  readonly properties: Omit<WardRecord, 'bbox'>;
}

export function wardFeature(w: Ward): WardFeature {
  const { bbox, ...rest } = wardRecord(w);
  const [west, south, east, north] = bbox;
  return {
    type: 'Feature',
    id: w.id,
    // On the FEATURE, not only the collection. /api/licence.json names
    // items/{id}.json in appliesTo, and it shipped without one — a single ward
    // fetched on its own carried geometry and no licence at all.
    licence: LICENCE_BLOCK,
    /* ONE PROPERTY IS NOT ODbL. A ward with an administrative boundary embeds
       DataMeet's polygon in `properties.boundary`, which is CC BY-SA 2.5 India; the
       block itself carries that licence, its URI and credit (ward-record.ts), and this
       says at feature level that the ODbL above does not govern it. */
    ...(rest.boundary ? { propertyLicences: { boundary: {
      licence: rest.boundary.licenceId, uri: rest.boundary.licenceUri,
      attribution: rest.boundary.attribution, note: rest.boundary.shareAlike,
    } } } : {}),
    bbox,
    // closed ring, counter-clockwise (RFC 7946 §3.1.6)
    geometry: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] },
    properties: rest,
  };
}

export function wardCollection(wards: readonly Ward[]) {
  const features = wards.map(wardFeature);
  const bbox: [number, number, number, number] = [
    Math.min(...features.map((f) => f.bbox[0])), Math.min(...features.map((f) => f.bbox[1])),
    Math.max(...features.map((f) => f.bbox[2])), Math.max(...features.map((f) => f.bbox[3])),
  ];
  return { type: 'FeatureCollection' as const, status: 'prototype' as const, licence: LICENCE_BLOCK, numberReturned: features.length, bbox, features };
}
