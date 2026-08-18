import type { APIRoute } from 'astro';
import { CONTEXT_DOCUMENT, NGSI_TYPE } from '../../../scripts/standards/ngsi-ld.ts';

export const GET: APIRoute = () => new Response(JSON.stringify(CONTEXT_DOCUMENT, null, 2),
  { headers: { 'Content-Type': `${NGSI_TYPE}; charset=utf-8` } });
