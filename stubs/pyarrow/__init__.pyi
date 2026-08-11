"""Minimal local stubs — see stubs/h5py/__init__.pyi for the rationale.

Verified surface, 2026-08-10: scripts/build-footprint-provenance.py calls
`pq.read_table(path, columns=[...])` then `.column(name).to_pylist()`.
"""
from typing import Any

class ChunkedArray:
    def to_pylist(self) -> list[Any]: ...
    def __len__(self) -> int: ...

class Table:
    num_rows: int
    def column(self, name: str) -> ChunkedArray: ...
    def column_names(self) -> list[str]: ...
