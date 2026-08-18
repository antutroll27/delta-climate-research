import type { APIRoute, GetStaticPaths } from 'astro';
import { WARDS } from '../../../../data/wards.ts';
import { PRODUCTS, stacItem } from '../../../../scripts/standards/stac.ts';

export const getStaticPaths: GetStaticPaths = () =>
  WARDS.flatMap((w) => PRODUCTS.map((p) => ({ params: { id: `${w.id}-${p.id}` }, props: { ward: w.id, product: p.id } })));

export const GET: APIRoute = ({ params }) => {
  const id = String(params.id ?? '');
  const p = PRODUCTS.find((x) => id.endsWith(`-${x.id}`));
  const w = WARDS.find((x) => p && id === `${x.id}-${p.id}`);
  if (!w || !p) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(stacItem(w, p), null, 2),
    { headers: { 'Content-Type': 'application/geo+json; charset=utf-8' } });
};
