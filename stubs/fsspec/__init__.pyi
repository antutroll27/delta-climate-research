"""Minimal local stubs — see stubs/h5py/__init__.pyi for the rationale.

Verified surface, 2026-08-10: scripts/icesat2-coverage.py calls
`fsspec.filesystem("http", client_kwargs={...})` then `fs.open(url, "rb",
block_size=...)` as a context manager, handing the handle straight to h5py.
"""
from types import TracebackType
from typing import IO, Any

class AbstractFileSystem:
    def open(self, path: str, mode: str = ..., block_size: int | None = ...,
             **kwargs: Any) -> IO[bytes]: ...
    def __enter__(self) -> AbstractFileSystem: ...
    def __exit__(self, exc_type: type[BaseException] | None,
                 exc: BaseException | None,
                 tb: TracebackType | None) -> None: ...

def filesystem(protocol: str, **kwargs: Any) -> AbstractFileSystem: ...
