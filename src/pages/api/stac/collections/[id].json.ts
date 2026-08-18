import type { APIRoute, GetStaticPaths } from 'astro';
import { WARDS } from '../../../../data/wards.ts';
import { COLLECTION_ID, stacCollection } from '../../../../scripts/standards/stac.ts';

export const getStaticPaths: GetStaticPaths = () => [{ params: { id: COLLECTION_ID } }];

export const GET: APIRoute = () => new Response(JSON.stringify(stacCollection(WARDS), null, 2),
  { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
