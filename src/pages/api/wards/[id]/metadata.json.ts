/* One record per ward. Everything in it traces to an artefact — see ward-record.ts. */
import type { APIRoute, GetStaticPaths } from 'astro';
import { WARDS } from '../../../../data/wards.ts';
import { wardRecord } from '../../../../scripts/standards/ward-record.ts';

export const getStaticPaths: GetStaticPaths = () => WARDS.map((w) => ({ params: { id: w.id } }));

export const GET: APIRoute = ({ params }) => {
  const w = WARDS.find((x) => x.id === params.id);
  if (!w) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), ...wardRecord(w) }, null, 2),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
