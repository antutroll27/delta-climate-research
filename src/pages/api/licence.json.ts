/* One authoritative licence statement for the geometry exports, so a reader does
   not have to reconstruct our position from four payloads. */
import type { APIRoute } from 'astro';
import { LICENCE_BLOCK, ODBL_URI } from '../../scripts/standards/odbl.ts';

export const GET: APIRoute = () => new Response(JSON.stringify({
  status: 'prototype',
  ...LICENCE_BLOCK,
  appliesTo: [
    '/api/wards/{id}/cityjson.json',
    '/api/collections/wards/items.json',
    '/api/collections/wards/items/{id}.json',
    '/3d-tiles/{id}/tileset.json and its content.glb',
    '/api/ngsi-ld/entities/{id}.jsonld (the location GeoProperty)',
  ],
  notAppliesTo: [
    { path: '/api/wards/{id}/metadata.json', note: 'Carries no geometry beyond a bounding box: measured confidence and provenance only.' },
    { path: '/api/indicators.json', note: 'Derived statistics from Sentinel-2 and the Meta/WRI canopy model, not from ODbL building geometry.' },
    { path: '/api/standards.json', note: 'Our own statements about alignment.' },
  ],
  fullText: ODBL_URI,
}, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
