/* Req 5 (/req/core/conformance-op) and Req 6 (/req/core/conformance-success).
   The array is empty on purpose — see ogc-links.ts for why that is the honest
   answer rather than a subset claim. */
import type { APIRoute } from 'astro';
import { CONFORMANCE, LANDING, NOT_CONFORMANT_REASON } from '../../scripts/standards/ogc-links.ts';

export const GET: APIRoute = () => new Response(JSON.stringify({
  conformsTo: [],
  reason: NOT_CONFORMANT_REASON,
  // stated separately so a reader can see exactly which requirements are unmet
  unmetRequirements: [
    { requirement: '/req/core/fc-limit-definition (Req 21)', parameter: 'limit', reason: 'static files cannot vary by query parameter' },
    { requirement: '/req/core/fc-bbox-definition (Req 23)', parameter: 'bbox', reason: 'static files cannot vary by query parameter' },
    { requirement: '/req/core/fc-time-definition (§7.15.4)', parameter: 'datetime', reason: 'static files cannot vary by query parameter; the collection is not time-varying' },
  ],
  links: [
    { href: CONFORMANCE, rel: 'self', type: 'application/json' },
    { href: LANDING, rel: 'root', type: 'application/json' },
  ],
}, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
