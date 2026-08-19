/**
 * STAC 1.0.0 — a STATIC catalogue of the per-ward products.
 *
 * STAC was the obvious standard we had never listed. We already CONSUME it
 * (Sentinel-2 via Earth Search) and published nothing, and the spec's own
 * best-practices document makes static catalogues first class: "a set of files
 * on a web server that link to one another", fully valid, no server. That is
 * this site's architecture exactly, rather than a compromise with it.
 *
 * ONE ITEM PER WARD x PRODUCT, not per ward. A STAC Item carries ONE temporal
 * extent, and our three products were captured over genuinely different periods:
 * the Sentinel-2 composite spans 2021-2025, the Meta/WRI canopy model rests on
 * 2018-2020 imagery, and the buildings carry a 2023 height epoch on a 2026
 * Overture release. Collapsing those into one Item per ward would have forced a
 * single date range onto three different answers, and at least two would have
 * been wrong — the same shape of error that put the wrong licence in the
 * attribution table.
 *
 * Dates are READ from the artefacts, never assumed: data/dc-urs/sentinel.json
 * records years_requested, heights-overture.json records its epoch, and
 * fetch-canopy.py documents the 2018-2020 source imagery.
 */
import type { Ward } from '../../data/wards.ts';
import { wardBbox } from './ward-record.ts';
import { LICENCE_BLOCK, ODBL_ID } from './odbl.ts';

export const STAC_VERSION = '1.0.0';
export const CATALOG_ID = 'delta-climate-wards';
export const COLLECTION_ID = 'ward-products';
export const STAC_TYPE = 'application/json';

const base = '/api/stac';
export const CATALOG_URL = `${base}/catalog.json`;
export const COLLECTION_URL = `${base}/collections/${COLLECTION_ID}.json`;
export const itemUrl = (id: string) => `${base}/items/${id}.json`;

export type ProductId = 'surface' | 'canopy' | 'buildings';

interface Product {
  readonly id: ProductId;
  readonly title: string;
  readonly description: string;
  /** SPDX identifier where one exists; 'proprietary' where the terms are bespoke. */
  readonly licence: string;
  readonly start: string;
  readonly end: string;
  readonly why: string;
}

/** Temporal extents are FACTS from the artefacts — see the module note. */
export const PRODUCTS: readonly Product[] = [
  {
    id: 'surface', title: 'Surface: vegetation fraction and broadband albedo',
    description: 'Per-cell vegetation fraction and Liang (2001) broadband albedo on the 140x140 ward grid, '
      + 'from a multi-year Sentinel-2 L2A median composite.',
    licence: 'proprietary',
    start: '2021-01-01T00:00:00Z', end: '2025-12-31T23:59:59Z',
    why: 'data/dc-urs/sentinel.json years_requested = 2021-2025; a median across years, so no single acquisition date exists.',
  },
  {
    id: 'canopy', title: 'Canopy height model',
    description: 'Canopy height in metres on the ward grid, resampled from the Meta / WRI global canopy height model.',
    licence: 'CC-BY-4.0',
    start: '2018-01-01T00:00:00Z', end: '2020-12-31T23:59:59Z',
    why: 'Roughly 80% of the model\'s source imagery is 2018-2020 (scripts/fetch-canopy.py). Not fresher than that, and dating it to the download would misrepresent it.',
  },
  {
    id: 'buildings', title: 'LoD1 building geometry',
    description: 'Building footprints extruded to one height each, published as CityJSON 2.0, OGC 3D Tiles 1.1 '
      + 'and GeoJSON.',
    licence: ODBL_ID,
    start: '2023-01-01T00:00:00Z', end: '2026-07-22T23:59:59Z',
    why: 'Heights carry a 2023 epoch (heights-overture.json); footprints come from the Overture 2026-07-22.0 release.',
  },
];

/** `Ward.name` carries <em> to mark the wordmark's stressed syllable. ward-record
 *  strips it; STAC imported Ward directly and shipped the raw markup into ten
 *  machine-readable documents. stac_valid cannot catch it — `title` is a free
 *  string. */
const plain = (s: string) => s.replace(/<\/?em>/g, '');

const link = (rel: string, href: string, type = STAC_TYPE, title?: string) =>
  ({ rel, href, type, ...(title ? { title } : {}) });

export function stacCatalog(wards: readonly Ward[]) {
  return {
    type: 'Catalog', stac_version: STAC_VERSION, id: CATALOG_ID,
    title: 'Delta Climate Research — study ward products',
    description: 'A static STAC catalogue of the measured inputs and derived geometry behind the urban climate '
      + 'digital twin prototype. Static by design: files that link to one another, no server.',
    links: [
      link('root', CATALOG_URL), link('self', CATALOG_URL),
      link('child', COLLECTION_URL, STAC_TYPE, 'Ward products'),
      { rel: 'license', href: '/api/licence.json', type: STAC_TYPE, title: 'Licence position' },
      ...wards.flatMap((w) => PRODUCTS.map((p) =>
        link('item', itemUrl(`${w.id}-${p.id}`), 'application/geo+json', `${plain(w.name)} — ${p.title}`))),
    ],
  };
}

export function stacCollection(wards: readonly Ward[]) {
  const boxes = wards.map(wardBbox);
  const bbox: [number, number, number, number] = [
    Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3])),
  ];
  return {
    type: 'Collection', stac_version: STAC_VERSION, id: COLLECTION_ID,
    title: 'Ward products',
    description: 'Surface, canopy and building products for each study ward. Licences differ by product, so the '
      + 'collection declares "various" and every Item and asset carries its own.',
    license: 'various',
    extent: {
      spatial: { bbox: [bbox] },
      // widest range across the three products, so the collection cannot claim
      // currency none of its items has
      temporal: { interval: [[PRODUCTS[2]!.start < PRODUCTS[1]!.start ? PRODUCTS[2]!.start : PRODUCTS[1]!.start, PRODUCTS[0]!.end]] },
    },
    links: [
      link('root', CATALOG_URL), link('self', COLLECTION_URL), link('parent', CATALOG_URL),
      { rel: 'license', href: '/api/licence.json', type: STAC_TYPE },
      ...wards.flatMap((w) => PRODUCTS.map((p) =>
        link('item', itemUrl(`${w.id}-${p.id}`), 'application/geo+json'))),
    ],
    providers: [
      { name: 'Delta Climate Research', roles: ['processor', 'host'], url: 'https://deltaclimate.earth' },
      { name: 'Overture Maps Foundation', roles: ['producer'], url: 'https://overturemaps.org/' },
      { name: 'ESA / Copernicus', roles: ['producer'], url: 'https://sentinels.copernicus.eu/' },
      { name: 'Meta AI / World Resources Institute', roles: ['producer'], url: 'https://registry.opendata.aws/dataforgood-fb-forests/' },
    ],
  };
}

function assetsFor(w: Ward, p: Product): Record<string, unknown> {
  if (p.id === 'surface') {
    return {
      surface: {
        href: `/heat-map/data/${w.id}-surface.png`, type: 'image/png',
        title: 'Vegetation fraction (R) and broadband albedo (G)', roles: ['data'],
        'delta:encoding': 'value = channel/255 * (hi - lo) + lo; veg [0,1], albedo [0,0.5]',
      },
      metadata: { href: '/heat-map/data/surface-meta.json', type: STAC_TYPE, title: 'Encoding and provenance', roles: ['metadata'] },
    };
  }
  if (p.id === 'canopy') {
    return {
      canopy: {
        href: `/heat-map/data/${w.id}-canopy.png`, type: 'image/png',
        title: 'Canopy height, quantised 0-30 m in the R channel', roles: ['data'],
        'delta:encoding': 'height_m = R/255 * 30',
      },
    };
  }
  return {
    cityjson: { href: `/api/wards/${w.id}/cityjson.json`, type: 'application/city+json', title: 'CityJSON 2.0 LoD1', roles: ['data'] },
    tileset: { href: `/3d-tiles/${w.id}/tileset.json`, type: STAC_TYPE, title: 'OGC 3D Tiles 1.1 tileset', roles: ['data', 'visual'] },
    geojson: { href: `/api/collections/wards/items/${w.id}.json`, type: 'application/geo+json', title: 'Ward footprint as GeoJSON', roles: ['data'] },
    record: { href: `/api/wards/${w.id}/metadata.json`, type: STAC_TYPE, title: 'Measured confidence and full lineage', roles: ['metadata'] },
  };
}

export function stacItem(w: Ward, p: Product) {
  const [west, south, east, north] = wardBbox(w);
  return {
    type: 'Feature', stac_version: STAC_VERSION, id: `${w.id}-${p.id}`,
    collection: COLLECTION_ID,
    geometry: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] },
    bbox: [west, south, east, north],
    properties: {
      title: `${plain(w.name)} — ${p.title}`,
      description: p.description,
      // null with start/end is the correct STAC form for a composite: there is no
      // single acquisition instant, and inventing one would be a fabricated date
      datetime: null,
      start_datetime: p.start,
      end_datetime: p.end,
      'delta:temporal_basis': p.why,
      license: p.licence,
      'delta:status': 'prototype',
      ...(p.id === 'buildings' ? { 'delta:licence_notice': LICENCE_BLOCK.notice } : {}),
    },
    links: [
      link('root', CATALOG_URL), link('parent', COLLECTION_URL), link('collection', COLLECTION_URL),
      link('self', itemUrl(`${w.id}-${p.id}`), 'application/geo+json'),
      { rel: 'license', href: '/api/licence.json', type: STAC_TYPE },
    ],
    assets: assetsFor(w, p),
  };
}

export const ITEM_IDS = (wards: readonly Ward[]) => wards.flatMap((w) => PRODUCTS.map((p) => `${w.id}-${p.id}`));
