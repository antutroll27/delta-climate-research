import type { APIRoute, GetStaticPaths } from 'astro';
import { WARDS } from '../../../../data/wards.ts';
import { buildCityJSON } from '../../../../scripts/standards/cityjson.ts';

export const getStaticPaths: GetStaticPaths = () => WARDS.map((w) => ({ params: { id: w.id } }));

export const GET: APIRoute = ({ params }) => {
  const w = WARDS.find((x) => x.id === params.id);
  if (!w) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(buildCityJSON(w)),
    { headers: { 'Content-Type': 'application/city+json; charset=utf-8' } });
};
