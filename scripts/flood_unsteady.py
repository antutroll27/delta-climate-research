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

!!! THE ROUTING IS DEFECTIVE. DO NOT QUOTE ANY DEPTH FROM THIS SOLVER. !!!

Found 2026-08-26. On a uniform slope with a uniform wet film, this scheme drives
odd-even decoupling: alternate cells drain to zero while their neighbours
accumulate, and a raised row GAINS water instead of draining. In Dubai that
surfaces as 16.09 m peak depths in isolated cells whose neighbours are dry.

Reproducer, runs in a second:  scripts/check-flood-routing.py

Three things it is NOT, each checked and ruled out:
  · not a CFL violation — refining dt 20x (1.0 -> 0.05, sim time held) leaves the
    checkerboard at 0.52 and the raised row at 2.596 m. It CONVERGES to the wrong
    answer, which is the dangerous kind of wrong.
  · not the porosity floor — the reproducer runs at store = 1. The floor only
    amplifies it (small void, same trapped volume, larger depth), which is why
    Dubai depth correlated with 1/store at +0.49 and the floor looked guilty.
  · not the slope sign — (L[i] - L[i+1])/dx matches Bates 2010 given the flux
    convention. Verified against a known-answer case.

Removing the dV volume clip makes the case go NaN, so that clip is not a safety
net on a sound scheme; it is the only thing preventing blow-up, and the
checkerboard is what it yields instead. First place to look is the flux limiter
interacting with the in-place `newh` update inside the axis loop.

WITHDRAWN — the stability numbers that stood here.

They read: "spatial overlap 0.56-0.65, depth correlation 0.71-0.80, wet fraction
and p95 move under 6 %". Measured ad-hoc, never committed, on the old 7.68 km
window, over a domain that was one-third Persian Gulf with no permanent-water
mask, on terrain later found N-S mirrored with a third of it clamped flat.

Re-derived on the corrected surface by scripts/validate-flood-stability.py
(committed, re-runnable): CSI 0.613-0.622, depth correlation 0.662-0.687,
aggregate drift under 0.3 %, white-noise contrast CSI 0.203.

THOSE ARE ALSO NOT SAFE TO QUOTE YET. CSI measures how much the flood PATTERN
moves under terrain error. If which cell wins the checkerboard is itself
terrain-sensitive, the figure measures an artefact's sensitivity rather than the
flood pattern's, and the two cannot currently be separated. Aggregate drift and
the white-noise contrast probably survive, since a deterministic artefact largely
cancels between realisations — but "probably" is not an accuracy claim.

The district-scale claim may well be right. It is not evidenced today.

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
# hyper-arid catchment. Solving (254.8 - IA_GROUND - 6*f)/254.8 = 0.0714 gives
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
    """Per-cell runoff depth, mm. BCR-weighted (Li et al. 2026, 10.1111/jfr3.70178)."""
    roof = max(0.0, rain_mm - IA_ROOF - ROOF_F * hours)
    ground = max(0.0, rain_mm - IA_GROUND - GROUND_F * hours)
    field: np.ndarray[Any, Any] = bcr * roof + (1.0 - bcr) * ground
    return field


def simulate(z: np.ndarray[Any, Any], bcr: np.ndarray[Any, Any],
             runoff_mm: np.ndarray[Any, Any] | float, hours: float = 6.0,
             manning: float = 0.035, cell: float = 30.0, alpha: float = 0.7,
             max_steps: int = 40000,
             sink: np.ndarray[Any, Any] | None = None) -> tuple[np.ndarray[Any, Any], np.ndarray[Any, Any], int, float]:
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
    h = np.zeros_like(z)
    peak = np.zeros_like(z)
    qx = np.zeros_like(z)                            # flux across the +x face, m2/s
    qy = np.zeros_like(z)
    T = hours * 3600.0
    rain = (np.asarray(runoff_mm, dtype='float64') / 1000.0) / T   # m/s, per cell
    t, out, steps = 0.0, 0.0, 0

    while t < T and steps < max_steps:
        L = z + h
        hmax = float(h.max())
        dt = min(alpha * cell / np.sqrt(G * max(hmax, 1e-3)), T - t, 20.0)
        dt = max(dt, 0.05)          # floor: a runaway dt collapse stalls the storm

        newh = h + rain * dt / store                 # rain first, then routing
        for axis, q, conv in ((0, qy, conv_y), (1, qx, conv_x)):
            Ln = np.roll(L, -1, axis=axis)
            zn = np.roll(z, -1, axis=axis)
            hf = np.maximum(L, Ln) - np.maximum(z, zn)
            hf = np.maximum(hf, 0.0)
            slope = (L - Ln) / cell
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

            dV = qn * cell * conv * dt               # face width reduced by conveyance porosity
            here = newh * store * A
            there = np.roll(newh, -1, axis=axis) * store * A
            dV = np.clip(dV, -there, here)           # never drain a cell negative
            newh = newh - dV / (store * A)
            newh = newh + np.roll(dV, 1, axis=axis) / (store * A)
            q[...] = qn

        h = np.maximum(newh, 0.0)
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

    for line in fails:
        print(f"  FAIL {line}")
    print(f"\n  {5 - len(fails)} of 5 check groups passed.")
    return 1 if fails else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.parse_args()
    return self_test()


if __name__ == "__main__":
    sys.exit(main())
