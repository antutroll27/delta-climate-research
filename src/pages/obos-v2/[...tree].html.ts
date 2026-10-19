// src/pages/obos-v2/[...tree].html.ts — FINAL audit F5. Each v2 tree as its own file: /obos-v2/area/<country>/<city>/<area>.html, /obos-v2/compare.html, /obos-v2/brief.html.
/**
 * The v2 tree used to ride inside every page as an inert <template> (85 KB raw on Ballygunge), so a v1 reader downloaded markup that never ran. Now the page carries none of it:
 * UiSwap fetches the file for ITS page, and only under the flag. The markup is exactly what the template held (the same components, rendered by Astro's container), so every
 * id still exists once. The URL is not linked from anywhere in the HTML (UiSwap's script holds it), and the file is not a page: no layout, no head.
 */
import type { APIRoute } from 'astro';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import HeatMapStageV2 from '../../components/ClimateEngine/v2/HeatMapStageV2.astro';
import PairedBenchV2 from '../../components/ClimateEngine/compare/PairedBenchV2.astro';
import HeatMapBriefV2 from '../../components/ClimateEngine/brief/HeatMapBriefV2.astro';
import { AREA_KEYS, isAreaKey } from '../../scripts/climate-engine/scope/registry.ts';
import { resolve } from '../../scripts/climate-engine/scope/resolve.ts';

export function getStaticPaths() {
  return [...AREA_KEYS.map((key) => ({ params: { tree: `area/${key}` } })), { params: { tree: 'compare' } }, { params: { tree: 'brief' } }];
}

export const GET: APIRoute = async ({ params }) => {
  const tree = params.tree ?? '';
  const container = await AstroContainer.create();
  let html: string;
  if (tree === 'compare') html = await container.renderToString(PairedBenchV2);
  else if (tree === 'brief') html = await container.renderToString(HeatMapBriefV2);
  else {
    const key = tree.replace(/^area\//, '');
    if (!isAreaKey(key)) return new Response('not found', { status: 404 });
    html = await container.renderToString(HeatMapStageV2, { props: { scope: resolve(key) } });
  }
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
};
