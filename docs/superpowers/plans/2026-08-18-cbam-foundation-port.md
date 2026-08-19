# CBAM Correctness Foundation — Port Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Codex's corrected CBAM foundation — pack v2, input validation, sealed pack integrity — on current `main` in both repos, without losing a single fix made this week.

**Architecture:** Both halves of Codex's work were built on trees that predate this week's merged work, so **neither branch may be merged**. Instead we rebuild: fresh branches from each repo's current `main`, re-apply Codex's commits, resolve each overlap deliberately, and prove by test that the earlier fixes survived. CBM goes first because the website vendors its engine byte-for-byte and the new sync-check pins `upstreamCommit`.

**Tech Stack:** TypeScript, Astro, Playwright, `node:test` (website) · TypeScript, Vue 3, vitest, Python generators (CBM).

---

## Why this plan exists — measured, not assumed

Codex's own audit reached the right conclusion ("do not merge the current feature branch wholesale") but understated the reason. Measured on 2026-08-18:

| | CBM | Website |
|---|---|---|
| Codex branch | `feat/cbam-ts-correctness-foundation` @ `bb5bdf1` | same name @ `b83da16` |
| Commits only on `main` | **31** | **221** |
| Commits only on the branch | 4 | 110 |
| Size | 26 files, +1,665 / −784 | 24 CBAM files, +4,256 / −1,119 |

**Neither branch contains this week's work.** Verified per fix rather than per commit:

| fix | on `main` | on Codex's branch |
|---|---|---|
| date gate — a cleared date priced as **year 0** | `\|\| !date!.value` in both gates | **absent** |
| sector caption (`sectorList([t.sector])`) | present | **absent** |
| route-pick memory (`lastRoutePick`) | present | **absent** |
| `renderAttestation` `priced` guard | present | **absent** |
| CBM PRs #44 / #45 / #46 | merged | **absent** |

Merging `b83da16` wholesale would reintroduce the year-0 pricing bug that Codex's *own first audit* raised. That is the single fact this plan exists to prevent.

## Decisions taken, and why

1. **CBM first, website second.** Not preference — the website's `UPSTREAM.json` (schemaVersion 2 on Codex's branch) pins `upstreamCommit`, and the rewritten `cbam-sync-check.mjs` verifies vendored files against it. The website port cannot be verified until CBM's commit exists on CBM `main`.
2. **Rebuild, never merge.** A merge would drag 110 unrelated heat-map/research commits into a CBAM PR (Codex measured ~205 files, +31,117). Cherry-pick the 4 CBM commits and re-apply the website's CBAM subset.
3. **The CSCF stays `pending`.** See "The one thing nobody may change" below.
4. **Preservation is asserted, not hoped.** Each of the five fixes above gets an explicit test or grep assertion in the port itself. A port that silently drops one is the failure mode; a test is the only thing that catches it.

## THE ONE THING NOBODY MAY CHANGE

Codex's audit calls the CSCF corpus "legally stale" and asks for the five CSCF records to be set to `value: "1", status: "published"`, citing **Commission Implementing Decision (EU) 2026/1862** of 24 July 2026.

**That citation is unverified and must not be acted on in this plan.**

- Web search does not surface it. Its 2021 analogue, Implementing Decision (EU) 2021/927, is readily found; 2026/1862 is not.
- EUR-Lex's ELI page returns blank through its WAF.
- **Codex's own fix commit `b83da16` never mentions 1862**, and its pack still carries all five years as `pending`.

**The direction of risk is what settles it.** Marking the CSCF published converts every figure from a labelled what-if into a stated final answer. If the decision does not exist, that is a false final figure on a live regulated calculator — the exact over-claim this codebase spends its refusals avoiding. Leaving it `pending` when it *is* published understates confidence, which is the safe direction.

**Action for a human, not this plan:** confirm the OJ reference in a browser. If it is real, it is its own spec — pack regeneration, copy, exports, tests and provenance all move together. If it is not, record that it was checked.

Any task in this plan that finds itself editing a `cscf` record has gone wrong.

---

## DECISION 2026-08-18: the corpus moves to TARIC — Codex's choice, taken

Task 1 revealed the port is a **corpus migration**, not plumbing. `defaultFactors` (41,100) became
`defaultValues` (**76,428**); 7 codes retired including `25231000`, `25239000`, `25070080` and all
four `7615`; 28 added including the 10-digit splits `2523100090` (grey clinker) / `2523100010`
(white). Measured through the real engine: `25231000` → **refused**; `2523100090` → `cscf_pending`,
**75.865 certs**. The figure is preserved at the new key; only the key moved.

**Codex chose to accept the 10-digit keys and moved the whole surface with them** — its placeholder
reads `e.g. 2523100090 — cement clinker`, its e2e uses `cn: '2523100090'`, and its pack schema still
permits 4/6/8/10 digits (`/^\d{4}(?:\d{2}){0,3}$/`); the corrected workbook simply supplies 10
digits for those cement lines. **The founder has taken that choice.** Do not add a parallel 8-digit
key: it would reintroduce the white-vs-grey ambiguity the TARIC split exists to resolve, which the
old design papered over with the production route.

Discovery is already handled: the CN datalist is the whole corpus with the option *value* set to the
code, and an 8-digit CN is a **prefix** of its 10-digit TARIC — so typing `25231000` surfaces
`2523100090` natively in the browser.

**Two additions to this plan follow from the decision:**

- **A1 — the code-too-short refusal (Task 5).** Type `25231000`, ignore the dropdown, and today you
  get *"The Commission publishes no default value for this good, origin, production route or
  year."* That is false — it publishes it at a more specific code. This is the same defect class the
  rest of this work exists to remove: a refusal naming the wrong cause. It must name the real one
  and offer the codes.
- **A2 — `defaultFactors` → `defaultValues` in the UI (Task 5).** `cbam-app.ts:1747` builds the
  ORIGINS dropdown from `pack.defaultFactors`, which v2 does not have. Unhandled, the origin list
  renders empty and the form cannot be completed at all.

**Task 7 is re-specced by this.** Its original expectation — "figures unchanged, the pack is the same
corpus" — is **wrong and must not be used as an acceptance criterion**. Figures WILL move for any
selector naming a retired code. Task 7's job becomes: prove every movement is explained by the
corpus migration, and that no selector surviving under the same key changed value.

## Repos, branches, baselines

| | path | branch to create | from | baseline |
|---|---|---|---|---|
| CBM | `/Volumes/VSTSAMPLES/Projects/CBM` | `feat/cbam-foundation-port` | `main` @ `10e32a4` | `npx vitest run --exclude '**/*.integration.test.ts'` → **521 pass / 73 files** |
| Website | `/private/tmp/cbam-port` (worktree, exists) | `feat/cbam-foundation-port` | `origin/main` @ `36407cf` | `npm run test:unit` → **425 pass / 0 fail** |

CBM integration tests (`npm run test:db`) **cannot run locally** — no Docker. They run in CI. Never report them as locally verified.

Two CBM branches are open and unmerged; they are **out of scope** and must not be disturbed: `fix/fa-series-key-collisions` (PR #47) and `fix/suppliers-adverse-opinion`.

## File structure

**CBM — 4 commits to cherry-pick (`27633d3`, `556e747`, `4093b76`, `bb5bdf1`), 26 files.** New: `lib/cbam/input.ts`, `lib/estimator/pack-v2.ts`, `lib/estimator/load-pack.ts`, `public/estimator-pack.manifest.json`, `golden/rule-packages/eu-cbam-2026-defaults-v3.json`, `scripts/build-dv-package-v3.py`, and four new test files. Modified: `certificate-estimate.ts`, `resolve-fa.ts`, `sefa.ts`, `estimate-from-pack.ts`, `lib/regulatory/resolve.ts`, `src/stores/estimator.ts`, `scripts/build-estimator-pack.mts`, `scripts/build-fa-package.py`.

**Website — 3 clean adds, 3 clean ports, 11 real merges.**

- *Clean adds* (absent from `main`): `src/scripts/cbam-algos/estimator/pack-v2.ts`, `.../estimator/load-pack.ts`, `.../cbam/input.ts`, `public/cbam/estimator-pack.manifest.json`
- *Clean ports* (`main` unchanged since the merge base): `scripts/cbam-sync-check.mjs`, `playwright.config.ts`, `public/cbam/estimator-pack.json`
- *Real merges* (both sides changed): `src/scripts/cbam-algos/cbam-app.ts`, `.../cbam/certificate-estimate.ts`, `.../cbam/resolve-fa.ts`, `.../estimator/estimate-from-pack.ts`, `src/scripts/cbam-lines.ts`, `src/scripts/cbam-algos/UPSTREAM.json`, `src/pages/cbam/cbam-calculator.astro`, `tests/e2e/cbam-lines.spec.ts`, `tests/unit/cbam-lines.test.mjs`, `tests/unit/cbam-render.test.mjs`, `docs/cbam-engine-reference.md`, `.github/workflows/verify.yml`
- *New test file*: `tests/unit/cbam-pack.test.mjs`

**Out of scope entirely:** every heat-map, climate-engine, research, calibration and briefing file in Codex's 110 commits. If a task touches `src/scripts/climate-engine/` or `data/calibration/`, it has gone wrong.

---

## Standing constraints — read before every task

1. **Never merge either Codex branch.** Cherry-pick or re-apply named files only.
2. **`src/scripts/cbam-algos/` is vendored byte-for-byte from CBM** and hash-guarded. Only `cbam-app.ts` is hand-editable on the website. Everything else there must be copied from CBM, never hand-edited.
3. **Mutation-verify every preserved fix.** Break it, confirm a **named** test fails, restore, and confirm `git diff` is clean. A green mutation run is exactly what a *failed* mutation looks like — and one already went vacuously green in this project when a `perl` substitution silently failed to match. **Verify the mutation landed in the file before trusting the run.**
4. **Never state a call-site count from memory — grep it.** This project has undercounted call sites **seven times running**.
5. **Report what you measure, not what this plan predicts.** Several claims in earlier plans here were wrong in both directions: wrong line numbers, and correct line numbers with invented surrounding text. Verify against the file before editing.
6. **No `cscf` record may change.** See above.

---

## Task 1: CBM — branch and cherry-pick the foundation

**Files:** 26, listed above. **Repo:** `/Volumes/VSTSAMPLES/Projects/CBM`.

- [ ] **Step 1: Confirm the baseline before touching anything**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git update-index --refresh >/dev/null 2>&1; git checkout main
npx vitest run --exclude '**/*.integration.test.ts' 2>&1 | grep -E "Tests |Test Files"
```
Expected: `Tests 521 passed (521)`, `Test Files 73 passed (73)`. If it differs, **stop and report** — the plan's arithmetic downstream depends on this number.

- [ ] **Step 2: Create the port branch**

```bash
git checkout -b feat/cbam-foundation-port main
```

- [ ] **Step 3: Cherry-pick the four commits in order**

```bash
git cherry-pick 27633d3 556e747 4093b76 bb5bdf1
```

Expected: conflicts. The four commits are `fix(cbam): seal corrected TypeScript regulatory foundation`, `docs(cbam): correct electricity authority comments`, `fix(cbam): bundle exact pack integrity`, `test(cbam): inject sealed pack integrity`.

**Resolution rule:** Codex's version wins for engine mechanics (pack parsing, input validation, integrity sealing). `main`'s version wins wherever the hunk is one of this week's fixes. Where both changed the same line for different reasons, **keep both intents** and say so in the commit body.

- [ ] **Step 4: Verify none of this week's CBM work was reverted**

```bash
grep -n "includedSectors" api/routes/cases.ts | head -3
grep -n "textArrayColumn" api/pg-columns.ts | head -2
grep -rn "Art 1(2)" lib/cbam/sefa.ts | head -2
grep -c "emissionsType: 'indirect'\|'indirect'" lib/estimator/differential.test.ts
```
Expected, in order: `includedSectors` present in the case-detail response · `textArrayColumn` exists · `Art 1(2)` cited in `sefa.ts` · a non-zero count for the indirect arm. **Any absence is a reverted fix — stop and report which.**

- [ ] **Step 5: Run the gates**

```bash
npx vitest run --exclude '**/*.integration.test.ts' 2>&1 | grep -E "Tests |Test Files"
npm run typecheck && echo TYPECHECK_OK
npm run build 2>&1 | tail -2
```
Expected: tests **≥ 521** (Codex adds `pack-v2.test.ts`, `load-pack.test.ts`, `threshold-and-indirect.test.ts`, `estimate-from-pack.test.ts` — report the exact new number), typecheck clean, build clean.

- [ ] **Step 6: Confirm the CSCF was not touched**

```bash
node -e "const p=require('./public/estimator-pack.json');(p.cscf||[]).forEach(r=>console.log(r.year,r.status,JSON.stringify(r.value)))"
```
Expected: five rows, every one `pending null`. **If any row reads `published`, revert that hunk** — see "The one thing nobody may change".

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(cbam): port the corrected TypeScript foundation onto main"
```
In the body: name every conflict you resolved and which side won, and state the new test count against the 521 baseline.

---

## Task 2: CBM — push and let CI verify the database half

**Files:** none.

- [ ] **Step 1: Push and open a PR**

```bash
cd /Volumes/VSTSAMPLES/Projects/CBM
git push -u origin feat/cbam-foundation-port
gh pr create --base main --head feat/cbam-foundation-port \
  --title "feat(cbam): port the corrected TypeScript foundation onto main" \
  --body "Ported from feat/cbam-ts-correctness-foundation (bb5bdf1), which was built on a tree 31 commits behind main and lacked PRs #44/#45/#46. Rebuilt rather than merged. CSCF left pending — Decision (EU) 2026/1862 is unverified."
```

- [ ] **Step 2: Watch CI**

```bash
gh pr checks --watch
```
The integration suite (`npm run test:db`, ~205 tests) runs here and **only** here — no Docker locally. **Do not merge until it is green, and say plainly in the report that CI verified it, not you.**

- [ ] **Step 3: Record the merge commit**

After merging, capture the SHA — Task 3 pins the website's `UPSTREAM.json` to it.

```bash
git checkout main && git pull --ff-only && git rev-parse HEAD
```

---

## Task 3: Website — the clean adds and clean ports

**Repo:** `/private/tmp/cbam-port` (worktree on `feat/cbam-foundation-port`, already created from `origin/main` @ `36407cf`).

**Files:**
- Create: `src/scripts/cbam-algos/estimator/pack-v2.ts`, `.../estimator/load-pack.ts`, `.../cbam/input.ts`, `public/cbam/estimator-pack.manifest.json`
- Modify: `scripts/cbam-sync-check.mjs`, `playwright.config.ts`, `public/cbam/estimator-pack.json`, `src/scripts/cbam-algos/UPSTREAM.json`

- [ ] **Step 1: Confirm the baseline**

```bash
cd /private/tmp/cbam-port
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected: `tests 425`, `pass 425`, `fail 0`.

- [ ] **Step 2: Copy the vendored engine files from CBM `main`**

These are vendored, so they come from CBM — never hand-written here.

```bash
CBM=/Volumes/VSTSAMPLES/Projects/CBM
cp $CBM/lib/cbam/input.ts            src/scripts/cbam-algos/cbam/input.ts
cp $CBM/lib/estimator/pack-v2.ts     src/scripts/cbam-algos/estimator/pack-v2.ts
cp $CBM/lib/estimator/load-pack.ts   src/scripts/cbam-algos/estimator/load-pack.ts
cp $CBM/public/estimator-pack.json          public/cbam/estimator-pack.json
cp $CBM/public/estimator-pack.manifest.json public/cbam/estimator-pack.manifest.json
```

- [ ] **Step 3: Take the sync-check and Playwright config wholesale**

`main` has not touched either since the merge base, so these port with no merge.

```bash
git show b83da16:scripts/cbam-sync-check.mjs > scripts/cbam-sync-check.mjs
git show b83da16:playwright.config.ts       > playwright.config.ts
```

- [ ] **Step 4: Regenerate `UPSTREAM.json` against the real CBM commit**

Do **not** copy Codex's `UPSTREAM.json` — its `upstreamCommit` points at `bb5bdf15`, which is now the wrong commit. The new sync-check records it:

```bash
node scripts/cbam-sync-check.mjs --record
```
Expected: it writes `schemaVersion: 2` with `upstreamCommit` set to the SHA from Task 2 Step 3, plus `packSha256` and per-file digests. Print the file and confirm `upstreamCommit` matches.

- [ ] **Step 5: Verify the seal actually seals**

```bash
node scripts/cbam-sync-check.mjs && echo SYNC_OK
```
Then prove it is not vacuous — this is the P1 the old sync-check missed:

```bash
cp public/cbam/estimator-pack.json /tmp/pack-pristine.json
node -e "const f='public/cbam/estimator-pack.json';const p=require('./'+f);p.defaultFactors[0].baseIntensity='999999';require('fs').writeFileSync(f,JSON.stringify(p))"
node scripts/cbam-sync-check.mjs; echo "exit=$?"
cp /tmp/pack-pristine.json public/cbam/estimator-pack.json
node scripts/cbam-sync-check.mjs && echo RESTORED_OK
```
Expected: the tampered run **fails** with a byte-SHA mismatch and a non-zero exit; the restored run passes. **The old sync-check compared `generatedAt` only and would have passed the tampered pack — that is the defect being closed, so this proof is the point of the task.**

- [ ] **Step 6: Commit**

```bash
git add src/scripts/cbam-algos/cbam/input.ts src/scripts/cbam-algos/estimator/pack-v2.ts \
        src/scripts/cbam-algos/estimator/load-pack.ts src/scripts/cbam-algos/UPSTREAM.json \
        public/cbam/estimator-pack.json public/cbam/estimator-pack.manifest.json \
        scripts/cbam-sync-check.mjs playwright.config.ts
git commit -m "feat(cbam): vendor pack v2, input validation and a sealed pack digest"
```
Put the tamper-proof from Step 5 in the body, with both exit codes.

---

## Task 4: Website — merge the four engine files, preserving this week's fixes

**Files:**
- Modify: `src/scripts/cbam-algos/cbam/certificate-estimate.ts`, `.../cbam/resolve-fa.ts`, `.../estimator/estimate-from-pack.ts` (all vendored — copy from CBM), and `src/scripts/cbam-lines.ts` (hand-merged)

- [ ] **Step 1: Copy the three vendored engine files from CBM `main`**

```bash
CBM=/Volumes/VSTSAMPLES/Projects/CBM
cp $CBM/lib/cbam/certificate-estimate.ts   src/scripts/cbam-algos/cbam/certificate-estimate.ts
cp $CBM/lib/cbam/resolve-fa.ts             src/scripts/cbam-algos/cbam/resolve-fa.ts
cp $CBM/lib/estimator/estimate-from-pack.ts src/scripts/cbam-algos/estimator/estimate-from-pack.ts
node scripts/cbam-sync-check.mjs --record && node scripts/cbam-sync-check.mjs && echo SYNC_OK
```

- [ ] **Step 2: Prove the 1-January boundary still holds**

This week's validity-window fix lives in `resolve-fa.ts`, which you just overwrote from CBM. Codex's first audit reported 1 January failing on the old tree; `main` fixed it. Confirm CBM's copy also has it:

```bash
cat > .jan1.mts <<'EOF'
import { readFileSync } from 'node:fs'
import { estimateFromPack } from './src/scripts/cbam-algos/estimator/estimate-from-pack.ts'
const pack = JSON.parse(readFileSync('./public/cbam/estimator-pack.json','utf8'))
for (const date of ['2026-01-01','2026-01-02','2026-03-15']) {
  const e: any = estimateFromPack(pack, { cn:'25231000', country:'DZ', route:'(A)', massT:'100', date, emissionsScope:'direct_and_indirect' } as any)
  console.log(date, e.status, e.scenario?.certificates ?? '-')
}
EOF
npx tsx .jan1.mts; rm -f .jan1.mts
```
Expected: all three dates identical — `cscf_pending 75.865`. **If 2026-01-01 differs, CBM's `resolve-fa.ts` lacks the `day()` truncation and Task 1 dropped it. Stop and report.**

- [ ] **Step 3: Prove the route-aware indirect factor survived**

```bash
cat > .ind.mts <<'EOF'
import { readFileSync } from 'node:fs'
import { estimateFromPack } from './src/scripts/cbam-algos/estimator/estimate-from-pack.ts'
const pack = JSON.parse(readFileSync('./public/cbam/estimator-pack.json','utf8'))
for (const route of ['(A)','(B)']) {
  const e: any = estimateFromPack(pack, { cn:'25231000', country:'DZ', route, massT:'100', date:'2026-03-15', emissionsScope:'direct_and_indirect' } as any)
  console.log(route, 'certs', e.scenario?.certificates, 'cost', e.scenario?.costEur)
}
EOF
npx tsx .ind.mts; rm -f .ind.mts
```
Expected: route `(A)` → **75.865 certs, 5717.19**; route `(B)` differs. Route (A) taking route (B)'s 0.06 indirect factor was the over-charge fixed weeks ago; `(A)` returning 78.065 means it regressed.

- [ ] **Step 4: Prove the unsafe-number gate survived**

```bash
cat > .gate.mts <<'EOF'
import { readFileSync } from 'node:fs'
import { estimateFromPack } from './src/scripts/cbam-algos/estimator/estimate-from-pack.ts'
const pack = JSON.parse(readFileSync('./public/cbam/estimator-pack.json','utf8'))
for (const massT of ['-100','NaN','Infinity','0x10','1_000','','abc']) {
  let out; try { const e:any = estimateFromPack(pack,{cn:'25231000',country:'DZ',route:'(A)',massT,date:'2026-03-15',emissionsScope:'direct_and_indirect'} as any); out = e===null?'null':e.status } catch (x:any) { out='THREW' }
  console.log(JSON.stringify(massT).padEnd(10), out)
}
EOF
npx tsx .gate.mts; rm -f .gate.mts
```
Expected: every input `unavailable` (or `null`). **None may produce a priced figure, and none may throw** — an uncaught `Decimal` error is the pre-fix behaviour.

- [ ] **Step 5: Hand-merge `src/scripts/cbam-lines.ts`**

Both sides changed it: `main` for the multi-line/threshold work, Codex to add the sealed-digest plumbing. Take Codex's digest changes, keep `main`'s everything-else.

```bash
git diff origin/main b83da16 -- src/scripts/cbam-lines.ts | head -120
```

`packSnapshotHash` is the crux. On `main` it hashes `generatedAt` plus the two workbook digests, which is exactly the blindness Codex's audit caught: a changed factor produces the same stamp. Codex's version incorporates the sealed pack digest. **Take Codex's**, and keep `main`'s docblock warning about refusing a missing `workbookSha256` rather than folding in `''`.

- [ ] **Step 6: Prove the audit stamp is no longer blind**

```bash
cat > .stamp.mts <<'EOF'
import { readFileSync } from 'node:fs'
import { packSnapshotHash } from './src/scripts/cbam-lines.ts'
const pack = JSON.parse(readFileSync('./public/cbam/estimator-pack.json','utf8'))
const before = await packSnapshotHash(pack)
const f = pack.defaultFactors.find((x:any)=>x.scopeCode==='25231000'&&x.originCountry==='DZ')
f.baseIntensity = '999999'
const after = await packSnapshotHash(pack)
console.log('changed factor detected:', before !== after ? 'YES' : '*** NO — still blind ***')
EOF
npx tsx .stamp.mts; rm -f .stamp.mts
```
Expected: `YES`. **This is the headline of the whole port** — on `main` today the answer is `NO`.

- [ ] **Step 7: Gates and commit**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)|vendored engine"
git add src/scripts/cbam-algos/cbam/certificate-estimate.ts src/scripts/cbam-algos/cbam/resolve-fa.ts \
        src/scripts/cbam-algos/estimator/estimate-from-pack.ts src/scripts/cbam-algos/UPSTREAM.json \
        src/scripts/cbam-lines.ts
git commit -m "feat(cbam): the audit stamp covers the corpus it claims to identify"
```
Body: the Step 6 before/after, and the Steps 2–4 preservation proofs with their figures.

---

## Task 5: Website — merge `cbam-app.ts` and the page, preserving all four UI fixes

**Files:**
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (the sole hand-editable file under `cbam-algos/`), `src/pages/cbam/cbam-calculator.astro`

This is the highest-risk task: `main` changed this file heavily this week and Codex changed 334 lines of it.

- [ ] **Step 1: Record what must survive, before editing**

```bash
cd /private/tmp/cbam-port
grep -c "|| !date!.value"        src/scripts/cbam-algos/cbam-app.ts   # expect 2
grep -c "sectorList(\[t.sector\])" src/scripts/cbam-algos/cbam-app.ts # expect 2
grep -c "lastRoutePick"          src/scripts/cbam-algos/cbam-app.ts   # expect 4
grep -c "typeof priced !== 'boolean'" src/scripts/cbam-algos/cbam-app.ts # expect 1
grep -c "mass and import date"   src/pages/cbam/cbam-calculator.astro # expect 1
```
Write these five numbers down. They are the acceptance criteria for Step 4.

- [ ] **Step 2: Review Codex's changes before applying any**

```bash
git diff origin/main b83da16 -- src/scripts/cbam-algos/cbam-app.ts | head -200
```
Codex's substantive additions here are the pack-v2 load path, the refusal-reason accuracy work, and print/threshold changes. Its version of every gate is **pre-fix** — it has `!pack || !cn!.value || !country!.value || !route!.value || !mass!.value` with no date term. **Apply its additions by hand; never overwrite the file.**

- [ ] **Step 3: Apply Codex's additions to `main`'s file**

Take, from `b83da16`: the `load-pack` integration, the corrected refusal reasons, and the all-refused print fix (`buildPrintDocument` must consult `pricedLines` before printing `Total: 0 certificates` — on `main` it does not, which Codex's audit correctly flagged).

Leave alone: both completeness gates, `sectorList`, `lastRoutePick`, `renderAttestation`, and the idle-copy string.

- [ ] **Step 4: Re-run the five counts from Step 1**

```bash
grep -c "|| !date!.value"        src/scripts/cbam-algos/cbam-app.ts
grep -c "sectorList(\[t.sector\])" src/scripts/cbam-algos/cbam-app.ts
grep -c "lastRoutePick"          src/scripts/cbam-algos/cbam-app.ts
grep -c "typeof priced !== 'boolean'" src/scripts/cbam-algos/cbam-app.ts
grep -c "mass and import date"   src/pages/cbam/cbam-calculator.astro
```
**Every number must equal Step 1's. A drop is a lost fix — restore it before continuing.**

- [ ] **Step 5: Fix the all-refused print zero**

Codex's audit is right and `main` still has this. `buildPrintDocument` prints `Total: 0 certificates · no € total (a certificate price is unpublished)` when *every* line refused — a manufactured zero, attributed to a false cause. Guard it the way the screen renderer already does:

```ts
    <h2>2 · What we computed</h2>
    ${totals.pricedLines === 0
      ? `<p>No line could be priced, so there is no total. ${totals.refusedLines} line(s) refused —
         see §3 for the reason each was refused. This is not a total of zero.</p>`
      : `<p>Total: <b>${num(totals.certificates)} certificates</b>${
          totals.costEur ? ` · <b>${eur(totals.costEur)}</b>` : ' · no € total (a certificate price is unpublished)'}${
          totals.anyPending ? ' — a <b>what-if</b>, because the CSCF is unpublished (see §4)' : ''}. ${
          totals.refusedLines ? `${totals.refusedLines} line(s) refused and excluded.` : ''}</p>`}
```

- [ ] **Step 6: Pin the all-refused print behaviour**

Add to `tests/unit/cbam-render.test.mjs`:

```js
test('an all-refused print document states no total rather than a total of zero', () => {
  // The SCREEN renderer already distinguishes these (renderTotals branches on pricedLines === 0);
  // buildPrintDocument did not, and printed "Total: 0 certificates · no € total (a certificate
  // price is unpublished)". Both halves are false: nothing was priced, so there is no total, and
  // the price is not why. Asserted on the rendered document, not the source.
  const doc = buildPrintDocument({
    pack: PACK, generatedOn: '2026-03-15',
    lines: [REFUSED_LINE], results: [REFUSED_ESTIMATE],
    totals: { certificates: '0', costEur: null, pricedLines: 0, refusedLines: 1, anyPending: false },
    yearCards: [],
  });
  assert.doesNotMatch(doc, /Total: 0 certificates/,
    'a document where nothing priced must not print a total of zero');
  assert.match(doc, /no line could be priced/i,
    'it must say why there is no total');
  assert.doesNotMatch(doc, /certificate price is unpublished/,
    'and must not blame the price for a refusal that had another cause');
});
```

- [ ] **Step 7: Mutation-verify the new pin**

Revert the Step 5 guard, re-run, confirm **that named test alone** goes red. Restore, and confirm `git diff` shows only the intended change.

```bash
npx vitest --version >/dev/null 2>&1; npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖ "
```

**Before trusting the run, confirm the mutation actually landed in the file** — a `perl` substitution silently failed to match in this project once and produced a fully green suite that looked like a passing mutation.

- [ ] **Step 8: Commit**

```bash
git add src/scripts/cbam-algos/cbam-app.ts src/pages/cbam/cbam-calculator.astro tests/unit/cbam-render.test.mjs
git commit -m "fix(cbam): an all-refused print document stops manufacturing a zero"
```
Body: the five preservation counts from Steps 1 and 4, side by side.

---

## Task 6: Website — tests, docs and CI config

**Files:** `tests/unit/cbam-lines.test.mjs`, `tests/unit/cbam-render.test.mjs`, `tests/unit/cbam-pack.test.mjs` (new), `tests/e2e/cbam-lines.spec.ts`, `docs/cbam-engine-reference.md`, `.github/workflows/verify.yml`

- [ ] **Step 1: Add Codex's new pack test**

```bash
git show b83da16:tests/unit/cbam-pack.test.mjs > tests/unit/cbam-pack.test.mjs
```

- [ ] **Step 2: Merge the three shared test files by hand**

`main`'s tests pin this week's fixes; Codex's pin pack v2 and the sealed digest. **Union, not replacement.** After merging, confirm the tests that pin this week's work are still present by name:

```bash
grep -c "cleared import date\|survives a trip through an uncovered year\|idle prompt identically" tests/unit/*.mjs tests/e2e/*.ts | grep -v ':0'
```
Expected: non-zero for the files that carry them. **A zero anywhere means a pin was dropped in the merge.**

- [ ] **Step 3: Take Codex's browser matrix**

Its `playwright.config.ts` (already ported in Task 3) adds Firefox and WebKit; `main` was Chromium-only. Install them:

```bash
npx playwright install chromium firefox webkit
```

- [ ] **Step 4: Merge the CI workflow**

Codex changed `.github/workflows/verify.yml`; `main` changed it too. Keep `main`'s Python/mypy and chromium-install steps, take Codex's added browser installs and the sync-check invocation. Confirm the file still runs `npm run verify`.

- [ ] **Step 5: Take Codex's engine reference doc**

```bash
git show b83da16:docs/cbam-engine-reference.md > docs/cbam-engine-reference.md
```
Then **correct it for reality**: it was written against Codex's tree. Any statement that the CSCF is published, or that differential-test coverage is broader than it is, must be edited out — Codex's own second report flagged both as documentation defects it did not get to fix. Grep before committing:

```bash
grep -n "1862\|published CSCF\|CSCF is published" docs/cbam-engine-reference.md
```
Expected: no hits.

- [ ] **Step 6: Full gates**

```bash
npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)|vendored engine"
npm run build 2>&1 | tail -2
npm run test:e2e 2>&1 | tail -4
npx astro check 2>&1 | tail -3
```
Expected: unit **≥ 425** (report the exact number), vendored engine intact, build clean, e2e green across all three browsers, `astro check` at its known 2 pre-existing `mapillary-js` errors.

- [ ] **Step 7: Commit**

```bash
git add tests/ docs/cbam-engine-reference.md .github/workflows/verify.yml
git commit -m "test(cbam): pack-v2 coverage, three browsers, corrected engine reference"
```

---

## Task 7: Measure the whole port as one hop

**Files:** none. Change no source file; commit nothing.

- [ ] **Step 1: Prove the harness sees a change, before trusting any null**

Build `origin/main`'s tree with `git archive origin/main | tar -x -C <scratch>`, then perturb a value in that scratch copy and confirm your differ reports it, with counts and field names. **Report this proof.** A "0 differing" result from a broken differ is byte-identical to a genuine null, and that has already happened once in this project — a stale `.mts` in a shared scratchpad was executed instead of the intended harness, and the sweep returned instantly with an empty result.

- [ ] **Step 2: Sweep `origin/main` → HEAD**

All three tiers, both scopes, priced and refused, residual and non-residual origins, several quarters. Diff **whole serialised result objects** — every key at every depth, plus array lengths and key-set strings so an appearing or vanishing key is caught. **Not a status summary**: a status-only diff once missed 10,300 user-visible `selector` changes here.

**Expected: figures unchanged.** The pack is the same corpus; this port changes plumbing, not values. Fields that legitimately move: `stamp.snapshotHash` (now covers the corpus), and refusal `reason` strings where Codex corrected them. **Any movement in `certificates`, `costEur`, `emissionsTco2e`, `faaTco2e` or `netTco2e` is the headline — stop and report it.**

- [ ] **Step 3: State the corpus**

A count is a property of your corpus, not of the change. Say exactly what you swept — how many selectors, which years, which tiers — and separate the **structural claim** ("no figure moved") from any corpus-dependent count.

- [ ] **Step 4: Re-verify all five preserved fixes end to end**

Re-run Task 4 Steps 2–4 and Task 5 Steps 1/4 against the final tree, and report the figures. This is the last chance to catch a fix lost in a later merge.

- [ ] **Step 5: Clean up** — remove scratch dirs; confirm both repos clean and on the right branches at the right SHAs.

---

## Task 8: Land it

- [ ] **Step 1: Website PR**

```bash
cd /private/tmp/cbam-port
git push -u origin feat/cbam-foundation-port
gh pr create --base main --head feat/cbam-foundation-port \
  --title "feat(cbam): the corrected foundation — pack v2, input validation, a sealed corpus digest" \
  --body "Ported from b83da16, rebuilt on main rather than merged: that branch was 221 commits behind and lacked the date gate, the sector caption, the route-pick memory and the renderAttestation guard. All five preservation proofs are in the commit bodies. CSCF left pending — Decision (EU) 2026/1862 unverified."
```

- [ ] **Step 2: Watch CI, then merge**

```bash
gh pr checks --watch
```

- [ ] **Step 3: Verify the deploy**

Poll `https://deltaclimate.earth/cbam/cbam-calculator` with `Cache-Control: no-cache` **and a delay between attempts** — a tight loop re-reads one cached build. Confirm HTTP 200, a bundle hash different from the current one, and grep the bundle for `mass and import date` (the date gate) and the corrected refusal wording. Grep for **strings, not identifiers** — the minifier renames names.

- [ ] **Step 4: Clean up**

```bash
rm -f /private/tmp/cbam-port/node_modules   # the SYMLINK only, if it is one
cd /Volumes/VSTSAMPLES/Projects/Angad
git worktree remove /private/tmp/cbam-port
git worktree prune
```
Leave both Codex branches in place until the ports are merged and verified; they are the only copy of that work.

---

## Self-review

**Coverage.** Codex's four CBM commits → Task 1. Its 4 clean adds and 3 clean ports → Task 3. The four vendored engine merges and `cbam-lines.ts` → Task 4. `cbam-app.ts` and the page → Task 5. Tests, docs, CI → Task 6. Its two accepted P1s — the sealed pack digest and the all-refused print zero — are Task 3 Step 5 and Task 5 Step 5 respectively, each with a proof step.

**Deliberately excluded:** the CSCF change (unverified citation, see above) · every heat-map, climate-engine, calibration and research file in Codex's 110 commits · CBM's two open PRs (#47, `fix/suppliers-adverse-opinion`) · the Go port.

**Consistency.** `feat/cbam-foundation-port` is the branch name in both repos. The five preserved fixes are named identically in Tasks 1, 4, 5 and 7. `packSha256`, `packManifestSha256` and `upstreamCommit` are used as Codex's schemaVersion-2 `UPSTREAM.json` defines them.

**Known gaps, stated rather than hidden.** CBM's integration suite cannot run locally — Task 2 is CI-only and must be reported as such. The CSCF question is unresolved and deliberately untouched. Codex's three documentation defects (overstated differential coverage, the orphaned "Assurance" heading, the stale footer date) are in the PDF pipeline, which this plan does not rebuild; Task 6 Step 5 handles only the markdown reference.
