/** A ward as a GeoJSON Feature: the analysis footprint as a Polygon, the record as properties. */
import type { Ward } from '../../data/wards.ts';
import { wardRecord, type WardRecord } from './ward-record.ts';

export interface WardFeature {
  readonly type: 'Feature';
  readonly id: string;
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
  return { type: 'FeatureCollection' as const, status: 'prototype' as const, numberReturned: features.length, bbox, features };
}
