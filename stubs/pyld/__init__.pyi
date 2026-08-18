"""Minimal local stubs — see stubs/h5py/__init__.pyi for the rationale.

pyld ships no py.typed and has no types-* package on PyPI, so the choice was a
local stub or `ignore_missing_imports`. The stub wins for the same reason it did
for h5py: nothing decays to Any, so a typo'd `jsonld.expaand` is still an error.

Verified surface, 2026-08-19: scripts/check-ngsi-ld.py calls
`jsonld.expand(doc)`, `jsonld.get_document_loader()` and
`jsonld.set_document_loader(fn)`. Extend when a caller needs more.
"""
