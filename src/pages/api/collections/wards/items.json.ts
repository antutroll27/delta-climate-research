import type { APIRoute } from 'astro';
import { WARDS } from '../../../../data/wards.ts';
import { wardCollection } from '../../../../scripts/standards/geojson.ts';

export const GET: APIRoute = () => new Response(JSON.stringify(wardCollection(WARDS), null, 2),
  { headers: { 'Content-Type': 'application/geo+json; charset=utf-8' } });
