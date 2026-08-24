#!/bin/bash
D=/Volumes/VSTSAMPLES/Projects/HarnessHome/research/.firecrawl
name="$1"; shift
ok=0
for attempt in 1 2 3; do
  rm -f "$D/$name.json"
  firecrawl search "$*" --limit 6 -o "$D/$name.json" --json 2>/dev/null && [ -s "$D/$name.json" ] && ok=1 && break
  echo "...$name attempt $attempt failed, sleeping 35s"; sleep 35
done
id=$(jq -r '.id // empty' "$D/$name.json" 2>/dev/null)
n=$(jq -r '(.data.web // []) | length' "$D/$name.json" 2>/dev/null)
echo "=== $name (ok=$ok, $n results) ==="
jq -r '.data.web[] | ("• " + (.title // "—") + " | " + (.url // "?") + "\n  " + ((.description // "") | gsub("\n";" ") | .[0:230]))' "$D/$name.json" 2>/dev/null
if [ -n "$id" ] && [ "${n:-0}" -ge 3 ]; then
  v=$(jq -c '[.data.web[0:2][] | {url: .url, reason: "useful"}]' "$D/$name.json" 2>/dev/null)
  firecrawl search-feedback "$id" --rating good --valuable-sources "$v" --silent >/dev/null 2>&1 &
fi
