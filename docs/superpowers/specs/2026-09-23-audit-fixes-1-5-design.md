# Audit fixes 1–5: panel scroll, Compare pairs, ignore rules, forcing date, CI-safe history checks

**Status:** approved 2026-09-23; amended the same day while writing the plan, each amendment from a fact
measured in the code (§8 lists them).
**Origin:** the 2026-09-23 codebase audit of `feat/urs-v3-engine` (items 1–5 of its "fix first" list).
Every fact below was verified against the code or the live site during that audit; §7 lists the evidence.

---

## 0. Delivery shape

Three tracks, in this order. Each ships only after its own gates pass **and** the post-implementation
audit in §5 comes back clean.

| Track | Branch | Items | Reaches the live site |
|---|---|---|---|
| **PR 1** | `fix/obos-scroll-compare-ignores`, off `origin/main` | 1, 2, 5 | on merge |
| **PR 2** | `fix/power-forcing-local-date`, off `origin/main` | 3 (+ the night-bias tooltip it rewrites) | on merge |
| **Track B** | `feat/urs-v3-engine`, after PR 1 and PR 2 merge | 4 + regenerate the two validation packages | no — the push waits on the NOAA licence decision (§3.6) |

**Why off `origin/main`:** items 1–3 are live defects on `main`. Branching from `origin/main` keeps the 44
unpushed URS v3 commits out of both PRs, so neither can carry unfinished work to production.

**Standing rules that apply throughout:** pushes and merges only on the owner's word; Python stays strict-mypy
clean; commit messages via heredoc with the session's attribution trailer; on the exFAT volume, never
`reset --hard`.

**Where the work happens.** The main checkout can hold another session's uncommitted work — on
2026-09-23 a concurrent session was rewriting the station pipeline there — so **its branch is never
switched** by this work. PR 1 and PR 2 are built in one dedicated worktree on the internal APFS disk
(e.g. under `~/`), where `node_modules` costs ~0.5 GB instead of the ~6.7 GB it costs on the exFAT
volume's 256 KB blocks, and which survives a session restart (the scratchpad does not). Track B runs in
the main checkout only once that concurrent work is committed.

---

## 1. PR 1 — the live quick fixes (items 1, 2, 5)

### 1.1 Item 1 — mouse-wheel scrolling in OBOS panels

**Defect.** `src/pages/heat-map/[country]/[city]/[area].astro:67` renders `<Base>` without `nativeScroll`,
so Lenis starts on the ward page and cancels wheel events inside every scrollable panel. The page itself
never scrolls (`HeatMapStage.astro:865`, `body{overflow:hidden}`), so Lenis has no job there. `Base.astro:13`
already states the rule — *"Interactive tools manage their own native scrolling and must not start Lenis"* —
and `compare.astro` and `brief.astro` follow it.

**Fix.** Pass `nativeScroll` on the ward route. Nothing else changes.

**Rejected:** `data-lenis-prevent` on each scroll container (the next new panel forgets it); Lenis
`allowNestedScroll` globally (a DOM walk on every wheel event, on every page, to rescue a page that should
not run Lenis at all).

**Guards.**
- Unit: enumerate every page under `src/pages/heat-map/` that renders `HeatMapStage` and fail if any does
  not pass `nativeScroll`.
- E2E, in a new small spec (not the CPU-marginal solar spec): open a ward page with default motion
  settings at 1280×480, open the **Layers** pane (its `.tree` is an `overflow-y: auto` container that
  overflows there, 411 px of content in 257 px on the preview build, and needs no solar computation),
  move the mouse over it, send real `page.mouse.wheel` events, and assert `scrollTop` increased. The
  test first asserts the tree overflows, so it cannot pass vacuously. No existing spec sent a wheel event
  over a panel (the only other `page.mouse.wheel` in the suite, in the solar spec, zooms the map), which
  is why this was never caught. *Corrected 2026-09-24: an earlier version said the solar spec sets
  `scrollTop` directly; code review found it never did.*

### 1.2 Item 2 — Compare opened from a Bengaluru ward

**Defect.** The ward page's Compare link carries only `a` (`heat-map-app.ts:3410`). `parsePairedScenario`
fills a missing `b` with `DEFAULT_PAIRED_SCENARIO.b`, a Kolkata ward (`scenario-url.ts:32`), and its
same-city fallback fires only when `b === a` (`:38`). Every Bengaluru ward therefore opens a cross-city pair,
which fails the grid check and shows "Comparison unavailable". Reproduced on production: Whitefield opens as
Whitefield vs Baruipur.

**Fix, in the parser only** (the single source of truth — fixing only the writer would leave hand-shared
URLs broken):
1. `a` = the parsed `a` if it is a **drawable** area; otherwise `DEFAULT_PAIRED_SCENARIO.a`.
2. A candidate `b` is valid when it is drawable, **in `a`'s city**, and `≠ a`.
3. `b` = the parsed `b` if valid; otherwise, if the parsed `b` repeats `a`, the first other drawable
   area in `a`'s city (`nextDistinctKey` over its drawable areas), as the old parser did; otherwise
   `DEFAULT_PAIRED_SCENARIO.b` if *that* is valid for this `a`; otherwise that same first other area,
   else `a`. (A city with one drawable area still yields `a === b`, which `runPairedScenarioCore`
   refuses by name, as today.)

Together these preserve every existing Kolkata link byte-for-byte. A review sweep of 2,898 links found
every Kolkata link identical, and every difference a pair that could never settle (cross-city or
undrawable) turned into one that does. *Corrected 2026-09-24: the first version of rule 3 sent a
repeated `b` to DEFAULT.b, which changed `?a=barrackpore&b=barrackpore`; spec review caught it.*

**Guards** (in `tests/unit/heat-map-compare.test.mjs`, alongside the existing parser tests):
- each Bengaluru ward with no `b` → a pair of two Bengaluru wards;
- a Bengaluru `a` with an explicit Kolkata `b` → `b` repaired to a Bengaluru ward;
- a non-drawable `a` (Dubai) → the default pair;
- a Kolkata `a` with no `b` → exactly today's result;
- every existing test passes unchanged.

Plus one e2e: the Compare link written by the Whitefield page opens Whitefield vs Indiranagar and reaches
"Comparison settled". On the unfixed build the same journey showed "Comparison unavailable: The requested
comparison is invalid."

### 1.3 Item 5 — confidential files in a public repo

**Defect.** 118 untracked files — client proposals, internal planning documents, draft analyses, screen
recordings, `.env.production` — are not ignored, so one `git add -A` publishes them. It has happened before
(`4ce2585`). The owner's decision: keep the files where they are and ignore them.

**Fix, in two layers.**
- **Local exclude, done first and never published** (`.git/info/exclude` lives in the common git dir, so it
  covers all six worktrees at once, before any PR merges). It must hold **everything** needed for immediate
  protection, because `.gitignore` only reaches a branch once PR 1 is merged into it, and the main checkout
  sits on `feat/urs-v3-engine` until Track B. So it carries the generic patterns below **plus** six
  file- and folder-name patterns that would reveal client names or internal plans. Those six are
  deliberately written in **no committed file**, this spec and its plan included (both will be public);
  they are supplied at execution time and live only in the local exclude.
- **`.gitignore`, in PR 1**, generic patterns only (duplicated in the local exclude), so future clones and
  other machines are protected too:
  ```
  .env.*
  !.env.example
  *.docx
  docs/research/*.pdf
  docs/Ideas_and_Prototypes/
  docs/**/*.mov
  docs/**/*.mp4
  tmp/
  preview-obos/
  attic/heat-fx/
  docs/audits/
  ```
  Only `attic/heat-fx/`, not `attic/`: `main` tracks shelved code in `attic/hero-v1/` and
  `attic/color-schemes/` on purpose, and a blanket rule would silently ignore anything shelved there later.
  `docs/audits/` holds earlier audit evidence, and one of its READMEs links a confidential planning
  document by file name, so publishing it would publish one of the six names.
- **Delete** (approved) the three root scratch files nothing references: `reg.json` (another repo's GitHub
  tree dump), `psi-mobile.json` (a rate-limit error body), `bk3d.json` (an Overpass dump).

Ignore rules never affect tracked files, so the 18 tracked PDFs stay tracked.

**Verification.** In every worktree, `git status --porcelain` lists none of the confidential paths, and
`git check-ignore -v` names the rule covering each one; `git ls-files '*.pdf' | wc -l` is still 18.

---

## 2. PR 2 — the forcing correction (item 3)

### 2.1 Defect

`scripts/fetch-met.py:250-254` builds each NASA POWER lookup key from the pass's **UTC date** plus its
**local solar hour**. POWER is stamped in local solar time, so a night pass after local midnight but before
UTC midnight takes air temperature, humidity, wind and cloud from **24 hours earlier**. Example: the
ECOSTRESS pass `…20260412T232834…` is 23:28 UTC on 12 April = 05:21 local on **13 April**; it used
22.09 °C (stamp `2026041205`) instead of 24.68 °C (`2026041305`). These rows feed the night accuracy band the
site labels "quantitative". The newer pipeline already has the correct rule: `power_key()` in
`fetch-ecostress-history.py`, whose docstring names this bug.

### 2.2 Fix

- Add `power_stamp(iso_utc: str, lon: float) -> str` in a new pure module, `scripts/_power.py`: local
  solar time at the given longitude, rounded to the nearest hour, formatted `YYYYMMDDHH` — the date and
  the hour from one calculation. The module also becomes the one home of the POWER point (`POWER_LAT`,
  `POWER_LON`). Not `_suhii.py`: that module imports numpy and the ECOSTRESS network helpers, whereas
  `fetch-met.py` imports only `_types`, and Track B needs the function from an importable module
  (`fetch-met` is not an importable name).
- `fetch-met.py` keys every POWER reading with `power_stamp(row["utc"], POWER_LON)`, where
  `POWER_LON = 88.37` is the point it queries POWER at (which defines POWER's clock). `ecostress-suhii.csv` already carries each pass's
  `utc`. Landsat day passes use their own UTC time the same way (their dates do not change).
- `met-forcing.csv` gains two columns, `utc` (the pass's UTC time) and `power_stamp` (the exact reading the
  row used), so the join is auditable from this one file without joining back to the scene list.
  `_types.MetRow` gains both fields (the CSV's columns derive from it).

### 2.3 Rebuild — from the local cache, no network

1. `fetch-met.py` → `data/calibration/met-forcing.csv`
2. `build-ward-observations.py` → `data/calibration/ward-observations.json`
3. `measure-accuracy.py` → `data/calibration/model-accuracy.json`. It re-scores **the constants that ship**
   (it selects the candidate that matches them) and computes its own ceiling.
4. `src/scripts/climate-engine/accuracy.ts`: every `ACCURACY.night` field from the new
   `model-accuracy.json` `ward_scale.strata.night` — `n` ← `n_scenes`, `ceilingRmseK` ← `ceiling_rmse_K`,
   `modelRmseK` ← `rmse_K`, `looOverpassRmseK` ← `loo_overpass_rmse_K`, `bandK` = the smallest multiple of
   0.5 K that is ≥ both `modelRmseK` and `looOverpassRmseK` (the band must cover the out-of-sample error and
   remain the model error rounded up). The note and the file's header comment are rewritten from these numbers,
   which also corrects the bias sign (the note says +0.18 K; the artefact says −0.182 K). `ACCURACY.peak` is
   untouched (it is deliberately pending recalibration).

**The other readers of `met-forcing.csv` were checked.** `build-dcurs-inputs.py` reads only surface
columns, so its output does not move. `measure-canopy-blend-residual.py` uses night wind, but it refuses
to re-run by design (the shipped blend strength is 0, so a re-run would overwrite a real strength-0.5
measurement with zeros). Its committed record is therefore annotated, not rebuilt: its night coefficients
were measured on the pre-correction forcing, and its day figures, the ones behind the strength decision,
are unaffected.

**`fit-ward-scale.py` is not run.** The shipped model has two free parameters fitted on this forcing
(`q_day` 0.5175, `release_base` 0.1043); re-fitting them would change every night temperature on the live
map. That is a separate, later PR with its own pre-registration. `ward-scale-fit.json` therefore keeps
describing the old forcing until then, and a note in the file says so.

### 2.4 Pre-registered expectations — recorded here, before any run

Measured on 2026-09-23 from the local POWER cache, before any code change:
- **21 of the 97 rows in `met-forcing.csv` change stamp, all of them night passes.** (A simple
  "hour < 5.89" threshold would catch only 20; the UTC-time rule is exact.) No row changes hour, only date.
- Corrected air is **warmer in 13 rows and colder in 7**, mean **+0.34 K**, range −1.36 to +2.59 K.

Predictions:
- **P1.** Exactly those 21 rows change in the twelve columns `met-forcing.csv` had before this PR, and
  only in the forcing columns; every other row is identical in those twelve. (The two new columns change
  every row's bytes, so byte-identity is judged on the original columns.)
- **P2.** In `ward-observations.json`, only the matching night rows change, and within them only the forcing
  fields (`tAir`, `rh`, `wind`, `cloud`) and anything the build derives from them; every surface-temperature
  field in every row is unchanged.
- **P3.** In `model-accuracy.json`, only strata containing night rows change; peak, morning and Landsat
  strata are byte-identical.
- **P4.** The night bias (−0.182 K, model too cold) moves up, towards zero or positive.
- **P5.** Night RMSE and leave-one-overpass-out RMSE stay flat or improve.

**Decision rule.** Any violation of P1–P3 means the fix touched something it should not — stop and find out
why. If P4 or P5 fails, first confirm the fix is right; if it is, the honest number ships anyway, and the
band follows the leave-one-overpass-out error (±3.5 °C can become ±3.0 or ±4.0). A diff report comparing
old and new artefacts against P1–P5 goes in the PR description.

### 2.5 Guards

- `power_stamp` self-test cases: 23:28 UTC 12 Apr → `2026041305`; a day pass (same date); a pass whose local
  time rounds up across midnight to hour 24 → next day `00`; a pass just before the rollover. Wired into
  `npm run test:py` (`python3 scripts/_power.py`), so CI runs them.
- A check, also run by CI, that every `met-forcing.csv` row's `power_stamp` equals
  `power_stamp(utc, LON)` for that row's own `utc`.
- `tests/unit/accuracy-vs-artefact.test.mjs`, extended from the leave-one-out figure alone to night `n`,
  ceiling and RMSE. Today the ceiling (2.233 vs 2.336) and RMSE (2.93 vs 2.943) have drifted from the
  artefact unnoticed; after this, every night number comes from one run.
- A test that the numbers quoted in `ACCURACY.night.note` (RMSE, ceiling, bias, leave-one-out) match the
  fields and the artefact, so the note's sign cannot drift again.

### 2.6 What the live site shows after merge

Map temperatures do **not** change. The night band, its tooltip and the `/uncertainty` figures update.
Hard-coded copies of the old night figures in user-facing pages, components and `docs/evidence/` are
updated too; dated historical documents (research notes, old specs) stay as records.

---

## 3. Track B — on `feat/urs-v3-engine` (item 4)

Starts only after PR 1 and PR 2 have merged to `main`, **and** after the concurrent session's work in the
main checkout is committed. When the plan was written, that session had just committed three data commits
on this branch and had `scripts/build-ward-heat-history.py` itself modified, uncommitted, so Track B's
line numbers will have moved and its edits must be re-located by function name.

### 3.1 Bring `main` in

`git merge origin/main` — a merge, not a rebase: it keeps commit ids intact and avoids the exFAT rebase trap.
Expected conflicts are small (`accuracy.ts`, `.gitignore`).

### 3.2 Item 4 — `build-ward-heat-history.py --check` fails in CI

**Defect.** `committed_state()` (`:232`) asks `git log -1 -- <path>` for the commit that last changed each
input, and `check_committed()` (`:247-251`) requires it to equal the pinned `INPUT_COMMITS`. CI's
`actions/checkout@v4` (`verify.yml:24`) makes a one-commit clone, where every file's "last commit" is the
tip, so the check fails — reproduced locally in a depth-1 clone. It would also break after any rebase or
squash-merge. `methods_inputs()` (`:3919`) prints the same live value into METHODS.md, so the byte
comparison would fail too.

**Fix.**
- `--check` never asks git for history. It still requires every input to be committed at HEAD and
  unmodified (`ls-tree HEAD` and `diff --quiet HEAD` both work in a one-commit clone). Content drift stays
  caught exactly as today, by the SHA-256 column METHODS.md already publishes and the byte comparison.
- METHODS.md's "commit that last changed it" column comes from the recorded `INPUT_COMMITS` constant, not
  live `git log`, so the document regenerates byte-identically anywhere. Rows `INPUT_COMMITS` does not cover
  (the imported modules, and the generator, which cannot name the commit that contains it) show a dash;
  their SHA-256 already pins them.
- A new local-only `--verify-provenance` mode compares `INPUT_COMMITS` with full git history and reports
  any mismatch, so the recorded ids stay true when inputs genuinely change. It refuses to run in a one-commit
  clone rather than report nonsense. The constant itself is edited by hand, never rewritten by the script.
- METHODS.md's `inputs-committed` rule currently states that the build refuses unless "each archive was
  last changed by the commit that built it". That stops being true of the build, so the sentence is
  rewritten to say the recorded commits are checked by `--verify-provenance`.

`build-validation-package.py` needs no change for item 4: its dates are recorded constants and its `--check`
already passes without history.

### 3.3 Make the 2026-09-22 package's join check real

`build-validation-package.py:2610-2615` checks that each forcing row's hour lies within its ward rows' hour
range — it compares the scene's hour with itself and never tests the date, so it could not catch item 3. It
will instead check each `met-forcing.csv` row's `power_stamp` against `power_stamp(utc, LON)` recomputed
from the same row's `utc` column (both added in PR 2), so no new input is needed.

Three consequences, found while planning:
- The package measures its imported project modules off `sys.modules` and refuses any that is not
  fingerprinted, so `_power.py` joins its `IMPORTED_MODULES`.
- Its README item 13 and the `SolarTimeBase` docstring say the met join "reads" the `hour_lst` column.
  After PR 2 the join converts each pass's UTC instant by the same UTC-plus-longitude-over-fifteen rule,
  so both are reworded.
- The package guards eleven comparative absolutes ("every", "all", "only", …) in its README. New sentences,
  and the rewritten `TIME BASE.` paragraph of `fetch-met.py` that the README quotes, avoid them.

### 3.4 Regenerate both packages

PR 2 changes files both packages pin (`fetch-met.py`, `_types.py`, `met-forcing.csv`,
`ward-observations.json`, `model-accuracy.json`, `accuracy.ts`), so both drift after the merge regardless.
Regenerate each, review the diff (their forcing and night-accuracy statements change), and add a dated line
to each README recording the rebuild and what moved. `fetch-ecostress-history.py`'s `power_key()` is already
correct, but its docstring states that `fetch-met.py` is 24 h early, which PR 2 makes untrue; that sentence
is corrected.

### 3.5 Verify

The full `npm run verify` locally, then both packages' `--check` in a **local depth-1 clone** of the branch —
the CI condition, and how the defect was proved.

### 3.6 The push waits on the owner

The 2026-09-23 package's `--check` requires the NOAA station files to be committed at HEAD, so pushing this
branch publishes them. The package itself says they need NOAA's written confirmation, or a founder
decision, before leaving the company. That licensing decision gates the **push**, not the fix; Track B ends
with verified local commits.

---

## 4. Out of scope

- Re-fitting the night model (`q_day`, `release_base`) — its own PR, with its own pre-registration.
- The licensing decisions (NOAA station rows, the IMD daily series, the Noplato demo font, Moonscape Serif).
- Audit items 6–11 and the repo-hygiene list. Item 6 (the "perfect retrofit" in `dc-urs.ts`) is cheapest
  during Track B, since `dc-urs.ts` is pinned by the 2026-09-22 package, but only if the owner opts in.
- `fetch-met.py`'s missing `curl` timeout and non-atomic write (the rebuild runs from cache).
- Unifying `fetch-ecostress-history.power_key()` with the new `_power.power_stamp()`.

---

## 5. Post-implementation audit — the acceptance gate for every track

Required by the owner: once a track's code is complete and its own gates pass, and **before** any push or
merge, the work is audited so the result is double-checked.

1. **Independent review.** Fresh read-only reviewers, separate from whoever implemented the track, audit the
   diff against this spec: correctness, regressions, scope creep, and whether each test would actually fail
   without its fix.
2. **Every finding verified in the code** before anyone acts on it. A reviewer's report is not evidence;
   an earlier agent in this project fabricated results that were relayed to the owner.
3. **Revert tests.** In a throwaway copy, undo each fix and confirm its new test fails: the Lenis prop, the
   parser rule, the `power_stamp` key, the history check, and one ignore rule.
4. **Re-run the reproductions:**
   - item 1's wheel test and item 2's Whitefield → Compare path on a local preview build, then on
     production after deploy;
   - item 3's P1–P5 diff report;
   - item 4's depth-1 clone check;
   - item 5's `check-ignore` sweep across all six worktrees.
5. **Report.** Findings are fixed and re-verified, then a short report goes to the owner with what was
   checked, what was found and what changed.

---

## 6. Test plan summary

| Item | Unit / script | E2E / reproduction | Revert test |
|---|---|---|---|
| 1 | every heat-map route passes `nativeScroll` | real wheel over an overflowing pane scrolls it | drop the prop → e2e fails |
| 2 | Bengaluru, cross-city, Dubai and Kolkata cases + all existing | Whitefield → Compare shows two Bengaluru wards | restore old fallback → unit fails |
| 3 | `power_stamp` cases; every row's stamp matches its UTC; artefact + note guards | P1–P5 diff report | revert the key → stamp check fails |
| 4 | CI's own shallow checkout runs `--check` on every push; `--verify-provenance` refuses a shallow clone | both `--check`s pass in a local depth-1 clone | restore live `git log` → depth-1 check fails |
| 5 | — | `check-ignore` sweep, all worktrees | remove one rule → sweep fails |

---

## 7. Evidence (from the 2026-09-23 audit)

- **Item 1:**
  - reproduced on production at 1440×900. With default motion, the Solar pane `.pane-body` (1,247 px of
    content in 677 px) did not scroll. With reduced motion, where Lenis is off, it scrolled 570 px.
  - `lenis.mjs:598` calls `preventDefault()` on every vertical wheel event.
- **Item 2:** reproduced on production: the Whitefield page writes
  `/heat-map/compare/?a=in%2Fbengaluru%2Fwhitefield&trees=0&roof=0&facades=0&phase=peak`, and the page
  shows "COMPARISON UNAVAILABLE", with Whitefield and Baruipur selected.
- **Item 3:**
  - the granule `ECOv002_L2T_LSTE_44049_006_45QWE_20260412T232834_0713_01` is the 12 April night pass;
  - `met-forcing.csv` and `ward-observations.json` both carry `tAir` 22.09;
  - the cache holds `T2M[2026041205]` = 22.09 and `T2M[2026041305]` = 24.68;
  - `fetch-met.py:230` requires the cache's `time_standard` to be `LST`;
  - `measure-accuracy.py:211` defines the error as predicted − observed.
- **Item 4:**
  - a depth-1 clone gives every pinned input the tip commit `2aee9b3`, and `--check` exits 1;
  - with full history the same check passes.
- **Item 5:**
  - `git check-ignore` reports "NOT IGNORED" for every listed path, including `.env.production`;
  - `git status` shows 118 stageable files.

---

## 8. Amendments made while writing the plan (2026-09-23)

Each comes from a fact measured in the code, not a change of intent.

| § | Amendment | Why |
|---|---|---|
| 1.1 | The e2e uses the Layers pane at 1280×480 | its `.tree` is an `overflow-y: auto` container that overflows there, with no solar computation |
| 1.3 | `attic/heat-fx/`, not `attic/` | `main` tracks shelved code under `attic/` on purpose |
| 1.3 | `docs/audits/` added | a README there links a confidential document by one of the six names |
| 2.2 | `power_stamp` lives in a new `scripts/_power.py`, with the POWER point | `_suhii.py` pulls numpy and network helpers into `fetch-met.py`; Track B needs an importable module |
| 2.3 | The other `met-forcing.csv` readers are accounted for | the canopy-blend record refuses re-runs by design, so it is annotated, not rebuilt |
| 2.4 | P1 is judged on the original twelve columns | the two new columns change every row's bytes |
| 3 | Track B also waits for the concurrent session's edit to `build-ward-heat-history.py` | that file was modified, uncommitted, when the plan was written |
| 3.2 | The `inputs-committed` rule text is rewritten | it claims a check the build no longer makes |
| 3.3 | `_power.py` is fingerprinted, item 13 is reworded, new README prose avoids the guarded words | the package enforces all three |
