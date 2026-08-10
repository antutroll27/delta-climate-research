"""Are our building heights systematically low?

Ours are Google Open Buildings 2.5D zonal-averaged per Microsoft footprint.
Averaging over a footprint mixes in lower annexes, courtyards and shadow, which
should bias the mean DOWN. Five Overture-tagged buildings hinted at exactly that
(22-40 % low). This gets a real sample from OSM, the only independent height
source that exists for Kolkata.

OSM building:levels is hand-surveyed. Storey height in Indian urban construction
is ~3.0-3.2 m floor-to-floor; 3.1 is used, and the conclusion is checked against
2.9 and 3.3 so it cannot rest on that constant.
"""
import json, math, statistics as st
import requests
from typing import Any, cast

WARDS = {'ballygunge': (22.528, 88.3659), 'barrackpore': (22.7621, 88.3713), 'baruipur': (22.3654, 88.4319)}
SIZE_M = 1400.0
OVERPASS = "https://overpass-api.de/api/interpreter"

def fetch_levels(lat: float, lon: float) -> list[dict[str, Any]]:
    d_lat = (SIZE_M/2)/110574
    d_lon = (SIZE_M/2)/(111320*math.cos(math.radians(lat)))
    q = f"""[out:json][timeout:90];
    way["building"]["building:levels"]({lat-d_lat},{lon-d_lon},{lat+d_lat},{lon+d_lon});
    out center tags;"""
    r = requests.post(OVERPASS, data={'data': q}, timeout=120,
                      headers={'User-Agent': 'delta-climate-research height validation'})
    r.raise_for_status()
    return cast(list[dict[str, Any]], r.json().get('elements', []))

for ward, (lat, lon) in WARDS.items():
    els = fetch_levels(lat, lon)
    d = json.load(open(f'public/heat-map/data/{ward}.json'))
    ours = []
    for b in d['b']:
        xs, ys = b[1::2], b[2::2]
        ours.append((sum(xs)/len(xs), sum(ys)/len(ys), b[0]))

    M_LAT, M_LON = 110574.0, 111320.0*math.cos(math.radians(lat))
    pairs = []
    for e in els:
        c = e.get('center') or {}
        if 'lat' not in c: continue
        try: lv = float(str(e['tags']['building:levels']).split(';')[0])
        except (ValueError, KeyError): continue
        if not (1 <= lv <= 60): continue
        x = (c['lon']-lon)*M_LON; y = (c['lat']-lat)*M_LAT
        if abs(x) > SIZE_M/2 or abs(y) > SIZE_M/2: continue
        best, bd = None, 1e18
        for ox, oy, oh in ours:
            dd = (ox-x)**2 + (oy-y)**2
            if dd < bd: bd, best = dd, oh
        if best is not None and math.sqrt(bd) <= 12.0:   # same building, not a neighbour
            pairs.append((lv, best))

    print(f"\n  {ward.upper()}  OSM tagged {len(els)} · matched within 12 m: {len(pairs)}")
    if len(pairs) < 5:
        print("    too few to conclude"); continue
    for spm in (2.9, 3.1, 3.3):
        ratios = [ours_h/(lv*spm) for lv, ours_h in pairs]
        diffs  = [ours_h-(lv*spm) for lv, ours_h in pairs]
        print(f"    storey {spm} m -> ours/OSM median ratio {st.median(ratios):.2f} · "
              f"median diff {st.median(diffs):+.1f} m · mean diff {st.mean(diffs):+.1f} m")
    lows = sum(1 for lv, oh in pairs if oh < lv*3.1)
    print(f"    ours is LOWER than OSM implies in {lows}/{len(pairs)} cases ({lows/len(pairs):.0%})")
