#!/bin/zsh
# Fetch every Luchtmeetnet station detail (fair use: 100 requests / 5 min, so 50 then a pause).
UA='obos-pipeline/1.0 (+https://deltaclimate.earth)'
OUT=/Volumes/OBOSLab/worktrees/aqi-new-cities/plan-scratch/lm_det
mkdir -p $OUT
python3 -c "
import json
for p in range(1,6):
    for s in json.load(open('/Volumes/OBOSLab/worktrees/aqi-new-cities/tests/fixtures/aqi/nl/stations-all-p%d.json'%p))['data']: print(s['number'])
" > $OUT/numbers.txt
n=0
while read -r num; do
  [ -s $OUT/$num.json ] && continue
  curl -sS -A "$UA" -o $OUT/$num.json "https://api.luchtmeetnet.nl/open_api/stations/$num"
  n=$((n+1)); sleep 0.5
  if [ $((n % 50)) -eq 0 ]; then sleep 300; fi
done < $OUT/numbers.txt
echo done
