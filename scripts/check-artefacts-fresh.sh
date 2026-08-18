#!/bin/sh
# Are the COMMITTED artefacts still what their generators produce?
#
# Most of this site's data is generated at build time by Astro, so it cannot go
# stale. Two things are not: public/3d-tiles/ and data/indicators/, which are
# written by Python scripts and committed. `npm run build` does not regenerate
# them, so editing a raster or a ward centre without re-running the generator
# leaves the tileset quietly disagreeing with the map — buildings at last
# month's heights, indicators computed from a raster that has since changed.
# Nothing detected that, and the failure is silent by construction.
#
# Both generators are deterministic (no timestamps, no randomness), so
# regenerating and diffing is an exact test. Verified 2026-08-19: a clean
# regeneration is byte-identical.
set -e
cd "$(dirname "$0")/.."
PATHS="public/3d-tiles data/indicators"

if ! git diff --quiet -- $PATHS 2>/dev/null; then
  echo "  artefacts have uncommitted edits — commit or stash before checking freshness"
  exit 0
fi

(cd scripts && python3 build-3d-tiles.py >/dev/null)
python3 scripts/build-city-indicators.py >/dev/null

if git diff --quiet -- $PATHS; then
  echo "  committed artefacts match their generators"
  exit 0
fi
echo "  STALE — these committed artefacts no longer match what their generators produce:"
git diff --stat -- $PATHS | sed 's/^/    /'
echo "    regenerate and commit:  (cd scripts && python3 build-3d-tiles.py) && python3 scripts/build-city-indicators.py"
exit 1
