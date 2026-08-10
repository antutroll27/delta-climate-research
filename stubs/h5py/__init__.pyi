"""Minimal local stubs for the h5py surface this repo actually uses.

WHY THESE EXIST. h5py ships no py.typed marker and PyPI has no types-h5py, so
mypy would treat the whole library as Any — which mypy.ini argues against at
length, because calls on Any are never flagged and a typo'd method would sail
through. Rather than blind the checker, this pins the four things we call.

SCOPE IS DELIBERATELY TINY: `File` as a context manager, membership, nested
lookup, slicing to a numpy array, and `.attrs.get`. If a future caller needs
more of h5py, add it here — do not reach for `ignore_missing_imports`.

Verified against the real call sites 2026-08-10:
    scripts/fetch-icesat2.py     h5py.File(path|fileobj, "r"), decide(f, ...)
    scripts/icesat2-coverage.py  beam in f, f[beam]["geolocation/x"][:], .attrs.get
"""
from types import TracebackType
from typing import IO, Any, overload

import numpy as np
import numpy.typing as npt

class AttributeManager:
    def get(self, name: str, default: Any = ...) -> Any: ...
    def __getitem__(self, name: str) -> Any: ...
    def __contains__(self, name: str) -> bool: ...

class Node:
    """A group or a dataset. HDF5 does not distinguish them until you index.

    The overloads are what keep this useful: a STRING key walks the tree and
    returns another node, a SLICE materialises the dataset as a numpy array.
    That is exactly the `f[beam]["geolocation/x"][:]` idiom, typed end to end.
    """
    attrs: AttributeManager
    shape: tuple[int, ...]
    dtype: np.dtype[Any]
    @overload
    def __getitem__(self, key: str) -> Node: ...
    @overload
    def __getitem__(self, key: slice | int | npt.NDArray[np.bool_]) -> npt.NDArray[Any]: ...
    def __contains__(self, key: str) -> bool: ...
    def keys(self) -> Any: ...
    def __len__(self) -> int: ...

class File(Node):
    def __init__(self, name: str | IO[bytes] | Any, mode: str = ...) -> None: ...
    def __enter__(self) -> File: ...
    def __exit__(self, exc_type: type[BaseException] | None,
                 exc: BaseException | None,
                 tb: TracebackType | None) -> None: ...
    def close(self) -> None: ...
