# Phase A, chunk 1 status (tasks A0, A1, A2, A4, A5, A6; A3 skipped by instruction)
Worktree /Volumes/OBOSLab/worktrees/city-amsterdam, branch feat/city-amsterdam (from origin/main f0eeaa5).
Started 03:45 IST. NOTE ON THE CLOCK: the Mac slept repeatedly (pmset log: sleeps at 13:12, 13:29, ...), so wall-clock
timestamps after ~06:30 overstate working time by hours. Active working time at the A5 download is roughly 3.5 h.

| task | status | evidence |
|---|---|---|
| A0 | done | A0-baseline.txt: check/typecheck/test:py green; test:unit 1882/1911, the 29 failures all need dist/ (no build run) |
| A1 | done | 4278915. 162 frozen files + 6 surface-meta rows; self-test covers 8 mutations |
| A2 | done | 001af99. Cfb (Beck 2023), KNMI 240 normals from the primary table, stadsdelen Centrum/Zuid/West; not drawable |
| A4 | see log | scripts/_city.py: parity oracle vs _bangalore = 0 m over 75 pts + 3 centres |
| A5 | see log | scripts/_src_3dbag.py + fetch-city.py |
| A6 | see log | scripts/_src_dem.py |

## log
- 04:15 A0 done. 05:21 A1 done. 06:21 A2 done (commit 001af99).
- A4 written; mypy/self-test green. A5: 3D BAG v20250903, 46 GPKG tiles (95 MB), sha256-verified; download is the bottleneck (~1 tile/min).
