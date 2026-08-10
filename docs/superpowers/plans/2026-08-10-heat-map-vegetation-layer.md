# Heat-map Vegetation Layer — Implementation Plan (Phase 1: ballygunge)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a believable, receipted tree/vegetation layer to the Kolkata heat-map twin — driven by the Meta/WRI 1 m canopy-height model — that both sharpens the physics `veg[]` field (mean-neutrally) and renders instanced ez-tree species with wind and blob shadows, toggleable from a widget below the clock. Phase 1 ships the full vertical slice for **ballygunge only**.

**Architecture:** A build-time Python script (`fetch-canopy.py`) fetches the 1 m CHM, clips/regrids it to the served grid, and emits a `{ward}-canopy.png` raster + a `{ward}-trees.json` instance list. The TS side loads the canopy raster (mirroring the surface raster, incl. the N→S row flip) and blends it into `veg[]` **mean-neutrally** so the CEO-governed ward scalar never moves. A new `vegetation-layer.ts` builds one `InstancedMesh` per species from committed ez-tree GLBs, placed from `trees.json`, with a vertex-shader wind sway and instanced blob shadows (no shadow maps — the shared MapLibre GL context forbids them). A `.modechip` toggle below `#clockw` flips module-scoped `vegOn` → `relief.setVegetationVisible()`.

**Tech Stack:** three.js 0.184 (MapLibre `CustomLayerInterface`, shared GL, `autoClear=false`), `@dgreenheck/ez-tree@1.1.0` (MIT, build-time only), Python + rasterio/GDAL + numpy (strict mypy), Playwright (GLB bake + visual verification), `node:test` + tsx (unit tests).

---

## Ground truth (verified against the codebase)

- **THREE 0.184**, renderer at `src/scripts/climate-engine/explore/relief-renderer.ts`; scene created in `onAdd`, `autoClear=false` (`:181-182`), `resetState()` each frame (`:229`), scene Z-flip `scene.scale.set(1,1,-1)` (`:176`).
- **Lights** (no shadows): `HemisphereLight(0xbfe2e8,0x0a1518,1.05)`, key `DirectionalLight(0xffffff,2.1)`, cyan rim (`:177-179`). Grep confirms no `shadowMap`/`castShadow` anywhere.
- **Layer factory idiom** to mirror: `water-layer.ts` `createWaterLayer(data, growU, groundAt) → WaterLayer|null`, `interface { mesh; setTime(); setView(); dispose() }`. Renderer swaps per-ward layers in `rebuildWard` (`relief-renderer.ts:261-274`) with remove→dispose→create→add; top-level `dispose()` at `:153-171` calls `this.water?.dispose()` etc.
- **Per-frame clock + wind**: `render()` calls `this.water.setTime(performance.now()/1000)` guarded by `!reducedMotion` (`:215-227`); live wind at `this.visual.live.wind` / `.windFrom`. Repaint via `this.options.map.triggerRepaint()`.
- **Bundle**: `reliefWard = { wardData, roads, water, terrain, mercatorOrigin, frame }` built in `heat-map-app.ts:830-834`, handed to `relief?.setWard(...)`. `ReliefWardBundle` type in `explore/relief-contract.ts` (inspect before editing).
- **Ground sampler**: `terrainDrawAt(bundle.terrain, x, y)` — pass as `groundAt`.
- **Loaders**: `terrain.ts:asTerrainField` (null-safe validator, `:110-124`) + `assertTerrainLogic()` (`:127-179`) are the templates. App loads artefacts via a `Promise.all` with an `optional(...)` swallow + per-artefact cache where `undefined=unfetched, null=fetched-absent` (`heat-map-app.ts:769-810`, terrain slot `:787-790`).
- **Surface raster**: `surface-raster.ts:loadSurfaceRaster()` (`:62-116`) — fetch `${ward}-surface.png`, `createImageBitmap`→`OffscreenCanvas`→`getImageData`, **row flip `dst=(n-1-row)*n`** (`:83-110`), R=veg G=albedo dequantised. `assertSurfaceLogic()` at `:238-263`. Mean guard `assertSurfaceMatches` (`:158-178`).
- **veg[] build**: `ward-raster.ts:rasterWardBase()` (`:116-134`), `veg` at `:126-128` (`Float32Array`, len `n*n`, `n=192`, row0=SOUTH, range 0..1); returns `{albedo,veg,built,water}` at `:133`. "Do not rescale by built mask" doc at `:111-114`.
- **State/toggle**: `State` (`heat-map-app.ts:86-97`) holds physics only; view flags are module-scoped `let mode/env/tintMode` (`:102,:126`). Toggle idiom (tint chip `:1429`): `onEl(node,'click',fn)` (registers + pushes cleanup), flip var → `classList.toggle('on')` → push to renderer → `map.triggerRepaint()`.
- **Clock widget**: `#clockw` markup `HeatMapStage.astro:67-95`, CSS `:328-383`, `position:absolute; right:320px; top:76px`, `flex-direction:column`, `--c`/`--on` fill tokens. Insertion point line 95. Binary-toggle idiom = `.modechip` (`:589-591`), on/off precedent `#envchip` (`:159`).
- **Python**: `_types.py` `WARDS` (`:90-94`), `ward_bounds(w,pad)` (`:112-122`), `m_per_deg` (`:103-109`); iterate `WARDS`, never hardcode a ward. Served surface grid `GRID=FOOTPRINT_M//10=140` (`_sentinel.py:104`). Byte-stable: pinned `RETRIEVED`, `round()` all floats, `json.dumps(doc,separators=(",",":"))+"\n"` (`fetch-terrain.py:166-167`). rasterio windowed read + `transform_bounds` + `out_shape=(GRID,GRID)` regrid (`_sentinel.py:107-125`). `from __future__ import annotations`, numpy aliases `F32/U8` (`_types.py:45-49`), `cast()` only at JSON boundary, `sys.path.insert(0,HERE)` + `import _types` with `# noqa: E402`.
- **Provenance**: `_provenance.py` `layer()`/`manifest()`/`dump()`; `build-provenance-manifest.py` `EXPECTED` (`:47`), `CCBY4` const (`:41-44`), `layer(...)` calls in `build()`. `verify-served-data.mjs` `EXPECTED_LAYERS` (`:67`).
- **Tests**: `node --import tsx --test tests/unit/*.test.mjs`; import TS with explicit `.ts`; call `assert*Logic()` inside a `test(...)`; models: `heat-map-surface-orientation.test.mjs`, `heat-map-water.test.mjs`.

**Concrete ballygunge numbers:** centre `(22.528, 88.3659)`, footprint 1400 m, bbox (W,S,E,N) = `(88.359091, 22.521668, 88.372709, 22.534332)`, served grid `GRID=140`.

---

## File structure

**Create:**
- `scripts/fetch-canopy.py` — fetch CHM → `{ward}-canopy.png` + `{ward}-trees.json`.
- `previews/_bake-trees.mjs` + `src/pages/veg-bake.astro` — bake ez-tree species → committed GLBs.
- `public/heat-map/models/{neem,gulmohar,palm}.glb` — baked species (committed).
- `public/heat-map/data/ballygunge-canopy.png`, `public/heat-map/data/ballygunge-trees.json` — generated artefacts.
- `src/scripts/climate-engine/vegetation-layer.ts` — instance render layer + validators + `assertVegetationLogic()`.
- `tests/unit/heat-map-vegetation.test.mjs` — unit tests.

**Modify:**
- `src/scripts/climate-engine/surface-raster.ts` — add `loadCanopyRaster()` + `CanopyRaster` + `asCanopyRaster`.
- `src/scripts/climate-engine/ward-raster.ts` — mean-neutral canopy blend into `veg[]`.
- `src/scripts/climate-engine/explore/relief-contract.ts` — add `veg`/`vegSpecies` to `ReliefWardBundle`.
- `src/scripts/climate-engine/explore/relief-renderer.ts` — veg field, rebuild swap, `render()` sway, dispose, `setVegetationVisible()`.
- `src/scripts/climate-engine/heat-map-app.ts` — species preload + canopy cache + bundle wiring + `vegOn` + chip wiring.
- `src/components/ClimateEngine/HeatMapStage.astro` — veg toggle markup + CSS.
- `scripts/build-provenance-manifest.py` — `canopy` layer record.
- `scripts/verify-served-data.mjs` — `EXPECTED_LAYERS += 'canopy'`.
- `package.json` — `bake:trees` / `fetch:canopy` scripts (optional convenience).

**Data contracts (defined once, referenced everywhere):**

```ts
// TreeInstance: ward-local metres, +y = NORTH (mirrors Building convention).
export interface TreeInstance { x: number; y: number; h: number; species: 'neem' | 'gulmohar' | 'palm'; r: number; }
export interface TreesFile { ward: string; grid: number; sizeM: number; retrieved: string; trees: TreeInstance[]; }
// CanopyRaster: decoded per-cell canopy height (metres), row 0 = SOUTH (post-flip), len n*n.
export interface CanopyRaster { ward: string; n: number; hi: number; height: Float32Array; }
```

```python
# _types.py additions (TypedDicts — the JSON IS the type)
class TreeInstanceJSON(TypedDict):
    x: float; y: float; h: float; species: str; r: float
class TreesFileJSON(TypedDict):
    ward: str; grid: int; sizeM: float; retrieved: str; trees: list[TreeInstanceJSON]
```

---

## Task 1: Add ez-tree dev dependency (verify)

**Files:** Modify `package.json`

- [ ] **Step 1: Confirm ez-tree is installed as a devDependency**

Run: `node -e "console.log(require('./package.json').devDependencies['@dgreenheck/ez-tree'])"`
Expected: `^1.1.0` (or `1.1.0`). If it prints `undefined`, run `npm install -D @dgreenheck/ez-tree@1.1.0`.

- [ ] **Step 2: Confirm MIT license**

Run: `node -e "console.log(require('./node_modules/@dgreenheck/ez-tree/package.json').license)"`
Expected: `MIT`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(heat-map): add ez-tree (MIT) as build-time dev dependency"
```

---

## Task 2: Bake ez-tree species → committed GLBs

Species are ward-independent and baked once. We generate them in a headless browser (ez-tree needs `document`) and export via `GLTFExporter`.

**Files:**
- Create: `src/pages/veg-bake.astro`
- Create: `previews/_bake-trees.mjs`
- Create (output): `public/heat-map/models/{neem,gulmohar,palm}.glb`

- [ ] **Step 1: Create the bake page** (exposes `window.bakeSpecies(kind) → base64 GLB`)

Create `src/pages/veg-bake.astro`:

```astro
---
// DEV-ONLY: headless GLB baker for the vegetation species. Not a nav route.
// Consumed by previews/_bake-trees.mjs. Open needs the dev server running.
---
<html><head><meta charset="utf-8" /><title>veg bake</title></head>
<body>
<script>
import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const SPECIES_SCALE = 0.14; // ez-tree default ~40u tall -> ~5.6u to match buildings

function makeSpecies(kind){
  const t = new Tree(); const o = t.options;
  o.branch.length[0] = 13; o.branch.length[1] = 11; o.branch.length[2] = 7;
  for (const k in o.branch.gnarliness) o.branch.gnarliness[k] *= 0.5;
  o.branch.radius[0] = 1.2;
  if (kind === 'neem'){
    o.seed = 101; o.branch.levels = 3; o.branch.children[0] = 8; o.branch.children[1] = 8;
    o.leaves.count = 8; o.leaves.size = 1.9; o.leaves.sizeVariance = 0.4; o.leaves.tint = 0x4f9550;
  } else if (kind === 'gulmohar'){
    o.seed = 202; o.branch.levels = 3;
    for (const k in o.branch.angle) o.branch.angle[k] = Math.min(88, o.branch.angle[k] + 18);
    o.branch.children[0] = 9;
    o.leaves.count = 7; o.leaves.size = 1.5; o.leaves.sizeVariance = 0.5; o.leaves.tint = 0x77b552;
  } else { // palm
    o.seed = 303; o.branch.levels = 1; o.branch.length[0] = 18; o.branch.children[0] = 7;
    o.leaves.count = 9; o.leaves.size = 3.0; o.leaves.sizeVariance = 0.2; o.leaves.tint = 0x4f8a4a;
  }
  t.generate();
  t.scale.setScalar(SPECIES_SCALE);
  t.updateMatrixWorld(true);
  return t;
}

window.bakeSpecies = (kind) => new Promise((resolve, reject) => {
  try {
    const tree = makeSpecies(kind);
    new GLTFExporter().parse(tree, (buf) => {
      const bytes = new Uint8Array(buf);
      let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      resolve(btoa(bin));
    }, (err) => reject(err), { binary: true });
  } catch (e) { reject(e); }
});
window.__bakeReady = true;
</script>
</body></html>
```

- [ ] **Step 2: Create the bake runner**

Create `previews/_bake-trees.mjs`:

```js
// Bake ez-tree species to committed GLBs. Requires `npm run dev` on :4321.
// Run: node previews/_bake-trees.mjs
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'public/heat-map/models';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist','--enable-gpu','--use-angle=metal'] });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:4321/veg-bake', { waitUntil: 'networkidle', timeout: 45000 });
await p.waitForFunction(() => window.__bakeReady === true, null, { timeout: 30000 });
for (const kind of ['neem','gulmohar','palm']) {
  const b64 = await p.evaluate(k => window.bakeSpecies(k), kind);
  writeFileSync(`${OUT}/${kind}.glb`, Buffer.from(b64, 'base64'));
  console.log('baked', kind, `${OUT}/${kind}.glb`);
}
await b.close();
console.log('errors:', errs.length ? errs.join(' | ') : 'none');
```

- [ ] **Step 3: Start dev server (if not running) and bake**

Run: `lsof -ti :4321 >/dev/null || (npm run dev &) ; sleep 4 ; node previews/_bake-trees.mjs`
Expected: three `baked …` lines, `errors: none`.

- [ ] **Step 4: Verify the GLBs are non-trivial and loadable**

Run: `ls -la public/heat-map/models/*.glb && node -e "for(const s of['neem','gulmohar','palm']){const b=require('fs').statSync('public/heat-map/models/'+s+'.glb');if(b.size<2000)throw new Error(s+' too small');}" && echo OK`
Expected: three GLBs each > 2 KB, `OK`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/veg-bake.astro previews/_bake-trees.mjs public/heat-map/models/*.glb
git commit -m "feat(heat-map): bake ez-tree Kolkata species (neem/gulmohar/palm) to GLB"
```

---

## Task 3: `fetch-canopy.py` — CHM → canopy raster + tree instances

**Files:**
- Create: `scripts/fetch-canopy.py`
- Modify: `scripts/_types.py` (add `TreeInstanceJSON`, `TreesFileJSON`)
- Test: `scripts/fetch-canopy.py --check` (self-verifying, the `fetch-terrain.py` tripwire idiom)

- [ ] **Step 1: Add the TypedDicts to `_types.py`**

Append near the other JSON contracts (after `FootprintsFile`, ~`_types.py:210`):

```python
class TreeInstanceJSON(TypedDict):
    x: float      # ward-local metres, +x = east
    y: float      # ward-local metres, +y = north
    h: float      # tree height, metres (from CHM)
    species: str  # "neem" | "gulmohar" | "palm"
    r: float      # crown radius, metres


class TreesFileJSON(TypedDict):
    ward: str
    grid: int
    sizeM: float
    retrieved: str
    trees: list[TreeInstanceJSON]
```

- [ ] **Step 2: Write `fetch-canopy.py`**

Create `scripts/fetch-canopy.py`. Placeholder-free; the CHM source URL is resolved via `chm_href(ward)` which the implementer fills with the confirmed Meta/WRI COG endpoint (see the `# RESOLVE` note — this is the ONE external fact to confirm; everything else is complete).

```python
from __future__ import annotations

import json
import os
import sys
from typing import Any, cast

import numpy as np
import numpy.typing as npt
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _types  # noqa: E402
from _types import WARDS, Ward  # noqa: E402

RETRIEVED = "2026-08-10"          # constant, not date.today() -- byte-stable regeneration
GRID = 140                        # served canopy grid (matches surface: FOOTPRINT_M // 10)
CANOPY_HI = 30.0                  # metres; quantisation ceiling for the PNG
MIN_TREE_H = 2.0                  # metres; below this a cell is not "canopy"
TARGET_SPACING_M = 12.0           # one tree per ~12 m cell of canopy (density cap)
DATA = os.path.join(HERE, "..", "public", "heat-map", "data")


def chm_href(ward: Ward) -> str:
    """URL/vsis3 path of the Meta/WRI 1 m CHM COG covering this ward.

    # RESOLVE: Meta/WRI CHM lives on AWS Open Data (anonymous):
    #   s3://dataforgood-fb-data/forests/v2/... (tiled by region).
    # Confirm the exact tile key covering the ballygunge bbox and return either
    #   f"/vsis3/dataforgood-fb-data/forests/v2/<tile>.tif"  (needs AWS_NO_SIGN_REQUEST=YES)
    # or the equivalent public https COG URL. rasterio.open() handles both.
    """
    raise NotImplementedError("set the confirmed CHM COG href for %s" % ward.id)


def read_chm_grid(ward: Ward, n: int) -> npt.NDArray[np.float32] | None:
    """Windowed COG read of the CHM, reprojected to the ward box, regridded to n x n.

    Returns metres, north-up (row 0 = north), or None on any failure (callers skip)."""
    lat, lon = ward.centre.lat, ward.centre.lon
    half = ward.footprint_m / 2.0
    dlat = half / 110_540.0
    dlon = half / (111_320.0 * float(np.cos(np.radians(lat))))
    try:
        with rasterio.open(chm_href(ward)) as src:
            l, b, r, t = transform_bounds(
                "EPSG:4326", src.crs, lon - dlon, lat - dlat, lon + dlon, lat + dlat
            )
            win = from_bounds(l, b, r, t, src.transform)
            arr = src.read(
                1, window=win, out_dtype="float32", out_shape=(n, n),
                boundless=True, fill_value=0.0, resampling=Resampling.average,
            )
    except Exception:
        return None
    out = np.asarray(arr, dtype=np.float32)
    out[~np.isfinite(out)] = 0.0
    np.clip(out, 0.0, None, out=out)
    return out


def quantise(a: npt.NDArray[np.float32], hi: float) -> npt.NDArray[np.uint8]:
    q = np.clip(a / hi, 0.0, 1.0) * 255.0
    return np.round(q).astype(np.uint8)


def write_canopy_png(ward_id: str, grid_north_up: npt.NDArray[np.float32]) -> str:
    from PIL import Image
    ch = quantise(grid_north_up, CANOPY_HI)              # single channel, north-up
    rgb = np.dstack([ch, ch, ch])                        # grey PNG; TS reads R
    path = os.path.join(DATA, f"{ward_id}-canopy.png")
    Image.fromarray(rgb, mode="RGB").save(path, optimize=True)
    return path


def derive_trees(ward: Ward, grid_north_up: npt.NDArray[np.float32]) -> list[_types.TreeInstanceJSON]:
    """One tree per canopy cell, downsampled to ~TARGET_SPACING_M, ward-local metres (+y north)."""
    n = grid_north_up.shape[0]
    cell_m = ward.footprint_m / n
    step = max(1, int(round(TARGET_SPACING_M / cell_m)))
    half = ward.footprint_m / 2.0
    species_cycle = ("neem", "neem", "gulmohar", "palm")   # deterministic broadleaf-dominant mix
    trees: list[_types.TreeInstanceJSON] = []
    k = 0
    for row in range(0, n, step):
        for col in range(0, n, step):
            h = float(grid_north_up[row, col])
            if h < MIN_TREE_H:
                continue
            # cell centre -> ward-local metres; row 0 = north so +y decreases with row
            x = round((col + 0.5) * cell_m - half, 2)
            y = round(half - (row + 0.5) * cell_m, 2)
            sp = species_cycle[(row * 7 + col * 13) % len(species_cycle)]
            trees.append({"x": x, "y": y, "h": round(h, 1), "species": sp, "r": round(h * 0.35, 2)})
            k += 1
    return trees


def serialise(doc: dict[str, Any]) -> str:
    return json.dumps(doc, separators=(",", ":")) + "\n"


def build_ward(ward: Ward) -> None:
    grid = read_chm_grid(ward, GRID)
    if grid is None:
        raise SystemExit(f"CHM read failed for {ward.id}")
    write_canopy_png(ward.id, grid)
    trees = derive_trees(ward, grid)
    doc: _types.TreesFileJSON = {
        "ward": ward.id, "grid": GRID, "sizeM": float(ward.footprint_m),
        "retrieved": RETRIEVED, "trees": trees,
    }
    with open(os.path.join(DATA, f"{ward.id}-trees.json"), "w", encoding="utf-8") as fh:
        fh.write(serialise(cast("dict[str, Any]", doc)))
    print(f"{ward.id}: {len(trees)} trees, canopy grid {GRID}x{GRID}")


def check() -> None:
    """Re-read committed artefacts and assert invariants (fetch-terrain tripwire idiom)."""
    for wid in WARDS:
        tp = os.path.join(DATA, f"{wid}-trees.json")
        pp = os.path.join(DATA, f"{wid}-canopy.png")
        if not (os.path.exists(tp) and os.path.exists(pp)):
            continue  # only wards that have been built
        doc = cast(_types.TreesFileJSON, json.load(open(tp, encoding="utf-8")))
        assert doc["ward"] == wid, f"{wid}: ward mismatch"
        assert doc["grid"] == GRID, f"{wid}: grid must be {GRID}"
        for t in doc["trees"]:
            assert MIN_TREE_H - 0.05 <= t["h"] <= CANOPY_HI + 5, f"{wid}: tree height out of range {t['h']}"
            assert abs(t["x"]) <= doc["sizeM"] / 2 + 1 and abs(t["y"]) <= doc["sizeM"] / 2 + 1, f"{wid}: tree outside ward"
            assert t["species"] in ("neem", "gulmohar", "palm"), f"{wid}: bad species {t['species']}"
    print("canopy artefacts OK")


def main() -> None:
    args = sys.argv[1:]
    if args and args[0] == "--check":
        check(); return
    targets = [WARDS[a] for a in args] if args else [WARDS["ballygunge"]]
    for ward in targets:
        build_ward(ward)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Resolve the CHM href and run for ballygunge**

Fill `chm_href()` with the confirmed Meta/WRI COG path (see the `# RESOLVE` block). Then:
Run: `AWS_NO_SIGN_REQUEST=YES python3 scripts/fetch-canopy.py ballygunge`
Expected: `ballygunge: <N> trees, canopy grid 140x140` and two new files under `public/heat-map/data/`.

- [ ] **Step 4: Run the self-check**

Run: `python3 scripts/fetch-canopy.py --check`
Expected: `canopy artefacts OK`

- [ ] **Step 5: Strict mypy**

Run: `python3 -m mypy`
Expected: `Success: no issues found` (fix any typing errors in `fetch-canopy.py`/`_types.py` before proceeding — repo rule).

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-canopy.py scripts/_types.py public/heat-map/data/ballygunge-canopy.png public/heat-map/data/ballygunge-trees.json
git commit -m "feat(heat-map): fetch Meta/WRI 1m CHM -> ballygunge canopy raster + tree instances"
```

---

## Task 4: Provenance — `canopy` layer + build gate

**Files:**
- Modify: `scripts/build-provenance-manifest.py`
- Modify: `scripts/verify-served-data.mjs:67`
- Regenerate: `public/heat-map/data/{ward}-layers.json`

- [ ] **Step 1: Add the `canopy` layer record** in `build-provenance-manifest.py` `build()` (in the `layers` list, after the `surface` record):

```python
    layer(
        "canopy", "Tree canopy height", "derived",
        "Meta / World Resources Institute 1 m Global Canopy Height Model", CCBY4,
        ["Meta+WRI 1 m canopy-height model (neural height regression on Maxar imagery, ~2018-2020 epoch)",
         "clipped to the 1400 m ward window and resampled (area-average) to the 140x140 served grid",
         "tree instances derived from the canopy field; heights measured, positions/species modelled"],
        collection="meta-wri:canopy-height", instrument="Maxar / CHM model",
        resolution="1 m", vintage="2018-2020 epoch",
        confidence="canopy extent/height indicative (MAE ~ few m); individual trees are modelled, not surveyed",
    ),
```

- [ ] **Step 2: Add `canopy` to the build-gate EXPECTED list** in `verify-served-data.mjs:67`:

```js
const EXPECTED_LAYERS = ['basemap', 'footprints', 'heights', 'surface', 'terrain', 'water', 'roads', 'lst', 'ambient', 'canopy'];
```

- [ ] **Step 3: Regenerate all ward manifests**

Run: `python3 scripts/build-provenance-manifest.py`
Expected: rewrites `{ward}-layers.json` for every ward, each now containing a `canopy` layer.

- [ ] **Step 4: Verify the gate passes**

Run: `node scripts/verify-served-data.mjs`
Expected: `✓ per-layer provenance manifests complete (… × 10 layers)` (was 9).

- [ ] **Step 5: mypy + commit**

Run: `python3 -m mypy`  → Expected: `Success`.
```bash
git add scripts/build-provenance-manifest.py scripts/verify-served-data.mjs public/heat-map/data/*-layers.json
git commit -m "feat(heat-map): receipt the canopy layer (Meta/WRI CHM, CC BY 4.0) + build gate"
```

---

## Task 5: TS canopy raster loader (`surface-raster.ts`)

**Files:**
- Modify: `src/scripts/climate-engine/surface-raster.ts`
- Test: `tests/unit/heat-map-vegetation.test.mjs` (created here, extended later)

- [ ] **Step 1: Write the failing test** (canopy validator + row-flip contract)

Create `tests/unit/heat-map-vegetation.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { asCanopyRaster, assertCanopyLogic } from '../../src/scripts/climate-engine/surface-raster.ts';

test('asCanopyRaster rejects malformed input and accepts a valid field', () => {
  assert.equal(asCanopyRaster(null, 'x'), null, 'null is not a canopy raster');
  assert.equal(asCanopyRaster({ n: 4 }, 'x'), null, 'missing height rejected');
  const n = 4, height = new Float32Array(n * n).fill(3);
  const c = asCanopyRaster({ ward: 'x', n, hi: 30, height }, 'x');
  assert.ok(c && c.height.length === n * n, 'valid canopy raster accepted');
});

test('canopy self-check passes', () => { assertCanopyLogic(); });
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --import tsx --test tests/unit/heat-map-vegetation.test.mjs`
Expected: FAIL — `asCanopyRaster`/`assertCanopyLogic` not exported.

- [ ] **Step 3: Implement `loadCanopyRaster` + validator + self-check** in `surface-raster.ts` (mirror `loadSurfaceRaster` incl. the N→S row flip):

```ts
export interface CanopyRaster { ward: string; n: number; hi: number; height: Float32Array; }

export function asCanopyRaster(raw: unknown, ward: string): CanopyRaster | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const n = d.n, hi = d.hi, height = d.height;
  if (typeof n !== 'number' || typeof hi !== 'number') return null;
  if (!(height instanceof Float32Array) || height.length !== n * n) return null;
  return { ward, n, hi, height };
}

// CANOPY_HI must match fetch-canopy.py CANOPY_HI (30 m). Documented cross-file constant.
const CANOPY_HI = 30;

export async function loadCanopyRaster(ward: string, signal?: AbortSignal): Promise<CanopyRaster | null> {
  const response = await fetch(`/heat-map/data/${ward}-canopy.png`, { signal });
  if (!response.ok) return null;
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const n = bitmap.width;
  if (bitmap.height !== n) return null;
  const canvas = new OffscreenCanvas(n, n);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, n, n);
  const height = new Float32Array(n * n);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const src = (row * n + col) * 4;             // PNG row 0 = NORTH
      const dst = (n - 1 - row) * n + col;         // sim grid row 0 = SOUTH (mandatory flip)
      height[dst] = (data[src] / 255) * CANOPY_HI; // R channel, dequantised to metres
    }
  }
  return { ward, n, hi: CANOPY_HI, height };
}

export function assertCanopyLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`canopy: ${m}`); };
  ok(asCanopyRaster(null, 'x') === null, 'null rejected');
  ok(asCanopyRaster({ ward: 'x', n: 2, hi: 30, height: new Float32Array(3) }, 'x') === null, 'wrong length rejected');
  const good = asCanopyRaster({ ward: 'x', n: 2, hi: 30, height: new Float32Array(4).fill(5) }, 'x');
  ok(good !== null && good.height[0] === 5, 'valid accepted');
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --import tsx --test tests/unit/heat-map-vegetation.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scripts/climate-engine/surface-raster.ts tests/unit/heat-map-vegetation.test.mjs
git commit -m "feat(heat-map): load {ward}-canopy.png (N->S flip) with validator + self-check"
```

---

## Task 6: Mean-neutral canopy blend into `veg[]`

The blend redistributes vegetation toward tall canopy **without moving the ward mean** (so `assertSurfaceMatches` and the CEO-governed `fvc` scalar are untouched, keeping physics parity risk minimal).

**Files:**
- Modify: `src/scripts/climate-engine/ward-raster.ts` (blend after `:128`, before `return` `:133`)
- Modify: `src/scripts/climate-engine/heat-map-app.ts` / `compare/paired-core.ts` (thread `canopy` into `rasterWardBase`)
- Test: `tests/unit/heat-map-vegetation.test.mjs` (extend)

- [ ] **Step 1: Write the failing test** (blend preserves mean, shifts pattern) — append to `heat-map-vegetation.test.mjs`:

```js
import { blendCanopyIntoVeg } from '../../src/scripts/climate-engine/ward-raster.ts';

test('canopy blend preserves the ward-mean vegetation but redistributes it', () => {
  const n = 4, count = n * n;
  const veg = new Float32Array(count).fill(0.3);
  const canopy = new Float32Array(count);            // tall canopy only in the top half
  for (let i = 0; i < count; i++) canopy[i] = i < count / 2 ? 10 : 0;
  const before = veg.reduce((a, b) => a + b, 0) / count;
  const out = blendCanopyIntoVeg(veg, canopy, 0.5);
  const after = out.reduce((a, b) => a + b, 0) / count;
  assert.ok(Math.abs(before - after) < 1e-6, 'ward mean is preserved (CEO scalar must not move)');
  const hi = out.slice(0, count / 2).reduce((a, b) => a + b, 0);
  const lo = out.slice(count / 2).reduce((a, b) => a + b, 0);
  assert.ok(hi > lo, 'vegetation shifts toward tall canopy');
  for (const v of out) assert.ok(v >= 0 && v <= 1, 'stays in [0,1]');
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --import tsx --test tests/unit/heat-map-vegetation.test.mjs`
Expected: FAIL — `blendCanopyIntoVeg` not exported.

- [ ] **Step 3: Implement `blendCanopyIntoVeg`** in `ward-raster.ts` (export it; pure, unit-testable):

```ts
/**
 * Redistribute the vegetation field toward measured canopy height WITHOUT moving
 * the ward mean. NDVI-derived veg conflates grass/crops/canopy; the CHM adds the
 * vertical dimension. We nudge each cell toward a canopy-weighted target, then
 * re-centre so the sum (hence ward-mean FVC, a CEO-governed scalar) is unchanged.
 * `strength` in [0,1] controls how far the pattern moves. Mean-neutral by
 * construction, so `assertSurfaceMatches` and the DC-URS scalar stay valid.
 */
export function blendCanopyIntoVeg(veg: Float32Array, canopy: Float32Array, strength = 0.5): Float32Array {
  const count = veg.length;
  if (canopy.length !== count) return veg;
  let vSum = 0, cSum = 0;
  for (let i = 0; i < count; i++) { vSum += veg[i]; cSum += canopy[i]; }
  if (cSum <= 0) return veg;
  const vMean = vSum / count, cMean = cSum / count;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // target: baseline mean scaled by this cell's canopy vs the mean canopy
    const target = vMean * (canopy[i] / cMean);
    out[i] = Math.min(1, Math.max(0, veg[i] + strength * (target - veg[i])));
  }
  // re-centre to the original mean (clamping above may have shifted it)
  let oSum = 0; for (let i = 0; i < count; i++) oSum += out[i];
  const delta = (vSum - oSum) / count;
  for (let i = 0; i < count; i++) out[i] = Math.min(1, Math.max(0, out[i] + delta));
  return out;
}
```

- [ ] **Step 4: Wire it into `rasterWardBase`** — change the signature to accept an optional canopy and apply the blend after the `veg` is built (`ward-raster.ts:126-128`), before `return` (`:133`):

```ts
// signature (add canopy param):
export function rasterWardBase(d: WardData, means: WardMeans, surface: SurfaceRaster | null, canopy: CanopyRaster | null = null): SimLayers {
  // ... existing code up to the veg assignment ...
  let veg = surface ? resample(surface.veg, surface.n, n) : new Float32Array(count).fill(means.fvc);
  if (canopy) veg = blendCanopyIntoVeg(veg, resample(canopy.height, canopy.n, n), 0.5);
  // ... existing built/water/albedo code ...
  return { albedo, veg, built, water };
}
```

Import `CanopyRaster` at the top of `ward-raster.ts`: `import type { CanopyRaster } from './surface-raster';` (adjust to the existing import style).

- [ ] **Step 5: Update the two call sites** to pass canopy (default `null` keeps them compiling until Task 10 provides the value):
  - `heat-map-app.ts:848` → `state.base = rasterWardBase(d, means, surface, canopy);` (the `canopy` local is added in Task 10; until then pass `null`).
  - `compare/paired-core.ts:71` → add `, null` (compare view has no canopy in Phase 1).

- [ ] **Step 6: Run tests + typecheck**

Run: `node --import tsx --test tests/unit/heat-map-vegetation.test.mjs && npm run check`
Expected: tests PASS; `npm run check` 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/climate-engine/ward-raster.ts src/scripts/climate-engine/heat-map-app.ts src/scripts/climate-engine/compare/paired-core.ts tests/unit/heat-map-vegetation.test.mjs
git commit -m "feat(heat-map): mean-neutral canopy blend into veg[] (preserves governed ward scalar)"
```

---

## Task 7: `vegetation-layer.ts` — instanced trees, wind, blob shadows

**Files:**
- Create: `src/scripts/climate-engine/vegetation-layer.ts`
- Test: `tests/unit/heat-map-vegetation.test.mjs` (extend with `assertVegetationLogic`)

Design: one `InstancedMesh` per species (crown+branch geometry merged from the GLB), placed from `TreesFile` in ward-local metres via `groundAt` for height; a second `InstancedMesh` of downward radial-alpha quads for blob shadows (`depthWrite:false`, `renderOrder:-1`); a vertex-shader wind sway injected via `material.onBeforeCompile` driven by `uTime`/`uWind` uniforms updated in `setTime`.

- [ ] **Step 1: Write the failing test** — append to `heat-map-vegetation.test.mjs`:

```js
import { asTreesFile, assertVegetationLogic } from '../../src/scripts/climate-engine/vegetation-layer.ts';

test('asTreesFile validates the instance list', () => {
  assert.equal(asTreesFile(null), null, 'null rejected');
  assert.equal(asTreesFile({ ward: 'x', grid: 140, sizeM: 1400, trees: 'no' }), null, 'trees must be array');
  const f = asTreesFile({ ward: 'x', grid: 140, sizeM: 1400, retrieved: '2026-08-10',
    trees: [{ x: 1, y: 2, h: 6, species: 'neem', r: 2 }] });
  assert.ok(f && f.trees.length === 1 && f.trees[0].species === 'neem', 'valid trees accepted');
});

test('vegetation self-check passes', () => { assertVegetationLogic(); });
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --import tsx --test tests/unit/heat-map-vegetation.test.mjs`
Expected: FAIL — module `vegetation-layer.ts` not found.

- [ ] **Step 3: Implement `vegetation-layer.ts`**

```ts
import * as THREE from 'three';

export type Species = 'neem' | 'gulmohar' | 'palm';
export interface TreeInstance { x: number; y: number; h: number; species: Species; r: number; }
export interface TreesFile { ward: string; grid: number; sizeM: number; retrieved: string; trees: TreeInstance[]; }
export interface SpeciesAsset { geometry: THREE.BufferGeometry; material: THREE.Material; baseHeight: number; }
export type SpeciesAssets = Record<Species, SpeciesAsset>;

export interface VegetationLayer {
  readonly group: THREE.Group;
  setVisible(v: boolean): void;
  setTime(seconds: number, wind: number, windFrom: number): void;
  dispose(): void;
}

const SPECIES: Species[] = ['neem', 'gulmohar', 'palm'];

export function asTreesFile(raw: unknown): TreesFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.trees)) return null;
  const trees: TreeInstance[] = [];
  for (const t of d.trees) {
    if (!t || typeof t !== 'object') return null;
    const o = t as Record<string, unknown>;
    if (typeof o.x !== 'number' || typeof o.y !== 'number' || typeof o.h !== 'number' || typeof o.r !== 'number') return null;
    if (o.species !== 'neem' && o.species !== 'gulmohar' && o.species !== 'palm') return null;
    trees.push({ x: o.x, y: o.y, h: o.h, species: o.species, r: o.r });
  }
  return {
    ward: typeof d.ward === 'string' ? d.ward : '',
    grid: typeof d.grid === 'number' ? d.grid : 0,
    sizeM: typeof d.sizeM === 'number' ? d.sizeM : 0,
    retrieved: typeof d.retrieved === 'string' ? d.retrieved : '',
    trees,
  };
}

// Vertex-shader wind sway: crown vertices (above the trunk) sway with a global
// wind vector. Injected into the standard material so lighting is unchanged.
function addWind(material: THREE.Material): { uTime: { value: number }; uWind: { value: THREE.Vector2 } } {
  const uTime = { value: 0 }, uWind = { value: new THREE.Vector2(0, 0) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uWind = uWind;
    shader.vertexShader = `uniform float uTime;\nuniform vec2 uWind;\n` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float swayMask = clamp((position.y - 1.0) * 0.25, 0.0, 1.0);
       float phase = uTime + transformed.x * 0.15 + transformed.z * 0.15;
       transformed.x += sin(phase) * uWind.x * swayMask;
       transformed.z += cos(phase * 0.9) * uWind.y * swayMask;`,
    );
  };
  return { uTime, uWind };
}

function blobShadowTexture(): THREE.Texture {
  const s = 64, cv = new OffscreenCanvas(s, s), g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}

/**
 * Build the vegetation layer. `groundAt(x,y)` returns terrain height in the same
 * ward-local frame as the buildings; `growU` is the shared reveal uniform (unused
 * for geometry but accepted to match the water/road factory signature).
 */
export function createVegetationLayer(
  data: TreesFile | null,
  species: SpeciesAssets | null,
  _growU: { value: number },
  groundAt: ((x: number, y: number) => number) | null = null,
): VegetationLayer | null {
  if (!data || !species || data.trees.length === 0) return null;
  const group = new THREE.Group();
  const winds: Array<{ uTime: { value: number }; uWind: { value: THREE.Vector2 } }> = [];
  const owned: Array<{ dispose(): void }> = [];
  const dummy = new THREE.Object3D();
  const ground = groundAt ?? (() => 0);

  for (const sp of SPECIES) {
    const list = data.trees.filter((t) => t.species === sp);
    if (list.length === 0) continue;
    const asset = species[sp];
    const mat = asset.material.clone();
    winds.push(addWind(mat));
    const inst = new THREE.InstancedMesh(asset.geometry, mat, list.length);
    list.forEach((t, i) => {
      const s = t.h / asset.baseHeight;                     // scale GLB to measured height
      dummy.position.set(t.x, ground(t.x, t.y), t.y);
      dummy.scale.setScalar(s);
      dummy.rotation.set(0, (t.x * 13.1 + t.y * 7.7) % 6.283, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    owned.push({ dispose: () => { mat.dispose(); inst.dispose(); } });
  }

  // instanced blob shadows (one quad per tree; no shadow maps in shared GL context)
  const shadowTex = blobShadowTexture();
  const quad = new THREE.PlaneGeometry(1, 1); quad.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 });
  const shadows = new THREE.InstancedMesh(quad, shadowMat, data.trees.length);
  shadows.renderOrder = -1;
  data.trees.forEach((t, i) => {
    dummy.position.set(t.x, ground(t.x, t.y) + 0.05, t.y);
    dummy.scale.set(t.r * 2.2, 1, t.r * 2.2);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    shadows.setMatrixAt(i, dummy.matrix);
  });
  shadows.instanceMatrix.needsUpdate = true;
  group.add(shadows);
  owned.push({ dispose: () => { shadowTex.dispose(); quad.dispose(); shadowMat.dispose(); shadows.dispose(); } });

  return {
    group,
    setVisible(v) { group.visible = v; },
    setTime(seconds, wind, windFrom) {
      const rad = (windFrom * Math.PI) / 180;
      const mag = Math.min(0.5, wind / 30) * 0.4;            // metres of sway, capped
      for (const w of winds) { w.uTime.value = seconds; w.uWind.value.set(Math.sin(rad) * mag, Math.cos(rad) * mag); }
    },
    dispose() { for (const o of owned) o.dispose(); },
  };
}

export function assertVegetationLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`vegetation: ${m}`); };
  ok(asTreesFile(null) === null, 'null rejected');
  ok(asTreesFile({ trees: [{ x: 0, y: 0, h: 5, species: 'oak', r: 1 }] }) === null, 'bad species rejected');
  const f = asTreesFile({ ward: 'x', grid: 140, sizeM: 1400, retrieved: 'd', trees: [{ x: 1, y: 2, h: 6, species: 'palm', r: 2 }] });
  ok(f !== null && f.trees[0].species === 'palm', 'valid accepted');
  ok(createVegetationLayer(f, null, { value: 1 }) === null, 'no species assets -> null layer');
  ok(createVegetationLayer(null, null, { value: 1 }) === null, 'no data -> null layer');
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --import tsx --test tests/unit/heat-map-vegetation.test.mjs`
Expected: PASS (all vegetation tests).

- [ ] **Step 5: Commit**

```bash
git add src/scripts/climate-engine/vegetation-layer.ts tests/unit/heat-map-vegetation.test.mjs
git commit -m "feat(heat-map): vegetation-layer.ts — instanced species, wind sway, blob shadows"
```

---

## Task 8: Extend `ReliefWardBundle` with veg data + species

**Files:** Modify `src/scripts/climate-engine/explore/relief-contract.ts`

- [ ] **Step 1: Inspect the contract file**

Run: `sed -n '1,80p' src/scripts/climate-engine/explore/relief-contract.ts`
Expected: find the `ReliefWardBundle` interface (fields `wardData, roads, water, terrain, mercatorOrigin, frame`).

- [ ] **Step 2: Add fields** to `ReliefWardBundle` (import the types at top):

```ts
import type { TreesFile, SpeciesAssets } from '../vegetation-layer';
// ...inside ReliefWardBundle:
  veg: TreesFile | null;
  vegSpecies: SpeciesAssets | null;
```

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: errors ONLY at the `reliefWard = {...}` construction site in `heat-map-app.ts` (missing `veg`/`vegSpecies`) and in the renderer — both fixed in Tasks 9–10. If other files break, revert and reconcile.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/climate-engine/explore/relief-contract.ts
git commit -m "feat(heat-map): add veg + vegSpecies to ReliefWardBundle contract"
```

---

## Task 9: Wire the layer into the renderer

**Files:** Modify `src/scripts/climate-engine/explore/relief-renderer.ts`

- [ ] **Step 1: Import + field**

At the imports, add: `import { createVegetationLayer, type VegetationLayer } from '../vegetation-layer';`
Beside the `water`/`roads` fields (`~:29-31`): `private veg: VegetationLayer | null = null;`

- [ ] **Step 2: Swap in `rebuildWard`** — after the roads swap block (`~:272-274`), add:

```ts
if (this.veg) { this.scene.remove(this.veg.group); this.veg.dispose(); this.veg = null; }
const veg = createVegetationLayer(bundle.veg, bundle.vegSpecies, this.grow, (x, y) => terrainDrawAt(bundle.terrain, x, y));
if (veg) { this.veg = veg; this.scene.add(veg.group); }
```

- [ ] **Step 3: Drive wind in `render()`** — beside the water `setTime` block (`~:215-218`), add:

```ts
if (this.veg && !this.options.reducedMotion) {
  const w = this.visual.live;
  this.veg.setTime(performance.now() / 1000, w ? w.wind : 0, w ? (w.windFrom ?? 0) : 0);
}
```

- [ ] **Step 4: Visibility accessor** — add a public method near `setVisualState`:

```ts
setVegetationVisible(v: boolean): void { this.veg?.setVisible(v); this.options.map.triggerRepaint(); }
```

- [ ] **Step 5: Dispose** — in `dispose()` (`:159`), add `this.veg?.dispose();` next to `this.roads?.dispose();`.

- [ ] **Step 6: Typecheck**

Run: `npm run check`
Expected: remaining error only at the `heat-map-app.ts` bundle construction (fixed in Task 10).

- [ ] **Step 7: Commit**

```bash
git add src/scripts/climate-engine/explore/relief-renderer.ts
git commit -m "feat(heat-map): render vegetation layer — per-ward swap, wind, visibility, dispose"
```

---

## Task 10: App wiring — species preload, canopy load, bundle, state

**Files:** Modify `src/scripts/climate-engine/heat-map-app.ts`

- [ ] **Step 1: Add a species GLB preloader** (module scope, cached once — species are ward-independent):

```ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SpeciesAssets, Species } from './vegetation-layer';

let vegSpeciesCache: SpeciesAssets | null | undefined;   // undefined=unloaded, null=failed
async function loadVegSpecies(signal?: AbortSignal): Promise<SpeciesAssets | null> {
  if (vegSpeciesCache !== undefined) return vegSpeciesCache;
  const THREE = await import('three');
  const loader = new GLTFLoader();
  const names: Species[] = ['neem', 'gulmohar', 'palm'];
  try {
    const assets = {} as SpeciesAssets;
    for (const sp of names) {
      const gltf = await loader.loadAsync(`/heat-map/models/${sp}.glb`);
      const geos: import('three').BufferGeometry[] = [];
      let material: import('three').Material | null = null;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        const m = o as import('three').Mesh;
        if (m.isMesh) { const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); geos.push(g); material ??= m.material as import('three').Material; }
      });
      const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
      const geometry = mergeGeometries(geos, false) ?? geos[0];
      const box = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as import('three').BufferAttribute);
      assets[sp] = { geometry, material: material ?? new THREE.MeshStandardMaterial({ color: 0x4f9550 }), baseHeight: box.max.y - box.min.y };
    }
    vegSpeciesCache = assets;
  } catch { vegSpeciesCache = null; }
  return vegSpeciesCache;
}
```

- [ ] **Step 2: Add the canopy cache slot** next to the terrain cache (`~:658-660`):

```ts
const canopyCache: Record<string, import('./surface-raster').CanopyRaster | null> = {};
```

- [ ] **Step 3: Load canopy + species in the ward `Promise.all`** (mirror the terrain slot `:787-790`); import `loadCanopyRaster` + `asTreesFile`:

```ts
// in the Promise.all(...) array:
canopyCache[name] !== undefined
  ? Promise.resolve(canopyCache[name])
  : optional(loadCanopyRaster(name, token.signal).then((c) => { canopyCache[name] = c; return c; }), null),
optional(fetch(`/heat-map/data/${name}-trees.json`, { signal: token.signal })
  .then(async (r) => (r.ok ? asTreesFile(await r.json()) : null)), null),
loadVegSpecies(token.signal),
```

Destructure the three new results alongside the existing ones (`const [..., canopy, trees, vegSpecies] = await Promise.all(...)`).

- [ ] **Step 4: Use canopy in the base build** (`:848`): `state.base = rasterWardBase(d, means, surface, canopy);`

- [ ] **Step 5: Add veg to the bundle** (`:830-834`): add `veg: trees, vegSpecies,` to the `reliefWard = {...}` literal.

- [ ] **Step 6: Typecheck + unit tests**

Run: `npm run check && npm run test:unit`
Expected: 0 errors; all unit tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/climate-engine/heat-map-app.ts
git commit -m "feat(heat-map): preload species GLBs, load canopy + trees, thread into ward bundle"
```

---

## Task 11: Vegetation toggle widget (below the clock)

**Files:** Modify `src/components/ClimateEngine/HeatMapStage.astro`

The clock is `position:absolute; right:320px; top:76px`, `flex-direction:column`. A new absolutely-positioned sibling with a fixed top that clears the clock is the "distinct widget below it"; it is shown/hidden in lockstep with the clock (which is `hidden` until a ward loads).

- [ ] **Step 1: Add the widget markup** at line 95 (immediately after `</div>` closing `#clockw`, before the `<!-- First-run affordance -->` comment):

```html
    <!-- Vegetation toggle: distinct widget directly below the clock. Shown when the
         clock unhides (ward loaded). Binary on/off in the .modechip idiom. -->
    <div class="vegw" id="vegw" hidden>
      <span class="veg-lab">Trees</span>
      <div class="modechip" id="vegchip" title="Show or hide the modelled tree canopy">
        <button class="on" data-v="1" type="button">On</button>
        <button data-v="0" type="button">Off</button>
      </div>
    </div>
```

- [ ] **Step 2: Add the CSS** near the `.clockw` rules (`~:383`). `top:150px` clears the clock (top:76 + ~66px height). `// ponytail: fixed top; if the clock height changes, measure it instead`:

```css
  .vegw{position:absolute;right:320px;top:150px;z-index:6;display:flex;align-items:center;gap:8px;
    padding:6px 8px;border-radius:10px;background:rgb(5 6 6 /.7);border:1px solid var(--line);
    backdrop-filter:blur(8px);box-shadow:0 7px 20px rgb(0 0 0 /.30)}
  .vegw .veg-lab{font-family:var(--mono);font-size:.56rem;letter-spacing:.14em;color:var(--ink);text-transform:uppercase}
```

- [ ] **Step 3: Verify it renders** (dev server up):

Run: `node previews/_shot-heat.mjs` then inspect the produced screenshot for the "Trees On/Off" widget under the clock (top-right). Expected: widget visible once a ward loads, console clean. (If `#vegw` stays hidden, that is expected until Task 12 unhides it with the clock.)

- [ ] **Step 4: Commit**

```bash
git add src/components/ClimateEngine/HeatMapStage.astro
git commit -m "feat(heat-map): vegetation on/off widget below the clock"
```

---

## Task 12: Wire the toggle + reveal with the clock

**Files:** Modify `src/scripts/climate-engine/heat-map-app.ts`

- [ ] **Step 1: Add the module-scoped flag** beside `mode`/`env` (`:102`): `let vegOn = true;`

- [ ] **Step 2: Wire the chip** — where the other chips are wired (near `#tintchip` `:1429`), add:

```ts
document.querySelectorAll('#vegchip button').forEach((b) => onEl(b, 'click', () => {
  vegOn = (b as HTMLElement).dataset.v === '1';
  document.querySelectorAll('#vegchip button').forEach((x) => x.classList.toggle('on', x === b));
  relief?.setVegetationVisible(vegOn);
  map.triggerRepaint();
}));
```

- [ ] **Step 3: Unhide `#vegw` wherever `#clockw` is unhidden** — find where `clockw`'s `hidden` is removed and mirror it: `el('vegw')?.removeAttribute('hidden');`

- [ ] **Step 4: Apply the initial state on ward load** — after `relief?.setWard(reliefWard)` (`:836`): `relief?.setVegetationVisible(vegOn);`

- [ ] **Step 5: Verify end-to-end** (dev server up):

Run: `node previews/_shot-heat.mjs scratch-veg-on.png` — expect trees visible for ballygunge.
Then temporarily flip the default (`let vegOn = false`) OR script a click; simplest: add a Playwright step clicking `#vegchip button[data-v="0"]` and screenshot `scratch-veg-off.png`. Expected: trees gone when off, present when on, console clean.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/climate-engine/heat-map-app.ts
git commit -m "feat(heat-map): wire vegetation toggle -> setVegetationVisible; reveal with clock"
```

---

## Task 13: Physics parity re-validation (gate)

The `veg[]` blend is mean-neutral, so the ward-scalar and mean should not move; this task proves the accuracy did not regress.

**Files:** run-only (`scripts/measure-accuracy.py`); no code change expected.

- [ ] **Step 1: Baseline the accuracy on `main`-equivalent state** — before enabling the blend, capture the current figures:

Run: `git stash --include-untracked` (or checkout the pre-Task-6 commit in a scratch worktree), then `python3 scripts/measure-accuracy.py > /tmp/acc-before.txt`, then restore.
Expected: a numeric accuracy summary saved.

- [ ] **Step 2: Measure with the blend active**

Run: `python3 scripts/measure-accuracy.py > /tmp/acc-after.txt && diff /tmp/acc-before.txt /tmp/acc-after.txt || true`
Expected: LOO-overpass accuracy figures **do not regress** (ballygunge unchanged or improved; no ward worse beyond noise). Because the blend is mean-neutral, expect near-identical numbers.

- [ ] **Step 3: Decision gate**

If accuracy regressed: reduce blend `strength` (Task 6, `0.5`→lower) or fall back to render-only (pass `null` canopy to `rasterWardBase` while keeping trees). Document the outcome. If unchanged/improved: proceed.

- [ ] **Step 4: Record the result** in the plan/commit message (no artefact to commit unless `measure-accuracy.py` writes one that is normally committed).

```bash
git commit --allow-empty -m "test(heat-map): canopy veg[] blend does not regress LOO accuracy (mean-neutral)"
```

---

## Task 14: Full verification + parity of served data

**Files:** run-only.

- [ ] **Step 1: Sentinel/Landsat parity unchanged** (canopy is an independent input):

Run: `git status --porcelain public/heat-map/data/*-surface.png data/dc-urs/sentinel.json`
Expected: **no** changes to surface PNGs or `sentinel.json` (the canopy pipeline must not have touched them).

- [ ] **Step 2: Unit tests + typecheck + mypy**

Run: `npm run test:unit && npm run check && python3 -m mypy`
Expected: all green.

- [ ] **Step 3: Build (incl. served-data gate)**

Run: `npm run build`
Expected: green, including `✓ per-layer provenance manifests complete (… × 10 layers)`.

- [ ] **Step 4: Visual confirmation** — screenshot ballygunge with trees on, toggle off, and check the receipts panel now lists the canopy layer:

Run: `node previews/_shot-heat.mjs final-veg.png` and `node previews/_shot-receipts.mjs final-receipts.png`
Expected: believable trees over ballygunge with blob shadows + gentle wind; toggling `#vegchip` shows/hides them; the receipts modal lists "Tree canopy height — Meta / WRI … CC BY 4.0"; 60 fps desktop; console clean.

- [ ] **Step 5: Remove or gate dev-only preview pages** so they do not ship:

Run: `git rm src/pages/veg-styles.astro src/pages/veg-species.astro` (keep `veg-bake.astro` only if bake is re-run; otherwise `git rm` it too and re-add when needed).
Expected: preview routes gone from the build.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore(heat-map): finalize Phase 1 vegetation layer (ballygunge) + remove dev previews"
```

---

## Phase 2 / 3 (out of scope here — recorded)

- **Phase 2:** LOD → octahedral impostor + frustum culling + mobile/coarse-pointer tiers via `__deltaRenderQualityController`; roll `fetch-canopy.py` to `baruipur` + `barrackpore` and regenerate; canopy-data overlay (translucent CHM surface) as an interrogation view tied to the receipt.
- **Phase 3:** live intervention planting (`iv.trees` spawns/removes instances); palm refinement (ez-tree's weakest output).

---

## Self-review (completed)

- **Spec coverage:** §2 accuracy calibration → Tasks 6/13 (mean-neutral blend + parity gate). §4 data flow → Tasks 3/5/6/10. §5.1 fetch → Task 3. §5.2 veg[] → Task 6. §5.3 bake → Task 2. §5.4 render layer → Tasks 7/9. §5.5 toggle-below-clock → Tasks 11/12. §5.6 provenance → Task 4. §6 perf tiers → Phase 2 (Task 14 confirms Phase-1 budget). §7 parity → Tasks 13/14. §8 phasing → ballygunge-only here. All covered.
- **Placeholder scan:** the only external unknown is `chm_href()` (the confirmed CHM COG path), flagged explicitly as the one fact to resolve at Task 3 Step 3 — not a silent TODO. All code blocks are complete.
- **Type consistency:** `TreesFile`/`TreeInstance`/`Species`/`SpeciesAssets`/`CanopyRaster` are defined once (Task 5/7) and consumed with the same names in Tasks 8–10; `createVegetationLayer(data, species, growU, groundAt)`, `setVegetationVisible`, `blendCanopyIntoVeg`, `asCanopyRaster`, `asTreesFile`, `assertCanopyLogic`, `assertVegetationLogic` are referenced consistently. Python `TreesFileJSON`/`TreeInstanceJSON` match the TS shapes (x,y,h,species,r).
</content>
</invoke>
