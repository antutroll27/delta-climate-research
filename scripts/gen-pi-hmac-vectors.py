#!/usr/bin/env python3
"""Shared HMAC test vectors for the Pi -> OBOS signing contract (spec 2026-09-29 §3).

The Go suite (pi/internal/ingest) and the TypeScript suite (tests/unit/relay-auth)
both assert every entry. The expected signatures come from Python's own hmac and
hashlib, so neither implementation under test grades its own homework.

    signature = "v1=" + hex(HMAC-SHA256(key, f"{timestamp}.{hex(SHA-256(body))}"))

Run:   python3 scripts/gen-pi-hmac-vectors.py           (writes the fixture)
Check: python3 scripts/gen-pi-hmac-vectors.py --check   (fails if the fixture drifted)

The keys are fixed test values, not secrets.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import sys
from pathlib import Path
from typing import TypedDict

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "pi" / "hmac-vectors.json"


class Vector(TypedDict):
    name: str
    key_hex: str
    timestamp: int
    body_hex: str
    expected_signature: str


def sign(key: bytes, timestamp: int, body: bytes) -> str:
    digest = hashlib.sha256(body).hexdigest()
    mac = hmac.new(key, f"{timestamp}.{digest}".encode("ascii"), hashlib.sha256)
    return "v1=" + mac.hexdigest()


def vector(name: str, key: bytes, timestamp: int, body: bytes) -> Vector:
    return {
        "name": name,
        "key_hex": key.hex(),
        "timestamp": timestamp,
        "body_hex": body.hex(),
        "expected_signature": sign(key, timestamp, body),
    }


def vectors() -> list[Vector]:
    return [
        vector("ping: empty body", bytes(range(32)), 1790000000, b""),
        vector("small XML body", bytes([0xA5]) * 32, 1790000123,
               b'<AqIndex><Station id="x" lastupdate="27-09-2026 05:00:00"/></AqIndex>'),
        vector("non-ASCII and non-UTF-8 bytes", bytes(range(100, 132)), 1790000456,
               "Bāruipur – ₹ ‘quote’".encode("utf-8") + b"\x00\xff\x80\xfe"),
        # 100 bytes: longer than SHA-256's 64-byte block, so HMAC hashes the key first.
        vector("long key (100 bytes)", bytes((i * 7) % 256 for i in range(100)), 1790000789,
               b"long key"),
        vector("gzip header bytes", bytes([0x3C]) * 48, 1790001000,
               bytes([0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xFF])),
    ]


def render() -> str:
    return json.dumps(vectors(), indent=2, ensure_ascii=True) + "\n"


def main(argv: list[str]) -> int:
    text = render()
    if argv[1:] == ["--check"]:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print(f"{OUT} is missing or stale: run python3 scripts/gen-pi-hmac-vectors.py", file=sys.stderr)
            return 1
        print(f"ok: {len(vectors())} vectors match")
        return 0
    if argv[1:]:
        print("usage: gen-pi-hmac-vectors.py [--check]", file=sys.stderr)
        return 2
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {len(vectors())} vectors to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
