// tests/unit/obos-v2-place-card.test.mjs — OBOS v2 on-map building card (brainstorm 04 §4, §8): the keep-out solver, with no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveCard, leadFor, BRACKET, LEAD_MIN, MIN_TOP, GAP } from '../../src/scripts/climate-engine/v2/place-card.ts';

const box = (l, t, r, b) => ({ l, t, r, b });
/* 1440 x 900 with the rc3 chrome open (the brainstorm's capture: rail, side panel, title card, compass, stack, dock, toolbar, attribution) */
const CANVAS = box(0, 0, 1440, 900);
const CHROME_1440 = [
  box(16, 16, 200, 465), box(216, 16, 516, 803), box(532, 17, 830, 205), box(532, 215, 586, 270), box(532, 448, 746, 816),
  box(645, 832, 975, 880), box(1140, 12, 1424, 52), box(1050, 866, 1424, 886), box(1308, 66, 1424, 98),
];
const CARD = { w: 320, h: 718 };
const hits = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const inflate = (b, d) => box(b.l - d, b.t - d, b.r + d, b.b + d);
const boxOf = (p, card) => box(p.left, p.top, p.left + card.w, p.top + p.height);

test('the apex of #2342 (846, 450): the card sits to its RIGHT, 24 px past the brackets, inside the free band, clear of every chrome box + 12', () => {
  const p = solveCard({ apex: { x: 846, y: 450 }, canvas: CANVAS, avoid: CHROME_1440, card: CARD, prev: null });
  assert.equal(p.side, 'right');
  assert.ok(p.fits, 'it fits whole');
  assert.equal(p.capped, false);
  assert.equal(p.left, 846 + BRACKET / 2 + LEAD_MIN, 'the lead is the minimum: 24 px past the bracket edge');
  assert.ok(p.top >= MIN_TOP, 'below the top row of chrome');
  for (const c of CHROME_1440) assert.ok(!hits(boxOf(p, CARD), inflate(c, GAP)), `clear of ${JSON.stringify(c)}`);
  assert.ok(p.top + p.height <= 900 - 12, 'inside the canvas margin');
});

test('an apex near the right edge flips the card to the LEFT (the near side), with the same lead', () => {
  const p = solveCard({ apex: { x: 1330, y: 450 }, canvas: CANVAS, avoid: CHROME_1440, card: CARD, prev: null });
  assert.equal(p.side, 'left');
  assert.equal(p.left + CARD.w, 1330 - BRACKET / 2 - LEAD_MIN);
  assert.ok(p.fits);
});

test('a chrome box in the way PUSHES the card out in 8 px steps, never onto the box (up to 200 px), before it gives up the side', () => {
  const wall = box(900, 66, 960, 380);   // a box right of the apex, above the lead (a lead that crossed it would dock the card instead, F3)
  const p = solveCard({ apex: { x: 846, y: 450 }, canvas: CANVAS, avoid: [wall], card: CARD, prev: null });
  assert.equal(p.side, 'right');
  assert.ok(p.left >= 960 + GAP, 'right of the wall + gap');
  assert.equal((p.left - (846 + BRACKET / 2 + LEAD_MIN)) % 8, 0, 'whole 8 px steps');
  assert.ok(p.left - (846 + BRACKET / 2 + LEAD_MIN) <= 200, 'within the 200 px push');
});

test('when the right cannot clear within 200 px the card goes LEFT of the roof', () => {
  const wall = box(880, 66, 1300, 800);
  const p = solveCard({ apex: { x: 846, y: 450 }, canvas: CANVAS, avoid: [wall], card: CARD, prev: null });
  assert.equal(p.side, 'left');
  assert.ok(p.left + CARD.w <= 846 - BRACKET / 2 - LEAD_MIN);
});

test('with nowhere to fit whole the card is CAPPED to the tallest free band (and scrolls inside), never overlapping', () => {
  const short = box(0, 0, 1366, 640);
  const chrome = [box(16, 16, 200, 400), box(216, 16, 516, 600)];
  const p = solveCard({ apex: { x: 700, y: 300 }, canvas: short, avoid: chrome, card: { w: 320, h: 718 }, prev: null });
  assert.equal(p.capped, true);
  assert.ok(p.height < 718 && p.height >= 240, `capped to ${p.height}`);
  assert.ok(p.top >= MIN_TOP && p.top + p.height <= 640 - 12);
  for (const c of chrome) assert.ok(!hits(boxOf(p, { w: 320 }), inflate(c, GAP)));
});

test('stability: a card already on the left stays there while the left still fits, even if the right would now fit too', () => {
  const left = solveCard({ apex: { x: 820, y: 450 }, canvas: CANVAS, avoid: CHROME_1440, card: CARD, prev: 'left' });
  // the left of the apex at 820 is blocked by the stack/side panel (no 320 px band), so the card cannot keep 'left' there
  assert.equal(left.side, 'right');
  const open = solveCard({ apex: { x: 900, y: 450 }, canvas: CANVAS, avoid: [], card: CARD, prev: 'left' });
  assert.equal(open.side, 'left', 'kept its side');
  const fresh = solveCard({ apex: { x: 900, y: 450 }, canvas: CANVAS, avoid: [], card: CARD, prev: null });
  assert.equal(fresh.side, 'right', 'a fresh card starts on the right (v1)');
});

test('the card slides toward the apex: its vertical centre follows the roof until a wall stops it, then it stays inside the band', () => {
  const hi = solveCard({ apex: { x: 700, y: 300 }, canvas: CANVAS, avoid: [], card: { w: 320, h: 300 }, prev: null });
  assert.equal(hi.top, 300 - 150);
  const top = solveCard({ apex: { x: 700, y: 90 }, canvas: CANVAS, avoid: [], card: { w: 320, h: 300 }, prev: null });
  assert.equal(top.top, MIN_TOP, 'never above the top row of chrome');
  const bottom = solveCard({ apex: { x: 700, y: 880 }, canvas: CANVAS, avoid: [], card: { w: 320, h: 300 }, prev: null });
  assert.equal(bottom.top + bottom.height, 900 - 12);
});

test('no apex (a flat map, no relief): the card docks at the right edge, top of the free band, and stays off the chrome', () => {
  const p = solveCard({ apex: null, canvas: CANVAS, avoid: CHROME_1440, card: CARD, prev: null });
  assert.equal(p.side, null);
  assert.equal(p.left + CARD.w, 1440 - 12);
  for (const c of CHROME_1440) assert.ok(!hits(boxOf(p, CARD), inflate(c, GAP)), `clear of ${JSON.stringify(c)}`);
});

test('property: across 600 random apexes and sizes the placed card never touches an inflated chrome box, the margin or the top row', () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 600; i++) {
    const w = 1200 + Math.floor(rnd() * 800), h = 640 + Math.floor(rnd() * 440);
    const canvas = box(0, 0, w, h);
    const avoid = CHROME_1440.map((c) => box(c.l, c.t, c.r, Math.min(c.b, h - 4)));
    const card = { w: 320, h: 300 + Math.floor(rnd() * 500) };
    const apex = { x: 40 + rnd() * (w - 80), y: 40 + rnd() * (h - 80) };
    const p = solveCard({ apex, canvas, avoid, card, prev: rnd() < 0.5 ? 'left' : 'right' });
    if (!p.fits) continue;   // a canvas with no band at all reports it; the browser spec covers the four real sizes
    const b = boxOf(p, card);
    assert.ok(b.l >= 12 && b.r <= w - 12 && b.t >= MIN_TOP && b.b <= h - 12, `inside (${JSON.stringify(b)} in ${w}x${h})`);
    for (const c of avoid) assert.ok(!hits(b, inflate(c, GAP)), `iter ${i}: ${JSON.stringify(b)} on ${JSON.stringify(c)}`);
    assert.ok(!hits(b, box(apex.x - BRACKET / 2, apex.y - BRACKET / 2, apex.x + BRACKET / 2, apex.y + BRACKET / 2)), 'never on the brackets');
  }
});

test('the lead runs from the card edge to the bracket edge facing the card, within 2 px of the brackets', () => {
  const apex = { x: 846, y: 450 };
  const p = solveCard({ apex, canvas: CANVAS, avoid: CHROME_1440, card: CARD, prev: null });
  const l = leadFor(p, apex, CARD.w);
  assert.equal(l.ex + p.left, apex.x + BRACKET / 2, 'ends on the right-hand bracket edge');
  assert.equal(l.ey + p.top, apex.y, 'at the apex height');
  assert.equal(l.sx, 0, 'starts at the card\'s near edge');
  assert.ok(Math.abs(l.len - LEAD_MIN) < 1e-9 || l.len >= LEAD_MIN - 1e-9);
  const left = solveCard({ apex: { x: 1330, y: 450 }, canvas: CANVAS, avoid: CHROME_1440, card: CARD, prev: null });
  const ll = leadFor(left, { x: 1330, y: 450 }, CARD.w);
  assert.equal(ll.sx, CARD.w, 'a left-hand card leads from its right edge');
  assert.equal(ll.ex + left.left, 1330 - BRACKET / 2);
});

test('a lead whose start would sit off the card\'s corner slides back inside it (8 px from each corner at least)', () => {
  const apex = { x: 700, y: 60 };
  const p = solveCard({ apex, canvas: CANVAS, avoid: [], card: CARD, prev: null });
  const l = leadFor(p, apex, CARD.w);
  assert.ok(l.sy >= 18 && l.sy <= p.height - 18, `sy ${l.sy} of ${p.height}`);
});

/* ── rc4 audit F2 and F3 ── */
const MIN_H = 240;
test('F2: an apex near the left edge (140, h/2, the rc4 sliver) finds a whole card, docks, or reports nothing: never a card of 0 < height < MIN_H', () => {
  for (const [w, h] of [[1440, 900], [1366, 768], [1920, 1080], [1280, 720]]) {
    const avoid = CHROME_1440.map((c) => box(c.l, c.t, c.r, Math.min(c.b, h - 4)));
    for (const x of [140, 220, 300, 556, 600]) {
      const p = solveCard({ apex: { x, y: h / 2 }, canvas: box(0, 0, w, h), avoid, card: CARD, prev: null });
      assert.ok(p.fits || p.height === 0, `${w}x${h} apex x=${x}: fits ${p.fits} height ${p.height}`);
      if (p.fits && !p.capped) for (const c of avoid) assert.ok(!hits(boxOf(p, CARD), inflate(c, GAP)), 'clear of the chrome');
    }
  }
});

test('F2: the right side sweeps past the 200 px push, so a card far right of a roof beats a sliver or no card', () => {
  const walls = [box(0, 0, 560, 1080), box(660, 66, 1000, 400)];   // nothing within 200 px right, nothing left: only the far right is whole
  const p = solveCard({ apex: { x: 600, y: 450 }, canvas: box(0, 0, 1920, 1080), avoid: walls, card: CARD, prev: null });
  assert.ok(p.fits && !p.capped, 'whole');
  assert.equal(p.side, 'right');
  assert.ok(p.left >= 1000 + GAP, `far right of the wall: ${p.left}`);
});
