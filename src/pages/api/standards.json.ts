/* Static, built at build time. Same URL the standards spec §8.1 names; no server. */
import type { APIRoute } from 'astro';
import { APPROVED_STATEMENT, MATRIX, UNCERTAINTY_STATEMENT } from '../../scripts/standards/matrix.ts';

export const GET: APIRoute = () => new Response(JSON.stringify({
  status: 'prototype',
  generatedAt: new Date().toISOString(),
  statement: APPROVED_STATEMENT,
  uncertainty: UNCERTAINTY_STATEMENT,
  vocabulary: {
    aligned: 'implements the data model, schema or API pattern the standard defines',
    compatible: 'interoperates with a named ecosystem in testing',
    roadmap: 'planned; nothing ships',
  },
  matrix: MATRIX,
}, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
