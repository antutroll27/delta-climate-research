/* OGC API Features-INSPIRED collection metadata. Static; no landing page, no
   conformance declaration — /standards says so. */
import type { APIRoute } from 'astro';
import { WARDS } from '../../../data/wards.ts';
import { wardCollection } from '../../../scripts/standards/geojson.ts';

export const GET: APIRoute = () => {
  const c = wardCollection(WARDS);
  return new Response(JSON.stringify({
    status: 'prototype', id: 'wards', title: 'Study wards',
    description: 'The analysis footprints of the study wards, each with its measured confidence and data lineage.',
    itemType: 'feature', crs: ['http://www.opengis.net/def/crs/OGC/1.3/CRS84'],
    extent: { spatial: { bbox: [c.bbox], crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } },
    links: [
      { href: '/api/collections/wards.json', rel: 'self', type: 'application/json' },
      { href: '/api/collections/wards/items.json', rel: 'items', type: 'application/geo+json' },
    ],
  }, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
