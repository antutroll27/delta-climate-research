# 3D Terrain Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local preview cloning the live `/heat-map` stack with real terrain under the existing buildings, roads and water, so the user can judge whether terrain earns a place on the shipped map.

**Architecture:** One offline Python script bakes a smoothed 128² heightfield per ward from AWS terrarium tiles into `previews/terrain-3d/data/`. One self-contained preview page (house pattern: CDN MapLibre 4.7.1 + three importmap, single `index.html`) clones the live custom-layer stack and displaces ground/buildings/roads/water through a single `terrainAt()` sampler. Nothing under `src/` or `public/` changes.

**Contract:** [`../specs/2026-08-04-terrain-3d-preview-design.md`](../specs/2026-08-04-terrain-3d-preview-design.md)

**Tech Stack:** Python 3.12 (`requests` + PIL — `urllib` fails on this machine's SSL bundle), MapLibre GL 4.7.1, three 0.184 via unpkg importmap, puppeteer-core for captures.

**Three spec deviations, all amended in Task 2 so the documents stay truthful:**
1. **The relief-span tripwire must compare the RAW crop, not the smoothed output.** The spec's §4 constants (8.9/6.4/7.5 m p5–p95) were measured before smoothing; the median filter exists precisely to shrink them. As written the tripwire always fails. The script asserts the raw span against the constants and records both spans in the artefact.
2. **Preview water is a plain translucent fill, not the shipped depth-band shader.** The shader lives in `src/scripts/climate-engine/water-layer.ts` (TypeScript — a plain module script cannot import it) and water is not what is on trial. Geometry still rides the terrain.
3. **Preview ground is a labelled static stand-in, not the live heat field.** The live colouring is the sim's output; the preview has no sim. The ward's measured `-surface.png` vegetation channel through the house ramp is visually close to the live relief mode, and the HUD says "static stand-in field" so nobody mistakes it for physics.

---

### Task 1: `scripts/fetch-terrain.py` — acquisition + `--check`

**Files:**
- Create: `scripts/fetch-terrain.py`
- Creates at runtime: `previews/terrain-3d/data/{ballygunge,barrackpore,baruipur}-terrain.json`

House idiom for acquisition scripts (`fetch-water.py`, `fetch-opencity.py`): named constants, provenance in band, `--check` as the test, byte-stable regeneration, proof the guard fires.

- [ ] **Step 1: Write the script**

```python
"""Terrarium tiles -> one smoothed 128^2 heightfield per ward, for the terrain preview.

WHY SMOOTHING IS THE WHOLE JOB. Every free DEM of this delta is a SURFACE model
(terrarium is SRTM-derived here) -- rooftops and canopy ride in the "ground".
Measured raw relief across each 1400 m window is 6.4-8.9 m p5-p95; honest bare
earth is ~3-5 m. A ~40 m median filter removes single buildings and keeps the
Hooghly embankment and swales, and the artefact records both spans so the
smoothing is visible, not implied.

PREVIEW-SIDE ONLY. Output lands in previews/terrain-3d/data/, never public/.

    python3 scripts/fetch-terrain.py            # bake all three wards
    python3 scripts/fetch-terrain.py --check    # assert over the committed artefacts
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import statistics
import sys

import requests
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT_DIR = os.path.join(ROOT, "previews", "terrain-3d", "data")

TILE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
Z = 15                       # ~4.4 m/px at this latitude; window ~317 px wide
N = 128                      # texels per side -> ~11 m/texel over 1400 m
SIZE_M = 1400.0              # the instrument's ward window, edge to edge
SMOOTH_RADIUS_M = 40.0       # median-filter radius: wider than a building, narrower than the embankment
CLAMP_M = 12.0               # residual clamped to +/- this around the window median
RETRIEVED = "2026-08-04"     # constant, not date.today() -- byte-stable regeneration

#: lat, lon of each ward window centre (same values as src/scripts/climate-engine/wards.ts)
WARDS = {
    "ballygunge": (22.528, 88.3659),
    "barrackpore": (22.7621, 88.3713),
    "baruipur": (22.3654, 88.4319),
}

#: RAW p5-p95 relief measured 2026-08-03 on these exact windows, BEFORE smoothing.
#: The tripwire: if a future re-run's raw span drifts past +/-30 % of these, the
#: tile source changed under us and the artefact must not be silently accepted.
RAW_SPAN_M = {"ballygunge": 8.9, "barrackpore": 6.4, "baruipur": 7.5}


# -- pure helpers ------------------------------------------------------------

def tile_xy(lat: float, lon: float) -> tuple[float, float]:
    """Fractional web-mercator tile coordinates at zoom Z."""
    n = 2 ** Z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def decode(px: tuple[int, ...]) -> float:
    """Terrarium encoding: metres = (R*256 + G + B/256) - 32768."""
    return px[0] * 256 + px[1] + px[2] / 256 - 32768


def p5_p95(values: list[float]) -> tuple[float, float]:
    s = sorted(values)
    return s[len(s) // 20], s[int(len(s) * 0.95)]


def median_filter(field: list[float], n: int, radius: int) -> list[float]:
    """Median over a (2r+1)^2 window, edge-clamped. O(n^2 r^2) -- fine at 128^2."""
    out = [0.0] * (n * n)
    for row in range(n):
        for col in range(n):
            window = []
            for dr in range(-radius, radius + 1):
                r = min(n - 1, max(0, row + dr))
                for dc in range(-radius, radius + 1):
                    c = min(n - 1, max(0, col + dc))
                    window.append(field[r * n + c])
            out[row * n + col] = statistics.median(window)
    return out


# -- acquisition -------------------------------------------------------------

def fetch_window(lat: float, lon: float) -> list[float]:
    """RAW N^2 heightfield over the SIZE_M window, nearest-sampled from z15 tiles.

    Nearest, not bilinear: at ~4.4 m/px source vs ~11 m/texel output the median
    filter downstream swallows any sampling difference, and nearest keeps this loop
    trivially fast in pure Python.
    """
    cx, cy = tile_xy(lat, lon)
    m_per_px = 40075016.7 * math.cos(math.radians(lat)) / (2 ** Z * 256)
    half_px = (SIZE_M / 2) / m_per_px

    tiles: dict[tuple[int, int], Image.Image] = {}

    def px_at(gx: float, gy: float) -> float:
        tx, ty = int(gx // 256), int(gy // 256)
        if (tx, ty) not in tiles:
            r = requests.get(TILE.format(z=Z, x=tx, y=ty), timeout=60)
            r.raise_for_status()
            tiles[(tx, ty)] = Image.open(io.BytesIO(r.content)).convert("RGB")
        return decode(tiles[(tx, ty)].getpixel((int(gx) % 256, int(gy) % 256)))

    field = []
    for row in range(N):
        for col in range(N):
            gx = cx * 256 - half_px + (col + 0.5) / N * 2 * half_px
            gy = cy * 256 - half_px + (row + 0.5) / N * 2 * half_px
            field.append(px_at(gx, gy))
    return field


def build_artefact(ward: str) -> dict:
    lat, lon = WARDS[ward]
    raw = fetch_window(lat, lon)
    raw_lo, raw_hi = p5_p95(raw)

    radius_tx = max(1, round(SMOOTH_RADIUS_M / (SIZE_M / N)))
    smooth = median_filter(raw, N, radius_tx)
    med = statistics.median(smooth)
    h = [round(max(-CLAMP_M, min(CLAMP_M, v - med)), 1) for v in smooth]
    sm_lo, sm_hi = p5_p95(h)

    return {
        "ward": ward,
        "source": "AWS Open Data terrain tiles (terrarium z15; SRTM-derived over India)",
        "licence": "elevation public domain (SRTM/NASA); tile assembly per Mapzen attribution list",
        "retrieved": RETRIEVED,
        "n": N,
        "sizeM": SIZE_M,
        "medianM": round(med, 1),
        "smoothRadiusM": SMOOTH_RADIUS_M,
        "clampM": CLAMP_M,
        "rawSpanM": round(raw_hi - raw_lo, 1),      # BEFORE smoothing -- the tripwire's subject
        "smoothSpanM": round(sm_hi - sm_lo, 1),     # AFTER -- what the eye will see
        "note": "smoothed surface model, indicative -- not surveyed ground",
        "h": h,
    }


def serialise(doc: dict) -> str:
    return json.dumps(doc, separators=(",", ":")) + "\n"


# -- commands ----------------------------------------------------------------

def check() -> int:
    failures: list[str] = []
    for ward in WARDS:
        path = os.path.join(OUT_DIR, f"{ward}-terrain.json")
        if not os.path.exists(path):
            failures.append(f"{ward}: artefact missing -- run without --check first")
            continue
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        if len(d["h"]) != N * N:
            failures.append(f"{ward}: expected {N*N} texels, found {len(d['h'])}")
        if any(abs(v) > CLAMP_M for v in d["h"]):
            failures.append(f"{ward}: a texel escapes the +/-{CLAMP_M} m clamp")
        expect = RAW_SPAN_M[ward]
        if not (0.7 * expect <= d["rawSpanM"] <= 1.3 * expect):
            failures.append(f"{ward}: raw span {d['rawSpanM']} m vs measured {expect} m "
                            f"-- the tile source changed under the artefact")
        if d["smoothSpanM"] > d["rawSpanM"]:
            failures.append(f"{ward}: smoothing INCREASED the span -- filter broken")
    if failures:
        for line in failures:
            print(f"  FAIL {line}")
        return 1
    for ward in WARDS:
        with open(os.path.join(OUT_DIR, f"{ward}-terrain.json"), encoding="utf-8") as fh:
            d = json.load(fh)
        print(f"    {ward:<12} median {d['medianM']:>5} m ASL · raw span {d['rawSpanM']} m "
              f"-> smoothed {d['smoothSpanM']} m")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    if parser.parse_args().check:
        return check()
    os.makedirs(OUT_DIR, exist_ok=True)
    for ward in WARDS:
        doc = build_artefact(ward)
        path = os.path.join(OUT_DIR, f"{ward}-terrain.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(serialise(doc))
        print(f"  {ward}: {os.path.getsize(path):,} B")
    return check()


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run it**

Run: `python3 scripts/fetch-terrain.py`
Expected: three `{ward}: N B` lines, then the `--check` summary with raw → smoothed spans. Raw spans must land near 8.9 / 6.4 / 7.5 m.

- [ ] **Step 3: Byte-stability**

Run: `python3 scripts/fetch-terrain.py && git status --short previews/terrain-3d/data/ | wc -l` after an initial `git add -N` of the dir — or simpler: run twice, `shasum previews/terrain-3d/data/*.json` between runs, hashes identical.
Expected: identical hashes.

- [ ] **Step 4: Prove the tripwire fires**

Run: `python3 -c "import json;p='previews/terrain-3d/data/ballygunge-terrain.json';d=json.load(open(p));d['rawSpanM']=2.0;open(p,'w').write(json.dumps(d,separators=(',',':'))+'\n')" && python3 scripts/fetch-terrain.py --check; echo "exit $?"`
Expected: `FAIL ballygunge: raw span 2.0 m vs measured 8.9 m …`, exit 1. Then regenerate: `python3 scripts/fetch-terrain.py` → green.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-terrain.py previews/terrain-3d/data/
git commit -m "feat(terrain): bake smoothed ward heightfields from terrarium tiles

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Spec amendments

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-terrain-3d-preview-design.md` (§4 tripwire sentence, §5 water item)

- [ ] **Step 1: Amend §4** — replace the tripwire sentence with:

> `--check` asserts: n = 128², |h| ≤ clampM, byte-identical regeneration, and that each artefact's **raw pre-smoothing** p5–p95 span lands within ±30 % of the measured relief above (drift tripwire against a silently changed tile source). The artefact records `rawSpanM` and `smoothSpanM` so the smoothing is visible, not implied.

- [ ] **Step 2: Amend §5 water item** — replace with:

> **Water** — polygon geometry rides the terrain at `terrainAt` of its centroid, drawn as a plain translucent fill. The shipped depth-band shader is TypeScript inside `src/` and cannot be imported by a plain preview page; water is not what is on trial here, terrain is.

- [ ] **Step 2b: Amend §5 ground item** — replace "the heat colouring drapes it unchanged" with:

> the ground is coloured by a labelled static stand-in (the measured `-surface.png` vegetation channel through the house heat ramp) — the live colouring is the sim's output and the preview has no sim; the HUD label says "static stand-in field".

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-04-terrain-3d-preview-design.md
git commit -m "docs(terrain): spec amendments found during planning -- raw-span tripwire, plain preview water

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `previews/terrain-3d/index.html` — the live-stack clone

**Files:**
- Create: `previews/terrain-3d/index.html` (single file, house preview pattern from `previews/heat-map-map/index.html`)

Structure (complete code below): CDN MapLibre 4.7.1 + three importmap · map init copied from the live app (`style: dark openfreemap, zoom 15.3, pitch 60, bearing −18, antialias`) · the custom layer's `onAdd`/`render` including the exact `modelTransform` matrix math from `heat-map-app.ts:695-702` · data fetched relative (`../../public/heat-map/data/` for wards/roads/water, `./data/` for terrain).

Key mechanics the code must honour:
- **Coordinate frame:** building rows are `[h, x0,y0, x1,y1, …]`; the live extrusion builds `Shape(x, −y)` then `rotateX(−π/2)`, which lands world `(x, z) = (data x, data y)`. `terrainAt(x, z)` therefore samples the heightfield with data-frame coordinates directly. Field row 0 is the window's north edge (tile y grows southward) — matched by sampling with `(z + half)/size`.
- **Buildings:** clone the live loop (`ExtrudeGeometry` with bevel, fallback, merge) minus grow-animation attributes; after `rotateX`, `g.translate(0, EX * terrainRaw(cx, cz), 0)` using the footprint centroid. Heights untouched.
- **Ground:** `PlaneGeometry(size, size, N−1, N−1)`, rotated flat, vertex Y set from the field × EX; coloured by a static stand-in field (the ward's measured `-surface.png` vegetation channel through the house heat ramp — visually close to the live relief mode without cloning the sim; labelled "static stand-in field" in the HUD).
- **Roads:** each way's `p` polyline → `THREE.LineSegments`, each vertex at `EX * terrainRaw(x, y) + 0.5`.
- **Water:** each poly → `ShapeGeometry`, flat translucent `#29a79d`, at `EX * terrainRaw(centroid) + 0.3`.
- **Controls:** ward tabs (3) · exaggeration `×3 ×4 ×5` · `FLAT` toggle (EX = 0) · HUD label `ground relief ×N · smoothed surface model` that hides on FLAT. Every control change rebuilds the ward (cached JSON, ~50 ms — fine for a preview).
- **Rebuild rule:** one `buildWard(name)` function owns all four consumers; controls only set `state` and call it. No incremental mutation.

- [ ] **Step 1: Write the page** — full code:

*(complete ~340-line file; the code block below is the entire deliverable, written verbatim)*

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Delta — terrain under the ward stack (preview)</title>
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
<style>
  @font-face{ font-family:'Mona Sans'; src:url('../../public/fonts/MonaSans-Variable.woff2') format('woff2'); font-weight:200 900; font-display:swap; }
  @font-face{ font-family:'Noplato Mono'; src:url('../../public/fonts/noplato-mono-condensed.woff2') format('woff2'); font-weight:400; font-display:swap; }
  :root{ --base:#050606; --paper:#ecedf0; --ink:#8fa3a5; --line:rgb(111 202 214/.14); --cyan:#6fcad6; --mono:'Noplato Mono',ui-monospace,monospace; --sans:'Mona Sans',system-ui,sans-serif; }
  *{box-sizing:border-box;margin:0} html,body{height:100%}
  body{background:var(--base);color:var(--paper);font-family:var(--sans);overflow:hidden}
  #map{position:fixed;inset:0}
  .hud{position:fixed;left:0;right:0;top:0;display:flex;align-items:center;justify-content:space-between;padding:16px 22px;z-index:3;pointer-events:none}
  .hud>*{pointer-events:auto}
  .brand{font-weight:700;font-size:.9rem;text-shadow:0 2px 12px #000}
  .tabs{display:flex;gap:3px;background:rgb(9 20 22/.72);border:1px solid var(--line);border-radius:10px;padding:3px;backdrop-filter:blur(8px)}
  .tab{font-family:var(--mono);font-size:.58rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink);background:none;border:0;cursor:pointer;padding:.5rem .85rem;border-radius:7px}
  .tab.on{background:var(--cyan);color:var(--base)}
  .foot{position:fixed;left:22px;bottom:26px;z-index:3;font-family:var(--mono);font-size:.56rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink);text-shadow:0 2px 10px #000}
  .foot b{color:var(--cyan);font-weight:400}
</style>
</head>
<body>
<div id="map"></div>
<div class="hud">
  <div class="brand">Δ Delta · terrain preview</div>
  <div class="tabs" id="wards">
    <button class="tab on" data-w="ballygunge">Ballygunge</button>
    <button class="tab" data-w="barrackpore">Barrackpore</button>
    <button class="tab" data-w="baruipur">Baruipur</button>
  </div>
  <div class="tabs" id="ex">
    <button class="tab" data-x="0">Flat</button>
    <button class="tab" data-x="3">×3</button>
    <button class="tab on" data-x="4">×4</button>
    <button class="tab" data-x="5">×5</button>
  </div>
</div>
<div class="foot" id="lab"></div>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script type="importmap">
{ "imports": { "three": "https://unpkg.com/three@0.184.0/build/three.module.js",
               "three/addons/": "https://unpkg.com/three@0.184.0/examples/jsm/" } }
</script>
<script type="module">
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WARDS = { ballygunge:{lat:22.528,lon:88.3659}, barrackpore:{lat:22.7621,lon:88.3713}, baruipur:{lat:22.3654,lon:88.4319} };
const state = { ward:'ballygunge', ex:4 };
const cache = {}, terrainCache = {}, roadsCache = {}, waterCache = {}, surfCache = {};

/* ── map: same parameters as the live instrument ── */
const map = new maplibregl.Map({
  container:'map', style:'https://tiles.openfreemap.org/styles/dark',
  center:[WARDS.ballygunge.lon, WARDS.ballygunge.lat], zoom:15.3, pitch:60, bearing:-18,
  antialias:true, attributionControl:false, pixelRatio:Math.min(devicePixelRatio,1.75),
});
map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
map.setMaxPitch(78);

/* ── terrain sampling: data-frame (x, y) metres -> smoothed metres, bilinear ── */
function terrainRaw(t, x, y){
  const n=t.n, half=t.sizeM/2;
  const fx=Math.min(n-1.001, Math.max(0,(x+half)/t.sizeM*(n-1)));
  const fy=Math.min(n-1.001, Math.max(0,(y+half)/t.sizeM*(n-1)));
  const x0=Math.floor(fx), y0=Math.floor(fy), ax=fx-x0, ay=fy-y0;
  const h=(r,c)=>t.h[r*n+c];
  return (h(y0,x0)*(1-ax)+h(y0,x0+1)*ax)*(1-ay) + (h(y0+1,x0)*(1-ax)+h(y0+1,x0+1)*ax)*ay;
}

/* ── three scene inside MapLibre's GL context — onAdd/render cloned from the live layer ── */
let scene=null, cam, renderer, modelTransform=null, group=null;
const layer = { id:'terrain-city', type:'custom', renderingMode:'3d',
  onAdd(m, gl){
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xbfe2e8, 0x0a1518, 1.05));
    const key=new THREE.DirectionalLight(0xffffff,2.1); key.position.set(.4,1,.35); scene.add(key);
    const rim=new THREE.DirectionalLight(0x6fcad6,.5); rim.position.set(-.5,.4,-.5); scene.add(rim);
    cam = new THREE.Camera();
    renderer = new THREE.WebGLRenderer({ canvas:m.getCanvas(), context:gl, antialias:true });
    renderer.autoClear = false;
    buildWard(state.ward);
  },
  render(_gl, matrix){
    if(!modelTransform || !scene) return;
    const s = modelTransform.scale;
    const l = new THREE.Matrix4()
      .makeTranslation(modelTransform.x, modelTransform.y, modelTransform.z)
      .scale(new THREE.Vector3(s,-s,s))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI/2));
    cam.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(l);
    renderer.resetState();
    renderer.render(scene, cam);
  },
};

/* ── heat ramp (house), applied to a vegetation stand-in field ── */
function ramp(t){
  const mix=(a,b,k)=>a.map((v,i)=>v+(b[i]-v)*k);
  const c0=[.435,.792,.839],c1=[.624,.725,.541],c2=[.690,.553,.341],c3=[.831,.420,.290],c4=[.898,.282,.302];
  return t<.35?mix(c0,c1,t/.35):t<.6?mix(c1,c2,(t-.35)/.25):t<.8?mix(c2,c3,(t-.6)/.2):mix(c3,c4,Math.min((t-.8)/.2,1));
}

async function fetchJson(url, fallback){ try{ const r=await fetch(url); return r.ok? await r.json(): fallback; }catch{ return fallback; } }
async function fetchSurface(name){
  if(surfCache[name]) return surfCache[name];
  const img=new Image(); img.src=`../../public/heat-map/data/${name}-surface.png`;
  await img.decode().catch(()=>{});
  const cv=document.createElement('canvas'); cv.width=cv.height=140;
  cv.getContext('2d').drawImage(img,0,0);
  return surfCache[name]=cv.getContext('2d').getImageData(0,0,140,140);
}

/* ── one builder owns all four consumers; controls only set state and re-call it ── */
async function buildWard(name){
  state.ward = name;
  const w = WARDS[name];
  cache[name]     ??= await fetchJson(`../../public/heat-map/data/${name}.json`, null);
  terrainCache[name] ??= await fetchJson(`./data/${name}-terrain.json`, null);
  roadsCache[name]  ??= await fetchJson(`../../public/heat-map/data/${name}-roads.json`, {ways:[]});
  waterCache[name]  ??= await fetchJson(`../../public/heat-map/data/${name}-water.json`, {polys:[]});
  const surf = await fetchSurface(name);
  const d=cache[name], t=terrainCache[name];
  if(!d || !t){ document.getElementById('lab').textContent='data failed to load'; return; }
  const EX = state.ex;
  const ter = (x,y)=> EX * terrainRaw(t,x,y);

  if(group){ scene.remove(group); group.traverse(o=>{o.geometry?.dispose(); o.material?.dispose();}); }
  group = new THREE.Group();

  /* ground: displaced plane, coloured by the vegetation stand-in through the ramp */
  const n=t.n, gg=new THREE.PlaneGeometry(d.sizeM, d.sizeM, n-1, n-1);
  gg.rotateX(-Math.PI/2);
  const pos=gg.attributes.position, cols=new Float32Array(pos.count*3);
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i), z=pos.getZ(i);
    pos.setY(i, ter(x,z));
    const sx=Math.min(139,Math.max(0,Math.round((x+d.sizeM/2)/d.sizeM*139)));
    const sy=Math.min(139,Math.max(0,Math.round((z+d.sizeM/2)/d.sizeM*139)));
    const veg=surf? surf.data[(sy*140+sx)*4]/255 : .4;          // R channel = vegetation fraction
    const c=ramp(Math.max(0,Math.min(1,(1-veg)*.82)));
    cols[i*3]=c[0]; cols[i*3+1]=c[1]; cols[i*3+2]=c[2];
  }
  gg.setAttribute('color', new THREE.BufferAttribute(cols,3));
  gg.computeVertexNormals();
  const ground=new THREE.Mesh(gg, new THREE.MeshLambertMaterial({vertexColors:true, transparent:true, opacity:.92}));
  ground.position.y=.4; group.add(ground);

  /* buildings: the live extrusion loop, base offset to the terrain at centroid */
  const geos=[];
  for(const b of d.b){
    const shape=new THREE.Shape(); shape.moveTo(b[1],-b[2]);
    for(let i=3;i<b.length;i+=2) shape.lineTo(b[i],-b[i+1]);
    let g; try{ g=new THREE.ExtrudeGeometry(shape,{depth:Math.max(.6,b[0]-1.4),bevelEnabled:true,bevelThickness:.7,bevelSize:.55,bevelSegments:1}); }
    catch{ try{ g=new THREE.ExtrudeGeometry(shape,{depth:b[0],bevelEnabled:false}); }catch{ continue; } }
    g.rotateX(-Math.PI/2);
    let cx=0,cz=0; const np=(b.length-1)/2;
    for(let k=1;k<b.length;k+=2){ cx+=b[k]; cz+=b[k+1]; } cx/=np; cz/=np;
    g.translate(0, ter(cx,cz), 0);
    geos.push(g);
  }
  const city=new THREE.Mesh(mergeGeometries(geos,false),
    new THREE.MeshLambertMaterial({color:0x9fb4b8, flatShading:true}));
  geos.forEach(g=>g.dispose());
  group.add(city);

  /* roads: polylines draped on the field */
  const rp=[];
  for(const way of roadsCache[name].ways){
    const p=way.p;
    for(let i=0;i+3<p.length;i+=2){
      rp.push(p[i], ter(p[i],p[i+1])+.5, p[i+1], p[i+2], ter(p[i+2],p[i+3])+.5, p[i+3]);
    }
  }
  const rg=new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rp),3));
  group.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({color:0x39555c, transparent:true, opacity:.55})));

  /* water: plain translucent fill at the terrain height of each poly's centroid */
  for(const poly of waterCache[name].polys){
    const p=poly.p, shape=new THREE.Shape(); shape.moveTo(p[0],-p[1]);
    for(let i=2;i<p.length;i+=2) shape.lineTo(p[i],-p[i+1]);
    let wx=0,wz=0; for(let i=0;i<p.length;i+=2){ wx+=p[i]; wz+=p[i+1]; }
    const np2=p.length/2; wx/=np2; wz/=np2;
    const wg=new THREE.ShapeGeometry(shape); wg.rotateX(-Math.PI/2);
    const mesh=new THREE.Mesh(wg, new THREE.MeshLambertMaterial({color:0x29a79d, transparent:true, opacity:.7}));
    mesh.position.y = ter(wx,wz)+.3;
    group.add(mesh);
  }

  scene.add(group);
  const mc=maplibregl.MercatorCoordinate.fromLngLat([w.lon,w.lat],0);
  modelTransform={x:mc.x,y:mc.y,z:mc.z??0,scale:mc.meterInMercatorCoordinateUnits()};
  document.getElementById('lab').innerHTML = EX===0
    ? 'flat ground · today\'s look'
    : `ground relief <b>×${EX}</b> · smoothed surface model · raw span ${t.rawSpanM} m → drawn ${t.smoothSpanM} m ×${EX} · static stand-in field`;
  map.triggerRepaint();
}

/* ── controls: set state, rebuild — no incremental mutation ── */
document.getElementById('wards').addEventListener('click', e=>{
  const b=e.target.closest('[data-w]'); if(!b) return;
  document.querySelectorAll('#wards .tab').forEach(t=>t.classList.toggle('on',t===b));
  const w=WARDS[b.dataset.w];
  map.flyTo({center:[w.lon,w.lat], duration:900});
  buildWard(b.dataset.w);
});
document.getElementById('ex').addEventListener('click', e=>{
  const b=e.target.closest('[data-x]'); if(!b) return;
  document.querySelectorAll('#ex .tab').forEach(t=>t.classList.toggle('on',t===b));
  state.ex = +b.dataset.x;
  buildWard(state.ward);
});

map.on('style.load', ()=> map.addLayer(layer));
</script>
</body>
</html>
```

- [ ] **Step 2: Serve and open**

Run from repo root: `python3 -m http.server 4173`
Open: `http://localhost:4173/previews/terrain-3d/`
Expected: dark Kolkata basemap, Ballygunge buildings on gently undulating ground at ×4; ward tabs fly and rebuild; Flat returns to today's look; console clean.

- [ ] **Step 3: Console-clean check across all states**

Click every ward × every exaggeration (12 states). DevTools console: no errors, no 404s (fonts may warn if served path differs — acceptable in preview only if cosmetic).

- [ ] **Step 4: Commit**

```bash
git add previews/terrain-3d/index.html
git commit -m "feat(terrain): preview page -- live-stack clone with draped ground, buildings, roads, water

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Captures for the record

**Files:**
- Create: `previews/terrain-3d/_cap.mjs` (house puppeteer-core pattern from `previews/_caps.mjs`)

- [ ] **Step 1: Write the capture script**

```js
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless:'new', args:['--no-sandbox','--enable-webgl','--use-gl=angle'] });
const p = await b.newPage(); await p.setViewport({ width:1440, height:900, deviceScaleFactor:1.5 });
await p.goto('http://localhost:4173/previews/terrain-3d/', { waitUntil:'networkidle0' });
await new Promise(r=>setTimeout(r,3500));
for (const ward of ['ballygunge','barrackpore','baruipur']) {
  await p.click(`[data-w="${ward}"]`); await new Promise(r=>setTimeout(r,2600));
  await p.screenshot({ path:`previews/terrain-3d/_${ward}-x4.png` });
}
await p.click('[data-w="barrackpore"]'); await new Promise(r=>setTimeout(r,2600));
await p.click('[data-x="0"]');          await new Promise(r=>setTimeout(r,1600));
await p.screenshot({ path:'previews/terrain-3d/_barrackpore-flat.png' });
await b.close();
```

- [ ] **Step 2: Run it** (server from Task 3 still up)

Run: `node previews/terrain-3d/_cap.mjs`
Expected: 4 PNGs — three wards at ×4 plus the Barrackpore flat A/B partner. Inspect the Barrackpore pair: the embankment must be the visible difference.

- [ ] **Step 3: Commit**

```bash
git add previews/terrain-3d/_cap.mjs previews/terrain-3d/_*.png
git commit -m "chore(terrain): preview captures -- three wards x4 and the Barrackpore flat A/B

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Verification (spec §8, mapped)

| Spec requirement | Where |
|---|---|
| `--check` green, byte-identical regeneration | Task 1 steps 2–3 |
| Tripwire proven to fire | Task 1 step 4 |
| Preview serves; three wards; flat toggle plausible | Task 3 steps 2–3 |
| Console clean across states | Task 3 step 3 |
| Screenshot set incl. Barrackpore flat-vs-terrain | Task 4 |

## Not in this plan, by design

Live-route changes, `src/`/`public/` edits, sim/physics, Overture footprints, picking in the preview, mobile tiers — all recorded as out of scope in spec §7. The preview's verdict (user judgment on the captures + live page) decides whether a promotion spec ever exists.
