"""Do our shipped footprints agree with an INDEPENDENT source?

Ours: Microsoft Global ML Building Footprints (2,048 in Ballygunge).
Theirs: Overture 2026-07-22.0, which merges OSM + Google + Microsoft (3,591).

Two questions this answers, neither ever asked before:
  1. COMPLETENESS -- how many real buildings are we missing?
  2. POSITION    -- when both sources see a building, do they put it in the same place?
"""
import json, math, statistics as st
import duckdb

LAT, LON = 22.528, 88.3659
SIZE_M = 1400.0
PQ = '/private/tmp/claude-501/-Volumes-VSTSAMPLES-Projects-Angad/53a4c9b4-c657-4a22-a9fa-f55db51ee6d8/scratchpad/ballygunge-overture.parquet'

# --- ours: local metre frame already ---
d = json.load(open('public/heat-map/data/ballygunge.json'))
ours = []
for b in d['b']:
    xs, ys = b[1::2], b[2::2]
    ours.append((sum(xs)/len(xs), sum(ys)/len(ys), b[0]))
print(f"  ours (Microsoft):  {len(ours)} footprints")

# --- theirs: bbox centroids -> local metres ---
con = duckdb.connect()
rows = con.execute(f"""
    SELECT (bbox.xmin+bbox.xmax)/2 AS lon, (bbox.ymin+bbox.ymax)/2 AS lat,
           height, num_floors,
           (bbox.xmax-bbox.xmin) AS dx, (bbox.ymax-bbox.ymin) AS dy
    FROM read_parquet('{PQ}')""").fetchall()

M_PER_DEG_LAT = 110574.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(LAT))
theirs = []
for lon, lat, h, nf, dx, dy in rows:
    x = (lon - LON) * M_PER_DEG_LON
    y = (lat - LAT) * M_PER_DEG_LAT
    if abs(x) <= SIZE_M/2 and abs(y) <= SIZE_M/2:
        theirs.append((x, y, h, nf, dx*M_PER_DEG_LON, dy*M_PER_DEG_LAT))
print(f"  theirs (Overture): {len(theirs)} footprints inside the same window")

# --- nearest-neighbour matching, ours -> theirs ---
def nearest(px, py, pool):
    best, bd = None, 1e18
    for t in pool:
        dd = (t[0]-px)**2 + (t[1]-py)**2
        if dd < bd: bd, best = dd, t
    return best, math.sqrt(bd)

dists = []
for ox, oy, _ in ours:
    _, dist = nearest(ox, oy, theirs)
    dists.append(dist)
dists.sort()
n = len(dists)
print(f"\n  OURS -> NEAREST OVERTURE, centroid distance:")
print(f"    median {dists[n//2]:.1f} m · p90 {dists[int(n*.9)]:.1f} m · p99 {dists[int(n*.99)]:.1f} m")
for thr in (5, 10, 20):
    print(f"    within {thr:>2} m: {sum(1 for x in dists if x <= thr)/n:.1%}")

# --- reverse: what do THEY have that we do not? ---
rev = []
for tx, ty, *_ in theirs:
    _, dist = nearest(tx, ty, [(o[0], o[1]) + (0,) for o in ours])
    rev.append(dist)
rev.sort()
m = len(rev)
print(f"\n  OVERTURE -> NEAREST OURS (what we may be missing):")
print(f"    median {rev[m//2]:.1f} m · within 10 m: {sum(1 for x in rev if x <= 10)/m:.1%}")
print(f"    further than 20 m from anything of ours: {sum(1 for x in rev if x > 20)} buildings ({sum(1 for x in rev if x > 20)/m:.1%})")

# --- height cross-check where Overture has anything at all ---
withh = [t for t in theirs if t[2] is not None]
withf = [t for t in theirs if t[3] is not None]
print(f"\n  OVERTURE HEIGHT COVERAGE in-window: height {len(withh)} · num_floors {len(withf)}")
if withf:
    print("    floors -> implied height (x3.1 m) vs our zonal-mean height at that spot:")
    for tx, ty, h, nf, *_ in withf[:12]:
        (ox, oy, oh), dist = nearest(tx, ty, ours)
        print(f"      floors {nf} (~{nf*3.1:.1f} m)  ours {oh:.1f} m  @ {dist:.1f} m away")
