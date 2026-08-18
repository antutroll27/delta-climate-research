/**
 * schema.org/Dataset — how a data team actually FINDS this.
 *
 * Everything built in this standards pass assumed someone already knew the URLs.
 * Google Dataset Search, and the open-data portals that follow the same
 * vocabulary, discover datasets by reading schema.org/Dataset JSON-LD off the
 * page. We published none, so none of it was discoverable — which is a strange
 * gap for work whose whole point is being checkable by an outsider.
 *
 * Every field here traces to an artefact. `distribution` lists formats that
 * actually resolve, `temporalCoverage` comes from the STAC products rather than
 * being asserted, and `license` is the governing licence, not the source one —
 * the distinction the attribution fix turned on.
 */
import type { Ward } from '../../data/wards.ts';
import { PRODUCTS } from './stac.ts';
import { wardBbox } from './ward-record.ts';
import { ODBL_URI } from './odbl.ts';

const SITE = 'https://deltaclimate.earth';

/** ISO 8601 interval spanning every product, so we cannot claim currency none has. */
export function temporalCoverage(): string {
  const start = PRODUCTS.map((p) => p.start).sort()[0]!;
  const end = PRODUCTS.map((p) => p.end).sort().at(-1)!;
  return `${start.slice(0, 10)}/${end.slice(0, 10)}`;
}

export function datasetJsonLd(wards: readonly Ward[]) {
  const boxes = wards.map(wardBbox);
  const [w, s, e, n] = [
    Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3])),
  ];
  return {
    '@context': 'https://schema.org/',
    '@type': 'Dataset',
    name: 'Delta Climate Research — urban heat study ward products',
    description: 'Measured surface, canopy and LoD1 building geometry for three Kolkata study wards, published '
      + 'with the out-of-sample error of the thermal model that uses them and the full lineage of every input. '
      + 'A research prototype: planning-grade estimates, not certified engineering data.',
    url: `${SITE}/attribution`,
    identifier: `${SITE}/api/stac/catalog.json`,
    license: ODBL_URI,
    isAccessibleForFree: true,
    creativeWorkStatus: 'Prototype',
    keywords: ['urban heat island', 'land surface temperature', 'building footprints', 'canopy cover',
      'Kolkata', 'digital twin', 'CityJSON', '3D Tiles', 'STAC'],
    temporalCoverage: temporalCoverage(),
    // schema.org GeoShape box order is "south west north east"
    spatialCoverage: {
      '@type': 'Place',
      geo: { '@type': 'GeoShape', box: `${s} ${w} ${n} ${e}` },
    },
    creator: {
      '@type': 'Organization', name: 'Delta Climate Research', url: SITE,
      email: 'angad@deltaclimate.earth',
    },
    // only formats that actually resolve — a distribution that 404s is worse
    // than one that is absent
    distribution: [
      { '@type': 'DataDownload', encodingFormat: 'application/json', name: 'STAC catalogue', contentUrl: `${SITE}/api/stac/catalog.json` },
      { '@type': 'DataDownload', encodingFormat: 'application/geo+json', name: 'Ward footprints (GeoJSON)', contentUrl: `${SITE}/api/collections/wards/items.json` },
      { '@type': 'DataDownload', encodingFormat: 'application/city+json', name: 'LoD1 buildings (CityJSON 2.0)', contentUrl: `${SITE}/api/wards/ballygunge/cityjson.json` },
      { '@type': 'DataDownload', encodingFormat: 'application/json', name: 'LoD1 buildings (OGC 3D Tiles 1.1)', contentUrl: `${SITE}/3d-tiles/ballygunge/tileset.json` },
      { '@type': 'DataDownload', encodingFormat: 'application/ld+json', name: 'NGSI-LD entities', contentUrl: `${SITE}/api/ngsi-ld/entities.jsonld` },
      { '@type': 'DataDownload', encodingFormat: 'application/json', name: 'ISO 37123 city indicators', contentUrl: `${SITE}/api/indicators.json` },
    ],
    // the error bars are part of the dataset's description, not a footnote
    variableMeasured: [
      { '@type': 'PropertyValue', name: 'Land surface temperature', description: 'Modelled, validated against ECOSTRESS leave-one-overpass-out. NOT air temperature and NOT a comfort index.', unitText: 'K' },
      { '@type': 'PropertyValue', name: 'Canopy height', unitText: 'm' },
      { '@type': 'PropertyValue', name: 'Broadband albedo', unitText: 'dimensionless' },
      { '@type': 'PropertyValue', name: 'Building height', description: 'Zonal p65 of Google Open Buildings 2.5D; independent validation returned UNDERPOWERED.', unitText: 'm' },
    ],
    citation: `${SITE}/uncertainty`,
    includedInDataCatalog: { '@type': 'DataCatalog', name: 'Delta Climate Research STAC catalogue', url: `${SITE}/api/stac/catalog.json` },
  };
}
