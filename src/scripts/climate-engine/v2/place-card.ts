// src/scripts/climate-engine/v2/place-card.ts — OBOS v2 on-map building card (brainstorm 04 §4): the keep-out solver. Pure: no DOM, no clock.
/**
 * WHERE THE BUILDING CARD STANDS. v1 centred the card on the roof's apex and let it sit on whatever was there; v2 has a rail, a side panel, a title
 * card, a compass, a bottom-left stack, a dock, a toolbar and an attribution chip, so the card is placed by search instead:
 *   1. the card's near edge is LEAD_MIN past the selection brackets, on the right of the roof, and it slides vertically toward the apex;
 *   2. if a chrome box is in the way it moves out in STEP px (up to MAX_PUSH), then tries the left of the roof;
 *   3. only when neither side fits whole is it CAPPED to the tallest free band (and scrolls inside).
 * A card keeps its side while that side still fits (`prev`), so a slow orbit never flips it back and forth. With no apex (a flat map has no relief to project
 * from) the card docks at the right edge. Every box is [l, t, r, b] in one coordinate space; the chrome boxes are inflated by GAP here, the caller passes them raw.
 */
export interface Box { readonly l: number; readonly t: number; readonly r: number; readonly b: number }
export type Side = 'right' | 'left';

/** the selection brackets' box (#bsel is 54 x 54 around the apex) */
export const BRACKET = 54;
/** the shortest lead, past the brackets */
export const LEAD_MIN = 24;
/** the card never rises above the top row of chrome (the toolbar, the toasts, the Ward readings pill sit above it) */
export const MIN_TOP = 66;
/** clearance around every chrome box */
export const GAP = 12;
/** the canvas margin */
export const EDGE = 12;
const STEP = 8, MAX_PUSH = 200, MIN_H = 240, LEAD_INSET = 18;

export interface PlaceInput {
  /** the roof apex in the same space as the boxes, or null when there is nothing to anchor to (dock) */
  readonly apex: { readonly x: number; readonly y: number } | null;
  readonly canvas: Box;
  /** every chrome box the card must clear, NOT yet inflated */
  readonly avoid: readonly Box[];
  /** the card's natural size */
  readonly card: { readonly w: number; readonly h: number };
  /** the side it stood on last frame */
  readonly prev: Side | null;
}

export interface Placement {
  /** null when docked (no apex) */
  readonly side: Side | null;
  readonly left: number;
  readonly top: number;
  /** the height to draw: the card's own, or the free band's when capped */
  readonly height: number;
  /** the card had to be shortened to a free band */
  readonly capped: boolean;
  /** whole, or at least MIN_H tall: false means there is no usable band at all */
  readonly fits: boolean;
}

interface Hit { readonly left: number; readonly top: number; readonly len: number }

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** the free vertical gaps for a card whose x-range is [x0, x1], between `lo` and `hi`, given the (inflated) blockers */
function gaps(x0: number, x1: number, blockers: readonly Box[], lo: number, hi: number): Array<readonly [number, number]> {
  const cut = blockers.filter((b) => b.l < x1 && b.r > x0 && b.b > lo && b.t < hi).sort((a, b) => a.t - b.t);
  const out: Array<readonly [number, number]> = [];
  let at = lo;
  for (const b of cut) { if (b.t > at) out.push([at, b.t]); at = Math.max(at, b.b); }
  if (hi > at) out.push([at, hi]);
  return out;
}

export function solveCard(input: PlaceInput): Placement {
  const { apex, canvas, card } = input;
  const blockers: Box[] = input.avoid.map((b) => ({ l: b.l - GAP, t: b.t - GAP, r: b.r + GAP, b: b.b + GAP }));
  if (apex) blockers.push({ l: apex.x - BRACKET / 2, t: apex.y - BRACKET / 2, r: apex.x + BRACKET / 2, b: apex.y + BRACKET / 2 });
  const freeL = canvas.l + EDGE, freeR = canvas.r - EDGE, freeT = Math.max(canvas.t + EDGE, MIN_TOP), freeB = canvas.b - EDGE;
  const ideal = apex ? apex.y - card.h / 2 : freeT;   // the card's wanted top

  /** the whole card at x, nearest its ideal top, or the tallest gap there */
  const at = (x: number): { whole: number | null; tall: Hit } => {
    const g = gaps(x, x + card.w, blockers, freeT, freeB);
    let whole: number | null = null, best = Infinity, tall: Hit = { left: x, top: freeT, len: 0 };
    for (const [a, b] of g) {
      if (b - a > tall.len) tall = { left: x, top: a, len: b - a };
      if (b - a >= card.h) { const y = clamp(ideal, a, b - card.h), d = Math.abs(y - ideal); if (d < best) { best = d; whole = y; } }
    }
    return { whole, tall };
  };

  /** candidate left edges, nearest the roof first */
  const sweep = (side: Side): number[] => {
    const xs: number[] = [];
    if (!apex) { for (let x = freeR - card.w; x >= freeL; x -= STEP) xs.push(x); return xs; }
    for (let k = 0; k * STEP <= MAX_PUSH; k++) {
      const x = side === 'right' ? apex.x + BRACKET / 2 + LEAD_MIN + k * STEP : apex.x - BRACKET / 2 - LEAD_MIN - k * STEP - card.w;
      if (x < freeL || x + card.w > freeR) break;
      xs.push(x);
    }
    return xs;
  };

  const sides: Array<Side | null> = !apex ? [null] : input.prev === 'left' ? ['left', 'right'] : ['right', 'left'];
  let tallest: (Hit & { side: Side | null }) | null = null;
  for (const side of sides) {
    for (const x of sweep(side ?? 'right')) {
      const { whole, tall } = at(x);
      if (whole !== null) return { side, left: x, top: whole, height: card.h, capped: false, fits: true };
      if (!tallest || tall.len > tallest.len) tallest = { ...tall, side };
    }
  }
  if (!tallest || tallest.len <= 0) return { side: sides[0], left: apex ? apex.x + BRACKET / 2 + LEAD_MIN : freeR - card.w, top: freeT, height: 0, capped: true, fits: false };
  return { side: tallest.side, left: tallest.left, top: tallest.top, height: tallest.len, capped: true, fits: tallest.len >= MIN_H };
}

/** The lead line in the card's own coordinates: from its near edge to the bracket edge that faces it. */
export interface Lead { readonly sx: number; readonly sy: number; readonly ex: number; readonly ey: number; readonly len: number; readonly angle: number }

export function leadFor(p: Placement, apex: { readonly x: number; readonly y: number }, cardW: number): Lead {
  const right = p.side !== 'left';
  const ex = apex.x + (right ? 1 : -1) * BRACKET / 2 - p.left, ey = apex.y - p.top;
  const sx = right ? 0 : cardW;
  /* the lead's foot slides along the card's edge toward the apex, and stays off the corners */
  const sy = clamp(ey, LEAD_INSET, Math.max(p.height - LEAD_INSET, LEAD_INSET));
  return { sx, sy, ex, ey, len: Math.hypot(ex - sx, ey - sy), angle: Math.atan2(ey - sy, ex - sx) };
}
