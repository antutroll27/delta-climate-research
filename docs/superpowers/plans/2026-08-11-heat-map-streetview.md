# Heat-map Street-View (Mapillary ground-truth) — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Mapillary "street-view / ground-truth" layer to `/heat-map` — a toggle that paints coverage (coloured by recency) and opens the real street imagery on click, plus a "real photo of this block" thumbnail in the building card — so the modelled twin can be checked against reality on sight.

**Architecture:** Three small isolated modules under `src/scripts/climate-engine/streetview/` — a native MapLibre coverage layer (`coverage-layer.ts`), a Graph-API nearest-image lookup (`nearest-image.ts`), and a lazily-loaded viewer panel (`street-view-panel.ts`, the only heavy dep, dynamically imported). Wired into the existing `heat-map-app.ts` via the `.modechip` toggle idiom and the `paintCard()` building flow. No change to physics, vegetation, or the WebGL render budget.

**Tech Stack:** MapLibre GL (native vector tiles), Mapillary coverage tiles (`mly1_computed_public`) + Graph API (radius search) + `mapillary-js@4.1.2` (ESM, ~290 KB gz, dynamic import), Astro `import.meta.env.PUBLIC_*`, `node:test` + tsx.

Spec: [`docs/superpowers/specs/2026-08-11-heat-map-streetview-design.md`](../specs/2026-08-11-heat-map-streetview-design.md).

---

## Verified ground truth (from spec §12 — do not re-derive)

- `heat-map-app.ts:105` — real `const map = new maplibregl.Map({...})`; native `map.addSource`/`addLayer` used at `:1506-1509`.
- `heat-map-app.ts:255-347` — `paintCard(b)`; building centroid lon/lat computed at `:266` via `const ll = wardLatLon(WARDS[state.ward], b.cx, b.cz)`.
- `.modechip` toggle idiom: markup `HeatMapStage.astro:158-160`; wiring `heat-map-app.ts:1421-1428` (`onEl(node,'click',fn)` helper at `:1354`, auto-registers cleanup).
- Lazy-import precedent: `ensureRelief()` `heat-map-app.ts:713-735` (promise-memoized dynamic `import()`).
- Receipts-modal mechanics to mirror: markup top-level `HeatMapStage.astro:249-256`; open/close `:1357-1358`; Esc/backdrop `:1361-1364`; **non-passive wheel** `:1365-1371`.
- Module-boundary test `tests/unit/heat-explore-module-boundary.test.mjs` is **`three`-only** — must be extended for `mapillary-js` (Task 8).
- Coverage tiles: `https://tiles.mapillary.com/maps/vtp/mly1_computed_public/2/{z}/{x}/{y}?access_token=MLY|…`; source-layers `sequence` (z6–14 lines) + `image` (z14+ points); each feature has `captured_at` (int epoch-ms) + `id`.
- **`image` `id` arrives as an MVT double → `String(props.id)` immediately** (precision).
- Nearest image: `graph.mapillary.com/images?access_token=…&lat=&lng=&radius=50&limit=1&fields=id,thumb_1024_url,captured_at` (radius ≤ 50 m); bbox fallback for robustness.
- `mapillary-js@4.1.2`: ESM, `new Viewer({ accessToken, container, imageId })`, `viewer.moveTo(id)`, `viewer.remove()`, CSS `mapillary-js/dist/mapillary.css`, browser-only (WebGL).
- Recency thresholds (epoch-ms): 2018-01-01 = `1514764800000`; 2023-01-01 = `1672531200000`.

---

## File structure

**New:**
- `src/scripts/climate-engine/streetview/coverage-layer.ts` — MapLibre coverage source+layers, recency ramp, click→imageId.
- `src/scripts/climate-engine/streetview/nearest-image.ts` — Graph API nearest-image (radius + bbox fallback), cached.
- `src/scripts/climate-engine/streetview/street-view-panel.ts` — lazy mapillary-js Viewer mount/dispose.
- `tests/unit/heat-map-streetview.test.mjs` — unit tests for the pure/testable parts.
- `.env.example` — documents `PUBLIC_MAPILLARY_TOKEN`.

**Modify:**
- `src/components/ClimateEngine/HeatMapStage.astro` — `#streetchip` toggle, `#svModal` viewer panel (top-level), `.sv-thumb` card slot, CSS.
- `src/scripts/climate-engine/heat-map-app.ts` — token read, `streetOn` flag + chip wiring, coverage add/remove, click→viewer, card thumbnail.
- `tests/unit/heat-explore-module-boundary.test.mjs` — gate static `mapillary-js` / `street-view-panel` imports.
- `docs/heat-map-feature.md` — env-var note.
- `package.json` — `mapillary-js@4.1.2` dep.

---

## Task 1: Add dependency + env scaffolding

**Files:** Modify `package.json`; Create `.env.example`; Modify `docs/heat-map-feature.md`.

- [ ] **Step 1: Install mapillary-js pinned**

Run: `npm install mapillary-js@4.1.2`
Expected: adds `"mapillary-js": "4.1.2"` to dependencies; lockfile updated.

- [ ] **Step 2: Verify version (not the 5.x beta)**

Run: `node -e "console.log(require('./node_modules/mapillary-js/package.json').version)"`
Expected: `4.1.2`

- [ ] **Step 3: Create `.env.example`**

```
# Mapillary client token (PUBLIC — safe to expose in the browser bundle; read-only, rate-limited).
# Get one: mapillary.com -> dashboard -> developers -> create app -> copy the "Client Token".
# Without it, the /heat-map street-view layer disables itself gracefully.
PUBLIC_MAPILLARY_TOKEN=MLY|APP_ID|CLIENT_TOKEN_SECRET
```

- [ ] **Step 4: Note the env var in docs**

Append to `docs/heat-map-feature.md` (end of file):

```markdown

## Street-view layer (Mapillary)

The `/heat-map` street-view toggle needs `PUBLIC_MAPILLARY_TOKEN` (a public Mapillary
client token, `MLY|APP_ID|SECRET`). It is client-exposed via `import.meta.env` (the repo's
first `PUBLIC_*` var) and is NOT a secret — it is read-only and rate-limited, and Mapillary
offers no domain-restriction for it. Set it in Vercel project env (Production + Preview) and
in a local `.env`. Absent → the feature no-ops (toggle hidden).
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example docs/heat-map-feature.md
git commit -m "chore(heat-map): add mapillary-js@4.1.2 + PUBLIC_MAPILLARY_TOKEN scaffolding"
```

---

## Task 2: `coverage-layer.ts` — recency buckets + MapLibre layer

**Files:** Create `src/scripts/climate-engine/streetview/coverage-layer.ts`; Test `tests/unit/heat-map-streetview.test.mjs`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/heat-map-streetview.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { recencyBucket, coverageColorExpression, assertCoverageLogic } from '../../src/scripts/climate-engine/streetview/coverage-layer.ts';

test('recencyBucket maps captured_at (epoch-ms) to old/mid/fresh at the 2018/2023 boundaries', () => {
  assert.equal(recencyBucket(Date.UTC(2016, 0, 1)), 'old');
  assert.equal(recencyBucket(Date.UTC(2020, 5, 1)), 'mid');
  assert.equal(recencyBucket(Date.UTC(2024, 0, 1)), 'fresh');
  assert.equal(recencyBucket(1672531200000), 'fresh', '2023-01-01 exact = fresh');
  assert.equal(recencyBucket(1514764800000), 'mid', '2018-01-01 exact = mid');
});

test('coverageColorExpression is a MapLibre step expression over captured_at', () => {
  const e = coverageColorExpression();
  assert.equal(e[0], 'step');
  assert.deepEqual(e[1], ['get', 'captured_at']);
  assert.equal(e[3], 1514764800000);
  assert.equal(e[5], 1672531200000);
});

test('coverage self-check passes', () => { assertCoverageLogic(); });
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `node --import tsx --test tests/unit/heat-map-streetview.test.mjs`
Expected: FAIL — module not found / exports missing.

- [ ] **Step 3: Implement `coverage-layer.ts`**

```ts
import type { Map as MlMap, PointLike } from 'maplibre-gl';

// Mapillary coverage vector tiles (map-matched geometries). Token goes in the URL.
const TILE_URL = (token: string) =>
  `https://tiles.mapillary.com/maps/vtp/mly1_computed_public/2/{z}/{x}/{y}?access_token=${token}`;

const SOURCE = 'mly-coverage';
const SEQ_LAYER = 'mly-sequence';
const IMG_LAYER = 'mly-image';

// Recency thresholds (epoch-ms). Boundaries: <2018 old, 2018–2023 mid, >=2023 fresh.
export const T_2018 = 1514764800000; // 2018-01-01T00:00:00Z
export const T_2023 = 1672531200000; // 2023-01-01T00:00:00Z
const OLD = '#6b7a7d', MID = '#c39a5f', FRESH = '#5db98a';

export function recencyBucket(capturedAtMs: number): 'old' | 'mid' | 'fresh' {
  if (capturedAtMs < T_2018) return 'old';
  if (capturedAtMs < T_2023) return 'mid';
  return 'fresh';
}

/** MapLibre data-driven paint expression: colour by captured_at directly from the tiles. */
export function coverageColorExpression(): unknown[] {
  return ['step', ['get', 'captured_at'], OLD, T_2018, MID, T_2023, FRESH];
}

/** Add the coverage source + sequence(line) & image(point) layers. Idempotent + null-safe. */
export function addCoverage(map: MlMap, token: string): void {
  if (!token) return;
  if (!map.getSource(SOURCE)) {
    map.addSource(SOURCE, { type: 'vector', tiles: [TILE_URL(token)], minzoom: 6, maxzoom: 14 });
  }
  const color = coverageColorExpression() as never;
  if (!map.getLayer(SEQ_LAYER)) {
    map.addLayer({
      id: SEQ_LAYER, type: 'line', source: SOURCE, 'source-layer': 'sequence',
      paint: { 'line-color': color, 'line-width': 2, 'line-opacity': 0.85 },
    } as never);
  }
  if (!map.getLayer(IMG_LAYER)) {
    map.addLayer({
      id: IMG_LAYER, type: 'circle', source: SOURCE, 'source-layer': 'image', minzoom: 14,
      paint: { 'circle-color': color, 'circle-radius': 4, 'circle-stroke-width': 1, 'circle-stroke-color': '#02090a' },
    } as never);
  }
}

export function removeCoverage(map: MlMap): void {
  for (const id of [IMG_LAYER, SEQ_LAYER]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
}

export const IMAGE_LAYER_ID = IMG_LAYER;

/** Resolve a screen point to the nearest rendered image feature's id (string-cast for precision). */
export function queryImageIdAt(map: MlMap, point: PointLike): string | null {
  const feats = map.queryRenderedFeatures(point, { layers: [IMG_LAYER] });
  const id = feats[0]?.properties?.id;
  return id == null ? null : String(id);
}

export function assertCoverageLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`coverage: ${m}`); };
  ok(recencyBucket(0) === 'old', 'epoch 0 is old');
  ok(recencyBucket(T_2018) === 'mid' && recencyBucket(T_2018 - 1) === 'old', '2018 boundary');
  ok(recencyBucket(T_2023) === 'fresh' && recencyBucket(T_2023 - 1) === 'mid', '2023 boundary');
  const e = coverageColorExpression();
  ok(e[0] === 'step' && e[3] === T_2018 && e[5] === T_2023, 'expression thresholds intact');
}
```

- [ ] **Step 4: Run the test, verify it PASSES**

Run: `node --import tsx --test tests/unit/heat-map-streetview.test.mjs`
Expected: PASS (3 tests). Also `npm run check` → 0 errors referencing this file (maplibre-gl types resolve; it's already a dep).

- [ ] **Step 5: Commit**

```bash
git add src/scripts/climate-engine/streetview/coverage-layer.ts tests/unit/heat-map-streetview.test.mjs
git commit -m "feat(heat-map): Mapillary coverage layer + recency colour ramp"
```

---

## Task 3: `nearest-image.ts` — Graph API nearest-image lookup

**Files:** Create `src/scripts/climate-engine/streetview/nearest-image.ts`; Test extends `tests/unit/heat-map-streetview.test.mjs`.

- [ ] **Step 1: Append failing tests**

```js
import { nearestImage, asNearest } from '../../src/scripts/climate-engine/streetview/nearest-image.ts';

test('asNearest parses a Graph image row and string-casts the id', () => {
  assert.equal(asNearest({}), null);
  const n = asNearest({ id: 12345678901234567, thumb_1024_url: 'https://x/t.jpg', captured_at: 1700000000000 });
  assert.ok(n && typeof n.id === 'string' && n.thumbUrl === 'https://x/t.jpg' && n.capturedAt === 1700000000000);
});

test('nearestImage hits the radius search and returns the first result', async () => {
  const calls = [];
  const fakeFetch = async (url) => { calls.push(url); return { ok: true, json: async () => ({ data: [{ id: '99', thumb_1024_url: 'https://x/9.jpg', captured_at: 1710000000000 }] }) }; };
  const n = await nearestImage(88.371, 22.762, 'MLY|tok', fakeFetch);
  assert.ok(n && n.id === '99');
  assert.match(calls[0], /lat=22\.762/); assert.match(calls[0], /lng=88\.371/); assert.match(calls[0], /radius=50/);
});

test('nearestImage returns null on empty coverage', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
  assert.equal(await nearestImage(88.43, 22.36, 'MLY|tok', fakeFetch), null);
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `node --import tsx --test tests/unit/heat-map-streetview.test.mjs`
Expected: FAIL — `nearest-image` module not found.

- [ ] **Step 3: Implement `nearest-image.ts`**

```ts
export interface NearestImage { id: string; thumbUrl: string; capturedAt: number; }
type FetchLike = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const GRAPH = 'https://graph.mapillary.com/images';
const FIELDS = 'id,thumb_1024_url,captured_at,geometry';
const cache = new Map<string, Promise<NearestImage | null>>();

/** Narrow one Graph `images` row to NearestImage, string-casting the id (2^53 safety). */
export function asNearest(raw: unknown): NearestImage | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.id == null || typeof d.thumb_1024_url !== 'string') return null;
  const capturedAt = typeof d.captured_at === 'number' ? d.captured_at : 0;
  return { id: String(d.id), thumbUrl: d.thumb_1024_url, capturedAt };
}

async function query(url: string, fetchImpl: FetchLike): Promise<NearestImage | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: unknown[] };
    const rows = Array.isArray(j.data) ? j.data : [];
    for (const r of rows) { const n = asNearest(r); if (n) return n; }
    return null;
  } catch { return null; }
}

/**
 * Nearest Mapillary image to a lon/lat. Primary: radius search (<=50 m). Fallback: a small
 * bbox (radius param is new ~2026; bbox is the long-standing path). Cached per rounded coord.
 * Returns null when there's no nearby coverage (sparse wards) — callers show "no street photo".
 */
export function nearestImage(lon: number, lat: number, token: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<NearestImage | null> {
  if (!token) return Promise.resolve(null);
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const radiusUrl = `${GRAPH}?access_token=${token}&fields=${FIELDS}&lat=${lat}&lng=${lon}&radius=50&limit=1`;
  const p = query(radiusUrl, fetchImpl).then((n) => {
    if (n) return n;
    const d = 0.0006; // ~65 m half-box fallback
    const bboxUrl = `${GRAPH}?access_token=${token}&fields=${FIELDS}&bbox=${lon - d},${lat - d},${lon + d},${lat + d}&limit=1`;
    return query(bboxUrl, fetchImpl);
  });
  cache.set(key, p);
  return p;
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `node --import tsx --test tests/unit/heat-map-streetview.test.mjs`
Expected: PASS (6 tests total). `npm run check` 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/climate-engine/streetview/nearest-image.ts tests/unit/heat-map-streetview.test.mjs
git commit -m "feat(heat-map): Mapillary nearest-image lookup (radius + bbox fallback, cached)"
```

---

## Task 4: `street-view-panel.ts` — lazy viewer mount/dispose

**Files:** Create `src/scripts/climate-engine/streetview/street-view-panel.ts`; Test extends the same test file.

- [ ] **Step 1: Append failing test** (only the WebGL-free guard is unit-testable)

```js
import { shouldOpen, assertStreetViewLogic } from '../../src/scripts/climate-engine/streetview/street-view-panel.ts';

test('shouldOpen guards missing token / imageId (no viewer construction)', () => {
  assert.equal(shouldOpen('', 'img1'), false);
  assert.equal(shouldOpen('MLY|t', ''), false);
  assert.equal(shouldOpen('MLY|t', 'img1'), true);
});
test('street-view self-check passes', () => { assertStreetViewLogic(); });
```

- [ ] **Step 2: Run, verify FAIL**

Run: `node --import tsx --test tests/unit/heat-map-streetview.test.mjs`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Implement `street-view-panel.ts`**

`mapillary-js` is imported **inside** this module and this module is only ever dynamically imported (Task 6), so the heavy dep + its CSS load on first open. `shouldOpen` runs before any import so the unit test never touches WebGL.

```ts
import 'mapillary-js/dist/mapillary.css';

// mapillary-js Viewer — typed loosely to avoid a static type import of the heavy lib.
type Viewer = { moveTo: (id: string) => Promise<unknown>; remove: () => void };
let viewer: Viewer | null = null;
let mjs: Promise<typeof import('mapillary-js')> | null = null;

export function shouldOpen(token: string, imageId: string): boolean {
  return Boolean(token) && Boolean(imageId);
}

/** Open (or move) the Mapillary viewer to `imageId` inside `container`. Lazy-loads mapillary-js. */
export async function openViewer(container: HTMLElement, imageId: string, token: string): Promise<void> {
  if (!shouldOpen(token, imageId)) return;
  const { Viewer } = await (mjs ??= import('mapillary-js'));
  if (viewer) { await viewer.moveTo(imageId).catch(() => {}); return; }
  viewer = new Viewer({ accessToken: token, container, imageId }) as unknown as Viewer;
}

/** Tear the viewer down (frees the WebGL context). Safe to call when nothing is open. */
export function closeViewer(): void {
  try { viewer?.remove(); } catch { /* already gone */ }
  viewer = null;
}

export function assertStreetViewLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`street-view: ${m}`); };
  ok(shouldOpen('MLY|t', 'i') === true, 'valid opens');
  ok(shouldOpen('', 'i') === false && shouldOpen('t', '') === false, 'guards missing inputs');
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `node --import tsx --test tests/unit/heat-map-streetview.test.mjs`
Expected: PASS (8 tests). NOTE: the test must NOT trigger `openViewer` (that would import mapillary-js, which needs `window`). It only calls `shouldOpen`/`assertStreetViewLogic` — confirm no WebGL import in the run.
Run: `npm run check` — 0 errors (the `import 'mapillary-js/dist/mapillary.css'` resolves; mapillary-js ships types).

- [ ] **Step 5: Commit**

```bash
git add src/scripts/climate-engine/streetview/street-view-panel.ts tests/unit/heat-map-streetview.test.mjs
git commit -m "feat(heat-map): lazy Mapillary viewer panel (mount/moveTo/dispose)"
```

---

## Task 5: UI — toggle chip, viewer panel, card slot, CSS

**Files:** Modify `src/components/ClimateEngine/HeatMapStage.astro`.

- [ ] **Step 1: Add the toggle chip** — in the `.chiprow` beside `#tintchip` (near `HeatMapStage.astro:160`), add:

```html
<div class="modechip" id="streetchip" hidden title="Show Mapillary street-level coverage; click a point for the real photo"><button class="on" data-s="0">Street off</button><button data-s="1">Street view</button></div>
```
(Starts `hidden`; Task 6 reveals it only when a token is present.)

- [ ] **Step 2: Add the viewer panel markup** — top-level, right after the `#srcModal` block (`~HeatMapStage.astro:256`), so `position:fixed` resolves to the viewport (same lesson as the receipts modal):

```html
<!-- Street-view viewer: top-level (outside backdrop-filtered panels). mapillary-js mounts into #svViewer. -->
<div class="svmodal" id="svModal" hidden>
  <div class="svmodal-card">
    <button class="svmodal-x" id="svClose" type="button" aria-label="Close street view">✕</button>
    <div id="svViewer" class="svmodal-viewer"></div>
    <div class="svmodal-credit">Street imagery · <a href="https://www.mapillary.com" target="_blank" rel="noopener">Mapillary</a> · community-captured (CC BY-SA)</div>
  </div>
</div>
```

- [ ] **Step 3: Add the card thumbnail slot** — inside the building card, after the `bcLL` element (grep for `id="bcLL"`), add:

```html
<div class="sv-thumb" id="svThumb" hidden></div>
```

- [ ] **Step 4: Add CSS** — near the `.srcmodal` rules. mapillary-js needs an explicitly-sized container:

```css
  .svmodal{position:fixed;inset:0;z-index:40;display:none;place-items:center;background:rgb(2 9 10 /.72);backdrop-filter:blur(3px)}
  .svmodal:not([hidden]){display:grid}
  .svmodal-card{position:relative;width:min(1100px,92vw);height:min(680px,80vh);background:#02090a;border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:0 20px 60px rgb(0 0 0 /.5)}
  .svmodal-viewer{width:100%;height:100%}
  .svmodal-x{position:absolute;top:10px;right:10px;z-index:2;width:32px;height:32px;border-radius:50%;border:0;background:rgb(2 9 10 /.8);color:#eef1f2;cursor:pointer;font-size:15px}
  .svmodal-credit{position:absolute;left:10px;bottom:8px;z-index:2;font-family:var(--mono);font-size:9px;letter-spacing:.08em;color:#c9d4d5;background:rgb(2 9 10 /.6);padding:3px 7px;border-radius:5px}
  .svmodal-credit a{color:var(--cyan)}
  .sv-thumb{margin-top:.5rem}
  .sv-thumb img{width:100%;border-radius:8px;display:block;cursor:pointer;border:1px solid var(--line)}
  .sv-thumb .sv-none{font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--faint);text-transform:uppercase}
```
(Confirm `--line`,`--cyan`,`--faint` exist in this file — they're used by the receipts modal.)

- [ ] **Step 5: Verify build parses**

Run: `npm run check`
Expected: 0 errors (markup + CSS valid; `#streetchip`/`#svModal`/`#svThumb` present).

- [ ] **Step 6: Commit**

```bash
git add src/components/ClimateEngine/HeatMapStage.astro
git commit -m "feat(heat-map): street-view toggle, viewer panel, card thumbnail slot + CSS"
```

---

## Task 6: Wire the toggle + coverage + click-to-view (`heat-map-app.ts`)

**Files:** Modify `src/scripts/climate-engine/heat-map-app.ts`.

- [ ] **Step 1: Imports + token + flag**

Near the other climate-engine imports add (STATIC for the light modules; the heavy viewer stays dynamic):
```ts
import { addCoverage, removeCoverage, IMAGE_LAYER_ID } from './streetview/coverage-layer';
import { nearestImage } from './streetview/nearest-image';
```
Beside `let mode … env …` (`:102`):
```ts
let streetOn = false;
const MLY_TOKEN = (import.meta.env.PUBLIC_MAPILLARY_TOKEN as string | undefined) ?? '';
```

- [ ] **Step 2: A dynamic-import helper for the viewer** (mirrors `ensureRelief`; keeps mapillary-js out of the static bundle):

```ts
async function openStreetView(imageId: string): Promise<void> {
  if (!MLY_TOKEN || !imageId) return;
  const panel = el('svViewer'); const modal = el('svModal');
  if (!panel || !modal) return;
  modal.removeAttribute('hidden');
  const { openViewer } = await import('./streetview/street-view-panel');
  await openViewer(panel, imageId, MLY_TOKEN);
}
function closeStreetView(): void {
  el('svModal')?.setAttribute('hidden', '');
  void import('./streetview/street-view-panel').then(({ closeViewer }) => closeViewer());
}
```

- [ ] **Step 3: Reveal the chip only if a token exists + wire it** — where other chips are wired (`~:1428`):

```ts
if (MLY_TOKEN) el('streetchip')?.removeAttribute('hidden');
document.querySelectorAll('#streetchip button').forEach((b) => onEl(b, 'click', () => {
  streetOn = (b as HTMLElement).dataset.s === '1';
  document.querySelectorAll('#streetchip button').forEach((x) => x.classList.toggle('on', x === b));
  if (streetOn && MLY_TOKEN) addCoverage(map, MLY_TOKEN); else removeCoverage(map);
  map.triggerRepaint();
}));
```

- [ ] **Step 4: Click a coverage point → open the viewer** — register once, near the chip wiring:

```ts
map.on('click', IMAGE_LAYER_ID, (e) => {
  const id = e.features?.[0]?.properties?.id;
  if (id != null) void openStreetView(String(id));
});
map.on('mouseenter', IMAGE_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', IMAGE_LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
```

- [ ] **Step 5: Close wiring (mirror the receipts modal)** — near the receipts open/close (`~:1361-1371`):

```ts
onEl(el('svClose'), 'click', closeStreetView);
onEl(el('svModal'), 'click', (e) => { if (e.target === el('svModal')) closeStreetView(); });
onEl(document, 'keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') closeStreetView(); });
```
(Use the existing cleanup-registering `onEl`; if there's already a shared Esc handler, add the `closeStreetView()` call there instead of a second listener.)

- [ ] **Step 6: Verify**

Run: `npm run check` → 0 errors. `npm run test:unit` → all pass.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/climate-engine/heat-map-app.ts
git commit -m "feat(heat-map): wire street-view toggle -> coverage layer + click-to-view"
```

---

## Task 7: Building-card "real photo" thumbnail (`heat-map-app.ts`)

**Files:** Modify `src/scripts/climate-engine/heat-map-app.ts` (`paintCard`, `:255-347`).

- [ ] **Step 1: Fill the thumbnail on building select** — inside `paintCard(b)`, right after the `const ll = wardLatLon(...)` line (`:266`), add:

```ts
  const svThumb = el('svThumb');
  if (svThumb && MLY_TOKEN) {
    svThumb.removeAttribute('hidden');
    svThumb.innerHTML = '<span class="sv-none">Looking for a street photo…</span>';
    void nearestImage(ll.lon, ll.lat, MLY_TOKEN).then((img) => {
      if (el('svThumb') !== svThumb) return; // selection changed
      if (!img) { svThumb.innerHTML = '<span class="sv-none">No nearby street photo</span>'; return; }
      svThumb.innerHTML = '';
      const im = document.createElement('img');
      im.src = img.thumbUrl; im.alt = 'Real street view of this block (Mapillary)'; im.loading = 'lazy';
      im.addEventListener('click', () => { void openStreetView(img.id); });
      svThumb.appendChild(im);
    });
  } else if (svThumb) {
    svThumb.setAttribute('hidden', '');
  }
```
(If `paintCard` rebuilds the card via `innerHTML`/`setHTML`, ensure `#svThumb` survives — it lives in the static card markup from Task 5, so target it by id after paint. If the card is fully re-rendered, move this block to the end of `paintCard` so `#svThumb` exists when queried.)

- [ ] **Step 2: Verify build + no regressions**

Run: `npm run check && npm run test:unit`
Expected: 0 errors; all unit tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/climate-engine/heat-map-app.ts
git commit -m "feat(heat-map): real-photo thumbnail in the building card (nearest Mapillary image)"
```

---

## Task 8: Extend the module-boundary test to gate mapillary-js

**Files:** Modify `tests/unit/heat-explore-module-boundary.test.mjs`.

- [ ] **Step 1: Add the gate** — after the existing `three` assertions on the `heat-map-app.ts` source string (`source`), add:

```js
  // mapillary-js is ~290 KB; it and the viewer panel MUST be dynamically imported so they
  // never enter the static bundle. A static import here would defeat the lazy boundary.
  assert.doesNotMatch(source, /import\s+[^\n]*from\s+['"]mapillary-js['"]/, 'mapillary-js must be dynamically imported, never static, in heat-map-app.ts');
  assert.doesNotMatch(source, /import\s+[^\n]*from\s+['"]\.\/streetview\/street-view-panel['"]/, 'street-view-panel must be dynamically imported in heat-map-app.ts');
  assert.match(source, /import\(['"]\.\/streetview\/street-view-panel['"]\)/, 'street-view-panel is loaded via dynamic import()');
```

- [ ] **Step 2: Run it, verify it PASSES** (Task 6 already used a dynamic import, so this is green):

Run: `node --import tsx --test tests/unit/heat-explore-module-boundary.test.mjs`
Expected: PASS. (Sanity: temporarily add `import {} from 'mapillary-js';` to `heat-map-app.ts` → test FAILS → remove it → PASS.)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/heat-explore-module-boundary.test.mjs
git commit -m "test(heat-map): gate static mapillary-js / street-view-panel imports"
```

---

## Task 9: Full verification + visual confirmation

**Files:** run-only.

- [ ] **Step 1: Full gates**

Run: `npm run check && npm run test:unit && npm run build`
Expected: 0 type errors; all unit tests pass (incl. the boundary gate); build green.

- [ ] **Step 2: Confirm mapillary-js is NOT in the main bundle**

Run: `grep -rl "mapillary" dist/_astro/*.js | xargs -I{} basename {}` then check its size, OR: confirm a separate lazy chunk contains it and the main heat-map entry does not.
Expected: mapillary-js appears only in an on-demand chunk, not the entry chunk.

- [ ] **Step 3: Visual smoke test (needs `PUBLIC_MAPILLARY_TOKEN` set + dev server)**

Set the token in `.env` (`PUBLIC_MAPILLARY_TOKEN=MLY|…`), run the dev server, open `/heat-map`, switch to **Barrackpore** (best coverage), and verify:
- The "Street view" chip is visible (hidden if token absent).
- Toggling it on paints coverage points/lines coloured green (2026 in Barrackpore).
- Clicking a green point opens the viewer panel with a real street photo; ✕ / Esc / backdrop close it and free the viewer.
- Clicking a building shows a "real photo of this block" thumbnail (or "No nearby street photo" in sparse spots); tapping the thumbnail opens the viewer.
- Console clean; the 3D scene still renders (viewer is a separate DOM panel).

Screenshot for the record (Playwright, forcing render tier 2 as in `previews/_shot-receipts.mjs`): capture coverage-on + viewer-open.

- [ ] **Step 4: Confirm token stays out of git**

Run: `git status --porcelain | grep -E "\\.env$" || echo "clean — no .env committed"`
Expected: `clean — no .env committed` (only `.env.example` is tracked).

- [ ] **Step 5: Final commit (if any doc tweaks)**

```bash
git add -A
git commit -m "docs(heat-map): street-view Phase 1 verified" || echo "nothing to commit"
```

---

## Deferred (Phase 2 — not in this plan)

Canopy-validation stat: sample Mapillary `nature--vegetation` image detections along covered
streets, compare to the CHM canopy, surface a "street-camera agrees ~X%" receipt. Gated on
Phase 1 showing coverage is rich enough (realistically Barrackpore-only). Separate spec + plan.

---

## Self-review (completed)

- **Spec coverage:** §3(a) coverage toggle + viewer → Tasks 2,5,6; §3(b) card thumbnail → Tasks 3,7; §4 token/env → Task 1; §5 data flow (tiles, id-cast, radius) → Tasks 2,3; §6 components → Tasks 2,3,4; §7 attribution → Task 5 (credit markup) ; §8 perf/lazy → Tasks 4,6,9(step 2); §9 testing incl. boundary gate → Tasks 2–4,8,9. All covered.
- **Placeholder scan:** no TBD/TODO; every code step is complete. Two live-confirm items from the spec (radius param names; viewer attribution chrome) are handled defensively in code (bbox fallback; explicit credit markup) rather than left as placeholders.
- **Type consistency:** `NearestImage{id,thumbUrl,capturedAt}`, `nearestImage(lon,lat,token,fetchImpl?)`, `addCoverage/removeCoverage/IMAGE_LAYER_ID/queryImageIdAt`, `openViewer/closeViewer/shouldOpen`, `openStreetView/closeStreetView`, `streetOn`, `MLY_TOKEN` — used consistently across tasks. Recency thresholds `T_2018/T_2023` shared between the expression and `recencyBucket`.
