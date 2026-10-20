// src/scripts/climate-engine/v2/ui-flag.ts
/**
 * OBOS v2 — PREFERENCES BEFORE FIRST PAINT (flip plan A.2).
 *
 * v2 is the default UI, so there is no flag any more: the page is server-rendered as <html data-ui="v2"> and the v2 tree is in the HTML. What stays is the stored-preference logic.
 * The inline script is a string built HERE so every key is spelled once, exactly as shell/layout-state.ts does for LAYOUT_PREPAINT. V2Prefs.astro embeds it with `set:html`
 * as the FIRST child of each v2 root, so it runs before any child is parsed and a stored Light/Glass choice is on the root before the first paint.
 */
export const UI_ATTR = 'data-ui';

export const V2_KEYS = Object.freeze({
  theme: 'obos:v2:theme',
  cards: 'obos:v2:cards',
  menu: 'obos:v2:menu',
  side: 'obos:v2:side',
  lookChosen: 'obos:v2:look-chosen',
  sheetSettled: 'obos:v2:sheet-settled',
} as const);

export type Theme = 'dark' | 'light';
export type Cards = 'glass' | 'plates';
export type MenuState = 'labels' | 'icons';
export type SideState = 'open' | 'closed';
export interface V2Prefs { readonly theme: Theme; readonly cards: Cards; readonly menu: MenuState; readonly side: SideState }

/** Desktop layout starts at this width (spec §3). */
export const DESKTOP_MIN_PX = 1366;

/** Laptop band (spec §3): the rail shows icons while a side panel shows (twin rule). */
export const LAPTOP_MIN_PX = 700;
export function effectiveMenu(menu: MenuState, width: number, sideShown: boolean): MenuState {
  return sideShown && width >= LAPTOP_MIN_PX && width < DESKTOP_MIN_PX ? 'icons' : menu;
}

export function resolvePrefs(
  stored: Readonly<Record<string, string | null | undefined>>,
  env: { readonly coarse: boolean; readonly width: number },
): V2Prefs {
  const s = (k: string): string | null => stored[k] ?? null;
  const theme = s(V2_KEYS.theme) === 'light' ? 'light' : 'dark';
  const c = s(V2_KEYS.cards);
  /* D2 revised (founder, 17 Oct): Plates by default on every device and tier; Glass only when chosen. `env.coarse` no longer decides. */
  const cards: Cards = c === 'glass' ? 'glass' : 'plates';
  const m = s(V2_KEYS.menu);
  const menu: MenuState = m === 'labels' || m === 'icons' ? m : env.width >= DESKTOP_MIN_PX ? 'labels' : 'icons';
  const side: SideState = s(V2_KEYS.side) === 'closed' ? 'closed' : 'open';
  return { theme, cards, menu, side };
}

const J = (v: string): string => JSON.stringify(v);

/** Runs as the first child of a v2 root (document.currentScript.parentElement), before any of the root's children are parsed. Applies the stored prefs and the derived layout attributes
 *  with exactly resolvePrefs / effectiveMenu's rules. Blocked storage means the defaults, which the server already wrote on the root. */
export const V2_PREFS_JS = `(function(){
var s=document.currentScript;var root=s&&s.parentElement;if(!root)return;
function g(k){try{return localStorage.getItem(k);}catch(e){return null;}}
var w=window.innerWidth||1440;
var th=g(${J(V2_KEYS.theme)}),cd=g(${J(V2_KEYS.cards)}),mn=g(${J(V2_KEYS.menu)}),sd=g(${J(V2_KEYS.side)});
var menu=mn==='labels'||mn==='icons'?mn:(w>=${DESKTOP_MIN_PX}?'labels':'icons');
var side=sd==='closed'?'closed':'open',shown=side==='open';
root.setAttribute('data-theme',th==='light'?'light':'dark');
root.setAttribute('data-cards',cd==='glass'?'glass':'plates');
root.setAttribute('data-menu',menu);
root.setAttribute('data-side',side);
root.setAttribute('data-side-current','explore');
root.setAttribute('data-side-shown',shown?'1':'0');
root.setAttribute('data-menu-eff',shown&&w>=${LAPTOP_MIN_PX}&&w<${DESKTOP_MIN_PX}?'icons':menu);
root.setAttribute('data-glass','flat');
root.setAttribute('data-section','overview');
})();`;

/** What the server writes on every v2 root: the same values V2_PREFS_JS writes for an empty store at desktop width, so no-JS and an early paint are a valid state. */
export const V2_ROOT_DEFAULTS = Object.freeze({
  'data-theme': 'dark', 'data-cards': 'plates', 'data-glass': 'flat', 'data-section': 'overview', 'data-side': 'open',
  'data-side-current': 'explore', 'data-side-shown': '1', 'data-menu': 'labels', 'data-menu-eff': 'labels',
} as const);
