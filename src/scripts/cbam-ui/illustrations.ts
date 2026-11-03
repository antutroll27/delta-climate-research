// src/scripts/cbam-ui/illustrations.ts
// The calculator's illustrations and pictograms (spec §8.1), ported from the approved reference's
// generator, docs/superpowers/specs/2026-11-02-cbam-rail-ui/generator/build_bento.py. One ink in
// alpha tones (--ic-a/-b/-c/-n, spec §4.3) and knockouts in the plate colour (--card): never
// bronze or cyan, so colour keeps meaning only provenance. Every svg is aria-hidden (spec §6.5).
// Two deliberate, invisible additions to the generator's strings: a data-ill name on every svg
// (the tests find drawings by it) and class="b-needle" on the gauge's needle (the sweep targets
// it). tests/unit/cbam-illustrations.test.mjs pins every string against the generator's output.

import { sectorForCn } from '../cbam-algos/cbam/sector.ts';
import type { ImportSector } from '../cbam-algos/threshold/aggregate.ts';

type Tone = 'a' | 'b' | 'c' | 'n';
const F = (t: Tone): string => `style="fill:var(--ic-${t})"`;
const KN = 'style="fill:var(--card)"';
const A = 'fill:var(--ic-a)';
const C = 'fill:var(--ic-c)';
const N = 'fill:var(--ic-n)';
const K = 'fill:var(--card)';

const svg = (cls: string, name: string, vb: string, body: string): string =>
  `<svg class="${cls}" data-ill="${name}" viewBox="${vb}" aria-hidden="true">${body}</svg>`;

// ---------- pictograms (the generator's pict(); viewBox 0 0 220 150) ----------
const PICT_BODY = {
  tube: `<ellipse cx="46" cy="75" rx="20" ry="40" style="${N}"/><path d="M46 35H168a20 40 0 010 80H46z" style="${C}"/>`
    + '<path d="M56 46H160" style="stroke:var(--card);stroke-width:3;stroke-dasharray:6 7;fill:none;opacity:.7"/>'
    + `<ellipse cx="168" cy="75" rx="20" ry="40" style="${A}"/><ellipse cx="168" cy="75" rx="12" ry="27" style="${K}"/>`,
  bag: `<path d="M62 30h96l14 96a10 10 0 01-10 12H58a10 10 0 01-10-12z" style="${C}"/><path d="M62 30h96l-6 18H68z" style="${A}"/>`
    + `<rect x="80" y="70" width="60" height="34" rx="6" style="${K}"/><rect x="92" y="82" width="36" height="10" rx="5" style="${N}"/>`,
  ingot: `<path d="M40 104l26-52h88l26 52z" style="${C}"/><path d="M66 52h88l-12 18H78z" style="${A}"/><path d="M40 104h140v14H40z" style="${N}"/>`
    + '<path d="M66 52l-26 52M154 52l26 52" style="stroke:var(--card);stroke-width:2;opacity:.35;fill:none"/>',
  sheet: `<rect x="48" y="18" width="124" height="116" rx="10" style="${N}"/><path d="M48 28a10 10 0 0110-10h104a10 10 0 0110 10v18H48z" style="${A}"/>`
    + [60, 80, 100].flatMap((y) => ([[60, 26], [94, 30], [132, 28]] as const)
      .map(([x, w]) => `<rect x="${x}" y="${y}" width="${w}" height="10" rx="3" style="${K}"/>`)).join(''),
  paper: `<rect x="70" y="24" width="96" height="118" rx="6" style="${N}"/><rect x="56" y="12" width="96" height="118" rx="6" style="${C}"/>`
    + `<rect x="70" y="30" width="54" height="10" rx="3" style="${K}"/>`
    + ([[54, 68], [68, 60], [82, 68], [96, 44]] as const)
      .map(([y, w]) => `<rect x="70" y="${y}" width="${w}" height="6" rx="3" style="${K};opacity:.7"/>`).join(''),
  shield: `<path d="M110 14l64 24v42c0 34-26 58-64 66-38-8-64-32-64-66V38z" style="${C}"/>`
    + '<path d="M84 80l18 18 36-40" style="fill:none;stroke:var(--card);stroke-width:10;stroke-linecap:round;stroke-linejoin:round"/>',
} as const;
export type PictName = keyof typeof PICT_BODY;

/** A tile pictogram, in flow. `sm`/`xs` are the reference's size modifiers. */
export function pict(name: PictName, size?: 'sm' | 'xs'): string {
  return svg(size ? `b-pict b-pict-${size}` : 'b-pict', name, '0 0 220 150', PICT_BODY[name]);
}

// ---------- medium-large tile illustrations (absolute; positions in cbam-ill.css) ----------
export type IllName = 'fac' | 'vou' | 'steps' | 'scale' | 'box' | 'gauge';
const ill = (name: IllName, vb: string, body: string): string => svg(`b-ill b-ill-${name}`, name, vb, body);

export const ILL: Readonly<Record<IllName, string>> = {
  fac: ill('fac', '0 0 160 120', `<rect x="0" y="104" width="160" height="6" rx="3" ${F('n')}/><path d="M8 104V60l30 18V60l30 18V44h24v60z" ${F('c')}/>`
    + `<rect x="96" y="24" width="15" height="80" rx="3" ${F('a')}/><circle cx="118" cy="18" r="11" ${F('b')}/><circle cx="135" cy="12" r="14" ${F('b')}/><circle cx="151" cy="21" r="9" ${F('b')}/>`
    + [18, 44, 70].map((x) => `<rect x="${x}" y="84" width="11" height="11" rx="2" ${KN}/>`).join('')),
  vou: ill('vou', '0 0 120 70', `<path d="M8 6h104a4 4 0 014 4v15a10 10 0 000 20v15a4 4 0 01-4 4H8a4 4 0 01-4-4V45a10 10 0 000-20V10a4 4 0 014-4z" ${F('c')}/>`
    + '<path d="M86 12v46" style="stroke:var(--card);stroke-width:3;stroke-dasharray:4 5"/>'
    + `<rect x="20" y="22" width="48" height="8" rx="4" ${KN}/><rect x="20" y="38" width="34" height="6" rx="3" ${KN} opacity=".7"/><circle cx="101" cy="35" r="7" ${KN}/>`),
  steps: ill('steps', '0 0 180 130', `<rect x="10" y="72" width="44" height="48" rx="6" ${F('c')}/><rect x="10" y="61" width="44" height="8" rx="4" ${F('a')}/>`
    + `<rect x="68" y="66" width="44" height="54" rx="6" ${F('c')}/><rect x="68" y="47" width="44" height="16" rx="5" ${F('a')}/>`
    + `<rect x="126" y="60" width="44" height="60" rx="6" ${F('c')}/><rect x="126" y="33" width="44" height="24" rx="6" ${F('a')}/>`
    + '<path d="M32 52L90 38L148 24" style="fill:none;stroke:var(--ic-b);stroke-width:3;stroke-dasharray:5 6;stroke-linecap:round"/>'
    + `<path d="M148 14l9 11-13 3z" ${F('b')}/>`),
  scale: ill('scale', '0 0 160 120', `<rect x="77" y="22" width="6" height="84" rx="3" ${F('c')}/><rect x="48" y="104" width="64" height="9" rx="4.5" ${F('c')}/>`
    + `<path d="M20 46L140 24l1 6L21 52z" ${F('a')}/><circle cx="80" cy="35" r="7" ${F('a')}/>`
    + '<path d="M22 50L10 82M22 50l12 32M139 28l-12 30M139 28l12 30" style="stroke:var(--ic-b);stroke-width:2;fill:none"/>'
    + `<path d="M3 82h38a19 11 0 01-38 0z" ${F('a')}/><rect x="12" y="64" width="20" height="17" rx="3" ${F('c')}/><rect x="15" y="54" width="14" height="11" rx="3" ${F('c')}/>`
    + `<path d="M120 58h38a19 11 0 01-38 0z" ${F('b')}/>`),
  box: ill('box', '0 0 180 120', `<rect x="6" y="28" width="104" height="86" rx="8" ${F('c')}/>`
    + [24, 44, 64, 84].map((x) => `<rect x="${x}" y="38" width="4" height="66" rx="2" ${KN} opacity=".35"/>`).join('')
    + `<rect x="116" y="62" width="58" height="52" rx="7" ${F('b')}/><rect x="116" y="34" width="32" height="24" rx="5" ${F('n')}/>`
    + `<rect x="132" y="82" width="26" height="6" rx="3" ${KN} opacity=".6"/>`),
  gauge: ill('gauge', '0 0 160 100', '<path d="M10 90A70 70 0 01150 90" style="fill:none;stroke:var(--ic-n);stroke-width:14;stroke-linecap:round"/>'
    + '<path d="M10 90A70 70 0 01143.9 61.5" style="fill:none;stroke:var(--ic-a);stroke-width:14;stroke-linecap:round"/>'
    + '<path d="M30.6 61.5L8.9 48.9" style="stroke:var(--card);stroke-width:5"/>'
    + '<path class="b-needle" d="M80 90L127.5 68.9" style="stroke:var(--ic-c);stroke-width:5;stroke-linecap:round"/>'
    + `<circle cx="80" cy="90" r="8" ${F('c')}/>`),
};

// ---------- input-step illustrations (smaller, top right of each step) ----------
const MONTHS = [0, 1, 2, 3].flatMap((r) => [0, 1, 2].map((c) =>
  `<rect x="${17 + c * 32}" y="${44 + r * 15}" width="26" height="11" rx="4" ${r === 0 ? F('a') : 'style="fill:var(--card);opacity:.55"'}/>`)).join('');
const STEP_TUBE = `<ellipse cx="46" cy="75" rx="20" ry="40" ${F('n')}/><path d="M46 35H168a20 40 0 010 80H46z" ${F('c')}/>`
  + '<path d="M56 46H160" style="stroke:var(--card);stroke-width:4;stroke-dasharray:7 8;fill:none;opacity:.7"/>'
  + `<ellipse cx="168" cy="75" rx="20" ry="40" ${F('a')}/><ellipse cx="168" cy="75" rx="12" ry="27" ${KN}/>`;

export const INPUT_ILL = {
  origin: svg('b-ill b-ill-inp', 'origin', '0 0 130 84', `<path d="M30 78s-22-20-22-38a22 22 0 0144 0c0 18-22 38-22 38z" ${F('c')}/><circle cx="30" cy="40" r="8" ${KN}/>`
    + '<path d="M54 40C78 40 82 14 108 14M54 40H108M54 40C78 40 82 66 108 66" style="fill:none;stroke:var(--ic-b);stroke-width:3;stroke-dasharray:5 5;stroke-linecap:round"/>'
    + `<circle cx="114" cy="14" r="9" ${F('a')}/><circle cx="114" cy="40" r="8" ${F('n')}/><circle cx="114" cy="66" r="8" ${F('n')}/>`),
  date: svg('b-ill b-ill-inp b-ill-inp-sq', 'date', '0 0 120 110', `<rect x="5" y="14" width="110" height="92" rx="12" ${F('n')}/><path d="M5 26a12 12 0 0112-12h86a12 12 0 0112 12v10H5z" ${F('c')}/>`
    + `<rect x="30" y="4" width="8" height="20" rx="4" ${F('a')}/><rect x="82" y="4" width="8" height="20" rx="4" ${F('a')}/>${MONTHS}`),
  mass: svg('b-ill b-ill-inp b-ill-inp-mass', 'mass', '0 0 130 84', `<rect x="10" y="66" width="110" height="10" rx="5" ${F('c')}/><rect x="58" y="56" width="14" height="12" ${F('n')}/><rect x="30" y="18" width="70" height="40" rx="6" ${F('a')}/>`
    + [44, 56, 68, 80].map((x) => `<rect x="${x}" y="24" width="4" height="28" rx="2" ${KN} opacity=".4"/>`).join('')),
} as const;

/** Spec §8.1: the Good step's pictogram follows the sector. P5-4: no drawing, no pictogram. */
const GOOD: Partial<Record<ImportSector, readonly [name: string, body: string]>> = {
  iron_and_steel: ['tube', STEP_TUBE],
  cement: ['bag', PICT_BODY.bag],
  aluminium: ['ingot', PICT_BODY.ingot],
};
export function goodIll(sector: ImportSector | null): string {
  const g = sector ? GOOD[sector] : undefined;
  return g ? svg('b-ill b-ill-inp', `good-${g[0]}`, '0 0 220 150', g[1]) : '';
}

/**
 * Inserts `svgStr` as the first child of the first element whose class list contains `hostClass`
 * as a whole word. Pure, for the tile renderers: `insertIll(html, ILL.box, 'b-t')`.
 */
export function insertIll(html: string, svgStr: string, hostClass: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(hostClass)) throw new Error(`insertIll: "${hostClass}" is not a class name`);
  const m = new RegExp(`<[a-z][a-z0-9]*\\b[^>]*\\bclass="(?:[^"]*\\s)?${hostClass}(?:\\s[^"]*)?"[^>]*>`).exec(html);
  if (!m) throw new Error(`insertIll: no element with class "${hostClass}"`);
  const at = m.index + m[0].length;
  return html.slice(0, at) + svgStr + html.slice(at);
}

/**
 * The Good step's pictogram follows `#cbCn` (the good sheet writes it and dispatches `input`).
 * Guarded against double init and dropped on soft navigation, like mountViews.
 */
export function mountIllustrations(root: HTMLElement): void {
  if (root.dataset.illWired) return;
  root.dataset.illWired = 'true';
  const ac = new AbortController();
  document.addEventListener('astro:before-swap', () => ac.abort(), { once: true });
  const paint = (): void => {
    const step = Array.from(root.querySelectorAll<HTMLElement>('.b-inp'))
      .find((s) => s.querySelector('.b-t-ti')?.textContent?.trim() === 'Good.');
    if (!step) return;
    step.querySelector(':scope > [data-ill^="good-"]')?.remove();
    const cn = root.querySelector<HTMLInputElement>('#cbCn')?.value.trim() ?? '';
    const s = /^\d{8,10}$/.test(cn) ? goodIll(sectorForCn(cn)) : '';
    if (s) step.insertAdjacentHTML('afterbegin', s);
  };
  const on = (ev: Event): void => { if ((ev.target as Element | null)?.id === 'cbCn') paint(); };
  root.addEventListener('input', on, { signal: ac.signal });
  root.addEventListener('change', on, { signal: ac.signal });
  paint();
}
