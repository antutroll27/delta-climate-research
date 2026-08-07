# Note on "Stakeholder Validation and Response Framework"

Review of `docs/Stakeholder Validation and Response Framework.pdf`
(*CBAM Tool: Stakeholder Needs Analysis*, 27 July 2026, 20 pp.)

Written 7 August 2026. Read this before anyone builds to that document.

## Summary

The document is a good piece of work and its Annex IV formulas are correct. It
specifies the **exporter-facing, actual-data** product — a different surface from
the public calculator on the website, which runs the defaults path.

It has one omission that would move money. **It specifies how to compute a good's
emissions and never mentions the deduction that is subtracted from them.** A tool
built to it as written would overcharge every importer by the full free
allocation.

Everything else in this note is secondary to that.

## The omission

Search the 20 pages:

| Term | Occurrences |
| --- | --- |
| Annex IV | 9 |
| threshold | 7 |
| benchmark | 2 |
| **free allocation** | **0** |
| **SEFA** | **0** |
| **CSCF** | **0** |
| **CBAM factor** | **0** |

The document's calculation chapter ends at Specific Embedded Emissions:

```
Simple:   SEEg = AttrEmg / ALg
Complex:  SEEg = (AttrEmg + Σ mᵢ·SEEᵢ) / ALg
```

Both correct. But certificates owed are not proportional to SEE. They are
proportional to:

```
(SEE − SEFA) × mass × CBAM factor × certificate price
```

SEFA — the specific embedded free allocation, IR (EU) 2025/2620 — is the
deduction that keeps imports symmetric with EU producers who still receive free
ETS allowances. Leave it out and the importer pays for carbon the regulation
never intended to charge them for.

## What that costs, measured

Run through our own engine: **Portland cement (CN 2523 29 00), India, 100 t,
March 2026.**

| | tCO₂e | at €75.36/t |
| --- | --- | --- |
| Embedded emissions (SEE × mass) | 152.900 | €11,522.54 |
| Free allocation adjustment | −64.935 | |
| **Chargeable** | **87.965** | **€6,629.04** |

A tool built to the document's spec would invoice **€11,522.54**.
The correct figure is **€6,629.04**.

**Overcharge: €4,893.50 on a single line — 74% too high.**

The deduction is `CBAM factor 0.975 × CSCF × Column B benchmark 0.666 × 100 t`.
Our engine reports this as `status: cscf_pending` with a labelled what-if,
because the CSCF for 2026-30 is unpublished; the figures above assume CSCF = 1.

Worth noting this is the same €4,890-ish magnitude as the Column A error we
rejected last week from a separate source. Different cause — that one picked a
zero benchmark, this one has no benchmark term at all — but the money lost is the
same 64.9 tCO₂e, because both drop the identical deduction.

## What the document gets right

**The Annex IV formulas.** Correct, and structurally the mirror of our own
Equation 4: `SEE = AttrEm + Σ(mᵢ·SEEᵢ)` against `SEFA = SFAProc + Σ(mᵢ·SEFAᵢ)`.
Same recursion, same `mᵢ`. Our `SefaPrecursor` type already carries `cnCode`,
`routeIndicator` and `quantityPerTonne`.

**The sectoral direct/indirect rule.** Already implemented, and more precisely
than the document specifies. The scope control appears only for goods the
Commission publishes an indirect default for; elsewhere the engine returns zero
either way, so it is driven by the data rather than a hardcoded sector list.
See `cbam-app.ts:310-321`.

**Carbon price paid abroad.** Listed as a required field. Not implemented, and
the engine says so in its own output — `certificate-estimate.ts:245`: *"Art 9
deduction for a carbon price paid in the country of origin is not modelled (the
implementing act is still a draft), so this figure is conservative."* A disclosed
gap, not a silent one.

**It unlocks a path we deliberately closed.** Our audit records that the Column A
route is implemented but unreachable from the public tool, because a screening
tool cannot obtain a verified process-only figure with a declared precursor list.
This document specifies exactly how to obtain them. It is the product that makes
Column A usable — which is precisely why the free-allocation half must be in its
spec, not just the emissions half.

## What to add to the spec

One section, after the Annex IV chapter:

1. **The free allocation adjustment.** `FAAg = SEFAg,y × Mg` (IR (EU) 2025/2620
   Eq 1). Subtract before counting certificates.
2. **Which benchmark column.** Chosen by the *scope* of the emissions figure, not
   by whether it was verified. An all-in figure takes Column B; a process-only
   figure takes Column A plus each precursor's own Column B. Getting this
   backwards is the same class of error as omitting the deduction entirely.
3. **The CSCF is unpublished for 2026-30.** It is not 1.0 by default. Any tool
   quoting a final euro figure for those years is asserting a number the
   Commission has not set.
4. **The 50 t de minimis threshold.** The document mentions it once; it should be
   a first-class gate, since below it an importer owes nothing for the year.

## Also worth knowing

The document's data-sourcing chapter is where the EEPC India link came from — it
lists EEPC as the best source of Indian iron, steel and aluminium **exporter
contacts**, and CAPEXIL for cement and fertiliser. That framing is right: these
are go-to-market directories, not emissions data. They hold names, not numbers.

The proposed business model — hub-and-spoke, EU importer pays, exporters free —
is the same shape kolum runs, and kolum's published proof metric is one customer
reaching 70% supplier data coverage. The document appears to have arrived at the
model independently, which is reassuring about the model and a reminder that the
position is not uncontested.
