# The last claims defects — design

**Date:** 2026-08-16
**Status:** approved, ready for planning
**Scope:** four defects where the calculator states something it cannot support. Wording and one signature. **No figure may change.**

## Why these four, and why now

This clears every remaining claims defect that is not waiting on the Commission. Two are live and user-visible; two are latent. All four already have a correct solution sitting beside them in the same file — which is the point: each is a place where the right pattern was established and one site was left behind.

The parity fixture's duplicate rows and missing mixed-tier coverage are **deliberately excluded**: that artefact exists for a Go port, and Go is not a current priority.

## 1. The residual note survives a refusal — LIVE

`lib/cbam/certificate-estimate.ts:237` attaches it inside `baseOf`:

```ts
notes: input.originBasis === 'residual' ? [RESIDUAL_BASIS_NOTE] : [],
```

`baseOf` runs on **every** arm including `'unavailable'`, so a refused defaults-path line renders *"…so **this figure** uses its 'Other Countries and Territories' residual default…"* over a card showing no figure.

Its sibling `MIXED_RESIDUAL_INDIRECT_NOTE` had exactly this defect and was moved out of `baseOf` into the priced branch at `:414`. **The same move fixes this**, measured: every `unavailableEstimate` refusal computes `originBasis` as `'country'`, because `factor` is null there and `factor?.originCountry` can never equal `OTHER_ORIGIN`. Both defects arrive through the same catch.

**Nothing replaces it.** On a defaults line the importer attested nothing, so there is no true input-claim to preserve — unlike the mixed case, where `ATTESTED_NOTE`'s subject (the figures the user typed) survives a refusal. The note describes a figure's provenance; with no figure, it has no subject.

## 2. Two cards disagree on a sector's name — LIVE

`renderThreshold` (the single-line card) renders `t.sector.replace(/_/g, ' ')` at `cbam-app.ts:238` and `:245`, printing **"iron and steel"**. The multi-line card prints **"iron & steel"** from the ordered `SECTOR_PROSE` table at `:266`. Both ship today.

The file **already documents the defect it is committing**, twelve lines above the code committing it (`:258`): *"A `.replace(/_/g, ' ')` — the obvious shortcut — is wrong on two of the four."* Measured: `iron_and_steel` → "iron and steel" where the prose says "iron & steel", and `fertilisers` stays plural where the prose says "fertiliser".

**Fix:** look the sector up in the table that already exists. `SECTOR_PROSE` is an ordered key→prose list, so a single-key lookup is a filter over one element.

**The rendered single-line card must change only for the keys the table corrects.** For `cement` and `aluminium` the output is identical either way; verify that rather than assuming, and pin both the changed and unchanged keys.

An unknown key must render as itself, matching the convention the multi-line card established: a raw key reads as a datum and prompts a table entry, while a prettified one reads as reviewed copy and ships a name nobody chose.

## 3. `cbam-factor/` and `cscf/` are told a benchmark is missing — LATENT

`NO_BENCHMARK_REASON` is the dispatch's fallback (`certificate-estimate.ts:513`). After the price and date arms were split out, it serves `benchmark/`, `sefa/`, `cbam-factor/${year}` and `cscf/${year}`. For the last two the missing thing is a CBAM factor or a cross-sectoral correction factor — not a benchmark.

**Measured 0 reachable** on today's pack: `cbam-factor` covers 2026–2034 and `cscf` 2026–2030, so neither year lookup misses. It becomes reachable the moment the pack's coverage lags its dates — which is exactly what happened to prices, and is why the price arm exists.

**Fix:** two more reasons and two more dispatch arms, following the pattern proven three times in this file.

`sefa/` stays on the fallback: it names a scope problem in the free-allocation formula, and `NO_BENCHMARK_REASON`'s wording is defensible for it. Say so, rather than leaving a reader to wonder why three of four were split.

## 4. `renderAttestation`'s `priced` is a silent footgun — LATENT

The parameter is required in TypeScript, but the function is **exported**. Called from JavaScript with one argument, `priced` is `undefined` → falsy → a **priced** mixed line renders the *refused* wording, which claims no figure was produced.

Compile-guarded, and both call sites are pinned by source text, so it is not live. But the failure is silent and **under-claiming** — the direction nobody notices.

**Fix:** make the wrong call impossible or loud rather than silently wrong. Options include an explicit runtime check, or restructuring so the figure-bearing input is the estimate itself rather than a boolean derived from it — the latter also removes the chance of a caller computing `priced` differently from `hasFigure`'s definition.

The choice is the implementer's; the requirement is that a one-argument call cannot silently produce the under-claiming branch.

## Testing

- Each fix mutation-verified: break it, confirm a **named** test fails, restore.
- The residual-note fix pinned on **both** arms — a refused residual line carries no note, a priced one still does — or it can go vacuous in either direction.
- The sector fix pinned on a key the table corrects (`iron_and_steel`) **and** one it does not (`cement`), so a lookup that silently changed everything would fail.
- The two new reasons pinned by hand-typed constants, never imported, per this codebase's anti-paraphrase convention. Since neither is reachable on today's pack, the pin must construct the condition rather than sweep for it — say so explicitly, since an unreachable arm is exactly where a vacuous test hides.
- **No figure moves.** Sweep `origin/main` → HEAD as one hop; only `notes` and refusal `reason` strings may differ.

## Out of scope

The parity fixture (Go). 2027/28 price coverage, the IR 2026/1740 rebuild, placeholder source hashes, Annex IV, UK CBAM — all waiting on published data. The omission surfaces and `differential.test.ts`'s missing indirect arm remain queued as their own batch.
