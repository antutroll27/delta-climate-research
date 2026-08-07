# kolum: competitive read, and what it means for our CBAM calculator

Internal brief · 3 August 2026 · prepared for the founding team

---

## Why this document

We are about to spend effort improving the CBAM calculator. Before doing that, it is
worth knowing precisely what the best-funded competitor in this space has already
built, where they stop, and which of those stopping points are deliberate.

The short version: **kolum is ahead of us on product surface and behind us on
regulatory honesty.** Neither gap is accidental, and only one of them is worth
closing.

---

## What kolum is

A German trade-compliance platform selling three regulated products — EU CBAM, UK
CBAM and EUDR — with PPWR, tariff classification and customs filings announced as
coming. Customers named publicly include BMW Group, CNH Industrial, GlobalFoundries
and Schmitz Cargobull. They hold ISO 27001, ISO 9001 and TÜV SÜD certification.

Their commercial engine is a free, ungated CBAM calculator that converts into a
sales demo. That calculator is our direct comparison point, so most of this brief
concerns it.

Seven named case studies sit on their site. Two are worth reading twice:

- **Keller & Kalmbach** — "replaced an underperforming CBAM tool with kolum." There
  is already displacement happening in this market.
- **Böllhoff** — "achieved over 70% of actual emissions data from suppliers." This is
  their headline proof metric, and it tells you what the product actually is: a
  supplier-data-collection machine with compliance reporting attached.

---

## Their calculator, field by field

| Field | Detail |
| --- | --- |
| Country of production | ~180 options, non-EU only, includes UK |
| Import year | 2026 / 2027 / 2028 |
| Product → CN code | 8-digit, type-ahead search |
| Import quantity (t) | numeric |
| Embedded emissions | **optional** — "leave empty to use official EU default values" |
| `+ Add product` | **multi-line** — several goods in one estimate |

Their stated method, quoted from the page: emissions intensity (defaults per CN code
and country, or the user's own actual values), multiplied by "the benchmark emissions
level for that product category (used to determine how much is exempt)", by the CBAM
factor of 97.5% for 2026, at the Q1 2026 certificate price of €75.36.

They cite EU Regulation 2025/2621 and 2025/2620 — **the same two instruments our own
engine cites.** We are reading the same law.

---

## Where we are genuinely ahead

### 1. The Column A / Column B distinction

This is the most consequential decision in a CBAM calculation and kolum's calculator
does not expose it at all.

Free allocation is the deduction that keeps imports symmetric with EU producers who
still receive free ETS allowances. It is subtracted from embedded emissions before
certificates are counted, so an error here moves the invoice, not a report line.
There are two benchmark columns:

- **Column B** — the whole finished good, precursors already embedded.
- **Column A** — this installation's own process step only, with precursors carried
  separately at their own Column B values.

The column is chosen by the *scope of the emissions figure being deducted from* — not
by whether the data was verified. Our engine encodes this as a type-level constraint
and refuses the inverse error outright.

**Worked from our own rule pack**, the cement chain shows why it matters:

| CN | Good | Column A | Column B |
| --- | --- | --- | --- |
| 25231000 | Cement clinker (route A) | 0.666 | 0.666 |
| 25232900 | Other Portland cement | **0** | 0.666 |
| 25232100 | White Portland cement | **0** | 0.859 |

A clinker kiln calcines limestone; the carbon comes out of the rock in that kiln, so
its own process benchmark and its whole-product benchmark are identical. A cement
grinder buys clinker and mills it — a mechanical operation emitting almost nothing —
so its Column A is zero, and its entire free allocation arrives through the precursor
term instead.

The arithmetic closes exactly: 0 (process) + 1 t × 0.666 (clinker's own Column B) =
0.666 = Portland cement's Column B. **Column A plus the precursor equation is
identical to Column B**, when done properly.

Get it wrong and you deduct zero where 0.666 was owed. On 100 t of CN 25232900 that
is roughly 64.9 tCO₂e, about **€4,890**, silently removed from the importer's favour.
Across our shipped pack, 102 of 141 goods that publish both columns disagree — 72%.
This is not an edge case.

**Our position:** the full Column A path is implemented and audited, and deliberately
unreachable from the public tool, because it is only correct against a verified
process-only figure with a declared precursor list. A screening tool can obtain
neither. That restraint is correct and we should keep it.

### 2. The CSCF, and what we refuse to fabricate

The cross-sectoral correction factor is unpublished for 2026–2030. It is **not** 1.0
by default. Our engine treats this as a first-class unknown: it returns a
`cscf_pending` status carrying a clearly labelled what-if at the last value the
Commission actually set, and never presents it as a finished figure.

kolum's published methodology lists four terms — intensity, benchmark, CBAM factor,
certificate price — and the CSCF is not among them. Their calculator returns a single
confident euro number.

*A caveat we should state plainly:* the string "CSCF" appears nowhere in their
2.98 MB front-end bundle, but I could not determine where their calculator sources its
values, so I cannot rule out a correction applied server-side. What is certain is that
**their published method does not disclose one.** That is a transparency fact, not a
claim about their internals, and we should only ever make the former claim in public.

This is the sharper contrast, and it is a stance rather than a feature. Ours is the
more honest instrument. Theirs is the more satisfying one. That tension is the real
design problem in front of us.

---

## Where they are ahead

**Multi-line input.** Their `+ Add product` lets an importer estimate a whole bill of
materials. Ours handles one line. This is the single largest usability gap and it is
not a hard problem.

**Sourcing comparison.** Their platform ranks every non-UK origin for a given CN code
by CBAM-liable tonnage and surfaces the cheapest compliant option — they advertise
"1,142 sourcing options". This is the most commercially valuable thing on their site,
and **our rule pack already contains every input it needs.**

**Limits stated as notes, not refusals.** Their disclaimer reads: "While CBAM allows
for deductions based on verified carbon pricing already paid in the country of origin,
those mechanisms are not yet fully defined. For this reason, this calculator does not
currently factor in foreign carbon costs." They name a known omission plainly and
still ship a number. Our honesty rules are stricter but are expressed as refusals.
There is something to learn in how they phrase a limit without withholding the answer.

---

## UK CBAM: four facts worth banking

From their FAQ, and consistent with what we know of the UK mechanism:

1. UK CBAM is a **levy administered by HMRC**, not a certificate purchase-and-surrender
   market like the EU's. Certificate-trading features do not port across.
2. **Glass and ceramics are out** of initial 2027 scope.
3. **Indirect (electricity) emissions are delayed to 2029** at the earliest. Our
   estimator already hardcodes direct-only, which is exactly right for UK 2027.
4. Default values will exist so trade can continue.

One sign their UK work is early: their UK page quotes a certificate price of
**£75.36/tCO₂e** while their EU calculator uses **€75.36**. Same numeral, different
currency. Those UK figures look like carried-over placeholders rather than researched
values.

---

## Two structural observations

**They are buying traffic their SEO is not earning.** The site is a React single-page
app with no `sitemap.xml` and no `robots.txt`; every path returns the same shell.
Product pages are pre-rendered, but blog and case-study bodies are not, so their
highest-value content is likely invisible to search engines. Consistent with this, the
link that started this review was a paid Google Ads click on the keyword
"uk cbam 2027".

**Their moat is the supplier network, not the mathematics.** Every module — emissions
monitoring, article management, sourcing — resolves to the same asset: suppliers who
have already been onboarded and are submitting actual data. The Böllhoff 70% figure is
the product. The calculator is the top of a funnel that ends there.

---

## Recommendation

1. **Add multi-line input.** Cheapest meaningful win, closes the most visible gap.
2. **Build the sourcing comparison.** Highest commercial value, and the data is already
   in our pack. This is the feature that makes a calculator a tool people return to.
3. **Keep Column A unreachable.** Our audit's reasoning holds. Do not be tempted by
   feature parity into exposing a control that moves the bill against the user when
   entered wrongly.
4. **Make the CSCF stance legible, not just correct.** Right now our honesty reads as
   a refusal. It should read as the reason to trust us. This is a copy and interface
   problem, not an engineering one, and it is the only thing on this list that
   competitors cannot copy by shipping a feature.

---

*Sources: kolum.earth product, calculator and case-study pages, retrieved 3 August
2026; our own rule pack `estimator-pack.json` (generated 29 July 2026) and
`cbam-algos/cbam/sefa.ts`. Benchmark figures quoted are from our shipped pack, not
from kolum.*
