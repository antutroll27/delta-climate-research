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


def estimate_height(area: float, seed: int) -> float:
    """Fallback ONLY. Used where OSM has no height for this footprint.

    Capped at 60 m rather than the earlier 40 m, but the cap is not the point —
    real towers no longer come through here at all. Anything with a measured
    height bypasses this entirely, which is why the skyline exists now.
    """
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
        top = base + (float(measured) if measured else estimate_height(area, idx + 1))
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
        top = base + (float(measured) if measured else estimate_height(area, osm_drawn + 7))
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
    z = doc["dtm"]["p50"] * TERRAIN_EXAG
    r = size * 12.0
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
    cam.clip_start, cam.clip_end = 1.0, 40_000.0
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
    out = a.get("out", "/tmp/dubai.png")
    samples = int(a.get("samples", "48"))
    clear()
    with open(os.path.join(DATA, "dubai-creek-terrain.json")) as fh:
        terrain_doc = json.load(fh)
    with open(os.path.join(DATA, "dubai-creek-buildings.json")) as fh:
        buildings_doc = json.load(fh)
    build_apron(terrain_doc)
    build_terrain(terrain_doc)
    lc_path = os.path.join(DATA, "dubai-creek-landcover.json")
    if os.path.exists(lc_path):
        with open(lc_path) as fh:
            print("  landcover:")
            build_landcover(terrain_doc, json.load(fh))
    build_buildings(terrain_doc, buildings_doc)
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
    scene.view_settings.exposure = float(a.get("exposure", "-1.6"))
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
                    space.clip_start, space.clip_end = 1.0, 60_000.0
                    fixed += 1
    print(f"  viewport clip set on {fixed} 3D view(s): 1 m .. 60 km")

    blend = a.get("blend")
    if blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(blend))
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
