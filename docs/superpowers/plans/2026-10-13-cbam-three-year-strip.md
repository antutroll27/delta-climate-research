# CBAM calculator: the three-year strip (plan 3 of 3)

**Date:** 2026-10-13
**Spec:** `docs/superpowers/specs/2026-10-10-cbam-three-year-view-design.md`, sections 4.3 to 4.7 and 5.
**Branch:** `feat/cbam-three-year-strip`, stacked on `feat/cbam-three-year-view-2` (plan 2), so the
two can be reviewed and merged separately. Local commits only.
**Approved layout:** C. Year cards and a cause bar, the table behind "Show the working", and a
"your own price assumption" box.

## Goal

Under the result card of the line being previewed, show the same shipment in each year the pack's
default values cover (today 2026, 2027, 2028): the certificates, the cost where a price is
published, and why the count rises. Nothing is forecast.

## Rules this plan is held to

1. Every number comes from the engine's output or from a pack row. The module holds no regulation
   arithmetic: it never multiplies a benchmark by a factor or a default by a mark-up.
2. Nothing is computed in two places. The one sum the engine cannot do, a cost at the visitor's
   own price, uses the engine's formula and rounding, and a test holds it equal to the engine's
   own cost when the assumed price equals a published one.
3. Rounding is done on the exact decimal, never on a binary float, and is judged against the true
   value.
4. No year is compared with a literal. Years, dates, the "as at" date and the weekly-price
   sentence all come from the pack.
5. The visitor's price is theirs: labelled as an assumption wherever it appears, never called a
   forecast or a published price, kept in memory only, never stored, exported or sent.
6. Wording: "none published" with "as at <pack date>". "With verified emissions it no longer
   applies", never "you will pay less".
7. The strip writes its own container and reads the finished estimate. It does not touch the
   good, origin or route fields.

## Design

### `src/scripts/cbam-outlook.ts` (new, not vendored)

```ts
outlook(pack, input): Outlook | null
```

- **Years:** the distinct `reportingYear`s in `pack.defaultValues`, ascending.
- **Date per year:** the input's month and day in that year, parsed with `parseRegulatoryDate`.
  29 February becomes 28 February in a year that has none. Null if the input date is unreadable
  or its year is not a covered year.
- **Per year:** one `estimateFromPack` call with only the date changed. Kept from it: status,
  certificates, cost, direct and indirect emissions, free allocation, the CBAM factor, the
  benchmark terms, the price quarter and status, the tier, and the refusal reason. Added from the
  pack: the price row's `sourceLocator` for that quarter, and the mark-up percentage of the
  default value the engine selected (`selectFactorFromPack`, `lookupIndirectFactorFromPack`).
- **The split** (spec 4.4), first covered year against last, in `decimal.js`:

  ```
  rise            = certificates_last − certificates_first
  more emissions  = embedded_last − embedded_first
  less allocation = allocation_first − allocation_last
    factor part    = allocation_first × (factor_first − factor_last) ÷ factor_first
    benchmark part = less allocation − factor part
  ```

  Given only when: both years have a figure, both carry the same tier, `rise = more emissions +
  less allocation` exactly, the first factor is not zero, and no part is negative. Otherwise the
  strip shows the counts and no split.
- **`assumedCost(certificates, price)`**: certificates × price to two places, half up. The same
  expression the engine uses for a published price.
- **`parseAssumedPrice(text)`**: the engine's `nonNegativeDecimal`, and greater than zero.

### `renderOutlook(view, assumedPrice)` (same file, pure, returns HTML)

- Head: "The same shipment, 2026 to 2028" and a tag "Law as published · <pack date>".
- One card per year: year, certificates, and from the second year the rise on the first as a
  percentage. Beneath: the cost and "price published, €x" where a price is published; otherwise
  "none published" in the weight of a figure with "as at <pack date>"; or, when the visitor has
  typed a price, the cost at "your assumed €x". A refused year shows the engine's own reason and
  no figure.
- "Why it rises by N certificates by <last year>": one stacked bar and a three-row legend
  (mark-up, free allocation retained, benchmark). A row that is zero says so in words. The
  mark-up row is shown only when part of the line rests on a default value.
- `<details>` "Show the working": emissions counted, free allocation deducted, certificates and
  cost, one column per year, with the mark-up, benchmark and factor beneath each figure.
- "Your own price assumption, € per certificate": one number input and a sentence.
- Notes: the correction-factor caveat once, and each distinct pending price row's own locator once.

### Page wiring (`cbam-app.ts`, `cbam-calculator.astro`)

- A container `#cbOutlook` inside the results section, after `#cbOut`, with `aria-live="off"`:
  the result card is already announced, and re-announcing three more years on every keystroke
  would bury it.
- `run()` fills it after a successful estimate and empties it on every other path. `renderAll()`
  empties it while the document holds lines (spec: not shown for document totals).
- The price box updates the strip in place. Focus and the caret stay in the box. The value lives
  in a closure variable and nowhere else.
- Styles in the page's global block, namespaced under `.cb-out`, using the calculator's card, tag
  and field rules and the site's tokens. No animation is added.

## Tasks

### Task 1. The outlook calculation, test first

`tests/unit/cbam-outlook.test.mjs`:

| Case | Asserts |
|---|---|
| welded tube 73063077, India, (C), 100 t | 329.8275 / 376.755 / 427.41; split 86.4 / 11.1825 / 0; rise 97.5825 |
| iron powder 72052100, India, (F) | benchmark changes in the last year; split has a benchmark part; three parts sum to the rise |
| seamless pipe 73041910 and hot-rolled coil 72083900 | the spec's counts |
| a good with no route | counts and split |
| a date in each of the three years | the same three counts whichever year the input date is in |
| 29 February | becomes 28 February in the other years; counts unchanged |
| verified figures | embedded emissions equal in all years; no mark-up part |
| verified direct, default electricity | the mark-up part is the electricity default's |
| electricity in scope on defaults | counts equal the engine's at each date; identity holds |
| a route with no default value | every year refused with the engine's reason; no split |
| free allocation above emissions | counts shown, no split |
| a date outside the covered years, an unreadable date | null |
| every year's figures | equal a direct `estimateFromPack` call at that date |
| `assumedCost` | equals the engine's cost at the published 2026 price; half-up on a tie |
| split identity over a sweep of goods | holds, or the split is withheld |

### Task 2. The renderer, test first

Same file. Text of each state in spec 4.7; the price box's effect on a published and an
unpublished year; "none published" and the pack date; the pending rows' locators printed once; no
"forecast", "will pay", "pay less", "quarterly" or "yet" anywhere in the output; the numbers in
the HTML are the view's numbers.

### Task 3. Wiring and styles

`cbam-app.ts`, `cbam-calculator.astro`. Proved in a browser, since the closures are unreachable
from unit tests.

### Task 4. Browser tests

`tests/e2e/cbam-lines.spec.ts`: the welded-tube line shows three counts; "Show the working" opens
by keyboard; a typed price fills the 2027 and 2028 cost, leaves 2026 alone, keeps focus, and
writes nothing to storage and sends no request; the strip is absent with a line added, at an idle
form and at 2029; no horizontal overflow at 320 px; axe finds no WCAG A or AA violation.

### Task 5. Mutation proofs (on a copy outside the repository)

Break in turn: the date substitution, the factor split, the identity guard, the published-price
guard on the assumption. Each must fail a named test, and each mutation is confirmed present.

### Task 6. Gates and screenshots

`npm run check`, `npm run typecheck`, `npm run test:py`, `npm run build`, `npm run test:unit`,
`npm run check:publication`, and the CBAM browser spec in Chromium, Firefox and WebKit.
Screenshots at 1440 and 390 px of the worked example and two other goods, compared with the
approved preview, every difference listed.

## Known differences from the approved preview, decided here

- "none published yet" and "weekly price from 2027" in the year card become "none published" and
  "as at <pack date>", with the pack's own weekly-price sentence printed once under the strip
  (spec 4.5, amended after the preview).
- The rise is given to one decimal place of a per cent. The preview rounded to a whole per cent,
  which would print "+0%" for a small real rise.
- The working table shows up to three decimal places, to agree with the result card above it.
  The preview showed one.
