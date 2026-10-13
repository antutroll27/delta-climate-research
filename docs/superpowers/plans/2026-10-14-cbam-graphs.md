# CBAM calculator: the graphs (plan 4)

**Date:** 2026-10-14
**Branch:** `feat/cbam-graphs`, stacked on `feat/cbam-three-year-strip`. Merge the strip first.
**Approved from the design preview:** five cards. Kept as previewed: the big-number arc, the
mark-up capsules, the 10 × 10 waffle with its year switch. Reworked and approved in their second
form: certificates by year as a stepped line, and cost at the visitor's own price as horizontal
rows, both with square marks only. Not approved and not built: the dot cascade, the phase-out
line to 2034, the origins chart.

## Goal

After a visitor previews a shipment, draw that shipment. Not three fixed goods: the line on
screen.

## Where the graphs sit, and why

Directly under the three-year strip, in the same results column, in their own container
`#cbGraphs`. Order on the page: the result card (one date), the strip (the same shipment in three
years, as figures), the graphs (the same three years, drawn).

- They follow the strip because they are drawn from the strip's own outlook object. One
  calculation feeds both, so they cannot describe different lines.
- They are one section with one heading, "The same shipment, drawn", not five cards scattered
  through the form.
- **What repeats, and what does not.** The strip states the three counts and the split as
  figures. Two graphs draw those (the stepped line, the arc). Two add what the strip does not
  have: what the mark-up adds in each year, and how much of the emissions counted is charged.
  The fifth draws cost at the visitor's own price, which the strip gives as one figure per year.
  Captions are kept to one line and the strip's notes are not repeated.
- **One price control.** The strip already has the visitor's price box. The cost graph has no
  first-price box of its own: it draws the strip's price, and offers only a second price to make
  a range. It starts empty.

## States

| State | Graphs |
|---|---|
| Idle form, unreadable mass, date outside the covered years | nothing |
| Document holds added lines | nothing: the graphs are about one previewed line |
| Every year refused (a route with no default value) | one sentence, no chart |
| Some years refused | one sentence, no chart |
| Verified figures | the mark-up cards say none is applied; no capsule is drawn; the arc reads 0.0% |
| Verified direct figure with the Commission's electricity default | the mark-up is the electricity default's |
| Split withheld (free allocation reaches the emissions counted) | the arc card says the change is not divided; the other cards still draw |
| No price typed | the cost card shows the published 2026 marks only, and says to type a price |

## Rules

1. Every number comes from the outlook module or one named engine call. The only new engine call
   is the capsules' comparison: the same line with each default's base value entered as verified.
   A fully verified line makes no such call.
2. That comparison is constructed, and its caption says so. Nothing says anyone will pay less.
3. No forecast. A cost is drawn at a published price or the visitor's own, and nowhere else.
4. The visitor's prices are held in memory only. The existing browser test for that is extended
   to the graphs' price box.
5. The sentence above each chart is built from the numbers the chart draws, and tested on no
   change, a fall, a tiny change and a zero start.
6. Colour: two chart colours per card tone, in the site's tokens, with a test that fails if one
   is changed to a colour that does not pass the checks. No third hue.
7. Vanilla TypeScript, inline SVG, no library, no new dependency. Only opacity and transform
   animate; reduced motion is respected. Nothing rounded on the two reworked cards.
8. On paper the graphs become their tables: sentence, caption and table in black on white.
9. The graph code is a separate chunk, loaded the first time a line has an outlook.

## Tasks

1. `src/scripts/cbam-graphs.ts`: the model, the sentence builders, the plots, the tables. Pure.
   Tests first, `tests/unit/cbam-graphs.test.mjs`.
2. Chart colour tokens in `src/styles/global.css`, and `tests/unit/cbam-chart-colours.test.mjs`.
3. `src/scripts/cbam-graphs-dom.ts`: measuring, year switch, table toggles, second price, tooltip.
4. `cbam-app.ts`: load on demand, paint after the strip, clear with it, pass the price through.
5. Styles and the print treatment in `cbam-calculator.astro`.
6. Browser tests, three page loads: the drawn line and its controls (all engines); the states
   (Chromium); 320 px, axe and paper (all engines).
7. Mutation proofs on a copy outside the repository.
8. Gates, bundle sizes before and after, screenshots against the approved preview.

## Differences from the approved preview, decided here

- The cost card has number boxes, not sliders. A slider cannot be empty, and the card must start
  empty; a box also matches the strip's.
- Card surfaces are a quiet dark gradient without backdrop blur: the page behind is plain, so
  there is nothing for glass to blur.
- The preview's three paper cards were the arc, the waffle and the phase-out line. Here the arc
  and the waffle are paper.
