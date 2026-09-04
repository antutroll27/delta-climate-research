"""Parametric landmark massing, driven by the MEASURED OSM footprint.

WHY THIS EXISTS. The pipeline can only make vertical prisms: a building is its
footprint extruded to its height. 461 of the 520 buildings over 100 m in the
Creek window have no OSM `building:part` record, so they are boxes -- and even
where parts exist, Simple 3D Buildings is stacked prisms, which can never make a
sail, a twist or a torus. A live Overpass query returns ZERO parts for the Burj
Al Arab, so no amount of re-fetching will produce one.

WHAT MAKES IT DEFENSIBLE. Every builder here reads the measured plan and shapes
only the vertical profile. The Burj Al Arab's OSM footprint already encodes the
building: ten vertices trace the membrane arc and vertex 10 is the spine, 76 m
north-west, where the two wings meet. Scaling the measured ring toward that
fixed spine as height rises produces the sail. The plan does the identifying;
the parameters only say how it tapers.

THE MASSING IS STILL AUTHORED and is not a measurement. See the `provenance`
line in dubai-creek-landmarks.json.

No `bpy` import: Blender's Python is not the system Python, and geometry that
needs Blender to run cannot be unit tested. blender_dubai.py turns these
verts/faces into objects.

    python3 scripts/blender_landmarks.py      # self-test
"""
from __future__ import annotations

import math
from typing import Any, Callable

Ring = list[tuple[float, float]]
Mesh = tuple[list[tuple[float, float, float]], list[tuple[int, ...]]]


def open_ring(flat: list[float]) -> Ring:
    """Flat [x0,y0,x1,y1,...] to points, dropping the repeated closing vertex."""
    n = len(flat) // 2
    if n >= 2 and abs(flat[0] - flat[-2]) < 1e-6 and abs(flat[1] - flat[-1]) < 1e-6:
        n -= 1
    return [(flat[2 * i], flat[2 * i + 1]) for i in range(n)]


def _loft(sections: list[tuple[Ring, float]]) -> Mesh:
    """Stack rings of equal length into a closed solid: walls, floor, cap."""
    n = len(sections[0][0])
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for ring, z in sections:
        for (x, y) in ring:
            verts.append((x, y, z))
    for level in range(len(sections) - 1):
        a, b = level * n, (level + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple((len(sections) - 1) * n + i for i in range(n)))
    return verts, faces


def sail(ring: Ring, base: float, height: float, params: dict[str, Any]) -> Mesh:
    """Burj Al Arab. The ring collapses toward a fixed spine vertex as it rises.

    Anisotropic on purpose: the wings close in on each other (width) at a
    different rate from the membrane sweeping back toward the spine (depth), and
    a single scale reads as a cone rather than a sail.

    `massFraction` stops the enclosed mass below the architectural top, leaving
    the rest to the mast that blender_dubai.py adds.
    """
    apex_i = int(params["apexVertex"])
    exp_d, exp_w = float(params["expDepth"]), float(params["expWidth"])
    mass = float(params.get("massFraction", 1.0))
    levels = int(params.get("levels", 36))

    ax, ay = ring[apex_i]
    others = [p for i, p in enumerate(ring) if i != apex_i]
    mx = sum(p[0] for p in others) / len(others) - ax
    my = sum(p[1] for p in others) / len(others) - ay
    mag = math.hypot(mx, my) or 1.0
    ux, uy = mx / mag, my / mag          # depth axis: spine -> membrane
    wx, wy = -uy, ux                     # width axis: wing to wing
    duw = [((x - ax) * ux + (y - ay) * uy, (x - ax) * wx + (y - ay) * wy)
           for (x, y) in ring]

    sections: list[tuple[Ring, float]] = []
    for level in range(levels + 1):
        t = level / levels
        sd = max(0.02, 1.0 - t ** exp_d)
        sw = max(0.02, 1.0 - t ** exp_w)
        sections.append(([(ax + ux * d * sd + wx * w * sw,
                           ay + uy * d * sd + wy * w * sw) for (d, w) in duw],
                         base + height * mass * t))
    return _loft(sections)


def twist(ring: Ring, base: float, height: float, params: dict[str, Any]) -> Mesh:
    """Cayan Tower. The plan rotates about its own centroid as it rises.

    The total rotation is a published figure for this building, so it is one
    cited number rather than a shape anyone had to invent.
    """
    total = math.radians(float(params["twistDeg"]))
    levels = int(params.get("levels", 30))
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)

    sections: list[tuple[Ring, float]] = []
    for level in range(levels + 1):
        t = level / levels
        a = total * t
        ca, sa = math.cos(a), math.sin(a)
        sections.append(([(cx + (x - cx) * ca - (y - cy) * sa,
                           cy + (x - cx) * sa + (y - cy) * ca) for (x, y) in ring],
                         base + height * t))
    return _loft(sections)


def wave(ring: Ring, base: float, height: float, params: dict[str, Any]) -> Mesh:
    """Jumeirah Beach Hotel. A long slab whose ROOFLINE is a curve.

    THE FIRST ATTEMPT WAS A CONE. Tapering the plan on both axes, the way `sail`
    does, turns a 262 m-long building into a point -- it rendered as a tent
    beside the Burj Al Arab and looked nothing like the hotel. The wave is not a
    taper at all: the plan stays a long slab all the way up, and what curves is
    the top edge.

    So each vertex gets its own roof height, from where it sits ALONG the long
    axis. `crestMin` is the low end as a fraction of full height, `crestPower`
    bends the rise, and `leanM` lets the crest overhang the base like a breaking
    wave. The 75-vertex plan already carries the curve in plan; this adds the
    curve in elevation.
    """
    crest_min = float(params.get("crestMin", 0.18))
    power = float(params.get("crestPower", 1.0))
    lean = float(params.get("leanM", 0.0))
    flip = bool(params.get("flip", False))

    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    long_x = (max(xs) - min(xs)) >= (max(ys) - min(ys))
    lo, hi = (min(xs), max(xs)) if long_x else (min(ys), max(ys))
    span = (hi - lo) or 1.0

    def crest(x: float, y: float) -> float:
        s = ((x if long_x else y) - lo) / span
        if flip:
            s = 1.0 - s
        return crest_min + (1.0 - crest_min) * float(math.sin(math.pi / 2 * s) ** power)

    n = len(ring)
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for (x, y) in ring:
        verts.append((x, y, base))
    for (x, y) in ring:
        e = crest(x, y)
        # the crest leans across the SHORT axis, so the wave curls rather than
        # shearing along its own 262 m length
        dx = 0.0 if long_x else lean * e
        dy = lean * e if long_x else 0.0
        verts.append((x + dx, y + dy, base + height * e))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, j + n, i + n))
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(n + i for i in range(n)))
    return verts, faces


BUILDERS: dict[str, Callable[[Ring, float, float, dict[str, Any]], Mesh]] = {
    "sail": sail, "twist": twist, "wave": wave,
}


def build(form: str, ring: Ring, base: float, height: float,
          params: dict[str, Any]) -> Mesh:
    if form not in BUILDERS:
        raise SystemExit(f"unknown landmark form {form!r}; have {sorted(BUILDERS)}")
    if len(ring) < 3:
        raise SystemExit(f"form {form!r} needs a ring of 3+ vertices, got {len(ring)}")
    apex = params.get("apexVertex")
    if apex is not None and not 0 <= int(apex) < len(ring):
        # An IndexError here would read as a crash. It is actually a recipe that
        # has drifted from the data -- OSM redrew the plan and the spine vertex
        # moved -- and the message should say so.
        raise SystemExit(f"form {form!r}: apexVertex {apex} is out of range for a "
                         f"{len(ring)}-vertex ring; the OSM plan may have been redrawn")
    return BUILDERS[form](ring, base, height, params)


def self_test() -> int:
    """Run with: python3 scripts/blender_landmarks.py"""
    square: Ring = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]

    # open_ring drops a repeated closing vertex and keeps an already-open ring
    assert open_ring([0.0, 0.0, 10.0, 0.0, 10.0, 10.0, 0.0, 0.0]) == \
        [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)]
    assert len(open_ring([0.0, 0.0, 10.0, 0.0, 10.0, 10.0])) == 3

    verts, faces = twist(square, 5.0, 100.0, {"twistDeg": 90.0, "levels": 4})
    assert len(verts) == 4 * 5, len(verts)
    assert abs(min(p[2] for p in verts) - 5.0) < 1e-6
    assert abs(max(p[2] for p in verts) - 105.0) < 1e-6
    # TRACK ONE VERTEX, NOT THE SET. A 90-degree rotation maps a square onto
    # itself, so asserting that SOME top vertex sits at (10,0) passes whether the
    # ring turned or not -- mutation-tested: zeroing the twist angle survived it.
    # Vertex 0 starts at (0,0) and a quarter turn about the centroid (5,5) puts
    # it at (10,0), so pin that one vertex.
    assert abs(verts[-4][0] - 10.0) < 1e-6 and abs(verts[-4][1] - 0.0) < 1e-6, verts[-4]
    assert abs(verts[0][0]) < 1e-6 and abs(verts[0][1]) < 1e-6, verts[0]
    # every quad plus a floor and a cap
    assert len(faces) == 4 * 4 + 2, len(faces)

    verts, _ = sail(square + [(20.0, 20.0)], 0.0, 200.0,
                    {"apexVertex": 4, "expDepth": 2.0, "expWidth": 2.0,
                     "massFraction": 0.9, "levels": 8})
    assert abs(max(p[2] for p in verts) - 180.0) < 1e-6, max(p[2] for p in verts)
    apex_at_top = verts[-5:]
    spread = max(math.hypot(a[0] - b[0], a[1] - b[1])
                 for a in apex_at_top for b in apex_at_top)
    assert spread < 2.0, f"sail must converge on the spine, spread {spread:.1f} m"
    # ...and must NOT have converged at the base
    base_spread = max(math.hypot(a[0] - b[0], a[1] - b[1])
                      for a in verts[:5] for b in verts[:5])
    assert base_spread > 20.0, f"sail base collapsed, spread {base_spread:.1f} m"

    # A LONG slab, so the long axis is unambiguous and the crest has room to rise
    slab: Ring = [(0.0, 0.0), (100.0, 0.0), (100.0, 12.0), (0.0, 12.0)]
    verts, _ = wave(slab, 0.0, 50.0, {"crestMin": 0.2, "crestPower": 1.0, "leanM": 6.0})
    assert abs(max(p[2] for p in verts) - 50.0) < 1e-6, max(p[2] for p in verts)
    # the roofline RISES along the long axis: low end near 20 %, high end at full
    lo_end = [p[2] for p in verts[4:] if p[0] < 1.0]
    hi_end = [p[2] for p in verts[4:] if p[0] > 99.0]
    assert all(abs(z - 10.0) < 0.1 for z in lo_end), lo_end
    assert all(abs(z - 50.0) < 0.1 for z in hi_end), hi_end
    # ...and the plan does NOT collapse: a wave is a slab, not a cone
    top_len = max(p[0] for p in verts[4:]) - min(p[0] for p in verts[4:])
    assert top_len > 95.0, f"wave narrowed to {top_len:.1f} m; it must stay a slab"

    for form, ring, params, want in (
        ("torus", square, {}, "unknown landmark form"),
        ("twist", [(0.0, 0.0), (1.0, 1.0)], {"twistDeg": 90.0}, "3+ vertices"),
        ("sail", square, {"apexVertex": 99, "expDepth": 2.0, "expWidth": 2.0},
         "out of range"),
    ):
        try:
            build(form, ring, 0.0, 10.0, params)
        except SystemExit as exc:
            assert want in str(exc), f"{form}: {exc}"
        else:
            raise AssertionError(f"{form} with {params} must be refused")

    print("  blender_landmarks self-test: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(self_test())
