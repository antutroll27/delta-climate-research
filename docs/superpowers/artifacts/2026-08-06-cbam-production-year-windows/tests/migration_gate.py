"""One-off migration gate: the year-window change must not move a single value.

Run once, during this migration, then delete. It answers exactly one question —
did we corrupt the data — and nothing else.
"""
import json
import sys
from collections import Counter

BASE = "baseline.json"
NEW = "golden/rule-packages/eu-cbam-2026-free-allocation.json"
MUTABLE = {"id", "routeIndicator", "validFrom", "validTo"}


def rows(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["benchmarks"]


old, new = rows(BASE), rows(NEW)
failures = []

if len(old) != len(new):
    failures.append(f"row count changed: {len(old)} -> {len(new)}")

# The property that matters: every value still present, on the same CN and column.
old_values = Counter((r["scopeCode"], r["benchmarkColumn"], r["bmTco2ePerT"]) for r in old)
new_values = Counter((r["scopeCode"], r["benchmarkColumn"], r["bmTco2ePerT"]) for r in new)
if old_values != new_values:
    lost = old_values - new_values
    gained = new_values - old_values
    failures.append(f"VALUES MOVED. lost={list(lost)[:5]} gained={list(gained)[:5]}")

# Only the four expected fields may differ, and only where a year marker existed.
by_locator_old = {r["sourceLocator"]: r for r in old}
by_locator_new = {r["sourceLocator"]: r for r in new}
if set(by_locator_old) != set(by_locator_new):
    failures.append("sourceLocator set changed — provenance strings are not stable")
else:
    for loc, o in by_locator_old.items():
        n = by_locator_new[loc]
        for field in o.keys() | n.keys():
            if field in MUTABLE:
                continue
            if o.get(field) != n.get(field):
                failures.append(f"immutable field {field!r} changed on {loc[:70]}")
                break

changed = sum(1 for loc, o in by_locator_old.items()
              if by_locator_new[loc].get("validTo"))
print(f"rows gaining a bounded window: {changed}")
print(f"total rows: {len(new)}")

if failures:
    print("\nGATE FAILED")
    for f in failures[:10]:
        print("  -", f)
    sys.exit(1)
print("\nGATE PASSED — no benchmark value moved, provenance stable")
