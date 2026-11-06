# Phase A, chunk 1 status (A0, A1, A2, A4, A5, A6; A3 skipped by instruction)
Worktree /Volumes/OBOSLab/worktrees/city-amsterdam, branch feat/city-amsterdam (from origin/main f0eeaa5). Nothing pushed.
CLOCK NOTE: the Mac slept repeatedly (pmset log), so wall-clock stamps after ~06:30 IST overstate working time by hours;
active working time was roughly 4.5 h. No task overran its budget by 50 %; the slow parts were the 3D BAG download (~35 min,
network-bound) and the WCS download (~25 min, server-bound).

| task | status | commit | evidence |
|---|---|---|---|
| A0 | done | 8f682c8 | A0-baseline.txt: check/typecheck/test:py green; test:unit 1882/1911, all 29 failures need dist/ (no build run) |
| A1 | done | 4278915 | 162 frozen files + 6 surface-meta rows; self-test = 8 mutations; passes at every later commit |
| A2 | done | 001af99 | Cfb (Beck 2023), KNMI 240 normals from the primary table, stadsdelen Centrum 46.3 / Zuid 33.0 / West 20.6 %; not drawable |
| A4 | done | 3a689e3 | _city.py; parity vs _bangalore 0 m over 75 pts + 3 centres; EPSG 28992/6677 names confirmed |
| A5 | done | af7fd4e | 21,342 footprints, 0 fills; p50 14.90 / p95 18.74 / max 41.96 m; 46 tiles, 95 MB |
| A6 | done | f918b9b | 96x96 NAP mesh, min -4.52 / max 3.53 / mean 0.68 m; AHN4 served, not AHN5 |

## commands
- python3 scripts/check-existing-cities-unchanged.py [--write-baseline | --self-test]
- python3 scripts/_city.py ; python3 scripts/fetch-city.py --self-test
- taskpolicy -b python3 scripts/fetch-city.py --city amsterdam --layer buildings|terrain
- plan-scratch/raw-checks.py, raw-checks-water.py, overture-count.py (outputs in plan-scratch/*.txt)

## disk
raw cache ~/.cache/delta-climate/cities/amsterdam/raw = 564 MB (3D BAG 95 MB gz, AHN tiles+clips ~330 MB, Koppen 131 MB zip + 12 MB tif).
/Volumes/OBOSLab free: 33 GiB at start, 32 GiB at end.

## log
04:15 A0 done. 05:21 A1 done. 06:21 A2 done. A4/A5/A6 followed; see commits.

# Chunk 2 (A3, A7-A11)
- Step 0 done: rebased onto origin/main e20758a (PR #75 + #76). `git log origin/main..HEAD` = the 7 chunk-1 commits, `HEAD..origin/main` = #75/#76 only (9 files: accuracy-claim, HeatCards, MethodsCards, heat-map-app, sim-ts, ward-raster, 3 tests). Freeze check passes UNCHANGED against the f0eeaa5 baseline: no regeneration needed (the main-side changes are source, not artefacts).
- HH:MM A3 code + tests green (costs null-safe, CITY_CREDITS data, per-city AQI clock); committing.
- 16:25 IST: A3 committed (b68230e6). A7 done (context: 213 water polys / 469 water lines (6 covered) / 708 green / 2,252 road segments, major 7.5 %). A8 canopy done (CHM v2, 16,710 trees, cover>=3 m 27.9 %); surface raster running. A9 script written (G4 landmarks fetched from Wikidata). A10 exporter written. Not yet committed.
- 16:55 IST: A7+A8 committed (c4126ad3). Surface raster done (25 scenes 2021-25, fvc 0.2947, albedo 0.0942, veg=0.295 in cities.ts). A10 export + artefact check written and green locally. A9 --measure (G5/G6 from raw AHN) running; G1-G4 measured: G1/G2/G3 pass, G4 passes with per-landmark 100 m / median 200 m mirror rule (thresholds need Opus confirmation). Full unit run found 1 regression of mine (obos-shell payback regex) - fixed.
- 17:45 IST: chunk 2 complete (A3, A7-A11; A12/A13 not started by instruction). Final gates: npm run check 0 errors; typecheck clean (107 files); test:py exit 0; test:unit 1953 tests, 1924 pass, 29 fail = exactly the A0 baseline set (all need dist/); freeze check ok (162 files + 6 rows). frame-guard G1-G8 all pass.

# Fix-pass (audit fixes F1-F10), started 17:56 IST, box 4h
- 17:56 starting: step 0 rebase onto origin/main 37c8f2ad.
- 18:09 step 0 (rebase onto 37c8f2ad, #77 claim shape), 1 (Dubai crash), 2 (credits byte-identical) committed.
