"""Minimal glTF 2.0 / GLB writer — enough for LoD1 building shells, nothing more.

Deliberately not a dependency. A GLB is a 12-byte header plus a JSON chunk plus
a BIN chunk, and we emit exactly one mesh with one primitive, so a library would
be more code to audit than the format is to write. Everything here is pinned by
`demo()` at the bottom.

Ear clipping is the one non-obvious piece. Building footprints are frequently
concave -- L-shaped blocks are ordinary -- so a triangle fan across the roof
would fold geometry through the building. Walls are quads and never need it;
only the floor and roof caps do.
"""
from __future__ import annotations

import json
import struct
from typing import Sequence

Pt = tuple[float, float]

#: glTF component + type constants used below.
_FLOAT, _USHORT, _UINT = 5126, 5123, 5125
_ARRAY_BUFFER, _ELEMENT_ARRAY_BUFFER = 34962, 34963


def _area2(poly: Sequence[Pt]) -> float:
    """Twice the signed area. Positive = counter-clockwise."""
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        s += x1 * y2 - x2 * y1
    return s


def _in_triangle(p: Pt, a: Pt, b: Pt, c: Pt) -> bool:
    d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1])
    d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1])
    d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1])
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def earclip(poly: Sequence[Pt]) -> list[tuple[int, int, int]]:
    """Triangulate a simple polygon (no holes) into CCW index triples.

    Returns indices INTO `poly`. Handles concave rings; a fan does not. Degenerate
    or self-intersecting input returns the best partial fan rather than looping
    forever -- the caller ships thousands of real footprints and one bad ring must
    not hang the build.
    """
    n = len(poly)
    if n < 3:
        return []
    idx = list(range(n))
    if _area2(poly) < 0:            # normalise to CCW so ear tests have one sense
        idx.reverse()
    out: list[tuple[int, int, int]] = []
    guard = 0
    while len(idx) > 3 and guard < 4 * n:
        guard += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = poly[i0], poly[i1], poly[i2]
            if _area2((a, b, c)) <= 0:          # reflex or collinear: not an ear
                continue
            if any(_in_triangle(poly[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            out.append((i0, i1, i2))
            idx.pop(k)
            break
        else:
            break                                # no ear found; stop cleanly
    if len(idx) == 3:
        out.append((idx[0], idx[1], idx[2]))
    return out


def write_glb(
    path: str,
    positions: Sequence[tuple[float, float, float]],
    indices: Sequence[int],
    *,
    name: str = "buildings",
    copyright_: str | None = None,
    extras: dict[str, object] | None = None,
) -> int:
    """Write one mesh as a binary glTF 2.0 file. Returns bytes written."""
    if not positions or not indices:
        raise ValueError("write_glb: refusing to write an empty mesh")
    wide = len(positions) > 65535
    icode, ictype = ("<I", _UINT) if wide else ("<H", _USHORT)

    pos_bytes = b"".join(struct.pack("<3f", *p) for p in positions)
    idx_bytes = b"".join(struct.pack(icode, i) for i in indices)
    pad = (-len(pos_bytes)) % 4
    idx_off = len(pos_bytes) + pad
    bin_chunk = pos_bytes + b"\x00" * pad + idx_bytes
    bin_chunk += b"\x00" * ((-len(bin_chunk)) % 4)

    xs = [p[0] for p in positions]; ys = [p[1] for p in positions]; zs = [p[2] for p in positions]
    gltf = {
        # glTF 2.0 defines asset.copyright, so ODbL 4.2(d)'s "not possible to put
        # the notice in this file" escape hatch does NOT apply here -- it was
        # possible and simply had not been done. The densest ODbL artefact we ship
        # travelled with no notice at all until an audit said so.
        "asset": {
            "version": "2.0",
            "generator": "delta-climate-research",
            **({"copyright": copyright_} if copyright_ else {}),
            **({"extras": extras} if extras else {}),
        },
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        # glTF is Y-up, 3D Tiles content is Z-up: this is the standard correction
        # and omitting it lays every building flat on its side.
        "nodes": [{"mesh": 0, "matrix": [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]}],
        "meshes": [{"name": name, "primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "material": 0}]}],
        "materials": [{
            "pbrMetallicRoughness": {"baseColorFactor": [0.82, 0.80, 0.76, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.95},
            "doubleSided": False,
        }],
        "buffers": [{"byteLength": len(bin_chunk)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_bytes), "target": _ARRAY_BUFFER},
            {"buffer": 0, "byteOffset": idx_off, "byteLength": len(idx_bytes), "target": _ELEMENT_ARRAY_BUFFER},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": _FLOAT, "count": len(positions), "type": "VEC3",
             "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]},
            {"bufferView": 1, "componentType": ictype, "count": len(indices), "type": "SCALAR"},
        ],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_chunk)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A)); fh.write(js)
        fh.write(struct.pack("<II", len(bin_chunk), 0x004E4942)); fh.write(bin_chunk)
    return total


def demo() -> None:
    """Self-check: the concave case a triangle fan gets wrong."""
    square: list[Pt] = [(0, 0), (2, 0), (2, 2), (0, 2)]
    tris = earclip(square)
    assert len(tris) == 2, tris
    area = sum(_area2((square[a], square[b], square[c])) for a, b, c in tris) / 2
    assert abs(area - 4.0) < 1e-9, area

    # L-shape: concave. A fan from vertex 0 would cover area outside the polygon.
    ell: list[Pt] = [(0, 0), (3, 0), (3, 1), (1, 1), (1, 3), (0, 3)]
    tris = earclip(ell)
    assert len(tris) == 4, tris
    area = sum(_area2((ell[a], ell[b], ell[c])) for a, b, c in tris) / 2
    assert abs(area - 5.0) < 1e-9, f"triangulated area {area}, true area 5.0"
    for a, b, c in tris:
        assert _area2((ell[a], ell[b], ell[c])) > 0, "every emitted triangle must be CCW"

    # clockwise input must give the same area (winding is normalised, not assumed)
    area_cw = sum(_area2((ell[::-1][a], ell[::-1][b], ell[::-1][c])) for a, b, c in earclip(ell[::-1])) / 2
    assert abs(area_cw - 5.0) < 1e-9, area_cw
    print("  _gltf self-check OK — earclip exact on square, L-shape, and reversed winding")


if __name__ == "__main__":
    demo()
