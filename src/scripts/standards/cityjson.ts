/**
 * CityJSON 2.0, LoD1, one Building per shipped footprint.
 *
 * Built from the SAME three row-aligned files the heat map renders from, so the
 * export cannot disagree with the screen:
 *   data/geometry/{id}-footprints.json   `lonlat` rings, already EPSG:4326, closed
 *   data/geometry/heights-overture.json  per-building p65 / mean / fill
 *   public/heat-map/data/{id}-provenance.json   per-building source + confidence
 * All three are 3,527 rows for ballygunge and indexed by the same row — asserted
 * here, because a silent misalignment would put the wrong height on the wrong
 * building with no error.
 *
 * LoD1 = footprint extruded to one height, six faces per building. That is what
 * the engine actually knows (one height, no roof shape), so LoD2 would be a
 * claim we cannot back.
 *
 * Coordinates: CityJSON stores integer vertices under `transform`, so a 4326
 * ring at 1e-7 degrees (~1 cm) needs scale [1e-7, 1e-7, 0.01] and integer
 * vertices. `translate` is the ward's SW corner so integers stay small. The
 * `referenceSystem` is the OGC URL for EPSG:4326 as the spec requires; the
 * analysis CRS (UTM 45N) is recorded in metadata alongside it.
 *
 * Validated INTERNALLY here (indices in range, ring closure, one object per
 * row). Validation against the CityJSON 2.0 JSON Schema is external (cjio) and
 * until it has been done /standards says "sample export, unvalidated".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Ward } from '../../data/wards.ts';
import { wardBbox, wardRecord } from './ward-record.ts';

interface FootprintFile { readonly ward: string; readonly count: number; readonly b: readonly { readonly gers: string; readonly lonlat: readonly (readonly [number, number])[] }[] }
interface HeightsFile   { readonly wards: Readonly<Record<string, readonly { readonly id: string; readonly p65: number; readonly mean: number; readonly fill: boolean }[]>> }
interface ProvFile      { readonly src: readonly string[]; readonly confidence: readonly number[]; readonly datasets: Readonly<Record<string, { readonly key: string }>> }

const SCALE = [1e-7, 1e-7, 0.01] as const;   // ~1 cm horizontal, 1 cm vertical

/** Mirrors scripts/build-ward-geometry.py:FLOOR_M. Google Open Buildings' published
 *  minimum AND its no-confident-height value. A zonal statistic BELOW it means the
 *  raster found no building under that footprint (OSM features Google's ML did not
 *  detect, ~12 % of rings) — those are clamped to the floor and flagged as fill,
 *  exactly as the heat map ships them. Exporting the raw p65 would have put 438
 *  Ballygunge buildings at heights the pipeline had already rejected, 120 of them
 *  at 0 m. The unit test pins this export to b[0] of the shipped JSON. */
const FLOOR_M = 2.5;

function load<T>(rel: string): T {
  return JSON.parse(readFileSync(resolve(rel), 'utf8')) as T;
}

export interface CityJSON {
  readonly type: 'CityJSON';
  readonly version: '2.0';
  readonly transform: { readonly scale: readonly [number, number, number]; readonly translate: readonly [number, number, number] };
  readonly metadata: Record<string, unknown>;
  readonly CityObjects: Record<string, unknown>;
  readonly vertices: (readonly [number, number, number])[];
  /** Non-standard member, `+`-prefixed per the CityJSON convention for extension
   *  data. The 2.0 schema CLOSES `metadata` to six keys, and validating against
   *  the official schema (jsonschema, Draft-7, all six sub-schemas) rejected
   *  `metadata.lineage` — so the lineage lives here, at the top level, where the
   *  spec leaves additionalProperties open. */
  readonly '+delta_lineage': Record<string, unknown>;
}

export function buildCityJSON(w: Ward): CityJSON {
  const fp = load<FootprintFile>(`data/geometry/${w.id}-footprints.json`);
  const hs = load<HeightsFile>('data/geometry/heights-overture.json').wards[w.id];
  const pv = load<ProvFile>(`public/heat-map/data/${w.id}-provenance.json`);
  if (!hs) throw new Error(`cityjson: no heights for ${w.id}`);
  if (fp.b.length !== hs.length || fp.b.length !== pv.src.length) {
    throw new Error(`cityjson: ${w.id} rows misaligned — footprints ${fp.b.length}, heights ${hs.length}, provenance ${pv.src.length}`);
  }
  const record = wardRecord(w);
  const [west, south] = wardBbox(w);
  const translate = [west, south, 0] as const;
  const keyToName = Object.fromEntries(Object.entries(pv.datasets).map(([name, v]) => [v.key, name]));

  const vertices: [number, number, number][] = [];
  const CityObjects: Record<string, unknown> = {};

  const q = (v: number, t: number, s: number) => Math.round((v - t) / s);

  fp.b.forEach((row, i) => {
    const h = hs[i]!;
    const ring = row.lonlat.slice(0, -1);        // drop the closing duplicate; CityJSON rings are implicit
    if (ring.length < 3) return;
    const base = vertices.length;
    const isFill = h.fill || h.p65 < FLOOR_M;
    const height = isFill ? FLOOR_M : h.p65;
    // bottom ring then top ring, same order
    for (const [lon, lat] of ring) vertices.push([q(lon, translate[0], SCALE[0]), q(lat, translate[1], SCALE[1]), 0]);
    for (const [lon, lat] of ring) vertices.push([q(lon, translate[0], SCALE[0]), q(lat, translate[1], SCALE[1]), q(height, 0, SCALE[2])]);
    const n = ring.length;
    const bottom = ring.map((_, k) => base + (n - 1 - k));            // reversed → outward normal (down)
    const top    = ring.map((_, k) => base + n + k);
    const walls  = ring.map((_, k) => {
      const k2 = (k + 1) % n;
      return [base + k, base + k2, base + n + k2, base + n + k];
    });
    const srcKey = pv.src[i]!;
    CityObjects[row.gers] = {
      type: 'Building',
      attributes: {
        height_m: height,
        height_statistic: 'p65 of Google Open Buildings 2.5D Temporal (2023) over the footprint',
        height_fill: isFill,
        footprint_source: keyToName[srcKey] ?? srcKey,
        footprint_confidence: pv.confidence[i] ?? -1,
        gers_id: row.gers,
      },
      geometry: [{ type: 'Solid', lod: '1', boundaries: [[[bottom], [top], ...walls.map((f) => [f])]] }],
    };
  });

  return {
    type: 'CityJSON',
    version: '2.0',
    transform: { scale: [...SCALE], translate: [...translate] },
    // metadata is CLOSED in the 2.0 schema: exactly these keys, and contactDetails
    // REQUIRES contactName + emailAddress. Both were caught by the official schema.
    metadata: {
      identifier: `delta-climate-${w.id}-lod1`,
      title: `${record.name} — LoD1 buildings`,
      referenceDate: new Date().toISOString().slice(0, 10),
      referenceSystem: 'https://www.opengis.net/def/crs/EPSG/0/4326',
      geographicalExtent: [...wardBbox(w).slice(0, 2), 0, ...wardBbox(w).slice(2, 4), Math.max(...hs.map((x) => x.p65))],
      pointOfContact: {
        contactName: 'Delta Climate Research',
        // the same public organisation address the site's structured data asserts
        emailAddress: 'angad@deltaclimate.earth',
        contactType: 'organization',
        website: 'https://deltaclimate.earth',
      },
    },
    CityObjects,
    vertices,
    '+delta_lineage': {
      status: 'prototype',
      analysisCrs: record.analysisCrs,
      confidence: record.confidence,
      provenance: record.provenance,
      note: 'Sample export. Heights are a zonal statistic over each footprint, verdict UNDERPOWERED against independent validation (see confidence.heights).',
    },
  };
}
