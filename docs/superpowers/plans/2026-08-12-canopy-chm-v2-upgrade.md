# Canopy CHM v2 Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the canopy source from Meta/WRI CHM v1 to v2, re-pin `DENSITY_REF_H` from 22 m to 30 m, regenerate all three wards, and update the receipts — with accuracy proven unregressed.

**Architecture:** One Python file changes (`scripts/fetch-canopy.py`) plus the provenance generator. The TS renderer consumes `trees.json`, whose schema is unchanged, so no TS edits. Placement algorithm is untouched — only the canopy raster and one constant move.

**Tech Stack:** Python 3 + numpy + rasterio (already in pipeline), strict mypy. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-12-canopy-chm-v2-upgrade-design.md`

**Branch:** create `feat/chm-v2` from `origin/main` in a worktree. The main checkout is another session's (currently `feat/solar-shadow`, dirty) — **do not switch branches there**.

## Facts the executor must not rediscover

- v2 path: `s3://dataforgood-fb-data/forests/v2/global/dinov3_global_chm_v2_ml3/chm/<z10-quadkey>.tif`, anonymous (`AWS_NO_SIGN_REQUEST=YES`). Verified readable.
- v2 is **EPSG:3857, uint8, 32768², 512² blocks with overviews** — a proper COG. v1 was a non-tiled 65536² monolith.
- Kolkata z10 quadkey for ballygunge is `1231333231` (z9 was `123133323`). `_quadkey()` already takes zoom — only `CHM_ZOOM` changes.
- **Expected tree counts: ballygunge 12,159 / barrackpore 6,811 / baruipur 8,415.** Measured. Anything else is a STOP.
- v2 ward maxima: ballygunge 30.0 m, barrackpore 25.0 m, baruipur 23.0 m.
- Network works; a full three-ward build takes several minutes. `timeout` is unavailable on this machine — use `curl --max-time` for probes and be patient.
- Repo rules: strict mypy on all `.py`; byte-stable artifacts (no `random`, no dates); pure-ASCII in `fetch-canopy.py` (uses `--`, not em-dashes).

## Git hygiene

The working tree carries another session's uncommitted work. **NEVER `git add -A` / `git add .`** — stage only the paths each task names.

---

### Task 1: Point the fetcher at v2 and re-pin the density reference

**Files:** Modify `scripts/fetch-canopy.py`

- [ ] **Step 1: Update the constants**

```python
CHM_PREFIX = "forests/v2/global/dinov3_global_chm_v2_ml3"
CHM_ZOOM = 10                     # v2 tiles are zoom-10 quadkeys (v1 was 9)
```

and change the density reference:

```python
DENSITY_REF_H = 30.0              # metres; FIXED cross-ward density reference
```

Rewrite its comment to carry the new rationale — 30 m is the tallest canopy measured anywhere across the three wards, so the density scale spans exactly the measured range and the `min(DENSITY_MAX, ...)` cap never fires (0 clipped cells in all three wards; at 22 m it clipped 13). Keep the existing note that it must be FIXED, not ward-relative, or density stops being comparable between wards.

- [ ] **Step 2: Update the module docstring**

Three claims in it are now wrong or incomplete:
1. It describes the v1 bucket/prefix and the zoom-9 quadkey — update to v2 and zoom 10.
2. It says the source is "not internally tiled, so a windowed rasterio read is the only affordable access pattern." True of v1; **v2 is a proper COG** with 512² blocks and overviews, so windowed reads get faster. Say so.
3. Add that **v2 is uint8 — heights arrive quantised to whole metres.** v2's own MAE is 3.0 m, so 1 m quantisation sits far inside the error and changes nothing material; state that rather than leaving a reader to spot `uint8` and wonder.

Also record what v2 is: DINOv3 backbone, R² 0.53 → 0.86, MAE 4.3 → 3.0 m, saturation removed (Brandt et al., arXiv:2603.06382), CC BY 4.0 — and that it is a **model** upgrade on the same ~2018–2020 imagery, **not fresher observations**.

- [ ] **Step 3: Update every changed self-test expectation**

**All of these change with `DENSITY_REF_H = 30`. They are computed below — do not re-derive or guess. If any assertion does not hold against the implementation, STOP and report rather than adjusting numbers to fit.**

`count(h) = min(4, int(4*h/30 + 0.5))`:

| cell height | arithmetic | count | was (@22) |
|---|---|---|---|
| `30.0` | `4.0` → `int(4.5)` | **4** (= DENSITY_MAX) | 4 |
| `2.0` | `0.267` → `int(0.767)` | **0** (the honest gap) | 0 |
| `15.0` | `2.0` → `int(2.5)` | **2** | 3 — CHANGED |
| `25.0` | `3.333` → `int(3.833)` | **3** | 4 — CHANGED |
| `1.0` | below MIN_TREE_H | **skipped** | skipped |
| `3.75` | `0.5` → `int(1.0)` | **1**, and `round(0.5) = 0` | — the tie moves back to 3.75 |
| `4.0` | `0.533` → `int(1.033)` | **1** | 1 |

Concretely:
- The `grid[10, 10] = 15.0` assertion becomes **2**; update its message (it currently references the 22 m reference).
- The off-diagonal `grid[3, 40] = 25.0` assertion becomes **3**; update its message.
- **The banker's-rounding tie cell moves from 2.75 back to 3.75.** At the 30 m reference `h = 3.75` gives exactly `v = 0.5`, so `int(v+0.5)` yields 1 while `round(v)` yields 0. Verify by mutation that substituting `round()` still fails.
- **The cap is no longer exercised by any existing cell.** At 30 m nothing in the test grid can exceed `DENSITY_MAX`, so add a cell taller than the reference — **`grid[5, 60] = 40.0` → `4*40/30 = 5.333` → `int(5.833) = 5` → capped to 4** — to keep proving the cap engages. Without it, deleting `min(...)` would pass.
- Re-check the golden-position assertion and the anti-diagonal / distinct-y / distinct-radius / species assertions: positions are independent of count, but per-cell instance counts changed, so anything keyed to a specific `k` needs re-verifying.
- `MIN_TREE_H` remains unobservable (`count > 0` needs `h >= 3.75`, still above 2.0). Keep the existing comment saying so — it is still true, with a different threshold.

- [ ] **Step 4: Gates**

```
python3 scripts/fetch-canopy.py --self-test     # expect OK
python3 -m mypy                                  # expect clean
```

Re-run your mutation probe set and **report the score** — it was 15/15 and must not regress. Confirm M01 (banker's `round()`) is still killed via the new 3.75 tie cell.

`--check` will fail against the committed v1 artifacts until Task 2 regenerates them. **Expected — do not weaken the tripwire and do not regenerate here.**

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-canopy.py
git commit -m "feat(heat-map): canopy from Meta/WRI CHM v2, density reference re-pinned to 30 m"
```

---

### Task 2: Regenerate all three wards, prove byte-stability

**Files:** Regenerate `public/heat-map/data/{ward}-canopy.png` and `{ward}-trees.json`

- [ ] **Step 1: Build, then build again and compare**

```bash
AWS_NO_SIGN_REQUEST=YES python3 scripts/fetch-canopy.py ballygunge barrackpore baruipur
for w in ballygunge barrackpore baruipur; do
  cp public/heat-map/data/$w-trees.json /tmp/$w-1.json
  cp public/heat-map/data/$w-canopy.png /tmp/$w-1.png
done
AWS_NO_SIGN_REQUEST=YES python3 scripts/fetch-canopy.py ballygunge barrackpore baruipur
for w in ballygunge barrackpore baruipur; do
  cmp public/heat-map/data/$w-trees.json /tmp/$w-1.json && echo "$w TREES-STABLE"
  cmp public/heat-map/data/$w-canopy.png /tmp/$w-1.png && echo "$w PNG-STABLE"
done
```

**STOP conditions:** any `cmp` difference (nondeterminism must be root-caused, never worked around); counts other than **12,159 / 6,811 / 8,415**; or a fetch failure that persists past two retries.

- [ ] **Step 2: Artifact + TS gates**

```
python3 scripts/fetch-canopy.py --check     # expect: canopy artefacts OK
npm run test:unit                            # expect 323 pass
npm run build                                # expect green
```

Schema is unchanged, so a TS failure means the schema broke — report it, do not fix the test.

- [ ] **Step 3: Commit**

```bash
git add public/heat-map/data/ballygunge-trees.json public/heat-map/data/ballygunge-canopy.png \
        public/heat-map/data/barrackpore-trees.json public/heat-map/data/barrackpore-canopy.png \
        public/heat-map/data/baruipur-trees.json public/heat-map/data/baruipur-canopy.png
git commit -m "data(heat-map): regenerate all three wards from CHM v2 (12,159 / 6,811 / 8,415)"
```

---

### Task 3: Tell the truth in the receipts

**Files:** Modify `scripts/build-provenance-manifest.py`; regenerate `{ward}-layers.json`

- [ ] **Step 1: Rewrite the canopy layer's source and lineage**

The entry currently names the v1 model and a 22 m reference. It must now say:
- source: **Meta / WRI Global Canopy Height Model v2** (DINOv3), CC BY 4.0;
- that it is a **model upgrade on the same ~2018–2020 imagery — not fresher observations** (this must be explicit; the temptation to imply newer data is exactly what the receipt exists to prevent);
- that tree density is scaled against a **fixed 30 m reference**, which is a **display scaling, not a measurement**;
- keep the existing honest framing that heights are measured while positions/species are modelled.

Update `vintage`/`resolution`/`confidence` fields if they carry v1-specific claims. Match the file's existing multi-line string style.

- [ ] **Step 2: Regenerate and gate**

```
python3 scripts/build-provenance-manifest.py
python3 scripts/build-provenance-manifest.py --check
node scripts/verify-served-data.mjs
python3 -m mypy
```

- [ ] **Step 3: Commit**

```bash
git add scripts/build-provenance-manifest.py public/heat-map/data/ballygunge-layers.json \
        public/heat-map/data/barrackpore-layers.json public/heat-map/data/baruipur-layers.json
git commit -m "docs(heat-map): canopy receipt names CHM v2 and the 30 m density reference"
```

---

### Task 4: Prove the accuracy did not regress

**Files:** none expected — this is a measurement

- [ ] **Step 1: Re-run the accuracy check**

Find the accuracy script (`scripts/measure-accuracy.py`) and run it as the repo normally does. The shipped figures to beat are **night ±3.5 K / day ±5.0 K**.

`veg[]` reaches the physics through a **mean-neutral** blend that preserves the governed ward scalar, so accuracy should be materially unchanged. **If it moves, STOP and report the numbers** — do not absorb a regression silently, and do not tune anything to recover it. A real move would mean the mean-neutral blend is not as neutral as documented, which is a finding in its own right.

- [ ] **Step 2: Record the result**

If unchanged, note the measured figures in the final report. If a script or fixture must change to run the check, report that instead of editing it.

---

### Task 5: Full gate and visual handoff

- [ ] **Step 1: Everything**

```
npm run verify      # astro check, mypy, test:py, 323 unit, build, publication contract, e2e
```

Expect exit 0.

- [ ] **Step 2: Hand to the user**

Headless rendering is black in this sandbox — do NOT claim visual verification. Start `npm run dev` and ask the user to check `/heat-map` on all three wards: denser canopy than before (~+37%), no lattice, gaps still present in thin canopy, no perf regression.

- [ ] **Step 3: Push only after the user approves the look**

```bash
git push -u origin feat/chm-v2
```

Landing on `main` is a separate decision. **Do not merge.** Note that `feat/chm-v2` branches cleanly off current `origin/main`, so it should fast-forward — but confirm rather than assume.

---

## Explicit non-goals

- **No physics changes** — the mean-neutral blend and governed ward scalar are untouched.
- **No Phase-B work** — exclusion mask, parks prior, ETH gate, crown detection all stay parked.
- **No ETH integration.**
- **No v1↔v2 uncertainty exhibit** — deferred in the spec with its trigger.
- **No TS changes** — `trees.json` schema is unchanged.
- **Do not stage** another session's files, root scratch PNGs, or `attic/`.
