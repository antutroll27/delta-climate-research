"""Build the Dubai Creek scene in Blender and render it with Cycles.

PURPOSE: establish the LOOK against physically-based light before trying to
match it in a three.js shader. Guessing a palette in GLSL and screenshotting was
converging slowly; a Nishita sky and a real sun at Dubai's latitude give a
defensible target to match instead of an opinion.

Coordinates: site-local metres, x east / y north / z up. That is Blender's own
convention, so no axis juggling — and the artefacts already use it.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python scripts/blender_dubai.py -- --out /tmp/dubai.png --samples 64
"""
from __future__ import annotations

# bpy/mathutils ship no stubs and only exist inside Blender, so every signature
# that touches them is annotated against `Any`. The alternative is hand-written
# stubs for a script that runs in one place and never imports into the pipeline.

import json
import math
import os
import sys

from typing import Any

import bpy  # type: ignore[import-not-found]
from mathutils import Vector  # type: ignore[import-not-found]
from mathutils.geometry import tessellate_polygon  # type: ignore[import-not-found]

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "public", "flood-sim", "data")

TERRAIN_EXAG = 3.0     # lower than the web view's x6: Cycles shadows carry the form
SUN_ELEV_DEG = 26.0    # late afternoon — long shadows across the fabric
SUN_AZIM_DEG = 292.0


# THE SITE WAS HARDCODED IN FIVE PLACES. Every artefact path said
# "dubai-creek-", so building a second city meant editing the script rather than
# passing an argument — and the two would drift the moment one was edited and the
# other was not. Pass --site instead.
SITE = "dubai-creek"

# EXPOSURE IS A PROPERTY OF THE SURFACE, NOT A TASTE CHOICE. Bare desert reflects
# far more than a built coastal city, so one value cannot serve both: -4.0 puts
# the coastal strip at a healthy p50 0.46 and blows Dubai South out to 0.59.
# Measured by sweep at 8 samples, reading the luminance quantiles the renderer
# already prints:
#
#     dubai-south   -5.0 -> p50 0.439   -5.5 -> p50 0.367   -6.0 -> p50 0.301
#
# -5.5 sits mid-range with p05 0.094, so shadows still hold detail; -6.0 starts
# crushing the low end. --exposure still overrides for look-dev.
SITE_EXPOSURE = {"dubai-creek": -4.0, "dubai-south": -5.5}


# Landmark recipes, keyed by OSM element id. Populated in main() before the
# buildings are extruded, because build_buildings has to know which footprints to
# leave alone.
LANDMARKS: dict[str, dict[str, Any]] = {}


def load_landmarks(site: str) -> dict[str, dict[str, Any]]:
    """Recipes keyed by OSM id. An absent file is a warning, not an error.

    Landmarks are an enhancement, not a dependency: the scene must stay
    regenerable from OSM alone, so a missing recipe file draws prisms and says
    so. Every OTHER disagreement between recipe and data is fatal, because a
    recipe naming a building that is no longer there means an upstream edit
    silently removed a landmark -- exactly the class of defect this work fixes.
    """
    path = os.path.join(DATA, f"{site}-landmarks.json")
    if not os.path.exists(path):
        print(f"  no landmark recipes at {path} -- drawing prisms")
        return {}
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    out: dict[str, dict[str, Any]] = {}
    for lm in doc["landmarks"]:
        out[str(lm["osm"])] = lm
    return out


def args() -> dict[str, str]:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out: dict[str, str] = {}
    for i in range(0, len(argv) - 1, 2):
        out[argv[i].lstrip("-")] = argv[i + 1]
    return out


def clear() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def principled(name: str, rgba: tuple[float, float, float, float],
               rough: float, spec: float = 0.35) -> Any:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = rough
    for key in ("Specular IOR Level", "Specular"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = spec
            break
    return mat


def build_terrain(doc: dict[str, Any]) -> Any:
    n, size = doc["n"], doc["footprintM"]
    h = doc["h"]
    step = size / (n - 1)
    verts = [((-size / 2) + i * step, (-size / 2) + j * step, h[j * n + i] * TERRAIN_EXAG)
             for j in range(n) for i in range(n)]
    faces = []
    for j in range(n - 1):
        for i in range(n - 1):
            a = j * n + i
            faces.append((a, a + 1, a + n + 1, a + n))
    mesh = bpy.data.meshes.new("terrain")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("terrain", mesh)
    bpy.context.collection.objects.link(obj)
    # Satellite texture if the imagery fetcher has run, hand palette otherwise.
    # Measured colour beats a chosen one: sabkha, irrigated green, sand, water
    # and built fabric all land correctly without anyone deciding a shade.
    tex = os.path.join(DATA, f"{SITE}-imagery.png")
    if os.path.exists(tex):
        mat = bpy.data.materials.new("satellite")
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(tex)
        node.image.colorspace_settings.name = "sRGB"
        nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.93
        for key in ("Specular IOR Level", "Specular"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = 0.10
                break
        obj.data.materials.append(mat)
        # The grid is row-major from the south-west corner and the texture was
        # flipped north-up at fetch time, so a direct i/j map lines up.
        uvl = mesh.uv_layers.new(name="UVMap")
        for poly in mesh.polygons:
            for li in poly.loop_indices:
                vi = mesh.loops[li].vertex_index
                uvl.data[li].uv = ((vi % n) / (n - 1), (vi // n) / (n - 1))
        print("  terrain: satellite texture applied")
    else:
        obj.data.materials.append(principled("sand", (0.34, 0.28, 0.21, 1.0), 0.94, 0.12))
    mod = obj.modifiers.new("smooth", "SMOOTH")
    mod.factor, mod.iterations = 0.4, 2
    return obj


def sample_ground(doc: dict[str, Any], x: float, y: float) -> float:
    n, size = doc["n"], doc["footprintM"]
    h = doc["h"]
    fx = (x + size / 2) / size * (n - 1)
    fy = (y + size / 2) / size * (n - 1)
    i = max(0, min(n - 2, int(fx)))
    j = max(0, min(n - 2, int(fy)))
    u, v = fx - i, fy - j
    a, b = h[j * n + i], h[j * n + i + 1]
    c, d = h[(j + 1) * n + i], h[(j + 1) * n + i + 1]
    ground: float = ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v)
    return ground * TERRAIN_EXAG


def ring_area(p: list[float]) -> float:
    total = 0.0
    for i in range(0, len(p) - 3, 2):
        total += p[i] * p[i + 3] - p[i + 2] * p[i + 1]
    return abs(total) / 2.0


HEIGHT_TABLE: dict[str, Any] = {}
HEIGHT_GRID: dict[str, Any] = {}
_GRID_INDEX: dict[tuple[int, int, int], float] = {}


def _grid_lookup(x: float, y: float, area: float) -> float | None:
    """Median measured height of this neighbourhood, at roughly this size.

    Widens by SIZE BAND before widening in SPACE: a tower two cells away is a
    worse guide than a smaller building next door, because the size bands are
    coarse and the districts are not.
    """
    if not _GRID_INDEX:
        return None
    cell = float(HEIGHT_GRID.get("cellM", 600.0))
    edges = HEIGHT_GRID.get("bandEdges") or [500.0, 2000.0, 5000.0]
    band = len(edges)
    for i, edge in enumerate(edges):
        if area < float(edge):
            band = i
            break
    gx, gy = int(x // cell), int(y // cell)
    nbands = len(edges) + 1
    for rad in (0, 1, 2, 3):
        same = [_GRID_INDEX[(i, j, band)]
                for i in range(gx - rad, gx + rad + 1)
                for j in range(gy - rad, gy + rad + 1)
                if (i, j, band) in _GRID_INDEX]
        if same:
            same.sort()
            return same[len(same) // 2]
        anyb = [_GRID_INDEX[(i, j, b)]
                for i in range(gx - rad, gx + rad + 1)
                for j in range(gy - rad, gy + rad + 1)
                for b in range(nbands) if (i, j, b) in _GRID_INDEX]
        if anyb:
            anyb.sort()
            return anyb[len(anyb) // 2]
    return None


def estimate_height(area: float, seed: int, x: float = 0.0, y: float = 0.0) -> float:
    """Fallback ONLY. Used where OSM has no height for this footprint.

    Capped at 60 m rather than the earlier 40 m, but the cap is not the point —
    real towers no longer come through here at all. Anything with a measured
    height bypasses this entirely, which is why the skyline exists now.

    ABOVE THE TABLE'S minArea THE SITE'S OWN MEASURED MEDIAN WINS. The log curve
    below is monotonic in footprint and reality is not: it assumes a bigger
    footprint means a taller building, which is a residential assumption. In
    Dubai South — Logistics City, JAFZA, Al Maktoum — the largest buildings are
    the flattest, and 923 warehouses were rendering 2.3 to 2.6 times too tall.

    Below minArea the curve is kept, because a fitted prior measurably does
    worse there. The threshold is not a hedge; it is where the measurement
    changes sign.
    """
    # WHERE it is beats HOW BIG it is, below 5,000 m2. Held out against genuine
    # height tags the neighbourhood median takes mean error from 20.76 m to
    # 11.58 m -- and in the 500-2,000 m2 band, where the Creek's towers sit, from
    # 47.43 m to 21.66 m. Above 5,000 m2 it LOSES (38.17 against 28.11), because
    # a mall's neighbours are villas, so that band keeps the fitted area table.
    if _GRID_INDEX and area < float(HEIGHT_GRID.get("maxArea", 5000.0)):
        near = _grid_lookup(x, y, area)
        if near is not None:
            jitter = 0.92 + 0.16 * ((math.sin(seed * 127.1) * 43758.5453) % 1.0)
            return max(3.0, near * jitter)

    bands = HEIGHT_TABLE.get("bands") or []
    if bands and area >= float(HEIGHT_TABLE.get("minArea", 5000.0)):
        best: float | None = None
        for band in bands:
            if area >= float(band["minArea"]) and band.get("medianM") is not None:
                best = float(band["medianM"])   # nearest populated band at or below
        if best is not None:
            jitter = 0.92 + 0.16 * ((math.sin(seed * 127.1) * 43758.5453) % 1.0)
            return max(3.0, best * jitter)
    base = 3.0 + 9.0 * math.log10(1.0 + area / 100.0)
    jitter = 0.85 + 0.30 * ((math.sin(seed * 127.1) * 43758.5453) % 1.0)
    return max(3.0, min(60.0, base * jitter))


def build_buildings(terrain_doc: dict[str, Any], doc: dict[str, Any]) -> Any:
    """One mesh for all 13,577 footprints. Blender takes n-gons, so no roof
    triangulation is needed — walls and a cap face per ring is the whole job."""
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for idx, b in enumerate(doc["b"]):
        p = b["p"]
        nv = len(p) // 2
        if nv < 3:
            continue
        # rings repeat the first vertex; drop it so the cap face is not degenerate
        if abs(p[0] - p[-2]) < 1e-6 and abs(p[1] - p[-1]) < 1e-6:
            nv -= 1
        if nv < 3:
            continue
        area = ring_area(p)
        if area < 12.0:
            continue
        # Footprints covered by OSM building:part slabs are drawn from those
        # instead. Extruding them flat as WELL would drive a stub straight
        # through the tower they belong to.
        if b.get("parts"):
            continue
        # Superseded: OSM has drawn this same building properly. Drawing both
        # wedges a crude ML footprint inside the good geometry.
        if b.get("sup"):
            continue
        cx = sum(p[i * 2] for i in range(nv)) / nv
        cy = sum(p[i * 2 + 1] for i in range(nv)) / nv
        base = sample_ground(terrain_doc, cx, cy) - 0.4
        # MEASURED height wins. b["h"] is present on the 1,389 footprints that
        # matched an OSM record — including Burj Khalifa at 522 m. Everything
        # else falls back to the area prior. No cap is applied to measured data:
        # capping it was what flattened the skyline in the first place.
        measured = b.get("h")
        top = base + (float(measured) if measured else estimate_height(area, idx + 1, cx, cy))
        start = len(verts)
        for i in range(nv):
            verts.append((p[i * 2], p[i * 2 + 1], base))
        for i in range(nv):
            verts.append((p[i * 2], p[i * 2 + 1], top))
        for i in range(nv):
            a0, a1 = start + i, start + (i + 1) % nv
            faces.append((a0, a1, a1 + nv, a0 + nv))
        faces.append(tuple(start + nv + i for i in range(nv)))
    # ── OSM outlines ────────────────────────────────────────────────────────
    # Hand-drawn geometry, so complex buildings keep their real plan instead of
    # whatever the ML detector managed. 2,644 of these carry a measured height.
    osm_drawn = 0
    for rec in doc.get("osmB", []):
        if rec.get("parts"):
            continue                       # its massing slabs handle it
        if rec.get("id") in LANDMARKS:
            continue                       # drawn as authored massing instead
        q = rec["p"]
        nv = len(q) // 2
        if nv >= 3 and abs(q[0] - q[-2]) < 1e-6 and abs(q[1] - q[-1]) < 1e-6:
            nv -= 1
        if nv < 3:
            continue
        area = ring_area(q)
        if area < 12.0:
            continue
        cx = sum(q[i * 2] for i in range(nv)) / nv
        cy = sum(q[i * 2 + 1] for i in range(nv)) / nv
        base = sample_ground(terrain_doc, cx, cy) - 0.4
        measured = rec.get("h")
        top = base + (float(measured) if measured else estimate_height(area, osm_drawn + 7, cx, cy))
        start = len(verts)
        for i in range(nv):
            verts.append((q[i * 2], q[i * 2 + 1], base))
        for i in range(nv):
            verts.append((q[i * 2], q[i * 2 + 1], top))
        for i in range(nv):
            a0, a1 = start + i, start + (i + 1) % nv
            faces.append((a0, a1, a1 + nv, a0 + nv))
        roof = rec.get("roof", "flat")
        if roof in ("pyramidal", "dome") and nv >= 4:
            # A single apex over the ring. Crude for a dome, but 2 domes and 3
            # pyramids in 41,447 buildings does not justify a tessellator.
            apex = len(verts)
            rise = min(0.35 * math.sqrt(area), 25.0)
            verts.append((cx, cy, top + rise))
            for i in range(nv):
                faces.append((start + nv + i, start + nv + (i + 1) % nv, apex))
        else:
            faces.append(tuple(start + nv + i for i in range(nv)))
        osm_drawn += 1
    print(f"  OSM outlines drawn: {osm_drawn:,}")

    # ── OSM 3D massing parts ────────────────────────────────────────────────
    # Each slab is its own prism from min_height to height. Stacked, they
    # reproduce a tower's setbacks — which a single footprint plus one height
    # can never do, and which is the whole difference between Burj Khalifa and
    # a 522 m needle.
    part_count = 0
    for pt in doc.get("parts", []):
        q = pt["p"]
        nv = len(q) // 2
        if nv >= 3 and abs(q[0] - q[-2]) < 1e-6 and abs(q[1] - q[-1]) < 1e-6:
            nv -= 1
        if nv < 3:
            continue
        cx = sum(q[i * 2] for i in range(nv)) / nv
        cy = sum(q[i * 2 + 1] for i in range(nv)) / nv
        ground = sample_ground(terrain_doc, cx, cy) - 0.4
        base = ground + float(pt["min"])
        top = ground + float(pt["h"])
        if top <= base:
            continue
        start = len(verts)
        for i in range(nv):
            verts.append((q[i * 2], q[i * 2 + 1], base))
        for i in range(nv):
            verts.append((q[i * 2], q[i * 2 + 1], top))
        for i in range(nv):
            a0, a1 = start + i, start + (i + 1) % nv
            faces.append((a0, a1, a1 + nv, a0 + nv))
        faces.append(tuple(start + nv + i for i in range(nv)))
        if float(pt["min"]) > 0.01:                      # floating slab needs a floor
            faces.append(tuple(start + nv - 1 - i for i in range(nv)))
        part_count += 1
    print(f"  3D massing: {part_count:,} parts extruded from OSM building:part")

    mesh = bpy.data.meshes.new("buildings")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("buildings", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(principled("concrete", (0.40, 0.38, 0.35, 1.0), 0.68, 0.28))
    tall = [float(x["h"]) for x in doc["b"] if x.get("h")]
    print(f"  buildings: {len(verts):,} verts, {len(faces):,} faces")
    if tall:
        tall.sort()
        print(f"  measured heights: {len(tall):,} | median {tall[len(tall)//2]:.0f} m | "
              f"over 200 m: {sum(1 for v in tall if v > 200)} | tallest {tall[-1]:.0f} m")
    return obj


def build_landmarks(terrain_doc: dict[str, Any], doc: dict[str, Any]) -> int:
    """One named object per landmark, never merged into the buildings mesh.

    Separate objects stay inspectable, swappable and independently hideable.
    Merging them into the 1.6 M-face `buildings` mesh would make every future
    landmark edit a surgery on a single enormous object.

    The massing here is AUTHORED. Plans, positions and heights are measured or
    cited; the vertical profile is not. See dubai-creek-landmarks.json.
    """
    if not LANDMARKS:
        return 0
    # Blender does not reliably put a --python script's own directory on
    # sys.path, so the import has to be told where its sibling lives.
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import blender_landmarks as BL

    mat = bpy.data.materials.get("concrete")
    by_id = {r["id"]: r for r in doc.get("osmB", []) if "id" in r}
    built = 0
    for osm_id, lm in LANDMARKS.items():
        rec = by_id.get(osm_id)
        if rec is None:
            raise SystemExit(
                f"landmark {lm['name']!r} names {osm_id}, which is not in the "
                f"artefact. An OSM edit may have removed or renumbered it.")
        ring = BL.open_ring(rec["p"])
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        base = sample_ground(terrain_doc, cx, cy) - 0.4
        height = float(lm["height"])
        params = lm["params"]
        verts, faces = BL.build(lm["form"], ring, base, height, params)

        name = "lm." + str(lm["name"]).lower().replace(" ", "-")
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        me.validate()
        me.update()
        ob = bpy.data.objects.new(name, me)
        if mat is not None:
            ob.data.materials.append(mat)
        bpy.context.collection.objects.link(ob)

        # The mast carries the architectural height above the enclosed mass, and
        # the helipad is the other half of the silhouette people recognise. Both
        # are optional: only a recipe that asks for them gets them.
        apex_i = params.get("apexVertex")
        if params.get("mastRadius") and apex_i is not None:
            ax, ay = ring[int(apex_i)]
            bpy.ops.mesh.primitive_cylinder_add(
                vertices=10, radius=float(params["mastRadius"]), depth=height,
                location=(ax, ay, base + height / 2))
            mast = bpy.context.object
            mast.name = name + ".mast"
            if mat is not None:
                mast.data.materials.append(mat)
        if params.get("helipadZ") and apex_i is not None:
            ax, ay = ring[int(apex_i)]
            others = [p for i, p in enumerate(ring) if i != int(apex_i)]
            mx = sum(p[0] for p in others) / len(others) - ax
            my = sum(p[1] for p in others) / len(others) - ay
            mag = math.hypot(mx, my) or 1.0
            t = (float(params["helipadZ"])) / (height * float(params.get("massFraction", 1.0)))
            reach = mag * max(0.02, 1.0 - min(1.0, t) ** float(params.get("expDepth", 2.0)))
            bpy.ops.mesh.primitive_cylinder_add(
                vertices=24, radius=float(params["helipadRadius"]), depth=2.0,
                location=(ax + mx / mag * (reach + 6.0), ay + my / mag * (reach + 6.0),
                          base + float(params["helipadZ"])))
            pad = bpy.context.object
            pad.name = name + ".helipad"
            if mat is not None:
                pad.data.materials.append(mat)

        built += 1
        print(f"  landmark {name}: {lm['form']}, {len(verts):,} verts, "
              f"{height:.0f} m ({lm['heightSource']})")
    return built


def build_apron(doc: dict[str, Any]) -> Any:
    """A large flat desert plane under and beyond the data.

    Without it the terrain tile simply ENDS and the camera sees the Nishita sky
    from below its own horizon — a hard black band across the frame that reads
    as a rendering fault. The apron sits at the site's median elevation so it
    meets the tile edge without a visible step, and carries the same sand
    material, so the city looks like it stands on a desert rather than on a
    floating slab.
    """
    size = doc["footprintM"]
    # SIT AT THE TILE EDGE, NOT THE MEDIAN. The median was fine while the window
    # was small and roughly uniform. On the coastal strip the terrain runs from
    # below sea level to inland dune, so the median sits well ABOVE the coast:
    # measured, an apron at p50 buried 50 % of the terrain and the entire
    # shoreline, leaving towers standing in flat sand. The edge median is where
    # the apron actually MEETS the tile, so it joins without a step and cannot
    # swallow the interior. Clamped below the terrain minimum as a backstop.
    n = doc["n"]
    hh = doc["h"]
    perimeter = (hh[:n] + hh[-n:]
                 + [hh[r * n] for r in range(n)] + [hh[r * n + n - 1] for r in range(n)])
    perimeter.sort()
    z = perimeter[len(perimeter) // 2] * TERRAIN_EXAG
    z = min(z, doc["dtm"]["min"] * TERRAIN_EXAG)
    # RADIUS SET BY THE HORIZON, NOT BY TASTE. A flat plane of radius r seen
    # from height z shows its edge atan(z/r) below horizontal, and the sky below
    # that is black — the hard band this apron exists to prevent. At 12x the
    # site (341 km) a 3.4 km camera still saw 0.57 deg of it. At 200x (5,690 km)
    # the edge sits 0.03 deg down, past the point any framing resolves, and the
    # ground stays continuous and sunlit rather than being faked in the world
    # shader, which was the alternative and needed HDR values fighting AgX.
    r = size * 200.0
    verts = [(-r, -r, z), (r, -r, z), (r, r, z), (-r, r, z)]
    mesh = bpy.data.meshes.new("apron")
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    mesh.update()
    obj = bpy.data.objects.new("apron", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(principled("apron", (0.30, 0.25, 0.19, 1.0), 0.96, 0.10))
    return obj


# Landcover palette. Sampled to read against the sand apron under a low sun,
# not picked from a colour wheel: water has to be clearly water from 3 km up,
# and roads have to separate from the ground without becoming black lines.
LANDCOVER = {
    "water":            ((0.045, 0.115, 0.150, 1.0), 0.12, 0.55, 0.35),
    "beach":            ((0.560, 0.480, 0.350, 1.0), 0.95, 0.05, 0.10),
    "green":            ((0.120, 0.190, 0.085, 1.0), 0.88, 0.05, 0.25),
    "golf":             ((0.135, 0.230, 0.095, 1.0), 0.85, 0.05, 0.30),
    "zone:commercial":  ((0.330, 0.320, 0.330, 1.0), 0.85, 0.08, 0.05),
    "zone:retail":      ((0.340, 0.310, 0.290, 1.0), 0.85, 0.08, 0.05),
    "zone:industrial":  ((0.300, 0.285, 0.265, 1.0), 0.90, 0.05, 0.05),
    "zone:residential": ((0.360, 0.330, 0.290, 1.0), 0.92, 0.05, 0.05),
    "road":             ((0.115, 0.110, 0.108, 1.0), 0.78, 0.10, 0.02),
}
# Draw order as height above ground, so overlapping layers do not z-fight.
LAYER_LIFT = {
    "zone:residential": 0.05, "zone:industrial": 0.06, "zone:retail": 0.07,
    "zone:commercial": 0.08, "green": 0.14, "golf": 0.15, "beach": 0.20,
    "water": 0.26, "road": 0.34,
}


def build_landcover(terrain_doc: dict[str, Any], doc: dict[str, Any]) -> list[Any]:
    """Flat polygons and road ribbons draped on the terrain.

    Each class is its own object so it can be toggled in the viewport, and each
    sits at its own small lift above ground — coincident flat faces z-fight, and
    Dubai's zones, parks and roads overlap constantly.
    """
    made: list[Any] = []
    for kind, recs in doc["layers"].items():
        if kind == "coastline":
            continue                       # a line, not an area; the water polys carry it
        style = LANDCOVER.get(kind)
        if style is None:
            continue
        rgba, rough, spec, _ = style
        lift = LAYER_LIFT.get(kind, 0.1)
        verts: list[tuple[float, float, float]] = []
        faces: list[tuple[int, ...]] = []
        for rec in recs:
            q = rec["p"]
            nv = len(q) // 2
            if nv < 2:
                continue
            if kind == "road":
                # Ribbon: offset each segment by half-width along its normal.
                half = float(rec.get("w", 6.0)) / 2.0
                for i in range(nv - 1):
                    x0, y0, x1, y1 = q[i * 2], q[i * 2 + 1], q[i * 2 + 2], q[i * 2 + 3]
                    dx, dy = x1 - x0, y1 - y0
                    length = math.hypot(dx, dy)
                    if length < 0.5:
                        continue
                    nx, ny = -dy / length * half, dx / length * half
                    start = len(verts)
                    for px, py in ((x0 + nx, y0 + ny), (x1 + nx, y1 + ny),
                                   (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)):
                        verts.append((px, py, sample_ground(terrain_doc, px, py) + lift))
                    faces.append((start, start + 1, start + 2, start + 3))
                continue
            if nv < 3:
                continue
            if abs(q[0] - q[-2]) < 1e-6 and abs(q[1] - q[-1]) < 1e-6:
                nv -= 1
            if nv < 3:
                continue
            # TESSELLATE, do not emit an n-gon. Dubai's water and zone polygons
            # are strongly concave — the Creek is a winding channel — and Blender
            # renders a concave n-gon as a fan, which threw visible spikes across
            # the frame. tessellate_polygon is ear-clipping and handles them.
            start = len(verts)
            ring2d = [Vector((q[i * 2], q[i * 2 + 1], 0.0)) for i in range(nv)]
            for i in range(nv):
                px, py = q[i * 2], q[i * 2 + 1]
                verts.append((px, py, sample_ground(terrain_doc, px, py) + lift))
            try:
                tris = tessellate_polygon([ring2d])
            except Exception:                                   # noqa: BLE001
                tris = []
            if tris:
                for tri in tris:
                    faces.append(tuple(start + int(v) for v in tri))
            else:
                faces.append(tuple(range(start, start + nv)))
        if not faces:
            continue
        mesh = bpy.data.meshes.new(kind)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(kind, mesh)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(principled(kind, rgba, rough, spec))
        made.append(obj)
        print(f"    {kind:20} {len(faces):6,} faces")
    return made


def setup_world() -> None:
    """Nishita physical sky. The sun angle drives both the light and the sky,
    so the render cannot disagree with itself about where the sun is."""
    world = bpy.data.worlds.new("sky")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new("ShaderNodeTexSky")
    # Blender 5.x renamed Nishita to MULTIPLE_SCATTERING. Pick the best physical
    # model this build offers rather than pinning an enum that moves between
    # versions — 5.2 dropped "NISHITA" outright and the script died on it.
    available = sky.bl_rna.properties["sky_type"].enum_items.keys()
    for want in ("MULTIPLE_SCATTERING", "NISHITA", "SINGLE_SCATTERING", "HOSEK_WILKIE"):
        if want in available:
            sky.sky_type = want
            break
    print(f"  sky model: {sky.sky_type}")
    for attr, value in (("sun_elevation", math.radians(SUN_ELEV_DEG)),
                        ("sun_rotation", math.radians(SUN_AZIM_DEG)),
                        ("altitude", 10.0),
                        ("air_density", 1.4),      # slight haze — Dubai is dusty
                        ("dust_density", 2.2),
                        ("sun_intensity", 0.9)):
        if hasattr(sky, attr):
            setattr(sky, attr, value)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputWorld")
    # BELOW THE HORIZON THE SKY IS BLACK, and no apron can hide it. A flat plane
    # of radius r seen from height z has its edge at atan(z/r) BELOW horizontal,
    # so there is always an angular gap between the apron edge and the true
    # horizon — measured as a hard black band across the frame, which reads as a
    # rendering fault rather than as distance. Enlarging the apron shrinks the
    # band without ever closing it.
    #
    # Fill it in the world instead: blend the sky into a hazy sand tone for rays
    # pointing downward. That is also what a desert horizon actually looks like.
    # THE DARK BAND WAS THE CAMERA'S FAR CLIP, NOT THE SKY. This was misdiagnosed
    # twice as a sky/apron problem and "fixed" in the world shader both times,
    # which only made the sky worse. The apron at size*200 puts its edge 0.01 deg
    # below horizontal — half a pixel, invisible. What actually cut the ground
    # away was clip_end at 40 km: past the clip plane there is no geometry, so
    # the black underside of the Nishita sky showed through. See setup_camera.
    #
    # The rule that falls out: clip_end > apron radius, or the band comes back.
    #
    # Substituting a ground colour in the world was tried and REVERTED: the
    # world background is also the ambient light source here, so colouring its
    # lower half dropped scene luminance from p50 0.54 to 0.03. Gating it to
    # camera rays fixed the lighting but then needed HDR radiance values fighting
    # AgX's tone curve, and blew out the sky instead. Not worth more; framing the
    # camera slightly downward avoids it entirely.
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def setup_sun() -> None:
    light = bpy.data.lights.new("sun", type="SUN")
    light.energy = 3.0
    light.angle = math.radians(1.0)      # crisp desert shadows
    obj = bpy.data.objects.new("sun", light)
    bpy.context.collection.objects.link(obj)
    el, az = math.radians(SUN_ELEV_DEG), math.radians(SUN_AZIM_DEG)
    # Direction FROM the scene TOWARD the sun, then aim the lamp back down it.
    # A SUN lamp emits along its local -Z, so hand-written Euler triples are easy
    # to get backwards — the first attempt lit the scene from underground.
    toward = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    obj.rotation_euler = (-toward).to_track_quat("-Z", "Y").to_euler()
    print(f"  sun direction {tuple(round(v, 3) for v in toward)}")


def setup_camera(target: tuple[float, float, float], pos: tuple[float, float, float],
                 lens: float = 50.0) -> None:
    cam = bpy.data.cameras.new("cam")
    cam.lens = lens
    # THE DEFAULT CLIP RANGE IS FOR ROOM-SIZED SCENES. This site is 7.68 km
    # across and the camera sits kilometres back, so the whole city fell beyond
    # clip_end and Workbench rendered a flat background — which read like a
    # camera-aim bug and cost three renders to find.
    # clip_end MUST EXCEED THE APRON RADIUS. Anything past the far clip plane
    # falls through to the Nishita sky, which is near-black below the horizon,
    # so a too-near clip_end carves a dark band across the frame that looks
    # exactly like a sky bug. Measured: at 40 km the band spanned rows 101-145
    # of a 1080p frame (luminance 76 -> 14); raising clip_end past the apron
    # held it flat at 76. The apron is size*200, so this must clear that.
    cam.clip_start, cam.clip_end = 5.0, 8_000_000.0
    obj = bpy.data.objects.new("cam", cam)
    bpy.context.collection.objects.link(obj)
    obj.location = pos
    # Aim by quaternion, NOT by a TRACK_TO constraint. The constraint version
    # rendered an empty frame headless: constraints are evaluated in the
    # depsgraph and a --background render does not necessarily resolve them
    # before the camera matrix is read. to_track_quat bakes the rotation onto
    # the object, so what is written is what renders.
    direction = Vector(target) - Vector(pos)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = obj
    print(f"  camera {tuple(round(v) for v in pos)} -> {tuple(round(v) for v in target)}"
          f"  dist {direction.length:.0f} m")


def main() -> None:
    a = args()
    global SITE
    SITE = a.get("site", "dubai-creek")
    global LANDMARKS
    LANDMARKS = load_landmarks(SITE)
    out = a.get("out", "/tmp/dubai.png")
    samples = int(a.get("samples", "48"))
    clear()
    with open(os.path.join(DATA, f"{SITE}-terrain.json")) as fh:
        terrain_doc = json.load(fh)
    with open(os.path.join(DATA, f"{SITE}-buildings.json")) as fh:
        buildings_doc = json.load(fh)
    global HEIGHT_TABLE, HEIGHT_GRID, _GRID_INDEX
    HEIGHT_TABLE = buildings_doc.get("heightTable") or {}
    HEIGHT_GRID = buildings_doc.get("heightGrid") or {}
    _GRID_INDEX = {(int(r[0]), int(r[1]), int(r[2])): float(r[3])
                   for r in HEIGHT_GRID.get("cells", [])}
    if _GRID_INDEX:
        print(f"  height prior: spatial grid, {len(_GRID_INDEX):,} cells of "
              f"{HEIGHT_GRID['cellM']:.0f} m below {HEIGHT_GRID['maxArea']:.0f} m2")
    if HEIGHT_TABLE:
        trusted = sum(1 for b in HEIGHT_TABLE["bands"] if b.get("medianM") is not None)
        print(f"  height prior: fitted table, {trusted} trusted band(s) "
              f"at or above {HEIGHT_TABLE['minArea']:.0f} m2")
    else:
        print("  height prior: no table in the artefact — using the global curve")
    build_apron(terrain_doc)
    build_terrain(terrain_doc)
    # WITH SATELLITE COLOUR, MOST LANDCOVER TINTS ARE REDUNDANT. The imagery
    # already shows parks, sand and zoning better than a flat fill can, and
    # painting over it throws away the measurement. Only water and roads still
    # earn their place: water because the flood layer needs a clean surface to
    # sit against, roads because they read as structure at city scale.
    lc_only = ({"water", "road"} if os.path.exists(os.path.join(DATA, f"{SITE}-imagery.png"))
               else None)
    lc_path = os.path.join(DATA, f"{SITE}-landcover.json")
    if os.path.exists(lc_path):
        with open(lc_path) as fh:
            print("  landcover:")
            lcdoc = json.load(fh)
            if lc_only is not None:
                lcdoc["layers"] = {k: v for k, v in lcdoc["layers"].items() if k in lc_only}
            build_landcover(terrain_doc, lcdoc)
    build_buildings(terrain_doc, buildings_doc)
    build_landmarks(terrain_doc, buildings_doc)
    setup_world()
    setup_sun()
    # Landmarks in site-local metres, so a shot can be named rather than guessed.
    # Burj Khalifa sits near (-1571, -4179); the Creek runs through the north-east.
    def triple(key: str, default: tuple[float, float, float]) -> tuple[float, float, float]:
        raw = a.get(key)
        if not raw:
            return default
        parts = [float(v) for v in raw.split(",")]
        return (parts[0], parts[1], parts[2])

    setup_camera(target=triple("target", (-1400.0, -3600.0, 260.0)),
                 pos=triple("cam", (2600.0, 1400.0, 1150.0)),
                 lens=float(a.get("lens", "50")))
    bpy.context.view_layer.update()
    for name in ("terrain", "buildings"):
        o = bpy.data.objects[name]
        zs = [(o.matrix_world @ Vector(c)).z for c in o.bound_box]
        print(f"  {name}: z {min(zs):.1f}..{max(zs):.1f}, faces {len(o.data.polygons):,}")
    print(f"  terrain mid-face normal "
          f"{tuple(round(v, 3) for v in bpy.data.objects['terrain'].data.polygons[32768].normal)}")

    scene = bpy.context.scene
    # WORKBENCH is the diagnostic escape hatch: flat shading, no lights, no
    # world. If the city shows there and not in Cycles, the problem is lighting
    # rather than camera or geometry — which is exactly the ambiguity that cost
    # two blank renders.
    engine = a.get("engine", "CYCLES").upper()
    scene.render.engine = "BLENDER_WORKBENCH" if engine == "WORKBENCH" else "CYCLES"
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = a.get("look", "AgX - Punchy")
    scene.view_settings.exposure = float(
        a.get("exposure", str(SITE_EXPOSURE.get(SITE, -4.0))))
    scene.render.filepath = out
    # THE 3D VIEWPORT HAS ITS OWN CLIP RANGE, separate from the camera's.
    # Fixing camera.clip_end fixes the RENDER and leaves the interactive view
    # slicing the city into a band that follows you as you orbit — near and far
    # both cut away. Anyone opening this .blend hits it immediately, so set it
    # in the file rather than making them find View > Clip Start/End.
    fixed = 0
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    space.clip_start, space.clip_end = 5.0, 8_000_000.0
                    fixed += 1
    print(f"  viewport clip set on {fixed} 3D view(s): 5 m .. 8000 km")

    blend = a.get("blend")
    if blend:
        # PACK TEXTURES BEFORE SAVING. Blender stores image paths RELATIVE to
        # the .blend, so a scene saved in /tmp and later moved to public/models
        # resolved its texture to `public/models/../Volumes/...` — nonsense, and
        # the terrain rendered magenta with no error anywhere. Packing embeds
        # the pixels, so the committed scene is portable across checkouts.
        try:
            bpy.ops.file.pack_all()
        except Exception as exc:                                # noqa: BLE001
            print(f"  WARNING: could not pack textures ({exc}) — the .blend "
                  f"will depend on absolute paths")
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(blend), compress=True)
        print(f"  saved {blend} — open this in the GUI to inspect or tweak")
    print(f"  rendering {samples} samples -> {out}")
    bpy.ops.render.render(write_still=True)

    # Report exposure numerically. Eyeballing every iteration was slow and the
    # first two renders were a blank sky and a black frame, neither of which was
    # obvious from the log.
    img = bpy.data.images.load(out)
    px = list(img.pixels)
    lum = [0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
           for i in range(0, len(px), 4 * 97)]
    lum.sort()

    def q(f: float) -> float:
        return float(lum[int(f * (len(lum) - 1))])

    print(f"  luminance p05 {q(0.05):.3f}  p50 {q(0.5):.3f}  p95 {q(0.95):.3f}  "
          f"(a usable frame wants p50 roughly 0.15-0.45)")


main()
