"""Extract one member from a remote ZIP over HTTP range requests. ZIP64-aware.

WHY. DeltaDTM ships as continent archives -- Asia.zip is 9.8 GB -- but the Dubai
tile inside it is 4.6 MB. A ZIP's central directory sits at the END of the file,
so three ranged reads (tail, directory, member) retrieve one tile without pulling
the archive. 4TU returns HTTP 206 with Accept-Ranges, verified 2026-08-25.

Kept separate from the fetchers because it is generic plumbing with no geospatial
knowledge, and because it is the part most likely to need debugging alone.
"""
from __future__ import annotations

import struct
import zlib

import requests

TIMEOUT = 300


def _range(url: str, start: int, end: int) -> bytes:
    resp = requests.get(url, headers={"Range": f"bytes={start}-{end}"}, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.content


def extract(url: str, want: str) -> bytes:
    """Return the decompressed bytes of the first member whose name contains `want`."""
    head = requests.head(url, allow_redirects=True, timeout=60)
    head.raise_for_status()
    total = int(head.headers["Content-Length"])

    tail = _range(url, max(0, total - 66_000), total - 1)
    eocd = tail.rfind(b"PK\x05\x06")
    if eocd < 0:
        raise RuntimeError("no end-of-central-directory record")
    cd_size, cd_off = struct.unpack("<II", tail[eocd + 12:eocd + 20])
    if cd_off == 0xFFFFFFFF or cd_size == 0xFFFFFFFF:          # ZIP64
        z64 = tail.rfind(b"PK\x06\x06")
        if z64 < 0:
            raise RuntimeError("ZIP64 sentinel present but no ZIP64 EOCD")
        cd_size, cd_off = struct.unpack("<QQ", tail[z64 + 40:z64 + 56])

    directory = _range(url, cd_off, cd_off + cd_size - 1)
    pos = 0
    while pos < len(directory) and directory[pos:pos + 4] == b"PK\x01\x02":
        method = struct.unpack("<H", directory[pos + 10:pos + 12])[0]
        csize, usize = struct.unpack("<II", directory[pos + 20:pos + 28])
        nlen, elen, clen = struct.unpack("<HHH", directory[pos + 28:pos + 34])
        local = struct.unpack("<I", directory[pos + 42:pos + 46])[0]
        name = directory[pos + 46:pos + 46 + nlen].decode("utf-8", "replace")
        extra = directory[pos + 46 + nlen:pos + 46 + nlen + elen]
        if 0xFFFFFFFF in (csize, usize, local):                # ZIP64 extra field
            cur = 0
            while cur + 4 <= len(extra):
                hid, hsz = struct.unpack("<HH", extra[cur:cur + 4])
                vals, take = extra[cur + 4:cur + 4 + hsz], 0
                if hid == 1:
                    if usize == 0xFFFFFFFF:
                        usize = struct.unpack("<Q", vals[take:take + 8])[0]; take += 8
                    if csize == 0xFFFFFFFF:
                        csize = struct.unpack("<Q", vals[take:take + 8])[0]; take += 8
                    if local == 0xFFFFFFFF:
                        local = struct.unpack("<Q", vals[take:take + 8])[0]
                cur += 4 + hsz
        if want in name:
            header = _range(url, local, local + 29)
            n2, e2 = struct.unpack("<HH", header[26:30])
            start = local + 30 + n2 + e2
            blob = _range(url, start, start + csize - 1)
            if method == 8:
                return zlib.decompressobj(-zlib.MAX_WBITS).decompress(blob)
            return blob
        pos += 46 + nlen + elen + clen
    raise RuntimeError(f"{want!r} not found in the archive")
