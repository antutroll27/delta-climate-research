"""Guards the routing in `flood_unsteady.simulate` against odd-even decoupling.

STATUS: PASSING since the gradient sign was corrected on 2026-08-26.

WHAT IT CHECKS. Two cases with answers that are not in dispute:

  1. A uniform film on a uniform slope, CLOSED domain. Water must pool at the
     BOTTOM. The closed domain is essential — with open edges the low end acts
     as a sink and drains no matter which way flux points, and that is precisely
     how an early test wrongly cleared this solver after the defect had already
     been identified correctly.

  2. That same slope with one raised row at mid-slope. The extra water spreads
     and runs downhill; no interior cell may end up dry while its neighbour
     deepens, and the raised row may not gain water.

THE DEFECT IT EXISTS FOR. `slope` was written as (L[i] - L[i+1])/dx. Bates et
al. 2010 gives q_next = (q - g*hf*dt * d(h+z)/dx), and with flux defined
positive from i to i+1 that gradient is (L[i+1] - L[i])/dx. Negated, the
momentum term accelerates flow UP the water-surface gradient.

Measured on case 1 before the fix: the low end drained 1.000 -> 0.037 while the
high end grew 1.000 -> 1.042, mass conserved exactly. Water pooled on a hilltop.

Downstream it produced odd-even decoupling — alternate cells dry, neighbours
deep — which in Dubai read as 16.09 m peak depths in isolated cells, 3,585 cells
over 5 m. Correcting the sign takes the checkerboard from 0.5225 to 0.0062 and
leaves no dry interior cells.

FALSE LEADS, EACH RULED OUT BY MEASUREMENT, RECORDED SO THEY ARE NOT RE-WALKED:

  · The porosity floor. Depth correlated with 1/store at +0.49 and 98.6 % of
    >10 m cells sat on the 0.15 floor. Compelling, and wrong: this reproducer
    runs at store = 1 and showed the identical checkerboard. The floor only
    amplifies — a smaller void turns the same trapped volume into a larger
    depth. An amplifier mistaken for a cause.

  · The timestep. Refining dt 20x (1.0 -> 0.05, sim time held) left the
    checkerboard at 0.52 and the raised row at 2.596 m in all three cases. The
    scheme converged to the wrong answer rather than diverging toward it.

  · The dV volume clip. Removing it makes the case go NaN, which made it look
    load-bearing. It is not the cause; two variants of it changed nothing.

WHY NOTHING CAUGHT THIS. The solver self-test passed 5 of 5 throughout. Its
checks cover the runoff ratio, monotonicity, the Froude cap and conveyance
porosity — none looks at flow DIRECTION. And the Dubai terrain was a third
dead-flat mesa until the same day, where a routing defect has nothing to route.

This file drives simulate() directly. Its first version reimplemented the solver
loop and therefore went on reporting the defect after it had been fixed; a
reproducer that does not exercise the code under test is worthless.

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


def profile(n: int = 21, hours: float = 0.05) -> np.ndarray[Any, Any]:
    """Down-slope water profile after routing, from the REAL solver.

    An earlier version of this file carried its own copy of the solver loop, so
    it could not observe a fix to flood_unsteady at all — it went on reporting
    the defect after the defect was gone. It now drives simulate() directly via
    h0/hold, which is the whole point of a reproducer.
    """
    z = np.tile(np.linspace(0.0, 10.0, n).reshape(n, 1), (1, n))
    bcr = np.zeros((n, n))
    h0 = np.full((n, n), FILM)
    h0[n // 2, :] += BLOB
    hold = np.full((n, n), FILM)
    _, h, _, _ = simulate(z, bcr, 0.0, hours=hours, cell=CELL, h0=h0, hold=hold)
    # INTERIOR column. `hold` pins the edge columns at FILM, so reading column 0
    # returns the boundary condition rather than the solution — which is exactly
    # what it did on the first run of this fixed version, showing a flat 0.2000
    # everywhere and hiding whether the blob had drained at all.
    out: np.ndarray[Any, Any] = h[:, n // 2]
    return out


def closed_film(n: int = 21, hours: float = 0.1) -> tuple[float, float]:
    """Uniform film on a uniform slope, CLOSED domain. Water must pool LOW.

    This is the case that settles the gradient sign, and it needs a closed
    domain: with open edges the low end acts as a sink and drains regardless of
    which way flux points, which is exactly how an earlier test wrongly cleared
    the solver after the sign had already been correctly identified as inverted.
    """
    z = np.tile(np.linspace(0.0, 10.0, n).reshape(n, 1), (1, n))
    bcr = np.zeros((n, n))
    h0 = np.full((n, n), FILM)
    _, h, _, _ = simulate(z, bcr, 0.0, hours=hours, cell=CELL, h0=h0, closed=True)
    c = n // 2
    return float(h[1:6, c].sum()), float(h[n - 6:n - 1, c].sum())


def main() -> int:
    n = 21
    p = profile(n)
    mid = n // 2
    interior = p[1:n - 1]
    fails: list[str] = []

    # 1. THE GRADIENT SIGN. Closed domain, uniform film: water pools at the
    #    bottom of the hill. Nothing else is physically possible.
    lo, hi = closed_film(n)
    if hi >= lo:
        fails.append(f"closed uniform film pooled HIGH ({hi:.3f}) not LOW ({lo:.3f}) "
                     f"— the water-surface gradient drives flow up the slope")

    # 2. NO CHECKERBOARD on a smooth slope from a smooth start.
    ev, od = p[2:mid:2], p[1:mid:2]
    alt = abs(float(ev.mean()) - float(od.mean()))
    if alt > 0.05:
        fails.append(f"checkerboard amplitude {alt:.4f} m between adjacent cells (want < 0.05)")

    # 3. NO DRY INTERIOR CELLS — everything started wet and water was only added.
    dry = int((interior <= 1e-9).sum())
    if dry:
        fails.append(f"{dry} of {interior.size} interior cells drained to zero from a wet start")

    # 4. THE RAISED ROW MUST DRAIN. It stands above its neighbours; it cannot gain.
    if p[mid] > FILM + BLOB:
        fails.append(f"the raised row grew from {FILM+BLOB:.3f} m to {p[mid]:.3f} m")

    print(f"  closed uniform film: low end {lo:.3f}   high end {hi:.3f}"
          f"   ({'pools LOW, correct' if lo > hi else 'POOLS HIGH'})")
    print(f"\n  down-slope profile (row 0 = low, row {n-1} = high, all started at {FILM} m):")
    for r in range(n):
        bar = "#" * int(min(p[r], 3.0) * 20)
        tag = "  <-- raised row" if r == mid else ""
        print(f"    {r:>3}  {p[r]:7.4f}  {bar}{tag}")

    if fails:
        print(f"\n  FAIL ({len(fails)}):")
        for f in fails:
            print(f"    - {f}")
        return 1
    print("\n  OK: water routes downhill, no decoupling, no dry interior cells.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
