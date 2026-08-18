/* All ward entities. NGSI-LD returns a plain JSON array of entities. */
import type { APIRoute } from 'astro';
import { WARDS } from '../../../data/wards.ts';
import { NGSI_TYPE, wardEntity } from '../../../scripts/standards/ngsi-ld.ts';

export const GET: APIRoute = () => new Response(JSON.stringify(WARDS.map((w) => wardEntity(w)), null, 2),
  { headers: { 'Content-Type': `${NGSI_TYPE}; charset=utf-8` } });
