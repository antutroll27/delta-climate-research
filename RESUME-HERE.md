# Resume — flood-sim, paused 2026-08-26

Branch `feat/flood-sim`, clean, all pushed through `9f55611`.

## Run this first

    cd .claude/worktrees/flood-sim
    nice -n 10 python3 scripts/validate-flood-stability.py --realisations 5 --white 3 --workers 4

~30 min on 4 niced workers. NO CHECKPOINTING — it restarts from zero, so don't
kill it. It was 10 min in when the machine had to shut down.

This is the ONLY thing blocking quotable accuracy numbers. Its previous output
predates both the routing fix (c944393) and the GEDTM30 fill (b77a4db), so the
CSI figure recorded in the file header is stale and marked unquotable.

## Gates, all green as of the pause

    python3 -m mypy                          # 90 files
    python3 scripts/flood_unsteady.py --self-test    # 7/7
    python3 scripts/check-flood-routing.py           # OK
    python3 scripts/check-terrain-accuracy.py        # 4/4 within 1.5 m
    python3 scripts/fetch-dubai-terrain.py --check   # OK

## Then, in order

1. **Landsat-9 validation.** `LC09_L2SP_160043_20240419_20240424_02_T1`, 19 Apr
   2024, 0.03 % cloud, USGS public domain. First real ground truth this model
   has ever had. Caveat: a naive MNDWI threshold is unstable here (Gulf
   turbidity, sun glint, sabkha salt crust) — the published work used a trained
   classifier.
2. **Union OSM water into `sea_mask()`.** 6,185 cells of above-MSL permanent
   water (marina basins, lagoons) sit outside the elevation mask and would
   render as flooded. 0.69 % of the domain — won't move aggregates, will be
   noticed. Recorded in the `sea_mask()` docstring.
3. **One cell still peaks at 10.17 m** and wants explaining.

## Do NOT

- Quote any depth or CSI figure until the ensemble re-runs.
- Call 254.8 mm "the Dubai flood" — it is Al Ain (Khatm Al Shakla). Dubai got
  ~142 mm. This is a transposed event at ~1.74x Dubai's 1-in-100 design storm.
- Commit UAE AIP charts or schedule anything against AIRAC cycles.
- Build Dubai South as a 3-D scene — geometry is current, heights are not
  (OSM 1.3 %, 3D-GloBFP r = 0.416).
