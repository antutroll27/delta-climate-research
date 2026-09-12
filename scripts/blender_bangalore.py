"""Build a Bangalore ward scene in Blender and render it with Cycles.

ONE .BLEND PER WARD, at the founder's direction. The three wards share nothing
but this script -- different terrain, different building sets, different
exposure -- so a combined file would only be three scenes in one container, with
every save rewriting all three.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python scripts/blender_bangalore.py -- --ward indiranagar

    ... --ward all --samples 128          # all three, production samples
    ... --ward mg-road --qa               # QA lens: tint what we do not know
    ... --ward all --webglb 1 --render 0  # web GLBs only, no Cycles render

`--render 0` exists because the web GLB is written BEFORE the render and does
not need it. Dropping the samples and the resolution to make the render cheap
would have worked too -- and would have saved those cheap values INTO the
.blend, since configure_render deliberately runs before save_as_mainfile, so
the file on disk would open at 4 samples and 400 px. Skipping the picture keeps
the file's settings and the picture honest.

Coordinates: site-local metres, x east / y north / z up -- Blender's own
convention and the one the artefacts already use, so nothing is transposed.

TERRAIN IS NOT EXAGGERATED BY DEFAULT, and that is a change from the Dubai
scenes. Dubai's coast is nearly flat, so `TERRAIN_EXAG = 3.0` was the only way
to see its form at all. Bengaluru has 49-63 m of real relief across every ward
box -- a genuine valley-and-tank-chain landscape that reads at 1:1. Multiplying
it would misstate the slope in a render whose whole argument is that the terrain
does real thermal work here. `--exag` still overrides for look-dev, and anything
above 1.0 is a look choice that must be labelled as one.

THE QA LENS. `--qa` is why this script exists at all rather than only the web
view. It colours every building by WHERE ITS HEIGHT CAME FROM, best evidence
first: blue for a published figure, green for a survey tag, pale green for a
storey count times a fitted constant, grey for the zonal statistic, near-black
where there was no confident pixel at all. That is the console-and-disc
argument made visible -- the engine is ours, and the picture says exactly how
good the disc is, without anyone having to take it on trust.

Automated gates prove a scene is well-formed; only looking at it proves the
city is there. The Dubai work learned that the expensive way -- a landmark
rendered as a tent while every check passed.

NAMED LANDMARKS ARE THEIR OWN OBJECTS. A building carrying a cited height is
drawn as `lm.<slug>` rather than as one prism among eleven thousand in a single
mesh, and carries `height_m` and `height_source` as custom properties. A
landmark nobody can select is a landmark nobody can check, and the height a
render asserts should be readable from inside the file rather than only from
the JSON that built it.
"""
from __future__ import annotations

# bpy/mathutils ship no stubs and exist only inside Blender, so every signature
# touching them is annotated against `Any`. The alternative is hand-written stubs
# for a script that runs in one place and never imports into the pipeline.

import json
import math
import os
import random
import sys
from typing import Any

import bmesh  # type: ignore[import-not-found]
import bpy  # type: ignore[import-not-found]
from mathutils.geometry import tessellate_polygon  # type: ignore[import-not-found]

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
DATA = os.path.join(ROOT, "data", "bangalore")
SCENES = os.path.join(DATA, "scenes")

TERRAIN_EXAG = 1.0

#: Late afternoon at ~12.97 N in March: long shadows across the fabric without
#: the sun sitting so low that half the ward is in shade. Azimuth is west of
#: south, so shadows fall east-north-east.
SUN_ELEV_DEG = 32.0
SUN_AZIM_DEG = 285.0
SUN_STRENGTH = 4.0

#: Buildings are sunk this far into the ground so a footprint on a slope does not
#: float on its downhill edge. The terrain mesh is 29 m-posted, so a building is
#: almost always smaller than one cell and its base is a single sampled height.
BASE_SINK_M = 0.4

#: Smaller than any real building; drops Overture slivers that survive the
#: fetcher's own area filter after rounding to centimetres.
MIN_AREA_M2 = 8.0

#: Per-ward film exposure. EXPOSURE IS A PROPERTY OF THE SURFACE, NOT A TASTE
#: CHOICE -- the same lesson the Dubai scenes recorded, where one value could not
#: serve both bare desert and a built coastal strip. These are starting points
#: for the same luminance-quantile sweep; --exposure overrides.
WARD_EXPOSURE = {"indiranagar": -3.8, "mg-road": -3.8, "whitefield": -3.6}

#: Master-scene layout, WEST TO EAST. The islands do not sit at their true
#: geographic offsets -- that was tried and rejected: 4.11 km between Indiranagar
#: and MG Road against 11.88 km to Whitefield puts two wards nearly touching and
#: the third a long way off, and the empty ground between them carries no data.
#: Keeping the west-east ORDER preserves the only part of the real arrangement
#: worth reading at a glance, while the even spacing makes the three comparable.
MASTER_ORDER = ["mg-road", "indiranagar", "whitefield"]
MASTER_GAP_M = 1_000.0

#: Sky HDRI, if one has been fetched. CC0 from Poly Haven; the file name states
#: the sun's elevation, and the actual sun is FOUND IN THE IMAGE rather than
#: trusted from the name, so the shadow-casting lamp always matches the sky.
HDRI_DIR = os.path.join(DATA, "raw", "hdri")

#: Drawn carriageway widths, metres, by Overture class. Kerb to kerb, roughly:
#: a Bengaluru residential street is 6-7 m and an arterial 4-lane is ~14 m.
ROAD_WIDTH_M = {"motorway": 24.0, "trunk": 18.0, "primary": 14.0,
                "secondary": 11.0, "tertiary": 8.0, "residential": 6.0,
                "unclassified": 6.0, "living_street": 5.0, "service": 3.5,
                "pedestrian": 4.0}

#: How far each ground layer floats above the terrain. Ordered so a road over a
#: park, or a pond inside one, resolves the right way instead of z-fighting.
LIFT_GREEN_M = 0.10
LIFT_WATER_M = 0.25
LIFT_ROAD_M = 0.35
STREAM_WIDTH_M = 3.0

#: Trees are INSTANCED, not modelled one by one. A ward carries tens of
#: thousands, and the master three wards' worth. Each bucket below becomes one
#: template tree, sized to the bucket's mean height and crown, duplicated onto
#: a vertex cloud with one vertex per tree. The .blend stays small, the
#: viewport stays interactive, and the render cost is one mesh per bucket.
#: Height varies at bucket resolution, which at this scale is what the eye
#: resolves anyway.
TREE_BUCKETS_M = [(2.0, 4.0), (4.0, 7.0), (7.0, 11.0), (11.0, 16.0),
                  (16.0, 22.0), (22.0, 80.0)]

#: THE QA LENS COLOURS BY WHAT WE KNOW, NOT BY WHAT THINGS ARE MADE OF. One
#: slot per height tier, in descending order of evidence. This is the founder's
#: console-and-disc argument made visible: the engine is ours, and the picture
#: shows exactly how good the disc is. A room can see at a glance that five
#: buildings carry a published figure, that a couple of thousand carry a survey
#: tag, and that the rest are a model.
QA_TIERS = [
    ("cited",      (0.05, 0.42, 0.95, 1.0)),   # a published figure
    ("osm-height", (0.10, 0.72, 0.55, 1.0)),   # a stated survey measurement
    ("osm-levels", (0.55, 0.80, 0.20, 1.0)),   # storeys x a fitted constant
    ("google",     (0.62, 0.60, 0.56, 1.0)),   # the zonal statistic
    ("fill",       (0.24, 0.22, 0.21, 1.0)),   # no confident pixel: a convention
]

#: Notable buildings are ALSO drawn as their own named object, so UB Tower can
#: be clicked in the outliner instead of being one prism among 11,045 in a
#: single mesh. Dubai does the same with its `lm.` prefix, and the reason is the
#: same: a landmark nobody can select is a landmark nobody can check.
#:
#: A building qualifies if it is NAMED, its height is MEASURED rather than
#: modelled, and it is either cited or at least LANDMARK_MIN_H tall. Cited
#: buildings qualify at any height, because a published figure is the point --
#: Vidhana Soudha is 45.7 m and matters more than a 60 m office slab.
#:
#: The tier is NOT in the name, it is a property on the object. Naming it
#: `lm.cited.ub-tower` would bake today's evidence into an identifier that a
#: better source is supposed to change.
LANDMARK_PREFIX = "lm."
LANDMARK_MIN_H = 40.0

#: Distinct crown shapes per height bucket, so 27,000 trees are not one silhouette
#: repeated 27,000 times. Six buckets x three variants is eighteen shapes for
#: eighteen 112-triangle meshes -- the cost is nil and the repetition goes.
TREE_VARIANTS = 3

#: Scanned tree models, CC0 from Poly Haven, fetched into data/bangalore/raw/
#: trees/<id>/ by the one-off in the commit that introduced them. One model per
#: bucket, chosen by stature: the small broadleaf for street trees, the island
#: trees for the mid-canopy, and jacaranda -- a genuine Bengaluru avenue tree
#: -- for the tall buckets. The model is scaled uniformly so its own height
#: equals the bucket's mean canopy height, so the crown width follows the
#: scan's proportions rather than the 0.35 h display heuristic.
TREE_DIR = os.path.join(DATA, "raw", "trees")

#: Triangle budgets per imported model, SPLIT BY WHAT THE GEOMETRY IS.
#:
#: The scans are 1-4 M triangles each and most of that is foliage: jacaranda is
#: 2.40 M triangles of leaves, 1.23 M of branches, 0.23 M of trunk. A single
#: collapse-decimate pass over the whole mesh was the first attempt and it
#: STRIPPED THE TREES BARE -- a leaf is an alpha-textured quad, and collapsing
#: quads merges them into slivers whose UVs no longer map to a leaf. The
#: close-up probe showed branches with a few green flecks.
#:
#: So the two are reduced by different means. Leaves are thinned by DELETING
#: WHOLE CARDS at random, which keeps every surviving leaf perfectly textured
#: and just makes the canopy sparser. Branches and trunk are collapse-decimated,
#: which is what that algorithm is good at. Deterministic: the leaf drop is
#: seeded per model id, so a rebuild produces the same tree.
HQ_LEAF_TRIS = 14_000
HQ_SOLID_TRIS = 11_000
#: Chosen so no scan is scaled beyond 0.7-1.8x its own height. Measured
#: natural heights: island_tree_03 2.6 m, island_tree_02 3.4 m, tree_small_02
#: 4.5 m, island_tree_01 5.0 m, jacaranda 19.4 m. The first mapping put the
#: 3.4 m scan into the 11-16 m bucket -- a shrub blown up four times, with a
#: shrub's proportions. Jacaranda carries every tall bucket instead.
HQ_TREE_BY_BUCKET = {(2.0, 4.0): "island_tree_03", (4.0, 7.0): "tree_small_02",
                     (7.0, 11.0): "island_tree_01", (11.0, 16.0): "jacaranda_tree",
                     (16.0, 22.0): "jacaranda_tree", (22.0, 80.0): "jacaranda_tree"}

#: Which collection each object goes in, matched on a fragment of its name. A
#: master scene holds forty-odd objects across three wards, and a flat outliner
#: makes the file something to endure rather than use -- hiding the trees to
#: check a facade should be one click, not a hunt through
#: `whitefield-trees-11-16m-v2`. Ordered: the FIRST match wins, so Landmarks is
#: listed before Buildings even though `lm.ub-tower` matches neither by accident.
COLLECTIONS: list[tuple[str, tuple[str, ...]]] = [
    ("Landmarks", (LANDMARK_PREFIX,)),
    ("Buildings", ("-buildings",)),
    ("Vegetation", ("-trees", "-tree-", "-green")),
    ("Water", ("-water", "-streams")),
    ("Roads", ("-roads",)),
    ("Ground", ("-ground",)),
    ("Lighting", ("sun", "camera", "look-at")),
]


def organise_collections() -> None:
    """Sort the scene into named collections, by object-name fragment.

    Runs once, immediately before the save, over whatever the builders made --
    so a new layer lands in the right place by naming itself consistently
    rather than by registering anywhere. Anything unmatched STAYS WHERE IT IS
    rather than being swept into a bucket that hides it: an object nobody
    thought about should be visible, not filed away.
    """
    scene_coll = bpy.context.scene.collection
    made: dict[str, Any] = {}
    for ob in list(bpy.data.objects):
        target = None
        for coll_name, fragments in COLLECTIONS:
            if any(f in ob.name for f in fragments):
                target = coll_name
                break
        if target is None:
            continue
        if target not in made:
            made[target] = bpy.data.collections.new(target)
            scene_coll.children.link(made[target])
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        made[target].objects.link(ob)
    if made:
        print("  collections: " + ", ".join(
            f"{k} {len(v.objects)}" for k, v in made.items()))


def args() -> dict[str, str]:
    """Everything after the `--` Blender itself stops reading at."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out: dict[str, str] = {}
    i = 0
    while i < len(argv):
        if argv[i].startswith("--"):
            key = argv[i][2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                out[key] = argv[i + 1]
                i += 2
            else:
                out[key] = "1"
                i += 1
        else:
            i += 1
    return out


def clear() -> None:
    """Empty the file. --background still opens the startup scene with a cube.

    THE MODEL CACHE IS EMPTIED HERE TOO. It is module-level and outlives the
    scene, but the Objects it holds do not: the factory reset destroys them,
    and the next ward's `src.copy()` raised "StructRNA of type Object has been
    removed". That killed a three-ward regeneration after its first ward, while
    the master -- one scene, one reset -- sailed through. Re-importing per ward
    costs ~75 s each; a dangling reference costs the run.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _HQ_CACHE.clear()


def principled(name: str, rgba: tuple[float, float, float, float],
               rough: float = 0.6, metal: float = 0.0) -> Any:
    """A Principled BSDF material.

    Sockets are addressed BY NAME and guarded, because Blender renamed several
    of them at 4.0 ("Specular" -> "Specular IOR Level") and this script has to
    survive the next rename too. A missing socket is a look regression; a hard
    KeyError is a broken build.
    """
    # Reuse by name. The master builds three wards into one scene, and without
    # this each gets its own copy -- building, building.001, building.002 --
    # which is nine materials where three carry every property that matters.
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        return mat
    for socket, value in (("Base Color", rgba), ("Roughness", rough),
                          ("Metallic", metal)):
        if socket in bsdf.inputs:
            bsdf.inputs[socket].default_value = value
    return mat


def mesh_object(name: str, verts: list[tuple[float, float, float]],
                faces: list[tuple[int, ...]], mats: list[Any]) -> Any:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    for m in mats:
        obj.data.materials.append(m)
    bpy.context.collection.objects.link(obj)
    return obj


# ── terrain ─────────────────────────────────────────────────────────────────

def load(ward: str, kind: str) -> dict[str, Any]:
    path = os.path.join(DATA, f"{ward}-{kind}.json")
    if not os.path.exists(path):
        raise SystemExit(f"missing {path} -- run scripts/fetch-bangalore.py first")
    with open(path, encoding="utf-8") as fh:
        return dict(json.load(fh))


def load_terrain(ward: str) -> tuple[dict[str, Any], bool]:
    """Prefer the 8.4 km context mesh over the 2.8 km ward mesh.

    Both are real GLO-30 at the same ~29 m posting, so the wider one is strictly
    more ground for the same fidelity -- it just keeps the ward from ending in a
    hard silhouette against the sky. Buildings still stop at the ward edge;
    only the terrain continues, so nothing is drawn that was not measured.
    """
    ctx = os.path.join(DATA, f"{ward}-terrain-context.json")
    if os.path.exists(ctx):
        with open(ctx, encoding="utf-8") as fh:
            return dict(json.load(fh)), True
    return load(ward, "terrain"), False


def sample_ground(terrain: dict[str, Any], x: float, y: float) -> float:
    """Bilinear ground height at a local-metre point.

    NEAREST-NEIGHBOUR WOULD TERRACE THE SCENE. The mesh is 29 m-posted and a
    ward holds thousands of buildings, so snapping each base to its cell centre
    puts visible 29 m steps through every street. Bilinear costs four lookups.
    """
    n = int(terrain["n"])
    size = float(terrain["sizeM"])
    h = terrain["h"]
    # local metres -> grid coordinates. Row 0 is the SOUTH edge (the fetcher
    # flipped GLO-30's north-up array), so +y maps to increasing row.
    gx = (x + size / 2.0) / size * (n - 1)
    gy = (y + size / 2.0) / size * (n - 1)
    gx = min(max(gx, 0.0), n - 1.0)
    gy = min(max(gy, 0.0), n - 1.0)
    x0, y0 = int(gx), int(gy)
    x1, y1 = min(x0 + 1, n - 1), min(y0 + 1, n - 1)
    fx, fy = gx - x0, gy - y0
    h00 = float(h[y0 * n + x0]); h10 = float(h[y0 * n + x1])
    h01 = float(h[y1 * n + x0]); h11 = float(h[y1 * n + x1])
    return ((h00 * (1 - fx) + h10 * fx) * (1 - fy)
            + (h01 * (1 - fx) + h11 * fx) * fy)


def build_terrain(terrain: dict[str, Any], exag: float, datum: float,
                  name: str = "terrain",
                  offset: tuple[float, float] = (0.0, 0.0),
                  island: bool = False, depth: float = 320.0) -> Any:
    """The ward's ground, optionally as a free-standing island.

    AN ISLAND IS A CLOSED SOLID, NOT A DRAPED SHEET. The plain grid is an open
    surface: seen from below or from a low angle it is a paper-thin plane with
    nothing underneath, which reads as a bug rather than as a choice. The island
    adds a skirt down every boundary edge and a base cap, so each ward becomes a
    diorama plinth that can be lit, shadowed and orbited from any angle.

    NOTHING ABOUT THE GROUND SURFACE CHANGES. The skirt hangs below the lowest
    real sample and the top face is the same measured GLO-30 mesh it always was,
    so the island is packaging, not new landform.
    """
    n = int(terrain["n"])
    size = float(terrain["sizeM"])
    h = terrain["h"]
    ox, oy = offset
    verts: list[tuple[float, float, float]] = []
    for j in range(n):
        for i in range(n):
            x = -size / 2.0 + size * i / (n - 1)
            y = -size / 2.0 + size * j / (n - 1)
            verts.append((x + ox, y + oy, (float(h[j * n + i]) - datum) * exag))
    faces: list[tuple[int, ...]] = []
    slots: list[int] = []
    for j in range(n - 1):
        for i in range(n - 1):
            a = j * n + i
            faces.append((a, a + 1, a + n + 1, a + n))
            slots.append(0)

    mats = [principled("ground", (0.20, 0.19, 0.16, 1.0), rough=0.95)]
    if island:
        mats.append(principled("plinth", (0.13, 0.12, 0.11, 1.0), rough=0.9))
        base = min(v[2] for v in verts) - depth
        # The boundary ring, walked in order so the skirt quads are consistently
        # wound. Corners appear once: south edge west->east, east edge south->
        # north, north edge east->west, west edge north->south.
        ring: list[int] = []
        ring += [0 * n + i for i in range(n)]
        ring += [j * n + (n - 1) for j in range(1, n)]
        ring += [(n - 1) * n + i for i in range(n - 2, -1, -1)]
        ring += [j * n + 0 for j in range(n - 2, 0, -1)]
        skirt_start = len(verts)
        for idx in ring:
            verts.append((verts[idx][0], verts[idx][1], base))
        m = len(ring)
        for k in range(m):
            a0, a1 = ring[k], ring[(k + 1) % m]
            b0, b1 = skirt_start + k, skirt_start + (k + 1) % m
            faces.append((a0, b0, b1, a1))
            slots.append(1)
        faces.append(tuple(range(skirt_start + m - 1, skirt_start - 1, -1)))
        slots.append(1)

    obj = mesh_object(name, verts, faces, mats)
    if island and len(obj.data.polygons) == len(slots):
        for poly, sl in zip(obj.data.polygons, slots):
            poly.material_index = sl
    # Shade the TOP smooth only. Smoothing the skirt rounds the plinth corners
    # into a blob and loses the crisp edge that makes it read as a plinth.
    for poly in obj.data.polygons:
        poly.use_smooth = poly.material_index == 0
    return obj


# ── buildings ───────────────────────────────────────────────────────────────

def build_buildings(terrain: dict[str, Any], doc: dict[str, Any],
                    exag: float, datum: float, qa: bool,
                    name: str = "buildings",
                    offset: tuple[float, float] = (0.0, 0.0)
                    ) -> tuple[Any, dict[str, int]]:
    """One mesh for every footprint. Blender takes n-gons, so a cap face per
    ring plus a quad per edge is the whole job -- no roof triangulation."""
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    slots: list[int] = []
    ox, oy = offset
    stats = {"drawn": 0, "tiny": 0, "flagged": 0, "filled": 0, "landmarks": 0}
    tier_index = {t: i for i, (t, _) in enumerate(QA_TIERS)}
    landmarks: list[tuple[str, dict[str, Any]]] = []

    for b in doc["b"]:
        p = b["p"]
        nv = len(p) // 2
        # Rings from the fetcher do not repeat the first vertex, but a hand-made
        # or re-exported file might. A repeated vertex makes the cap degenerate.
        if nv >= 3 and abs(p[0] - p[-2]) < 1e-6 and abs(p[1] - p[-1]) < 1e-6:
            nv -= 1
        if nv < 3:
            stats["tiny"] += 1
            continue

        area = 0.0
        for i in range(nv):
            j = (i + 1) % nv
            area += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]
        if abs(area) / 2.0 < MIN_AREA_M2:
            stats["tiny"] += 1
            continue

        cx = sum(p[i * 2] for i in range(nv)) / nv
        cy = sum(p[i * 2 + 1] for i in range(nv)) / nv
        base = (sample_ground(terrain, cx, cy) - datum) * exag - BASE_SINK_M
        # HEIGHT IS NOT EXAGGERATED EVEN WHEN TERRAIN IS. A building is a
        # measured quantity; the terrain multiplier is a viewing choice. Scaling
        # both would make a 20 m building read as 60 m at --exag 3.
        top = base + max(2.0, float(b["h"]))

        if b.get("flag"):
            stats["flagged"] += 1
        if b.get("fill"):
            stats["filled"] += 1

        src = str(b.get("hSource", "google"))
        slot = tier_index.get(src, tier_index["google"]) if qa else 0

        # A notable building becomes its own object as well. It is EXCLUDED
        # from the bulk mesh rather than drawn twice, which would leave two
        # coincident prisms z-fighting on every face.
        measured = src in ("cited", "osm-height", "osm-levels")
        if (b.get("name") and measured
                and (src == "cited" or float(b["h"]) >= LANDMARK_MIN_H)):
            landmarks.append((str(b["name"]), b))
            stats["landmarks"] += 1
            continue

        start = len(verts)
        for i in range(nv):
            verts.append((p[i * 2] + ox, p[i * 2 + 1] + oy, base))
        for i in range(nv):
            verts.append((p[i * 2] + ox, p[i * 2 + 1] + oy, top))
        for i in range(nv):
            a0, a1 = start + i, start + (i + 1) % nv
            faces.append((a0, a1, a1 + nv, a0 + nv))
            slots.append(slot)
        faces.append(tuple(start + nv + i for i in range(nv)))
        slots.append(slot)
        stats["drawn"] += 1

    if qa:
        mats = [principled(f"qa-{t}", c, rough=0.7) for t, c in QA_TIERS]
    else:
        mats = [principled("building", (0.52, 0.50, 0.47, 1.0), rough=0.75)]

    obj = mesh_object(name, verts, faces, mats)
    if qa and len(obj.data.polygons) == len(slots):
        for poly, s in zip(obj.data.polygons, slots):
            poly.material_index = s

    # ── cited buildings, each as its own named, selectable object ──
    lm_mat = (mats[tier_index["cited"]] if qa
              else principled("landmark", (0.72, 0.70, 0.66, 1.0), rough=0.55))
    for lname, b in landmarks:
        p = b["p"]
        nv = len(p) // 2
        if nv >= 3 and abs(p[0] - p[-2]) < 1e-6 and abs(p[1] - p[-1]) < 1e-6:
            nv -= 1
        cx = sum(p[i * 2] for i in range(nv)) / nv
        cy = sum(p[i * 2 + 1] for i in range(nv)) / nv
        base = (sample_ground(terrain, cx, cy) - datum) * exag - BASE_SINK_M
        top = base + max(2.0, float(b["h"]))
        lv: list[tuple[float, float, float]] = []
        lf: list[tuple[int, ...]] = []
        for i in range(nv):
            lv.append((p[i * 2] + ox, p[i * 2 + 1] + oy, base))
        for i in range(nv):
            lv.append((p[i * 2] + ox, p[i * 2 + 1] + oy, top))
        for i in range(nv):
            a0, a1 = i, (i + 1) % nv
            lf.append((a0, a1, a1 + nv, a0 + nv))
        lf.append(tuple(nv + i for i in range(nv)))
        slug = "".join(ch if ch.isalnum() else "-" for ch in lname.lower()).strip("-")
        lo = mesh_object(f"{LANDMARK_PREFIX}{slug}", lv, lf, [lm_mat])
        # The provenance travels WITH the object, so anyone who opens the file
        # can read where the height came from without going back to the JSON.
        lo["height_m"] = float(b["h"])
        lo["height_tier"] = str(b.get("hSource", "?"))
        lo["height_source"] = str(b.get("heightSourceCite")
                                  or ("OSM height tag" if b.get("hSource") == "osm-height"
                                      else f"OSM building:levels={b.get('levels', '?')}"))
        if "heightConflict" in b:
            lo["height_conflict"] = json.dumps(b["heightConflict"])
        if b.get("hSource") == "cited":
            print(f"    {LANDMARK_PREFIX}{slug}: {float(b['h']):.1f} m "
                  f"({b.get('heightSourceCite', '?')})")
    return obj, stats


# ── context: green, water, roads ────────────────────────────────────────────

def load_optional(ward: str, kind: str) -> dict[str, Any] | None:
    path = os.path.join(DATA, f"{ward}-{kind}.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return dict(json.load(fh))


def ground_z(terrain: dict[str, Any], exag: float, datum: float,
             x: float, y: float) -> float:
    return (sample_ground(terrain, x, y) - datum) * exag


def build_polygons(name: str, feats: list[dict[str, Any]], terrain: dict[str, Any],
                   exag: float, datum: float, offset: tuple[float, float],
                   lift: float, mat: Any) -> int:
    """Flat features draped on the ground: parks and water bodies.

    DRAPED PER VERTEX, NOT SET TO ONE HEIGHT. A real lake is flat, but the
    30 m terrain does not resolve its bed, so a lake at one elevation would
    either float above the ground on one side or vanish into it on the other.
    Following the ground at every vertex keeps it visible from the air, which
    is the view that matters here, at the cost of a slope no one can see.

    TRIANGULATED, because these rings are concave -- a park wrapping a
    building, a lake with a bay -- and a concave n-gon renders with faces
    bridging across the concavity.
    """
    ox, oy = offset
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for f in feats:
        p = f.get("p")
        if not p:
            continue
        ring = [(p[i], p[i + 1], 0.0) for i in range(0, len(p) - 1, 2)]
        if len(ring) < 3:
            continue
        start = len(verts)
        for x, y, _ in ring:
            verts.append((x + ox, y + oy,
                          ground_z(terrain, exag, datum, x, y) + lift))
        for tri in tessellate_polygon([ring]):
            faces.append(tuple(start + i for i in tri))
    if not faces:
        return 0
    mesh_object(name, verts, faces, [mat])
    return len(feats)


def build_ribbons(name: str, feats: list[dict[str, Any]], terrain: dict[str, Any],
                  exag: float, datum: float, offset: tuple[float, float],
                  lift: float, width_of: Any, mat: Any) -> int:
    """Polylines as flat ribbons of a given width: roads and streams.

    One quad per segment, offset by the segment normal. Joints are not
    mitred, so consecutive quads overlap slightly at bends. From the air, with
    one material, that overlap is invisible, and mitring 40,000 joints is not
    worth a single pixel it would change.
    """
    ox, oy = offset
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    drawn = 0
    for f in feats:
        ln = f.get("line")
        if not ln:
            continue
        half = float(width_of(f)) / 2.0
        pts = [(ln[i], ln[i + 1]) for i in range(0, len(ln) - 1, 2)]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            dx, dy = x1 - x0, y1 - y0
            seg = math.hypot(dx, dy)
            if seg < 0.5:
                continue
            nx, ny = -dy / seg * half, dx / seg * half
            start = len(verts)
            for x, y in ((x0 + nx, y0 + ny), (x0 - nx, y0 - ny),
                         (x1 - nx, y1 - ny), (x1 + nx, y1 + ny)):
                verts.append((x + ox, y + oy,
                              ground_z(terrain, exag, datum, x, y) + lift))
            faces.append((start, start + 1, start + 2, start + 3))
        drawn += 1
    if not faces:
        return 0
    mesh_object(name, verts, faces, [mat])
    return drawn


def build_context(ward: str, ctx: dict[str, Any], terrain: dict[str, Any],
                  exag: float, datum: float,
                  offset: tuple[float, float]) -> dict[str, int]:
    green_mat = principled("green", (0.10, 0.16, 0.05, 1.0), rough=0.92)
    water_mat = principled("water", (0.02, 0.07, 0.09, 1.0), rough=0.06)
    road_mat = principled("road", (0.05, 0.05, 0.055, 1.0), rough=0.88)

    n_green = build_polygons(f"{ward}-green", ctx.get("green", []), terrain,
                             exag, datum, offset, LIFT_GREEN_M, green_mat)
    water = ctx.get("water", [])
    n_water = build_polygons(f"{ward}-water", [w for w in water if "p" in w],
                             terrain, exag, datum, offset, LIFT_WATER_M, water_mat)
    n_stream = build_ribbons(f"{ward}-streams", [w for w in water if "line" in w],
                             terrain, exag, datum, offset, LIFT_WATER_M,
                             lambda _f: STREAM_WIDTH_M, water_mat)
    n_road = build_ribbons(f"{ward}-roads", ctx.get("roads", []), terrain,
                           exag, datum, offset, LIFT_ROAD_M,
                           lambda f: ROAD_WIDTH_M.get(str(f.get("cls")), 5.0),
                           road_mat)
    return {"green": n_green, "water": n_water, "streams": n_stream, "roads": n_road}


# ── canopy ──────────────────────────────────────────────────────────────────

def tree_template(name: str, h: float, r: float, mats: list[Any],
                  seed: int = 0, lobes: int = 5) -> Any:
    """A stylised tree: a tapered trunk under several overlapping crown lobes.

    ONE ICOSPHERE WAS A BALL ON A STICK. Five overlapping lobes at deterministic
    offsets cost 112 triangles instead of 32 and give an irregular silhouette
    that reads as a crown rather than a die. `seed` varies the lobe placement,
    so a bucket can carry several distinct shapes and a street does not repeat.

    THE FIRST VERSION PUT THE TRUNK ABOVE THE CROWN. It selected crown vertices
    with `bm.verts[-42:]`, and a BMesh sequence sliced from a negative index
    returns EVERY vertex, so the crown's height offset lifted the trunk too.
    Each operator returns the geometry it made; that is what is used here, and
    nothing is sliced.
    """
    rng = random.Random(seed)
    bm = bmesh.new()
    trunk_r = max(0.15, 0.035 * h)
    trunk_h = max(0.5, h - r * 1.0)
    cone = bmesh.ops.create_cone(bm, cap_ends=False, segments=6, radius1=trunk_r,
                                 radius2=trunk_r * 0.7, depth=trunk_h)
    for v in cone["verts"]:
        v.co.z += trunk_h / 2.0            # base at z = 0
    solid = set(cone["verts"])
    cz = h - r * 0.9
    for i in range(lobes):
        lobe_r = r * (0.52 + 0.30 * rng.random())
        ang = 2 * math.pi * i / lobes + rng.random() * 0.6
        rad = 0.0 if i == 0 else r * 0.42 * rng.random()
        ox, oy = rad * math.cos(ang), rad * math.sin(ang)
        oz = cz + r * (0.34 * rng.random() - 0.10) + (r * 0.30 if i == 0 else 0.0)
        ico = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=lobe_r)
        for v in ico["verts"]:
            v.co.x += ox
            v.co.y += oy
            v.co.z = v.co.z * 0.82 + oz    # squashed: crowns are wider than tall
    for f in bm.faces:
        f.material_index = 0 if all(v in solid for v in f.verts) else 1
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    for m in mats:
        obj.data.materials.append(m)
    bpy.context.collection.objects.link(obj)
    return obj


_HQ_CACHE: dict[str, Any] = {}


def import_hq_tree(model_id: str) -> Any | None:
    """Import a Poly Haven glTF once, join it to one mesh, base it at the origin.

    Returns the source object (unlinked from any collection -- it is only ever
    copied into bucket templates), or None if the model is not on disk, in
    which case the caller falls back to the low-poly tree for that bucket.

    NORMALISED, NOT TRUSTED. The scan's origin is wherever the artist left it,
    so the joined mesh is moved so its lowest point sits at z = 0 and its
    footprint centres on the origin. The height is measured from the mesh and
    stored on the object, because the bucket scale is computed from it.
    """
    if model_id in _HQ_CACHE:
        return _HQ_CACHE[model_id]
    d = os.path.join(TREE_DIR, model_id)
    gltfs = [f for f in os.listdir(d)] if os.path.isdir(d) else []
    gltfs = [f for f in gltfs if f.lower().endswith((".gltf", ".glb"))]
    if not gltfs:
        _HQ_CACHE[model_id] = None
        return None
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(d, gltfs[0]))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    if not meshes:
        _HQ_CACHE[model_id] = None
        return None
    for o in bpy.data.objects:
        o.select_set(False)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    src = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    tris_in = sum(len(p.vertices) - 2 for p in src.data.polygons)
    leaf_slots = {i for i, sl in enumerate(src.material_slots)
                  if sl.material is not None
                  and ("leaf" in sl.material.name.lower()
                       or "leaves" in sl.material.name.lower()
                       or getattr(sl.material, "blend_method", "OPAQUE") == "BLEND")}

    # ── leaves: drop whole cards, keep the survivors intact ──
    if leaf_slots:
        bm = bmesh.new()
        bm.from_mesh(src.data)
        bm.faces.ensure_lookup_table()
        leaf_faces = [f for f in bm.faces if f.material_index in leaf_slots]
        leaf_tris = sum(len(f.verts) - 2 for f in leaf_faces)
        if leaf_tris > HQ_LEAF_TRIS and leaf_faces:
            keep_frac = HQ_LEAF_TRIS / leaf_tris
            rng = random.Random(model_id)          # deterministic per model
            drop = [f for f in leaf_faces if rng.random() > keep_frac]
            if drop:
                bmesh.ops.delete(bm, geom=drop, context="FACES")
        bm.to_mesh(src.data)
        bm.free()
        # Loose vertices left by the deleted cards would bloat the GLB.
        bpy.context.view_layer.objects.active = src
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.delete_loose(use_verts=True, use_edges=True, use_faces=False)
        bpy.ops.object.mode_set(mode="OBJECT")

    # ── branches and trunk: split off, collapse-decimate, join back ──
    #
    # A Decimate modifier restricted by vertex group was the obvious way and it
    # does not work here: `vertex_groups.new()` on the freshly imported object
    # yields a group the modifier cannot resolve ("DeformGroup '' not in
    # object"). Separating the solid faces into their own object, decimating
    # that alone and joining back needs no vertex group at all, and the leaf
    # cards are never touched by the collapse.
    solid_tris = sum(len(p.vertices) - 2 for p in src.data.polygons
                     if p.material_index not in leaf_slots)
    if leaf_slots and solid_tris > HQ_SOLID_TRIS:
        for o in bpy.data.objects:
            o.select_set(False)
        src.select_set(True)
        bpy.context.view_layer.objects.active = src
        for p in src.data.polygons:
            p.select = p.material_index not in leaf_slots
        before_sep = set(bpy.data.objects)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        solid = next((o for o in bpy.data.objects if o not in before_sep), None)
        if solid is not None:
            mod = solid.modifiers.new("decimate", "DECIMATE")
            mod.ratio = HQ_SOLID_TRIS / solid_tris
            mod.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = solid
            bpy.ops.object.modifier_apply(modifier=mod.name)
            for o in bpy.data.objects:
                o.select_set(False)
            src.select_set(True)
            solid.select_set(True)
            bpy.context.view_layer.objects.active = src
            bpy.ops.object.join()
    elif solid_tris > HQ_SOLID_TRIS:
        mod = src.modifiers.new("decimate", "DECIMATE")
        mod.ratio = HQ_SOLID_TRIS / solid_tris
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = src
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for o in new:
        if o.type != "MESH" and o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    xs = [v.co.x for v in src.data.vertices]
    ys = [v.co.y for v in src.data.vertices]
    zs = [v.co.z for v in src.data.vertices]
    cx, cy, z0 = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)
    for v in src.data.vertices:
        v.co.x -= cx
        v.co.y -= cy
        v.co.z -= z0
    src["model_height"] = max(zs) - z0
    src["model_id"] = model_id
    src.select_set(False)
    # Unlink from the scene: only bucket-scaled copies are drawn.
    for coll in list(src.users_collection):
        coll.objects.unlink(src)
    _HQ_CACHE[model_id] = src
    leaf_out = sum(len(p.vertices) - 2 for p in src.data.polygons
                   if p.material_index in leaf_slots)
    tris_out = sum(len(p.vertices) - 2 for p in src.data.polygons)
    print(f"  tree model {model_id}: {tris_in:,} -> {tris_out:,} tris "
          f"({leaf_out:,} leaf, {tris_out - leaf_out:,} solid), "
          f"{src['model_height']:.1f} m tall (CC0, Poly Haven)", flush=True)
    return src


def hq_template(name: str, model_id: str, h: float) -> Any | None:
    src = import_hq_tree(model_id)
    if src is None:
        return None
    obj = src.copy()                     # shares the mesh datablock
    obj.name = name
    s = h / max(0.5, float(src["model_height"]))
    obj.scale = (s, s, s)
    # VIEWPORT PROXY. A scanned tree is tens of thousands of faces, and there
    # are up to 68,000 of them in the master. Solid-mode viewport draws
    # instances as their template's display type, so bounds keep the file
    # navigable; the render and any rendered-mode viewport draw the real mesh.
    obj.display_type = "BOUNDS"
    bpy.context.collection.objects.link(obj)
    return obj


def build_trees(ward: str, canopy: dict[str, Any], terrain: dict[str, Any],
                exag: float, datum: float, offset: tuple[float, float],
                hq: bool = False) -> int:
    """One vertex per tree, one template per height bucket, dupli-verts.

    The original template is not rendered once its parent instances it, so
    the scene contains exactly the trees the data lists and nothing at the
    origin.
    """
    trees = canopy.get("trees", [])
    if not trees:
        return 0
    ox, oy = offset
    trunk = principled("trunk", (0.16, 0.11, 0.07, 1.0), rough=0.95)
    crown = principled("crown", (0.07, 0.19, 0.06, 1.0), rough=0.85)
    drawn = 0
    for lo, hi in TREE_BUCKETS_M:
        members = [t for t in trees if lo <= float(t["h"]) < hi]
        if not members:
            continue
        h_rep = sum(float(t["h"]) for t in members) / len(members)
        r_rep = sum(float(t["r"]) for t in members) / len(members)
        if hq:
            # One scanned template for the whole bucket: they are far too heavy
            # to carry variants.
            tmpl = hq_template(f"{ward}-tree-{int(lo)}-{int(hi)}m",
                               HQ_TREE_BY_BUCKET.get((lo, hi), "island_tree_01"), h_rep)
            groups = [(tmpl, members)] if tmpl is not None else []
        else:
            groups = []
        if not groups:
            # SPLIT EACH BUCKET INTO VARIANTS so a street is not one shape
            # repeated. Assignment is by position, not by list order, so it is
            # stable under any re-ordering of the canopy file.
            buckets: list[list[dict[str, Any]]] = [[] for _ in range(TREE_VARIANTS)]
            for t in members:
                key = int(abs(float(t["x"])) * 7.0 + abs(float(t["y"])) * 13.0)
                buckets[key % TREE_VARIANTS].append(t)
            for vi, group in enumerate(buckets):
                if not group:
                    continue
                gh = sum(float(t["h"]) for t in group) / len(group)
                gr = sum(float(t["r"]) for t in group) / len(group)
                groups.append((tree_template(
                    f"{ward}-tree-{int(lo)}-{int(hi)}m-{vi}", gh, gr,
                    [trunk, crown], seed=int(lo) * 31 + vi), group))
        for template, group in groups:
            verts = [(float(t["x"]) + ox, float(t["y"]) + oy,
                      ground_z(terrain, exag, datum, float(t["x"]), float(t["y"])))
                     for t in group]
            cloud = mesh_object(f"{template.name}-cloud", verts, [], [])
            cloud.instance_type = "VERTS"
            template.parent = cloud
            template.location = (0.0, 0.0, 0.0)
            drawn += len(group)
    return drawn


# ── world, sun, camera ──────────────────────────────────────────────────────

def find_hdri() -> str | None:
    if not os.path.isdir(HDRI_DIR):
        return None
    for fn in sorted(os.listdir(HDRI_DIR)):
        if fn.lower().endswith((".hdr", ".exr")):
            return os.path.join(HDRI_DIR, fn)
    return None


def hdri_sun(img: Any) -> tuple[float, float]:
    """(elevation_deg, azimuth_deg) of the brightest texel, in map terms.

    Azimuth here is the mathematical angle from +X, counter-clockwise, in
    Blender's equirectangular convention (image centre faces +X). Elevation is
    from the row, bottom-up, because that is how `Image.pixels` is laid out.
    """
    import numpy as np
    w, h = int(img.size[0]), int(img.size[1])
    arr = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    rgb = arr.reshape(h, w, 4)[:, :, :3]
    lum = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    y, x = np.unravel_index(int(np.argmax(lum)), lum.shape)
    u, v = (float(x) + 0.5) / w, (float(y) + 0.5) / h
    return (v - 0.5) * 180.0, -(u - 0.5) * 360.0


def setup_world_hdri(path: str) -> float:
    """Light the scene with the sky image. Returns the sun elevation found.

    THE SUN IS FOUND, THEN THE MAP IS TURNED TO PUT IT WHERE THE LAMP IS. A
    sky HDRI carries its own sun; if the shadow-casting lamp sits at a
    different azimuth, every building gets two lighting directions and the
    render reads as wrong without anyone being able to say why. The lamp keeps
    the azimuth this script has always used; the image is rotated to agree,
    and the lamp's ELEVATION is taken from the image, since that is the one
    thing the image cannot be turned to change.
    """
    world = bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    img = bpy.data.images.load(path)
    elev, az_img = hdri_sun(img)
    # Lamp rz -> sun compass azimuth is 180 - rz (see setup_sun); the map's
    # angle is mathematical, so the target is rz - 90.
    az_target = SUN_AZIM_DEG - 90.0
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(az_img - az_target))
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = img
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    print(f"  sky: {os.path.basename(path)}  sun elev {elev:.1f} deg, "
          f"map az {az_img:.1f} -> rotated {az_img - az_target:+.1f} deg")
    return elev


def setup_world() -> None:
    world = bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new("ShaderNodeTexSky")
    # THE SKY MODEL HAS BEEN RENAMED ACROSS VERSIONS. Blender 5.2 offers
    # ('SINGLE_SCATTERING', 'MULTIPLE_SCATTERING', 'PREETHAM', 'HOSEK_WILKIE')
    # -- what 4.x called NISHITA was split into the two scattering models. Try
    # in order of preference and take the first the running build accepts,
    # rather than pinning a name that broke once and will break again.
    for model in ("MULTIPLE_SCATTERING", "NISHITA", "SINGLE_SCATTERING",
                  "HOSEK_WILKIE", "PREETHAM"):
        try:
            sky.sky_type = model
            break
        except TypeError:
            continue
    # Every parameter below is guarded for the same reason: a physical-sky
    # option that a future build drops should cost us its look, not the render.
    for attr, value in (
            ("sun_elevation", math.radians(SUN_ELEV_DEG)),
            ("sun_rotation", math.radians(SUN_AZIM_DEG)),
            # Bengaluru sits at ~915 m, and thinning the atmosphere above the
            # observer is a real, visible difference from a sea-level city.
            ("altitude", 915.0),
            ("air_density", 1.6),      # a haze the city genuinely has
            ("dust_density", 2.2)):
        if hasattr(sky, attr):
            setattr(sky, attr, value)
    bg = nt.nodes.new("ShaderNodeBackground")
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs[0], bg.inputs[0])
    nt.links.new(bg.outputs[0], out.inputs[0])


def setup_sun(elev_deg: float = SUN_ELEV_DEG, strength: float = SUN_STRENGTH) -> None:
    light = bpy.data.lights.new("sun", type="SUN")
    light.energy = strength
    light.angle = math.radians(0.545)     # the sun's real angular diameter
    obj = bpy.data.objects.new("sun", light)
    bpy.context.collection.objects.link(obj)
    elev = math.radians(elev_deg)
    azim = math.radians(SUN_AZIM_DEG)
    # With this euler the sun sits at compass azimuth 180 - SUN_AZIM_DEG:
    # 285 puts it west-south-west, shadows falling east-north-east.
    obj.rotation_euler = (math.pi / 2 - elev, 0.0, azim)


#: Film exposure per lighting path. THESE DIFFER BY NEARLY FOUR STOPS, and the
#: first HDRI render came out black because the procedural value was reused.
#: The Nishita sky plus a 4 W/m2 lamp is far brighter in absolute terms than a
#: calibrated sky image at strength 1, which is built to sit near exposure 0.
EXPOSURE_PROCEDURAL = -3.8
EXPOSURE_HDRI = 0.0


def setup_lighting(a: dict[str, str]) -> float:
    """HDRI if one is on disk and not refused with --hdri 0; else the
    procedural sky. The lamp follows whichever sun is in use.

    Returns the exposure the chosen path wants, which the caller uses unless
    --exposure overrides it. Lighting and exposure are one decision; splitting
    them across two places is how the black render happened.
    """
    path = find_hdri() if a.get("hdri", "1") != "0" else None
    if path:
        elev = setup_world_hdri(path)
        # The image already carries a sun disc that casts its own shadows in
        # Cycles; the lamp only sharpens them, so it runs low to avoid lighting
        # the sunlit faces twice.
        setup_sun(elev_deg=elev, strength=1.5)
        return EXPOSURE_HDRI
    setup_world()
    setup_sun()
    return EXPOSURE_PROCEDURAL


def setup_camera(size: float, tallest: float, pitch_deg: float,
                 azim_deg: float, margin: float) -> Any:
    """Frame the whole ward, computed from the lens rather than eyeballed.

    THE FIRST VERSION PUT THE CAMERA 2.6 km FROM A 2.8 km WARD and cropped it.
    Distance is now solved from the field of view: to fit a span S across a
    horizontal FOV of 2*atan(sensor/2f), the camera must sit
    S / (2*tan(hfov/2)) back along its own view axis. Everything else -- pitch,
    azimuth, height -- follows from that one distance, so changing the lens or
    the ward size cannot silently re-crop the shot.

    AIM USES A TRACK-TO CONSTRAINT rather than hand-built Euler angles. Blender's
    camera looks down -Z at rest, so pointing it by arithmetic means composing
    two rotations in the right order, and getting that wrong yields a plausible
    picture of the wrong place.
    """
    cam = bpy.data.cameras.new("camera")
    cam.lens = 50.0
    cam.sensor_width = 36.0
    cam.clip_end = 60_000.0
    obj = bpy.data.objects.new("camera", cam)
    bpy.context.collection.objects.link(obj)
    bpy.context.scene.camera = obj

    # AN OBLIQUE VIEW PROJECTS THE WARD AS A DIAMOND, whose corner-to-corner
    # span is wider than the box itself, so the margin has to cover sqrt(2) of
    # the side rather than the side. 1.7 was found by rendering: 1.25 and 1.5
    # both clipped the near corner, which is the one nearest the camera and so
    # the one a fitted-to-the-side calculation always loses first.
    span = size * margin
    hfov = 2.0 * math.atan(cam.sensor_width / (2.0 * cam.lens))
    dist = span / (2.0 * math.tan(hfov / 2.0))

    pitch = math.radians(pitch_deg)          # below horizontal
    azim = math.radians(azim_deg)            # bearing the camera sits ON
    r = dist * math.cos(pitch)
    obj.location = (r * math.sin(azim), r * math.cos(azim),
                    dist * math.sin(pitch) + tallest * 0.5)

    target = bpy.data.objects.new("look-at", None)
    bpy.context.collection.objects.link(target)
    target.location = (0.0, 0.0, 0.0)
    con = obj.constraints.new(type="TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"
    return obj


def configure_render(samples: int, exposure: float, res: int) -> None:
    """Engine, exposure and resolution -- called BEFORE the .blend is saved.

    THE FIRST VERSION SET THESE INSIDE render(), AFTER save_as_mainfile. The
    render that came out of the script was right, and the file on disk carried
    the factory defaults: EEVEE, 1080p, exposure 0. Anyone pressing F12 in the
    saved file got a different picture from the one the script produced, and
    was told it would be the same. Settings that describe the file belong in
    the file.
    """
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    try:
        scene.cycles.device = "GPU"
    except (AttributeError, TypeError):
        pass
    scene.render.resolution_x = res
    scene.render.resolution_y = int(res * 9 / 16)
    scene.render.film_transparent = False
    scene.view_settings.exposure = exposure
    scene.view_settings.view_transform = "AgX"
    scene.render.image_settings.file_format = "PNG"


def configure_viewports() -> None:
    """Make the saved file OPENABLE at city scale.

    Blender's factory 3D viewport clips at 1,000 m. A single ward is 2,800 m
    across and the master is 10,400 m, so on opening the file the far clip
    plane slices straight through the geometry: the island appears to end in a
    ragged line, its plinth vanishes below, and the other two islands are
    simply not there. It looks like broken geometry and it is a viewport
    setting. --background saves the factory UI, so this has to be set
    explicitly on every 3D view the file carries.

    clip_start is raised too: 0.01 m on a 10 km scene spreads the depth
    buffer so thin that building walls z-fight with their own ground.
    """
    n = 0
    for scr in bpy.data.screens:
        for area in scr.areas:
            if area.type != "VIEW_3D":
                continue
            for sp in area.spaces:
                if sp.type != "VIEW_3D":
                    continue
                sp.clip_start = 1.0
                sp.clip_end = 200_000.0
                sp.shading.type = "MATERIAL"
                # Open on the composed shot, not the factory view of the origin.
                sp.region_3d.view_perspective = "CAMERA"
                n += 1
    print(f"  viewports configured: {n} (clip 1 m .. 200 km, camera view)")


def render(path: str) -> None:
    scene = bpy.context.scene
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def export_web_glb(path: str, ward: str) -> None:
    """Buildings and landmarks only, Draco-compressed, for the browser.

    WHAT IS DELIBERATELY LEFT OUT, and why each one is not a loss:
      trees    OBOS already instances its own from `<ward>-trees.json`, tuned
               over three Kolkata wards. Ours are 24,856 nodes in MG Road alone
               and would be the whole payload.
      terrain  the app builds its own relief layer and exaggerates it; a second
               ground would z-fight with the first.
      roads    drawn by `road-layer.ts` from the roads artefact, with labels.
      water    drawn by `water-layer.ts`, and the SOLVER reads that layer, so
               it has to come from the artefact rather than from a mesh.

    THE FRAME THE FILE IS IN, MEASURED -- READ THIS BEFORE CONSUMING IT.
    Blender is Z-up and the glTF exporter rotates to glTF's Y-up, so a vertex
    written here is (x_east, z_up, -y_north): +Z IN THE FILE POINTS SOUTH. Node
    translations are identity, so the accessor values are already ward-local
    metres, and a consumer recovers them as x = position.x, y = -position.z.

    That was settled against three published coordinates rather than by reading
    the exporter: UB Tower, M. Chinnaswamy Stadium and the Subhas Chandra Bose
    Tower land 5, 20 and 20 m from where their lat/lon puts them, while reading
    +Z as north puts the same three 576, 744 and 303 m out. A consumer that
    assumes "z north" draws the ward MIRRORED NORTH-SOUTH -- which renders
    perfectly, is invisible to every symmetric statistic, and has already
    shipped once on this project.

    THE FOOTPRINT RINGS STILL SHIP SEPARATELY and that is not negotiable:
    `rasterizeWardBuilt` stamps every ring into the `built` grid the heat model
    solves on. This file is what gets DRAWN; `<ward>.json` is what gets SOLVED.
    Same separation the Dubai scenes enforce -- geometry may be added, the
    physics input may never be modified by it.
    """
    keep = {"Buildings", "Landmarks"}
    hidden: list[Any] = []
    for ob in bpy.data.objects:
        in_keep = any(c.name in keep for c in ob.users_collection)
        # EVERY type is hidden, not just MESH. The first version tested
        # `ob.type == "MESH"`, so the camera's `look-at` EMPTY stayed visible and
        # the exporter wrote it as a node: mg-road's web GLB shipped 14 nodes for
        # 13 meshes, one of them a target for a camera the file does not contain.
        # Harmless to draw, but the docstring above says "buildings and landmarks
        # only" and it was not true.
        if not in_keep:
            hidden.append(ob)
            ob.hide_set(True)
            ob.hide_viewport = True
    try:
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", export_apply=False,
            use_visible=True,
            # Draco: positions are what dominates here, and buildings are flat
            # prisms, so normals and UVs cost almost nothing to keep.
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=6,
            export_draco_position_quantization=14,
            export_normals=False, export_texcoords=False,
            export_materials="NONE",
        )
    except (AttributeError, RuntimeError, TypeError) as exc:
        print(f"  web GLB export failed ({exc})")
        return
    finally:
        for ob in hidden:
            ob.hide_set(False)
            ob.hide_viewport = False
    mb = os.path.getsize(path) / 1e6 if os.path.exists(path) else 0.0
    print(f"  web GLB {os.path.basename(path)}: {mb:.2f} MB "
          f"(buildings + landmarks only, Draco)")


def export_glb(path: str) -> None:
    """Write the current scene as a single binary glTF.

    GLB rather than glTF+bin because one file cannot lose its buffer, and
    because everything downstream here -- three.js, the mobile tiers, Blender
    itself -- reads it directly.
    """
    try:
        # export_apply=False: every modifier is already applied at import, and
        # with apply ON the exporter evaluates each scaled bucket template into
        # its own mesh -- six copies of a 25-69k-triangle scan per ward, eighteen
        # in the master -- instead of one mesh per model with scale on the node.
        # Measured before this change: mg-road.glb 54.1 MB, master 79.0 MB.
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB",
                                  export_apply=False)
    except (AttributeError, RuntimeError) as exc:
        print(f"  GLB export unavailable ({exc}) -- .blend written anyway")
        return
    mb = os.path.getsize(path) / 1e6 if os.path.exists(path) else 0.0
    print(f"  exported {path} ({mb:.1f} MB)")


def ward_scene(ward: str, a: dict[str, str], offset: tuple[float, float],
               island: bool) -> dict[str, int]:
    """Add one ward's ground and buildings to the CURRENT scene.

    Shared by the single-ward files and the master, so the two can never drift
    into drawing the same ward differently.
    """
    doc = load(ward, "buildings")
    exag = float(a.get("exag", TERRAIN_EXAG))
    qa = a.get("qa") == "1"
    depth = float(a.get("depth", 320.0))

    if island:
        # An island is the WARD, so it uses the 2.8 km ward terrain. The 8.4 km
        # context sheet exists to stop a continuous scene ending in mid-air; an
        # island ends on purpose.
        terrain = load(ward, "terrain")
    else:
        terrain, _ = load_terrain(ward)

    datum = float(terrain["meanM"])
    build_terrain(terrain, exag, datum, name=f"{ward}-ground",
                  offset=offset, island=island, depth=depth)
    ctx = load_optional(ward, "context")
    if ctx is not None:
        counts = build_context(ward, ctx, terrain, exag, datum, offset)
        print(f"  {ward}: green {counts['green']}, water {counts['water']}, "
              f"streams {counts['streams']}, roads {counts['roads']:,}")
    else:
        print(f"  {ward}: no context layer -- run fetch-bangalore.py --layer context")
    canopy = load_optional(ward, "canopy")
    if canopy is not None:
        n_trees = build_trees(ward, canopy, terrain, exag, datum, offset,
                              hq=a.get("trees", "stylised") == "scan")
        cf = canopy.get("coverFrac", {})
        print(f"  {ward}: trees {n_trees:,} instanced; canopy cover "
              f"v1 {100 * float(cf.get('v1', 0)):.1f} % (v2 {100 * float(cf.get('v2', 0)):.1f} %), "
              f"{int(canopy.get('droppedInBuildings', 0)):,} dropped inside buildings")
    else:
        print(f"  {ward}: no canopy layer -- run fetch-bangalore.py --layer canopy")
    _, stats = build_buildings(terrain, doc, exag, datum, qa,
                               name=f"{ward}-buildings", offset=offset)
    print(f"  {ward}: {stats['drawn']:,} drawn, {stats['landmarks']} named landmark "
          f"objects, {stats['tiny']:,} skipped tiny, "
          f"{stats['flagged']:,} height-source disagreements, "
          f"{stats['filled']:,} on the fill height")
    print(f"  {ward}: {doc.get('crossCheck', '(no cross-check recorded)')}")
    return stats


def build_master(a: dict[str, str]) -> None:
    """All three wards as separate islands in one file."""
    qa = a.get("qa") == "1"
    clear()
    exposure = setup_lighting(a)

    size = float(load(MASTER_ORDER[0], "buildings")["sizeM"])
    pitch = size + MASTER_GAP_M
    tallest = 0.0
    for k, ward in enumerate(MASTER_ORDER):
        ox = (k - (len(MASTER_ORDER) - 1) / 2.0) * pitch
        ward_scene(ward, a, (ox, 0.0), island=True)
        doc = load(ward, "buildings")
        tallest = max(tallest, max((float(b["h"]) for b in doc["b"]), default=0.0))

    # Margin 1.05 rather than the single-ward 1.35: three islands in a row are
    # already a wide, shallow subject, so the sqrt(2) diamond allowance a single
    # square ward needs would only add empty sky above and below.
    span = pitch * len(MASTER_ORDER)
    setup_camera(span, tallest, float(a.get("pitch", 28.0)),
                 float(a.get("azim", 200.0)), float(a.get("margin", 1.05)))

    configure_render(int(a.get("samples", 48)), float(a.get("exposure", exposure)),
                     int(a.get("res", 2000)))
    configure_viewports()
    organise_collections()
    os.makedirs(SCENES, exist_ok=True)
    blend = os.path.join(SCENES, "bangalore-master.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print(f"  master: saved {blend}")
    if a.get("glb") == "1":
        export_glb(os.path.join(SCENES, "bangalore-master.glb"))
    if a.get("render", "1") == "0":
        print("  master: render skipped (--render 0)")
        return
    out = a.get("out") or os.path.join(
        SCENES, f"bangalore-master{'-qa' if qa else ''}.png")
    render(out)
    print(f"  master: rendered {out}")


def build_ward(ward: str, a: dict[str, str]) -> None:
    """One ward, one file, one island."""
    qa = a.get("qa") == "1"
    island = a.get("island", "1") != "0"
    clear()
    exposure = setup_lighting(a)
    ward_scene(ward, a, (0.0, 0.0), island=island)

    doc = load(ward, "buildings")
    size = float(doc["sizeM"])
    tallest = max((float(b["h"]) for b in doc["b"]), default=20.0)
    setup_camera(size, tallest, float(a.get("pitch", 38.0)),
                 float(a.get("azim", 215.0)),
                 float(a.get("margin", 1.35 if island else 1.7)))

    exag = float(a.get("exag", TERRAIN_EXAG))
    if exag != 1.0:
        print(f"  {ward}: TERRAIN EXAGGERATED x{exag} -- label any render from this")

    # Per-ward trims only apply to the procedural path they were measured on.
    if exposure == EXPOSURE_PROCEDURAL:
        exposure = WARD_EXPOSURE.get(ward, EXPOSURE_PROCEDURAL)
    configure_render(int(a.get("samples", 48)), float(a.get("exposure", exposure)),
                     int(a.get("res", 1600)))
    configure_viewports()
    organise_collections()
    os.makedirs(SCENES, exist_ok=True)
    blend = os.path.join(SCENES, f"{ward}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print(f"  {ward}: saved {blend}")
    if a.get("glb") == "1":
        export_glb(os.path.join(SCENES, f"{ward}.glb"))
    if a.get("webglb") == "1":
        export_web_glb(os.path.join(SCENES, f"{ward}-web.glb"), ward)

    if a.get("render", "1") == "0":
        print(f"  {ward}: render skipped (--render 0)")
        return
    out = a.get("out") or os.path.join(SCENES, f"{ward}{'-qa' if qa else ''}.png")
    render(out)
    print(f"  {ward}: rendered {out}")


def main() -> None:
    a = args()
    which = a.get("ward", "all")
    if which == "master":
        build_master(a)
        return
    wards = MASTER_ORDER if which == "all" else [which]
    for w in wards:
        build_ward(w, a)


if __name__ == "__main__":
    main()
