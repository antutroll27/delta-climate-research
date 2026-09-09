"""Build a Bangalore ward scene in Blender and render it with Cycles.

ONE .BLEND PER WARD, at the founder's direction. The three wards share nothing
but this script -- different terrain, different building sets, different
exposure -- so a combined file would only be three scenes in one container, with
every save rewriting all three.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --python scripts/blender_bangalore.py -- --ward indiranagar

    ... --ward all --samples 128          # all three, production samples
    ... --ward mg-road --qa               # QA lens: tint what we do not know

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
view. It colours buildings by *what we know about them* instead of by material:
amber where Google 2.5D and UT-GLOBUS disagree by more than 5 m, and grey where
Google had no confident pixel and the height is the 2.5 m fill. Automated gates
prove a scene is well-formed; only looking at it proves the city is there. The
Dubai work learned that the expensive way -- a landmark rendered as a tent while
every check passed.
"""
from __future__ import annotations

# bpy/mathutils ship no stubs and exist only inside Blender, so every signature
# touching them is annotated against `Any`. The alternative is hand-written stubs
# for a script that runs in one place and never imports into the pipeline.

import json
import math
import os
import sys
from typing import Any

import bpy  # type: ignore[import-not-found]

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
WARD_EXPOSURE = {"indiranagar": -4.2, "mg-road": -4.2, "whitefield": -4.0}


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
    """Empty the file. --background still opens the startup scene with a cube."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def principled(name: str, rgba: tuple[float, float, float, float],
               rough: float = 0.6, metal: float = 0.0) -> Any:
    """A Principled BSDF material.

    Sockets are addressed BY NAME and guarded, because Blender renamed several
    of them at 4.0 ("Specular" -> "Specular IOR Level") and this script has to
    survive the next rename too. A missing socket is a look regression; a hard
    KeyError is a broken build.
    """
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


def build_terrain(terrain: dict[str, Any], exag: float, datum: float) -> Any:
    n = int(terrain["n"])
    size = float(terrain["sizeM"])
    h = terrain["h"]
    verts: list[tuple[float, float, float]] = []
    for j in range(n):
        for i in range(n):
            x = -size / 2.0 + size * i / (n - 1)
            y = -size / 2.0 + size * j / (n - 1)
            verts.append((x, y, (float(h[j * n + i]) - datum) * exag))
    faces: list[tuple[int, ...]] = []
    for j in range(n - 1):
        for i in range(n - 1):
            a = j * n + i
            faces.append((a, a + 1, a + n + 1, a + n))
    mat = principled("ground", (0.20, 0.19, 0.16, 1.0), rough=0.95)
    obj = mesh_object("terrain", verts, faces, [mat])
    obj.data.shade_smooth()
    return obj


# ── buildings ───────────────────────────────────────────────────────────────

def build_buildings(terrain: dict[str, Any], doc: dict[str, Any],
                    exag: float, datum: float, qa: bool) -> tuple[Any, dict[str, int]]:
    """One mesh for every footprint. Blender takes n-gons, so a cap face per
    ring plus a quad per edge is the whole job -- no roof triangulation."""
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    slots: list[int] = []
    stats = {"drawn": 0, "tiny": 0, "flagged": 0, "filled": 0}

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

        slot = 0
        if qa:
            if b.get("flag"):
                slot, stats["flagged"] = 1, stats["flagged"] + 1
            elif b.get("fill"):
                slot, stats["filled"] = 2, stats["filled"] + 1
        else:
            if b.get("flag"):
                stats["flagged"] += 1
            if b.get("fill"):
                stats["filled"] += 1

        start = len(verts)
        for i in range(nv):
            verts.append((p[i * 2], p[i * 2 + 1], base))
        for i in range(nv):
            verts.append((p[i * 2], p[i * 2 + 1], top))
        for i in range(nv):
            a0, a1 = start + i, start + (i + 1) % nv
            faces.append((a0, a1, a1 + nv, a0 + nv))
            slots.append(slot)
        faces.append(tuple(start + nv + i for i in range(nv)))
        slots.append(slot)
        stats["drawn"] += 1

    mats = [principled("building", (0.52, 0.50, 0.47, 1.0), rough=0.75)]
    if qa:
        # Amber: the two height sources disagree by more than 5 m here. Grey:
        # Google had no confident pixel and this is the 2.5 m fill, so the
        # building's height is a convention rather than a measurement.
        mats.append(principled("qa-disagree", (0.85, 0.45, 0.08, 1.0), rough=0.6))
        mats.append(principled("qa-fill", (0.30, 0.31, 0.34, 1.0), rough=0.9))

    obj = mesh_object("buildings", verts, faces, mats)
    if qa and len(obj.data.polygons) == len(slots):
        for poly, s in zip(obj.data.polygons, slots):
            poly.material_index = s
    return obj, stats


# ── world, sun, camera ──────────────────────────────────────────────────────

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


def setup_sun() -> None:
    light = bpy.data.lights.new("sun", type="SUN")
    light.energy = SUN_STRENGTH
    light.angle = math.radians(0.545)     # the sun's real angular diameter
    obj = bpy.data.objects.new("sun", light)
    bpy.context.collection.objects.link(obj)
    elev = math.radians(SUN_ELEV_DEG)
    azim = math.radians(SUN_AZIM_DEG)
    obj.rotation_euler = (math.pi / 2 - elev, 0.0, azim)


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


def render(path: str, samples: int, exposure: float, res: int) -> None:
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
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)


def build_ward(ward: str, a: dict[str, str]) -> None:
    terrain, wide = load_terrain(ward)
    doc = load(ward, "buildings")
    exag = float(a.get("exag", TERRAIN_EXAG))
    qa = a.get("qa") == "1"
    # The CAMERA frames the ward, not the terrain. With the context mesh loaded
    # `terrain["sizeM"]` is 8400 m, and sizing the shot to that would push the
    # ward into the middle distance -- a wide landscape rather than a city.
    size = float(doc["sizeM"])
    datum = float(terrain["meanM"])

    clear()
    setup_world()
    setup_sun()
    build_terrain(terrain, exag, datum)
    _, stats = build_buildings(terrain, doc, exag, datum, qa)

    tallest = max((float(b["h"]) for b in doc["b"]), default=20.0)
    setup_camera(size, tallest, float(a.get("pitch", 38.0)),
                 float(a.get("azim", 215.0)), float(a.get("margin", 1.7)))

    print(f"  {ward}: terrain {terrain['n']}x{terrain['n']} over "
          f"{float(terrain['sizeM']):.0f} m"
          f"{' (context)' if wide else ' (ward only -- no context mesh found)'}")
    print(f"  {ward}: {stats['drawn']:,} drawn, {stats['tiny']:,} skipped tiny, "
          f"{stats['flagged']:,} height-source disagreements, "
          f"{stats['filled']:,} on the fill height")
    print(f"  {ward}: {doc.get('crossCheck', '(no cross-check recorded)')}")
    if exag != 1.0:
        print(f"  {ward}: TERRAIN EXAGGERATED x{exag} -- label any render from this")

    os.makedirs(SCENES, exist_ok=True)
    blend = os.path.join(SCENES, f"{ward}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print(f"  {ward}: saved {blend}")

    out = a.get("out") or os.path.join(SCENES, f"{ward}{'-qa' if qa else ''}.png")
    render(out, int(a.get("samples", 48)),
           float(a.get("exposure", WARD_EXPOSURE.get(ward, -3.4))),
           int(a.get("res", 1600)))
    print(f"  {ward}: rendered {out}")


def main() -> None:
    a = args()
    which = a.get("ward", "all")
    wards = (["indiranagar", "mg-road", "whitefield"] if which == "all"
             else [which])
    for w in wards:
        build_ward(w, a)


if __name__ == "__main__":
    main()
