// The rail's "Line being priced" card (spec §4.1), and the phone top bar's one-line summary.
// The server renders renderTitleCard(null) into the page, so the empty state has ONE spelling.
import { formatPackDate } from '../cbam-outlook.ts';

export interface TitleLine {
  cn: string;
  /** The pack's CN description, in full; CSS clamps it to two lines (spec §11, D5). */
  name: string;
  /** Display name, not the ISO code. */
  origin: string;
  /** ISO code, or 'OTHER' for the residual bucket (no code is shown for it). */
  originCode: string;
  route: string;
  massT: string;
  date: string;
}

/** "15 Mar 2026" for a real calendar day; anything else exactly as typed. */
const day = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(`${iso}T00:00:00Z`);
  // Reject a date the Date constructor would roll over (2026-02-30 → 2 Mar).
  return d.getUTCMonth() + 1 === Number(m[2]) && d.getUTCDate() === Number(m[3]) ? formatPackDate(iso) : iso;
};
const originText = (l: TitleLine) => (l.originCode === 'OTHER' ? l.origin : `${l.origin} (${l.originCode})`);
const routeText = (route: string) => (route === 'default' ? 'default route' : `route ${route}`);

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderTitleCard(l: TitleLine | null): string {
  if (!l) {
    return '<p class="cbx-tc-k">Line being priced</p><p class="cbx-tc-code cbx-tc-none">No line yet</p>'
      + '<p class="cbx-tc-meta">Choose a good on Estimate.</p>';
  }
  return '<p class="cbx-tc-k">Line being priced</p>'
    + `<p class="cbx-tc-code">${esc(l.cn)}</p>`
    + `<p class="cbx-tc-name" title="${esc(l.name)}">${esc(l.name)}</p>`
    + `<p class="cbx-tc-meta">${esc(originText(l))} · ${esc(routeText(l.route))}</p>`
    + `<p class="cbx-tc-meta">${esc(l.massT)} t · ${esc(day(l.date))}</p>`;
}

/** Plain text (written with textContent), so no escaping. */
export function titleSummary(l: TitleLine | null): string {
  return l ? `${l.cn} · ${l.originCode} · ${l.route} · ${l.massT} t · ${day(l.date)}` : 'No line yet';
}
