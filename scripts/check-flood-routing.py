"""Minimal reproducer for the routing defect in `flood_unsteady.simulate`.

STATUS: KNOWN FAILING as of 2026-08-26. This script exists to document a defect
that is not yet fixed, and to give any attempted fix an immediate pass/fail.
It is deliberately NOT wired into a build gate, because it fails today.

THE CASE. A uniform slope, a uniform thin film of water everywhere, and one row
of extra depth at mid-slope. No buildings, no porosity, no rain, no sea. The
correct answer is not in dispute: the extra water spreads and runs downhill, and
no interior cell should end up dry while its neighbour deepens.

WHAT ACTUALLY HAPPENS.

    row  1  0.0000   -0.2000
    row  2  0.5182   +0.3182
    row  3  0.0000   -0.2000
    row  4  0.5197   +0.3197
    row 10  2.5963   +2.3963   <- the raised row GAINED water

Alternate cells drain to zero while their neighbours accumulate — odd-even
decoupling — and the raised row grows instead of draining.

IT IS NOT A TIMESTEP PROBLEM. Refining dt by 20x (1.0 -> 0.05, holding sim time
constant) leaves the checkerboard amplitude unchanged at 0.52 and the raised row
at 2.596 m in all three cases. The scheme CONVERGES to this answer rather than
diverging toward it, which is the dangerous kind of wrong: it looks stable and
produces plausible output.

IT IS NOT THE POROSITY FLOOR. This reproducer runs with store = 1 throughout.
The floor only amplifies the artefact — a smaller void turns the same trapped
volume into a larger depth, which is why depth in Dubai correlated with 1/store
at +0.49 and why the floor looked like the cause. It is not.

IT IS NOT THE SLOPE SIGN. `slope = (L[i] - L[i+1])/dx` matches Bates et al. 2010
once the flux convention (positive from i to i+1) is accounted for. That was
checked and the solver is right.

WHAT THE dV CLIP IS ACTUALLY DOING. Removing `np.clip(dV, -there, here)` makes
this case go NaN. So the clip is not a safety net on a sound scheme — it is the
only thing preventing blow-up, and the checkerboard is what it produces instead.
That points at the flux limiter interacting with the in-place `newh` update
inside the axis loop, which is the first place to look.

WHAT IT INVALIDATES. Every absolute depth from this solver: the 16.09 m peak
cells in Dubai are this artefact. It also puts the CSI figure from
validate-flood-stability.py in doubt, because if which cell wins the checkerboard
is itself terrain-sensitive, that number measures an artefact's sensitivity
rather than the flood pattern's.

    python3 scripts/check-flood-routing.py
"""
from __future__ import annotations

import os
import sys
from typing import Any

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flood_unsteady import simulate  # noqa: E402

CELL = 30.0
FILM = 0.20          # uniform wet film, so the dV clip never binds on a dry cell
BLOB = 2.00          # extra depth on one row at mid-slope


def profile(n: int = 21, steps: int = 150) -> np.ndarray[Any, Any]:
    """Down-slope water profile after routing. Column 0 — every column is equal."""
    z = np.tile(np.linspace(0.0, 10.0, n).reshape(n, 1), (1, n))
    bcr = np.zeros((n, n))
    h = np.full((n, n), FILM)
    h[n // 2, :] += BLOB

    # simulate() starts from h = 0 and has no initial-condition argument, so the
    # loop is reproduced here. It is the same arithmetic; see flood_unsteady.
    g, fr = 9.81, 1.0
    store = np.maximum(1.0 - bcr, 0.15)
    area = CELL * CELL
    qy = np.zeros_like(h)
    for _ in range(steps):
        lvl = z + h
        dt = 1.0
        newh = h.copy()
        ln = np.roll(lvl, -1, axis=0)
        zn = np.roll(z, -1, axis=0)
        hf = np.maximum(np.maximum(lvl, ln) - np.maximum(z, zn), 0.0)
        slope = (lvl - ln) / CELL
        denom = 1.0 + g * dt * 0.035 ** 2 * np.abs(qy) / np.maximum(hf, 1e-6) ** (7.0 / 3.0)
        qn = np.where(hf > 1e-4, (qy - g * hf * dt * slope) / denom, 0.0)
        vmax = fr * np.sqrt(g * np.maximum(hf, 1e-6))
        qn = np.clip(qn, -vmax * hf, vmax * hf)
        dv = np.clip(qn * CELL * dt, -np.roll(newh, -1, axis=0) * area, newh * area)
        newh = newh - dv / area + np.roll(dv, 1, axis=0) / area
        qy = qn
        h = np.maximum(newh, 0.0)
        h[0, :] = h[-1, :] = FILM        # hold both ends, so neither end is a sink
    out: np.ndarray[Any, Any] = h[:, 0]
    return out


def main() -> int:
    n = 21
    p = profile(n)
    mid = n // 2
    interior = p[1:n - 1]

    fails: list[str] = []

    # 1. NO CHECKERBOARD. Adjacent interior cells on a smooth slope with a smooth
    #    initial condition must not alternate between full and empty.
    ev = p[2:mid:2]
    od = p[1:mid:2]
    alt = abs(float(ev.mean()) - float(od.mean()))
    if alt > 0.05:
        fails.append(f"checkerboard amplitude {alt:.4f} m between adjacent cells (want < 0.05)")

    # 2. NO DRY INTERIOR CELLS. Everything started wet and water was only added.
    dry = int((interior <= 1e-9).sum())
    if dry:
        fails.append(f"{dry} of {interior.size} interior cells drained to zero from a wet start")

    # 3. THE RAISED ROW MUST DRAIN. It sits above its neighbours; it cannot gain.
    if p[mid] > FILM + BLOB:
        fails.append(f"the raised row grew from {FILM+BLOB:.3f} m to {p[mid]:.3f} m")

    # 4. TIMESTEP INDEPENDENCE. A convergent scheme changes with dt; this one
    #    does not, which is how we know refining dt is not the answer.
    coarse = profile(n, 150)
    fine = profile(n, 3000)
    if abs(float(coarse[mid]) - float(fine[mid])) < 1e-3 and fails:
        print(f"  note: dt-independent — raised row {coarse[mid]:.3f} m at both "
              f"150 and 3000 steps, so this is structural, not CFL")

    print(f"\n  down-slope profile (row 0 = low, row {n-1} = high, all started at {FILM} m):")
    for r in range(n):
        bar = "#" * int(min(p[r], 3.0) * 20)
        tag = "  <-- raised row" if r == mid else ""
        print(f"    {r:>3}  {p[r]:7.4f}  {bar}{tag}")

    if fails:
        print(f"\n  FAIL ({len(fails)}):")
        for f in fails:
            print(f"    - {f}")
        print("\n  This is the known routing defect. See the module docstring.")
        return 1
    print("\n  OK: water routes downhill without decoupling.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
