/* OGC API Features-INSPIRED collection metadata. Static; no landing page, no
   conformance declaration — /standards says so. */
import type { APIRoute } from 'astro';
import { WARDS } from '../../../data/wards.ts';
import { wardCollection } from '../../../scripts/standards/geojson.ts';
import { COLLECTIONS, GEOJSON_TYPE, JSON_TYPE, LANDING } from '../../../scripts/standards/ogc-links.ts';

export const GET: APIRoute = () => {
  const c = wardCollection(WARDS);
  return new Response(JSON.stringify({
    status: 'prototype', id: 'wards', title: 'Study wards',
    description: 'The analysis footprints of the study wards, each with its measured confidence and data lineage.',
    itemType: 'feature', crs: ['http://www.opengis.net/def/crs/OGC/1.3/CRS84'],
    extent: { spatial: { bbox: [c.bbox], crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } },
    links: [
      { href: '/api/collections/wards.json', rel: 'self', type: JSON_TYPE },
      { href: '/api/collections/wards/items.json', rel: 'items', type: GEOJSON_TYPE },
      // upward navigation: a client that lands mid-API can still find the root
      { href: COLLECTIONS, rel: 'collection', type: JSON_TYPE },
      { href: LANDING, rel: 'root', type: JSON_TYPE },
    ],
  }, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
