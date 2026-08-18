/* Describes exactly the routes that exist and nothing more. Static; there is no
   server, so no security schemes, no rate limits — stated in `info`. */
import type { APIRoute } from 'astro';
import { WARDS } from '../../data/wards.ts';

const ids = WARDS.map((w) => w.id);
const wardParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', enum: ids } };
const json = (desc: string, mediaType = 'application/json') => ({ description: desc, content: { [mediaType]: { schema: { type: 'object' } } } });

export const GET: APIRoute = () => new Response(JSON.stringify({
  openapi: '3.1.0',
  info: {
    title: 'Delta Climate Research — digital twin standards surface',
    version: '0.1.0-prototype',
    description: 'Read-only, static JSON emitted at build time at the paths OGC API Features and CityJSON consumers expect. '
      + 'There is no server: no authentication, no rate limiting, no query parameters. Every payload carries status:"prototype". '
      + 'Alignment, not certification — see /standards.',
  },
  servers: [{ url: 'https://deltaclimate.earth' }],
  paths: {
    // self-describing: §13.2 requires openapi.json describe EVERY published endpoint,
    // and openapi.json is itself one. Omitting it failed that check literally.
    '/api/index.json': { get: { summary: 'OGC API — Features landing page (Req 1)', responses: { '200': json('landing page with conformance and data links') } } },
    '/api/conformance.json': { get: { summary: 'Conformance declaration (Req 5). Declares NO classes — see the reason field.', responses: { '200': json('conformsTo (empty) + unmet requirements') } } },
    '/api/collections.json': { get: { summary: 'Collections list (Req 11)', responses: { '200': json('collections') } } },
    '/api/openapi.json': { get: { summary: 'This document', responses: { '200': json('OpenAPI 3.1 description of every published endpoint') } } },
    '/api/standards.json': { get: { summary: 'Standards alignment matrix', responses: { '200': json('matrix + approved statements') } } },
    '/api/collections/wards.json': { get: { summary: 'Ward collection metadata (OGC API Features-inspired)', responses: { '200': json('collection') } } },
    '/api/collections/wards/items.json': { get: { summary: 'All wards as a GeoJSON FeatureCollection', responses: { '200': json('FeatureCollection', 'application/geo+json') } } },
    '/api/collections/wards/items/{id}.json': { get: { summary: 'One ward as a GeoJSON Feature', parameters: [wardParam], responses: { '200': json('Feature', 'application/geo+json'), '404': { description: 'unknown ward' } } } },
    '/api/wards/{id}/metadata.json': { get: { summary: 'Ward record: measured confidence + full data lineage', parameters: [wardParam], responses: { '200': json('WardRecord') } } },
    '/api/wards/{id}/cityjson.json': { get: { summary: 'LoD1 CityJSON 2.0, one Building per shipped footprint', parameters: [wardParam], responses: { '200': json('CityJSON', 'application/city+json') } } },
    '/api/ngsi-ld/context.jsonld': { get: { summary: 'JSON-LD @context defining the domain terms the entities use', responses: { '200': json('@context document', 'application/ld+json') } } },
    '/api/ngsi-ld/entities.jsonld': { get: { summary: 'All ward entities in NGSI-LD form (information model only; no context broker)', responses: { '200': json('array of NGSI-LD entities', 'application/ld+json') } } },
    '/api/ngsi-ld/entities/{id}.jsonld': { get: { summary: 'One ward as a self-contained NGSI-LD entity', parameters: [wardParam], responses: { '200': json('NGSI-LD entity', 'application/ld+json'), '404': { description: 'unknown ward' } } } },
  },
}, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
