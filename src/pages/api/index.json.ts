/* OGC API — Features landing page. Req 1 (/req/core/root-op) puts this at the
   API root; Req 2 (/req/core/root-success) fixes which links it must carry. */
import type { APIRoute } from 'astro';
import { landingLinks, NOT_CONFORMANT_REASON } from '../../scripts/standards/ogc-links.ts';

export const GET: APIRoute = () => new Response(JSON.stringify({
  title: 'Delta Climate Research — study ward features',
  description: 'Read-only geospatial documents for the urban climate digital twin prototype: '
    + 'ward footprints with measured confidence and full data lineage. Static files, no server.',
  attribution: 'Building footprints via Overture Maps Foundation (ODbL). See /attribution.',
  status: 'prototype',
  conformanceNote: NOT_CONFORMANT_REASON,
  links: landingLinks,
}, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
