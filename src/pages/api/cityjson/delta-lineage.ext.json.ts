/* The CityJSON Extension our exports declare. Must stay reachable at the URI it
   names — the reference validator downloads it. */
import type { APIRoute } from 'astro';
import { EXTENSION_DOCUMENT } from '../../../scripts/standards/cityjson.ts';

export const GET: APIRoute = () => new Response(JSON.stringify(EXTENSION_DOCUMENT, null, 2),
  { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
