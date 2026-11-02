# 25-cbam-rail: notes

Open `index.html?view=estimate|three-years|why|list|export|rules|empty&theme=light|dark&device=desktop|phone&rail=open|collapsed` (extra: `&price=80` shows the Three years / Why cost cards with an own price typed; default is the price box EMPTY, which is what users see first). Also in the folder: `lines.csv` (real toCsv output) and `document.html` (real buildPrintDocument output), linked from Export.

## Figures verified from the engine run
Hero line 100 t, CN 73063077, IN, (C), 2026-03-15: 329.8275 / 376.755 / 427.41 certificates (page shows 329.828 / 376.755 / 427.41), 2026 Q1 price EUR 75.36, EUR 24,855.80. Mark-up share 88.5% (86.4 of 97.6). Shipment: + 25232900 grey Portland cement IN 120 t 2026-05-12 (117.438 certs, EUR 8,840.73, Q2 75.28) + 76011010 unwrought aluminium IN (K) 40 t 2026-08-03 (26.783 certs, EUR 2,204.78, Q3 82.32). 2026 eligible mass 260 t vs 50 t (cement, aluminium, iron and steel), total 474.049 certificates, EUR 35,901.31. Every figure sits in an HTML comment at the top of its view with the call it came from.

## Decisions for the founder to confirm
1. Light plates: white cards on an off-white ground (#EFECE6). OBOS's shipped Plate is stone (#ECE8E1); I followed your brief (white). Dark: card #061b1d, wells #0a2629 / #0d3236, ground #031416.
2. Colour law applied strictly. These lines are all on Commission defaults, so the only data colour on screen is bronze (chip, mark-up segment, capsules, badge). Cyan appears only on the collapsed "My verified figures" panel and in the colour key. Free allocation and benchmark are ink (solid / outlined), NOT cyan as in the current graphs. The own-price box is ink with a heavy outline, not cyan: it is an assumption, not verified data. Say if you want it cyan.
3. Graphs restyled, same engine SVG: gradients, glow and rounded ends removed; every circle redrawn as a square (waffle cells, cascade dots, ring markers). The "capsules" are now flat square-ended bars with a square ring marker. The arc is a flat bronze arc with butt ends (an arc cannot be square; the arc stroke is the one curved mark).
4. Short names ("Welded tube", "Grey Portland cement", "Unwrought aluminium") are my labels, not engine output; the pack only has the long CN description. Needs a real short-name source for implementation. Rail title card collapsed shows the first 4 digits of the CN.
5. The Commission-defaults chip uses the engine's tier string "Commission default + mark-up" (the brief said "Commission defaults").
6. Own price: no empty-state sentence invented; the cost card says "Type your own price above to see a cost" (engine text).
7. Phone: "More" opens a small menu (Export, Rules & sources). Theme on phone is a single toggle button in the top bar. The CSV preview on phone shows 5 of 33 columns.

## Not sourced / not real
- The "Light / Dark" switch, rail collapse, tab switching, waffle year pills and Table toggles are preview JS only. No tooltips (the engine's hover text is not wired), no live form: inputs are static renderings of the page's fields with the hero values.
- Delta mark is a simple stand-in triangle (not the real logo file; I did not copy assets). Brand link goes to "/".
- Verified panel fields are shown with the page's labels but are not computed.

## Footnote re-measured (Rules & sources)
The page says "183 of 574 offered goods ... 181 iron and steel". Measured 2 Nov 2026 over 572 classifications x 122 origins x every published 2026 route (173,520 estimates, date 2026-03-15, scope direct+indirect): ZERO refuse for a missing benchmark. The only refusals (150,516) are "no applicable direct default value". So the page footnote is stale (an earlier audit already flagged it); the preview prints "0 of 572". Confirm the wording.

## Contrast, WCAG (text colours used)
Light (card #FFFFFF): bronze text #7A5718 6.55:1 on card, 5.80 on well, 5.68 on its own chip; cyan text #0B6E7C 5.94 on card, 5.26 on well, 5.21 on chip. Mark fills (3:1 needed): bronze #A87A28 3.83, cyan #139AAD 3.36.
Dark (card #061b1d): bronze text #E0B766 9.42 on card, 8.42 on well, 7.20 on chip; cyan text #6FCAD6 9.38, 8.39, 7.22. Fills: bronze #CFA24A 7.54, cyan 9.38.

## Skipped / known rough edges
- Why it changes shows all 8 engine graphs (the three favourites first); the desktop and phone SVGs are generated at fixed plot widths (330/690/1090 and 318), so a window between those sizes scales them.
- The List badge overlaps the selected tab icon slightly on phone.
- 1280x720 shots exist for Estimate and Three years only, as asked. Empty state exists for Three years only.
- The bottom of long views (provenance, cascade, origins, sources) is below the viewport-only shots; scroll the page to see them.
