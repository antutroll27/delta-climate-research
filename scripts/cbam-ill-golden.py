#!/usr/bin/env python3
"""Writes tests/unit/fixtures/cbam-ill-golden.json: the approved reference's pictogram and
illustration SVG strings, evaluated from build_bento.py WITHOUT running it (running it rewrites
preview/bento.html). Only the definition blocks are executed, in memory.

Usage: python3 -I scripts/cbam-ill-golden.py /Volumes/VSTSAMPLES/Projects/Angad/docs/superpowers/specs/2026-11-02-cbam-rail-ui/generator/build_bento.py
"""
import hashlib
import json
import os
import sys
from typing import Any

GEN = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'tests', 'unit', 'fixtures', 'cbam-ill-golden.json')
raw = open(GEN, 'rb').read()
src = raw.decode('utf-8')


def cut(a: str, b: str) -> str:
    i = src.index(a)
    j = src.index(b, i)
    return src[i:j]


code = (cut('# ---------- pictograms', 'def dots10')
        + cut('# ================= ILLUSTRATIONS', 'def ins(')
        + cut('def inp_ill(vb, body)', "step = lambda n: f'<span class=\"b-step num\" aria-hidden=\"true\">{n}</span>' + INP[n]"))
ns: dict[str, Any] = {}
exec(code, ns)
gold = {k: ns[k] for k in ('TUBE', 'BAG', 'INGOT', 'SHEET', 'PAPER', 'SHIELD',
                           'ILL_FAC', 'ILL_VOU', 'ILL_STEPS', 'ILL_SCALE', 'ILL_BOX', 'ILL_GAUGE')}
gold.update({f'INP_{n}': ns['INP'][n] for n in (1, 2, 3, 4)})
gold['_source'] = 'build_bento.py sha256 ' + hashlib.sha256(raw).hexdigest()
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(gold, f, indent=1, ensure_ascii=False, sort_keys=True)
    f.write('\n')
print('wrote', OUT, len(gold) - 1, 'strings')
