/**
 * page-meta.ts — what an area page CALLS ITSELF, spelled once.
 *
 * WHY THIS IS A MODULE AND NOT TWO TEMPLATE LITERALS IN THE PAGE. The area route
 * renders the title and description at build time; the instrument rewrites them
 * when the reader switches ward in place, because that switch does not reload the
 * document and `history.replaceState` would otherwise pair the NEW url with the
 * OLD title. Two writers, one sentence. Written out twice they would agree on the
 * day they were written and drift on every day after — and the drift would be
 * invisible, because each writer is correct on its own terms: the server's title
 * is right for the page that loaded, the client's for the page you are looking at,
 * and only a reader who switched wards would ever see them disagree.
 *
 * That is the same failure the whole scope module exists to prevent one level up,
 * where `areaPath` is the one place a per-area URL is spelled.
 *
 * NO DOM AND NO ASTRO HERE. The page imports it in frontmatter (Node, at build
 * time) and heat-map-app.ts imports it in the browser, so it must be pure: a
 * `ResolvedScope` in, a string out.
 */
import { currencyMark } from '../money.ts';
import type { ResolvedScope } from './resolve.ts';

/**
 * The page's title, in `<title>`, `og:title` and `twitter:title` alike.
 *
 * It ends in the brand rather than starting with it, because a browser tab and a
 * bookmark list both truncate from the right and the ward is the part that
 * distinguishes one of these pages from the other five.
 */
export function areaPageTitle(scope: ResolvedScope): string {
  return `${scope.area.name} Urban Heat Explorer — ${scope.city.name} — Delta Climate Research`;
}

/**
 * The page's description, in `meta[name=description]`, `og:description` and
 * `twitter:description`.
 *
 * TWO SENTENCES, CHOSEN BY `hasData`, because the honest description of an area
 * that ships no artefacts is not a shorter version of the other one — it is a
 * different statement. A registered area with nothing measured for it says so, and
 * says at what confidence; describing it as an "interactive simulator" would
 * promise a tool the page does not render.
 */
export function areaPageDescription(scope: ResolvedScope): string {
  if (!scope.area.hasData) {
    return `${scope.area.name}, ${scope.city.name} is registered in the OBOS urban-heat twin at `
      + `"${scope.tier}" confidence. No measured heat artefacts ship for it yet.`;
  }
  /* THE CURRENCY COMES FROM THE COUNTRY, and this sentence used to type it in.
     Kolkata reads exactly as it did; a Gulf page would have advertised the rupee.
     A country that has adopted no cost basis drops the clause rather than naming a
     currency it does not have — `requireCosts` throws for that case, and a throw
     inside a prerender is a failed build rather than a missing sentence. */
  const costs = scope.climate.costs;
  const money = costs === null ? '' : ` and cost in ${currencyMark(costs)}`;
  return `Interactive urban-heat-island simulator for ${scope.area.name}, ${scope.city.name} `
    + `(${scope.area.descriptor}) — test green interventions and see cooling in °C`
    + `${money} on a live 3D map. Modelled scenario, screening-grade.`;
}
