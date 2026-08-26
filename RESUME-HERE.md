# Resume — flood-sim

Branch `feat/flood-sim`, clean, pushed. Nothing running.

## The overnight job — one command

    cd .claude/worktrees/flood-sim
    nohup nice -n 10 python3 scripts/run-routing-window-test.py > /tmp/routing-test.log 2>&1 &
    tail -f /tmp/routing-test.log

50-90 min. It now LOGS every 2,000 steps and CHECKPOINTS to
`peak_72h.partial.npy` — two earlier attempts were killed by machine shutdowns
with nothing recoverable, because simulate() printed only on completion.

When it finishes:  `python3 scripts/score-flood-methods.py`  (picks it up automatically)

## Where the project actually stands

The model is REPRODUCIBLE (CSI 0.624 under terrain error, white-noise control
0.290) and NOT CORRECT. Scored against Landsat's observed April 2024 extent:

    method              CSI   vs rand     1920m block r
    elevation        0.0281    1.12x         +0.300
    hand             0.0273    1.09x         +0.300   (= elevation in disguise)
    depthBelow       0.0150    0.60x         +0.226
    twi              0.0114    0.46x         -0.158
    solver-peak      0.0187    0.74x         -0.057

Nothing has cell-scale skill. `-elevation` is the least-bad method at r = +0.30
for ~2 km districts — which explains ~9 % of variance. It is not a good model.

## Do NOT

- Present any of this as a validated flood map.
- Quote 254.8 mm as "the Dubai flood" — that is Al Ain. Dubai got ~142 mm.
- Fit a model to the observed extent to post a better number. The published
  comparator (IoU 0.86) fits; we predict. A fitted model generalises to neither
  another storm nor another city, and Dubai is meant to be city #1 of many.

## Blocked on you

1. **IMERG EULA** — https://urs.earthdata.nasa.gov/approve_app?client_id=e2WVk8Pw6weeLUKZYOxvTQ
   Every rainfall number rests on a storm shape I invented. Runoff at 142 mm
   swings 0 % -> 27 % on hyetograph shape alone: the largest open assumption.
2. **The HDI / building aesthetic** you mentioned, for the Blender look-dev.

## Next after the routing test

- Tiled city (Dubai + South) for flood-sim and OBOS. Saved in memory.
  TILING IS RENDERING-ONLY — the solve must stay contiguous or seams fabricate walls.
- A better DEM is the biggest accuracy lever and is BLOCKED: FABDEM and
  FathomDEM are both CC BY-NC-SA, no open lidar exists for Dubai.
