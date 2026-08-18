/* Req 11 (/req/core/fc-md-op): the collections list. One collection today; it is
   generated from WARDS rather than hardcoded so a new study area appears here
   automatically. */
import type { APIRoute } from 'astro';
import { WARDS } from '../../data/wards.ts';
import { wardCollection } from '../../scripts/standards/geojson.ts';
import { COLLECTIONS, GEOJSON_TYPE, JSON_TYPE, LANDING } from '../../scripts/standards/ogc-links.ts';

export const GET: APIRoute = () => {
  const c = wardCollection(WARDS);
  return new Response(JSON.stringify({
    links: [
      { href: COLLECTIONS, rel: 'self', type: JSON_TYPE },
      { href: LANDING, rel: 'root', type: JSON_TYPE },
    ],
    collections: [{
      id: 'wards',
      title: 'Study wards',
      description: 'Analysis footprints of the study wards, each with its measured confidence and data lineage.',
      itemType: 'feature',
      crs: ['http://www.opengis.net/def/crs/OGC/1.3/CRS84'],
      extent: { spatial: { bbox: [c.bbox], crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } },
      links: [
        { href: '/api/collections/wards.json', rel: 'self', type: JSON_TYPE, title: 'Collection metadata' },
        { href: '/api/collections/wards/items.json', rel: 'items', type: GEOJSON_TYPE, title: 'Features' },
      ],
    }],
  }, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
