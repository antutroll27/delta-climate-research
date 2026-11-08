"""GDAL VRT mosaics of same-grid GeoTIFF tiles, written by hand (no gdalbuildvrt in this environment, no new dependency).

WHY (city-streaming P2a audit S2 + S3). A sheet reads the AHN from the city's 1 km cache (`raw/city/ahn/dtm_05m_<x0>_<y0>.tif`, a lattice of
whole kilometres) and not from per-area WCS tiles named after the area's own origin, which would miss the cache and fetch again at
50-100 KB/s. And the Meta CHM comes as two zoom-10 COGs split at lon 4.92187 E, which every F-column sheet straddles. One VRT per source
turns both into "open one raster, read a window".

The tiles must share a CRS, a pixel size and a pixel lattice (a tile's offset from the first is a whole number of pixels), or the
mosaic would resample silently: that is refused, not tolerated. Overlaps are resolved by source order with nodata transparent.

    python3 scripts/_vrt.py        # self-test
"""
from __future__ import annotations

import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from xml.sax.saxutils import escape

import numpy as np
import rasterio

#: A tile's offset from the mosaic origin must be a whole number of pixels to this fraction of a pixel.
LATTICE_TOL = 1e-4

_GDAL_TYPE = {"uint8": "Byte", "int16": "Int16", "uint16": "UInt16", "int32": "Int32", "uint32": "UInt32",
              "float32": "Float32", "float64": "Float64"}


@dataclass(frozen=True, slots=True)
class _Tile:
    path: str
    left: float
    top: float
    width: int
    height: int
    block: tuple[int, int]


def write_mosaic_vrt(vrt_path: str, sources: Sequence[str]) -> None:
    """Write a one-band mosaic VRT over `sources` (north-up, one band, one dtype). Absolute source paths."""
    if not sources:
        raise ValueError("no sources to mosaic")
    tiles: list[_Tile] = []
    first_tf = None
    crs_wkt = dtype = ""
    nodata: float | None = None
    for i, path in enumerate(sources):
        with rasterio.open(path) as src:
            tf = src.transform
            if src.count != 1 or tf.b != 0.0 or tf.d != 0.0 or tf.e >= 0.0:
                raise ValueError(f"{path}: not a one-band north-up raster")
            if i == 0:
                first_tf, crs_wkt, dtype, nodata = tf, src.crs.to_wkt(), src.dtypes[0], src.nodata
                if dtype not in _GDAL_TYPE:
                    raise ValueError(f"{path}: dtype {dtype} not handled")
            else:
                assert first_tf is not None
                if src.crs.to_wkt() != crs_wkt or src.dtypes[0] != dtype:
                    raise ValueError(f"{path}: CRS or dtype differs from the first tile")
                if abs(tf.a / first_tf.a - 1.0) > 1e-9 or abs(tf.e / first_tf.e - 1.0) > 1e-9:
                    raise ValueError(f"{path}: pixel size differs from the first tile")
                for off in ((tf.c - first_tf.c) / first_tf.a, (tf.f - first_tf.f) / first_tf.e):
                    if abs(off - round(off)) > LATTICE_TOL:
                        raise ValueError(f"{path}: not on the first tile's pixel lattice (offset {off} px): would resample")
            tiles.append(_Tile(os.path.abspath(path), tf.c, tf.f, src.width, src.height, (src.block_shapes[0][1], src.block_shapes[0][0])))
    assert first_tf is not None
    res_x, res_y = first_tf.a, -first_tf.e
    left, top = min(t.left for t in tiles), max(t.top for t in tiles)
    cols = round(max(t.left + t.width * res_x for t in tiles) / res_x - left / res_x)
    rows = round(top / res_y - min(t.top - t.height * res_y for t in tiles) / res_y)
    gt = ", ".join(repr(v) for v in (left, res_x, 0.0, top, 0.0, -res_y))
    gtype = _GDAL_TYPE[dtype]
    out = [f'<VRTDataset rasterXSize="{cols}" rasterYSize="{rows}">', f"  <SRS>{escape(crs_wkt)}</SRS>",
           f"  <GeoTransform>{gt}</GeoTransform>", f'  <VRTRasterBand dataType="{gtype}" band="1">']
    if nodata is not None:
        out.append(f"    <NoDataValue>{nodata!r}</NoDataValue>")
    for t in tiles:
        x_off, y_off = round((t.left - left) / res_x), round((top - t.top) / res_y)
        out += ["    <ComplexSource>" if nodata is not None else "    <SimpleSource>",
                f'      <SourceFilename relativeToVRT="0">{escape(t.path)}</SourceFilename>', "      <SourceBand>1</SourceBand>",
                f'      <SourceProperties RasterXSize="{t.width}" RasterYSize="{t.height}" DataType="{gtype}" '
                f'BlockXSize="{t.block[0]}" BlockYSize="{t.block[1]}" />',
                f'      <SrcRect xOff="0" yOff="0" xSize="{t.width}" ySize="{t.height}" />',
                f'      <DstRect xOff="{x_off}" yOff="{y_off}" xSize="{t.width}" ySize="{t.height}" />']
        if nodata is not None:
            out.append(f"      <NODATA>{nodata!r}</NODATA>")
        out.append("    </ComplexSource>" if nodata is not None else "    </SimpleSource>")
    out += ["  </VRTRasterBand>", "</VRTDataset>", ""]
    os.makedirs(os.path.dirname(os.path.abspath(vrt_path)), exist_ok=True)
    tmp = vrt_path + ".part"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))
    os.replace(tmp, vrt_path)


def _self_test() -> None:
    import tempfile

    from rasterio.transform import from_origin

    with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as d:
        def tile(name: str, x0: float, y0: float, fill: float, nodata: float | None, shape: tuple[int, int] = (20, 20)) -> str:
            p = os.path.join(d, name)
            a = np.full(shape, fill, dtype=np.float32)
            with rasterio.open(p, "w", driver="GTiff", height=shape[0], width=shape[1], count=1, dtype="float32", crs="EPSG:28992",
                               transform=from_origin(x0, y0, 0.5, 0.5), nodata=nodata) as dst:
                dst.write(a, 1)
            return p
        # four tiles of a 2 x 2 block, a hole in the first (nodata), and a half-overlapping fifth that must not overwrite valid with nodata
        a = tile("a.tif", 0.0, 20.0, 1.0, -9999.0)
        b = tile("b.tif", 10.0, 20.0, 2.0, -9999.0)
        c = tile("c.tif", 0.0, 10.0, 3.0, -9999.0)
        e = tile("e.tif", 10.0, 10.0, 4.0, -9999.0)
        vrt = os.path.join(d, "m.vrt")
        write_mosaic_vrt(vrt, [a, b, c, e])
        with rasterio.open(vrt) as m:
            assert (m.width, m.height) == (40, 40) and m.crs.to_epsg() == 28992 and m.transform.to_gdal() == (0.0, 0.5, 0.0, 20.0, 0.0, -0.5)
            arr = m.read(1)
        assert arr[0, 0] == 1.0 and arr[0, 39] == 2.0 and arr[39, 0] == 3.0 and arr[39, 39] == 4.0, "tiles land where their transforms say"
        # a window straddling the seam between tiles
        with rasterio.open(vrt) as m:
            w = m.read(1, window=rasterio.windows.Window(15, 15, 10, 10))
        assert set(np.unique(w)) == {1.0, 2.0, 3.0, 4.0}
        # nodata is transparent: an overlapping tile that is all nodata does not erase what is under it
        hole = tile("hole.tif", 0.0, 20.0, -9999.0, -9999.0)
        write_mosaic_vrt(vrt, [a, hole])
        with rasterio.open(vrt) as m:
            assert float(m.read(1)[5, 5]) == 1.0
        # a tile off the pixel lattice, or with another pixel size, is refused rather than resampled
        off = tile("off.tif", 0.25, 20.0, 1.0, -9999.0)
        for bad in (off,):
            try:
                write_mosaic_vrt(vrt, [a, bad])
            except ValueError as ex:
                assert "lattice" in str(ex)
            else:
                raise AssertionError("an off-lattice tile must be refused")
        # a nodata-less (Byte) source uses SimpleSource and reads back
        p = os.path.join(d, "u8.tif")
        with rasterio.open(p, "w", driver="GTiff", height=4, width=4, count=1, dtype="uint8", crs="EPSG:3857", transform=from_origin(0, 4, 1, 1)) as dst:
            dst.write(np.arange(16, dtype=np.uint8).reshape(4, 4), 1)
        p2 = os.path.join(d, "u8b.tif")
        with rasterio.open(p2, "w", driver="GTiff", height=4, width=4, count=1, dtype="uint8", crs="EPSG:3857", transform=from_origin(4, 4, 1, 1)) as dst:
            dst.write(np.full((4, 4), 99, dtype=np.uint8), 1)
        write_mosaic_vrt(vrt, [p, p2])
        with rasterio.open(vrt) as m:
            arr8 = m.read(1)
        assert arr8.shape == (4, 8) and arr8[1, 2] == 6 and arr8[1, 5] == 99
    print("_vrt self-test: ok (tiles land by transform, window across a seam, nodata transparent, off-lattice refused, Byte source)")


if __name__ == "__main__":
    if len(sys.argv) == 1:
        _self_test()
