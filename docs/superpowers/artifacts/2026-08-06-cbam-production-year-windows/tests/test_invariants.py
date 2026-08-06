"""Structural invariants for the free-allocation benchmark rows.

Annex §5.3 marks production-year variants (1) 2026-27 and (2) 2028-30. Those are
validity windows. A year marker surviving in routeIndicator is the bug this
guards against — defaultFactors never emits such a route, so the row is
unreachable and the good cannot be priced.
"""
import json
import re
import sys
from collections import defaultdict

GOLDEN = "golden/rule-packages/eu-cbam-2026-free-allocation.json"
YEAR_MARKER = re.compile(r"\(\d\)")


def load():
    with open(GOLDEN, encoding="utf-8") as fh:
        return json.load(fh)["benchmarks"]


def test_no_year_marker_in_route(rows):
    bad = [r for r in rows if YEAR_MARKER.search(r.get("routeIndicator") or "")]
    assert not bad, (
        f"{len(bad)} rows carry a production-year marker in routeIndicator; "
        f"first: {bad[0]['id']} route={bad[0]['routeIndicator']!r}"
    )


def test_bounded_rows_have_both_ends(rows):
    bad = [r for r in rows if r.get("validTo") and not r.get("validFrom")]
    assert not bad, f"{len(bad)} rows have validTo without validFrom"


def test_no_group_mixes_bounded_and_open(rows):
    """The dedupe key is (scopeCode, column, routeIndicator, validFrom). It is
    sufficient only while no group holds both a windowed and an unwindowed row —
    otherwise resolveBenchmark sees two active rows for one date and throws
    REGULATION_AMBIGUOUS. True of the current workbook; a reissue could break it.
    """
    groups = defaultdict(set)
    for r in rows:
        key = (r["scopeCode"], r["benchmarkColumn"], r.get("routeIndicator") or "")
        groups[key].add(bool(r.get("validTo")))
    bad = {k: v for k, v in groups.items() if len(v) > 1}
    assert not bad, f"{len(bad)} groups mix bounded and unbounded rows; first: {next(iter(bad))}"


if __name__ == "__main__":
    rows = load()
    failures = 0
    for fn in (test_no_year_marker_in_route, test_bounded_rows_have_both_ends,
               test_no_group_mixes_bounded_and_open):
        try:
            fn(rows)
            print(f"  PASS  {fn.__name__}")
        except AssertionError as exc:
            failures += 1
            print(f"  FAIL  {fn.__name__}: {exc}")
    sys.exit(1 if failures else 0)
