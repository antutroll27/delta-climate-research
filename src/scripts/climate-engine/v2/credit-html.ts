// src/scripts/climate-engine/v2/credit-html.ts — renders a city's credit entries (src/data/city-credits.ts) to the <li> list Overlays.astro prints.
// Pure: no fs, no DOM. The Sentinel-2 line is handed in (v2/credits.ts reads its years from a data file at build time).
import { CREDIT_LINK_ATTRS, type CreditEntry, type CreditLine, type CreditPart } from '../../../data/city-credits.ts';
import type { SourceCredit } from './credits.ts';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const a = (href: string, text: string): string => `<a href="${esc(href)}" ${CREDIT_LINK_ATTRS}>${esc(text)}</a>`;

function part(p: CreditPart): string {
  if (typeof p === 'string') return esc(p);
  if ('href' in p) return a(p.href, p.text);
  return `<span id="${esc(p.slotId)}">${esc(p.text)}</span>`;
}

function lineHtml(l: CreditLine): string {
  const licence = l.licence ? `<small>${l.licence.href ? a(l.licence.href, l.licence.text) : esc(l.licence.text)}</small>` : '';
  const modified = l.modified ? `<small>Modified: ${esc(l.modified)}</small>` : '';
  return `<li>${l.parts.map(part).join('')}${licence}${modified}</li>`;
}

/** The Sentinel-2 line exactly as Overlays.astro wrote it before credits became data. */
function sentinelHtml(s: SourceCredit): string {
  const licence = s.url ? a(s.url, s.licence) : `<a ${CREDIT_LINK_ATTRS}>${esc(s.licence)}</a>`;
  return `<li>Surface vegetation and albedo · ${esc(s.lead)}<small>${licence}</small></li>`;
}

/** Lines joined by the newline + 6 spaces the template used between its <li>s. */
export function creditListHtml(entries: readonly CreditEntry[], sentinel: SourceCredit): string {
  return entries.map((e) => (e.kind === 'sentinel' ? sentinelHtml(sentinel) : lineHtml(e))).join('\n      ');
}

/** The closing paragraph, or '' when the city has none. */
export function creditNoteHtml(note: string | null): string {
  return note === null ? '' : `<li class="credit-note"><small>${esc(note)}</small></li>`;
}
