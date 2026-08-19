# Refusal codes, the classification gate, and a reachability guard

**Status:** design approved 2026-08-20.
**Origin:** two spec errors that nearly shipped in the all-routes work, and a measurement audit that found more of the same class.

## Why this exists

Both errors in the all-routes work came from one habit: **writing a spec by reading code instead of running it.**

1. I specified a wording fix to `FAILURE_MESSAGES`. Measured afterwards: **0 of 347,040 offers** produced a refusal carrying those strings. Every production caller passed its own `reason`. The fix changed nothing any user read.
2. I diagnosed the uncovered-year defect as a benchmark validity-window problem. Measured: **0 of 397** expiring benchmark rows lack a successor, so that gate is an equivalent mutant. The real bound is `defaultValues.reportingYear`.

Both were caught before shipping — by review and by a subagent's measurement, not by me. An audit of roughly 2.3 million engine invocations then found further instances. This spec fixes the consequential ones and installs a guard so the class cannot recur silently.

## The four fixes

### Fix 1 — a bad verified figure must not report `BAD_MASS`

`failureCodeForSelector` has arms for `mass/`, `date/`, `default/`, `indirect/`, `benchmark/`, `certificate-price/`, `cbam-factor/`, `cscf/` — and **none for `verified/`**. An unreadable attestation therefore falls through to `BAD_MASS`. Measured: code `BAD_MASS` carried `BAD_MASS_REASON` 106,496 times and `BAD_VERIFIED_REASON` 73,216 times. Reproduced directly:

```
bad verified figure -> code: BAD_MASS  selector: verified/2507008080/directTco2ePerT
bad mass            -> code: BAD_MASS  selector: mass/2507008080/2026-02-15
```

**This is a latent trap, not a live bug.** The human-readable string is correct, and the UI keys on the *selector* (`inputRefusal` tests `/^(mass|verified)\//`), so nothing today shows the wrong thing. It matters because the next consumer to key on `failure.code` will attribute a bad attestation to a bad tonnage, and will look right while doing it.

**Fix:** add a `BAD_VERIFIED` member to `EstimateFailureCode`, a `verified/` arm to `failureCodeForSelector`, and a `FAILURE_MESSAGES` entry. **Blast radius measured: 2 references to `failure.code` in the entire website, both in `tests/unit/cbam-render.test.mjs`, both asserting `NO_DIRECT_DEFAULT`.** Zero in CBM's `src/` or `api/`.

### Fix 2 — the verified path never consults classification

Measured at `country=DZ, route=default, date=2026-02-15, verified={directTco2ePerT:'1.9'}, mass=100`:

| CN | classified | `routesFor` | result |
|---|---|---|---|
| `25070080` (8-digit stem) | **no** | `[]` | **prices — 190 tCO2e** |
| `2507008080` (10-digit TARIC) | yes | `["default"]` | prices — correct |
| `27160000` (electricity) | no | `[]` | `zero_by_fiat` — **deliberate** |
| `99999999`, `7601`, `2523` | no | `[]` | refuse — correct |

`25070080` is one of exactly three 8-digit stems the UI explicitly tells users are **not** offered goods. It prices anyway, with a full provenance stamp, because the lookup matches on prefix. That is fail-open in a fail-closed engine.

**The blanket gate is wrong.** Refusing every unclassified CN would break `27160000`, whose `zero_by_fiat` result is deliberate regulatory behaviour (electricity is zero-rated). The gate must carve it out explicitly.

**Fix:** refuse when the CN is not a classified offered good, except the electricity path. The carve-out gets its own named test so a future tidy-up cannot silently remove it.

**Exposure is limited but real:** the shipped form cannot reach this (`run()` gates on `!route.value` and `routesFor` returns `[]`). The engine is a **vendored artefact with a second caller** — CBM's API service — so the gate belongs in the engine, not the UI.

### Fix 3 — a comment that invites an under-charge

`cbam-app.ts:1963-1971` states there are "**ZERO** `route-mismatch`" results, that the arm is reachable "only by calling the engine with a route the form would not offer", and instructs the reader: *"Do not read this arm as exercised behaviour."*

Measured across every good x origin x form-offered route, 2026-2028: **520,560 selectors, of which 5,349 are `route-mismatch`.** Witnesses at an ordinary 2026 date: `2523100010`/AE/`(A)` (available `["(B)"]`), `2523100090`/AE/`(B)` (available `["(A)"]`).

This ranks first of everything the audit found, because it is **an instruction to a future maintainer**. It invites narrowing `kind !== 'none'` to `=== 'found'`; doing so would hide the scope control on 5,349 selectors and price electricity at zero — an under-charge on a regulated filing.

**Fix:** rewrite to the measured truth and delete the invitation. Comment only, no behaviour change.

### Fix 4 — a false claim used to justify a UI gate

Four places assert that `none` means the Commission publishes no indirect default at all, "true of **iron & steel** and aluminium". Measured: CN **26011200** (agglomerated iron ores, sector `iron_and_steel`) carries **84 published indirect value rows across 28 origins** and prices live — IN 5.5, CN 6.6, DZ 3.3 tCO2e on a 100 t line. Aluminium is genuinely zero. The sector that actually publishes nothing is **hydrogen**, which the comment never names.

**Fix:** correct all four sites, name hydrogen, keep aluminium. Comment only.

## The guard

### Part A — reachability

A test that sweeps a **bounded** input space, collects every user-facing string from `reason`, `failure.message` and `stamp.notes`, and requires each declared constant to be either produced or on an explicit allow-list carrying a written reason.

Bounded matters: the audit swept roughly 1M combinations and took about 25 minutes in places. The guard must run in CI seconds, so it uses a small representative space — a handful of goods per sector, listed and unlisted origins, both scopes, all tiers, covered and uncovered years, and the malformed inputs.

**The allow-list starts with the five measured-dead constants:**

| Constant | Why dead |
|---|---|
| `NO_SNAPSHOT_SCOPE_REASON` | Sole consumer is CBM's `api/services/certificate-estimate.ts`, which is not vendored to the website. |
| `NO_PRECURSOR_REASON` | Same; `estimateFromPack` passes `precursors: []` at both call sites. |
| `INDIRECT_UNSUPPORTED` | Needs `emissionsType: 'indirect'`; `baseInput` hardcodes `'direct'`. |
| `FAILURE_MESSAGES.BAD_MASS` | `estimateFromPack` gates mass first with its own `BAD_MASS_REASON`; anything reaching `estimateCertificates` is already a parsed Decimal. |
| `FAILURE_MESSAGES.INVALID_PACK` | Emissions reaching `estimateCertificates` are always `Decimal.toFixed()` of finite non-negative values. |

`AMBIGUOUS_REASON` is dead **on today's corpus** (0 duplicate rows anywhere) but would become live if a duplicate ever shipped. It goes on the list with that condition stated — it is a fail-closed guard for a corpus defect, not dead code to delete.

**The test must prove its own collector works** before trusting any zero: assert it captures a string known to be produced. The audit's first harness returned zero routes for every good because it built index keys with a pipe where the engine uses a NUL separator — a clean-looking zero from a broken sweep, which is the exact failure this guard exists to prevent.

### Part B — canonical corpus facts

One module exporting the measured scalars, pinned by a test against the shipped pack: **572** goods, **122** origins (121 published sheets plus `OTHER`), **76,428** default-value rows, **2,465** benchmark rows.

The audit found a cluster of stale scalars — 574 vs 572 goods, 120 vs 122 origins, "58 tests" vs 307, "~94% cscf_pending" vs 100%, "183 of 574 goods" vs 0-2. Individually cosmetic. Collectively they are why Fixes 3 and 4 were dangerous: **no number in these files could be trusted without re-measuring.** Comments reference the module instead of hardcoding, so drift fails a test rather than rotting quietly.

Each repo keeps its own facts test reading its own pack copy, rather than expanding the vendor manifest with a test-support module.

## Deliberately not in scope

- **Machine-extracted claim assertions from comment prose.** Strongest possible answer to error class 2, and rejected: it needs every existing comment retro-tagged, and Part B removes most of the incentive to hardcode numbers. YAGNI until it proves necessary.
- **The stale-scalar cluster itself** — real but cosmetic, batched for a later pass. Part B makes that pass mechanical.
- **The 1,295 selectors returning `route-mismatch` while listing the declared route inside `availableRoutes`** (`availableRoutesAt` unions across origins the loop already broke out of). Harmless today because nothing renders `availableRoutes`; would read as nonsense the moment something does. Logged, not fixed.
- **Whether the 5,349 `route-mismatch` selectors are intended corpus behaviour or a corpus defect.** IR 2026/1740 re-keyed routes; the refusal is fail-closed and correct either way. A regulatory question for a human, not a code change.

## Ordering and vendoring

Fixes 1, 2 and 4's engine sites are **vendored** — they change in `/Volumes/VSTSAMPLES/Projects/CBM` first, land with CI green, and are re-vendored with `UPSTREAM.json` re-recorded against the merge commit. Fix 3 and Fix 4's renderer site are in `cbam-app.ts`, the website's one hand-editable file. Part A's test belongs in CBM with the engine; Part B gets a copy in each repo.

## Testing

- **Fix 1:** a bad verified figure yields `BAD_VERIFIED` and a bad mass still yields `BAD_MASS` — both hand-typed, both asserted against a real `estimateFromPack` refusal, never against `failureMessage()` directly. That distinction is the whole lesson: a test that calls the accessor proves only that a Record lookup works.
- **Fix 2:** `25070080` refuses; `2507008080` still prices; `27160000` still returns `zero_by_fiat`. The carve-out is named in its test title so its purpose survives.
- **Fixes 3 and 4:** no behaviour changes, so the corpus counts they now assert (5,349 route-mismatch; 26011200's 84 indirect rows) are pinned by Part B rather than by prose.
- **Everything:** mutation-verify, and **grep the file to confirm the mutation landed before trusting the run.** A substitution in this project once silently failed to match and produced a fully green suite that looked like a passing mutation.
