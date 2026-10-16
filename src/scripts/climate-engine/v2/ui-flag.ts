// src/scripts/climate-engine/v2/ui-flag.ts
/**
 * OBOS v2 — THE UI FLAG (spec §1.3, §1.5).
 *
 * Pure. The two inline scripts are strings built HERE so every key is spelled once,
 * exactly as shell/layout-state.ts does for LAYOUT_PREPAINT. UiPrepaint.astro and
 * UiSwap.astro embed them with `set:html`.
 */
export const UI_FLAG_KEY = 'obos:ui';
export const UI_ATTR = 'data-ui';
export const V2_TREE_ID = 'obos-v2-tree';

export const V2_KEYS = Object.freeze({
  theme: 'obos:v2:theme',
  cards: 'obos:v2:cards',
  menu: 'obos:v2:menu',
  side: 'obos:v2:side',
  lookChosen: 'obos:v2:look-chosen',
  sheetSettled: 'obos:v2:sheet-settled',
} as const);

export type UiVersion = 'v1' | 'v2';
export type StoreAction = 'set' | 'clear' | 'keep';
export interface UiDecision { readonly ui: UiVersion; readonly store: StoreAction }

export type Theme = 'dark' | 'light';
export type Cards = 'glass' | 'plates';
export type MenuState = 'labels' | 'icons';
export type SideState = 'open' | 'closed';
export interface V2Prefs { readonly theme: Theme; readonly cards: Cards; readonly menu: MenuState; readonly side: SideState }

/** Desktop layout starts at this width (spec §3). */
export const DESKTOP_MIN_PX = 1366;

export function resolveUiFlag(search: string, stored: string | null): UiDecision {
  const q = new URLSearchParams(search).get('ui');
  if (q === 'v2') return { ui: 'v2', store: 'set' };
  if (q === 'v1') return { ui: 'v1', store: 'clear' };
  return { ui: stored === 'v2' ? 'v2' : 'v1', store: 'keep' };
}

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
  const cards: Cards = c === 'glass' || c === 'plates' ? c : env.coarse ? 'plates' : 'glass';
  const m = s(V2_KEYS.menu);
  const menu: MenuState = m === 'labels' || m === 'icons' ? m : env.width >= DESKTOP_MIN_PX ? 'labels' : 'icons';
  const side: SideState = s(V2_KEYS.side) === 'closed' ? 'closed' : 'open';
  return { theme, cards, menu, side };
}

const J = (v: string): string => JSON.stringify(v);

/** Runs in <head>-order before the v1 tree. Query wins; storage answers only without one. */
export const UI_PREPAINT_JS = `(function(){
var d=document.documentElement,K=${J(UI_FLAG_KEY)};
function apply(){
var q=null;try{q=new URLSearchParams(location.search).get('ui');}catch(e){}
var st=null;try{st=localStorage.getItem(K);}catch(e){}
var v=q==='v2'?'v2':q==='v1'?'v1':(st==='v2'?'v2':'v1');
try{if(q==='v2')localStorage.setItem(K,'v2');else if(q==='v1')localStorage.removeItem(K);}catch(e){}
if(v==='v2')d.setAttribute(${J(UI_ATTR)},'v2');else d.removeAttribute(${J(UI_ATTR)});
}
apply();
if(!window.__obosUiBound){window.__obosUiBound=1;document.addEventListener('astro:after-swap',apply);}
})();`;

/** Runs after the template. Flag on: clone, apply prefs to the clone's root, replace v1. Flag off: drop the template. */
export const UI_SWAP_JS = `(function(){
var t=document.getElementById(${J(V2_TREE_ID)});if(!t)return;
var d=document.documentElement;
if(d.getAttribute(${J(UI_ATTR)})!=='v2'){t.remove();return;}
var v1=document.getElementById('main');
var frag=t.content.cloneNode(true);
var root=frag.querySelector('main.obos-v2');
if(!v1||!root){d.removeAttribute(${J(UI_ATTR)});t.remove();return;}
function g(k){try{return localStorage.getItem(k);}catch(e){return null;}}
var coarse=false;try{coarse=matchMedia('(pointer: coarse)').matches;}catch(e){}
var w=window.innerWidth||1440;
var th=g(${J(V2_KEYS.theme)}),cd=g(${J(V2_KEYS.cards)}),mn=g(${J(V2_KEYS.menu)}),sd=g(${J(V2_KEYS.side)});
var menu=mn==='labels'||mn==='icons'?mn:(w>=${DESKTOP_MIN_PX}?'labels':'icons');
var side=sd==='closed'?'closed':'open',shown=side==='open';
root.setAttribute('data-theme',th==='light'?'light':'dark');
root.setAttribute('data-cards',cd==='glass'||cd==='plates'?cd:(coarse?'plates':'glass'));
root.setAttribute('data-menu',menu);
root.setAttribute('data-side',side);
root.setAttribute('data-side-current','explore');
root.setAttribute('data-side-shown',shown?'1':'0');
root.setAttribute('data-menu-eff',shown&&w>=${LAPTOP_MIN_PX}&&w<${DESKTOP_MIN_PX}?'icons':menu);
root.setAttribute('data-glass','flat');
root.setAttribute('data-section','overview');
v1.replaceWith(frag);
t.remove();
})();`;
