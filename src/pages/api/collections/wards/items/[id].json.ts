import type { APIRoute, GetStaticPaths } from 'astro';
import { WARDS } from '../../../../../data/wards.ts';
import { wardFeature } from '../../../../../scripts/standards/geojson.ts';

export const getStaticPaths: GetStaticPaths = () => WARDS.map((w) => ({ params: { id: w.id } }));

export const GET: APIRoute = ({ params }) => {
  const w = WARDS.find((x) => x.id === params.id);
  if (!w) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(wardFeature(w), null, 2), { headers: { 'Content-Type': 'application/geo+json; charset=utf-8' } });
};
