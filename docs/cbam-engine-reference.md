# CBAM engine: formulas, routes, tooling and what changed

Technical reference · 7 August 2026 · Delta Climate Research

Every figure below was read from the pack live at `deltaclimate.earth` on the date
of writing, not from a local build. Where something is unverified it says so.

---

## 1. What shipped

Four changes, across two repositories, all live.

| Commit | Repo | What |
| --- | --- | --- |
| `397457e` | CBM | Production-year markers become validity windows; generator emits its own thresholds again |
| `95224d0` | CBM | Real OJ hashes pinned for IR 2025/2620 and 2025/2621 |
| `d529b1b` | Angad | Re-vendor: 185 unpriceable goods become 23 |
| `bf211f1` | Angad | Re-vendor: the two regulations now carry real hashes |

Effect on the calculator, measured across all 574 catalogue CN codes at five
origins, import date in 2026:

| | Before | After |
| --- | --- | --- |
| Goods that produce an estimate | 385 | **547** |
| Goods that cannot be priced from any origin | 185 | **23** |

**No calculated value changed.** A migration gate proved the multiset of
`(CN code, column, benchmark value)` identical before and after. The recovered
goods were previously returning `status: 'unavailable'` — the engine refused
rather than mispriced. This is coverage, not accuracy.

---

## 2. The formulas

Two regulations, two halves of one calculation.

**Certificates owed** are proportional to:

```
(SEE  −  SEFA)  ×  mass  ×  CBAM factor  ×  certificate price
```

`SEE` is what the good emitted. `SEFA` is the deduction that keeps imports
symmetric with EU producers still receiving free ETS allowances. Omit `SEFA` and
you overcharge by the entire free allocation.

### 2.1 Embedded emissions — Annex IV, Reg (EU) 2023/956

```
Simple good:   SEEg = AttrEmg / ALg
Complex good:  SEEg = (AttrEmg + Σ mᵢ · SEEᵢ) / ALg
```

Our public calculator does not compute these. It reads the Commission's
**default values** for the good, origin and production route, and applies the
published mark-up. Computing `SEE` from plant data is the workspace product's job.

### 2.2 Free allocation — IR (EU) 2025/2620

```
Eq 1  FAAg      = SEFAg,y × Mg
Eq 2  SFAProcg  = CBAMy × CSCFy × BM*g          ← BM* is Column A
Eq 3  SEFAg     = SFAProcg                       (simple good)
Eq 4  SEFAg     = SFAProcg + Σ mᵢ · SEFAᵢ        (complex good)
Eq 6  SEFAg     = CBAMy × CSCFy × BMg            ← BM is Column B
```

The calculator runs **Equation 6 exclusively**.

### 2.3 Column A versus Column B

The single most consequential decision in the engine.

| Column | Covers | Used when |
| --- | --- | --- |
| **A** | this installation's own process step only | the emissions figure is process-only, with precursors declared separately |
| **B** | the whole finished good, precursors embedded | the emissions figure is all-inclusive |

**The column is chosen by the SCOPE of the emissions figure, never by whether the
data was verified.** An operator's verified actual data is normally all-inclusive
and therefore still takes Column B.

Worked from our own rule pack — the cement chain:

| CN | Good | Column A | Column B |
| --- | --- | --- | --- |
| 25231000 | Cement clinker, route (A) | 0.666 | 0.666 |
| 25232900 | Portland cement | **0** | 0.666 |
| 25232100 | White Portland cement | **0** | 0.859 |

A clinker kiln calcines limestone, so its own process benchmark equals its
whole-product benchmark. A cement grinder mills bought-in clinker and emits
almost nothing itself, so its Column A is zero and its entire allocation arrives
through the precursor term. The arithmetic closes exactly:

```
0 (process)  +  1 t × 0.666 (clinker's Column B)  =  0.666  =  cement's Column B
```

**Column A plus Equation 4 is identical to Column B**, done properly. Get it
wrong on a default value and you deduct zero where 0.666 was owed — roughly
**€4,890 per 100 t** of CN 25232900. Across the shipped pack, 102 of 141 goods
publishing both columns disagree.

The Column A path is implemented, audited, and **deliberately unreachable** from
the public tool. It is only correct against a verified process-only figure with a
declared precursor list, and a screening tool can obtain neither.

---

## 3. Production routes

### 3.1 The vocabulary

Both regulations publish the same closed legend. Anything outside it is a bug.

| Sector | | |
| --- | --- | --- |
| Cement | (A) grey clinker / cement | (B) white clinker / cement |
| Steel — carbon | (C) BF/BOF | (D) DRI/EAF · (E) Scrap/EAF |
| Steel — low alloy | (F) BF/BOF | (G) DRI/EAF · (H) Scrap/EAF |
| Steel — high alloy | (J) EAF | |
| Aluminium | (K) primary | (L) secondary |

### 3.2 It is a matrix, not a list

The steel letters encode two orthogonal dimensions:

| Grade ↓ / Process → | BF/BOF | DRI/EAF | Scrap/EAF |
| --- | --- | --- | --- |
| Carbon | (C) | (D) | (E) |
| Low alloy | (F) | (G) | (H) |
| High alloy | — | — | (J) |

This is not written down anywhere in the regulations; it falls out of the legend.
It explains everything below.

### 3.3 How a route is selected

```
country of origin
   └─ IR 2025/2621 Annex I  →  "underlying production route determining CBAM BM"
        └─ IR 2025/2620 §5.3 →  the benchmark row for that CN + route
```

The benchmark tables carry **no country column**. Country reaches the benchmark
only through the route. Two rules travel with it:

- *"If no production route is indicated for a CN code, the CBAM benchmark is
  independent of the production route."* (2621 Annex I)
- Unlisted country, or a `–` in the cell, falls back to the
  "Other countries and territories" table.

Both are implemented.

### 3.4 The defect fixed in `397457e`

Annex §5.3 also publishes **production-year** variants: `(1)` for 2026-27 and
`(2)` for 2028-30. These are validity periods, not routes.

`build-fa-package.py` was writing them into the `routeIndicator` field and giving
every row one open-ended validity. Two consequences:

1. Both variants stayed active for every date, so the date could not choose.
2. Nothing ever matched them — the defaults corpus never declares a route of
   `(1)`, nor a compound `(F)(1)`.

**794 of 2,465 rows were unreachable.**

The fix moves the year into `validFrom`/`validTo`, where `resolveBenchmark`
already looks — it filters `active(validFrom, validTo, date)` *before* matching
the route. No engine code changed. The consumer was right; only the producer was
wrong.

IR 2025/2621's own legend, read afterwards, lists (A) through (L) and contains no
`(1)` or `(2)` — independent confirmation from the sister regulation.

Route distribution in the live pack, post-fix:

```
(none) 800   (C) 309  (D) 309  (E) 309
(F) 151  (G) 151  (H) 151  (J) 151
(K) 63   (L) 63   (A) 4    (B) 4
```

Zero year markers. `(F)`–`(J)` at 151 each are the former standalone rows plus
their two former year-variants, now separated by window instead of by name.

### 3.5 Combined routes — known, not yet resolved

IR 2025/2621 Annex I publishes `(C)/(F)` **140 times** and `(E)/(H)` **25 times**.
Read against the matrix, these are *process known, grade ambiguous* — the only
combinations that exist are process-matched pairs. `(C)/(D)` and `(D)/(G)` never
appear.

For every such CN the 2620 table publishes exactly **one** of the two halves,
because the CN description settles the grade (§5.2.3: *"low alloy steel means
alloy steel other than high-alloy"*). Checked across all 19 affected goods: one
half present, zero ambiguous, zero missing.

`resolveBenchmark` does exact string equality, so `(C)/(F)` matches nothing and
those goods fail closed. Splitting on `/` and taking the published half would
recover 19 of the remaining 23. **Not yet implemented.**

---

## 4. The tool

### 4.1 Inputs

Good (CN code) · Country of origin · Production route · Emissions scope ·
Net mass (tonnes) · Import date.

The route list is never free-typed — it is derived from the routes the defaults
corpus actually publishes for that CN and origin. The emissions-scope control
appears only for goods the Commission publishes an indirect default for (cement,
fertilisers, sintered iron ore); elsewhere it cannot change the answer.

### 4.2 What it returns

| Status | Meaning |
| --- | --- |
| `cscf_pending` | A labelled what-if. No final figure exists. |
| `unavailable` | Fails closed — names the missing rule selector verbatim. |
| `zero_by_fiat` | Electricity: nil allocation by law (Art 1(2)), not by calculation. |

**94.3% of all resolvable answers are `cscf_pending`.** Zero are settled figures.
The cross-sectoral correction factor is unpublished for 2026-2030 and is **not
1.0 by default**; the engine refuses to assume one and shows a labelled scenario
at the last value the Commission actually set.

### 4.3 The de minimis threshold

50 t per calendar year, across cement, aluminium, fertilisers and iron & steel
(Reg 2023/956 Art 2(3)).

```
above 50 t                          → above_threshold
at or below + completeness=complete → below_threshold
at or below + partial/unknown       → indeterminate
```

**"Above" can be proven from one line. "Below" cannot** — it requires knowing the
importer's whole year. The calculator submits a single line, so it can only ever
return `indeterminate`. `threshold/aggregate.ts` carries a full annual-ledger
model and is currently referenced zero times by the calculator.

---

## 5. Data and provenance

Live pack, `generatedAt 2026-08-07T16:59:36.563Z`:

| Table | Rows |
| --- | --- |
| `defaultFactors` | 41,100 |
| `benchmarks` | 2,465 (Column A 661, Column B 1,804) |
| `classifications` | 574 |
| `cbamFactors` | 9 — 2026 is **0.975**, free allocation *retained* |
| `cscf` | 5 — all `pending`, 2026-2030 |
| `prices` | 4 — 2026-Q1 €75.36, Q2 €75.28, Q3/Q4 unpublished |
| `thresholds` | 1 — 50 t |

7.55 MB raw, **281 KB on the wire** (Vercel serves brotli). Repeat visits transfer
nothing.

### 5.1 Source hashes

Two regulations now carry real hashes, replacing sixty-four zeros:

```
IR 2025/2620   8bbba79e7f33f0e4943140c28e91a8810612f2fa770bd6dcad33fdb7045e4c05
IR 2025/2621   3155016c2e07b049b64f1ac4c2320061534245b81971ce5cba7814736f09acb4
```

Both PDFs were retrieved by hand and verified as genuine Publications Office
artefacts. EUR-Lex sits behind an AWS WAF challenge, so neither can be re-fetched
by a script — the hash pins *which* text we read; it cannot be re-verified
automatically.

Four sources still carry placeholders: `dir-2003-87-art-10a-1a`,
`dr-2019-331-art-14-6`, `reg-2023-956`, `ec-certificate-price-page`.

### 5.2 The second defect, fixed in the same commit

`build-fa-package.py` could not reproduce its own golden file. The `thresholds`
block — the 50 t gate — and its `reg-2023-956` source had been hand-added on
2026-07-29 and never taught to the generator. **Every regeneration silently
deleted the rule deciding whether an importer owes anything at all.**

Invisible until something regenerated. The year-window work forced a
regeneration, which is how it surfaced.

The near-miss is worth recording: the first fidelity check compared
`benchmarks` only, and passed. A full-package comparison found **two** drifts —
`thresholds` *and* the `sources` array. **A fidelity check must compare the whole
artefact; comparing the part you are about to change proves nothing about the
parts you are not.**

---

## 6. How it is verified

- Unmodified generators reproduce their committed goldens **byte-for-byte**,
  before any change is made.
- A migration gate asserts every benchmark value, every `sourceLocator` and every
  non-benchmark section is unchanged.
- A regression test asserts no year marker can reappear in `routeIndicator`, and
  no `(CN, column, route)` group holds both a bounded and an unbounded row.
- `cbam-sync-check.mjs` hashes the eleven vendored engine files against a
  committed manifest. The engine in the website is a copy of the SaaS's, and this
  is the tripwire against drift.
- CBM: 379/379 tests, typecheck clean. Angad: 171/171 unit, 16/16 Playwright,
  publication contract 80 checks / 0 violations.

CBM's own `differential.test.ts` had pinned this gap at 382 priceable / 183
stranded for India and concluded it *"needs corpus research rather than a code
change."* It was a code change. The pin now reads 528/37, and the remaining 37
are a genuine corpus question.

---

## 7. Open

| Item | Note |
| --- | --- |
| CSCF unpublished | 94.3% of answers are what-ifs. Nothing we can do; a one-line data change when Brussels publishes. |
| 2027+ import dates | Certificate prices exist only for 2026 quarters, so any later date fails closed with no explanation. The most visible remaining flaw. |
| Combined `(C)/(F)` routes | 19 goods, resolution backed by both regulations. Not implemented. |
| Multi-line and the annual threshold | `threshold/aggregate.ts` vendored and unused. Blocks any `below_threshold` verdict. |
| Art 9 carbon price paid abroad | Not modelled; disclosed in output as making the figure conservative. Implementing act still a draft. |
| `Art 2(2)` citation | Wrong in five places in the vendored engine — Article 2 has no numbered paragraphs; the provision is Art 1(2). Unreachable today. |
| 41,100 default factors | Never reconciled against IR 2025/2621's 2,400-page Annex I. The largest unaudited surface. |

---

*Sources: IR (EU) 2025/2620 and 2025/2621 (OJ PDFs, hashes above); Reg (EU)
2023/956; the shipped rule pack at deltaclimate.earth. Benchmark figures quoted
are from our own pack, cross-checked against the published Annex.*
