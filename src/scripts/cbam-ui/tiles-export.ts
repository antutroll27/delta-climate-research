// src/scripts/cbam-ui/tiles-export.ts
// The Export view's tile bodies (spec §5.5). The tile shells and the #cbCsv / #cbDoc buttons are
// static markup in cbam-calculator.astro (their listeners are attached once, so they must never be
// re-created by innerHTML); these functions fill the containers beside them.
import { formatPackDate } from '../cbam-outlook.ts';
import { esc } from './format.ts';
import { isRealDigest, renderFingerprint } from './fingerprint.ts';

/**
 * The CSV columns the preview shows, by their real header names (csvRows in cbam-lines.ts). The tile
 * is half a screen wide and its table scrolls sideways, so the two qualifiers sit BEFORE the figures
 * they qualify: a reader who has not scrolled still sees "pending (what-if)" (cscf_status, blank on a
 * refused line) or "unavailable" (status) before the certificate and cost cells. The file keeps its
 * own order; only this preview reorders.
 */
export const PREVIEW_COLUMNS = ['line_id', 'cn_code', 'origin', 'mass_t', 'cscf_status', 'status', 'certificates', 'cost_eur'] as const;
const PREVIEW_ROWS = 6;

/**
 * The CSV tile: the real column and line counts, and the first six rows of the real rows — the
 * same csvRows output onCsv downloads, never a re-derivation. Values are shown at full precision,
 * as the file carries them.
 */
export function csvTileBody(csv: { rows: readonly Record<string, string>[] } | { error: string }): string {
  if ('error' in csv) return `<p class="b-lead2">The CSV cannot be built: ${esc(csv.error)}</p>`;
  const { rows } = csv;
  if (!rows.length) return '<p class="b-lead2">No line has a priced estimate; nothing to export.</p>';
  const cols = Object.keys(rows[0]!).length;
  const shown = rows.slice(0, PREVIEW_ROWS);
  const cut = rows.length > PREVIEW_ROWS ? ` and the first ${PREVIEW_ROWS} of ${rows.length} lines` : '';
  return `<p class="b-t-sub">${cols} columns · ${rows.length} line${rows.length === 1 ? '' : 's'} · full precision</p>`
    + '<div class="b-csvwrap"><table class="b-csv num"><thead><tr>'
    + PREVIEW_COLUMNS.map((c) => `<th scope="col">${c}</th>`).join('')
    + '</tr></thead><tbody>'
    + shown.map((r) => `<tr>${PREVIEW_COLUMNS.map((c) => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')
    + '</tbody></table></div>'
    + `<p class="b-t-foot">${PREVIEW_COLUMNS.length} of ${cols} columns${cut} shown. The file carries every column, unrounded, with every rule locator and both fingerprints.</p>`;
}

/**
 * The Document tile. Says what buildPrintDocument actually prints — its four sections — and the
 * date it will carry (onDoc stamps the day of export). Nothing more: the document does not reprint
 * the §7.1 banner, so this tile must not claim it does.
 */
export function docTileBody(lineCount: number, todayIso: string): string {
  return `<p class="b-t-sub">Printable · dated ${esc(formatPackDate(todayIso))}</p>`
    + `<p class="b-lead">${lineCount} line${lineCount === 1 ? '' : 's'}: every line as entered, the total and each year's de minimis verdict, the rule packs and source hashes behind them, and what the figures cannot tell you.</p>`;
}

/**
 * "What travels with it": the rule-pack snapshot, then each line's fingerprint, drawn as dots.
 * A missing or all-zero digest is the PLACEHOLDER, not a hash: it draws no dots and says so, the
 * same rule the printable document applies, because an all-off grid would read as a real digest.
 */
export function fingerprintsBody(snapshot: string, lines: readonly { n: number; hex: string | null }[]): string {
  const fig = (label: string, hex: string | null) => {
    return `<figure>${isRealDigest(hex) ? renderFingerprint(hex) : ''}<figcaption><b>${esc(label)}</b><span class="num">${
      isRealDigest(hex) ? `${esc(hex.slice(0, 8))}…` : 'no fingerprint'}</span></figcaption></figure>`;
  };
  return `<div class="b-fps">${fig('Rule pack', snapshot || null)}${lines.map((l) => fig(`Line ${l.n}`, l.hex)).join('')}</div>`;
}
