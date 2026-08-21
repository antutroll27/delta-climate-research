# Naming the production routes in the dropdown

**Status:** design approved 2026-08-20.
**Origin:** the co-founder found that the route control offers bare letters — `(A)`, `(C)`, `(K)` — with nothing telling the user which one is their plant.

## Why this matters more than it looks

Route choice is expensive to get wrong. On `72061000` the difference between `(C)` and `(E)` is **2.9× the certificates** — 64.42 against 187.37 on the same 100 t line. The calculator asks an importer to make that choice from a letter.

It is also newly acute: the all-routes work took visible routes from 5 to 11, so where a user previously had no choice they now have several, and no basis for making one.

## What we hold, measured

The pack carries the route letters and nothing else. `defaultValues` rows have `productionRoute`; `benchmarks` rows have `routeIndicator`; neither carries a description, and `sourceLocator` only ever says *"route (A)"*. Both official EC workbooks were swept cell-by-cell — 125 sheets in the default-values workbook, all of the benchmarks workbook — and every match for process language is a **CN good description**, never a route definition. The default-values workbook heads that column *"Underlying production route determining CBAM BM"*: an identifier pointing at a benchmark.

The co-founder's own routes matrix is values-only, letters as column headers.

So the definitions existed nowhere we could reach. EUR-Lex returns HTTP 202 with an empty body on both HTML and PDF endpoints even with a browser user-agent, and the JS-capable fetch path was out of credits. **The founder supplied the regulation PDF directly**, which is how this spec has a source at all.

## The source

**IR (EU) 2025/2620, Annex, point 5.3** — *"Where more than one benchmark value is given for a specific CN code, the meaning of the indicators is as follows"*:

| indicator | verbatim text |
|---|---|
| `(A)` | grey clinker / cement |
| `(B)` | white clinker / cement |
| `(C)` | Carbon Steel based on BF/BOF |
| `(D)` | Carbon Steel based on DRI/EAF |
| `(E)` | Carbon Steel based on Scrap/EAF |
| `(F)` | Low alloy Steel based on BF/BOF |
| `(G)` | Low alloy Steel based on DRI/EAF |
| `(H)` | Low alloy Steel based on scrap/EAF |
| `(J)` | High alloy Steel (based on EAF) |
| `(K)` | primary Aluminium |
| `(L)` | secondary Aluminium |

**These 11 match our corpus exactly** — measured: the distinct `routeIndicator` set in the shipped pack is identical to the Annex's list, no gaps, no extras. The glossary is therefore complete and provably so, which is a stronger position than the usual "we cover most cases".

The same point also defines `(1)` and `(2)` as production-year tranches — *"Value is to be used for production years 2026-27"* / *"2028-30"* — confirming that our pack's generator was right to read them as validity windows rather than routes. An earlier reading of mine called that a data defect; it is not.

## Transcription rules

**Verbatim, including the regulation's own inconsistencies.** It writes "Carbon Steel" but "Low alloy Steel"; "Scrap/EAF" in `(E)` but "scrap/EAF" in `(H)`; "primary Aluminium" lowercase-then-capital. These are quotes, not our prose, so they are copied exactly. A test asserts the strings match the Annex character for character, hand-typed rather than imported.

**Abbreviations are expanded only where the regulation expands them.** Recitals (15) and (16) give *"blast furnace, direct reduced iron (DRI) and electric arc furnace (EAF) routes"* and *"electric arc furnace (EAF)"*. So BF, DRI and EAF are sourced.

**BOF is not expanded anywhere in the regulation.** The obvious expansion is well known in the industry, but writing it as though it came from the source would be exactly the fabrication this calculator refuses elsewhere. `(C)` and `(F)` therefore keep "BF/BOF" unexpanded, and if we ever gloss it, it is marked as ours.

## Supporting definitions the Annex also gives

Available for the fuller text, all verbatim from the same Annex:

- **point 1(4):** *"'production route' means a specific technology used in a production process to produce goods."*
- **5.2.1:** the compositional definitions of white and grey cement clinker.
- **5.2.3:** *"'Carbon steel' means steel other than stainless steel, high alloy or low alloy steel"*, plus stainless, high-alloy and low-alloy.

These matter because `(C)`/`(F)`/`(J)` turn on exactly that distinction, and a user who does not know whether their product is "low alloy" cannot pick between `(C)` and `(F)`.

## The design

**Data.** A new `src/scripts/cbam-route-glossary.ts`, deliberately **outside** `src/scripts/cbam-algos/`, which is vendored and hash-guarded. This is not engine logic and is not generated from a workbook, so it does not belong in the pack. A flat `Record<string, { short, full, cite }>` with 11 entries.

Flat is safe, and measured to be: the letters are **disjoint across sectors** — cement `(A)(B)`, iron & steel `(C)`–`(H)`,`(J)`, aluminium `(K)(L)`. No letter means two things, so no sector keying is needed.

**Rendering, two places doing different jobs:**

- **In the option itself** — `(C) — Carbon Steel based on BF/BOF`. This is the one that matters, because it is what the user reads *while choosing*. The longest label is 30 characters, which fits an option comfortably.
- **Below the select** — for the selected route only: the abbreviation expansions where sourced, the relevant 5.2.3 steel definition where one applies, and the citation.

**Every entry carries its own source locator** in the pack's own style (`IR (EU) 2025/2620 Annex point 5.3`). A test asserts all 11 have one, so a future entry cannot be added without provenance.

**A route with no entry renders bare, as today.** No placeholder, no guess. Since the 11 are measured to be exhaustive this should never fire — which is precisely why it must be tested rather than assumed.

## Deliberately not in scope

- **Guessing which route the user's plant runs.** The tool names the options; it does not infer from the good or the origin.
- **Showing each route's benchmark value beside it.** It would make the cost of the choice visible, but it invites picking the cheapest rather than the true one, and the honest input here is the plant's actual technology. Separate decision if wanted.
- **Expanding BOF**, per the transcription rule above.
- **The `(1)`/`(2)` tranche indicators.** They are not routes and never reach the route control.

## Testing

- **All 11 strings match the Annex character for character**, hand-typed in the test, never imported from the module under test — a test that imports its expected value passes whatever that value becomes.
- **The glossary covers the corpus exactly:** every `routeIndicator` in the shipped pack has an entry, and every entry corresponds to a real indicator. Both directions, so the glossary cannot drift from the pack in either.
- **Every entry has a non-empty citation.**
- **The dropdown renders the label**, asserted through the real form, since the option text is what the user actually meets.
- **A route with no glossary entry still renders**, proving the fallback rather than assuming it.
