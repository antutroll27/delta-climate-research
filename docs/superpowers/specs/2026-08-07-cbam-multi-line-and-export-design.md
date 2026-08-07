# CBAM calculator: multi-line, a real threshold verdict, and an auditor-grade export

Design spec · 7 August 2026

## Why

The calculator prices one line. Two consequences follow, and the second is the
one that matters.

**It cannot answer the question importers most want answered.** The de minimis
threshold is annual and per importer (Reg (EU) 2023/956 Art 2(3)). A single line
can prove you are *above* 50 t and can never prove you are *below* it, so the
tool returns `indeterminate` for every line under the threshold. An importer
whose whole year is 30 t is exempt and cannot be told so.

**The machinery to answer it is already vendored and unused.**
`threshold/aggregate.ts` carries a full annual-ledger model —
`aggregateThresholdBasis`, `ImportMassEntry`, `AnnualImportLedgerStatus` — and is
referenced **zero times** by the calculator. `evaluateThreshold` already returns
`below_threshold`, but only when handed `completeness: 'complete'`, and nothing
ever supplies that.

Alongside it: the estimate carries a complete provenance trail — rule packages
with versions, eight sources, a legal locator for the CBAM factor and for every
benchmark row — and none of it can leave the page.

## Purpose this serves

The calculator is a **credibility instrument**: its job is to make an importer or
a consultancy client conclude that we understand the regulation. It optimises for
depth, provenance and honest caveats over convenience.

That framing decides several things below. It is why the completeness attestation
is explicit rather than assumed, why the export states what it cannot tell you,
and why a placeholder hash is treated as a defect rather than a detail.

## Decisions taken

| Decision | Choice | Reason |
| --- | --- | --- |
| Where the code lands | `cbam-app.ts` and the Astro page — both ours | `cbam-app.ts` is deliberately absent from `cbam-sync-check.mjs`'s manifest. No engine edit, no upstream round-trip, no re-vendoring. |
| Threshold grouping | **Per calendar year**, not per estimate | The engine partitions on `calendarYear` already. Per-estimate would sum a 30 t 2026 line and a 30 t 2027 line to 60 t and report `above_threshold` — inventing a liability. Grouping is one `reduce`. |
| Completeness | Explicit per-year attestation, unticked by default | The tool must never assert completeness. It conditions on a statement the user makes, and records that they made it. |
| Export format | CSV **and** a printed document | The CSV is the working artefact; the document is the credibility artefact. Both zero-dependency. |
| `stamp.snapshotHash` | Populate for real | The pack carries `generatedAt` and both workbook hashes. A genuine claim is available; the current `"browser-prototype"` is not. |
| Line fingerprint | Real digest, honestly labelled | Computed, but never presented as source-document provenance. See §4. |

## §1 The line model

A line is today's six inputs plus an id.

```ts
interface Line {
  id: string        // row key, and ImportMassEntry.id
  cn: string
  country: string
  route: string
  scope: 'direct' | 'direct_and_indirect'
  massT: string
  date: string      // calendar year is date.slice(0, 4)
}
```

**`lines: Line[]` becomes the source of truth.** The app currently holds no state
at all — it reads fourteen `.value`s from the DOM on each run. Multi-line
introduces state for the first time; that is the honest cost of the feature and
it is confined to one file we own.

**Each line goes through `estimateFromPack` unchanged**, one call per line. No
batching, no new engine surface.

**A failing line does not blank the estimate.** A line that fails closed renders
its own `unavailable` card naming its missing selector; the rest still price and
still total. One unresolvable CN code must not destroy the whole sheet.

**Totals are summed in `Decimal`** at the same 34-digit precision the engine
uses. Mixing `Number` here is the one place a rounding difference could reach a
money figure.

## §2 The per-year threshold

`resolveThreshold` is **not** modified. It is vendored, it hard-codes
`completeness: 'partial'`, and it is built for a single line. `cbam-app.ts`
instead calls the two primitives directly — both already exported:

```
lines
  └─ group by date.slice(0,4)
       └─ aggregateThresholdBasis({ importerOrgId, calendarYear }, entries, status)
            └─ evaluateThreshold({ knownEligibleMassT, completeness, thresholdT })
                 └─ one verdict card per year
```

**The engine decides what counts.** `aggregateThresholdBasis` filters to the four
mass sectors — cement, aluminium, fertilisers, iron & steel — correctly excluding
electricity and hydrogen, which are absent from the 2026 threshold row. We do not
reimplement that rule; we hand it entries.

### The attestation

Per year, unticked by default:

> ☐ These are all my 2026 imports of CBAM goods

- unticked → `completeness: 'partial'` → `indeterminate`, exactly as today
- ticked → `completeness: 'complete'` → the engine may return `below_threshold`

**A year above 50 t reports `above_threshold` regardless of the tick.** That is
provable from partial data, and a checkbox must not gate a fact.

Ticking 2026 claims nothing about 2027. An estimate spanning a year boundary
shows two cards and two checkboxes, which is correct — the importer genuinely has
two separate questions, and a single merged verdict would hide that.

### Field values `ImportMassEntry` requires

| Field | Value | Note |
| --- | --- | --- |
| `id` | the line id | |
| `importerOrgId` | `'estimator-session'` | Constant. Used only for filtering; every entry shares it. |
| `calendarYear` | `Number(date.slice(0, 4))` | |
| `sector` | `sectorForCn(cn)` | Lines whose sector is null or outside the threshold's `includedSectors` are excluded before aggregation. |
| `netMassT` | the line's mass | |
| `sourceSha256` | the line fingerprint | See §4. |

### What the verdict card drops

The vendored `ThresholdView` carries a single `sector`, which cannot survive a
multi-sector list. Our per-year view omits it and reports aggregate eligible mass
instead. We own that type; it is not the vendored one.

## §3 The export

### CSV — the working artefact

One row per line. Metadata repeats across rows: redundant, but filterable,
joinable, and it opens in Excel without an import wizard.

```
line_id, cn_code, description, origin, route, emissions_scope, mass_t, import_date,
embedded_tco2e, free_allocation_tco2e, chargeable_tco2e, certificates, cost_eur,
cbam_factor, cbam_factor_locator, cscf_status, cscf_locator, assumed_cscf,
price_quarter, price_eur, price_status,
benchmark_column, benchmark_value, benchmark_route, benchmark_locator,
status, rule_packages, line_fingerprint
```

`Blob` → `URL.createObjectURL` → `<a download>`. No library.

Threshold verdicts are **not** CSV rows — they are per-year, not per-line. They
appear in the document, and the CSV carries `mass_t` and `import_date` so the
recipient can reproduce the grouping.

### Document — the credibility artefact

Rendered as HTML in a print stylesheet, produced via `window.print()`. The
browser writes the PDF. No jsPDF, no dependency, and it inherits the site's
existing type. Four sections:

1. **What you asked** — every line as entered
2. **What we computed** — per line and totalled, plus the per-year threshold
   verdict and whether its box was ticked
3. **On what authority** — rule packages with versions; IR (EU) 2025/2620 and
   2025/2621 with their real sha256; each benchmark's Annex locator; the CBAM
   factor's Directive locator
4. **What this does not tell you** — the CSCF is unpublished, so every figure is
   a labelled scenario; Art 9 carbon-price deductions are not modelled, making
   figures conservative; the threshold verdict rests on the user's own
   completeness statement; the line fingerprint covers inputs as entered, not
   source documents

Section 4 is the differentiator. Any tool can print a number. Almost none print
what their number cannot tell you.

## §4 Two hashes, one real and one honestly labelled

### `stamp.snapshotHash` — a genuine claim

Currently `"browser-prototype"`. The pack carries everything needed to identify
the exact corpus a figure was computed from:

```
generatedAt                                   2026-08-07T16:59:36.563Z
generatedFrom[eu-cbam-2026-defaults-v2]       865372ed23649b7b02c9…
generatedFrom[eu-cbam-2026-free-allocation]   b79108b025e697822f0f…
```

A SHA-256 over those three, in that order, replaces the placeholder. The export
then states not "computed from our data" but "computed from pack
`2026-08-07T16:59:36.563Z`, benchmarks workbook `b79108b0…`, defaults workbook
`865372ed…`". That is a claim we can actually stand behind.

### The line fingerprint — real digest, careful wording

`ImportMassEntry.sourceSha256` is a required field, and `ThresholdBasis` returns
the values as `entryHashes`. In the SaaS it fingerprints a customs document. A
browser calculator has none.

**Compute a real SHA-256** over the line's normalised inputs, so `entryHashes` is
deterministic and meaningful. **Never label it source provenance.** The engine's
field name is fixed by the vendored type; what the export prints is ours, and it
prints:

> line fingerprint — inputs as entered; no source document

A field named `sourceSha256` carrying a digest of numbers someone typed into a
form is the kind of thing an auditor notices. Computing it honestly and naming it
honestly costs nothing and avoids claiming evidence we do not have.

`crypto.subtle.digest` requires a secure context. Production is HTTPS and
`localhost` counts, so both are satisfied. The run path becomes async, which it
already is — `ensurePack` is async today.

## Verification

**Unit, in `tests/unit/`:**

- A 30 t 2026 line and a 30 t 2027 line, both attested complete, return
  `below_threshold` for **each year** — not `above_threshold` for a 60 t sum.
  This is the per-year decision's regression test and it fails on the
  per-estimate model.
- 60 t in one 2026 line returns `above_threshold` **with the box unticked**.
- The same line unticked and under 50 t returns `indeterminate`.
- An electricity or hydrogen line is excluded from the eligible mass.
- A line that fails closed leaves the other lines' totals unchanged.
- The snapshot hash is stable across two runs over the same pack, and changes
  when `generatedAt` changes.
- CSV round-trip: every numeric column parses, and `chargeable_tco2e` equals
  `embedded_tco2e − free_allocation_tco2e` per row.

**End-to-end, Playwright:** add three lines, remove one, tick the attestation,
confirm the verdict changes from `indeterminate` to `below_threshold`, and that
the CSV downloads with the expected header.

**Unchanged and re-run:** `npm run verify`, the publication contract, and
`cbam-sync-check.mjs` — which must still report the vendored engine intact,
because nothing in this work touches it.

## Out of scope

- **Persistence.** Session-only. No accounts, no saved estimates. Adding them
  turns a credibility instrument into the SaaS product.
- **The 2027+ dead zone.** Certificate prices exist only for 2026 quarters, so
  later dates still fail closed. Separate, and the most visible remaining flaw.
- **Combined `(C)/(F)` routes.** 19 goods, resolution backed by both regulations,
  but it is a change to `resolveBenchmark` — vendored, upstream.
- **Reconciling the 41,100 default factors** against IR 2025/2621's 2,400-page
  Annex I. The largest unaudited surface we have, and its own piece of work.
- **Any engine change.** If this design appears to need one, the design is wrong.

## Open

- `Art 2(2)` is cited where the provision is `Art 1(2)`, in five places in the
  vendored engine. Unreachable today; wants its own upstream pass.
- Four sources still carry placeholder hashes: `dir-2003-87-art-10a-1a`,
  `dr-2019-331-art-14-6`, `reg-2023-956`, `ec-certificate-price-page`.
- 94.3% of answers remain `cscf_pending` and will until the Commission publishes.
  Nothing here changes that; §3's fourth section exists to say so plainly.
