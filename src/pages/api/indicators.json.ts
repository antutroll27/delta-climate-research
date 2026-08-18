/* ISO city indicators. Read from the committed artefact that
   scripts/build-city-indicators.py produces — computed in the laboratory,
   served by the instrument, never recomputed at request time. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  const doc = readFileSync(resolve('data/indicators/iso-city-indicators.json'), 'utf8');
  return new Response(doc, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
