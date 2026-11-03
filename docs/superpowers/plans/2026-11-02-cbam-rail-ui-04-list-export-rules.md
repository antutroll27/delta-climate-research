# CBAM Calculator redesign, phase 4: Shipment list, Export, Rules & sources — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Each task is handed to its builder with the "Standing rules" block below pasted above it.** A builder sees nothing else of this file.

**Goal:** Restyle the last three views as bento tiles (spec §5.4–5.6): the Shipment list (Total, Annual de minimis per year, one plate per line), Export (CSV with a preview of the real CSV, Document, fingerprints) and Rules & sources (Framing, Not yet published, Colour key, Rule pack, Method with the re-measured D4 count, Sources). Give the rail's title card its final form. Then put Light back as the OS default and prove AA contrast in both themes.

**Architecture:** Two new pure renderer modules, `src/scripts/cbam-ui/tiles-list.ts` and `tiles-export.ts`, plus a small `tiles-rules.ts` for the pack-dependent half of Rules. The list's honesty prose (`SECTOR_PROSE`, `sectorList`, `yearVerdictTag`, `refusedLineNote`, `totalsTag`, `AMENDED_BY_2025_2083`) **moves** from `cbam-app.ts` into `tiles-list.ts`, and `cbam-app.ts` imports it back, so every surface (List tiles, the draft threshold card, `#cbStatus`, the print document) keeps reading one spelling. `renderTotals` is retired into `totalTile`. `renderLineCard` keeps its name and signature and becomes a thin adapter: it still computes the result card, attestation and delta itself (the unit suite counts those call sites in `cbam-app.ts`) and hands the strings to `linePlate` for the tile shell. **The rule that makes the port safe:** inside a tile, every honesty element the suite pins — each `cb-tag` span, each `<p class="cb-sub">` sentence, the attest label, `cb-fig`/`cb-n`/`cb-cost`, `cb-prov`, `cb-reason`, `cb-attested` — is emitted byte-for-byte as today. The `b-` classes go on tile shells and new presentational elements only, and `cbam-bento.css` restyles the `cb-*` hooks inside tiles. So the test diff is call-site renames plus new tests, never a rewritten assertion.

**Tech Stack:** Astro 5 page with a plain `<script>` module, TypeScript, `node --test` through tsx for unit tests, Playwright for e2e, `decimal.js` (already a dependency).

**Spec:** `docs/superpowers/specs/2026-11-02-cbam-rail-ui-design.md` (§4.1, §4.3, §5.4–5.6, §6, §7, §11). **Visual reference:** `docs/superpowers/specs/2026-11-02-cbam-rail-ui/` — `screens/4-list-*`, `5-export-*`, `6-rules-*`, `8-empty-state-*`, and `preview/bento.html` (`data-v="list"`, `"export"`, `"rules"`). **Roadmap:** `docs/superpowers/plans/2026-11-02-cbam-rail-ui-00-roadmap.md`.

> **Environment notes (measured 2 Nov 2026):** macOS has no `timeout` command, so run Playwright in the foreground through the Bash tool's own timeout. The Chromium project is `chromium-tier0`; there is no `chromium`. `npm run test:unit` must run **after** `npm run build`, because about 59 OBOS and heat-map unit tests read `dist/`.

> **Branching (orchestrator note, 2 Nov):** the integration branch `feat/cbam-rail-ui` is LOCAL until the user OKs a push. Every `feat/cbam-rail-ui` below means the local branch; each phase branches from it after the previous phase has been merged into it locally.

---

## Standing rules (paste above every task)

- **S1. Where.** Worktree `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p4`, branch `feat/cbam-rail-ui-p4` (cut from `feat/cbam-rail-ui` after phase 3 merged). Every scratch file goes under `/Volumes/OBOSLab/tmp/cbam-rail-p4/`, never `~/` or `/tmp`. Never `git stash`. Stage named paths only, never `git add -A`.
- **S2. The engine stays verbatim.** Never edit a file listed in `src/scripts/cbam-algos/UPSTREAM.json`. `cbam-app.ts` is ours and may change.
- **S3. No assertion is loosened.** If a test blocks you, the code is wrong. A hook (`cb-line`, `cb-thresh`, `cb-total`, `cb-cost`, `cb-fig`, `cb-tag`, `data-remove`, `data-attest`, `data-line`, …) is renamed only together with every test that reads it, in the same commit — and this plan renames none.
- **S4. Source-count pins.** `tests/unit/cbam-render.test.mjs` counts, in `cbam-app.ts` with comment lines stripped: `renderAttestation(` = 3, `renderAttestation(…hasFigure(e))` = 2, `hasFigure(` = 2, `isAttested(` = 5, `=== 'verified-direct+default-indirect'` / `!==` = 1. Add no call or comparison of these to `cbam-app.ts`.
- **S5. Grep, never count from memory.** Before claiming "N callers" or "N tests", run the grep and list every hit.
- **S6. Local gate, foreground.** `npm run check`, `npm run test:unit` (after a build), and the named Playwright spec with `--project=chromium-tier0 --reporter=line`, foreground, Bash timeout 600000. No visible browser window, ever; screenshots are headless. The full Playwright matrix runs in CI.
- **S7. Budget.** About 30–45 minutes per task. If you pass 60, stop and report what is done and what blocks you.

---

## What phases 2 and 3 are assumed to have delivered

Phase 2 and 3 plans were not written when this plan was. Task 1 verifies every item below and records the real names. **If a name differs, use the real one at the call sites this plan names; never add a second implementation or a wrapper.** If an item is missing entirely, Task 1 says what to do.

| Item | Assumed | Used by |
|---|---|---|
| `src/styles/cbam-bento.css` | Exists, imported by the page, every selector scoped under `.cbx`, and holding the preview's shared primitives under their preview names: `.b-bento .b-t .b-s2 .b-s4 .b-r2 .b-hero .b-t-h .b-t-ti .b-t-sub .b-t-foot .b-mid .b-mega .b-u .b-tags .b-tag .b-lead .b-lead2 .b-add .b-thr .b-fp .chip .chip.bronze .chip.cyan .kv .foot .num .btn` | Tasks 4–8, 10 |
| `src/scripts/cbam-ui/fingerprint.ts` | `export function renderFingerprint(hash: string, extraClass = ''): string` (as phase 2 defines it; pass `'b-fp-sm'` for the small grid) → `<div class="b-fp" aria-hidden="true">` (or `b-fp b-fp-sm`) with 64 `<i>` children, `class="on"` for a 1 bit, read MSB-first from the first 16 hex digits (the preview's rule-pack grid for `f6af39ae…` starts on,on,on,on,off,on,on,off) | Tasks 6, 7 |
| `src/scripts/cbam-ui/format.ts` | `export const esc`, `num`, `eur`, moved from `cbam-app.ts` | Tasks 2–7 |
| Estimate | `#cbOut` previews the draft through phase-2 tiles; whether `renderDraftThreshold` still calls `renderYearThreshold` is recorded in Task 1 | Task 3 |
| Three years / Why | Restyled as tiles (no unstyled `cb-*` card left on those views) | Task 11 (Light default) |

---

## Decisions in this phase

**D4 — measured (engineering).** The method footnote says "183 of 574 offered goods currently resolve that way, and 181 of those are iron and steel". Re-measured on 2 Nov 2026 against the shipped pack (`packSha256 cc1d817b…`, 572 classifications), by two independent methods that agree:

- **What is counted:** an offered good (`pack.classifications`) counts when at least one production route has a **published 2026 direct default value** for it (at any origin, via the engine's own `selectFactorFromPack`), yet `estimateFromPack` for that good, origin and route on 15 March 2026 **refuses with a `benchmark/…` selector** — the Commission publishes no Column B benchmark the engine can match, and the engine refuses rather than borrow a nearby one.
- **Result:** **28 of 572 goods**, through **56 good × route pairs**, **all 28 iron and steel** (`sectorForCn`). **0** goods have every default route refused. Example: 72052100 on (C) and (E).
- Method 1 swept every origin × the 9-route default vocabulary through `selectFactorFromPack` (10 s). Method 2 pre-filtered origins from the 2026 direct default rows whose `scopeCode` prefixes the good, then confirmed each with `selectFactorFromPack` (2 s). Both: 28 / 56 / all iron and steel.
- **Why the old figures differ:** the old count predates the benchmark-vocabulary fix and the 572-good pack. The preview's "421 of 572" counts something else (goods that *gained* a route when `routesFor` widened; see its docblock in `estimate-from-pack.ts`). The preview NOTES' "0 of 572" counted only routes the form *offers*, and `routesFor` already withholds every unbenchmarked route, so that sweep could never see one.
- **Printed sentence** (Task 7; the wording beyond the number goes to the founder to confirm, because "shows no deduction" is no longer what happens — the engine refuses and the form does not offer the route): "…Where the Commission has not published a benchmark matching a production route, this tool shows no figure rather than substituting a nearby one — 28 of 572 offered goods have at least one such route, and all 28 are iron and steel."
- Task 7 commits the measurement as a unit test, so a regenerated pack that moves the count turns the suite red.

**D1 — CEO-pending.** Task 9 is the only place the banner can move. It is isolated and skippable, and spells out both outcomes. Every other task assumes the default: **the full banner stays on Estimate; the eyebrow moves to the Rules framing tile** (spec §11 default "Full banner visible on Estimate; eyebrow kept on Rules").

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `src/scripts/cbam-ui/tiles-list.ts` | create | List prose (moved), `yearTile`, `totalTile`, `linePlate`, `refusedLinePlate`, `thresholdErrorTile`, `listView`, `shareOfTotal`, `rulerScale` |
| `src/scripts/cbam-ui/tiles-export.ts` | create | `csvTileBody`, `docTileBody`, `fingerprintsBody` |
| `src/scripts/cbam-ui/tiles-rules.ts` | create | `renderRulePack`, `renderNotYetPublished`, `renderSources` |
| `src/scripts/cbam-ui/title-card.ts` | modify | Final form: origin code, route wording, formatted date, short phone line |
| `src/scripts/cbam-algos/cbam-app.ts` | modify (not vendored) | Imports moved prose; `renderTotals` retired; `renderLineCard` adapter; `renderAll` composes tiles; Export and Rules painters; `[data-load-pack]` |
| `src/pages/cbam/cbam-calculator.astro` | modify | List, Export, Rules markup; eyebrow to Rules; theme default; (Task 9) banner |
| `src/styles/cbam-bento.css` | append | List, Export, Rules tiles; `cb-*` hooks inside tiles |
| `tests/unit/cbam-render.test.mjs` | modify | Ports (ledger below); D1 pins only in Task 9 |
| `tests/unit/cbam-tiles-list.test.mjs` | create | New tile tests |
| `tests/unit/cbam-tiles-export.test.mjs` | create | Export bodies |
| `tests/unit/cbam-rules-view.test.mjs` | create | Rules renderers and the D4 measurement pin |
| `tests/unit/cbam-title-card.test.mjs` | modify | Final title-card format |
| `tests/e2e/cbam-lines.spec.ts` | modify (append one describe) | List, Export (real CSV), Rules |
| `tests/e2e/cbam-contrast.spec.ts` | create | OS-default theme; axe colour contrast on six views × two themes |

---

## Test-port ledger (hard constraint, spec §6.1)

Measured on `447b4ac`: `cbam-render.test.mjs` has **145** tests (`grep -c "^test(" tests/unit/cbam-render.test.mjs`). **64** of them call, outside comments, `renderYearThreshold`, `yearCardFor`, `renderTotals`, `renderLineCard`, `renderAttestation`, `buildPrintDocument` or `docOf`. Each is listed here with its port. "Unchanged" means the function it calls keeps its name, signature and pinned output, and the test runs as it is. No test is deleted, skipped or loosened. The count after the phase must be ≥ 145.

**Year cards — 12 tests. Port: run every assertion on each renderer in `YEAR_RENDERERS` (Task 3).** `YEAR_RENDERERS` is `[['yearTile', yearTile], ['renderYearThreshold', renderYearThreshold]]` while the draft card still uses `renderYearThreshold`, and `[['yearTile', yearTile]]` if Task 1 finds it has no caller left (then it is deleted).
1. `renderYearThreshold: a year without a rule refuses to invent one`
2. `renderYearThreshold: below-attested says so and names its basis` (includes the exact `ATTESTATION_SENTENCE` pin)
3. `renderYearThreshold: a below-threshold verdict says which lines its test did not cover` (exact `ATTESTATION_SENTENCE_WITH_EXCLUSION` pin)
4. `renderYearThreshold: a year with nothing excluded carries no exclusion sentence`
5. `renderYearThreshold: the exclusion sentence agrees with itself in number`
6. `renderYearThreshold: only the below-threshold verdict carries the exclusion note`
7. `renderYearThreshold: above hides the checkbox — a fact needs no attestation`
8. `renderYearThreshold: indeterminate is tagged pending, not the green of a real below-threshold verdict`
9. `the threshold card always cites the amending regulation` — its `yearCardFor` half loops over `YEAR_RENDERERS`; the `renderThreshold` half is unchanged.
10. `the two threshold cards name a sector identically — "iron & steel", never "iron and steel"` — `yearCardFor` takes the renderer as a parameter; the comparison runs per renderer.
11. `a year with no published threshold row gets a card on the PREVIEW too, not silence` — keeps `assert.equal(html, renderYearThreshold(…))` while that function exists, and **gains** a parity assertion that the draft card and `yearTile` carry the same tag span and the same `<p class="cb-sub">` sentence. If `renderYearThreshold` is retired, the `assert.equal` becomes that parity assertion (the draft card is then phase 2's, and parity with the List tile is what the test exists to guard).
12. `buildPrintDocument's §2 verdict matches what renderYearThreshold's own card shows, for both branches of the union` — the tag extraction loops over `YEAR_RENDERERS`.

**Totals — 10 tests. Port: rename the call `renderTotals(` → `totalTile(` (Task 4). Assertions byte-identical.** `totalTile` keeps the `cb-tag` span, `<div class="cb-fig">`, `<div class="cb-u">`, `<div class="cb-cost">`, every sentence, and the "Total exposure · N line(s)" text.
13. `renderTotals: a pending total is tagged a what-if and shows no false euro`
14. `renderTotals: a final priced total shows the euro figure and no what-if language`
15. `renderTotals: a non-numeric costEur never prints as "€NaN" or the literal text "null"`
16. `renderTotals: a whitespace-only costEur never prints as an invented "€0.00"`
17. `renderTotals: every entered line refused reads as a warning, never a claimed zero`
18. `renderTotals: no lines entered yet is a neutral empty state, not the same red as a refusal`
19. `C2: renderTotals shows exempt lines OUTSIDE the total, with their own figures`
20. `C2: when every priced line is exempt, the total is a stated nil, not "No lines yet"`
21. `C2: without exempt lines, renderTotals is unchanged`
22. `C2 follow-up: the exempt amount says it is a what-if when it is one`

(The test names keep the word "renderTotals": renaming a test title is churn with no benefit, and the ledger above maps it.)

**Line cards and attestation — 22 tests. Port: unchanged.** `renderLineCard(line, e, index, comparison?)` keeps its signature (a fifth optional argument is added) and still emits the result card, attestation and delta strings unmodified, inside the plate.
23. `renderLineCard: 1-based numbering, the remove control carries the id, and user text is escaped`
24. `renderLineCard: a cleared mass field reads as missing, never a false zero`
25. `renderLineCard: a whitespace-only mass field reads as missing, never a false zero`
26. `renderAttestation gates on the TIER, not on an external if — the preview shipped without one`
27. `renderLineCard: a verified line says the figures are the user's own claim, unconfirmed here, and cites the reference`
28. `renderLineCard: a verifier reference is free text, and is escaped like every other user string`
29. `renderLineCard: a verified line with no reference cites none, rather than an empty "Ref:"`
30. `renderLineCard: the delta names BOTH the Commission default and the difference the data is worth`
31. `renderLineCard: the delta reverses honestly when the verified figure is WORSE than the marked-up default`
32. `renderLineCard: verified figures that land exactly on the default claim no difference at all`
33. `renderLineCard: no published default means no comparison — and the card says so instead of inventing one`
34. `renderLineCard: an uncomputed comparison never claims the Commission publishes no default`
35. `renderLineCard: a REFUSED verified line shows no comparison figure — NON-NEGOTIABLE 2 outranks the delta`
36. `renderLineCard: a default-tier line renders NO delta and NO attestation, even if a comparison is handed to it`
37. `renderAttestation on a MIXED line names both halves — attested direct, Commission electricity`
38. `renderLineCard: a MIXED line gets its attestation AND its delta, and the delta isolates the direct half`
39. `renderAttestation: a REFUSED mixed line drops the electricity clause — the card has no such component` (also holds the source-count pins of rule S4)
40. `renderAttestation: a PRICED mixed line still says both halves, mark-up included`
41. `renderAttestation: a REFUSED fully-verified line keeps ATTESTED_NOTE unchanged`
42. `renderAttestation: a default-tier line still says nothing, priced or refused`
43. `renderAttestation: a call that cannot answer "priced?" must not answer it by default`
44. `the residual-indirect note reaches the card, and only where the fallback was residual`
45. `a REFUSED mixed line drops the residual-indirect note — no figure, no provenance claim`
46. `the attestation question has ONE spelling and five call sites — the only pin defaultPathComparison can have` (source-count pin, rule S4)

**Print document — 18 tests. Port: unchanged.** `buildPrintDocument` is not edited. It reads `yearVerdictTag` from its new home (Task 2), moved verbatim, and Task 2 proves the document byte-identical on fixtures before and after.
47. `an all-refused print document states there is no total rather than a total of zero`
48. `buildPrintDocument carries all four §4 caveats, the real OJ hashes, and the injected date`
49. `buildPrintDocument never prints the pack's all-zero placeholder as though it were a real digest`
50. `buildPrintDocument throws a named error on a lines/results length mismatch, rather than crash blind`
51. `buildPrintDocument shows a THROWN line in §1 rather than dropping it silently`
52. `buildPrintDocument: a mix of ok, unavailable and thrown lines all print distinctly`
53. `the document gains a fifth §4 caveat when a line was priced from attested figures`
54. `the document carries NO verified caveat when no line claims the verified tier`
55. `§4 is exactly the pinned caveats — no sixth item — in both shapes it can take`
56. `the §4 caveat stands even when the verified line was REFUSED`
57. `§1 marks a verified row and transcribes the reference the importer cited`
58. `§1 shows no reference label for a verified line that cited none`
59. `§1 prints NO reference beside a defaults-tier row, even one carrying a stray reference`
60. `§1 escapes the verifier reference — it is free text the user typed`
61. `§1 transcribes the verifier reference on a MIXED row — it certifies the half that is real`
62. `§4 carries the verified caveat for a document of ONLY mixed lines, and says which half is which`
63. `§1 stays rectangular across ordinary, refused, thrown and verified rows`
64. `the document never leaks the per-line delta — that figure is presentation, not record`

(Test 12 above also builds a print document; it is counted once, under year cards.)

**Banner and eyebrow — 1 test, `NON-NEGOTIABLE 1 — the banner names both tiers, and concedes everything it conceded before`.** Unchanged unless Task 9 runs. Quoted and ported in Task 9.

**`#cbStatus` summary — no unit test exists** (it is written inside `initCbam`, which needs a DOM). It survives because its builder in `renderAll` is not edited and its helpers move verbatim. Its e2e guards, run in Tasks 5 and 12: in `cbam-lines.spec.ts`, `#cbStatus does not go stale when the last line is removed`, `a year with no published threshold rule is named in the announcement, not just the card`, `C2: an attested below-threshold year leaves the total`, `the whole verified flow: reveal the panel, refuse a half-made claim, attest, and carry the claim into the CSV`, `a second caller of the pack loader does not reset an origin already chosen`, `a failure inside onAdd surfaces to #cbStatus and re-enables #cbAdd`; in `cbam-shell.spec.ts`, `remove and attest work on the List view and are announced`.

**Focus after remove and attest:** `onOutClick` is not edited. Guarded by `remove-focus lands on the button that slid into the removed line's index` (ends on `#cbxH-list`, the phase-1 rule), `attestation flips indeterminate to below-threshold and back, restoring checkbox focus` (`cbam-lines.spec.ts`) and the shell spec's remove test.

**Untouched files:** `cbam-lines.test.mjs` (model layer, CSV columns) and `build-contracts.test.mjs` (idle-copy contract: it reads the FIRST `<p class="cb-idle">` in the page, so no new markup may use that class).

**Unmappable: none.** Five threshold tests (`a line under 50 t is INDETERMINATE, never exempt`, `a line over 50 t is ABOVE the threshold…`, `hydrogen and electricity are outside the exemption…`, `the other three nulls stay silent…`, `a year that HAS a published row is untouched…`) cover the Estimate draft card, which is phase 2's, and are not touched here.

---

### Task 1: Worktree, baseline, prerequisites, before-snapshots

**Files:** none committed.

- [ ] **Step 1: Confirm phase 3 has merged into the integration branch.**

```bash
git -C /Volumes/VSTSAMPLES/Projects/Angad fetch origin
git -C /Volumes/VSTSAMPLES/Projects/Angad log --oneline feat/cbam-rail-ui -20
```

Expected: phase 2 and phase 3 merge commits on top of `447b4ac`. If either is missing, **stop and report**.

- [ ] **Step 2: Create the worktree.**

```bash
cd /Volumes/VSTSAMPLES/Projects/Angad
git worktree add -b feat/cbam-rail-ui-p4 /Volumes/OBOSLab/worktrees/cbam-rail-ui-p4 feat/cbam-rail-ui
cd /Volumes/OBOSLab/worktrees/cbam-rail-ui-p4 && npm ci
mkdir -p /Volumes/OBOSLab/tmp/cbam-rail-p4
```

- [ ] **Step 3: Baseline.**

```bash
npm run check && npm run build && npm run test:unit 2>&1 | tail -8
grep -c "^test(" tests/unit/cbam-render.test.mjs
grep -c "^\s*test(" tests/e2e/cbam-lines.spec.ts tests/e2e/cbam-shell.spec.ts
```

Record: `# pass N`, the render-test count (145 at `447b4ac`; phases 2–3 may have added some), and both e2e counts.

- [ ] **Step 4: Verify the phase 2–3 prerequisites and record the real names.**

```bash
ls src/styles/cbam-bento.css src/scripts/cbam-ui/
grep -n "cbam-bento.css" src/pages/cbam/cbam-calculator.astro
for c in b-bento b-t b-s2 b-s4 b-r2 b-hero b-t-h b-t-ti b-t-sub b-t-foot b-mid b-mega b-u b-tags b-tag b-lead b-lead2 b-add b-thr b-fp chip kv foot num btn; do
  printf '%-8s %s\n' "$c" "$(grep -cE "\.$c([^a-z0-9-]|$)" src/styles/cbam-bento.css)"; done
grep -n "^export" src/scripts/cbam-ui/fingerprint.ts src/scripts/cbam-ui/format.ts
grep -n "renderYearThreshold\|renderTotals\|renderLineCard\|renderThreshold(" src/scripts/cbam-algos/cbam-app.ts src/scripts/cbam-ui/*.ts | grep -v "^\S*:\s*[0-9]*:\s*\*"
```

Write into the task report:
- every primitive with count 0 (Task 10 copies it verbatim from the preview);
- the exact signature of phase 2's fingerprint export. If it is not `renderFingerprint(hex, size?)`, Tasks 6 and 7 use the real name at their one import line each;
- whether `format.ts` exports `esc`, `num`, `eur`. If not, Task 2 Step 1 creates it. **If it does, diff its `esc` against the one `cbam-app.ts` had at `447b4ac`** (`git show 447b4ac:src/scripts/cbam-algos/cbam-app.ts | grep -n "const esc" -A1`): it must map `"` to `&quot;` and `'` to `&#39;`, because `renderLineCard: 1-based numbering…` pins `data-remove="L1&quot;&gt;…"`. A numeric-entity `esc` (like `title-card.ts`'s private one) would fail that pin — report it rather than edit the test;
- **every caller of `renderYearThreshold`**. If `renderDraftThreshold` (or any non-List code) still calls it, it stays; if `renderAll` is its only caller, Task 3 retires it.

- [ ] **Step 5: Snapshot today's outputs, to prove the moves byte-identical later.** Write `/Volumes/OBOSLab/tmp/cbam-rail-p4/snap.mjs`:

```js
// Before/after snapshot of every list renderer whose helpers this phase moves.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.argv[2], out = process.argv[3];
const app = await import(pathToFileURL(`${root}/src/scripts/cbam-algos/cbam-app.ts`).href);
const { estimateFromPack } = await import(pathToFileURL(`${root}/src/scripts/cbam-algos/estimator/estimate-from-pack.ts`).href);
const { sumTotals } = await import(pathToFileURL(`${root}/src/scripts/cbam-lines.ts`).href);
const pack = JSON.parse(readFileSync(`${root}/public/cbam/estimator-pack.json`, 'utf8'));
const S = pack.thresholds[0].includedSectors;
const base = { calendarYear: 2026, ruleFound: true, thresholdT: '50', sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)', entryIds: ['L1'], entryHashes: ['a'.repeat(64)], includedSectors: S };
const years = [
  { calendarYear: 2027, ruleFound: false, attested: false, eligibleLineCount: 0 },
  { ...base, state: 'below_threshold', knownEligibleMassT: '30', attested: true, eligibleLineCount: 1, linesInYear: 1 },
  { ...base, state: 'below_threshold', knownEligibleMassT: '40', attested: true, eligibleLineCount: 1, linesInYear: 3 },
  { ...base, state: 'indeterminate', knownEligibleMassT: '30', attested: false, eligibleLineCount: 1, linesInYear: 2 },
  { ...base, state: 'above_threshold', knownEligibleMassT: '60', attested: false, eligibleLineCount: 1, linesInYear: 2 },
];
const e = estimateFromPack(pack, { cn: '2523100090', country: 'DZ', route: '(A)', massT: '30', date: '2026-03-15' });
const line = { id: 'L1', cn: '2523100090', country: 'DZ', route: '(A)', scope: 'direct', massT: '30', date: '2026-03-15', tier: 'default+markup' };
const snap = {
  years: app.renderYearThreshold ? years.map(app.renderYearThreshold) : null,
  doc: app.buildPrintDocument({ lines: [line], results: [e], yearCards: years, totals: sumTotals([e]), exempt: sumTotals([e]), packSnapshot: 'f'.repeat(64), rulePackages: ['p@1'], pack, generatedOn: '2026-08-08' }),
  draft2027: app.renderDraftThreshold(pack, { cn: '2523100090', massT: '30', date: '2027-03-15' }),
};
writeFileSync(out, JSON.stringify(snap, null, 1));
console.log('wrote', out);
```

Run: `node --import tsx /Volumes/OBOSLab/tmp/cbam-rail-p4/snap.mjs "$PWD" /Volumes/OBOSLab/tmp/cbam-rail-p4/before.json`

Expected: `wrote …/before.json`. Nothing to commit.

---

### Task 2: Move the list prose into `tiles-list.ts`

**Files:**
- Create: `src/scripts/cbam-ui/tiles-list.ts` (and `src/scripts/cbam-ui/format.ts` only if Task 1 found it missing)
- Modify: `src/scripts/cbam-algos/cbam-app.ts`

This task moves code and changes no output. **MOVE, never retype:** cut each block with its doc comment and paste it unchanged, then add `export`.

- [ ] **Step 1 (only if Task 1 found no `format.ts`):** create `src/scripts/cbam-ui/format.ts` by cutting the `const esc = …`, `const num = …` (with its doc comment) and `const eur = …` (with its doc comment) blocks from the top of `cbam-app.ts`, verbatim, each prefixed with `export`. Head the file with:

```ts
// src/scripts/cbam-ui/format.ts
// HTML escaping and the two number formats every CBAM renderer shares. Moved verbatim from
// cbam-app.ts (rail redesign phase 4) so the tile modules can use them without importing the
// controller. One spelling: a second `num` would be a second way to print a blank mass as zero.
```

In `cbam-app.ts` add `import { esc, eur, num } from '../cbam-ui/format.ts';` beside the other `../cbam-ui/` import.

- [ ] **Step 2: Create `tiles-list.ts` and move the prose into it.** Start the file with:

```ts
// src/scripts/cbam-ui/tiles-list.ts
// The Shipment list view's tiles (spec §5.4): Total, Annual de minimis per year, one plate per line.
// Pure functions returning HTML strings, the same pattern as every other CBAM renderer.
//
// THE RULE FOR EVERY TILE IN THIS FILE. The honesty markup inside a tile — each cb-tag span, each
// <p class="cb-sub"> sentence, the attest label, cb-fig / cb-n / cb-u / cb-cost, cb-prov — is
// emitted byte-for-byte as the pre-redesign cards emitted it, because tests/unit/cbam-render.test.mjs
// pins it exactly, closed at both ends, against paraphrase. The b- classes go on the tile shell and
// on new presentational elements only. Restyle a cb-* hook in cbam-bento.css; never rename it here.
//
// The prose helpers below moved here from cbam-app.ts, which imports them back: the List tiles,
// the Estimate draft card, the #cbStatus announcement and the print document must say a verdict
// with ONE spelling, and they can only do that if they read the same function.
import type { YearThreshold } from '../cbam-lines.ts';
```

(Tasks 3 and 4 extend these imports as they add code; importing unused names now would trip `astro check`.)

Then cut from `cbam-app.ts`, in this order, and paste below that header, each with its full doc comment, each prefixed with `export`:
1. `const AMENDED_BY_2025_2083 = …` (anchor: its doc comment "The 50 t de minimis figure itself lives in the consolidated Art 2(3)")
2. `const SECTOR_PROSE …` (anchor: "How a threshold sector KEY is said")
3. `const sectorList = …` (anchor: `"cement, iron & steel, aluminium and fertiliser"`)
4. `const yearVerdictTag = …` (anchor: "The per-year card's own tag text")
5. `const refusedLineNote = …` (anchor: `"N line(s) has/have no estimate`). Its doc comment sits two comments above it, separated by `orList`'s comment: move only `refusedLineNote`'s own comment with it, and leave `orList` and its comment in `cbam-app.ts`.
6. `const totalsTag = …` (anchor: "The totals card's own tag text")

In `cbam-app.ts`, add:

```ts
import {
  AMENDED_BY_2025_2083, refusedLineNote, sectorList, totalsTag, yearVerdictTag,
} from '../cbam-ui/tiles-list.ts';
```

`SECTOR_PROSE` is read only by `sectorList`, so it is not imported back. Do not touch `orList`.

- [ ] **Step 3: Type-check, then prove the output unchanged.**

```bash
npm run check
node --import tsx /Volumes/OBOSLab/tmp/cbam-rail-p4/snap.mjs "$PWD" /Volumes/OBOSLab/tmp/cbam-rail-p4/after-t2.json
cmp /Volumes/OBOSLab/tmp/cbam-rail-p4/before.json /Volumes/OBOSLab/tmp/cbam-rail-p4/after-t2.json && echo IDENTICAL
node --import tsx --test tests/unit/cbam-render.test.mjs 2>&1 | tail -4
```

Expected: check clean, `IDENTICAL`, render tests all pass.

- [ ] **Step 4: Rule S4 still holds.**

```bash
node -e 'const s=require("fs").readFileSync("src/scripts/cbam-algos/cbam-app.ts","utf8").split("\n").filter(l=>!/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");for(const r of [/renderAttestation\(/g,/\bhasFigure\(/g,/\bisAttested\(/g,/[!=]==\s*.verified-direct\+default-indirect./g])console.log(r,(s.match(r)||[]).length)'
```

Expected: 3, 2, 5, 1.

- [ ] **Step 5: Commit.**

```bash
git status --short
git add -- src/scripts/cbam-ui/tiles-list.ts src/scripts/cbam-algos/cbam-app.ts
git add -- src/scripts/cbam-ui/format.ts   # only if Step 1 created it
git commit -m "refactor(cbam): list prose moves to tiles-list.ts, one spelling for every surface"
```

---

### Task 3: `yearTile` — the Annual de minimis plate

**Files:**
- Modify: `src/scripts/cbam-ui/tiles-list.ts`, `src/scripts/cbam-algos/cbam-app.ts` (`renderYearThreshold` only)
- Test: `tests/unit/cbam-render.test.mjs` (port), `tests/unit/cbam-tiles-list.test.mjs` (create)

The verdict sentence and the attest control get one implementation each, which `renderYearThreshold` (while it lives) and `yearTile` both call. That is what stops the draft card and the List tile from drifting.

- [ ] **Step 1: Extract the sentence pieces from `renderYearThreshold`, without changing output.** In `tiles-list.ts`, extend the imports to:

```ts
import Decimal from 'decimal.js';
import type { YearThreshold } from '../cbam-lines.ts';
import { esc, num } from './format.ts';
```

Then append:

```ts
type FoundYear = Extract<YearThreshold, { ruleFound: true }>;

/** The no-rule sentence, already escaped. One spelling for the draft card and the List tile. */
export const noRuleSentence = (calendarYear: number): string =>
  `No de minimis threshold has been published for ${esc(String(calendarYear))}. We show no verdict rather than assume one.`;
```

Then, in `cbam-app.ts`'s `renderYearThreshold`, **cut** the three statements that compute `excluded`, `outside` and `sub` (with every comment between and above them, from the comment starting "Art 2(3) is a MASS test" to the end of the `const sub = …;` statement), and **cut** the `const attest = …;` statement. Paste them into `tiles-list.ts` as the bodies of these two functions, so that they read:

```ts
/**
 * The verdict sentence for a year with a published rule — the text inside its <p class="cb-sub">.
 * Moved verbatim out of renderYearThreshold so the List tile and the draft card share it.
 */
export function yearSentence(y: FoundYear): string {
  const above = y.state === 'above_threshold';
  const below = y.state === 'below_threshold';
  // …the pasted comments and the `excluded`, `outside` and `sub` statements, unchanged…
  return sub;
}

/** The completeness checkbox, or '' when the year is above the threshold (a fact needs no attestation). */
export function attestControl(y: FoundYear): string {
  const above = y.state === 'above_threshold';
  // …the pasted `const attest = …;` statement, unchanged…
  return attest;
}
```

Back in `renderYearThreshold`, replace the no-rule paragraph's text with `${noRuleSentence(y.calendarYear)}`, `${sub}` with `${yearSentence(y)}`, and `${attest}` with `${attestControl(y)}`. Keep its `above`/`below`/`tone`/`tag` lines (it still needs `tone`). Import `noRuleSentence, yearSentence, attestControl` in `cbam-app.ts`.

Run Task 1's snapshot again to `after-t3a.json` and `cmp` it with `before.json`. Expected: `IDENTICAL`. **If it differs, fix the move before going on.**

- [ ] **Step 2: Write the failing tests for `yearTile` and `rulerScale`.** Create `tests/unit/cbam-tiles-list.test.mjs`:

```js
// tests/unit/cbam-tiles-list.test.mjs
// The Shipment list's tiles (spec §5.4). The honesty prose they carry is pinned in
// cbam-render.test.mjs; this file covers what the tiles add: the shells, the ruler, shares.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { rulerScale, yearTile } from '../../src/scripts/cbam-ui/tiles-list.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));
const S = pack.thresholds.find((t) => t.calendarYear === 2026).includedSectors;
const found = (over) => ({
  calendarYear: 2026, ruleFound: true, state: 'above_threshold', knownEligibleMassT: '260', thresholdT: '50',
  sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)', entryIds: ['L1'], entryHashes: ['a'.repeat(64)],
  attested: false, eligibleLineCount: 3, linesInYear: 3, includedSectors: S, ...over,
});

test('rulerScale: the scale ends at the next whole multiple of the threshold, never below twice it', () => {
  // The preview's case: 260 t against 50 t draws a 0–300 t ruler, the fill at 86.7%, the mark at 16.7%.
  assert.deepEqual(rulerScale('260', '50'), { fillPct: '86.7', markPct: '16.7', maxT: '300' });
  // Under the threshold the scale is twice the threshold, so the mark sits mid-ruler.
  assert.deepEqual(rulerScale('30', '50'), { fillPct: '30.0', markPct: '50.0', maxT: '100' });
  // Exactly on a multiple fills the ruler and does not add an empty step.
  assert.deepEqual(rulerScale('300', '50'), { fillPct: '100.0', markPct: '16.7', maxT: '300' });
});

test('rulerScale: an unreadable or impossible input draws no ruler rather than a made-up one', () => {
  for (const [m, t] of [['', '50'], ['abc', '50'], ['-1', '50'], ['30', '0'], ['30', ''], ['Infinity', '50']]) {
    assert.equal(rulerScale(m, t), null, `${m} / ${t}`);
  }
});

test('yearTile: a tile shell around the pinned honesty markup, with the hooks the e2e suite reads', () => {
  const html = yearTile(found({}));
  assert.match(html, /^\s*<section class="b-t b-s2 cb-thresh">/, 'the e2e hook cb-thresh stays on the tile');
  assert.match(html, /<h2 class="b-t-ti">Annual de minimis\.<\/h2>/);
  assert.match(html, /<p class="b-t-sub">Eligible mass, 2026 · 3 lines<\/p>/, 'the line count the old row carried survives');
  assert.match(html, /<div class="b-mid num">260<span class="b-u">t<\/span><\/div>/);
  assert.match(html, /<div class="b-thr" aria-hidden="true"><b style="width:86\.7%"><\/b><em style="left:16\.7%"><\/em><\/div>/);
  assert.match(html, /<p class="b-t-foot num"><span>0<\/span><span>50 t threshold<\/span><span>300 t<\/span><\/p>/);
  assert.match(html, /<span class="cb-tag unavail">Above threshold<\/span>/);
});

test('yearTile: one eligible line is singular', () => {
  assert.match(yearTile(found({ eligibleLineCount: 1 })), /Eligible mass, 2026 · 1 line</);
});

test('yearTile: a no-rule year draws no ruler, no mass and no 50', () => {
  const html = yearTile({ calendarYear: 2027, ruleFound: false, attested: false, eligibleLineCount: 0 });
  assert.match(html, /<span class="cb-tag pending">No published rule<\/span>/);
  assert.doesNotMatch(html, /b-thr|b-mid/);
  assert.doesNotMatch(html, /50/);
});

test('yearTile: an unreadable mass keeps the verdict and drops only the ruler', () => {
  const html = yearTile(found({ knownEligibleMassT: 'abc' }));
  assert.doesNotMatch(html, /b-thr/);
  assert.match(html, /cb-tag unavail/);
});
```

Run: `node --import tsx --test tests/unit/cbam-tiles-list.test.mjs`. Expected: FAIL, `rulerScale` and `yearTile` are not exported.

- [ ] **Step 3: Implement.** Append to `tiles-list.ts`:

```ts
/**
 * The de minimis ruler: 0 to the next whole multiple of the threshold at or above the mass, and
 * never less than twice the threshold, so the threshold mark is always visible and never at the end.
 * Percentages to 1 dp, ROUND_HALF_UP. Null when either value is not a readable non-negative number
 * (or the threshold is not positive): the tile then draws no ruler, never a guessed one.
 */
export function rulerScale(massT: string, thresholdT: string): { fillPct: string; markPct: string; maxT: string } | null {
  let m: Decimal;
  let t: Decimal;
  try { m = new Decimal(massT); t = new Decimal(thresholdT); } catch { return null; }
  if (!m.isFinite() || !t.isFinite() || m.isNeg() || t.lte(0)) return null;
  const max = t.times(Decimal.max(2, m.div(t).ceil()));
  const pct = (x: Decimal) => x.div(max).times(100).toFixed(1, Decimal.ROUND_HALF_UP);
  return { fillPct: pct(m), markPct: pct(t), maxT: max.toString() };
}

/**
 * One Annual de minimis plate per calendar year in the list (spec §5.4). The successor of
 * renderYearThreshold on the List view: same tag, same sentence, same checkbox, same citation,
 * drawn as a tile with the eligible mass as its numeral and a ruler against the threshold.
 */
export function yearTile(y: YearThreshold): string {
  const year = esc(String(y.calendarYear));
  if (!y.ruleFound) return `
    <section class="b-t b-s2 cb-thresh">
      <div class="b-t-h"><div><h2 class="b-t-ti">Annual de minimis.</h2><p class="b-t-sub">${year}</p></div>
        <span class="cb-tag pending">${esc(yearVerdictTag(y))}</span></div>
      <p class="cb-sub">${noRuleSentence(y.calendarYear)}</p>
    </section>`;
  const above = y.state === 'above_threshold';
  const below = y.state === 'below_threshold';
  // The same tones as renderYearThreshold: indeterminate is 'pending', never the 'ok' of a real verdict.
  const tone = above ? 'unavail' : below ? 'ok' : 'pending';
  const n = y.eligibleLineCount;
  const r = rulerScale(y.knownEligibleMassT, y.thresholdT);
  const ruler = r ? `
      <div class="b-thr" aria-hidden="true"><b style="width:${r.fillPct}%"></b><em style="left:${r.markPct}%"></em></div>
      <p class="b-t-foot num"><span>0</span><span>${num(y.thresholdT)} t threshold</span><span>${num(r.maxT)} t</span></p>` : '';
  return `
    <section class="b-t b-s2 cb-thresh">
      <div class="b-t-h"><div><h2 class="b-t-ti">Annual de minimis.</h2><p class="b-t-sub">Eligible mass, ${year} · ${n} line${n === 1 ? '' : 's'}</p></div>
        <span class="cb-tag ${tone}">${esc(yearVerdictTag(y))}</span></div>
      <div class="b-mid num">${num(y.knownEligibleMassT)}<span class="b-u">t</span></div>${ruler}
      <p class="cb-sub">${yearSentence(y)}</p>
      ${attestControl(y)}
      <p class="cb-prov">${esc(y.sourceLocator)} · ${AMENDED_BY_2025_2083}</p>
    </section>`;
}
```

Run: `node --import tsx --test tests/unit/cbam-tiles-list.test.mjs`. Expected: 6 pass.

- [ ] **Step 4: Port the 12 year-card tests (ledger 1–12).** In `cbam-render.test.mjs`:
  - add `import { yearTile } from '../../src/scripts/cbam-ui/tiles-list.ts';`;
  - directly after the `SECTORS_2026` constant, add:

```js
/**
 * Every renderer that draws a per-year de minimis card (rail redesign phase 4). The List view draws
 * yearTile; the Estimate draft card still draws renderYearThreshold for a year with no rule. Both
 * carry the same verdict prose, so every assertion below runs on each, and neither can drift.
 */
const YEAR_RENDERERS = [['yearTile', yearTile], ['renderYearThreshold', renderYearThreshold]];
```

  If Task 1 found `renderAll` to be `renderYearThreshold`'s only caller, write `[['yearTile', yearTile]]` instead, remove `renderYearThreshold` from the import, and delete the function from `cbam-app.ts` in Step 5.
  - **`yearCardFor`** sits above `SECTORS_2026`, so move the `YEAR_RENDERERS` constant above `yearCardFor` instead, and change `yearCardFor` to take the renderer: `const yearCardFor = (sector, render = renderYearThreshold) => render({ … })`, the body unchanged. (With `renderYearThreshold` retired, the default becomes `yearTile`.)
  - **Tests 1–8** (`renderYearThreshold: …`): wrap each body in `for (const [who, render] of YEAR_RENDERERS) { … }`, change `renderYearThreshold(` to `render(` inside, and append `` ` (${who})` `` to every assertion message that has one; add a message `who` to those without. Do not change any regex, constant or expected value.
  - **Test 9** (`the threshold card always cites the amending regulation`): the line that calls `yearCardFor(…)` (or `renderYearThreshold(…)`) becomes a loop over `YEAR_RENDERERS` passing `render` through.
  - **Test 10** (`the two threshold cards name a sector identically…`): wrap the per-sector comparison in the same loop, calling `yearCardFor(sector, render)`.
  - **Test 11** (`a year with no published threshold row gets a card on the PREVIEW too, not silence`): keep the `assert.equal(html, renderYearThreshold(…))` while the function exists, then add:

```js
  // Rail phase 4: the List draws the same year as a tile. The tile's shell differs; its verdict
  // must not. Same tag span, same sentence, both present.
  const pick = (h) => [
    h.match(/<span class="cb-tag [^"]+">[^<]+<\/span>/)?.[0],
    h.match(/<p class="cb-sub">[^<]+<\/p>/)?.[0],
  ];
  const tile = yearTile({ calendarYear: 2027, ruleFound: false, attested: false, eligibleLineCount: 0 });
  assert.ok(pick(html).every(Boolean), 'sanity: the draft card has a tag and a sentence');
  assert.deepEqual(pick(tile), pick(html), 'the List tile and the draft card say the same thing about 2027');
```

  (If `renderYearThreshold` is retired, delete only the `assert.equal` line; the parity block replaces it.)
  - **Test 12** (`buildPrintDocument's §2 verdict matches…`): wrap the `for (const y of [below, noRule])` loop in `for (const [who, render] of YEAR_RENDERERS)` and use `render(y)`; add `${who}` to both messages.

- [ ] **Step 5: Run and count.**

```bash
node --import tsx --test tests/unit/cbam-render.test.mjs tests/unit/cbam-tiles-list.test.mjs 2>&1 | tail -4
grep -c "^test(" tests/unit/cbam-render.test.mjs
git diff -U0 tests/unit/cbam-render.test.mjs | grep -E "^-\s*assert" || echo "no assertion line removed"
```

Expected: all pass; the render-test count equals the Task 1 baseline; the diff removes no `assert` line except lines re-added with `render(`/`who` (read each hit and say so in the report).

**Mutation check (rule: confirm a guard bites):** temporarily change `yearTile`'s below tone `'ok'` to `'pending'`, run the render tests, confirm test 8 fails for `yearTile`, restore.

- [ ] **Step 6: Commit.**

```bash
git add -- src/scripts/cbam-ui/tiles-list.ts src/scripts/cbam-algos/cbam-app.ts tests/unit/cbam-render.test.mjs tests/unit/cbam-tiles-list.test.mjs
git commit -m "feat(cbam): Annual de minimis tile; year-card pins run on every renderer"
```

---

### Task 4: `totalTile`, `linePlate`, refused and error plates, `listView`

**Files:**
- Modify: `src/scripts/cbam-ui/tiles-list.ts`, `src/scripts/cbam-algos/cbam-app.ts` (`renderTotals` removed, `renderLineCard` adapter, `tableFigures` exported)
- Test: `tests/unit/cbam-render.test.mjs` (rename call sites), `tests/unit/cbam-tiles-list.test.mjs`

- [ ] **Step 1: Write the failing tests.** Append to `tests/unit/cbam-tiles-list.test.mjs` (extend the import line to `import { linePlate, listView, refusedLinePlate, rulerScale, shareOfTotal, thresholdErrorTile, totalTile, yearTile } from '../../src/scripts/cbam-ui/tiles-list.ts';`):

```js
const T = (over) => ({ certificates: '474.049', costEur: '35901.31', chargeableTco2e: '474.049',
  pricedLines: 3, refusedLines: 0, anyPending: true, ...over });
const LINE = { id: 'L1', cn: '73063077', country: 'IN', route: '(C)', scope: 'direct', massT: '100',
  date: '2026-03-15', tier: 'default+markup' };
const PARTS = { result: '<section class="cb-card cb-res">R</section>', attestation: '', delta: '',
  tierLabel: 'Commission default + mark-up' };

test('shareOfTotal: a line\'s share of the total, judged against the exact ratio', () => {
  // 329.8275 / 474.0485 = 69.5769…% — the preview's "69.6%".
  assert.equal(shareOfTotal('329.8275', '474.0485'), '69.6');
  assert.equal(shareOfTotal('474.0485', '474.0485'), '100.0');
  // Exactly on a half: ROUND_HALF_UP, so 0.05% → '0.1', never banker's '0.0'.
  assert.equal(shareOfTotal('1', '2000'), '0.1');
});

test('shareOfTotal: no share without a real, positive total — a zero total is not 0%', () => {
  for (const [p, t] of [['1', '0'], ['1', ''], ['', '10'], ['x', '10'], ['-1', '10'], ['1', '-10']]) {
    assert.equal(shareOfTotal(p, t), null, `${p} / ${t}`);
  }
});

test('totalTile: a hero tile carrying the e2e hook, the actions and one bar segment per share', () => {
  const html = totalTile(T({}), null, ['69.6', '24.8', '5.6']);
  assert.match(html, /^\s*<section class="b-t b-s2 b-hero cb-total">/);
  assert.match(html, /<h2 class="b-t-ti">Total\.<\/h2>/);
  assert.match(html, /<div class="b-stackbar" aria-hidden="true"><b style="flex:69\.6"><\/b><b style="flex:24\.8"><\/b><b style="flex:5\.6"><\/b><\/div>/);
  assert.match(html, /data-goto="export"[^>]*>Export</);
  assert.match(html, /data-goto="estimate"[^>]*>Add a line</);
});

test('totalTile: no shares, no stack bar — never an empty bar that reads as zero', () => {
  assert.doesNotMatch(totalTile(T({}), null, []), /b-stackbar/);
  assert.doesNotMatch(totalTile(T({ pricedLines: 0, refusedLines: 2, certificates: '0', costEur: null }), null, ['50']), /b-stackbar/,
    'a total with nothing priced draws no bar even if a caller passes shares');
});

test('linePlate: the e2e hooks, the 1-based title, the tier chip, the summary line', () => {
  const html = linePlate(LINE, 0, PARTS, { goodName: 'Other tubes <welded>' });
  assert.match(html, /^\s*<article class="b-t b-pass cb-line" data-line="L1">/);
  assert.match(html, /<h2 class="b-t-ti">Line 1\.<\/h2>/);
  assert.match(html, /<span class="chip bronze"><i aria-hidden="true"><\/i>Commission default \+ mark-up<\/span>/);
  assert.match(html, /<p class="b-pass-name" title="Other tubes &lt;welded&gt;">Other tubes &lt;welded&gt;<\/p>/);
  assert.match(html, /73063077 · IN · \(C\) · 100 t · 2026-03-15/);
  assert.match(html, /<button type="button" class="b-rm cb-line-x" data-remove="L1" aria-label="Remove line 1">Remove<\/button>/);
  assert.ok(html.includes(PARTS.result), 'the result card is carried verbatim');
});

test('linePlate: verified tiers wear cyan, the mixed tier wears both colours', () => {
  assert.match(linePlate({ ...LINE, tier: 'actual-verified' }, 0, { ...PARTS, tierLabel: 'Verified actual' }), /<span class="chip cyan"><i aria-hidden="true"><\/i>Verified actual<\/span>/);
  const mixed = linePlate({ ...LINE, tier: 'verified-direct+default-indirect' }, 0, { ...PARTS, tierLabel: 'Verified direct + Commission indirect' });
  assert.match(mixed, /<span class="chip cyan"><i aria-hidden="true"><\/i>Verified direct<\/span><span class="chip bronze"><i aria-hidden="true"><\/i>Commission indirect<\/span>/);
});

test('linePlate: a share draws a bar; an exempt line says so instead; neither, nothing', () => {
  const shared = linePlate(LINE, 0, PARTS, { sharePct: '69.6' });
  assert.match(shared, /<div class="b-share-row"><span>Share of the total<\/span><span class="num">69\.6%<\/span><\/div><div class="b-share" aria-hidden="true"><b style="width:69\.6%"><\/b><\/div>/);
  const exempt = linePlate(LINE, 0, PARTS, { exempt: true, sharePct: '69.6' });
  assert.match(exempt, /Exempt if your list is complete · not in the total/);
  assert.doesNotMatch(exempt, /b-share"/, 'an exempt line has no share of a total it is not in');
  assert.doesNotMatch(linePlate(LINE, 0, PARTS), /b-share/);
});

test('refusedLinePlate: a thrown line shows its reason and no figure, with the same hooks', () => {
  const html = refusedLinePlate({ ...LINE, id: 'X"1' }, 2, 'boom <b>');
  assert.match(html, /<article class="b-t b-pass cb-line" data-line="X&quot;1">/);
  assert.match(html, /Line 3\./);
  assert.match(html, /<div class="cb-res cb-unavail"><div class="cb-tag unavail">No estimate<\/div>\s*<p class="cb-reason">boom &lt;b&gt;<\/p><\/div>/);
  assert.match(html, /data-remove="X&quot;1" aria-label="Remove line 3"/);
  assert.doesNotMatch(html, /cb-fig|b-share|cb-cost/);
});

test('thresholdErrorTile: the error, escaped, in a tile', () => {
  const html = thresholdErrorTile('bad <year>');
  assert.match(html, /<div class="cb-tag unavail">Threshold error<\/div>/);
  assert.match(html, /<p class="cb-reason">bad &lt;year&gt;<\/p>/);
});

test('listView: Total then the years in one row, the lines in a three-column row', () => {
  assert.equal(listView({ total: 'T', years: 'Y', plates: 'P' }),
    '<div class="b-bento b-list">TY</div><div class="b-bento b-c3">P</div>');
});
```

Run: `node --import tsx --test tests/unit/cbam-tiles-list.test.mjs`. Expected: FAIL (missing exports).

- [ ] **Step 2: Move `renderTotals` into `tiles-list.ts` as `totalTile`.** First extend `tiles-list.ts`'s imports to `import type { Line, Totals, YearThreshold } from '../cbam-lines.ts';` and `import { esc, eur, num } from './format.ts';`. Then cut `renderTotals` from `cbam-app.ts` with its doc comment. Paste it into `tiles-list.ts`, rename it `export function totalTile(t: Totals, exempt: Totals | null = null, shares: readonly string[] = []): string`, add one paragraph to its doc comment ("Rail phase 4: drawn as the List's hero tile. The tag span, figure block, sentences and exempt note are the pre-redesign card's, byte for byte; `shares` are the priced, non-exempt lines' shares of this total, in list order, for the stack bar."), and change **only the shells**, leaving `exemptNote` and every inner line as they are:

```ts
  const head = (sub: string, tone: string, tag: string) => `
      <div class="b-t-h"><div><h2 class="b-t-ti">Total.</h2><p class="b-t-sub">${sub}</p></div>
        <span class="cb-tag ${tone}">${esc(tag)}</span></div>`;
  const actions = `
      <div class="b-row2"><button type="button" class="btn b-add" data-goto="export">Export</button><button type="button" class="btn b-ghost" data-goto="estimate">Add a line</button></div>`;
```

  The four returns become (each keeps its own existing body lines between the shell lines):
  - all-exempt branch: `<section class="b-t b-s2 b-hero cb-total">${head('Total exposure', 'ok', 'Below threshold')}` + its existing `<p class="cb-sub">Nothing owed…</p>` and `${exemptNote}` + `${actions}</section>`;
  - no-lines branch: `${head('Total exposure', 'pending', 'No lines yet')}` + its existing `<p class="cb-sub">Add at least one line…</p>` (no actions: there is nothing to export);
  - nothing-priced branch: `${head('Total exposure', 'unavail', 'Nothing priced')}` + existing sentence + `${exemptNote}${actions}`;
  - priced branch: `${head(`Total exposure · ${t.pricedLines} line${t.pricedLines === 1 ? '' : 's'}`, tone, tag)}` + the existing `cb-fig`, `cb-u`, cost/no-€ line, refused note, `${exemptNote}`, then `${bar}${actions}`, where, at the top of that branch:

```ts
  const bar = shares.length
    ? `<div class="b-stackbar" aria-hidden="true">${shares.map((s) => `<b style="flex:${esc(s)}"></b>`).join('')}</div>`
    : '';
```

  The old `<h3 class="cb-card-label">Total exposure…</h3>` text is now the sub, character for character: the C2 pin `/Total exposure · 1 line/` and the e2e `.cb-total` text checks ("2 lines", "1 line has no estimate", "No lines yet") read it there.

- [ ] **Step 3: Add the plates and the list composer.** Append to `tiles-list.ts`:

```ts
/**
 * A line's share of the total, in percent to 1 dp (ROUND_HALF_UP), or null when there is no real
 * positive total to be a share of — a zero or unreadable total gives no share, never "0%".
 */
export function shareOfTotal(part: string, total: string): string | null {
  let p: Decimal;
  let t: Decimal;
  try { p = new Decimal(part); t = new Decimal(total); } catch { return null; }
  if (!p.isFinite() || !t.isFinite() || p.isNeg() || t.lte(0)) return null;
  return p.div(t).times(100).toFixed(1, Decimal.ROUND_HALF_UP);
}

/** The strings cbam-app.ts computes for a line (see renderLineCard): carried into the plate verbatim. */
export interface LinePlateParts { result: string; attestation: string; delta: string; tierLabel: string }
/** What the List knows about a line beyond its estimate. All optional: a bare plate is still honest. */
export interface LinePlateContext { goodName?: string; sharePct?: string | null; exempt?: boolean }

/**
 * The tier chip. Colour marks provenance only (spec §3): bronze for the Commission's default
 * values and mark-up, cyan for the importer's verified figures, and the mixed tier wears both,
 * each on the half it describes. Switched with `never`, so a fourth tier is a build error here.
 */
function tierChip(tier: Line['tier'], label: string): string {
  const chip = (tone: 'bronze' | 'cyan', text: string) => `<span class="chip ${tone}"><i aria-hidden="true"></i>${esc(text)}</span>`;
  switch (tier) {
    case 'default+markup': return chip('bronze', label);
    case 'actual-verified': return chip('cyan', label);
    case 'verified-direct+default-indirect': return chip('cyan', 'Verified direct') + chip('bronze', 'Commission indirect');
    default: {
      const _exhaustive: never = tier;
      // `?? ''`: the unit suite builds many lines with no `tier` at all (they predate the field).
      // Such a line gets no chip rather than the text "undefined" or a crash in esc().
      return _exhaustive ?? '';
    }
  }
}

const lineHead = (line: Line, index: number, chips: string, goodName: string | undefined, summary: string) => `
      <div class="b-t-h"><h2 class="b-t-ti">Line ${index + 1}.</h2><span class="b-chips">${chips}</span></div>
      ${goodName ? `<p class="b-pass-name" title="${esc(goodName)}">${esc(goodName)}</p>` : ''}
      <p class="b-t-sub num cb-line-sum">${summary}</p>`;

const removeButton = (line: Line, index: number) =>
  `<button type="button" class="b-rm cb-line-x" data-remove="${esc(line.id)}" aria-label="Remove line ${index + 1}">Remove</button>`;

/** One plate per line (spec §5.4): the tile shell around the line's own result card. */
export function linePlate(line: Line, index: number, parts: LinePlateParts, ctx: LinePlateContext = {}): string {
  const share = ctx.exempt
    ? '<p class="b-share-row">Exempt if your list is complete · not in the total</p>'
    : ctx.sharePct
      ? `<div class="b-share-row"><span>Share of the total</span><span class="num">${esc(ctx.sharePct)}%</span></div><div class="b-share" aria-hidden="true"><b style="width:${esc(ctx.sharePct)}%"></b></div>`
      : '';
  return `
    <article class="b-t b-pass cb-line" data-line="${esc(line.id)}">${lineHead(line, index, tierChip(line.tier, parts.tierLabel), ctx.goodName,
      `${esc(line.cn)} · ${esc(line.country)} · ${esc(line.route)} · ${num(line.massT)} t · ${esc(line.date)}`)}
      ${share}
      ${parts.result}
      ${parts.attestation}
      ${parts.delta}
      ${removeButton(line, index)}
    </article>`;
}

/**
 * A line whose estimate THREW (safeEstimates in cbam-app.ts): its reason, verbatim, in place of
 * the figures, and no chip — no tier priced it. The summary keeps the old card's three fields.
 */
export function refusedLinePlate(line: Line, index: number, message: string, goodName?: string): string {
  return `
    <article class="b-t b-pass cb-line" data-line="${esc(line.id)}">${lineHead(line, index, '', goodName,
      `${esc(line.cn)} · ${esc(line.country)} · ${num(line.massT)} t`)}
      <div class="cb-res cb-unavail"><div class="cb-tag unavail">No estimate</div>
      <p class="cb-reason">${esc(message)}</p></div>
      ${removeButton(line, index)}
    </article>`;
}

/** thresholdByYear threw: the error, verbatim, where the year tiles would be. */
export function thresholdErrorTile(message: string): string {
  return `
    <section class="b-t b-s2 cb-thresh-error"><h2 class="b-t-ti">Annual de minimis.</h2>
      <div class="cb-res cb-unavail"><div class="cb-tag unavail">Threshold error</div>
      <p class="cb-reason">${esc(message)}</p></div>
    </section>`;
}

/** The List view: Total and the year tiles in one bento row, the line plates in three columns. */
export function listView(p: { total: string; years: string; plates: string }): string {
  return `<div class="b-bento b-list">${p.total}${p.years}</div><div class="b-bento b-c3">${p.plates}</div>`;
}
```

  (`cb-thresh-error`, not `cb-thresh`: the e2e suite's `.cb-thresh` locators read verdicts, and an error tile is not one.)

- [ ] **Step 4: `renderLineCard` becomes the adapter.** In `cbam-app.ts`, import `linePlate, totalTile, type LinePlateContext` from `../cbam-ui/tiles-list.ts`, and replace `renderLineCard`'s **return statement only** (keep its doc comment, its `comparison` parameter doc and the comment block above `const verified = isAttested(line.tier);`) with:

```ts
  return linePlate(line, index, {
    result: renderResult(e),
    attestation: renderAttestation(line, hasFigure(e)),
    delta: verified ? renderVerifiedDelta(e, comparison) : '',
    tierLabel: tierLabel(line.tier),
  }, plate);
```

  and add a fifth parameter after `comparison?: CertificateEstimate | null,`:

```ts
  /** Rail phase 4: what the List knows beyond the estimate (good name, share, exemption). */
  plate: LinePlateContext = {},
```

- [ ] **Step 5: Port the 10 totals tests (ledger 13–22).** In `cbam-render.test.mjs`, remove `renderTotals` from the `cbam-app.ts` import, add `totalTile` to the `tiles-list.ts` import, and replace every `renderTotals(` with `totalTile(`. Measured at `447b4ac`: `grep -o "renderTotals(" tests/unit/cbam-render.test.mjs | wc -l` → **16** occurrences on 14 lines (lines 3593 and 3594 hold two each), none in a comment. After: 0, and `grep -o "totalTile(" … | wc -l` → 16. Change nothing else.

- [ ] **Step 6: Run, count, check the pins.**

```bash
npm run check
node --import tsx --test tests/unit/cbam-render.test.mjs tests/unit/cbam-tiles-list.test.mjs 2>&1 | tail -4
grep -c "^test(" tests/unit/cbam-render.test.mjs
grep -rn "renderTotals" src/ tests/ || echo "renderTotals fully retired"
```

Then rerun Task 2 Step 4's count command. Expected: all pass; count unchanged; `renderTotals fully retired` (the `renderAll` call is replaced in Task 5 — if `npm run check` fails only on that call, change it to `totalTile(totals, exempt)` now and Task 5 finishes it); S4 counts 3, 2, 5, 1.

**Mutation check:** delete `${exemptNote}` from `totalTile`'s priced branch, confirm `C2: renderTotals shows exempt lines OUTSIDE the total…` fails, restore.

- [ ] **Step 7: Commit.**

```bash
git add -- src/scripts/cbam-ui/tiles-list.ts src/scripts/cbam-algos/cbam-app.ts tests/unit/cbam-render.test.mjs tests/unit/cbam-tiles-list.test.mjs
git commit -m "feat(cbam): Total tile and line plates; renderTotals retired into totalTile"
```

---

### Task 5: Wire the List view

**Files:**
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (`renderAll` only), `src/pages/cbam/cbam-calculator.astro` (the List section only)
- Test: `tests/e2e/cbam-lines.spec.ts` (append), existing specs re-run

- [ ] **Step 1: `renderAll` composes the tiles.** In `renderAll`, replace the `yearsHtml = years.map(renderYearThreshold).join('');` line with `yearsHtml = years.map(yearTile).join('');`, and the catch arm's inline `<div class="cb-res cb-unavail">…Threshold error…</div>` template with `yearsHtml = thresholdErrorTile((err as Error).message);`. Then replace the whole `listEl!.innerHTML = yearsHtml + renderTotals(…) + pairs.map(…).join('');` statement with:

```ts
    // Rail phase 4: the List view's tiles (spec §5.4). Shares are of the total as summed above —
    // priced, non-exempt lines only — so an exempt or refused line has no share of a sum it is
    // not in. The good's name is the pack's CN description, untruncated (spec §11, D5).
    const nameOf = (cnCode: string) => pack!.classifications.find((c) => c.code === cnCode)?.description;
    const shares: string[] = [];
    const plates = pairs.map((p, i) => {
      if (!p.e) return refusedLinePlate(p.l, i, p.err!, nameOf(p.l.cn));
      const exemptLine = isExempt(p);
      const certs = tableFigures(p.e).certs;
      const sharePct = !exemptLine && certs !== null && totals.pricedLines > 0
        ? shareOfTotal(certs, totals.certificates) : null;
      if (sharePct) shares.push(sharePct);
      return renderLineCard(p.l, p.e, i, p.cmp, { goodName: nameOf(p.l.cn), sharePct, exempt: exemptLine });
    }).join('');
    listEl!.innerHTML = listView({ total: totalTile(totals, exempt, shares), years: yearsHtml, plates });
```

  Import `listView, refusedLinePlate, shareOfTotal, thresholdErrorTile, yearTile` from `../cbam-ui/tiles-list.ts`. Leave the `#cbStatus` builder below it, the badge, the button enabling, and `onOutClick`, **untouched**. If Task 1 found `renderAll` was `renderYearThreshold`'s only caller, delete `renderYearThreshold` now (Task 3's `YEAR_RENDERERS` already excludes it).

- [ ] **Step 2: The List markup.** In `cbam-calculator.astro`'s `<section data-view="list">`:
  - delete `<div class="cbx-actions"><button type="button" class="cb-btn" data-goto="estimate">Add a line</button></div>` (the Total tile carries Add a line and Export now);
  - delete the `<div class="cb-out">` wrapper and its closing `</div>`, keeping its two children (`#cbList` with its comment, and the `.cbx-empty` card) in place. The `.cb-out .cb-*` rules in the page's global style were today's card look; inside tiles the `cb-*` hooks are styled by `cbam-bento.css` (Task 10), and `.cb-out .cb-tag.ok` painted a priced total cyan, which the colour law reserves for verified figures;
  - keep `#cbList` written with no whitespace inside it (`:empty` drives the empty card).

  Then run Task 1 Step 4's id loop from the phase-1 plan:

```bash
for id in cbAdd cbAttest cbCn cbCnList cbCountry cbCsv cbDate cbDateNote cbDoc cbGraphs cbMass cbOut cbOutWrap cbOutlook cbPrint cbProv cbRef cbRoute cbRouteNote cbScope cbScopeRow cbSeeDirect cbSeeIndirect cbSeeIndirectRow cbStatus cbTier cbVerifiedRow cbList cbTitle cbTitlePhone; do
  printf '%s %s\n' "$id" "$(grep -c "id=\"$id\"" src/pages/cbam/cbam-calculator.astro)"; done | grep -v ' 1$' || echo "all ids exactly once"
```

- [ ] **Step 3: An e2e for the List tiles.** Append to `tests/e2e/cbam-lines.spec.ts`:

```ts
test.describe('rail views, phase 4 — List, Export, Rules', () => {
  test('List: a Total tile, a de minimis tile, and one plate per line with a share of the total', async ({ page }) => {
    await page.goto(URL);
    await addLine(page);
    await addLine(page, { mass: '60' });
    await view(page, 'list');
    await expect(page.locator('#cbList .cb-total h2')).toHaveText('Total.');
    await expect(page.locator('#cbList .cb-total')).toContainText('2 lines');
    await expect(page.locator('#cbList .cb-thresh h2')).toHaveText('Annual de minimis.');
    await expect(page.locator('#cbList .cb-line')).toHaveCount(2);
    const shares = await page.locator('#cbList .b-share-row .num').allTextContents();
    expect(shares).toHaveLength(2);
    const sum = shares.reduce((a, s) => a + Number(s.replace('%', '')), 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.1);
    // 30 t and 60 t of the same good: one third and two thirds.
    expect(shares).toEqual(['33.3%', '66.7%']);
  });
});
```

  (`URL`, `addLine` and `view` are this spec's own helpers; check their names with `grep -n "^const URL\|^async function addLine\|^async function view" tests/e2e/cbam-lines.spec.ts` and use the real ones.)

- [ ] **Step 4: Gate.**

```bash
npm run check && npm run build && npm run test:unit 2>&1 | tail -4
npx playwright test tests/e2e/cbam-lines.spec.ts tests/e2e/cbam-shell.spec.ts --project=chromium-tier0 --reporter=line
```

Expected: unit pass (count = baseline + new tests); every e2e passes, including the focus tests and the `#cbStatus` tests listed in the ledger. **The `.cb-thresh` toContainText checks read the tag text, which is unchanged; if one fails, the tile is wrong.**

- [ ] **Step 5: Commit.**

```bash
git add -- src/scripts/cbam-algos/cbam-app.ts src/pages/cbam/cbam-calculator.astro tests/e2e/cbam-lines.spec.ts
git commit -m "feat(cbam): Shipment list renders as tiles (spec §5.4)"
```

---

### Task 6: Export — `tiles-export.ts` and its wiring

**Files:**
- Create: `src/scripts/cbam-ui/tiles-export.ts`, `tests/unit/cbam-tiles-export.test.mjs`
- Modify: `src/pages/cbam/cbam-calculator.astro` (Export section), `src/scripts/cbam-algos/cbam-app.ts` (`initCbam`: lookups, `paintExport`, two calls in `renderAll`), `tests/e2e/cbam-lines.spec.ts`

The CSV preview is the **real** CSV: the same `csvRows(…)` call `onCsv` makes, over the same `lastPairs`, rendered as a table. The print document and the CSV columns do not change (spec §3).

- [ ] **Step 1: Failing tests.** Create `tests/unit/cbam-tiles-export.test.mjs`:

```js
// tests/unit/cbam-tiles-export.test.mjs — the Export view's tile bodies (spec §5.5).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { estimateFromPack } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';
import { csvRows, toCsv } from '../../src/scripts/cbam-lines.ts';
import { PREVIEW_COLUMNS, csvTileBody, docTileBody, fingerprintsBody } from '../../src/scripts/cbam-ui/tiles-export.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));
const mk = (i) => ({ id: `L${i}`, cn: '2523100090', country: 'DZ', route: '(A)', scope: 'direct',
  massT: String(10 * i), date: '2026-03-15', tier: 'default+markup' });
const realRows = (n) => {
  const lines = Array.from({ length: n }, (_, i) => mk(i + 1));
  const results = lines.map((l) => estimateFromPack(pack, { cn: l.cn, country: l.country, route: l.route, massT: l.massT, date: l.date }));
  return csvRows(lines, results, new Map(lines.map((l) => [l.id, 'a'.repeat(64)])), 'f'.repeat(64), pack);
};

test('the preview columns all exist in the real CSV header', () => {
  const header = toCsv(realRows(1)).split('\n')[0].split(',');
  for (const c of PREVIEW_COLUMNS) assert.ok(header.includes(c), c);
});

test('csvTileBody: the real column and line counts, and the first six rows, cell for cell', () => {
  const rows = realRows(8);
  const html = csvTileBody({ rows });
  const cols = Object.keys(rows[0]).length;
  assert.match(html, new RegExp(`<p class="b-t-sub">${cols} columns · 8 lines · full precision</p>`));
  assert.equal((html.match(/<tr>/g) ?? []).length, 1 + 6, 'a header row and six data rows');
  for (const r of rows.slice(0, 6)) for (const c of PREVIEW_COLUMNS) assert.ok(html.includes(`<td>${r[c]}</td>`), `${c}=${r[c]}`);
  assert.match(html, new RegExp(`6 of ${cols} columns and the first 6 of 8 lines shown`));
});

test('csvTileBody: one line is singular and says nothing about rows it did not cut', () => {
  const html = csvTileBody({ rows: realRows(1) });
  assert.match(html, / · 1 line · full precision/);
  assert.doesNotMatch(html, /first \d+ of/);
});

test('csvTileBody: cells are escaped, and a CSV that cannot be built says why', () => {
  const rows = realRows(1).map((r) => ({ ...r, cn_code: '<b>"x"' }));
  assert.ok(csvTileBody({ rows }).includes('<td>&lt;b&gt;&quot;x&quot;</td>'));
  assert.match(csvTileBody({ error: 'mismatch <here>' }), /The CSV cannot be built: mismatch &lt;here&gt;/);
  assert.match(csvTileBody({ rows: [] }), /No line has a priced estimate; nothing to export\./);
});

test('docTileBody: what the document really contains, and the date it will carry', () => {
  const html = docTileBody(3, '2026-11-02');
  assert.match(html, /Printable · dated 2 Nov 2026/);
  assert.match(html, /every line as entered/);
  assert.doesNotMatch(html, /framing/i, 'the document does not reprint the §7.1 banner, so the tile must not say it does');
});

test('fingerprintsBody: the rule pack first, then one figure per line, captioned', () => {
  const html = fingerprintsBody('f6af39ae'.padEnd(64, '0'), [{ n: 1, hex: '4a7196c8'.padEnd(64, '0') }, { n: 2, hex: null }]);
  assert.equal((html.match(/<figure>/g) ?? []).length, 3);
  assert.match(html, /<b>Rule pack<\/b><span class="num">f6af39ae…<\/span>/);
  assert.match(html, /<b>Line 1<\/b><span class="num">4a7196c8…<\/span>/);
  assert.match(html, /<b>Line 2<\/b><span class="num">no fingerprint<\/span>/);
  assert.equal((html.match(/class="b-fp/g) ?? []).length, 2, 'no dots for a missing fingerprint');
});
```

Run: `node --import tsx --test tests/unit/cbam-tiles-export.test.mjs`. Expected: FAIL (module missing).

- [ ] **Step 2: Implement `tiles-export.ts`.**

```ts
// src/scripts/cbam-ui/tiles-export.ts
// The Export view's tile bodies (spec §5.5). The tile shells and the #cbCsv / #cbDoc buttons are
// static markup in cbam-calculator.astro (their listeners are attached once, so they must never be
// re-created by innerHTML); these functions fill the containers beside them.
import { formatPackDate } from '../cbam-outlook.ts';
import { esc } from './format.ts';
import { renderFingerprint } from './fingerprint.ts';

/** The six CSV columns the preview shows, by their real header names (csvRows in cbam-lines.ts). */
export const PREVIEW_COLUMNS = ['line_id', 'cn_code', 'origin', 'mass_t', 'certificates', 'cost_eur'] as const;
const PREVIEW_ROWS = 6;

/**
 * The CSV tile: the real column and line counts, and the first six rows of the real rows — the
 * same csvRows output onCsv downloads, never a re-derivation. Values are shown at full precision,
 * as the file carries them.
 */
export function csvTileBody(csv: { rows: readonly Record<string, string>[] } | { error: string }): string {
  if ('error' in csv) return `<p class="b-lead2">The CSV cannot be built: ${esc(csv.error)}</p>`;
  const { rows } = csv;
  if (!rows.length) return '<p class="b-lead2">No line has a priced estimate; nothing to export.</p>';
  const cols = Object.keys(rows[0]!).length;
  const shown = rows.slice(0, PREVIEW_ROWS);
  const cut = rows.length > PREVIEW_ROWS ? ` and the first ${PREVIEW_ROWS} of ${rows.length} lines` : '';
  return `<p class="b-t-sub">${cols} columns · ${rows.length} line${rows.length === 1 ? '' : 's'} · full precision</p>`
    + '<div class="b-csvwrap"><table class="b-csv num"><thead><tr>'
    + PREVIEW_COLUMNS.map((c) => `<th scope="col">${c}</th>`).join('')
    + '</tr></thead><tbody>'
    + shown.map((r) => `<tr>${PREVIEW_COLUMNS.map((c) => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')
    + '</tbody></table></div>'
    + `<p class="b-t-foot">${PREVIEW_COLUMNS.length} of ${cols} columns${cut} shown. The file carries every column, unrounded, with every rule locator and both fingerprints.</p>`;
}

/**
 * The Document tile. Says what buildPrintDocument actually prints — its four sections — and the
 * date it will carry (onDoc stamps the day of export). Nothing more: the document does not reprint
 * the §7.1 banner, so this tile must not claim it does.
 */
export function docTileBody(lineCount: number, todayIso: string): string {
  return `<p class="b-t-sub">Printable · dated ${esc(formatPackDate(todayIso))}</p>`
    + `<p class="b-lead">${lineCount} line${lineCount === 1 ? '' : 's'}: every line as entered, the total and each year's de minimis verdict, the rule packs and source hashes behind them, and what the figures cannot tell you.</p>`;
}

/** "What travels with it": the rule-pack snapshot, then each line's fingerprint, drawn as dots. */
export function fingerprintsBody(snapshot: string, lines: readonly { n: number; hex: string | null }[]): string {
  const fig = (label: string, hex: string | null) => {
    const ok = hex !== null && /^[0-9a-f]{16,}$/i.test(hex);
    return `<figure>${ok ? renderFingerprint(hex!) : ''}<figcaption><b>${esc(label)}</b><span class="num">${
      ok ? `${esc(hex!.slice(0, 8))}…` : 'no fingerprint'}</span></figcaption></figure>`;
  };
  return `<div class="b-fps">${fig('Rule pack', snapshot || null)}${lines.map((l) => fig(`Line ${l.n}`, l.hex)).join('')}</div>`;
}
```

  (If Task 1 recorded a different fingerprint export, change only the import line and the one call.)

  Run the unit test. Expected: 6 pass.

- [ ] **Step 3: The Export markup.** Replace the Export section's body after its `<h1>` (keep the `<h1>`; change its `<span>` to `Take the shipment out of the browser.`) with the block below. **MOVE the two buttons, never retype them:** cut `<button id="cbCsv" …>` and `<button id="cbDoc" …>` from the `.cbx-actions` div, add ` b-add` to each `class`, paste them where shown, then delete the emptied `.cbx-actions` div.

```astro
        <div class="b-bento b-export">
          <section class="b-t b-s2" aria-labelledby="cbExpCsvH">
            <div class="b-t-h"><div><h2 id="cbExpCsvH" class="b-t-ti">CSV.</h2></div></div>
            <div id="cbExportCsv"><p class="b-lead2">Add a line to the list to export it.</p></div>
            <!-- MOVE: the #cbCsv button, verbatim except class="cb-btn b-add". It still ships disabled. -->
          </section>
          <section class="b-t b-s2 b-hero" aria-labelledby="cbExpDocH">
            <div class="b-t-h"><div><h2 id="cbExpDocH" class="b-t-ti">Document.</h2></div></div>
            <div id="cbExportDoc"><p class="b-lead2">Add a line to the list to print it.</p></div>
            <!-- MOVE: the #cbDoc button, verbatim except class="cb-btn b-add". It still ships disabled. -->
          </section>
          <section class="b-t b-s4" aria-labelledby="cbExpFpH">
            <div class="b-t-h"><div><h2 id="cbExpFpH" class="b-t-ti">What travels with it.</h2><p class="b-t-sub">Each line, and the rule pack, carries a fingerprint. Same dots, same inputs and rules.</p></div></div>
            <div id="cbExportFps"></div>
          </section>
        </div>
```

  `#cbPrint` stays where it is, outside the views (spec §5.5).

- [ ] **Step 4: Paint it.** In `initCbam`, after `const listHeading = $('cbxH-list');` add:

```ts
  const exportCsvEl = $('cbExportCsv'), exportDocEl = $('cbExportDoc'), exportFpsEl = $('cbExportFps');
  // The static "add a line" copy, kept to restore when the list empties.
  const exportIdle = [exportCsvEl, exportDocEl].map((el) => el?.innerHTML ?? '');
```

  Directly above `function renderAll(): void {` add:

```ts
  /**
   * The Export view (spec §5.5), repainted whenever the list changes. The CSV preview is built by
   * the SAME csvRows call onCsv makes, over the same lastPairs, so the table is the file's own
   * first rows. A throw is shown as the tile's text — onCsv reports the same throw on click.
   */
  function paintExport(): void {
    if (!lines.length || !pack) {
      if (exportCsvEl) exportCsvEl.innerHTML = exportIdle[0]!;
      if (exportDocEl) exportDocEl.innerHTML = exportIdle[1]!;
      if (exportFpsEl) exportFpsEl.innerHTML = '';
      return;
    }
    const ok = lastPairs.filter((p) => p.e !== null);
    let csv: { rows: Record<string, string>[] } | { error: string };
    try {
      csv = { rows: csvRows(ok.map((p) => p.l), ok.map((p) => p.e!), fingerprints, snapshot, pack) };
    } catch (err) {
      csv = { error: (err as Error).message };
    }
    if (exportCsvEl) exportCsvEl.innerHTML = csvTileBody(csv);
    if (exportDocEl) exportDocEl.innerHTML = docTileBody(lines.length, new Date().toISOString().slice(0, 10));
    if (exportFpsEl) exportFpsEl.innerHTML = fingerprintsBody(snapshot,
      lines.map((l, i) => ({ n: i + 1, hex: fingerprints.get(l.id) ?? null })));
  }
```

  In `renderAll`, call `paintExport();` immediately before the early `return;` of the `if (!lines.length)` block, and immediately after the `listEl!.innerHTML = listView(…);` statement. Import `csvTileBody, docTileBody, fingerprintsBody` from `../cbam-ui/tiles-export.ts`.

- [ ] **Step 5: e2e — the preview is the downloaded file.** Inside the `rail views, phase 4` describe in `cbam-lines.spec.ts`, add:

```ts
  test('Export: the CSV preview is the downloaded CSV — counts, columns and cells', async ({ page }) => {
    await page.goto(URL);
    await addLine(page);
    await addLine(page, { mass: '60' });
    await view(page, 'export');
    await expect(page.locator('#cbExportCsv th')).toHaveText(['line_id', 'cn_code', 'origin', 'mass_t', 'certificates', 'cost_eur']);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#cbCsv')]);
    const [headerLine, ...rowLines] = readFileSync(await download.path(), 'utf8').trim().split('\n');
    const header = parseCsvRow(headerLine);
    await expect(page.locator('#cbExportCsv .b-t-sub')).toHaveText(`${header.length} columns · 2 lines · full precision`);
    const shown = page.locator('#cbExportCsv tbody tr');
    await expect(shown).toHaveCount(2);
    for (const [r, line] of rowLines.entries()) {
      const cells = parseCsvRow(line);
      const want = ['line_id', 'cn_code', 'origin', 'mass_t', 'certificates', 'cost_eur'].map((c) => cells[header.indexOf(c)]);
      await expect(shown.nth(r).locator('td')).toHaveText(want);
    }
    await expect(page.locator('#cbExportFps figure')).toHaveCount(3);
    await expect(page.locator('#cbExportDoc')).toContainText('every line as entered');
  });
```

  (`readFileSync` and `parseCsvRow` are already in this spec.)

- [ ] **Step 6: Gate.**

```bash
npm run check && npm run build && npm run test:unit 2>&1 | tail -4
npx playwright test tests/e2e/cbam-lines.spec.ts --project=chromium-tier0 --reporter=line
```

Expected: all pass; every existing `#cbCsv`/`#cbDoc` test (they navigate with `view(page, 'export')` since phase 1) is green.

- [ ] **Step 7: Commit.**

```bash
git add -- src/scripts/cbam-ui/tiles-export.ts tests/unit/cbam-tiles-export.test.mjs src/pages/cbam/cbam-calculator.astro src/scripts/cbam-algos/cbam-app.ts tests/e2e/cbam-lines.spec.ts
git commit -m "feat(cbam): Export tiles — real-CSV preview, document, fingerprints (spec §5.5)"
```

---

### Task 7: Rules & sources, with the D4 count measured and pinned

**Files:**
- Create: `src/scripts/cbam-ui/tiles-rules.ts`, `tests/unit/cbam-rules-view.test.mjs`
- Modify: `src/pages/cbam/cbam-calculator.astro` (Rules section; the eyebrow moves from Estimate), `src/scripts/cbam-algos/cbam-app.ts` (`initCbam`: three lookups, the fill inside `loadAndPopulate`, `[data-load-pack]`), `tests/e2e/cbam-lines.spec.ts`

The Rules view is static markup (spec §7). Its pack-dependent parts — Not yet published, Rule pack, Sources — fill once, after `ensurePack()`. The pack is 37 MB and is never fetched at page load, so until then each of those tiles offers a **Load the rule pack** button.

- [ ] **Step 1: Failing tests, including the D4 measurement.** Create `tests/unit/cbam-rules-view.test.mjs`:

```js
// tests/unit/cbam-rules-view.test.mjs — the Rules & sources view (spec §5.6) and the D4 count.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { estimateFromPack, selectFactorFromPack } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';
import { sectorForCn } from '../../src/scripts/cbam-algos/cbam/sector.ts';
import { renderNotYetPublished, renderRulePack, renderSources } from '../../src/scripts/cbam-ui/tiles-rules.ts';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const pack = JSON.parse(read('../../public/cbam/estimator-pack.json'));
const page = read('../../src/pages/cbam/cbam-calculator.astro').replace(/\s+/g, ' ');

/**
 * D4 (spec §11), MEASURED, not typed. Counts the offered goods with at least one production route
 * that has a published 2026 direct default value somewhere, yet whose estimate refuses with a
 * benchmark/ selector: the Commission publishes no Column B benchmark the engine can match, and
 * the engine refuses rather than borrow a nearby one. Origins are pre-filtered from the 2026
 * direct default rows whose scope prefixes the good, then confirmed through the engine's own
 * selectFactorFromPack (a full sweep of every origin gives the same answer; measured 2 Nov 2026:
 * 28 goods, 56 good-route pairs, all iron and steel). A regenerated pack that moves the count turns
 * this red, and the footnote is then rewritten with the new figure.
 */
function benchmarkGaps() {
  const DATE = '2026-03-15';
  const rows = pack.defaultValues.filter((r) => r.reportingYear === 2026 && r.emissionsType === 'direct');
  const goods = new Set();
  let pairs = 0;
  for (const { code } of pack.classifications) {
    const byRoute = new Map();
    for (const r of rows) if (code.startsWith(r.scopeCode)) {
      if (!byRoute.has(r.productionRoute)) byRoute.set(r.productionRoute, new Set());
      byRoute.get(r.productionRoute).add(r.originCountry);
    }
    for (const [route, origins] of byRoute) {
      const origin = [...origins].sort().find((o) => selectFactorFromPack(pack, { cn: code, country: o, route, massT: '100', date: DATE }));
      if (!origin) continue;
      const e = estimateFromPack(pack, { cn: code, country: origin, route, massT: '100', date: DATE });
      if (e.status === 'unavailable' && e.selector?.startsWith('benchmark/')) { goods.add(code); pairs += 1; }
    }
  }
  const sectors = new Map();
  for (const c of goods) sectors.set(sectorForCn(c), (sectors.get(sectorForCn(c)) ?? 0) + 1);
  return { goods: goods.size, pairs, sectors };
}

test('D4: the method footnote prints the measured count, of the pack\'s own good count', () => {
  const m = benchmarkGaps();
  assert.ok(m.goods > 0, 'sanity: the sweep found the known gap (72052100 on (C))');
  assert.deepEqual([...m.sectors.keys()], ['iron_and_steel'],
    `the footnote says every such good is iron and steel; the pack now says ${JSON.stringify([...m.sectors])}. Rewrite the clause.`);
  assert.ok(page.includes(`— ${m.goods} of ${pack.classifications.length} offered goods have at least one such route, and all ${m.goods} are iron and steel.`),
    `the footnote must print ${m.goods} of ${pack.classifications.length}, measured from the pack`);
  assert.ok(!page.includes('183 of 574'), 'the stale count is gone');
});

const S = 'f6af39aed68a4cb332b9dbdf4233ed35b6ca1165cc67f69f1240992f97d7cfdf';

test('renderRulePack: the pack\'s identity, dated, and its snapshot drawn as dots', () => {
  const html = renderRulePack(pack, S);
  assert.match(html, new RegExp(`<p class="b-t-sub num">${pack.identity.id}</p>`));
  assert.match(html, new RegExp(`<div class="b-mid num">${pack.identity.version}</div>`));
  assert.match(html, new RegExp(`<dt>Supersedes</dt><dd class="num">${pack.identity.supersedes}</dd>`));
  assert.match(html, /<dt>Valid from<\/dt><dd class="num">1 Jan 2026<\/dd>/);
  assert.match(html, /<dt>Law as published<\/dt><dd class="num">18 Aug 2026<\/dd>/);
  assert.match(html, new RegExp(`<dt>Basis</dt><dd class="num">${pack.identity.regulatoryBasis.join(' · ')}</dd>`));
  assert.match(html, /class="b-fp/);
  assert.match(html, /Snapshot f6af39aed68a4cb3…/);
  assert.doesNotMatch(renderRulePack(pack, ''), /b-fp|Snapshot/, 'no snapshot yet, no dots');
});

test('renderNotYetPublished: every pending CSCF year and price row, from the pack, never typed', () => {
  const html = renderNotYetPublished(pack);
  const pendingCscf = pack.cscf.filter((r) => r.status === 'pending');
  const pendingPrices = pack.prices.filter((r) => r.status === 'pending');
  assert.ok(pendingCscf.length && pendingPrices.length, 'sanity: the shipped pack owes both');
  for (const r of pendingCscf) assert.ok(html.includes(r.sourceLocator), r.sourceLocator);
  for (const loc of new Set(pendingPrices.map((r) => r.sourceLocator))) assert.ok(html.includes(loc.replace(/&/g, '&amp;')), loc);
  assert.match(html, new RegExp(`Cross-sectoral correction factor, ${pendingCscf[0].year} to ${pendingCscf.at(-1).year}\\.`));
  assert.match(html, /Certificate price, 2026-Q4\./);
  assert.match(html, /Certificate price, 2027-Q1 to 2028-Q4\./);
  assert.match(html, /a floor/, 'the CSCF item says which way the unknown can move the figure');
});

test('renderNotYetPublished: nothing pending, nothing claimed', () => {
  assert.match(renderNotYetPublished({ cscf: [], prices: [] }), /Nothing the rule pack depends on is unpublished\./);
});

test('renderSources: every source, its legal status and retrieval date, linked only over http(s)', () => {
  const html = renderSources(pack.sources);
  assert.equal((html.match(/<li>/g) ?? []).length, pack.sources.length);
  assert.match(html, new RegExp(`<p class="b-t-sub">${pack.sources.length}, with legal status and retrieval date\\.</p>`));
  for (const s of pack.sources) {
    assert.ok(html.includes(`<span class="chip">${s.legalStatus}</span>`), s.id);
  }
  assert.match(html, /Retrieved 14 Oct 2026/);
  const evil = renderSources([{ ...pack.sources[0], url: 'javascript:alert(1)', title: '<i>t</i>' }]);
  assert.doesNotMatch(evil, /href=/, 'a non-http URL is never a link');
  assert.doesNotMatch(evil, /<i>t<\/i>/, 'titles are escaped');
});
```

Run: `node --import tsx --test tests/unit/cbam-rules-view.test.mjs`. Expected: FAIL (module missing; and the D4 test fails on the page text — that is the point).

- [ ] **Step 2: Implement `tiles-rules.ts`.**

```ts
// src/scripts/cbam-ui/tiles-rules.ts
// The pack-dependent half of Rules & sources (spec §5.6, §7): the rule pack's identity, what the
// law still owes, and the sources. Everything here is READ from the pack — a date or a count typed
// into markup goes stale the day the pack is regenerated.
import type { EstimatorPack } from '../cbam-algos/estimator/estimate-from-pack.ts';
import { formatPackDate } from '../cbam-outlook.ts';
import { esc } from './format.ts';
import { renderFingerprint } from './fingerprint.ts';

const kv = (k: string, v: string) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`;

/** The Rule pack tile: id, version, supersedes, valid-from, the as-published date, the basis. */
export function renderRulePack(pack: Pick<EstimatorPack, 'identity' | 'generatedAt'>, snapshot: string): string {
  const id = pack.identity;
  const hasSnap = /^[0-9a-f]{16,}$/i.test(snapshot);
  return `<p class="b-t-sub num">${esc(id.id)}</p>`
    + `<div class="b-mid num">${esc(id.version)}</div>`
    + '<dl class="kv">'
    + kv('Supersedes', id.supersedes)
    + kv('Valid from', formatPackDate(id.validFrom))
    + kv('Law as published', formatPackDate(pack.generatedAt))
    + kv('Basis', id.regulatoryBasis.join(' · '))
    + '</dl>'
    + (hasSnap ? `${renderFingerprint(snapshot, 'b-fp-sm')}<p class="foot num">Snapshot ${esc(snapshot.slice(0, 16))}…</p>` : '');
}

const span = (xs: readonly string[]) => (xs.length > 1 ? `${xs[0]} to ${xs[xs.length - 1]}` : (xs[0] ?? ''));

/**
 * Not yet published: every CSCF year and every certificate-price row the pack marks pending, each
 * with the pack's own locator. Price rows are grouped by locator, so the 2027–28 weekly regime
 * reads as one item and a quarter still to come (2026-Q4) as another.
 */
export function renderNotYetPublished(pack: Pick<EstimatorPack, 'cscf' | 'prices'>): string {
  const item = (title: string, body: string) =>
    `<div class="b-npi"><span class="b-dash" aria-hidden="true"></span><div><b>${esc(title)}</b>${body}</div></div>`;
  const items: string[] = [];
  const cscf = pack.cscf.filter((r) => r.status === 'pending');
  if (cscf.length) {
    items.push(item(`Cross-sectoral correction factor, ${span(cscf.map((r) => String(r.year)))}.`,
      '<p>Every figure assumes the largest factor the law allows. The real factor can only reduce the free allocation deducted, so each figure is a floor.</p>'
      + `<ul class="foot">${cscf.map((r) => `<li>${esc(r.sourceLocator)}</li>`).join('')}</ul>`));
  }
  const groups = new Map<string, string[]>();
  for (const r of pack.prices.filter((p) => p.status === 'pending')) {
    groups.set(r.sourceLocator, [...(groups.get(r.sourceLocator) ?? []), r.quarter]);
  }
  for (const [locator, quarters] of groups) items.push(item(`Certificate price, ${span(quarters)}.`, `<p>${esc(locator)}</p>`));
  return items.length
    ? `<div class="b-np">${items.join('')}</div>`
    : '<p class="b-lead2">Nothing the rule pack depends on is unpublished.</p>';
}

/** The Sources tile: each source with its legal status and retrieval date. Only http(s) is linked. */
export function renderSources(sources: EstimatorPack['sources']): string {
  const link = (url: string) => (/^https?:\/\//i.test(url)
    ? ` · <a href="${esc(url)}" rel="noopener">${esc(url.replace(/^https?:\/\//i, '').slice(0, 52))}</a>` : '');
  return `<p class="b-t-sub">${sources.length}, with legal status and retrieval date.</p><ol class="src">`
    + sources.map((s) => `<li><div class="row"><b>${esc(s.title)}</b><span class="chip">${esc(s.legalStatus)}</span></div>`
      + `<p class="foot">${esc(s.locator)}</p><p class="foot">Retrieved ${esc(formatPackDate(s.retrievedAt))}${link(s.url)}</p></li>`).join('')
    + '</ol>';
}
```

  (Check `formatPackDate('2026-10-14T00:00:00.000Z')` prints `14 Oct 2026` on this Node: `node --import tsx -e "import('./src/scripts/cbam-outlook.ts').then(m=>console.log(m.formatPackDate('2026-10-14T00:00:00.000Z')))"`. If Node's ICU prints `Sept` for September, that is the strip's existing behaviour and stays consistent with it.)

- [ ] **Step 3: The Rules markup.** Replace everything inside `<section data-view="rules">` after its `<h1>` with the block below. **MOVE, never retype:** cut `<p class="cb-eyebrow">…</p>` from the top of the Estimate view and paste it where marked (spec §6.2 and the D1 default: the eyebrow stays in markup, under the Rules framing title, until the CEO's word). Cut the existing `<p class="cb-foot">` paragraph and paste it where marked, then change **only** its last clause as shown.

```astro
        <div class="b-bento b-rules">
          <section class="b-t b-s2 b-r2 b-hero b-frame" aria-labelledby="cbRulesFramingH">
            <div class="b-t-h"><div><h2 id="cbRulesFramingH" class="b-t-ti">Framing.</h2><p class="b-t-sub">Read first.</p></div></div>
            <!-- MOVE: the <p class="cb-eyebrow"> element from the Estimate view, verbatim. -->
            <p class="b-frame-full">The full framing sits at the top of Estimate, above the form, so it is read before any figure.</p>
            <button type="button" class="btn b-add" data-goto="estimate">Read it on Estimate</button>
          </section>
          <section class="b-t b-s2" aria-labelledby="cbRulesNotYetH">
            <div class="b-t-h"><div><h2 id="cbRulesNotYetH" class="b-t-ti">Not yet published.</h2><p class="b-t-sub">What the law still owes, as the rule pack records it.</p></div></div>
            <div id="cbNotYet"><p class="b-lead2">This reads the rule pack, which loads with your first line. <button type="button" class="btn" data-load-pack>Load the rule pack</button></p></div>
          </section>
          <section class="b-t" aria-labelledby="cbRulesKeyH">
            <h2 id="cbRulesKeyH" class="b-t-ti">Colour key.</h2>
            <p class="b-t-sub">Colour only ever marks where a figure came from.</p>
            <div class="b-key">
              <div class="b-k b-k-bz"><b>Bronze.</b><span>Commission default values, and the mark-up on them.</span></div>
              <div class="b-k b-k-cy"><b>Cyan.</b><span>Your own verified figures.</span></div>
              <div class="b-k b-k-ink"><b>Ink.</b><span>Everything else.</span></div>
            </div>
          </section>
          <section class="b-t" aria-labelledby="cbRulesPackH">
            <h2 id="cbRulesPackH" class="b-t-ti">Rule pack.</h2>
            <div id="cbRulePack"><p class="b-lead2">Loads with the rule pack. <button type="button" class="btn" data-load-pack>Load the rule pack</button></p></div>
          </section>
          <section class="b-t b-s4" aria-labelledby="cbRulesMethodH">
            <h2 id="cbRulesMethodH" class="b-t-ti">Method.</h2>
            <!-- MOVE: the <p class="cb-foot"> method paragraph, verbatim, then replace its last clause
                 (from "— 183 of 574" to the end) with the measured one below. D4: measured 2 Nov 2026,
                 pinned by tests/unit/cbam-rules-view.test.mjs; wording beyond the figures awaits the founder. -->
          </section>
          <section class="b-t b-s4 b-srcs" aria-labelledby="cbRulesSourcesH">
            <div class="b-t-h"><div><h2 id="cbRulesSourcesH" class="b-t-ti">Sources.</h2></div></div>
            <div id="cbSources"><p class="b-lead2">Loads with the rule pack. <button type="button" class="btn" data-load-pack>Load the rule pack</button></p></div>
          </section>
        </div>
```

  The method paragraph after the edit reads (hard-wrapping is free; the test normalises whitespace):

```astro
            <p class="cb-foot">
            Engine and rule corpus shared with the GeoCBAM ledger. Default values and benchmarks are the
            European Commission's; the cut, structure and normalisation are ours. Where the Commission
            has not published a benchmark matching a production route, this tool shows no figure
            rather than substituting a nearby one — 28 of 572 offered goods have at least one such
            route, and all 28 are iron and steel.
          </p>
```

  Then confirm: `grep -c 'class="cb-eyebrow"' src/pages/cbam/cbam-calculator.astro` → `1`; `grep -c 'class="cb-banner"' …` → `1`; the eyebrow now sits after `cbRulesFramingH`.

- [ ] **Step 4: Fill it after the pack loads.** In `initCbam`, beside the export lookups, add:

```ts
  const notYetEl = $('cbNotYet'), rulePackEl = $('cbRulePack'), sourcesEl = $('cbSources');
```

  In `loadAndPopulate`, directly after `snapshot = hash;`, add:

```ts
    // Rules & sources (spec §5.6, §7): its pack-dependent tiles fill once, here, from the pack.
    if (notYetEl) notYetEl.innerHTML = renderNotYetPublished(pack);
    if (rulePackEl) rulePackEl.innerHTML = renderRulePack(pack, snapshot);
    if (sourcesEl) sourcesEl.innerHTML = renderSources(pack.sources);
```

  Next to the other listeners at the end of `initCbam`, add:

```ts
  // The Rules view's "Load the rule pack" buttons: the pack is never fetched at page load (37 MB),
  // so a visitor who opens Rules first asks for it here. The fill above replaces the buttons.
  document.querySelectorAll<HTMLButtonElement>('[data-load-pack]').forEach((b) =>
    b.addEventListener('click', () => { void ensurePack(); }));
```

  Import the three renderers from `../cbam-ui/tiles-rules.ts`.

- [ ] **Step 5: e2e.** Inside the `rail views, phase 4` describe, add:

```ts
  test('Rules: loads the pack on request and lists every source, the rule pack and what is owed', async ({ page }) => {
    const pack = JSON.parse(readFileSync('public/cbam/estimator-pack.json', 'utf8'));
    await page.goto(`${URL}#rules`);
    await expect(page.locator('[data-view="rules"] .cb-eyebrow')).toBeVisible();
    await page.locator('#cbSources [data-load-pack]').click();
    await expect(page.locator('#cbSources li')).toHaveCount(pack.sources.length);
    await expect(page.locator('#cbRulePack')).toContainText(pack.identity.id);
    await expect(page.locator('#cbNotYet')).toContainText('Cross-sectoral correction factor');
    await expect(page.locator('[data-view="rules"] .cb-foot')).toContainText(`of ${pack.classifications.length} offered goods`);
  });
```

  (Playwright runs from the repository root, so the relative path resolves. `URL` is this spec's own constant.)

- [ ] **Step 6: Gate.**

```bash
npm run check && npm run build && npm run test:unit 2>&1 | tail -4
npx playwright test tests/e2e/cbam-lines.spec.ts tests/e2e/cbam-shell.spec.ts --project=chromium-tier0 --reporter=line
```

Expected: all pass. **`NON-NEGOTIABLE 1` must pass unchanged:** the eyebrow moved but its text is intact, and nothing between `cb-banner` and `cb-grid` changed.

**Mutation check:** change `28 of 572` in the page to `29 of 572`, confirm the D4 test fails, restore.

- [ ] **Step 7: Commit.**

```bash
git add -- src/scripts/cbam-ui/tiles-rules.ts tests/unit/cbam-rules-view.test.mjs src/pages/cbam/cbam-calculator.astro src/scripts/cbam-algos/cbam-app.ts tests/e2e/cbam-lines.spec.ts
git commit -m "feat(cbam): Rules & sources tiles; D4 footnote re-measured (28 of 572) and pinned"
```

---

### Task 8: The title card's final form

**Files:**
- Modify: `src/scripts/cbam-ui/title-card.ts`, `src/scripts/cbam-algos/cbam-app.ts` (`paintTitle` only)
- Test: `tests/unit/cbam-title-card.test.mjs`

Final form, from the preview: `India (IN) · route (C)` and `100 t · 15 Mar 2026` on the rail; the phone line is short: `73063077 · IN · (C) · 100 t · 15 Mar 2026`.

- [ ] **Step 1: Update the tests first.** These are phase 1's own format expectations, changed on purpose (they pin layout, not an honesty claim). In `tests/unit/cbam-title-card.test.mjs`:
  - add `originCode: 'IN',` to `LINE`;
  - replace the second test with:

```js
test('a line: code, name, origin (code) · route, mass · formatted date', () => {
  const html = renderTitleCard(LINE);
  assert.match(html, /class="cbx-tc-code">73063077</);
  assert.match(html, /title="Other tubes, pipes and hollow profiles, welded"/);
  assert.match(html, />India \(IN\) · route \(C\)</);
  assert.match(html, />100 t · 15 Mar 2026</);
  assert.equal(titleSummary(LINE), '73063077 · IN · (C) · 100 t · 15 Mar 2026');
});

test('the residual origin carries no code, and the default route reads as words', () => {
  const html = renderTitleCard({ ...LINE, origin: 'Other countries and territories (residual)', originCode: 'OTHER', route: 'default' });
  assert.match(html, />Other countries and territories \(residual\) · default route</);
  assert.equal(titleSummary({ ...LINE, originCode: 'OTHER', route: 'default' }), '73063077 · OTHER · default · 100 t · 15 Mar 2026');
});

test('an unreadable date is shown as typed, never as an invented one', () => {
  assert.match(renderTitleCard({ ...LINE, date: '2026-13-40' }), />100 t · 2026-13-40</);
});
```

  - in the escaping test, also pass `originCode: '<x>'` and add `assert.ok(!html.includes('<x>'), 'code escaped');`.

  Run: `node --import tsx --test tests/unit/cbam-title-card.test.mjs`. Expected: the new assertions FAIL.

- [ ] **Step 2: Implement.** In `title-card.ts`:
  - add to `TitleLine`, after `origin`: `/** ISO code, or 'OTHER' for the residual bucket (no code is shown for it). */ originCode: string;`;
  - add `import { formatPackDate } from '../cbam-outlook.ts';` and these helpers:

```ts
/** "15 Mar 2026" for a real calendar day; anything else exactly as typed. */
const day = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(`${iso}T00:00:00Z`);
  // Reject a date the Date constructor would roll over (2026-02-30 → 2 Mar).
  return d.getUTCMonth() + 1 === Number(m[2]) && d.getUTCDate() === Number(m[3]) ? formatPackDate(iso) : iso;
};
const originText = (l: TitleLine) => (l.originCode === 'OTHER' ? l.origin : `${l.origin} (${l.originCode})`);
const routeText = (route: string) => (route === 'default' ? 'default route' : `route ${route}`);
```

  - in `renderTitleCard`, the two meta lines become:

```ts
    + `<p class="cbx-tc-meta">${esc(originText(l))} · ${esc(routeText(l.route))}</p>`
    + `<p class="cbx-tc-meta">${esc(l.massT)} t · ${esc(day(l.date))}</p>`;
```

  - `titleSummary` returns `` `${l.cn} · ${l.originCode} · ${l.route} · ${l.massT} t · ${day(l.date)}` `` for a line.

  In `cbam-app.ts`'s `paintTitle`, add `originCode: line.country,` after `origin: countryName(line.country),`.

- [ ] **Step 3: Run.**

```bash
node --import tsx --test tests/unit/cbam-title-card.test.mjs && npm run check
npx playwright test tests/e2e/cbam-shell.spec.ts --project=chromium-tier0 --reporter=line
```

Expected: unit pass; the shell spec's title tests (`toContainText('(A)')`, `'200 t'`) pass.

- [ ] **Step 4: Commit.**

```bash
git add -- src/scripts/cbam-ui/title-card.ts tests/unit/cbam-title-card.test.mjs src/scripts/cbam-algos/cbam-app.ts
git commit -m "feat(cbam): title card final form — origin code, route words, formatted date"
```

---

### Task 9 (D1, isolated, SKIPPABLE): the §7.1 banner

**Run this task only with the CEO's recorded word on D1. With no word, skip it and do only Outcome B.** It touches only `src/pages/cbam/cbam-calculator.astro` and `tests/unit/cbam-render.test.mjs`, so it can land or be reverted alone.

**The two pins today, quoted from `NON-NEGOTIABLE 1 — the banner names both tiers, and concedes everything it conceded before`** (with `const prose = page.replace(/\s+/g, ' ');`):

```js
  assert.doesNotMatch(prose.slice(prose.indexOf('cb-banner'), prose.indexOf('cb-grid')),
    /will pay|pay less|forecast|expected price|not yet/i,
    'the banner states what is published; it forecasts nothing');
```

```js
  assert.ok(prose.includes(EYEBROW_71),
    'the eyebrow must match the pinned text exactly');
  assert.ok(prose.includes(BANNER_71),
    'the §7.1 banner must match the pinned text exactly — word for word, punctuation for punctuation');
```

**The trap in the first pin:** it slices from the first `cb-banner` to the first `cb-grid`. Moved into Rules, the banner sits after Estimate's `cb-grid`, so `indexOf('cb-banner') > indexOf('cb-grid')`, the slice is `''`, and the assertion passes on nothing. Any class on the Estimate summary containing the string `cb-banner` would also capture the slice. Outcome A therefore names the summary `cb-frame-sum`, and replaces the slice with one anchored to the banner element.

#### Outcome B — not approved, or no word yet

- [ ] **B1.** Leave the banner and its comment block where they are, at the top of Estimate before `cb-grid`. The Framing tile keeps Task 7's link to it.
- [ ] **B2.** Harden the slice so it can never pass on nothing (tightening; no assertion relaxed). Directly above the `doesNotMatch` quoted above, add:

```js
  assert.ok(prose.slice(prose.indexOf('cb-banner'), prose.indexOf('cb-grid')).includes('Prototype estimator'),
    'sanity: the slice the next assertion reads holds the banner, so it cannot pass on an empty string');
```

- [ ] **B3.** Run `node --import tsx --test tests/unit/cbam-render.test.mjs`; commit `test(cbam): the banner's no-forecast pin can no longer pass on an empty slice`.

#### Outcome A — the CEO approves the fold

Record the decision first: the date and the exact words, in the commit message and in a comment above `BANNER_71`.

- [ ] **A1. Move the banner, verbatim.** Cut the `<!-- NON-NEGOTIABLE §7.1 … -->` comment, the `<!-- WORDING APPROVED 2026-10-14 … -->` comment and the `<div class="cb-banner" role="note"> … </div>` element from Estimate. In the Rules Framing tile, replace `<p class="b-frame-full">The full framing sits at the top of Estimate…</p>` and the `Read it on Estimate` button with the cut block, pasted unchanged. The eyebrow stays above it, under the title.
- [ ] **A2. The one-line summary on Estimate.** Where the banner was, before `<div class="cb-grid">`, add:

```astro
        <!-- D1 (CEO, <YYYY-MM-DD>): the §7.1 banner lives in full on Rules & sources; this line
             points to it. Extra markup, not a replacement (spec §6.2). Pinned in cbam-render.test.mjs. -->
        <p class="cb-frame-sum">A labelled what-if, not a declaration. <button type="button" class="cb-frame-link" data-goto="rules">Read the full framing</button></p>
```

  and change the Estimate `<h1>` to `Estimate.` (drop its `<span>`, which said the same words — the preview has the summary under a bare title).
- [ ] **A3. Port the slice pin.** Replace the quoted `doesNotMatch(prose.slice(…'cb-banner'…'cb-grid'…))` with:

```js
  // D1 (CEO, <YYYY-MM-DD>): the banner moved to Rules & sources, after Estimate's cb-grid, so the
  // slice is anchored to the banner element itself and closed by its own </div>, and the Estimate
  // summary is checked too. Both must state, never forecast.
  const bannerOpen = '<div class="cb-banner" role="note">';
  const bannerAt = prose.indexOf(bannerOpen);
  assert.equal(prose.split(bannerOpen).length - 1, 1, 'the banner exists exactly once (spec §6.2)');
  const bannerProse = prose.slice(bannerAt, prose.indexOf('</div>', bannerAt) + '</div>'.length);
  assert.ok(bannerProse.includes('Prototype estimator') && bannerProse.endsWith('</div>'),
    'sanity: the slice is the whole banner');
  assert.doesNotMatch(bannerProse, /will pay|pay less|forecast|expected price|not yet/i,
    'the banner states what is published; it forecasts nothing');
  const summary = /<p class="cb-frame-sum">.*?<\/p>/.exec(prose)?.[0] ?? '';
  assert.equal(summary, BANNER_SUM_71, 'the Estimate summary must match its pinned text exactly');
  assert.doesNotMatch(summary, /will pay|pay less|forecast|expected price|not yet/i,
    'nor does its one-line summary');
```

  and add the constant beside `BANNER_71`:

```js
const BANNER_SUM_71 =
  '<p class="cb-frame-sum">A labelled what-if, not a declaration. '
  + '<button type="button" class="cb-frame-link" data-goto="rules">Read the full framing</button></p>';
```

  `assert.ok(prose.includes(BANNER_71), …)` stays exactly as it is.
- [ ] **A4. The eyebrow.** If the CEO's word **explicitly** covers dropping the "Provisional" eyebrow (D1's second half), delete the `<p class="cb-eyebrow">` element and replace `assert.ok(prose.includes(EYEBROW_71), 'the eyebrow must match the pinned text exactly');` with:

```js
  // D1 (CEO, <YYYY-MM-DD>): the "Provisional" eyebrow is dropped; the banner, unchanged, carries its claims.
  assert.ok(!prose.includes('class="cb-eyebrow"'), 'D1: the eyebrow is gone, not restyled into something else');
```

  Keep the `'defaults only'` assertion (it still guards the page). In `tests/e2e/cbam-lines.spec.ts`'s Rules test (Task 7), change `await expect(page.locator('[data-view="rules"] .cb-eyebrow')).toBeVisible();` to `await expect(page.locator('[data-view="rules"] .cb-banner')).toBeVisible();` in the same commit. **If the word covers only the fold, leave the eyebrow, its pin and that e2e line untouched**, and add `await expect(page.locator('[data-view="rules"] .cb-banner')).toBeVisible();` after it.
- [ ] **A5. Gate and commit.**

```bash
node --import tsx --test tests/unit/cbam-render.test.mjs 2>&1 | tail -4
npm run check && npm run build && npx playwright test tests/e2e/cbam-shell.spec.ts tests/e2e/cbam-lines.spec.ts --project=chromium-tier0 --reporter=line
git add -- src/pages/cbam/cbam-calculator.astro tests/unit/cbam-render.test.mjs
git commit -m "feat(cbam): D1 — §7.1 banner moves to Rules verbatim; one-line summary on Estimate (CEO, <date>)"
```

  **Mutation check:** append ` Expected price: €80.` inside the moved banner; confirm both the exact pin and the ported no-forecast pin fail; restore.

---

### Task 10: `cbam-bento.css` — the List, Export and Rules tiles

**Files:**
- Modify (append): `src/styles/cbam-bento.css`

The visual authority is the preview (`preview/bento.css`, the `list`, `export` and `rules` sections of `bento.html`, and `screens/4-*`, `5-*`, `6-*`). The view-specific rules below are ported from `bento.css` in its source order (later duplicates win, as in the preview), scoped under `.cbx`, with `[data-device="phone"]` turned into `@media (max-width:899px)`. The second block styles the `cb-*` honesty hooks inside tiles, which the unit suite pins by name and so are never renamed.

- [ ] **Step 1: Fill any missing primitive.** For each primitive Task 1 reported at count 0, copy its rule(s) verbatim from `docs/superpowers/specs/2026-11-02-cbam-rail-ui/preview/bento.css` (or `system.css`/`cbam.css` for `.chip`, `.kv`, `.foot`, `.num`, `.btn`), prefixed with `.cbx `, under a `/* phase-4 fill: shared primitive phase 2 did not carry */` comment. If none is missing, skip this step.

- [ ] **Step 2: Append.**

```css
/* ── Phase 4: Shipment list, Export, Rules & sources (spec §5.4–5.6) ───────────────────────────
   Ported from the preview's bento.css (source order kept), scoped under .cbx. */
.cbx h2.b-t-ti{margin:0}
.cbx .b-list{margin-bottom:12px}
.cbx .b-c3{grid-template-columns:repeat(3,minmax(0,1fr))}
.cbx .b-chips{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end}
.cbx .b-row2{display:flex;gap:8px;margin-top:14px}
.cbx .b-row2 .btn{flex:1}
.cbx .b-ghost{height:46px;border-radius:99px;font-size:14px;font-weight:600;background:transparent;box-shadow:inset 0 0 0 1.5px color-mix(in oklab,var(--on-ink) 40%,transparent);color:var(--on-ink)}
.cbx .b-stackbar{display:flex;gap:4px;height:14px;margin:14px 0 0}
.cbx .b-stackbar b{border-radius:7px;background:color-mix(in oklab,var(--on-ink) 80%,transparent)}
.cbx .b-stackbar b+b{background:color-mix(in oklab,var(--on-ink) 45%,transparent)}
.cbx .b-stackbar b+b+b{background:color-mix(in oklab,var(--on-ink) 22%,transparent)}
.cbx .b-pass-name{font-size:22px;font-weight:500;letter-spacing:-.02em;margin:6px 0 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cbx .b-share-row{display:flex;justify-content:space-between;font-size:11.5px;font-weight:600;color:var(--ink-3);margin-top:10px}
.cbx .b-share{position:relative;height:12px;border-radius:6px;background:var(--well);overflow:hidden;margin:6px 0 8px}
.cbx .b-share b{position:absolute;left:0;top:0;bottom:0;background:var(--ink);border-radius:6px}
.cbx .b-rm{align-self:flex-start;margin-top:8px;border:0;background:transparent;color:var(--ink-3);font-size:12.5px;font-weight:600;cursor:pointer;padding:6px 0}
.cbx .b-csvwrap{overflow-x:auto;border-radius:16px;background:var(--well);margin:12px 0 10px}
.cbx .b-csv{border-collapse:collapse;font-size:12px;white-space:nowrap;width:100%}
.cbx .b-csv th,.cbx .b-csv td{padding:8px 12px;text-align:left}
.cbx .b-csv th{color:var(--ink-3);font-weight:600}
.cbx .b-csv td{border-top:1px solid var(--line)}
.cbx .b-fps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px}
.cbx .b-fps figure{margin:0;display:flex;gap:14px;align-items:center}
.cbx .b-fps .b-fp{width:112px;padding:12px;gap:4px}
.cbx .b-fps figcaption b{display:block;font-size:14px}
.cbx .b-fps figcaption span{font-size:12px;color:var(--ink-3)}
.cbx .b-frame-full{font-size:18px;line-height:1.5;letter-spacing:-.005em;margin-top:auto}
.cbx .b-np{display:flex;flex-direction:column;gap:14px;margin-top:14px}
.cbx .b-npi{display:flex;gap:14px}
.cbx .b-npi b{font-size:15px}
.cbx .b-npi p{font-size:13px;line-height:1.5;color:var(--ink-2);margin:4px 0 0}
.cbx .b-npi ul.foot{margin:6px 0 0;padding-left:16px}
.cbx .b-dash{flex:none;width:44px;height:44px;border-radius:12px;box-shadow:inset 0 0 0 2px var(--ink-3);background:repeating-linear-gradient(135deg,transparent 0 6px,color-mix(in oklab,var(--ink) 10%,transparent) 6px 8px)}
.cbx .b-key{display:flex;flex-direction:column;gap:6px;margin-top:auto}
.cbx .b-k{border-radius:16px;padding:12px 14px;display:flex;flex-direction:column;gap:2px;font-size:12.5px}
.cbx .b-k b{font-size:15px}
.cbx .b-k-bz{background:var(--bronze-f);color:#141614}
.cbx .b-k-cy{background:var(--cyan-f);color:#071a1d}
.cbx .b-k-ink{background:var(--ink);color:var(--on-ink)}
.cbx .b-fp-sm{width:96px;padding:10px;gap:3px;margin-top:12px}
.cbx .b-srcs ol.src{list-style:none;margin:10px 0 0;padding:0;columns:2;column-gap:28px}
.cbx .b-srcs .src li{break-inside:avoid;padding:10px 0;border-top:1px solid var(--line)}
.cbx .b-srcs .src li:first-child{border-top:0}
.cbx .b-srcs .src b{font-size:13px;font-weight:600;max-width:34ch}
.cbx .b-srcs .src a{color:var(--ink-2);overflow-wrap:anywhere}
.cbx .b-t .cb-foot{margin:10px 0 0;max-width:72ch;font:400 14px/1.5 var(--sans);color:var(--ink-2)}
.cbx .b-frame .cb-eyebrow{margin:8px 0 0;font:600 11px/1.4 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
.cbx .b-frame .cb-banner{margin:auto 0 0;padding:0;max-width:none;border-radius:0;background:none;font:400 15px/1.55 var(--sans);color:inherit}
.cbx .cb-frame-sum{margin:0 4px 16px;font-size:14px;color:var(--ink-2)}
.cbx .cb-frame-link{border:0;background:none;padding:0;font:inherit;font-weight:600;color:var(--ink);text-decoration:underline;cursor:pointer}
.cbx .b-t .cb-btn.b-add{border:0;padding:0 22px;cursor:pointer}
.cbx .b-t .cb-btn.b-add:disabled{opacity:.45;cursor:not-allowed}

/* The honesty hooks inside tiles. Their markup is pinned by tests/unit/cbam-render.test.mjs, so
   they are styled here and never renamed. Status tags are ink: colour is provenance only (spec §3). */
.cbx .b-t .cb-tag{display:inline-flex;align-items:center;height:26px;padding:0 11px;border-radius:99px;background:var(--well);color:inherit;font-size:12px;font-weight:600;white-space:nowrap}
.cbx .b-t .cb-tag.unavail{background:transparent;box-shadow:inset 0 0 0 1.5px currentColor}
.cbx .b-t .cb-fig{margin:auto 0 0}
.cbx .b-t .cb-n{font-size:64px;font-weight:400;letter-spacing:-.05em;line-height:1}
.cbx .b-hero .cb-n{font-size:clamp(72px,7vw,120px);letter-spacing:-.06em;line-height:.9}
.cbx .b-t .cb-u{font-size:12.5px;color:var(--ink-3);margin-top:4px}
.cbx .b-t .cb-cost{display:inline-flex;align-self:flex-start;align-items:center;height:26px;margin-top:10px;padding:0 11px;border-radius:99px;background:var(--well);font-size:12px;font-weight:600}
.cbx .b-t .cb-sub{margin:10px 0 0;font-size:13px;line-height:1.5;color:var(--ink-2)}
.cbx .b-hero .cb-sub{color:var(--ink-3)}
.cbx .b-t .cb-warn{font-weight:600}
.cbx .b-t .cb-prov{margin:auto 0 0;padding-top:10px;font-size:11px;line-height:1.5;color:var(--ink-3)}
.cbx .b-t .cb-attest{display:flex;gap:10px;align-items:flex-start;margin-top:12px;font-size:13px;font-weight:600}
.cbx .b-t .cb-attest input{width:18px;height:18px;margin:1px 0 0;accent-color:var(--ink)}
.cbx .b-pass .cb-card{margin-top:12px;padding:0;border:0;background:transparent;box-shadow:none}
.cbx .b-pass .cb-card-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
.cbx .b-pass .cb-card-label{margin:0;font-size:12px;font-weight:600;color:var(--ink-3)}
.cbx .b-t .cb-water,.cbx .b-t .cb-stamp{margin-top:10px}
.cbx .b-t .cb-row{display:flex;justify-content:space-between;gap:14px;padding:6px 0;border-bottom:1px solid var(--line);font-size:12.5px}
.cbx .b-t .cb-row span{color:var(--ink-2)}
.cbx .b-t .cb-row b{font-weight:700;text-align:right;overflow-wrap:anywhere}
.cbx .b-t .cb-stamp-h{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);margin-bottom:4px}
.cbx .b-t .cb-notes{margin:8px 0 0;padding-left:18px;font-size:12px;line-height:1.5;color:var(--ink-2)}
.cbx .b-t .cb-reason{margin:8px 0 0;font-size:14px;font-weight:600}
.cbx .b-t .cb-sel{display:flex;flex-direction:column;gap:2px;margin-top:8px;font-size:12px;color:var(--ink-2)}
.cbx .b-t .cb-sel code{overflow-wrap:anywhere}
.cbx .b-t .cb-delta{margin-top:10px;padding:12px 14px;border-radius:14px;background:var(--well)}
.cbx .b-t .cb-delta-h{font-size:12px;font-weight:600;color:var(--ink-3)}
.cbx .b-t .cb-attested{color:var(--ink)}

@media (max-width:1100px){
  .cbx .b-c3{grid-template-columns:1fr 1fr}
  .cbx .b-fps{grid-template-columns:1fr 1fr}
}
@media (max-width:899px){
  .cbx .b-c3{grid-template-columns:1fr}
  .cbx .b-fps{grid-template-columns:1fr 1fr}
  .cbx .b-srcs ol.src{columns:1}
}
```

- [ ] **Step 3: Headless screenshots, compared with the preview by eye.** Write `/Volumes/OBOSLab/tmp/cbam-rail-p4/shots.mjs`:

```js
// Headless only. List (3 lines incl. an attested year), Export, Rules (pack loaded), in light and dark, desktop and phone.
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://127.0.0.1:4321/cbam/cbam-calculator/';
const out = '/Volumes/OBOSLab/tmp/cbam-rail-p4/shots';
const browser = await chromium.launch({ headless: true });
for (const theme of ['light', 'dark']) for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${base}?theme=${theme}`);
  for (const mass of ['30', '60', '10']) {
    await page.fill('#cbCn', '2523100090'); await page.dispatchEvent('#cbCn', 'change');
    await page.fill('#cbDate', '2026-03-15');
    await page.locator('#cbCountry option[value="DZ"]').waitFor({ state: 'attached' });
    await page.selectOption('#cbCountry', 'DZ');
    await page.locator('#cbRoute option[value="(A)"]').waitFor({ state: 'attached' });
    await page.selectOption('#cbRoute', '(A)');
    await page.fill('#cbMass', mass);
    await page.waitForTimeout(400);
    await page.click('#cbAdd');
  }
  for (const v of ['list', 'export', 'rules']) {
    // A hash change, never a reload: a reload would empty the list. views.ts listens for hashchange.
    await page.evaluate((x) => { location.hash = x; }, v);
    if (v === 'rules') await page.locator('#cbSources [data-load-pack]').click().catch(() => { /* already loaded */ });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${v}-${tag}-${theme}.png`, fullPage: true });
  }
  await page.close();
}
await browser.close();
```

  Run `mkdir -p /Volumes/OBOSLab/tmp/cbam-rail-p4/shots` first. Serve with `npm run build && npx astro preview --port 4321 &` in the worktree, run `node /Volumes/OBOSLab/tmp/cbam-rail-p4/shots.mjs`, stop the preview server by its PID. Compare each PNG with `screens/4-list-*`, `5-export-*`, `6-rules-*` and check: no text over an illustration slot; numerals not clipped; tags readable in the hero tiles; the phone layout single-column with no sideways scroll. Fix and re-shoot. **Never open a visible browser.**

- [ ] **Step 4: Commit.**

```bash
git add -- src/styles/cbam-bento.css
git commit -m "style(cbam): List, Export and Rules tiles; cb-* honesty hooks inside tiles"
```

---

### Task 11: Light follows the OS again, and AA contrast is proven in both themes

**Files:**
- Modify: `src/pages/cbam/cbam-calculator.astro` (the page `<script>` only)
- Create: `tests/e2e/cbam-contrast.spec.ts`

Spec §4.3's interim note: the shell defaulted to Dark because today's cards were drawn for a dark ground (the attest label measured 1.01:1 in Light). With every view restyled, Light follows the OS again.

- [ ] **Step 1: Prerequisite.** Confirm no unrestyled card remains on any view: `grep -n "cb-out\b" src/pages/cbam/cbam-calculator.astro` and read each hit's view. If Three years or Why still renders a pre-redesign `cb-card` (phase 3 incomplete), **stop and report**; the default must not flip over an unstyled card.

- [ ] **Step 2: Write the contrast spec (it fails first).**

```ts
// tests/e2e/cbam-contrast.spec.ts
// Spec §4.3 / §6.5: the theme follows the OS, and every view meets WCAG AA contrast in both
// themes, populated (lines in the list, an attested year, a refused line) — headless.
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const URL = '/cbam/cbam-calculator/';
const VIEWS = ['estimate', 'three-years', 'why', 'list', 'export', 'rules'] as const;

async function addLine(page: Page, cn: string, country: string, route: string, mass: string, date = '2026-03-15'): Promise<void> {
  await page.fill('#cbCn', cn);
  await page.dispatchEvent('#cbCn', 'change');
  await page.fill('#cbDate', date);
  await expect(page.locator(`#cbCountry option[value="${country}"]`)).toBeAttached();
  await page.selectOption('#cbCountry', country);
  await expect(page.locator(`#cbRoute option[value="${route}"]`)).toBeAttached();
  await page.selectOption('#cbRoute', route);
  await page.fill('#cbMass', mass);
  const before = await page.locator('#cbList .cb-line').count();
  await page.click('#cbAdd');
  await expect(page.locator('#cbList .cb-line')).toHaveCount(before + 1);
}

async function go(page: Page, view: string): Promise<void> {
  await page.locator(`.cbx-rail [data-goto="${view}"]`).click();
  await expect(page.locator(`[data-view="${view}"]`)).toBeVisible();
}

test.describe('CBAM contrast', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const scheme of ['light', 'dark'] as const) {
    test(`with no ?theme, the page follows the OS (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(URL);
      await expect(page.locator('#cbx')).not.toHaveAttribute('data-theme', /.*/);
      const bg = await page.locator('#cbx').evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(scheme === 'light' ? 'rgb(239, 236, 230)' : 'rgb(3, 20, 22)');
    });

    test(`every view meets AA colour contrast, populated (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(URL);
      // Three tile states on the List: 2026 under 50 t (attested → below threshold, the cb-tag ok
      // tone), 2027 (no published rule; a line with certificates and no published price).
      await addLine(page, '2523100090', 'DZ', '(A)', '30');
      await addLine(page, '2523100090', 'DZ', '(A)', '30', '2027-03-15');
      await go(page, 'list');
      await page.locator('#cbList [data-attest="2026"]').check();
      await expect(page.locator('#cbList .cb-thresh').first()).toContainText('Below threshold');
      await go(page, 'rules');
      await page.locator('#cbSources [data-load-pack]').click().catch(() => { /* already loaded */ });
      for (const v of VIEWS) {
        await go(page, v);
        const r = await new AxeBuilder({ page }).include(`[data-view="${v}"]`).include('.cbx-rail').withRules(['color-contrast']).analyze();
        expect(r.violations.map((x) => `${v}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      }
    });
  }
});
```

  Run before Step 3: `npm run build && npx playwright test tests/e2e/cbam-contrast.spec.ts --project=chromium-tier0 --reporter=line`. Expected: the two "follows the OS" tests FAIL (`data-theme` is forced to `dark`). Record whether the contrast tests pass in dark.

- [ ] **Step 3: Restore the OS default.** In the page `<script>`, replace the `ponytail:` comment and the `root.dataset.theme = theme === 'light' ? 'light' : 'dark';` line with:

```js
    // ?theme=light|dark forces a theme, for tests and screenshots. Otherwise the OS decides
    // (spec §4.3). The phase-1 interim Dark default ended in phase 4, once every view was restyled.
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;
```

- [ ] **Step 4: Run until green.**

```bash
npm run build && npx playwright test tests/e2e/cbam-contrast.spec.ts --project=chromium-tier0 --reporter=line
```

  Fix each reported node in `cbam-bento.css` (a token pair, never `opacity` on text). The usual suspects: `--ink-3` text inside `.b-hero` (on-ink at 62%), `.b-k-cy` text, `.cb-tag.unavail`'s outline text. **No `exclude()`, no rule disabled.** Then run `tests/e2e/cbam-lines.spec.ts` too: its `axe: a populated multi-line state…` and `320 px, axe, and paper…` tests now run in the OS-default theme.

- [ ] **Step 5: Commit.**

```bash
git add -- src/pages/cbam/cbam-calculator.astro tests/e2e/cbam-contrast.spec.ts src/styles/cbam-bento.css
git commit -m "feat(cbam): Light follows the OS again (spec §4.3); AA contrast checked on six views in both themes"
```

---

### Task 12: Gate, review, PR

**Files:** none new.

- [ ] **Step 1: The local gate.**

```bash
npm run check && npm run build && npm run test:unit 2>&1 | tail -6
grep -c "^test(" tests/unit/cbam-render.test.mjs
npx playwright test tests/e2e/cbam-lines.spec.ts tests/e2e/cbam-shell.spec.ts tests/e2e/cbam-contrast.spec.ts --project=chromium-tier0 --reporter=line
npx playwright test --project=firefox-cbam --reporter=line
```

Expected: clean; the render count ≥ the Task 1 baseline; the unit total = baseline + every new test; e2e green; the `cbam-lines.spec.ts` test count = baseline + 3.

- [ ] **Step 2: The invariants, by grep.**

```bash
git diff feat/cbam-rail-ui...HEAD --stat -- $(node -e 'console.log(Object.keys(require("./src/scripts/cbam-algos/UPSTREAM.json").files).map(f=>"src/scripts/cbam-algos/"+f).join(" "))') | tail -1
git diff feat/cbam-rail-ui...HEAD -- src/scripts/cbam-lines.ts | wc -l
git diff feat/cbam-rail-ui...HEAD -- src/scripts/cbam-algos/cbam-app.ts | grep -n "^[-+].*function buildPrintDocument\|^[-+].*csvRows("
```

Expected: no vendored file changed; `cbam-lines.ts` unchanged (`0`), so the CSV columns did not change; `buildPrintDocument`'s body not in the diff (spec §3).

- [ ] **Step 3: Opus review.** Dispatch an Opus 5.5 reviewer with this plan, spec §3, §5.4–5.6, §6 and §11, and `git diff feat/cbam-rail-ui...HEAD`. Ask it to check:
  - every test in the ledger is present and none was weakened (`git diff` of the test files, assertion by assertion);
  - the `#cbStatus` builder and `onOutClick` are byte-identical to the base;
  - every id in spec §6.4, plus `cbList`, `cbTitle`, `cbTitlePhone`, `cbExportCsv`, `cbExportDoc`, `cbExportFps`, `cbNotYet`, `cbRulePack`, `cbSources`, exists exactly once;
  - the CSV preview is drawn from the same `csvRows` call as `onCsv`;
  - the D4 sentence and its test say the same thing, and the probe counts what the plan says it counts;
  - the banner is byte-identical to `origin/main` and exists once, wherever D1 left it.

  Fix what it confirms.

- [ ] **Step 4: Push and PR, only on the user's word.**

```bash
git log --oneline feat/cbam-rail-ui..HEAD
git push -u origin feat/cbam-rail-ui-p4
```

PR base `feat/cbam-rail-ui`, title "CBAM rail redesign, phase 4 of 5: List, Export, Rules". In the body: the D4 measurement (28 of 572, how counted), the D1 outcome taken, the two wording points awaiting the founder (below).

---

## Self-review against the spec

| Spec | Task |
|---|---|
| §5.4 Total (line count, what-if, certificates, €, Export, Add a line; C2 exempt amount outside) | 4, 5 |
| §5.4 Annual de minimis per year: mass vs 50 t ruler, verdict tag, `data-attest` | 3, 5 |
| §5.4 Line plates: chip, name, code · origin · route · mass · date, figures, price locator, share bar, `data-remove`; refused line shows its reason | 4, 5 |
| §5.5 CSV: column count, line count, full precision, 6-row preview of the real CSV, `#cbCsv`; Document, `#cbDoc`; `#cbPrint` untouched; fingerprints | 6 |
| §5.6 Framing, Not yet published, Colour key, Rule pack, Method (D4), Sources; pack parts filled after `ensurePack()` | 7, 9 |
| §4.1 title card final form | 8 |
| §4.3 Light follows the OS; AA in both themes | 11 |
| §6.1 every tile's refusal states; every assertion ported | Ledger, 3, 4 |
| §6.2 banner once, verbatim; eyebrow under the Rules framing title | 7, 9 |
| §6.3 `#cbStatus` and focus after remove/attest survive | 5 (untouched code), 12 |
| §6.4 ids and hooks alongside `b-` classes | 3–7, 12 |
| §3 print document and CSV columns unchanged | 2 (byte check), 12 |
| §8 illustrations and motion | **Not in phase 4**: phase 5 (no `b-ill`, no `b-anim` here) |

## Open points this plan leaves for the founder or the reviewer

1. **D1** (CEO): Task 9 Outcome A or B. Without a word, B ships.
2. **D4 wording** (founder): the figure is measured; "shows no figure" replaces "shows no deduction", because the engine refuses and the form withholds the route. Confirm or reword; the test pins the figure clause only from "— 28 of 572" on.
3. **"6-row preview"**: built as the first 6 lines × 6 named columns, saying so when it cuts either. The preview showed 3 rows × 6 columns.
4. **Not yet published** lists three groups, not the spec's two: the pack also marks **2026-Q4** price pending. Rendered from the pack, as the spec's "no new claims" rule requires.
5. **Document tile copy** no longer says "and the framing in full" (the preview's line): `buildPrintDocument` does not reprint the §7.1 banner.
