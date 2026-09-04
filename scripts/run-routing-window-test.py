"""Does the solver lose to elevation because six hours is not long enough?

THE QUESTION. Scored against Landsat's observed April 2024 extent, the unsteady
solver came last: CSI 0.0187 (0.74x random) against inverted elevation's 0.0281,
and at ~2 km districts -0.057 against +0.300. A flood model that loses to "low
ground gets wet" is subtracting information from the terrain.

THE HYPOTHESIS. The model reports PEAK DEPTH DURING A 6 h STORM. Dubai slopes at
about 1.7 m/km. On a gradient that shallow, six hours moves water almost nowhere,
so the output is dominated by WHERE RAIN FELL — BCR-weighted, i.e. rooftops —
rather than WHERE WATER ENDS UP. Landsat imaged three days later, by which time
water has found the low points. Measured support: modelled wetness correlates
with building coverage at +0.18 while the observation correlates at -0.05.

THE TEST. Same storm, same 142 mm, but delivered in the first 6 h of a 72 h
window so the solver gets three days to route it — matching what the satellite
actually saw.

  · If the model swings toward the elevation signal, the defect is the OUTPUT
    QUANTITY, not the physics: peak-during-storm is the wrong field to ship for
    a flat city, and the artefact contract needs a settled state.
  · If it does not, the defect is upstream in runoff GENERATION, and
    BCR-weighting is misplacing water from the start.

Either way it is a specific answer rather than a suspicion.

COST AND WHY IT CHECKPOINTS. Past 50 minutes on the 948^2 grid — the timestep is
CFL-limited and stays small while water is deep, so the runtime depends on how
fast Dubai drains, which is the very thing being measured. Two earlier attempts
were killed by machine shutdowns with nothing recoverable, because `simulate`
printed only on completion. This one logs every 2,000 steps and checkpoints the
state, so an interruption costs the last few minutes rather than the whole run.

    nohup python3 scripts/run-routing-window-test.py > /tmp/routing-test.log 2>&1 &
    tail -f /tmp/routing-test.log
    python3 scripts/score-flood-methods.py      # picks the result up automatically
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flood_unsteady import sea_mask, simulate  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "public", "flood-sim", "data")
# OUTPUT LIVES ON THE PROJECT VOLUME, NOT IN /private/tmp. The 6 h baseline was
# written to the session scratchpad and silently vanished — swept by a tmp
# reaper, not a disk-space problem (27 GB free at the time). The scoreboard then
# dropped that row without complaining, so a comparison point disappeared from a
# table that reads as complete. data/.cache/ is gitignored and durable.
OUT = os.path.join(HERE, "..", "data", ".cache", "flood-runs")

RAIN_MM = 142.0        # Dubai's own 16 Apr 2024 total, NOT Al Ain's 254.8 mm
STORM_H = 6.0
STEPS_HY = 432         # 10-minute hyetograph resolution across the window


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--hours", type=float, default=72.0)
    ap.add_argument("--rain", type=float, default=RAIN_MM)
    ap.add_argument("--out-dir", default=OUT)
    ap.add_argument("--storm", choices=("observed", "design"), default="observed")
    # 38.6 mm/h is Hussein's measured WADI SAND -- loose and uncompacted. Urban
    # Dubai's open ground is graded, compacted and partly sealed, so this is an
    # upper bound on how fast it drinks. Sweepable because it is now the largest
    # remaining assumption, having been the SECOND largest until the storm shape
    # was fixed.
    ap.add_argument("--ground-f", type=float, default=None,
                    help="override bare-ground infiltration, mm/h (default 38.6)")
    # PIPED DRAINAGE, SCALED BY BUILT COVER. Capacity is assumed proportional to
    # BCR because development and drainage arrive together -- a sabkha flat has
    # no gullies and a built block does. That is a PROXY, not a survey: no open
    # dataset of Dubai's storm network exists. It is a hypothesis under test,
    # which is why it is a flag with a default of off rather than a constant.
    ap.add_argument("--drain-mmh", type=float, default=None,
                    help="peak piped drainage at BCR=1, mm/h (default: none)")
    a = ap.parse_args()

    if a.ground_f is not None:
        import flood_unsteady
        flood_unsteady.GROUND_F = a.ground_f

    terr = json.load(open(os.path.join(DATA, "dubai-creek-terrain.json")))
    n, cell = int(terr["n"]), float(terr["cellM"])
    z = np.asarray(terr["h"], dtype="float64").reshape(n, n)
    bcr = np.asarray(terr["bcr"], dtype="float64").reshape(n, n)
    sink = sea_mask(z)
    drain = None if a.drain_mmh is None else (a.drain_mmh * bcr / 1000.0 / 3600.0)

    # THE STORM SHAPE IS NOW OBSERVED, NOT INVENTED (2026-08-27).
    #
    # This was a Gaussian burst over 6 h — an SCS-Type-II-shaped guess, chosen
    # because it is conventional. GPM IMERG says Dubai's storm was nothing like
    # it: a 24 h event, half its rain spread across 8.5 h, peaking at 21 mm/h.
    # The guess peaked at 61 mm/h and packed half the rain into 1.6 h.
    #
    # Same total, 11.3x the runoff. Infiltration is intensity-resolved, so the
    # invented storm out-ran bare sand (38.6 mm/h) everywhere and every land
    # cell generated runoff; the real one out-runs it on 15 % of them. That
    # single error is the model's 3x over-prediction of flooded area.
    #
    #   --storm design   reproduces the old behaviour for comparison
    if a.storm == "observed":
        rain = json.load(open(os.path.join(DATA, "dubai-creek-rainfall.json")))
        inten = np.asarray(rain["intensityMmHr"], dtype="float64")
        # IMERG reads 119.8 mm against the 142 mm ground report — a known dry
        # bias for extremes over arid land. Take SHAPE from the satellite and
        # TOTAL from the ground, rather than trusting either for both.
        # THE OBSERVED SERIES IS ANCHORED TO REAL TIME, AT A FIXED 30 min STEP.
        #
        # The array is 145 half-hours of actual April 2024. Handing it to a
        # window of a different length and letting the step size stretch does
        # not lengthen the storm — it RESCALES THE TIME AXIS. A 24 h storm
        # squeezed into 6 h becomes 4x more intense, manufacturing the exact
        # too-peaky storm this whole change removed.
        #
        # So the step is pinned at 30 min and a LONGER window is zero-padded:
        # the same rain falls at the same rate, then it is dry while the water
        # routes. That is what "give it more time to drain" has to mean. A
        # SHORTER window is refused outright — it would silently drop rain.
        step_h = 0.5
        need = int(round(a.hours / step_h))
        if need < len(inten):
            sys.exit(f"--hours {a.hours:.0f} is shorter than the observed storm's "
                     f"{len(inten) * step_h:.0f} h; that would discard rainfall. "
                     f"Use --storm design to sweep shorter windows.")
        inten *= a.rain / (inten.sum() * step_h)          # scale to the ground total
        inten = np.concatenate([inten, np.zeros(need - len(inten))])
        shape = (f"observed IMERG, {int((inten > 0).sum())} wet of "
                 f"{len(inten)} x 30 min steps")
    else:
        t = np.arange(STEPS_HY) * (a.hours / STEPS_HY)
        w = np.where(t < STORM_H,
                     np.exp(-0.5 * ((t - STORM_H * 0.45) / (STORM_H * 0.13)) ** 2), 0.0)
        inten = (w / w.sum() * a.rain) / (a.hours / STEPS_HY)
        shape = f"invented design storm, {STORM_H:.0f} h burst"

    print(f"  {n}x{n} @ {cell:.0f} m, {a.hours:.0f} h window, {a.rain} mm total\n"
          f"  {shape}, peak {inten.max():.1f} mm/h\n"
          f"  infiltration {a.ground_f or 38.6:.1f} mm/h, drainage "
          f"{'none' if a.drain_mmh is None else f'{a.drain_mmh:g} mm/h x BCR'}",
          flush=True)
    os.makedirs(a.out_dir, exist_ok=True)
    t0 = time.time()

    def report(steps: int, tt: float, T: float, peak: np.ndarray[Any, Any],
               h: np.ndarray[Any, Any]) -> None:
        el = time.time() - t0
        frac = tt / T if T else 0.0
        eta = (el / frac - el) if frac > 0.01 else float("nan")
        print(f"    {steps:>7,} steps  {tt/3600:6.2f}/{T/3600:.0f} h ({frac*100:5.1f} %)  "
              f"h_max {float(h.max()):6.3f} m  peak_max {float(peak.max()):6.3f} m  "
              f"{el/60:5.1f} min elapsed, ~{eta/60:.0f} min left", flush=True)
        np.save(os.path.join(a.out_dir, f"peak_{int(a.hours)}h.partial.npy"), peak)
        np.save(os.path.join(a.out_dir, f"resid_{int(a.hours)}h.partial.npy"), h)

    peak, resid, steps, tt = simulate(z, bcr, 0.0, hours=a.hours, cell=cell,
                                      sink=sink, hyeto=inten, max_steps=300000,
                                      drain=drain,
                                      progress=report, progress_every=2000)

    # Name by window length so a SWEEP can run concurrently without collisions.
    # One 72 h endpoint answers "does more time help"; a sweep answers "how much,
    # and where does it saturate" — and the solver is single-threaded, so the
    # only way to use more than one core is to run more than one scenario.
    tag = (f"{int(a.hours)}h" + ("" if a.storm == "design" else "-obs")
           + ("" if a.ground_f is None else f"-f{a.ground_f:g}")
           + ("" if a.drain_mmh is None else f"-d{a.drain_mmh:g}"))
    np.save(os.path.join(a.out_dir, f"peak_{tag}.npy"), peak)
    np.save(os.path.join(a.out_dir, f"resid_{tag}.npy"), resid)
    wet_p = int((peak > 0.20).sum())
    wet_r = int((resid > 0.20).sum())
    print(f"\n  DONE: {steps:,} steps, {tt/3600:.1f} h simulated, "
          f"{(time.time()-t0)/60:.1f} min wall", flush=True)
    print(f"  peak max {peak.max():.2f} m   residual max {resid.max():.2f} m")
    print(f"  wet at 0.20 m: peak {wet_p:,} cells, residual {wet_r:,} "
          f"({wet_r/max(wet_p,1)*100:.1f} % still wet at {a.hours:.0f} h)")
    print(f"\n  now run:  python3 scripts/score-flood-methods.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
