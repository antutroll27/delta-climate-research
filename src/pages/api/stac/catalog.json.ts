import type { APIRoute } from 'astro';
import { WARDS } from '../../../data/wards.ts';
import { stacCatalog } from '../../../scripts/standards/stac.ts';

export const GET: APIRoute = () => new Response(JSON.stringify(stacCatalog(WARDS), null, 2),
  { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
