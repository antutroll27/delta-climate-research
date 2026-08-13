# Verified emissions entry — design

2026-08-13 · brainstormed with the founding team's ask: "a dropdown for people that know
their numbers and have it confirmed." Status: **approved design, awaiting implementation
plan.** Prerequisite: the DV-correcting-act pack rebuild (IR (EU) 2026/1740) lands first.

## What this is

The public calculator gains a per-line choice of emissions source: the Commission's
default values (today's only path), or the importer's own **verified** specific embedded
emissions. Verified figures skip the mark-up — that is the regulation's designed reward
for having data — and the card shows what the choice is worth against the default.

The engine has carried `tier: 'actual-verified' | 'default+markup'` since it was vendored
(`cbam-algos/cbam/certificate-estimate.ts:32`); the snapshot renderer already knows how to
stamp "Verified actual". What is missing is one layer: `estimate-from-pack.ts` hardcodes
the defaults tier. This design fills exactly that gap and nothing else.

## Decisions (each was an explicit choice during brainstorm)

| Decision | Choice | Why |
| --- | --- | --- |
| Input shape | **Direct + indirect, per tonne** (two fields) | The FAA subtraction runs against a DIRECT benchmark; a single total cannot be split honestly for cement/fertilisers. Verifiers' reports carry SEE split this way. |
| Attestation | **Mandatory tick + optional reference** | The tick gates the maths; the reference (verifier / report ID) prints in exports when given. A required reference field invites junk to get past the gate. |
| Default comparison | **Show the delta, both directions** | Runs the same line through the default path in parallel. "Saves €X" or "adds €X" — never cherry-picked; suppressed with a note when no default is published or either side is unpriced. |
| Form control | **Native `<select>` between Route and Mass** (mockup A) | The founder's literal ask; matches the form idiom; choosing "My verified figures" reveals the panel. |
| Architecture | **Upstream-first (CBM), then re-vendor** (approach 1) | One source of truth; the SaaS gains the same capability; the estimator's private helpers stay private; sync-check discipline intact. Rejected: composing in our layer (re-implements three private helpers → silent drift in the provenance layer); forking the estimator (permanent divergence). |

## Out of scope, deliberately

- **Column A / process-level figures.** The input is the WHOLE good's embedded emissions,
  precursors included — that is what keeps every line on Column B. A process-only figure
  calls for Column A + declared precursors, which is the SaaS workspace's job.
- **Art 9 carbon-price deductions** (implementing act still a draft — engine-wide stance).
- **Persistence.** Entered figures live for the session, like every other line input.
- **Verification of the verification.** We transcribe a claim; we never bless it.

## 1 · Upstream change (repo: `/Volumes/VSTSAMPLES/Projects/CBM`)

`EstimatorInput` in `estimate-from-pack.ts` gains:

```ts
verified?: {
  directTco2ePerT: string      // required inside the block; non-negative decimal
  indirectTco2ePerT?: string   // read only when emissionsScope includes indirect
}
```

When present, `estimateFromPack`:

- skips `selectFactorFromPack` / `selectIndirectFactorFromPack` entirely — **no mark-up**;
- sets `tier: 'actual-verified'`, `emissionsTco2e = directTco2ePerT × massT`,
  `indirectTco2e = (indirectTco2ePerT ?? 0) × massT` gated on the existing scope rule;
- leaves everything downstream untouched: benchmark lookup by declared route, CSCF
  what-if, quarterly price, the floor clamp.

Consequences pinned by tests:

- The `NO_DEFAULT_REASON` refusal is defaults-path-only. A verified line for a good with
  no published default **works** — that is the feature.
- A missing **benchmark** still returns `unavailable`, attestation or not. Verified
  emissions replace one side of the subtraction; they cannot invent the other.
- `originBasis` stays `'country'` (the residual-bucket note describes DEFAULTS provenance;
  the tier stamp is the verified path's provenance label).
- The attestation **reference never enters the engine** — provenance, not maths.

Then re-vendor byte-for-byte into `src/scripts/cbam-algos/`, update `UPSTREAM.json`,
`node scripts/cbam-sync-check.mjs` green. Same pipeline as the production-year fix.

## 2 · Line model (`src/scripts/cbam-lines.ts`)

```ts
export interface Line {
  // existing: id, cn, country, route, scope, massT, date
  tier: 'default+markup' | 'actual-verified';  // engine's DataTier strings verbatim
  seeDirect?: string;      // present iff tier is 'actual-verified'
  seeIndirect?: string;
  verifiedRef?: string;    // optional free text, echoed into exports
}
```

`lineFingerprint` hashes
`[cn, country, route, scope, massT, date, tier, seeDirect ?? '', seeIndirect ?? '', verifiedRef ?? '']`
— new fields appended at the end, `tier` included for default lines too so the digest has
one shape. Lines are session-only; no migration. Route remains **mandatory** in verified
mode — it selects the free-allocation benchmark.

Threshold maths is untouched: the 50 t gate counts **mass**, whatever the tier.

## 3 · Form (`cbam-app.ts` — the vendoring-exception file)

- `<select id="cbTier">`, label **Emissions data**, between Route and Mass. Options:
  "Commission default + mark-up" (default) · "My verified figures".
- Verified reveals: **Direct** (required, tCO₂e/t) · **Indirect** (visible under the same
  rule as the existing scope row — the sector counts indirect and the scope select says
  so) · attestation checkbox (required): *"I attest these figures come from an accredited
  verification (ISO 14064-3 / CBAM Art. 8) — my claim, not checked by this tool"* ·
  **Reference** (optional).
- Validation through the existing `num()` hardening (whitespace, exponents) — figures must
  be non-negative decimals; **no upper sanity bound** (honesty over paternalism; the
  attestation owns the number). Failures report through the established `#cbStatus` path.
- Switching back to "Commission default" clears the panel — values never leak into the
  next line. Zero direct is legal (a 100 %-scrap EAF producer; the floor clamp already
  stops negative certificates).

## 4 · Card

- The snapshot's "Data tier" row: *"Verified actual — as attested by the user, not
  confirmed by this tool"*, plus *"Ref: …"* when given.
- **Delta line** under the money figure, three states:
  - *"Commission default would give €D — your verified data saves €(D−V)"*
  - *"…adds €(V−D)"* (never hidden when unfavourable)
  - *"No Commission default is published for this good/origin — nothing to compare
    against."* (also used when either side is `cscf_pending` without a price)
- Both figures stay labelled what-ifs; §4 applies to both sides of the comparison.

## 5 · Exports

**CSV** (`csvRows`): two columns appended after `cscf_status` — `data_tier` (engine
strings verbatim) and `verified_reference`. The delta stays **off** the CSV: rows carry
engine values verbatim, one hypothetical per row. `verified_reference` is free text →
the existing CSV-injection guard (leading `= + - @` prefixed) must cover it, tested.

**Print document**: verified line blocks carry tier + reference + the attestation
sentence. §4 gains a **conditional** caveat, present when ≥ 1 line is verified:

> Verified figures are the user's attested claim, from a verification this tool has not
> seen or confirmed. The optional reference is transcribed, not checked.

Because `cbam-render.test.mjs` exact-pins §4 prose against paraphrase attacks, **both
states are pinned** — caveat present with a verified line, absent without — as hand-typed
constants updated in the same commit as the prose.

## 6 · Worked example (pinned in tests)

CN 7206 10 00 · India · route (C) · **verified direct 2.31 tCO₂e/t** · 100 t · 2026-03-15
· Q1 price €75.36 · CSCF what-if = 1:

```
emissions   = 2.31 × 100                    = 231       (no mark-up — the point)
SEFA/t      = 0.975 × 1 × 1.288             = 1.2558
FAA         = 1.2558 × 100                  = 125.58
chargeable  = 231 − 125.58                  = 105.42    → certificates 105.42
cost        = 105.42 × €75.36               = €7,944.45 (ROUND_HALF_UP)

default path (comparison line): 2.64 × 1.1 × 100 = 290.4
chargeable  = 290.4 − 125.58                = 164.82    → €12,420.84
delta shown: "your verified data saves €4,476.39"
```

The €12,420.84 side is the same figure the founding team's own workbook produces for this
line. IR 2026/1740 leaves 72061000/IN unchanged, so the example survives the prerequisite
rebuild.

## 7 · Tests

- **CBM upstream**: no mark-up on verified · tier flows to output · missing benchmark
  still refuses · zero direct legal · verified works where no default is published.
- **cbam-lines**: fingerprint distinguishes tier/figures/reference · threshold ignores
  tier · CSV columns + injection on `verified_reference`.
- **cbam-render**: §4 caveat pinned in both states · tier stamp wording · delta wording in
  all three states · delta suppressed when default `unavailable`.
- **Worked line** (§6) pinned end-to-end against the real pack.
- **e2e**: pick verified → enter → attest → add → both exports · flip back to defaults →
  panel clears · unticked attestation blocks Add with a message.

## 8 · Sequencing

1. DV-correcting-act rebuild (IR 2026/1740) — new hashes, Thailand fix, route re-keying.
2. This feature: upstream CBM change → re-vendor → UI/exports/tests here.

Implementation follows the subagent-driven pattern; the standing constraints (never edit
`cbam-algos/` locally, never `git add -A`) apply to every task.
