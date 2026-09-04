#!/bin/bash
# Unattended chain: finish the running solves, score them, then give the two
# most informative configurations twice as long to route, and score again.
#
# WHY 144 h. The observed storm is 72 h of real April 2024 rainfall. A 72 h
# window therefore ends the instant the record ends, leaving no dry time for
# water to find the low ground -- and Landsat imaged Dubai THREE DAYS after the
# rain. Doubling the window zero-pads the hyetograph: same rain, same rate, then
# 72 h of drainage. That is the settled state the satellite actually saw.
set -u
cd "$(dirname "$0")/.."
log() { echo "[$(date +%H:%M)] $*"; }

log "waiting for the four running solves"
for p in "$@"; do while kill -0 "$p" 2>/dev/null; do sleep 30; done; done
log "all solves finished"

log "scoring the 72 h family"
python3 scripts/score-flood-methods.py > /tmp/score-72h.txt 2>&1
tail -25 /tmp/score-72h.txt

# Pick the infiltration value that placed water best, not the one that produced
# the most of it. CSI is matched-prevalence, so it scores PLACEMENT only.
BEST=$(python3 - <<'PY'
import json
d = json.load(open("public/flood-sim/flood-method-scores.json"))
runs = {k: v["csi"] for k, v in d["methods"].items()
        if k.startswith("solver-") and "obs" in k and k.endswith("peak")}
if not runs:
    print("38.6"); raise SystemExit
best = max(runs, key=lambda k: runs[k])
tag = best.split("-f")[1].split("-")[0] if "-f" in best else "38.6"
print(tag)
PY
)
log "best-placing infiltration from the sweep: ${BEST} mm/h"

log "launching 144 h runs (baseline 38.6 and best ${BEST})"
nohup python3 scripts/run-routing-window-test.py --storm observed --hours 144 \
  > /tmp/imerg-144h.log 2>&1 &
P1=$!
if [ "$BEST" != "38.6" ]; then
  nohup python3 scripts/run-routing-window-test.py --storm observed --hours 144 \
    --ground-f "$BEST" > /tmp/imerg-144h-f${BEST}.log 2>&1 &
  P2=$!
else
  P2=""
fi
for p in $P1 $P2; do while kill -0 "$p" 2>/dev/null; do sleep 30; done; done
log "144 h runs finished"

log "final scoreboard"
python3 scripts/score-flood-methods.py > /tmp/score-final.txt 2>&1
tail -30 /tmp/score-final.txt
log "DONE -- /tmp/score-72h.txt and /tmp/score-final.txt"
