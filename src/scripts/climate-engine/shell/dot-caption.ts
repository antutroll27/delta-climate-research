/**
 * dot-caption.ts: the dot-matrix captions on the pill controls (the "AREA" chip and the "NEW CITY" toast).
 *
 * ONE SOURCE OF TRUTH for the drawing. ToastsV2.astro calls `dotCaptionHtml` at build time; sheet-index-view.ts calls `dotCaptionNode` at run time.
 * Each dot is a zero-length, round-capped segment (`h.01` under `stroke-linecap: round`), 2 px across on a 2.5 px pitch, so a whole word is
 * a handful of <path>s. The letters are separate paths (`--i` = the letter's index) so the POWER-ON can light them left to right.
 *
 * Two stacked layers: `.pc-base` is static; `.pc-glow` carries a STATIC drop-shadow and is the only thing that animates, by OPACITY alone
 * (see src/styles/obos-v2/screens/pill-controls.css). A tired letter (the Y of NEW CITY) gets a glow layer of its own so it can flicker out of step.
 * Drawn text is aria-hidden: the words travel in a visually hidden span the CALLER writes beside it.
 */

/** 5 x 7 letters, one row per space-separated word. Only the letters the pills use. */
const FONT: Readonly<Record<string, string>> = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  R: '11110 10001 10001 11110 10100 10010 10001',
  E: '11111 10000 10000 11110 10000 10000 11111',
  N: '10001 11001 10101 10011 10001 10001 10001',
  W: '10001 10001 10001 10101 10101 11011 10001',
  C: '01110 10001 10000 10000 10000 10001 01110',
  I: '01110 00100 00100 00100 00100 00100 01110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  Y: '10001 10001 01010 00100 00100 00100 00100',
};

const DOT = 2;            // dot diameter, px
const PITCH = 2.5;        // dot pitch, px
const PAD = 6;            // room around the word so the drop-shadow is not clipped
const LETTER_COLS = 6;    // 5 columns of dots + 1 gap
const SPACE_COLS = 3;
const r2 = (n: number): number => Math.round(n * 100) / 100;

export interface CaptionLetter { readonly ch: string; readonly i: number; readonly d: string }
export interface CaptionLayout { readonly width: number; readonly height: number; readonly letters: readonly CaptionLetter[] }

/** Pure geometry: the SVG size and one path `d` per letter. Throws on a glyph the table lacks (a build-time failure, never a blank caption). */
export function captionLayout(text: string): CaptionLayout {
  let col = 0;
  const letters: CaptionLetter[] = [];
  for (const ch of text) {
    if (ch === ' ') { col += SPACE_COLS; continue; }
    const glyph = FONT[ch];
    if (glyph === undefined) throw new Error(`dot-caption: no glyph for "${ch}"`);
    let d = '';
    glyph.split(' ').forEach((row, r) => [...row].forEach((bit, c) => {
      if (bit === '1') d += `M${r2(PAD + DOT / 2 + (col + c) * PITCH)} ${r2(PAD + DOT / 2 + r * PITCH)}h.01`;
    }));
    letters.push({ ch, i: letters.length, d });
    col += LETTER_COLS;
  }
  return {
    width: r2((col - 1) * PITCH + DOT + 2 * PAD),
    height: r2(6 * PITCH + DOT + 2 * PAD),
    letters,
  };
}

export type CaptionVariant = 'a' | 'c';   // 'a' and 'c' only pick the flicker's period and phase, so two captions never blink in step

export interface CaptionOptions {
  readonly variant: CaptionVariant;
  /** Letters that get a glow layer of their own (a "tired tube"). */
  readonly tired?: string;
}

/** The caption as an HTML string: <span class="pc-dm pc-a"> with an aria-hidden SVG per layer. */
export function dotCaptionHtml(text: string, opts: CaptionOptions): string {
  const { width, height, letters } = captionLayout(text);
  const layer = (cls: string, ls: readonly CaptionLetter[]): string =>
    `<svg class="pc-dmt ${cls}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" fill="none" stroke="currentColor" stroke-width="${DOT}" stroke-linecap="round" aria-hidden="true">`
    + ls.map((l) => `<path class="pc-ltr" style="--i:${l.i}" d="${l.d}"/>`).join('')
    + '</svg>';
  const tired = opts.tired ?? '';
  const isTired = (l: CaptionLetter): boolean => tired.includes(l.ch);
  const steady = tired === '' ? letters : letters.filter((l) => !isTired(l));
  const odd = tired === '' ? [] : letters.filter(isTired);
  return `<span class="pc-dm pc-${opts.variant}" data-mode="settle" aria-hidden="true">${layer('pc-base', letters)}${layer('pc-glow', steady)}${odd.length > 0 ? layer('pc-glow pc-glow-y', odd) : ''}</span>`;
}

/** The same caption as a DOM node (parsed from the one string above, so the two can never drift apart). */
export function dotCaptionNode(text: string, opts: CaptionOptions): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = dotCaptionHtml(text, opts);
  return tpl.content.firstElementChild as HTMLElement;
}

/** The area key's picture: a 7 x 7 dotted lattice (rows and columns 0, 3, 6 = 2 x 2 panes) with the current pane lit by four larger dots. */
export function areaKeyIconHtml(): string {
  const dots = (pts: ReadonlyArray<readonly [number, number]>): string => pts.map(([c, r]) => `M${2 + c * 4} ${2 + r * 4}h.01`).join('');
  const lattice: Array<readonly [number, number]> = [];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) if (c % 3 === 0 || r % 3 === 0) lattice.push([c, r]);
  const lit: ReadonlyArray<readonly [number, number]> = [[4, 1], [5, 1], [4, 2], [5, 2]];
  return `<svg class="pc-ico" viewBox="0 0 28 28" width="26" height="26" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true">`
    + `<path d="${dots(lattice)}" stroke-width="2.4"/><path class="pc-lit" d="${dots(lit)}" stroke-width="3"/></svg>`;
}

/** The four-point star at the area key's corner: two identical copies, one for the scheduled play and one for hover, focus and open. */
export const SPARK_HTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1C8.6 5.4 10.6 7.4 15 8C10.6 8.6 8.6 10.6 8 15C7.4 10.6 5.4 8.6 1 8C5.4 7.4 7.4 5.4 8 1Z" fill="currentColor"/></svg>';
