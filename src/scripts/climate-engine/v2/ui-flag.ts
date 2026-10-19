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
/** The UiSwap script element's id: its presence marks a page that HAS a v2 tree (a page without one, e.g. /team/, must not keep data-ui="v2"). */
export const V2_SWAP_ID = 'obos-v2-swap';
/** FINAL audit F5: the v2 stylesheet and each page's v2 tree are separate files, fetched only under the flag (src/pages/obos-v2/). */
export const V2_CSS_URL = '/obos-v2/obos-v2.css';
export const V2_GUARD_ID = 'obos-v2-guard';
export const v2TreeUrl = (page: 'compare' | 'brief' | { readonly areaKey: string }): string =>
  typeof page === 'string' ? `/obos-v2/${page}.html` : `/obos-v2/area/${page.areaKey}.html`;

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
  /* D2 revised (founder, 17 Oct): Plates by default on every device and tier; Glass only when chosen. `env.coarse` no longer decides. */
  const cards: Cards = c === 'glass' ? 'glass' : 'plates';
  const m = s(V2_KEYS.menu);
  const menu: MenuState = m === 'labels' || m === 'icons' ? m : env.width >= DESKTOP_MIN_PX ? 'labels' : 'icons';
  const side: SideState = s(V2_KEYS.side) === 'closed' ? 'closed' : 'open';
  return { theme, cards, menu, side };
}

const J = (v: string): string => JSON.stringify(v);

/** Runs in <head>-order before the v1 tree. Query wins; storage answers only without one.
 *  Under the flag it also writes the guard that keeps the v1 frame from painting (it used to live in tokens.css, which a flag-off page no longer loads, and a flag-on page loads only after this runs).
 *  On a soft navigation the new body is already in place (its inline scripts have not run), so UiSwap's script element is findable: a page without a v2 tree (e.g. team) must not keep data-ui="v2". */
export const UI_PREPAINT_JS = `(function(){
var d=document.documentElement,K=${J(UI_FLAG_KEY)};
function apply(){
var q=null;try{q=new URLSearchParams(location.search).get('ui');}catch(e){}
var st=null;try{st=localStorage.getItem(K);}catch(e){}
var v=q==='v2'?'v2':q==='v1'?'v1':(st==='v2'?'v2':'v1');
try{if(q==='v2')localStorage.setItem(K,'v2');else if(q==='v1')localStorage.removeItem(K);}catch(e){}
if(v==='v2'){d.setAttribute(${J(UI_ATTR)},'v2');if(!document.getElementById(${J(V2_GUARD_ID)})){var g=document.createElement('style');g.id=${J(V2_GUARD_ID)};g.textContent='html[data-ui="v2"] main#main:not(.obos-v2){visibility:hidden}html[data-ui="v2"] body{overflow:hidden}';(document.head||d).appendChild(g);}}
else d.removeAttribute(${J(UI_ATTR)});
}
apply();
if(!window.__obosUiBound){window.__obosUiBound=1;document.addEventListener('astro:after-swap',function(){if(document.getElementById(${J(V2_SWAP_ID)}))apply();else d.removeAttribute(${J(UI_ATTR)});});}
})();`;

/** Runs after the v1 tree. Flag off: nothing (a v1 reader never fetched, and the page never carried, any v2 byte). Flag on: fetch the page's v2 tree and the v2 stylesheet (synchronously, so
 *  the first paint is the finished v2 page, exactly as when the template was in the HTML; both are cacheable files), apply prefs to the tree's root, replace v1. If either cannot be had, drop the flag:
 *  the reader gets v1, whole. */
export const UI_SWAP_JS = `(function(){
var s=document.getElementById(${J(V2_SWAP_ID)});if(!s)return;
var d=document.documentElement;
if(d.getAttribute(${J(UI_ATTR)})!=='v2')return;
function drop(){d.removeAttribute(${J(UI_ATTR)});var g=document.getElementById(${J(V2_GUARD_ID)});if(g)g.remove();}
function get(u){try{var x=new XMLHttpRequest();x.open('GET',u,false);x.send();return x.status===200?x.responseText:null;}catch(e){return null;}}
var v1=document.getElementById('main');
var html=v1?get(s.getAttribute('data-tree')):null;
if(html===null){drop();return;}
if(!document.querySelector('style[data-v2-css]')){
var css=get(s.getAttribute('data-css'));if(css===null){drop();return;}
var st=document.createElement('style');st.setAttribute('data-v2-css','');st.textContent=css;document.head.appendChild(st);}
var t=document.createElement('template');t.innerHTML=html;
var frag=t.content;
var root=frag.querySelector('main.obos-v2');
if(!root){drop();return;}
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
v1.replaceWith(frag);
})();`;
