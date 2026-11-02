// The rail's "Line being priced" card (spec §4.1), and the phone top bar's one-line summary.
// The server renders renderTitleCard(null) into the page, so the empty state has ONE spelling.

export interface TitleLine {
  cn: string;
  /** The pack's CN description, in full; CSS clamps it to two lines (spec §11, D5). */
  name: string;
  /** Display name, not the ISO code. */
  origin: string;
  route: string;
  massT: string;
  date: string;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderTitleCard(l: TitleLine | null): string {
  if (!l) {
    return '<p class="cbx-tc-k">Line being priced</p><p class="cbx-tc-code cbx-tc-none">No line yet</p>'
      + '<p class="cbx-tc-meta">Choose a good on Estimate.</p>';
  }
  return '<p class="cbx-tc-k">Line being priced</p>'
    + `<p class="cbx-tc-code">${esc(l.cn)}</p>`
    + `<p class="cbx-tc-name" title="${esc(l.name)}">${esc(l.name)}</p>`
    + `<p class="cbx-tc-meta">${esc(l.origin)} · ${esc(l.route)}</p>`
    + `<p class="cbx-tc-meta">${esc(l.massT)} t · ${esc(l.date)}</p>`;
}

/** Plain text (written with textContent), so no escaping. */
export function titleSummary(l: TitleLine | null): string {
  return l ? `${l.cn} · ${l.origin} · ${l.route} · ${l.massT} t` : 'No line yet';
}
