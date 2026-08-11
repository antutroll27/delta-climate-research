#!/usr/bin/env python3
"""Generate a self-contained HTML preview of vegetation placement v2.

Panels: current grid -> +jitter/density -> +exclusion mask. Real Ballygunge data.
Exclusion mask rasterized here (fast); jitter/density re-run live in the browser.
"""
import json
import base64
from pathlib import Path

# Repo-portable: resolve paths relative to the repo root (this file lives at
# docs/superpowers/specs/assets/). Stored 2026-08-11 as the Phase-B exclusion-mask
# reference for the vegetation-placement-v2 spec. Run: python3 <this file>; opens an
# HTML preview of grid vs jitter/density vs exclusion mask over real Ballygunge data.
REPO = Path(__file__).resolve().parents[4]
DATA = REPO / "public/heat-map/data"
OUT = Path(__file__).with_name("veg-placement-preview.html")

trees = json.loads((DATA / "ballygunge-trees.json").read_text())
main = json.loads((DATA / "ballygunge.json").read_text())
roads = json.loads((DATA / "ballygunge-roads.json").read_text())
water = json.loads((DATA / "ballygunge-water.json").read_text())

GRID = trees["grid"]          # 140
SIZE = trees["sizeM"]         # 1400.0
CELL = SIZE / GRID            # 10 m
HALF = SIZE / 2.0

# occupied cells (canopy present) with height -> the density signal
occ = []
maxh = 1.0
for t in trees["trees"]:
    col = round((t["x"] + HALF - CELL / 2.0) / CELL)
    row = round((HALF - CELL / 2.0 - t["y"]) / CELL)  # y north-up -> row from top
    if 0 <= col < GRID and 0 <= row < GRID:
        occ.append([col, row, round(t["h"], 1)])
        maxh = max(maxh, t["h"])

# ---- rasterize exclusion mask at 2x res ----
MRES = GRID * 2               # 280
mcell = SIZE / MRES

def mxy(px, py):
    """metres -> mask (col,row), north-up."""
    c = int((px + HALF) / mcell)
    r = int((HALF - py) / mcell)
    return c, r

mask = bytearray(MRES * MRES)  # 0 free, 1 excluded

def poly_pairs(arr, skip):
    """arr is [meta..., x0,y0,x1,y1,...]; skip leading meta numbers -> (x,y) list."""
    xs = arr[skip:]
    return [(xs[i], xs[i + 1]) for i in range(0, len(xs) - 1, 2)]

def stamp_poly(pts):
    if len(pts) < 3:
        return
    xsv = [p[0] for p in pts]
    ysv = [p[1] for p in pts]
    c0, r1 = mxy(min(xsv), min(ysv))
    c1, r0 = mxy(max(xsv), max(ysv))
    for r in range(max(0, r0), min(MRES, r1 + 1)):
        py = HALF - (r + 0.5) * mcell
        for c in range(max(0, c0), min(MRES, c1 + 1)):
            px = (c + 0.5) * mcell - HALF
            # ray cast
            inside = False
            n = len(pts)
            j = n - 1
            for i in range(n):
                xi, yi = pts[i]
                xj, yj = pts[j]
                if ((yi > py) != (yj > py)) and \
                   (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi):
                    inside = not inside
                j = i
            if inside:
                mask[r * MRES + c] = 1

def stamp_line(pts, buf):
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]
        x1, y1 = pts[i + 1]
        steps = max(1, int(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5 / (mcell / 2)))
        for s in range(steps + 1):
            px = x0 + (x1 - x0) * s / steps
            py = y0 + (y1 - y0) * s / steps
            c, r = mxy(px, py)
            br = int(buf / mcell)
            for dr in range(-br, br + 1):
                for dc in range(-br, br + 1):
                    rr, cc = r + dr, c + dc
                    if 0 <= rr < MRES and 0 <= cc < MRES:
                        mask[rr * MRES + cc] = 1

# buildings: b = list of [height, x0,y0, ...]
nb = 0
for b in main.get("b", []):
    if isinstance(b, list) and len(b) >= 7:
        stamp_poly(poly_pairs(b, 1))
        nb += 1

# roads: ways = list of {"w":class,"p":[x0,y0,...]} -> buffer by class
def flat_pairs(xs):
    return [(xs[i], xs[i + 1]) for i in range(0, len(xs) - 1, 2)]

nr = 0
for w in roads.get("ways", []):
    p = w.get("p") if isinstance(w, dict) else None
    if p and len(p) >= 4:
        buf = 3.0 + 1.5 * float(w.get("w", 1))  # wider class -> wider buffer
        stamp_line(flat_pairs(p), buf=buf)
        nr += 1

# water: polys = list of {"k":..,"p":[x0,y0,...]}
nw = 0
for poly in water.get("polys", []):
    p = poly.get("p") if isinstance(poly, dict) else None
    if p and len(p) >= 6:
        stamp_poly(flat_pairs(p))
        nw += 1

excl_pct = 100.0 * sum(mask) / len(mask)
mask_b64 = base64.b64encode(bytes(mask)).decode()

payload = {
    "grid": GRID, "sizeM": SIZE, "cell": CELL, "half": HALF,
    "mres": MRES, "maxh": round(maxh, 1),
    "occ": occ, "mask_b64": mask_b64,
    "counts": {"buildings": nb, "roads": nr, "water": nw,
               "occupied": len(occ), "excl_pct": round(excl_pct, 1)},
}

HTML = """<!doctype html><html><head><meta charset=utf-8>
<title>Vegetation placement v2 — preview</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.5 system-ui,sans-serif}
 header{padding:16px 20px;border-bottom:1px solid #21262d}
 h1{font-size:16px;margin:0 0 4px} .sub{color:#8b949e;font-size:12px}
 .row{display:flex;gap:16px;padding:20px;flex-wrap:wrap;align-items:flex-start}
 .panel{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:12px}
 .panel h2{font-size:12px;margin:0 0 8px;color:#8b949e;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
 canvas{background:#0a0e14;border-radius:6px;display:block}
 .cnt{color:#7ee787;font-size:12px;margin-top:6px;font-variant-numeric:tabular-nums}
 .controls{padding:0 20px 20px;display:flex;gap:24px;flex-wrap:wrap;align-items:center}
 .controls label{display:flex;flex-direction:column;font-size:12px;color:#8b949e;gap:4px}
 .controls input[type=range]{width:180px}
 .val{color:#e6edf3;font-variant-numeric:tabular-nums}
 .legend{font-size:11px;color:#8b949e;padding:0 20px 24px}
 .swatch{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:middle;margin:0 4px 0 12px}
</style></head><body>
<header>
 <h1>Vegetation placement v2 — Ballygunge (real canopy data)</h1>
 <div class=sub>Current grid → + deterministic jitter &amp; density → + exclusion mask (buildings / roads / water). Seeded hash — byte-stable, no Math.random.</div>
</header>
<div class=controls>
 <label>Density model <span class=val id=mv></span>
   <select id=mode><option value=add>a · additive (≥1/cell, no gaps)</option><option value=redist selected>b · redistributive (0..N, natural gaps)</option></select></label>
 <label>Jitter strength <span class=val id=jv></span><input id=jitter type=range min=0 max=1 step=0.05 value=0.80></label>
 <label>Density (max trees/tall cell) <span class=val id=dv></span><input id=dens type=range min=1 max=4 step=1 value=4></label>
 <label>Dot size <span class=val id=sv></span><input id=dot type=range min=1 max=3 step=0.5 value=1.5></label>
</div>
<div class=row id=panels></div>
<div class=legend>
 <span class=swatch style=background:#f0883e></span>short canopy
 <span class=swatch style=background:#3fb950></span>tall canopy
 <span class=swatch style=background:#8b949e></span>excluded footprint/road/water
 &nbsp;&nbsp;|&nbsp;&nbsp;<span id=meta></span>
</div>
<script>
const D = __PAYLOAD__;
const PX = 460, S = PX / D.sizeM;
const mask = Uint8Array.from(atob(D.mask_b64), c=>c.charCodeAt(0));
function mExcl(px,py){ // metres -> mask lookup
  const c=(px+D.half)/(D.sizeM/D.mres)|0, r=(D.half-py)/(D.sizeM/D.mres)|0;
  if(c<0||c>=D.mres||r<0||r>=D.mres) return false;
  return mask[r*D.mres+c]===1;
}
// deterministic hash -> [0,1)
function h2(a,b){let x=(a*73856093)^(b*19349663);x=(x^(x>>>13))>>>0;x=(x*1274126177)>>>0;return (x>>>0)/4294967296;}
function colorFor(h){const t=Math.min(1,h/D.maxh);const r=Math.round(240-(240-63)*t),g=Math.round(136+(185-136)*t),b=Math.round(62+(80-62)*t);return `rgb(${r},${g},${b})`;}

function build(mode, jitter, dmax, dmodel){
  const pts=[];
  for(const [col,row,hh] of D.occ){
    const cx=(col+0.5)*D.cell - D.half;
    const cy=D.half-(row+0.5)*D.cell;
    let n;
    if(mode==='grid') n=1;
    else if(dmodel==='redist') n=Math.round(dmax*(hh/D.maxh));   // b: 0..N, natural gaps
    else n=Math.max(1, Math.round(1 + (dmax-1)*(hh/D.maxh)));    // a: >=1, no gaps
    if(n<=0) continue;
    for(let k=0;k<n;k++){
      let x=cx, y=cy;
      if(mode!=='grid'){
        const jx=(h2(col*31+k, row*17+7)-0.5)*jitter*D.cell;
        const jy=(h2(col*13+k+3, row*29+11)-0.5)*jitter*D.cell;
        x+=jx; y+=jy;
      }
      if(mode==='excl' && mExcl(x,y)) continue;
      pts.push([x,y,hh]);
    }
  }
  return pts;
}
function draw(cv, pts, dot, showMask){
  const g=cv.getContext('2d'); g.clearRect(0,0,PX,PX);
  if(showMask){
    g.globalAlpha=0.18; g.fillStyle='#8b949e';
    const mc=PX/D.mres;
    for(let r=0;r<D.mres;r++)for(let c=0;c<D.mres;c++) if(mask[r*D.mres+c]) g.fillRect(c*mc,r*mc,mc+0.5,mc+0.5);
    g.globalAlpha=1;
  }
  for(const [x,y,hh] of pts){
    const px=(x+D.half)*S, py=(D.half-y)*S;
    g.fillStyle=colorFor(hh); g.beginPath(); g.arc(px,py,dot,0,7); g.fill();
  }
}
const modes=[['grid','1 · Current grid (cell centres)'],['jd','2 · + Jitter & density'],['excl','3 · + Exclusion mask']];
const panels=document.getElementById('panels'); const cvs={};
for(const [m,title] of modes){
  const d=document.createElement('div'); d.className='panel';
  d.innerHTML=`<h2>${title}</h2><canvas width=${PX} height=${PX}></canvas><div class=cnt id=cnt-${m}></div>`;
  panels.appendChild(d); cvs[m]=d.querySelector('canvas');
}
function render(){
  const j=+jitter.value, dm=+dens.value, dot=+document.getElementById('dot').value, dmodel=document.getElementById('mode').value;
  jv.textContent=j.toFixed(2); dv.textContent=dm; sv.textContent=dot; mv.textContent=dmodel==='redist'?'b':'a';
  for(const [m] of modes){
    const pts=build(m, j, dm, dmodel);
    draw(cvs[m], pts, dot, m==='excl');
    document.getElementById('cnt-'+m).textContent=pts.length.toLocaleString()+' trees';
  }
}
for(const el of [jitter,dens,document.getElementById('dot'),document.getElementById('mode')]) el.addEventListener('input',render);
document.getElementById('meta').textContent=`${D.counts.buildings} buildings · ${D.counts.roads} roads · ${D.counts.water} water polys · ${D.counts.occupied} occupied cells · ${D.counts.excl_pct}% of area excluded`;
render();
</script></body></html>"""

OUT.write_text(HTML.replace("__PAYLOAD__", json.dumps(payload)))
print("wrote", OUT)
print("counts:", payload["counts"])
