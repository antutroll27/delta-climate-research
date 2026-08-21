# Naming the production routes in the dropdown

**Status:** design approved 2026-08-20. Revised the same day — the first version's transcription rule was too strict; see "Quote and gloss are separate layers".
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

| indicator | Commission's exact words | our label |
|---|---|---|
| `(A)` | grey clinker / cement | Grey cement clinker |
| `(B)` | white clinker / cement | White cement clinker |
| `(C)` | Carbon Steel based on BF/BOF | Carbon steel · blast furnace / basic oxygen furnace |
| `(D)` | Carbon Steel based on DRI/EAF | Carbon steel · direct reduced iron / electric arc furnace |
| `(E)` | Carbon Steel based on Scrap/EAF | Carbon steel · scrap / electric arc furnace |
| `(F)` | Low alloy Steel based on BF/BOF | Low-alloy steel · blast furnace / basic oxygen furnace |
| `(G)` | Low alloy Steel based on DRI/EAF | Low-alloy steel · direct reduced iron / electric arc furnace |
| `(H)` | Low alloy Steel based on scrap/EAF | Low-alloy steel · scrap / electric arc furnace |
| `(J)` | High alloy Steel (based on EAF) | High-alloy steel · electric arc furnace |
| `(K)` | primary Aluminium | Primary aluminium |
| `(L)` | secondary Aluminium | Secondary aluminium |

**These 11 match our corpus exactly** — measured: the distinct `routeIndicator` set in the shipped pack is identical to the Annex's list, no gaps, no extras. The glossary is therefore complete and provably so, which is a stronger position than the usual "we cover most cases".

The same point also defines `(1)` and `(2)` as production-year tranches — *"Value is to be used for production years 2026-27"* / *"2028-30"* — confirming that our pack's generator was right to read them as validity windows rather than routes. An earlier reading of mine called that a data defect; it is not.

## Quote and gloss are separate layers

**This replaces the first version's rule, which was wrong.** That rule said: never write what the source did not write, so `BF/BOF` stays unexpanded and the Commission's inconsistent capitalisation ships as-is.

The principle this codebase actually needs is **never fabricate a source**. "Never write anything unsourced" is stricter, and it defeats the feature: a user who does not know what "BOF" means gets no more help from `(C) — Carbon Steel based on BF/BOF` than from `(C)`. We would have done the work and still left them guessing. Shipping *"Scrap/EAF"* beside *"scrap/EAF"* also just reads as carelessness on a customer-facing tool.

The risk that matters is a gloss that **misleads** someone into the wrong route — a 2.9× mistake. "Basic oxygen furnace" is not a contested reading or a judgement call; it is the expansion, and there is no plausible way to get it wrong. Normalising capitalisation misleads nobody.

So the two layers stay distinct, which is what the tool already does everywhere else:

- **Our label** — plain, readable, ours. Never presented as the Commission's wording.
- **The Commission's exact words** — quoted verbatim beside it, with the citation, so the source is always one glance away.

Where the regulation expands an abbreviation itself, we say so: recitals (15) and (16) give *"blast furnace, direct reduced iron (DRI) and electric arc furnace (EAF) routes"*. **BOF is not expanded anywhere in the regulation**, so its expansion is ours — correct, standard, and not attributed to the Commission.

The verbatim quotes are still transcribed character for character, inconsistencies included, because they are quotes. They are pinned by test. What changed is that they are no longer forced to double as the user-facing label.

## Supporting definitions the Annex also gives

Available for the fuller text, all verbatim from the same Annex:

- **point 1(4):** *"'production route' means a specific technology used in a production process to produce goods."*
- **5.2.1:** the compositional definitions of white and grey cement clinker.
- **5.2.3:** *"'Carbon steel' means steel other than stainless steel, high alloy or low alloy steel"*, plus stainless, high-alloy and low-alloy.

These matter because `(C)`/`(F)`/`(J)` turn on exactly that distinction, and a user who does not know whether their product is "low alloy" cannot pick between `(C)` and `(F)`.

## The design

**Data.** A new `src/scripts/cbam-route-glossary.ts`, deliberately **outside** `src/scripts/cbam-algos/`, which is vendored and hash-guarded. This is not engine logic and is not generated from a workbook, so it does not belong in the pack. A flat record of 11 entries, each carrying:

- `label` — ours, for the option
- `quote` — the Commission's exact words
- `cite` — `IR (EU) 2025/2620, Annex point 5.3`

Flat is safe, and measured to be: the letters are **disjoint across sectors** — cement `(A)(B)`, iron & steel `(C)`–`(H)`,`(J)`, aluminium `(K)(L)`. No letter means two things, so no sector keying is needed.

**Rendering, two places doing different jobs:**

- **In the option itself** — `(C) Carbon steel · blast furnace / basic oxygen furnace`. This is the one that matters, because it is what the user reads *while choosing*. Longest label is 64 characters (`(G)`), and the control is full width in this layout, so it fits without truncation.
- **Below the select** — for the selected route only: the verbatim quote, its citation, and the relevant 5.2.3 steel definition where one applies. This is where the provenance lives and where a user who needs to check our wording against the Commission's can do it.

**A route with no entry renders bare, as today.** No placeholder, no guess. Since the 11 are measured to be exhaustive this should never fire — which is precisely why it must be tested rather than assumed.

## Deliberately not in scope

- **Guessing which route the user's plant runs.** The tool names the options; it does not infer from the good or the origin.
- **Showing each route's benchmark value beside it.** It would make the cost of the choice visible, but it invites picking the cheapest rather than the true one, and the honest input here is the plant's actual technology. Separate decision if wanted.
- **The `(1)`/`(2)` tranche indicators.** They are not routes and never reach the route control.

## Testing

- **All 11 verbatim quotes match the Annex character for character**, hand-typed in the test, never imported from the module under test — a test that imports its expected value passes whatever that value becomes.
- **No label is presented as the Commission's wording.** Assert that the rendered option text and the quoted text are distinguishable in the markup, so a future edit cannot quietly merge the two layers.
- **The glossary covers the corpus exactly:** every `routeIndicator` in the shipped pack has an entry, and every entry corresponds to a real indicator. Both directions, so the glossary cannot drift from the pack in either.
- **Every entry has a non-empty citation.**
- **The dropdown renders the label**, asserted through the real form, since the option text is what the user actually meets.
- **A route with no glossary entry still renders**, proving the fallback rather than assuming it.
