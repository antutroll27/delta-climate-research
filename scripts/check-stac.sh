#!/bin/sh
# External STAC validation. Like the CityJSON and 3D Tiles gates: the schema is
# the authority, not our own tests. stac_valid is a Python package, so it is
# reported as SKIPPED (never "passed") when absent — an unrun check must not read
# as a clean one.
set -e
ROOT="$(dirname "$0")/.."
if ! command -v stac-valid >/dev/null 2>&1; then
  echo "  stac-valid not installed — STAC validation SKIPPED (not passed)."
  echo "  install: python3 -m pip install stac_valid"
  exit 0
fi
bad=0
for f in "$ROOT"/dist/api/stac/catalog.json "$ROOT"/dist/api/stac/collections/*.json "$ROOT"/dist/api/stac/items/*.json; do
  [ -f "$f" ] || continue
  if stac-valid validate "$f" 2>&1 | grep -q '"valid_stac": true'; then
    echo "  ok   $(echo "$f" | sed 's|.*/dist/api/stac/||')"
  else
    echo "  FAIL $(echo "$f" | sed 's|.*/dist/api/stac/||')"
    stac-valid validate "$f" 2>&1 | grep -oE '"error_message":[^,]*' | head -1 | sed 's/^/       /'
    bad=$((bad+1))
  fi
done
[ "$bad" -eq 0 ] && echo "  all STAC documents valid" || echo "  $bad STAC document(s) FAILED"
exit $bad
