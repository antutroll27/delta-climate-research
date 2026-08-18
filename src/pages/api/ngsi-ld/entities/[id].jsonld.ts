import type { APIRoute, GetStaticPaths } from 'astro';
import { WARDS } from '../../../../data/wards.ts';
import { NGSI_TYPE, wardEntity } from '../../../../scripts/standards/ngsi-ld.ts';

export const getStaticPaths: GetStaticPaths = () => WARDS.map((w) => ({ params: { id: w.id } }));

export const GET: APIRoute = ({ params }) => {
  const w = WARDS.find((x) => x.id === params.id);
  if (!w) return new Response('not found', { status: 404 });
  // single-entity responses inline the context, so the document is self-contained
  return new Response(JSON.stringify(wardEntity(w, { inline: true }), null, 2),
    { headers: { 'Content-Type': `${NGSI_TYPE}; charset=utf-8` } });
};
