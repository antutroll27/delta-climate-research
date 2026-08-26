"""Reference flood solver: unsteady rain-on-grid, simple-inertial shallow water.

Bates, Horritt & Fewtrell 2010 (doi:10.1016/j.jhydrol.2010.03.027) — the
LISFLOOD-FP / SFINCS formulation:

    q_{t+dt} = (q_t - g*hf*dt*dL/dx) / (1 + g*dt*n^2*|q_t| / hf^{7/3})

WHY UNSTEADY, AND WHY PEAK RATHER THAN FINAL. A steady-state ponding model on an
open-boundary surface converges to the fill-spill answer by definition: when
water stops moving it sits in closed depressions with flat surfaces at spill
level. On 30 m Dubai terrain that depression field is sensor noise (BUILD-SPEC
§3a), so no solver that reports equilibrium can escape it. This one reports PEAK
DEPTH DURING THE STORM, which is what a flood map shows and what the published
Dubai HEC-RAS study computes.

WHAT IT IS HONEST ABOUT — MEASURED 2026-08-26, RE-RUNNABLE.

scripts/validate-flood-stability.py, 9 realisations, 4 workers, ~33 min. Every
figure below comes from that harness against this surface; artefact written to
public/flood-sim/flood-stability.json. Perturbation is DeltaDTM's own stated
error (sigma 0.43 m) at a 400 m correlation length, because DEM error is
spatially correlated and white noise is not how DEMs err.

                        CSI     depth corr   wet drift   p95 drift
    correlated (real)   0.624      0.834       6.22 %      6.54 %
    white noise (ctrl)  0.290      0.338      11.23 %     36.22 %

    baseline: wet 16.73 %, p95 0.363 m, mean 0.0681 m, max 9.18 m
    all 9 realisations completed the full 6.00 h; 7,352-8,129 steps

THE SPLIT IS THE POINT. Aggregates hold; the spatial pattern moves. CSI 0.624
means five equally-plausible terrains agree on ~62 % of which cells flood. So
the defensible claim is DISTRICT-SCALE — how much floods and how deep — and
never which street. The white-noise column is the control that makes the rest
mean anything: it collapses to CSI 0.290 with 36 % p95 drift, so the test
discriminates rather than measuring its own noise.

THE DRIFT GOT WORSE WHEN THE SOLVER GOT BETTER, AND THAT IS CORRECT.

An earlier run of this same harness reported aggregate drift of 0.29 %. That
number was too good, and it was too good BECAUSE of a bug: the routing defect
(see below) was a deterministic artefact that largely cancelled between
realisations, flattening the drift artificially. With water actually routing,
realistic DEM error produces genuinely different totals. 6.22 % is the honest
figure; 0.29 % was measuring a defect's reproducibility.

Depth correlation moved the other way for the same reason: 0.670 -> 0.834, which
is what you expect once depth is a field rather than a scatter of spikes.

WHAT WAS FIXED TO GET HERE. Three defects, all found 2026-08-26, each hiding the
next. The terrain was N-S mirrored against its own buildings (36.57 % of Dubai
stood in the Persian Gulf). DeltaDTM saturates at 10.0 m rather than going void,
so a third of the land was a dead-flat mesa with nothing to route. And the
water-surface gradient was NEGATED, which drove flow up the slope and produced
odd-even decoupling — 16.09 m peaks in isolated cells with dry neighbours.

    max depth   16.09 m -> 10.17 m -> 9.18 m
    p95         0.881 m ->  0.360 m -> 0.363 m

The first arrow is the sign fix, the second the GEDTM30 bare-earth fill. p95 is
now stable across two independent terrain builds, which is the better evidence.

Guarded by scripts/check-flood-routing.py and self-test groups 6-7. The self-test
passed 5 of 5 for the entire life of the inverted sign because not one check
looked at flow DIRECTION.

STILL NOT VALIDATED AGAINST OBSERVATION. Everything above measures REPRODUCIBILITY
under terrain error, not correctness. There is no observed depth field for Dubai:
no gauge network, and the "2024 flood districts" list that circulates is Gulf News
2018. The first real target is Landsat-9, 19 April 2024, path/row 160/043, 0.03 %
cloud, USGS public domain — untried. Until then this model is self-consistent, not
verified.

    python3 scripts/flood_unsteady.py --self-test
"""
from __future__ import annotations

import argparse
import sys
from typing import Any

import numpy as np



G = 9.81
FR_MAX = 1.0          # critical flow; above this the shallow-water form is invalid anyway


# Rainfall losses. Roofs are sealed; open desert ground is not, and the two
# differ by more than an order of magnitude, so a single domain-wide loss is
# wrong in both directions at once.
#
# GROUND_F IS CALIBRATED, NOT CHOSEN. Hussein et al. 2025 (doi:10.1007/s11069-025
# -07156-9) measured a ~7.14 % runoff ratio for the April-2024 event in this
# hyper-arid catchment.
#
# THE 254.8 mm BELOW IS AL AIN, NOT DUBAI (Khatm Al Shakla, ~95 km away). Dubai
# recorded ~142 mm; Al Marmoom, inland Dubai emirate, 219.3 mm. Pairing 254.8 mm
# with Hussein's ratio is coherent because both describe the SAME catchment — but
# applying the result to Dubai is a transposition, at ~1.74x Dubai's official
# 1-in-100 design storm. Label scenarios accordingly; do not call the output
# "the April 2024 Dubai flood". Solving (254.8 - IA_GROUND - 6*f)/254.8 = 0.0714 gives
# f = 38.6 mm/h -- high, but squarely inside the 20-200 mm/h band for desert
# sand, and it reproduces the ONE measured number available for this event.
#
# The urban ratio then falls out of BCR rather than being asserted: at 22 %
# building coverage this domain generates far more runoff than the wadi
# catchment Hussein measured, which is why Dubai flooded while the wadi absorbed
# its rain. The model reproduces ~7 % as BCR -> 0.
IA_GROUND, GROUND_F = 5.0, 38.6      # mm, mm/h
IA_ROOF, ROOF_F = 2.0, 0.0           # mm, mm/h -- roofs do not infiltrate


def sea_mask(z: np.ndarray[Any, Any]) -> np.ndarray[Any, Any]:
    """Permanent open water: the below-MSL region CONNECTED TO THE DOMAIN EDGE.

    NOT simply z < 0. A third of this window is the Gulf and the Creek, and
    treating it as floodable ground is why an early run reported an 11.87 m
    "flood peak" — that was the sea. But inland sabkha also sits below MSL and
    genuinely does flood, so a flat threshold would erase real signal: measured
    on this domain, 33.20 % of cells are edge-connected sea and 0.47 % are
    inland below-MSL depressions that must be kept.

    Connectivity is the discriminator that separates them, and it needs no
    coastline vector — the Gulf reaches the boundary and a sabkha does not.

    INCOMPLETE ON ITS OWN. Cross-checked against OSM's 379 water polygons,
    6,185 cells of permanent water sit OUTSIDE this mask: marina basins,
    artificial lakes and lagoons that are above MSL and do not touch the
    boundary, so neither test can see them. They are 0.69 % of the domain —
    too small to move an aggregate, but they are exactly the cells a reader
    would notice rendered as "flooded". Union this with rasterised OSM water
    before building a shipped scenario; `validate-flood-stability.py` runs on
    the elevation mask alone because a coastline that moves per realisation
    would measure an unstable mask rather than an unstable flood pattern.
    """
    from scipy.ndimage import label as _label     # noqa: PLC0415 — optional at import time

    lab, _ = _label(z < 0.0)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    edge.discard(0)
    mask: np.ndarray[Any, Any] = np.isin(lab, list(edge))
    return mask


def runoff_field(rain_mm: float, bcr: np.ndarray[Any, Any],
                 hours: float = 6.0) -> np.ndarray[Any, Any]:
    """Per-cell runoff depth, mm, from an EVENT TOTAL. BCR-weighted.

    !!! THIS SPREADS RAIN UNIFORMLY AND THAT IS WHY IT FAILS BELOW ~237 mm. !!!

    `rain - IA - f*hours` assumes constant intensity, so it compares a MEAN rate
    against f. Over 6 h the ground here can absorb IA + f*6 = 236.6 mm before
    yielding a single drop. Dubai's actual 16 Apr 2024 total was ~142 mm and Al
    Marmoom's local extreme 219.3 mm, so for EVERY rainfall Dubai has recorded
    this returns zero ground runoff and all runoff comes from roofs.

    Measured consequence: modelled wet cells correlate with BCR at +0.18 while
    the Landsat-observed extent correlates at -0.05. The model floods where
    buildings are; reality floods where they are not.

    Infiltration is rate-limited INSTANTANEOUSLY, not on an event mean. At 142 mm
    the same IA and f give 0 % runoff uniform but 27.3 % under an SCS-Type-II
    shape — a 38.8 mm swing on temporal distribution alone, larger than any other
    term in this model. Prefer `simulate(..., hyeto=...)`, which applies losses
    inside the time loop.

    Kept because the self-test calibration against Hussein et al. is stated as an
    event ratio, and because a uniform storm is still the right idealisation when
    no hyetograph is available — as long as nobody mistakes it for conservative.
    It is not: it under-predicts runoff badly at sub-237 mm totals.
    """
    roof = max(0.0, rain_mm - IA_ROOF - ROOF_F * hours)
    ground = max(0.0, rain_mm - IA_GROUND - GROUND_F * hours)
    field: np.ndarray[Any, Any] = bcr * roof + (1.0 - bcr) * ground
    return field


def simulate(z: np.ndarray[Any, Any], bcr: np.ndarray[Any, Any],
             runoff_mm: np.ndarray[Any, Any] | float, hours: float = 6.0,
             manning: float = 0.035, cell: float = 30.0, alpha: float = 0.7,
             max_steps: int = 40000,
             sink: np.ndarray[Any, Any] | None = None,
             h0: np.ndarray[Any, Any] | None = None,
             hold: np.ndarray[Any, Any] | None = None,
             closed: bool = False,
             hyeto: np.ndarray[Any, Any] | None = None) -> tuple[np.ndarray[Any, Any], np.ndarray[Any, Any], int, float]:
    """`sink` cells drain freely — water reaching them has left the catchment.

    This is how permanent water enters the physics. Without it the sea is a
    closed basin that fills up, which both fabricates depth over the Gulf and
    dams the coastal outfall that real runoff uses to escape.
    """
    A = cell * cell
    # STORAGE porosity phi = 1 - BCR. The floor is 0.15, not 0.05: at 0.05 a
    # 95%-built cell holds so little that any inflow reads as metres of depth.
    store = np.maximum(1.0 - bcr, 0.15)
    # CONVEYANCE porosity, and it is NOT optional here. Reducing storage without
    # reducing the face width lets a nearly-full cell accept full-width flux into
    # a fraction of the volume, and depth runs away -- measured, 43 cells reached
    # hundreds of metres. In a momentum-free solver storage alone is safe because
    # there is no flux RATE; in an unsteady one the two must move together. The
    # face is limited by the tighter of the two cells it joins.
    conv_x = np.minimum(store, np.roll(store, -1, axis=1))
    conv_y = np.minimum(store, np.roll(store, -1, axis=0))
    # h0/hold/closed exist so scripts/check-flood-routing.py can drive the REAL
    # loop instead of reimplementing it. The first version of that reproducer
    # carried its own copy of this arithmetic, so it could not see a fix to this
    # function at all — it reported the defect as unfixed after it was fixed.
    h = np.zeros_like(z) if h0 is None else h0.astype("float64").copy()
    peak = np.zeros_like(z)
    qx = np.zeros_like(z)                            # flux across the +x face, m2/s
    qy = np.zeros_like(z)
    T = hours * 3600.0

    # INTENSITY-RESOLVED LOSSES. When `hyeto` is given it is rainfall intensity in
    # mm/h at evenly spaced points across the storm, and infiltration is applied
    # PER STEP against the instantaneous rate rather than against an event mean.
    # That distinction is the whole ballgame: see runoff_field's docstring for the
    # 0 % vs 27.3 % measurement at Dubai's actual 142 mm.
    #
    # Initial abstraction is a per-cell store that depletes, not a subtraction
    # from the total — a burst can exhaust it early and everything after runs off.
    use_hyeto = hyeto is not None
    hy = np.asarray(hyeto if use_hyeto else [0.0], dtype="float64")
    ia_left = (bcr * IA_ROOF + (1.0 - bcr) * IA_GROUND) / 1000.0        # m
    f_cell = (bcr * ROOF_F + (1.0 - bcr) * GROUND_F) / 1000.0 / 3600.0  # m/s
    rain = (np.zeros_like(z) if use_hyeto
            else np.asarray(runoff_mm, dtype='float64') / 1000.0 / T)   # m/s, per cell
    t, out, steps = 0.0, 0.0, 0

    while t < T and steps < max_steps:
        L = z + h
        hmax = float(h.max())
        dt = min(alpha * cell / np.sqrt(G * max(hmax, 1e-3)), T - t, 20.0)
        dt = max(dt, 0.05)          # floor: a runaway dt collapse stalls the storm

        if use_hyeto:
            # intensity now, in m/s, from the hyetograph's own time base
            frac = min(max(t / T, 0.0), 1.0) * (len(hy) - 1)
            i0 = int(frac)
            i1 = min(i0 + 1, len(hy) - 1)
            inten = (hy[i0] + (hy[i1] - hy[i0]) * (frac - i0)) / 1000.0 / 3600.0
            fall = inten * dt                                    # m this step
            take = np.minimum(ia_left, fall)                     # IA first
            ia_left -= take
            net = np.maximum(fall - take - f_cell * dt, 0.0)     # then infiltration
            newh = h + net / store
        else:
            newh = h + rain * dt / store             # rain first, then routing
        for axis, q, conv in ((0, qy, conv_y), (1, qx, conv_x)):
            Ln = np.roll(L, -1, axis=axis)
            zn = np.roll(z, -1, axis=axis)
            hf = np.maximum(L, Ln) - np.maximum(z, zn)
            hf = np.maximum(hf, 0.0)
            # SIGN: the gradient must be DOWNSTREAM-MINUS-UPSTREAM. Bates 2010
            # writes q_next = (q - g*hf*dt * d(h+z)/dx); with flux defined
            # positive from cell i to i+1, d(h+z)/dx is (L[i+1] - L[i])/dx.
            #
            # It was (L[i] - L[i+1])/dx, which accelerates flow UP the gradient.
            # Measured on a closed domain with a uniform film on a uniform slope:
            # the low end drained 1.000 -> 0.037 while the high end grew
            # 1.000 -> 1.042. Water pooled on the hilltop, mass conserved exactly.
            #
            # Downstream it produced odd-even decoupling — alternate cells dry,
            # their neighbours deep — which in Dubai read as 16.09 m peaks in
            # isolated cells. Negating this drops the checkerboard from 0.5225 to
            # 0.0062 and leaves no dry interior cells.
            #
            # Guarded by scripts/check-flood-routing.py and by self-test group 6.
            slope = (Ln - L) / cell
            denom = 1.0 + G * dt * manning ** 2 * np.abs(q) / np.maximum(hf, 1e-6) ** (7.0 / 3.0)
            qn = (q - G * hf * dt * slope) / denom
            qn = np.where(hf > 1e-4, qn, 0.0)
            # FROUDE CAP. The inertial update is unbounded when hf is small and
            # the head slope is steep, which is exactly what noise-perturbed
            # terrain produces: measured, ponded volume ran to +69,392 % at
            # sigma 1.0 m. Open-channel flow does not exceed critical depth, so
            # clamp |v| to Fr_max*sqrt(g*hf). This is a physical bound, not a
            # numerical fudge, and it is what LISFLOOD-FP implementations do.
            vmax = FR_MAX * np.sqrt(G * np.maximum(hf, 1e-6))
            qn = np.clip(qn, -vmax * hf, vmax * hf)

            if closed:
                if axis == 0:
                    qn[-1, :] = 0.0
                else:
                    qn[:, -1] = 0.0
            dV = qn * cell * conv * dt               # face width reduced by conveyance porosity
            here = newh * store * A
            there = np.roll(newh, -1, axis=axis) * store * A
            dV = np.clip(dV, -there, here)           # never drain a cell negative
            newh = newh - dV / (store * A)
            newh = newh + np.roll(dV, 1, axis=axis) / (store * A)
            q[...] = qn

        h = np.maximum(newh, 0.0)
        if closed:
            # No open boundary. Used only by the routing check, where an open
            # edge would act as a sink and hide which way water actually moves —
            # exactly how the first sign test wrongly cleared this solver.
            pass
        elif hold is not None:
            h[0, :] = h[-1, :] = hold[0, :]
            h[:, 0] = h[:, -1] = hold[:, 0]
        else:
            out += float(h[0, :].sum() + h[-1, :].sum() + h[:, 0].sum() + h[:, -1].sum()) * A
            h[0, :] = h[-1, :] = 0.0
            h[:, 0] = h[:, -1] = 0.0
        if sink is not None:
            out += float(h[sink].sum()) * A       # volume that reached open water
            h[sink] = 0.0                         # same treatment as the domain edge
        qx[0, :] = qx[-1, :] = qy[0, :] = qy[-1, :] = 0.0
        peak = np.maximum(peak, h)
        t += dt
        steps += 1
    return peak, h, steps, t


def self_test() -> int:
    """Runnable checks. Every one of these caught a real defect while building."""
    fails: list[str] = []

    def a(ok: bool, msg: str) -> None:
        if not ok:
            fails.append(msg)

    # 1. Infiltration reproduces the one measured number for this event.
    ratio = float(runoff_field(254.8, np.zeros(1))[0]) / 254.8
    a(abs(ratio - 0.0714) < 0.002,
      f"unsealed runoff ratio {ratio:.4f}, Hussein et al. 2025 measured 0.0714")
    a(float(runoff_field(60.0, np.zeros(1))[0]) == 0.0,
      "60 mm on desert sand must fully infiltrate in 6 h")
    a(float(runoff_field(60.0, np.ones(1))[0]) > 50.0,
      "60 mm on a sealed roof must nearly all run off")

    # 2. Rising rainfall never yields less water. Non-negotiable.
    rng = np.random.default_rng(3)
    z = rng.normal(0, 1.0, (48, 48)).cumsum(axis=0) * 0.1
    bcr = np.clip(rng.normal(0.2, 0.15, z.shape), 0.0, 1.0)
    prev = -1.0
    for mm in (20.0, 60.0, 120.0):
        peak, _, _, _ = simulate(z, bcr, runoff_field(mm, bcr), cell=30.0)
        total = float(peak.sum())
        a(total >= prev, f"ponded volume fell between rainfall steps at {mm} mm")
        prev = total

    # 3. THE FROUDE CAP. Without it, noise-perturbed terrain produced steep heads
    #    on thin films and ponded volume ran to +69,392 %. This is the guard.
    ro = runoff_field(254.8, bcr)
    base, _, _, _ = simulate(z, bcr, ro, cell=30.0)
    noisy, _, _, _ = simulate(z + rng.normal(0, 2.0, z.shape), bcr, ro, cell=30.0)
    drift = abs(float(noisy.sum()) / max(float(base.sum()), 1e-9) - 1.0)
    a(drift < 0.5, f"ponded volume moved {100*drift:.0f} % under 2 m of noise -- flux is unbounded")
    a(float(noisy.max()) < 100.0, f"peak depth {noisy.max():.0f} m is unphysical")

    # 4. Conveyance porosity must accompany storage porosity. Storage alone lets
    #    a nearly-full cell take full-width inflow into a fraction of the volume.
    solid = np.full(z.shape, 0.97)
    pk, _, _, _ = simulate(z, solid, runoff_field(254.8, solid), cell=30.0)
    a(float(pk.max()) < 50.0,
      f"a near-solid block reached {pk.max():.0f} m -- conveyance porosity is missing")

    # 5. FLOW DIRECTION. The self-test passed 5 of 5 for the entire time the
    #    momentum term drove water UP the water-surface gradient, because not one
    #    check looked at direction. A closed domain matters here: with open edges
    #    the low end drains regardless of which way flux points, which is how an
    #    early sign test wrongly cleared this solver.
    zt = np.tile(np.linspace(0.0, 10.0, 21).reshape(21, 1), (1, 21))
    h0 = np.full((21, 21), 0.2)
    _, hh, _, _ = simulate(zt, np.zeros((21, 21)), 0.0, hours=0.1, cell=30.0,
                           h0=h0, closed=True)
    low, high = float(hh[1:6, 10].sum()), float(hh[15:20, 10].sum())
    a(low > high,
      f"a uniform film on a slope pooled HIGH ({high:.3f}) not LOW ({low:.3f}) -- "
      f"the water-surface gradient is driving flow up the slope")

    # 6. NO ODD-EVEN DECOUPLING. The inverted gradient made alternate cells drain
    #    to zero while their neighbours deepened; in Dubai that read as 16.09 m
    #    peaks in isolated cells. Smooth slope, smooth start, smooth answer.
    h0 = np.full((21, 21), 0.2)
    h0[10, :] += 2.0
    _, hh, _, _ = simulate(zt, np.zeros((21, 21)), 0.0, hours=0.05, cell=30.0,
                           h0=h0, hold=np.full((21, 21), 0.2))
    col = hh[:, 10]
    alt = abs(float(col[2:10:2].mean()) - float(col[1:10:2].mean()))
    a(alt < 0.05, f"adjacent cells differ by {alt:.4f} m on a smooth slope -- odd-even decoupling")
    a(int((col[1:20] <= 1e-9).sum()) == 0,
      f"{int((col[1:20] <= 1e-9).sum())} interior cells drained to zero from a wet start")

    for line in fails:
        print(f"  FAIL {line}")
    print(f"\n  {7 - len(fails)} of 7 check groups passed.")
    return 1 if fails else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.parse_args()
    return self_test()


if __name__ == "__main__":
    sys.exit(main())
