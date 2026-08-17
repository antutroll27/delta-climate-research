# CBAM calculator — policy-assumption register

**What this is.** Every point at which the CBAM calculator had to decide what the regulation
*means*, written out so it can be reviewed by someone who does not read code.

**Who it is for.** A CBAM consultant, a customs or trade lawyer, or the founder. Nothing here
requires opening a file. The file references at the end of each entry are for the engineer who
would change the behaviour once you have ruled on it.

**Why it exists.** A week of auditing has established the calculator's *internal honesty* — that
every figure on screen is what the engine computed, that every refusal names its real cause, that
every citation points at an article that exists. **None of that tests whether the interpretations
below are correct.** A calculator can be perfectly self-consistent and confidently apply the wrong
article. These **54 entries** are the interpretations. Nobody outside the engineering work has ever
reviewed them.

**How the evidence falls.** Of the 54: **8** are quoted from the regulation, **8** are inherited from
a Commission workbook, **29** are inferred from the regulation's structure with no text quoted, and
**13** touch an assumption with no source at all — **9 of those wholly**. The single largest group is
*inferred*: over half the register rests on reading the structure of an instrument rather than its
words.

**What I have not done.** I have not adjudicated any of these questions. Where the code took a
reading, I have recorded the reading and — where one is documented — the alternative it rejected
and what that alternative would have cost. Deciding which reading is right is your job, not mine.

---

## How to read an entry

Each entry carries seven fields.

| Field | What it tells you |
|---|---|
| **Claim** | The interpretation, in one plain sentence |
| **Citation** | The instrument and article, exactly as the code cites it |
| **Behaviour** | What the calculator concretely does, with the number where there is one |
| **Alternative** | The other reading, and what it would cost in figures. *The most valuable field.* |
| **If wrong** | Direction (over- or under-charge) and rough magnitude |
| **Evidence** | See the four grades below |
| **Where** | file:line |

### Evidence grades

| Grade | Meaning |
|---|---|
| **Quoted** | Stated in the regulation and quoted in the code |
| **Inferred** | Inferred from the regulation's structure; no text quoted |
| **Inherited** | Taken from the Commission's own workbook rather than the binding text |
| **Assumed** | No source cited anywhere. *A finding, not a failure — but it is a finding.* |

### Where the code lives

The calculation engine exists in two places, and they are **byte-identical** (verified by diff
across all eleven shared files):

- `/Volumes/VSTSAMPLES/Projects/CBM/lib/…` — the authority. Cited below.
- `/private/tmp/cbam-gates/src/scripts/cbam-algos/…` — a vendored copy shipped to the browser.

Two files exist **only** in the website copy and are cited under that path: `cbam-app.ts` (the
on-screen and printed wording) and `cbam-lines.ts` (the multi-line threshold logic).

### A note on the worked example used throughout

Where a worked figure helps, I use one real line drawn from the shipped data pack:

> **1,000 tonnes of Indian grey clinker (CN 2523 10 00), production route (A), imported in
> Q1 2026, priced from the Commission's published default values.**
>
> Published default intensity **1.39 tCO₂e/t**, cement mark-up **10%** → marked-up **1.529**.
> Embedded emissions **1,529 tCO₂e**. Column B benchmark for route (A) **0.666 tCO₂e/t**.
> CBAM factor 2026 **0.975**. CSCF assumed **1.0**. Free allocation **649.35 tCO₂e**.
> Chargeable **879.65 tCO₂e**. At the published Q1 2026 certificate price of **€75.36**,
> the bill is **€66,290.42**.

---

# A · IR (EU) 2025/2620 — the free-allocation adjustment

*Eleven citations in non-test code. This is the instrument that decides how much of the bill is
cancelled by the free allocation an EU producer would still have received.*

---

### A1 · Free allocation is subtracted from embedded emissions, and certificates are counted on what is left

**Claim.** The tool treats free allocation as a deduction from the tonnes of CO₂ a shipment
carries, not as a discount on the price of a certificate. Certificates = emissions − free
allocation; the bill = certificates × the quarter's price.

**Citation.** IR (EU) 2025/2620, Arts 1–3 and Annex §5.3.

**Behaviour.** In the worked example: 1,529 − 649.35 = 879.65 tCO₂e chargeable; 879.65 × €75.36 =
€66,290.42. The subtraction happens in tonnes, before any price is applied.

**Alternative.** Not documented. The code states the formula as settled and does not record a
rejected shape. If the adjustment were instead a reduction in the *number of certificates
surrenderable* or a price discount, the arithmetic would differ wherever the deduction exceeds
emissions (see A5).

**If wrong.** Would misstate every priced line. Magnitude depends on the alternative; for the
worked line the free allocation is 42% of embedded emissions, so the whole 42% is at stake.

**Evidence.** Inferred — the formula is written out in the code's own notation (Eq 2 / Eq 4 /
Eq 6) with the instrument named, but no text of the article is quoted.

**Where.** `lib/cbam/sefa.ts:6–21`, `lib/cbam/certificate-estimate.ts:174–200`.

---

### A2 · Which benchmark column applies is decided by the *scope of the emissions figure*, not by whether the figure was verified

**Claim.** If the emissions figure already covers the whole product (including the emissions of
everything that went into it), the deduction uses the *full-product* benchmark. If the figure
covers only one installation's own process, the deduction uses the *process* benchmark plus a
separate benchmark for each input. Whether the number was audited is irrelevant to this choice.

**Citation.** IR (EU) 2025/2620 Annex — Column A (process) and Column B (full product).

**Behaviour.** A default-values line always carries a whole-product figure, so it always takes
Column B. An importer's own verified figure takes Column B too *provided* it is a whole-product
figure — which the tool requires, and says so. Process-level (Column A) data is out of scope for
this calculator entirely.

**Alternative.** Documented and rejected. The code calls this "the most expensive bug available
here". Deducting a process benchmark from a whole-product figure leaves the input emissions in the
chargeable total with no matching allocation. **Worked:** grey Portland cement, CN 2523 29 00, has
a published Column A of **0** and a Column B of **0.666**. On 1,000 t from India at 2026 defaults,
Column B gives €66,290.42 and Column A gives **€115,225.44** — an over-charge of **€48,935**, a
factor of **1.74**, and for that good the deduction vanishes completely.

**If wrong.** Over-charge, severalfold on complex goods; total loss of the deduction for grinders
and other goods whose Column A is zero.

**Evidence.** Inferred — the column semantics are asserted from the Annex's structure; no article
text is quoted.

**Where.** `lib/cbam/sefa.ts:42–61` (the rationale), `lib/cbam/sefa.ts:165` (the choice).

---

### A3 · Each input (precursor) is valued at its *own* full-product benchmark, and the calculation stops after one level

**Claim.** When a good is priced from process-level data, each material that went into it gets its
own full-product benchmark — and the tool does not then go on to look up *that* material's own
inputs, because the full-product benchmark already includes them.

**Citation.** IR (EU) 2025/2620 — the code's "Eq 4".

**Behaviour.** Each precursor contributes `its Column B benchmark × tonnes of it per tonne of
good`. One level only.

**Alternative.** Documented: recursing further "would double-count".

**If wrong.** Recursing would under-charge (deduction too large). Not recursing when the
regulation intends recursion would over-charge. Magnitude depends entirely on the supply chain.
*Note:* this path is **unreachable in the shipped calculator** — the browser estimator passes an
empty precursor list at both call sites, so this rule governs the workspace product only.

**Evidence.** Inferred.

**Where.** `lib/cbam/sefa.ts:175–191`.

---

### A4 · A whole-product figure supplied *together with* a list of inputs is refused rather than priced

**Claim.** If someone gives the tool a whole-product emissions figure and *also* itemises the
inputs, the tool refuses to price the line, because deducting a whole-product benchmark and then
deducting each input's benchmark on top would grant the allowance twice.

**Citation.** IR (EU) 2025/2620 — Column B "already covers the whole product".

**Behaviour.** Returns a refusal, not a figure.

**Alternative.** Documented: adding them "would double-count the deduction and under-charge".

**If wrong.** As coded, no harm — it refuses. If the regulation actually *does* intend both, the
tool refuses lines it should price. **Unreachable in production:** no shipped call site can supply
both, and the code says so explicitly.

**Evidence.** Inferred.

**Where.** `lib/cbam/sefa.ts:192–199`.

---

### A5 · Free allocation can never produce a negative bill — the floor is zero, and the floor applies to the direct emissions only

**Claim.** If a producer is cleaner than the benchmark, the surplus allocation is discarded rather
than credited: the tool never issues certificates, only surrenders them. And the zero floor is
applied to the process-emissions side alone — a generous process benchmark cannot be used to wipe
out electricity emissions it was never granted against.

**Citation.** None cited.

**Behaviour.** `chargeable = max(0, direct emissions − free allocation) + indirect emissions`.

**Alternative.** Not documented. The code asserts "the regulation surrenders certificates, never
issues them" without naming an article.

**If wrong.** If surplus allocation were creditable, clean producers are over-charged. The
split-floor decision is the sharper one: a clean-process, electricity-intensive line that would
otherwise net out to zero is charged its full electricity component here.

**Evidence.** **Assumed** — no source cited for the zero floor, and none for applying it to the
direct side alone.

**Where.** `lib/cbam/certificate-estimate.ts:183–187`.

---

### A6 · Electricity (indirect) emissions receive no free allocation at all and pass into the charge in full

**Claim.** The free-allocation benchmarks are benchmarks for *process* emissions. So the
electricity emissions embedded in a good get no deduction whatsoever and are charged in full.

**Citation.** IR (EU) 2025/2620 Annex — asserted as a property of the benchmark tables.

**Behaviour.** The indirect component is held separately from the direct one, never summed before
the deduction, and added back after it. Every priced line carrying a non-zero indirect component
prints a note saying so.

**Alternative.** Not documented as a rejected reading. The code explains the *mechanism* — summing
them first "would silently deduct a direct benchmark from electricity" — but does not record
anyone arguing the other way.

**If wrong.** Over-charge, confined to the three sectors where indirect emissions are charged at
all (cement, fertilisers, hydrogen). Magnitude is the whole indirect component: on Indian grey
clinker route (A) the indirect default is 0.05 tCO₂e/t against a direct 1.39, so roughly 3.5% of
the line.

**Evidence.** Inferred.

**Where.** `lib/cbam/certificate-estimate.ts:59–65`, `108–115`, `493–498`;
`/private/tmp/cbam-gates/src/scripts/cbam-algos/cbam-app.ts:540–548`.

---

### A7 · For electricity itself, free allocation is nil because the article says so — and that zero is final even though the correction factor is unpublished

**Claim.** Imported electricity gets no free allocation, by direct operation of the article rather
than by any calculation. Because the zero is set by law and not computed, it is a *final* figure
even in years where the cross-sectoral correction factor has not been published — the missing
factor cannot change a zero the law fixes outright.

**Citation.** IR (EU) 2025/2620 **Art 1(2)**. The pack generator adds: "Art 1(2), not Art 2(2):
Article 2 has no numbered paragraphs."

**Behaviour.** CN 2716 0000 returns a dedicated status (`zero_by_fiat`) carrying the article as its
locator. It is deliberately *not* reported as an ordinary priced figure, and reports no correction
factor at all.

**Alternative.** Documented and rejected. An earlier version returned it as an ordinary figure with
a fabricated correction factor of 0, and the interface printed "CSCF published · CSCF 0" — "a false
statement about a regulation whose CSCF is unpublished".

**If wrong.** If electricity does attract allocation, over-charge on 100% of the allocation it
should have had. **Note:** the shipped browser pack does not classify electricity at all, so this
path is currently unreachable from the public calculator.

**Evidence.** **Quoted** — the article is named, the paragraph is defended against a specific
mis-citation, and the locator string is carried onto the figure.

**Where.** `lib/cbam/sefa.ts:28–33`, `143–163`; `scripts/build-fa-package.py:88–90`.

---

### A8 · A benchmark row with a blank route indicator means "applies however the good was produced"

**Claim.** Where the Annex lists a single benchmark for a good with no production route beside it,
the tool reads that as covering every route. An exact route match wins if there is one; otherwise
the unqualified row applies.

**Citation.** IR (EU) 2025/2620 Annex.

**Behaviour.** Two-step: exact route match, then blank-route row. Where the Annex *does* enumerate
routes and none matches (Column B for CN 7208 38 00 lists only (C)/(D)/(E)), there is no blank row
to fall back on and the line is refused.

**Alternative.** Documented as *not* a guess: "it is what an unqualified Annex row means."

**If wrong.** If a blank row were meant to apply only to some default route, using it for all
routes would over- or under-charge unpredictably per good.

**Evidence.** Inferred.

**Where.** `lib/cbam/resolve-fa.ts:58–89`.

---

### A9 · Where the Annex lists a good at heading level, that heading governs every code beneath it — and the most specific listing wins

**Claim.** Some goods are listed at 4- or 6-digit level rather than at full 8-digit CN. The tool
reads such a listing as covering everything under it, and where several listings could apply, the
most specific one governs. Two listings of equal specificity are treated as a conflict and the line
is refused.

**Citation.** IR (EU) 2025/2620 Annex (benchmarks); Reg (EU) 2023/956 Annex I (classification).

**Behaviour.** Longest matching prefix wins. A tie throws "ambiguous" and shows no figure.

**Alternative.** Documented on the classification side: matching only on 8 digits "misses goods the
regulation plainly covers — an under-coverage bug, and the expensive direction to be wrong in."

**If wrong.** Over-broad matching over-charges goods outside scope; under-broad matching refuses
goods that are in scope. The code judges under-coverage the worse error and biased toward
inclusion.

**Evidence.** Inferred.

**Where.** `lib/cbam/resolve-fa.ts:74–104`; `lib/regulatory/resolve.ts:59–97`.

---

### A10 · The Annex's "(1)" and "(2)" markers are validity periods, not production routes

**Claim.** Where a benchmark row is marked (1) or (2), the tool reads those as meaning "this value
applies to production years 2026–27" and "…2028–30" respectively — *not* as naming a way of making
the good.

**Citation.** IR (EU) 2025/2620 Annex **§5.3**.

**Behaviour.** "(F)(1)" becomes route (F) valid 2026-01-01 to 2027-12-31; "(1)" alone becomes a
route-independent row with that window. **794 of 2,465 benchmark rows are affected.**

**Alternative.** Documented and rejected. Left in the route field, those markers are unreachable —
the default-values corpus never declares a route of "(1)" or a compound "(F)(1)" — "so the good
simply cannot be priced". The failure mode of the rejected reading is a refusal, not a wrong number.

**If wrong.** If (1)/(2) mean something else, up to 794 rows apply in the wrong years. Direction
depends on which value is dearer; for a good whose 2028 benchmark is lower than its 2026 one,
using the wrong window under-charges.

**Evidence.** **Quoted** — Annex §5.3 is named as the source of the reading.

**Where.** `scripts/build-fa-package.py:34–60`.

---

### A11 · A good with no published benchmark is refused, not priced with a zero deduction

**Claim.** Where the Annex publishes no benchmark for the good, route or year, the tool shows no
figure at all rather than pricing the line with no deduction.

**Citation.** IR (EU) 2025/2620 Annex.

**Behaviour.** Refusal with the wording: "The published rules do not give a free-allocation
benchmark for this good, production route or year, so no figure is shown." The code's own sweep
over the shipped pack: **5,964 of 17,484 estimates** refuse for a missing benchmark, and **183 of
574 offered goods**, 181 of them iron and steel.

**Alternative.** Documented as the whole design stance ("NON-NEGOTIABLE 2"). Pricing with a zero
deduction would over-charge by the full benchmark.

**If wrong.** No financial error — but a third of the offered catalogue returns no answer. That is
a commercial cost, not a compliance one.

**Evidence.** Inferred.

**Where.** `lib/cbam/certificate-estimate.ts:269–271`, `593–607`;
`/private/tmp/cbam-gates/src/scripts/cbam-algos/cbam-app.ts:598–614`.

---

### A12 · If one input's benchmark cannot be found, the whole line is refused rather than priced with a smaller deduction

**Claim.** On a process-data line, a missing benchmark for any single input kills the entire
estimate. The tool will not quietly carry on with a smaller deduction.

**Citation.** IR (EU) 2025/2620 — the code's "Eq 4".

**Behaviour.** All benchmarks are collected before any multiplication; one miss refuses the line.

**Alternative.** Documented, with the direction of harm spelled out: "a smaller deduction is a
bigger bill charged to the importer **on our authority**."

**If wrong.** As coded, no financial error. The rejected alternative would have over-charged.

**Evidence.** Inferred.

**Where.** `lib/cbam/sefa.ts:131–138`; `lib/cbam/certificate-estimate.ts:311–331`.

---

### A13 · The benchmark numbers come from the Commission's spreadsheet, and the tool says on every printed document that the spreadsheet is not the binding text

**Claim.** The benchmark values are transcribed from the Commission's published "CBAM Benchmarks"
workbook, which the Commission itself marks as informational. The legally valid values are those in
IR (EU) 2025/2620. The tool records both and labels the workbook as guidance.

**Citation.** IR (EU) 2025/2620 Annex, via the EC benchmarks workbook v1 (2025-02-06).

**Behaviour.** Every one of the 2,465 benchmark rows carries a locator naming both the regulation
and the workbook cell it came from. The workbook is pinned by SHA-256; a reissue aborts the build
rather than silently changing values. The printed document lists the workbook as "an informational
transcription of the 2025/2620 Annex, **not the binding text**".

**Alternative.** Not documented — no alternative source is discussed.

**If wrong.** Any divergence between the workbook and the Annex propagates directly into every
figure. **Unquantified: nobody has diffed the workbook against the OJ text.** The regulation's own
PDF is pinned by hash, but only as a record of which text was read — not as a machine-checked
source of the numbers.

**Evidence.** **Inherited** — from the Commission's workbook, with the gap explicitly labelled.

**Where.** `scripts/build-fa-package.py:67–92`, `236–245`;
`/private/tmp/cbam-gates/src/scripts/cbam-algos/cbam-app.ts:1216–1223`.

---

### A14 · A benchmark of exactly zero is a real published value, not a missing one

**Claim.** Where the Annex publishes 0 as a benchmark, the tool stores and applies the zero. It does
not treat it as a gap.

**Citation.** IR (EU) 2025/2620 Annex. The code's example: "a cement grinder's Column A process
benchmark is 0, because the carbon sits upstream in the clinker."

**Behaviour.** Benchmarks may be zero; default *values* may not (see D6 — a deliberate asymmetry).

**Alternative.** Not documented.

**If wrong.** Would over-charge grinders and similar operations, whose entire deduction is that
zero — though in the direction of correctness, since the zero *is* the deduction.

**Evidence.** Inferred.

**Where.** `lib/regulatory/rule-package-contract.ts:108–110`.

---

### A15 · A line whose declared emissions are electricity emissions gets no certificate estimate at all

**Claim.** If the emissions figure being priced is an *indirect* (electricity) figure rather than a
process figure, the tool refuses to produce an estimate rather than deducting a process benchmark
from it.

**Citation.** IR (EU) 2025/2620 Annex — benchmarks are direct-emission benchmarks.

**Behaviour.** Immediate refusal, with wording naming the reason.

**Alternative.** Not documented as a rejected reading.

**If wrong.** No financial error — a refusal. But if such lines should be priceable, they are not
being priced.

**Evidence.** Inferred.

**Where.** `lib/cbam/certificate-estimate.ts:168–172`, `428–430`.

---

# B · Directive 2003/87/EC Art 10a(1a) — the CBAM factor

*Six citations in non-test code. **This is the single highest-leverage assumption in the tool.***

---

### B1 · The CBAM factor is the share of free allocation *retained* — 97.5% in 2026 — not the share phased out

**Claim.** The percentage that Art 10a(1a) attaches to each year is read as *how much free
allocation still applies*. In 2026 that is **0.975**. It is not read as the complement — the 2.5%
that has been withdrawn.

**Citation.** Dir 2003/87/EC **Art 10a(1a), third subparagraph** ("97.5% in 2026 falling to 0% in
2034").

**Behaviour.** The deduction is multiplied by 0.975 for a 2026 import. Worked line: free allocation
= 0.975 × 0.666 × 1,000 = **649.35 tCO₂e**, chargeable 879.65, bill **€66,290.42**.

**Alternative.** **Documented, quantified, and attributed.** "Trade press and at least one
competitor publish the complement (2.5% in 2026) under the same name; coding that inversion deducts
0.025×BM instead of 0.975×BM and over-charges an importer by **~39×**." Worked on the same line: the
deduction falls from 649.35 to **16.65 tCO₂e** — exactly 39× smaller — chargeable rises to 1,512.35,
and the bill rises to **€113,970.70**, an over-charge of **€47,680** on a single 1,000 t
consignment, +71.9%.

The code additionally hard-blocks the inversion at the data-contract layer: a factor above 1 is
rejected on load, with the comment naming "the ~39× inversion the trade press prints".

**If wrong.** **Over-charge by roughly 39× the deduction in 2026**, tapering as the schedule runs
down. This is the largest single error available in the tool.

**Evidence.** **Quoted**, and independently corroborated: "Corroborated 2026-07-13 against two
national authorities (climat.be, DEHSt)."

**Where.** `scripts/build-fa-package.py:151–158`; `lib/cbam/types.ts:31`;
`lib/regulatory/rule-package-contract.ts:121–134`.

---

### B2 · The nine scheduled values are pinned constants, hand-authored, not read from any machine source

**Claim.** The year-by-year schedule (2026: 0.975 · 2027: 0.95 · 2028: 0.90 · 2029: 0.775 ·
2030: 0.515 · 2031: 0.39 · 2032: 0.265 · 2033: 0.14 · 2034: 0) is typed into the build script by
hand. Nothing parses them out of the Directive.

**Citation.** Dir 2003/87/EC Art 10a(1a).

**Behaviour.** Nine rows, each carrying a locator reading "Dir 2003/87/EC Art 10a(1a): free
allocation retained in {year}". The source entry for the Directive carries a **SHA-256 of all
zeros** — no document artefact is pinned.

**Alternative.** Not documented.

**If wrong.** A transcription error in any single year misprices every import in that year, in
proportion. A 0.90 typed as 0.09 in 2028 would over-charge tenfold on the deduction.

**Evidence.** **Quoted** for the reading, **Assumed** for the artefact — the values are corroborated
against two national authorities but no primary document is hashed.

**Where.** `scripts/build-fa-package.py:94–101` (source, zero hash), `155–158` (values).

---

### B3 · The schedule ends at 2034 and the tool does not extrapolate past it

**Claim.** After 2034 the free allocation is zero and the schedule simply stops. The tool refuses a
year it has no row for rather than continuing the trend or holding the last value.

**Citation.** Dir 2003/87/EC Art 10a(1a).

**Behaviour.** A 2035 import refuses with wording naming the schedule as the gap.

**Alternative.** Documented, with the direction worked out arithmetically rather than guessed:
carrying on without a factor "is arithmetically identical to a factor of 1 — and 1 exceeds every
value the schedule ever takes", so guessing would deduct more free allocation than any scheduled
year grants and **undercharge**.

**If wrong.** No financial error — a refusal. Post-2034 imports are simply not priced.

**Evidence.** Inferred.

**Where.** `lib/cbam/resolve-fa.ts:107–123`; `lib/cbam/certificate-estimate.ts:355–375`.

---

# C · Delegated Regulation (EU) 2019/331 Art 14(6) — the cross-sectoral correction factor

*Four citations in non-test code. This factor is **unpublished for 2026–2030**, which means roughly
94% of real answers the tool gives are labelled what-ifs.*

---

### C1 · An unpublished correction factor means no final figure exists — the tool shows a labelled what-if, never a number presented as settled

**Claim.** Because the Commission has not published the cross-sectoral correction factor for
2026–2030, no final CBAM figure can exist for those years. The tool says so on the figure itself
rather than quietly producing a number.

**Citation.** DR (EU) 2019/331 **Art 14(6)**. Locator: "no CSCF published for 2026-2030 as at
2026-07-14".

**Behaviour.** A distinct status (`cscf_pending`) with no final value anywhere in it; the interface
tags the card "What-if · CSCF for {year} unpublished" and the summed total inherits the label. All
five years 2026–2030 are seeded pending with a null value.

**Alternative.** Not documented as a rejected legal reading — but see C2, which *is* the rejected
alternative in practice.

**If wrong.** If a factor has in fact been published, every figure the tool shows is unnecessarily
hedged. No arithmetic error.

**Evidence.** **Quoted** — the article is cited and the publication state is dated.

**Where.** `lib/cbam/resolve-fa.ts:125–159`; `lib/cbam/types.ts:69–79`;
`scripts/build-fa-package.py:160–163`.

---

### C2 · Silence about the correction factor is never read as 1.0

**Claim.** An absent correction factor is not treated as "no correction". The tool distinguishes
three states: *published* (use the value), *pending* (labelled what-if), and *not modelled at all*
(refuse). It never substitutes 1.0 for silence.

**Citation.** DR (EU) 2019/331 Art 14(6).

**Behaviour.** Enforced structurally rather than by convention: the "pending" result carries no
value field at all, so the compiler refuses any code that reads one without first handling the
pending case. A row claiming "published" but carrying no value is also refused.

**Alternative.** Documented and named as the tempting error: "it was 1.0 for 2021-25, which is
exactly what makes 'just assume 1.0' the seductive wrong default."

**If wrong.** As coded, refusals rather than errors. The rejected alternative would deduct free
allocation uncorrected and **undercharge** — the code's own wording.

**Evidence.** Inferred.

**Where.** `lib/cbam/resolve-fa.ts:125–159`; `lib/cbam/types.ts:69–79`;
`lib/cbam/certificate-estimate.ts:377–402`.

---

### C3 · The what-if is run at a correction factor of 1.0, the last value the Commission actually set

**Claim.** Where no factor is published, the tool shows what the figure *would* be at the factor
that applied to 2021–25, namely 1.0, and labels it as an assumption on the face of the figure.

**Citation.** DR (EU) 2019/331 Art 14(6); the 2021–25 value.

**Behaviour.** The assumed factor is carried in the result and printed in the card text and in the
printed document's §4, not hidden in a tooltip.

**Alternative.** Not documented — no other reference value is discussed.

**If wrong.** Every 2026–2030 figure moves in proportion to the true factor. If the real factor is
0.90, every deduction is 10% smaller than shown and every bill is correspondingly larger.

**Evidence.** Inferred.

**Where.** `lib/cbam/sefa.ts:32–33`, `215–226`.

---

### C4 · The tool tells users that 1.0 is *the largest the factor can legally be*, so every figure it shows is a floor

**Claim.** Both on screen and in the printed document, the tool states that the correction factor
"only ever reduces the free allocation that offsets a bill — it can subtract, never add", that 1.0
is "the largest the factor can legally be", and therefore that **the real bill cannot be lower than
the figure shown, and may be higher.**

**Citation.** None. No article is cited for the proposition that the factor cannot exceed 1.

**Behaviour.** Printed verbatim in the card body and in §4 of the audit document handed to
auditors and counterparties.

**Alternative.** Not documented.

**If wrong.** **This is a legal claim made to users with no cited basis.** If the factor can exceed
1, the "floor" statement is false in the direction that matters: figures shown could be *higher*
than the real bill, and a user has been told the opposite. No arithmetic changes — the reputational
and reliance exposure is the whole of it.

**Evidence.** **Assumed — no source cited.** This is the most consequential undocumented claim in
the register.

**Where.** `/private/tmp/cbam-gates/src/scripts/cbam-algos/cbam-app.ts:589–595` (card),
`1230–1235` (printed document).

---

# D · IR (EU) 2025/2621 — the default values

*Seven citations in non-test code. This is where the emissions number comes from when the importer
has no verified data — 41,100 published values across 574 goods and 120 origins.*

---

### D1 · The mark-up applies to the *total* emissions figure, not to the direct component alone

**Claim.** The percentage the Commission adds to a default value is applied to the good's total
(direct + indirect) emissions, not to its process emissions alone.

**Citation.** IR (EU) 2025/2621 Annex I; verified against the Commission workbook's own marked-up
columns.

**Behaviour.** **This is proven, not assumed.** Every one of the workbook's 32,793 marked-up cells
is recomputed as `total × (1 + markup/100)` and compared to the Commission's own stated value to
within 1e-9. A mismatch aborts the build naming the row. The code calls this "THE PROOF".

**Alternative.** Documented as the thing being disproven: the build fails with "The mark-up does
not apply to the total as assumed" if the check ever breaks, and explicitly forbids widening the
tolerance to make it pass.

**If wrong.** The check would have caught it. This is the best-evidenced assumption in the register.

**Evidence.** **Inherited**, and machine-verified against the Commission's own arithmetic on every
cell.

**Where.** `scripts/build-dv-package.py:32–40`, `367–401`.

---

### D2 · Fertilisers carry a 1% mark-up in all three years, not the 10/20/30% every other sector steps through

**Claim.** Cement, hydrogen, aluminium and iron & steel step 10% → 20% → 30% across 2026/2027/2028.
Fertilisers stay at **1% in all three years**. The tool treats this asymmetry as real regulation,
not as a typo to be tidied.

**Citation.** IR (EU) 2025/2621 Annex I, mark-up by sector and year.

**Behaviour.** Pinned per sector as a constant. Every non-blank mark-up header cell in the workbook
is checked against the pinned table, and a disagreement aborts the build with: "Either the
regulation changed or EXPECTED_SECTOR_MARKUPS is wrong — **do not 'fix' this by trusting the
cell**." Verified across the shipped pack: of 41,100 default factors, **14,496 carry the 1% band**
and 8,868 each carry 10%, 20% and 30%.

**Alternative.** **Documented and attributed:** "This is a real regulatory asymmetry that is easy to
'tidy' into 10/20/30; **a competitor did exactly that**."

**If wrong.** Tidying fertilisers to 10/20/30 would **over-charge fertiliser importers by up to 29
percentage points of intensity** in 2028 (1.30× instead of 1.01×, a 28.7% over-charge) across a
third of the entire default-value corpus.

**Evidence.** **Inherited**, cross-checked against every header cell in the workbook.

**Where.** `scripts/build-dv-package.py:64–68`, `129–141`, `306–324`.

---

### D3 · The mark-up steps linearly, and where the Commission's own spreadsheet compounds it, the tool publishes the linear value instead

**Claim.** A "20% mark-up" means ×1.20, not ×1.10 twice. Five rows in the Commission's workbook
(Angola and Argentina cement) carry a dragged formula that compounds — ×1.1, ×1.21, ×1.331. The tool
publishes ×1.1, ×1.2, ×1.3 for those rows and records the divergence.

**Citation.** IR (EU) 2025/2621 Annex I; the sector header cells reading "20% mark-up" / "30%
mark-up".

**Behaviour.** The five rows are pinned by (sheet, CN, description). A sixth such row aborts the
run. Ten cells across the five rows are affected. Rationale: "the header cells say '20% mark-up' and
'30% mark-up', so linear is what the regulation means; compounding would make 2028 a 33.1%
mark-up."

**Alternative.** Documented — the alternative is to publish the workbook's own printed figure. The
code's stance: "We publish the REGULATION's arithmetic, not the spreadsheet's."

**If wrong.** Under-charge of 3.1 percentage points of intensity in 2028 on five cement rows from
two origins. Small in absolute exposure; significant as a stance — **the tool is knowingly
disagreeing with a published Commission number.**

**Evidence.** **Inherited**, with the disagreement documented and printed on every build.

**Where.** `scripts/build-dv-package.py:42–62`, `218–229`, `383–390`.

---

### D4 · An importer's own verified figure carries no mark-up

**Claim.** The mark-up exists to price *not having data*. An importer who supplies audited emissions
gets that mark-up removed — the code calls it "the regulation's designed reward for having it".

**Citation.** IR (EU) 2025/2621 — by implication of what the mark-up is for. No article quoted.

**Behaviour.** A verified figure is multiplied by mass and used directly; the corpus is never
consulted for it.

**Alternative.** Not documented.

**If wrong.** **Under-charge** by the full mark-up on every verified line — 10% to 30% of the
emissions figure depending on sector and year. The tool tells the user plainly that this figure is
"your own attested claim … this tool has not confirmed it".

**Evidence.** Inferred.

**Where.** `lib/estimator/estimate-from-pack.ts:86–98`, `484–508`.

---

### D5 · The mark-up is removed per *figure*, not per line — an importer who attests only their process emissions still pays the marked-up default for electricity

**Claim.** Attesting the process figure earns the mark-up's removal from the process figure "and
nowhere else". If the importer leaves electricity unattested, the Commission's published electricity
default stands in — **with its mark-up intact**.

**Citation.** IR (EU) 2025/2621.

**Behaviour.** Such a line gets its own data tier, spelled out rather than called "mixed": *Verified
direct + Commission indirect*. It appears verbatim in the export an auditor reads, and the on-screen
attestation paragraph is rewritten for it — the fully-attested wording "would tell an importer their
audited figure is a world average" and is refused.

**Alternative.** Documented and rejected. The earlier behaviour priced the unattested electricity
component **at zero**, which the code calls "a silent under-charge on a page whose governing rule is
fail-closed."

**If wrong.** If a partial attestation should exempt the whole line, this over-charges by the
electricity component plus its mark-up. If it should not, the earlier zero-pricing under-charged by
the whole component.

**Evidence.** Inferred.

**Where.** `lib/estimator/estimate-from-pack.ts:520–560`;
`/private/tmp/cbam-gates/src/scripts/cbam-algos/cbam-app.ts:643–672`.

---

### D6 · A default value the Commission published as *zero* is dropped, and where the direct value is zero the good gets no default at all

**Claim.** A published zero is a real regulatory statement, but the tool's data contract requires a
positive intensity. So zero-valued components are dropped and reported, never silently replaced —
and a good whose *direct* value is zero (Mali hydrogen) yields no default factor at all and fails
closed.

**Citation.** IR (EU) 2025/2621 Annex I. **36 cells affected: 33 indirect clinker, 3 Mali hydrogen
direct.**

**Behaviour.** Each dropped cell is printed by name on every build. The rationale: "a stored factor
asserts a positive intensity; a zero would multiply out to a zero adjustment the engine should reach
by the **absence** of a factor, not by a stored zero."

**Alternative.** Not documented as a regulatory alternative — the constraint is stated as one the
build is "not permitted to relax". Note the deliberate asymmetry with A14: **benchmarks may be zero,
default values may not.**

**If wrong.** For the 33 indirect clinker cells: an importer who should be charged nothing for
electricity instead gets no indirect component at all — which is the same answer. For Mali hydrogen:
a good the Commission *did* price (at zero) is refused entirely rather than priced at zero. That is a
refusal where the regulation gave an answer.

**Evidence.** **Inherited** — the zeros are read from the workbook and reported, but the decision to
drop them is a contract decision, not a regulatory one.

**Where.** `scripts/build-dv-package.py:424–436`, `527–534`;
`lib/regulatory/rule-package-contract.ts:63–65`.

---

### D7 · A cell the Commission left blank, dashed or marked "N/A" means no published value — the tool never invents one

**Claim.** Where the direct or total emissions cell is empty, a dash, an underscore, or "not
applicable", the tool reads that as the Commission declining to publish and emits no factor. "Not
applicable" is spelled four different ways in the workbook (`N/A` — 8,527 cells — plus the typos
`N.A.`, `N/a` and `N/(A`); all four are folded together deliberately, "so a stray keystroke cannot
smuggle a good's indirect emissions into the corpus as an unparsable value."

**Citation.** IR (EU) 2025/2621 Annex I.

**Behaviour.** Row skipped. Deliberately **not** treated as no-data: Excel's `#VALUE!` error (4
cells), so that if a reissue ever lands one on a live row the build aborts loudly "instead of
quietly treating a broken formula as 'no data'".

**Alternative.** Not documented.

**If wrong.** Refusals where a value exists. The `#VALUE!` decision is the interesting one: it
converts a silent gap into a loud build failure, which is a stance choice rather than a legal one.

**Evidence.** **Inherited**.

**Where.** `scripts/build-dv-package.py:143–164`, `332–339`.

---

### D8 · A blank production-route column in the default-values workbook denotes the same concept as a blank route indicator in the benchmarks Annex

**Claim.** The two Commission documents spell "this good is route-independent" differently — the
default-values workbook leaves the column blank (or writes "N/A"), the benchmarks Annex uses an
empty route indicator. The tool asserts these mean the same thing and joins on that basis.

**Citation.** IR (EU) 2025/2621 (routes) joined to IR (EU) 2025/2620 (benchmarks).

**Behaviour.** Workbook blank → stored as the literal `'default'` → mapped back to `''` at benchmark
lookup. The code warns: "Both halves must agree; change neither without the other."

**Alternative.** Documented as the *reason for the mapping* (a data-contract rule forbids an empty
string), not as a rejected regulatory reading. The prior corpus stored the literal `'default'` for
**every** good including clinker, where the Commission actually publishes routes (A) for grey and
(B) for white — "a wrong route silently fails the join and the estimate falls back or errors."

**If wrong.** A route-independent good would join to the wrong benchmark or to none. For grey
Portland cement the difference between route-independent and a named route is the difference between
0.666 and no row at all.

**Evidence.** Inferred.

**Where.** `scripts/build-dv-package.py:20–30`, `350–354`;
`lib/estimator/estimate-from-pack.ts:114–117`.

---

### D9 · The mark-up is *verified* against the total column but *applied* to each component separately — and the two do not always agree

**Claim.** The mark-up percentage is proven correct against the Commission's marked-up **total**
(see D1). The engine then applies that same percentage to the direct and indirect components
individually. Because the Commission rounds the direct and indirect columns independently, their sum
does not always equal the published total — so the sum of the marked-up components does not always
equal the published marked-up total.

**Citation.** IR (EU) 2025/2621 Annex I.

**Behaviour.** The generator flags the rounding independence explicitly ("India 3102 10 90: 2 + 0.16
!= 2.17") and states "the total column is authoritative for the mark-up check; **we never reconstruct
it by addition**". But the *engine* then does exactly that: it prices direct and indirect separately
and adds them.

**Worked:** India CN 3102 10 90, 2026, 1% mark-up. Direct 2, indirect 0.16, published total 2.17.
Marked-up total = 2.17 × 1.01 = **2.1917**. The engine computes 2×1.01 + 0.16×1.01 = 2.02 + 0.1616 =
**2.1816**. Gap: 0.0101 tCO₂e/t, a **0.46% under-charge** on that row. **2,770 selectors in the 2026
pack carry both a direct and an indirect default**, so the mismatch is systematic, not exceptional.

**Alternative.** **Not documented.** The generator documents the rounding independence; nothing
documents the engine's component-wise application or reconciles the two.

**If wrong.** Sub-1% under-charge on any line priced with both components. Small, but it is a
divergence from the Commission's own published marked-up figure, and it is undocumented.

**Evidence.** **Assumed** for the component-wise application. The underlying rounding fact is
Inherited.

**Where.** `scripts/build-dv-package.py:38–40`; engine:
`lib/estimator/estimate-from-pack.ts:585–587` (direct), `386–398` (indirect).

---

### D10 · A country that has its own sheet but no value for a particular good is refused — it does **not** fall back to the world-average bucket

**Claim.** The Commission's "Other Countries and Territories" sheet prices *origins* it does not list
individually. It does not backfill *goods* that a listed origin's sheet omits. Where a listed origin
is silent about a good, that silence is deliberate and the tool refuses to price it.

**Citation.** IR (EU) 2025/2621 Annex I; the workbook's residual sheet.

**Behaviour.** Three-step precedence: (1) the declared country's own rows always win; (2) the
residual bucket answers **only** when the origin is a real assigned ISO alpha-2 code **and** has no
sheet of its own; (3) otherwise refuse.

**Alternative.** **Documented with two named consequences, both quantified:**
- "Mali hydrogen (the Commission published 0) would resolve to the world average 17.74 — **inventing
  19,514 tCO₂e on a 1,000 t line** out of a published zero."
- "Albania white clinker route (B), which Albania's sheet simply does not carry, would borrow a value
  the Commission never stated for Albania."

**If wrong.** Removing the gate **over-charges** — on Mali hydrogen, by 19,514 tCO₂e on a single
1,000 t line, which at €75.36 is roughly **€1.47 million**. Keeping the gate when the regulation
intends a fallback means refusing lines that should be priceable.

**Evidence.** Inferred, with the mechanism traced to how the workbook is built (the parser drops any
row the workbook marks N/A and any whose published value is zero).

**Where.** `lib/regulatory/resolve.ts:99–176`; `lib/estimator/estimate-from-pack.ts:138–154`.

---

### D11 · An origin code that is not a real ISO country code is refused, never given world-average values

**Claim.** A typo like `XX`, a user-assigned range, or a truncated field is an input error to be
surfaced — never an origin the Commission priced. Only genuinely assigned ISO 3166-1 alpha-2 codes
may reach the residual bucket.

**Citation.** ISO 3166-1 officially assigned alpha-2 codes. **No CBAM instrument is cited for this
step.**

**Behaviour.** A hand-maintained set of **249 codes** (verified by count), including territories and
dependencies (HK, MO, TW, PR) because "they are genuine trade origins with their own customs
identity, and several are individually listed in the Commission's workbook". The rationale: "a
misspelled origin that quietly produces a plausible number is the most expensive kind of wrong we can
ship."

**Alternative.** Not documented.

**If wrong.** A code the tool refuses but the Commission recognises returns no estimate. A code the
tool accepts but should not silently receives world-average values. The list carries **no version or
date**, and ISO reassigns codes.

**Evidence.** **Assumed** for currency — the standard is named, but no edition, date or machine
source is pinned.

**Where.** `lib/regulatory/iso-3166.ts:1–75`.

---

### D12 · Where the Commission publishes a default at heading level and also at 8-digit level, the most specific one governs

**Claim.** A CN code is covered by its own listing or by any shorter prefix the Commission published
at, and where both exist the deeper one wins.

**Citation.** IR (EU) 2025/2621 Annex I.

**Behaviour.** Deepest published scope only. The browser estimator and the server engine are held to
the same rule by a differential test — "a silent divergence would quote a user one figure in the form
and another on the case."

**Alternative.** Documented: requiring an exact match "would report 'no published default' for goods
the Commission does publish."

**If wrong.** Wrong-granularity matching would apply a heading-level average to a good with its own
published value. Direction depends on the good.

**Evidence.** Inferred.

**Where.** `lib/regulatory/resolve.ts:143–156`; `lib/estimator/estimate-from-pack.ts:179–201`.

---

### D13 · The electricity default is looked up by production route as well as by good and origin

**Claim.** Indirect (electricity) default values are route-specific where the Commission publishes
them that way, and the tool matches on the route rather than taking whichever row it finds first.

**Citation.** IR (EU) 2025/2621 Annex I.

**Behaviour.** **The counts are measured, not asserted:** 597 of the corpus's 8,310 indirect rows
carry a real route indicator ((A) 495, (B) 102). Those fall in 510 of 8,217 (good, origin, year)
groups, but **only 93 groups hold more than one row** and only there can the route decide anything.
In 90 of the 93 the value differs by route; in 3 both rows carry the same figure, so the route
corrects the provenance rather than the price. The code explicitly warns against the overstatement:
"Saying '510 groups are route-keyed' overstates the exposure."

**Alternative.** **Documented as a shipped defect that this replaced.** Without the route, the lookup
"returned whichever row sorted first — the dearer one, in every affected case — so a route-(A) line
was priced with route (B)'s electricity and over-charged. **On Algerian cement clinker that was
€165.79 per 100 t**, with the exported CSV naming route (A) beside route (B)'s figure — an audit
artefact naming one route and pricing another."

**If wrong.** Over-charge of up to €165.79 per 100 t on affected lines. Only 30 estimates change
end-to-end today because the pack prices 2026 quarters only; 60 further corrections are real but
latent.

**Evidence.** Inferred, with the corpus measured directly.

**Where.** `lib/estimator/estimate-from-pack.ts:301–354`.

---

### D14 · Where electricity defaults exist for a good but not for the declared route, the line is refused rather than priced with zero electricity

**Claim.** "The Commission publishes no indirect default for this good at all" and "rows exist but
not for your route" are different facts and get different answers. The first is silence; the second
is a refusal.

**Citation.** IR (EU) 2025/2621 Annex I.

**Behaviour.** Three distinct outcomes rather than two. Refusal wording: "Pricing the electricity
component at zero would understate the bill without saying so."

**Alternative.** Documented: collapsing the two "is exactly how the over-charge this replaces stayed
invisible — the lookup could not tell 'nothing published' from 'I picked the wrong row'."

**If wrong.** As coded, a refusal. The rejected alternative **under-charged** by the whole
electricity component.

**Evidence.** Inferred.

**Where.** `lib/estimator/estimate-from-pack.ts:286–299`, `346–351`.

---

### D15 · A good for which the Commission publishes no electricity default at all is priced with zero electricity, and stays fully verified

**Claim.** Iron & steel and aluminium have no published indirect defaults. For those, zero *is* the
published answer — so the line is priced with no electricity component and is **not** stamped as
partly Commission-priced.

**Citation.** IR (EU) 2025/2621 Annex I.

**Behaviour.** The mixed data tier is stamped **only** where a default actually stood in. "Claiming a
default was applied there would tell an auditor to go looking for one that does not exist."

**Alternative.** Not documented.

**If wrong.** If those sectors do attract an electricity charge, this **under-charges** by the whole
component on every iron & steel and aluminium line.

**Evidence.** Inferred.

**Where.** `lib/estimator/estimate-from-pack.ts:547–557`.

---

### D16 · The set of goods the calculator prices comes from the Commission's default-values workbook, not from Annex I of the CBAM Regulation

**Claim.** Which goods are in scope is inherited from the coverage of the default-values workbook,
then expanded to the granularity at which benchmarks are published. It is not read from Annex I of
Reg (EU) 2023/956.

**Citation.** IR (EU) 2025/2621 Annex I (as the source of coverage); Reg (EU) 2023/956 Annex I is
the instrument that actually defines scope.

**Behaviour.** **574 classifications** in the shipped browser pack, expanded from the workbook's CN
codes to 8-digit benchmark granularity. A good with no finer benchmark passes through untouched —
"four aluminium-tableware codes today" have no benchmark at all and report unavailable. Nomenclature
year is pinned to **2026** with no source.

A separate research corpus that *does* work from Annex I exists but is superseded and feeds nothing
shipped. Its own notes record that Reg (EU) 2025/2083 (which amends Annex I) "was **NOT** fetched as
a standalone document" and that "the precise, full scope of 2025/2083's Annex changes beyond those
two visible edits was not independently verified."

**Alternative.** Not documented as a choice — the substitution is a consequence of how the corpus was
built.

**If wrong.** A good in Annex I but absent from the workbook is silently not offered; a good in the
workbook but out of Annex I scope would be priced. **Nobody has diffed the two lists.**

**Evidence.** **Assumed** for the equivalence of the two scopes; **Inherited** for the coverage
itself. The pinned nomenclature year of 2026 has no source at all.

**Where.** `scripts/build-dv-package.py:90`, `403–412`;
`scripts/build-estimator-pack.mts:57–78`; `golden/research/cbam-cn-codes.json` (superseded).

---

### D17 · An explicit exclusion beats a broader covered heading

**Claim.** If the corpus excludes CN 7202 30 00 while covering heading 7202, the exclusion is the more
specific statement about that good and it wins. An excluded good is refused, not calculated.

**Citation.** Reg (EU) 2023/956 Annex I.

**Behaviour.** Exclusions are kept in the candidate set through prefix matching and filtered only at
the end, so an exclusion can shadow a heading above it.

**Alternative.** **Documented and rejected:** filtering exclusions out before prefix matching (the
earlier version) would have let "an out-of-scope good become calculable, approvable, and **frozen
into the ledger**."

**If wrong.** Over-charge on goods outside scope, and — worse — a permanent record asserting a
liability that does not exist.

**Evidence.** Inferred.

**Where.** `lib/regulatory/resolve.ts:52–86`.

---

### D18 · Country sheet names are mapped to ISO codes by hand, and an unrecognised sheet stops the build

**Claim.** The workbook's 120 sheets are identified as countries by a hand-authored name→code map.
Several names are truncated by Excel's 31-character limit or use non-standard spellings; each is
called out. Any sheet not in the map aborts the build "rather than being guessed at".

**Citation.** IR (EU) 2025/2621 Annex I, per-country sheets.

**Behaviour.** 120 sheets expected; a count change aborts. Judgement calls are annotated in place —
`"Congo": "CG"` marked "Republic of the Congo (Brazzaville)"; `"Democratic Republic of the Cong"`
marked as truncated, → `CD`.

**Alternative.** Not documented.

**If wrong.** A mis-mapped sheet applies one country's published values to another. On the
Congo/DR-Congo pair this is a live risk and the code knows it. Direction and magnitude depend on the
pair.

**Evidence.** **Assumed** — the mapping is a hand judgement with no external source cited.

**Where.** `scripts/build-dv-package.py:177–213`, `279–282`.

---

# E · Regulation (EU) 2023/956 — the CBAM Regulation

*Nine citations in non-test code.*

---

### E1 · The de minimis threshold is 50 tonnes per importer per calendar year, and a consignment of **exactly** 50 t is below it

**Claim.** Art 2(3) exempts imports "not exceeding" the threshold, so the comparison is strictly
greater-than. 50.0 t is exempt; 50.01 t is not.

**Citation.** Reg (EU) 2023/956 **Art 2(3)**. The site's on-screen copy adds "as amended by Reg (EU)
2025/2083".

**Behaviour.** Strict `>`. Threshold value **50 t**, sectors **cement, aluminium, fertilisers, iron &
steel**, one row, calendar year 2026 only.

**Alternative.** Documented in the data contract: the "not exceeding" wording is quoted as the reason
the comparison is strict.

**If wrong.** A `>=` comparison would declare a 50.0 t importer liable when they are exempt — a
**whole-liability switch**, not a proportional error. That is the single largest binary outcome in
the tool.

**Evidence.** **Quoted** for the strictness. **Assumed** for the amending act: Reg (EU) 2025/2083 is
named in the on-screen and printed wording but appears **nowhere in the shipped rule data**, whose
locator reads only "Regulation (EU) 2023/956 Article 2(3)" — and the project's own research notes say
2025/2083 was never fetched as a standalone document.

**Where.** `lib/threshold/evaluate.ts:11–12`; `lib/regulatory/rule-package-contract.ts:182–198`;
`scripts/build-fa-package.py:132–149`;
`/private/tmp/cbam-gates/src/scripts/cbam-algos/cbam-app.ts:200–209`.

---

### E2 · Hydrogen and electricity are outside the 50 t exemption entirely

**Claim.** The threshold's four sectors do not include hydrogen or electricity. A hydrogen line is
therefore chargeable regardless of tonnage, and the tool shows **no threshold verdict at all** for it
rather than an "indeterminate" one that would imply an exemption it cannot have.

**Citation.** Reg (EU) 2023/956 Art 2(3); the on-screen copy attributes the exclusion to Reg (EU)
2025/2083.

**Behaviour.** Deliberate silence — no card. Pinned by a test named "hydrogen and electricity are
outside the exemption". Hydrogen (CN 2804 1000) is priceable from **93 origins** in the shipped pack;
electricity is not classified at all.

The multi-line verdict carries a specific correction: a below-threshold year now names how many lines
were outside the test. **Measured:** "40 t cement + 1000 t hydrogen rendered 'owes nothing for 2026'
beside **€525,302.23**" — the hydrogen line alone being €523,015.36 — "on the same page."

**Alternative.** Not documented as a regulatory alternative; the *presentation* alternative (a
generalised "you owe nothing") is documented as the defect this fixed.

**If wrong.** If hydrogen is in fact within the exemption, hydrogen importers are told they owe money
they may not.

**Evidence.** Inferred for the exclusion; **Assumed** for attributing it to 2025/2083 (see E1).

**Where.** `/private/tmp/cbam-gates/src/scripts/cbam-algos/cbam-app.ts:371–380`, `424–428`;
`lib/estimator/estimate-from-pack.ts:248–284`.

---

### E3 · A single consignment can prove you are *above* the threshold but never that you are below it

**Claim.** The threshold is annual and per importer. One line above 50 t settles the question. One
line below it settles nothing, because the tool cannot see the rest of the year. The honest answer is
"indeterminate", never "exempt".

**Citation.** Reg (EU) 2023/956 Art 2(3).

**Behaviour.** Single-line completeness is hard-coded to *partial*, which can only yield "above" or
"indeterminate". "Below threshold" is reachable **only** when the user ticks a box attesting that the
listed lines are all their imports for that year — and the verdict then says on every surface that it
rests on their statement: "it is your completeness claim, verified by no one, not by the Commission or
by us."

**Alternative.** Documented as the defect this exists to prevent: without the card at all, "the tool
quoted a four-figure cost to someone who may be exempt — an error in the most expensive direction."

**If wrong.** No error in the tool's own arithmetic. The exposure is that a below-threshold verdict is
only as good as the user's attestation, and the tool says so.

**Evidence.** Inferred.

**Where.** `lib/estimator/estimate-from-pack.ts:248–284`; `lib/threshold/evaluate.ts:13–18`;
`/private/tmp/cbam-gates/src/scripts/cbam-lines.ts:290–391`.

---

### E4 · The threshold is tested per calendar year and never summed across years

**Claim.** Each calendar year gets its own verdict. A 30 t 2026 import and a 30 t 2027 import are two
separate below-threshold years, not a 60 t above-threshold total.

**Citation.** Reg (EU) 2023/956 Art 2(3).

**Behaviour.** One card per year present in the line list. Rationale: summing "would report … a
liability that does not exist."

**Alternative.** Not documented.

**If wrong.** Summing would **over-charge** by declaring importers liable who are not.

**Evidence.** Inferred.

**Where.** `/private/tmp/cbam-gates/src/scripts/cbam-lines.ts:256–304`.

---

### E5 · "Shall apply from 1 January 2026" is a calendar day, not an instant

**Claim.** Validity windows are compared at day granularity, not by timestamp, because the regulation
sets a day.

**Citation.** Reg (EU) 2023/956 **Art 36(3)**.

**Behaviour.** Both sides of every validity comparison are truncated to `YYYY-MM-DD`. Two independent
copies of this rule exist (one for classification, one for benchmarks) and are deliberately **not**
deduplicated; each carries a note pointing at the other.

**Alternative.** Documented as a shipped bug this fixed: comparing raw strings "silently saved the
validTo edge and silently broke the validFrom edge — a window's opening day sorted **after** its own
bound and dropped out, **so 1 January 2026 refused every good** with a message asserting the rule did
not exist."

**If wrong.** Total refusal on boundary days, across the whole catalogue — the classification copy
gates the entire rule package. Not a mispricing; a total outage on the regime's first day.

**Evidence.** **Quoted** — the article and its operative words are cited.

**Where.** `lib/regulatory/resolve.ts:10–39`; `lib/cbam/resolve-fa.ts:19–49`.

---

### E6 · No credit is given for a carbon price already paid in the country of origin

**Claim.** Art 9 allows a deduction for carbon already paid at origin. The implementing act is still a
draft, so the tool does not model it — and says so on **every** figure it produces.

**Citation.** Reg (EU) 2023/956 Art 9.

**Behaviour.** A note is attached to every priced estimate: "Art 9 deduction for a carbon price paid
in the country of origin is not modelled (the implementing act is still a draft), so this figure is
**conservative**." Repeated in §4 of the printed document. A test asserts the note is always present.

**Alternative.** Not documented — no attempt at modelling it is discussed.

**If wrong.** **Over-charge**, by the whole of any carbon price paid at origin. For an importer from a
jurisdiction with a meaningful carbon price this can be a large fraction of the bill. The tool is
knowingly and openly high.

**Evidence.** **Quoted** for the existence of the deduction; the omission is disclosed rather than
hidden.

**Where.** `lib/cbam/certificate-estimate.ts:27–29`, `490`;
`/private/tmp/cbam-gates/src/scripts/cbam-algos/cbam-app.ts:1236–1237`.

---

### E7 · A good's CBAM sector is decided by its 4-digit heading, with chapters 72/73 and 76 handled at chapter level

**Claim.** The sector grouping the threshold is expressed in is derived from the CN heading, not the
chapter — because chapter 28 alone spans two sectors (2804 10 is hydrogen; 2808/2814/2834 are
fertilisers). Chapters 72, 73 and 76 are treated at chapter level because they are unambiguous.

**Citation.** Reg (EU) 2023/956 Annex I sector headings. **No article or annex row is cited for the
mapping itself.**

**Behaviour.** Ten headings mapped by hand (2507, 2523 → cement; 2601 → iron & steel; 2804 →
hydrogen; 2808, 2814, 2834, 3102, 3105 → fertilisers; 2716 → electricity), plus chapters 72/73 → iron
& steel and 76 → aluminium. Anything unlisted returns no sector, which makes the threshold
**indeterminate, never exempt** — "being unable to classify a good is not evidence that it falls below
a threshold."

**Alternative.** Documented for the granularity choice: "A chapter-level map would file ammonia under
hydrogen and silently apply the wrong sector's threshold."

**If wrong.** A good in the wrong sector is tested against the wrong threshold, or excluded from a
mass basis it belongs in. On the shipped pack every one of the 574 offered goods maps to a sector, so
the "unlisted" path is currently unreachable.

**Evidence.** **Assumed** — the reasoning for the granularity is documented; the mapping itself
carries no source locator.

**Where.** `lib/cbam/sector.ts:1–46`.

---

### E8 · A second, independent list of "sectors measured by mass" exists inside the aggregation and carries no citation at all

**Claim.** The mass aggregation filters entries against its own hard-coded set of four sectors
(cement, aluminium, fertilisers, iron & steel), separate from the sector list published in the
threshold rule row.

**Citation.** **None. No comment, no locator, nothing.**

**Behaviour.** Two filters run in series: the caller's, on the threshold row's published
`includedSectors`; and this one, hard-coded. The site's own code flags the risk: they "agree today
only because the shipped 2026 row's includedSectors happens to equal massSectors. **If a future
threshold row ever includes electricity or hydrogen, a line could pass ours and still be dropped by
the vendored one.**"

**Alternative.** Not documented.

**If wrong.** The day the Commission widens the threshold's sector list, the published row will say
one thing and the arithmetic will do another — silently. Direction: **under-count of eligible mass**,
therefore a spurious below-threshold verdict, therefore an importer told they are exempt when they are
not.

**Evidence.** **Assumed — no source cited, and no comment either.** The only acknowledgement anywhere
is a warning in a different repository's file.

**Where.** `lib/threshold/aggregate.ts:41–46`;
`/private/tmp/cbam-gates/src/scripts/cbam-lines.ts:197–206`.

---

# F · Certificate price and the shape of the money

---

### F1 · The certificate price is a quarterly figure, and an unpublished quarter yields no cost rather than a zero

**Claim.** CBAM certificate prices are published per quarter, in arrears. Where the quarter an import
falls in has no published price, the tool shows the certificate count but **no euro figure at all**.

**Citation.** EC "Price of CBAM certificates" page. Legal status recorded as **guidance**, not
enacted.

**Behaviour.** Q1 2026 **€75.36** (published 7 Apr 2026) and Q2 2026 **€75.28** (published 6 Jul 2026)
are published; Q3 and Q4 2026 are pending. **The pack prices 2026 quarters only** — every 2027 and
2028 import refuses on the price. The code's sweep: **7,680 of 17,484 estimates** refuse on the
certificate price, every one of them 2027 or 2028.

**Alternative.** Not documented as a regulatory reading. The *presentation* alternative is documented
at length — an earlier version reported a missing price as a missing benchmark, "sending the reader to
hunt a benchmark that is present."

**If wrong.** No mispricing. But roughly 44% of the estimate space the calculator offers returns no
euro figure, which is a product limitation rather than a compliance one.

**Evidence.** **Inherited** — transcribed from an HTML page with **no stable artefact and a SHA-256 of
all zeros**. The two published prices are hand-typed.

**Where.** `scripts/build-fa-package.py:111–119`, `165–171`; `lib/cbam/resolve-fa.ts:182–203`.

---

### F2 · The import date decides which quarter's price applies

**Claim.** The quarter is derived from the import date's month. A date the tool cannot read is refused
with a reason naming **the date**, not a missing table.

**Citation.** Implicit in the quarterly publication cadence; no article cited.

**Behaviour.** Month 1–3 → Q1, and so on. A month outside 1–12 or a non-four-digit year refuses. The
refusal is deliberately scoped to the *price*: an earlier draft claimed the benchmark in force also
depends on the quarter, which the code corrects — "the quarter is the price's key and nothing else's".

**Alternative.** Documented as a bug this fixed: `'2027-1-15'` produced the string `'2027-QNaN'`,
which matched no price row and surfaced as "the good and its benchmark are present, only the price is
missing — **every clause false for a date nobody can read**."

**If wrong.** Wrong-quarter pricing. Between Q1 and Q2 2026 that is 8 cents per certificate — a 0.1%
error. Between distant quarters it could be material.

**Evidence.** **Assumed** — no instrument is cited for the date→quarter rule.

**Where.** `lib/cbam/resolve-fa.ts:161–180`; `lib/cbam/certificate-estimate.ts:333–353`.

---

### F3 · Certificate rounding is not settled in law, so the tool shows decimal certificate-equivalents and invents no rounding rule

**Claim.** How many certificates a fractional tonnage requires is an open question. Rather than round,
the tool reports the exact decimal and says on every figure that it has done so.

**Citation.** None — recorded as an open question.

**Behaviour.** A note on every priced estimate: "Certificate rounding is not settled in law; decimal
certificate-equivalents are shown." Formatting is chosen so a tiny residual prints as `0.0000001`
rather than `1e-7`.

**Alternative.** Not documented — rounding up (the conservative reading) is not discussed.

**If wrong.** If certificates must be surrendered in whole units, every figure is understated by up to
one certificate — **€75.36 per line**. Immaterial on a 1,000 t consignment; material on a portfolio of
many small ones.

**Evidence.** **Assumed** — explicitly and deliberately, as a disclosed open question.

**Where.** `lib/cbam/certificate-estimate.ts:193–196`, `491`.

---

# G · Cross-cutting stance

---

### G1 · Two rules where there should be one is a refusal, never a first match

**Claim.** Wherever the published data yields more than one candidate value for a lookup, the tool
shows no figure and says the conflict must be resolved. It never picks one.

**Citation.** None — a stance, applied across every lookup.

**Behaviour.** Uniform across benchmarks, factors, correction factors, prices, classifications and
default values. Wording: "The published rules give more than one value for this good, so no figure is
shown until the conflict is resolved."

The build scripts enforce the same rule upstream: a duplicate benchmark selector or a duplicate
default-factor selector aborts the build rather than shipping data that would be ambiguous at lookup.

**Alternative.** Not documented — the alternative (first match wins) is treated as self-evidently
wrong.

**If wrong.** Refusals rather than errors.

**Evidence.** Inferred.

**Where.** `lib/cbam/resolve-fa.ts:99–103`, `116–120`, `136–138`, `190–192`;
`lib/regulatory/resolve.ts:80–84`, `170–174`; `lib/cbam/certificate-estimate.ts:404–406`.

---

### G2 · A rule package that is not enacted, or not in force on the import date, refuses **every** good

**Claim.** Before any lookup runs, the tool checks that the rule package is legally enacted and in
force on the import date. If not, nothing is priced at all.

**Citation.** Reg (EU) 2023/956 Art 36(3) via the validity window.

**Behaviour.** Gates the whole package, not a row. The shipped free-allocation package is `enacted`,
valid from 2026-01-01 with no end date.

**Alternative.** Not documented.

**If wrong.** Total refusal rather than mispricing — but total.

**Evidence.** Inferred.

**Where.** `lib/regulatory/resolve.ts:41–45`.

---

### G3 · Every figure is stamped provisional, on every branch, including refusals

**Claim.** No figure the calculator produces is ever presented as final. The provisional flag is set
unconditionally.

**Citation.** None — a stance.

**Behaviour.** `provisional: true` on every estimate. The interface renders "Provisional — at least
one input is not final". Combined with C1 (correction factor unpublished for 2026–2030) and E6 (Art 9
not modelled), the tool never claims a settled number.

**Alternative.** Not documented.

**If wrong.** No error. If anything, over-cautious.

**Evidence.** Inferred.

**Where.** `lib/cbam/certificate-estimate.ts:124`, `216`.

---

# Ranked by leverage

*Direction matters as much as magnitude. Over-charging creates a commercial and reputational problem —
customers who overpay, or who catch the error and leave. Under-charging creates a compliance problem —
customers who file short and face a penalty they will attribute to us.*

## Tier 1 — get these wrong and the number is wrong by multiples

| # | Assumption | Direction if wrong | Magnitude | Evidence |
|---|---|---|---|---|
| **1** | **B1** · CBAM factor is allocation *retained* (0.975), not the phase-out complement (0.025) | **Over-charge** | **~39×** the deduction. On one 1,000 t clinker line: €66,290 → €113,971 | Quoted + corroborated ×2 |
| **2** | **A2** · Benchmark column decided by scope of the emissions figure | **Over-charge** | Severalfold; **total loss of deduction** where Column A is 0. Worked: €66,290 → €115,225 | Inferred |
| **3** | **D2** · Fertilisers carry 1% mark-up, not 10/20/30% | **Over-charge** | Up to **+28.7%** of intensity in 2028, across **14,496 of 41,100** published values. A competitor got this wrong | Inherited, machine-checked |
| **4** | **D10** · A listed origin's silence about a good fails closed, no world-average fallback | **Over-charge** | Mali hydrogen: **19,514 tCO₂e invented on a 1,000 t line** ≈ **€1.47 m** | Inferred |
| **5** | **E1** · 50 t threshold, strict greater-than, four sectors | **Both — binary** | **Whole-liability switch.** Exactly 50 t is exempt or is not | Quoted (strictness); **Assumed** (amending act) |

## Tier 2 — wrong by a component, not a multiple

| # | Assumption | Direction if wrong | Magnitude | Evidence |
|---|---|---|---|---|
| **6** | **C4** · CSCF = 1.0 is "the largest legally possible", so figures are a floor | **Over-charge, and a stated legal claim** | Unquantified. Printed to users and auditors **with no source** | **Assumed** |
| **7** | **E6** · No Art 9 credit for carbon paid at origin | **Over-charge** | Whole of any origin carbon price. Disclosed on every figure | Quoted, disclosed |
| **8** | **A6** · Indirect emissions get no free allocation | **Over-charge** | Whole indirect component; ~3.5% on clinker, more on fertilisers | Inferred |
| **9** | **E2** · Hydrogen and electricity outside the 50 t exemption | **Over-charge** | Measured: a €525,302 bill once rendered beside "owes nothing for 2026" | Inferred |
| **10** | **D4/D5** · Verified figures drop the mark-up, per figure not per line | **Under-charge** | 10–30% of the emissions figure per attested half | Inferred |
| **11** | **E8** · A second, uncited sector list inside the mass aggregation | **Under-charge → false exemption** | Latent. Fires the day the Commission widens the sector list | **Assumed, no comment at all** |
| **12** | **A5** · Zero floor, applied to direct emissions only | **Over-charge** | Whole electricity component on a clean-process line | **Assumed** |

## Tier 3 — real, bounded, mostly disclosed

| # | Assumption | Direction if wrong | Magnitude | Evidence |
|---|---|---|---|---|
| **13** | **D13** · Electricity default keyed on route | Over-charge | €165.79 per 100 t on Algerian clinker; 30 live + 60 latent | Inferred, measured |
| **14** | **A10** · Annex (1)/(2) are validity windows | Either | 794 of 2,465 benchmark rows | Quoted (§5.3) |
| **15** | **D16** · Scope taken from the DV workbook, not Annex I | Either | Unmeasured — the two lists have **never been diffed** | **Assumed** |
| **16** | **D3** · Linear not compounding mark-up | Under-charge | 3.1 pp on 5 rows. Knowingly disagrees with a published Commission figure | Inherited |
| **17** | **D9** · Mark-up verified on the total, applied per component | Under-charge | ~0.46% on 2,770 dual-component selectors | **Assumed** |
| **18** | **E7** · Sector by 4-digit heading | Either | Currently unreachable — all 574 goods map | **Assumed** |
| **19** | **D18** · Hand-mapped country sheet names | Either | Congo / DR Congo is the live risk | **Assumed** |
| **20** | **F3** · Certificate rounding not settled | Under-charge | ≤ 1 certificate (€75.36) per line | **Assumed, disclosed** |
| **21** | **D11** · ISO 3166-1 list, 249 codes, no edition pinned | Either | Per-code | **Assumed** |
| **22** | **F2** · Import date → quarter | Either | €0.08/certificate between adjacent 2026 quarters | **Assumed** |

*The refusal-shaped assumptions — A3, A4, A11, A12, A15, B3, C1, C2, D6, D7, D14, G1, G2 — carry no
financial exposure if wrong. Their cost is coverage: **183 of 574 offered goods**, 181 of them iron and
steel, currently return no figure at all, and **7,680 of 17,484** estimates refuse on a missing 2027/28
certificate price.*

---

# Entries with no documented basis

*These are the ones to look at first, because there is nothing behind them to check.*

**Nine entries rest wholly on an assumption with no source cited anywhere:**

| Entry | What is unsupported | Why it matters |
|---|---|---|
| **C4** | That the correction factor cannot exceed 1, therefore every figure is a floor | **A legal claim printed to users and auditors.** No article cited |
| **E8** | The hard-coded four-sector mass filter | **No citation and no comment.** Silently diverges from the published row the day it widens |
| **A5** | The zero floor, and applying it to the direct side alone | Governs every clean-producer line |
| **D9** | Applying a total-verified mark-up per component | ~0.46% systematic under-charge on 2,770 selectors |
| **E7** | The heading→sector map itself (the *granularity* choice is documented; the mapping is not) | Decides which threshold a good is tested against |
| **D18** | Country sheet name → ISO code, by hand | Congo / DR Congo |
| **D11** | The 249-code ISO list — standard named, no edition or date | Decides which origins get world-average values |
| **F2** | The date→quarter rule | No instrument cited |
| **F3** | Certificate rounding | Disclosed as an open question — honest, but still unsupported |

**Four further entries are sourced in part but carry an unsupported component:**

| Entry | Sourced | Unsupported component |
|---|---|---|
| **E1** | "Not exceeding" → strict greater-than, quoted | That Reg (EU) 2025/2083 is the amending act — named on screen, absent from the shipped data |
| **E2** | The hydrogen/electricity exclusion, inferred | Attributing it to 2025/2083 |
| **B2** | The Art 10a(1a) reading, quoted and corroborated ×2 | The nine values themselves — no document artefact pinned |
| **D16** | Workbook coverage, inherited | That workbook coverage equals Annex I scope; nomenclature year pinned to 2026 |

**Three further entries rest on documents that cannot be verified:**

- **B2** · The nine CBAM factor values — the Directive's source record carries a SHA-256 of **all
  zeros**. Values corroborated against climat.be and DEHSt, but no primary artefact is pinned.
- **F1** · The two published certificate prices — transcribed from an HTML page with no stable
  artefact, SHA-256 of all zeros.
- **A13 / D1** · Every benchmark and default value comes from a Commission workbook the Commission
  itself marks informational. Both regulations' OJ PDFs *are* hashed — but by hand, because EUR-Lex
  blocks automated fetching, so **no machine ever compares the numbers to the binding text.**

**And one instrument named in the brief governs nothing:**

- **IR (EU) 2026/1740** appears **7 times, all in test files** — 6 in the engine repository's tests and
  1 in the website's. **Zero occurrences in non-test code** (verified by grep). Every one anticipates a
  future rebuild of the corpus. No shipped code path cites it, and no figure the calculator produces
  today depends on it.
