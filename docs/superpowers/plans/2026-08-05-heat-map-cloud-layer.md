# Heat-map cloud layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the ward's measured cloud cover as a drifting deck above the city, with its
shadows on the massing — and fix the met.no terms-of-service breach the page already ships.

**Architecture:** Two independent phases. **A** puts a Vercel serverless function in front
of met.no so the call carries an identifying User-Agent and is cached once for all
visitors; the browser's fetch URL changes and nothing else. **B** adds `cloud-sprites.ts`
(pure canvas generation, node-testable) and `cloud-layer.ts` (a THREE wrapper, sibling of
`water-layer.ts`), driven by `state.live.cloud` — the same scalar the physics already
reads.

**Tech Stack:** TypeScript, three.js sprites + canvas 2D texture generation, Vercel
serverless functions, `node --test` with `tsx`.

**Contract:** [`docs/superpowers/specs/2026-08-05-heat-map-cloud-layer-design.md`](../specs/2026-08-05-heat-map-cloud-layer-design.md)

---

## Before you start: three facts that shape every task

**1. Cloud is already a model input.** `heat-map-model.ts:338` reads
`cloud = L ? L.cloud / 100 : 0`, `:360` feeds it to `skyTemperatureC`, and `:367` cuts
direct sun by `1 - 0.6 * cloud`. This layer draws that scalar. **It must never introduce a
second cloud source** — a GIBS raster or a forecast would put a sky on screen that the
model is not using.

**2. The site is fully static.** `astro.config.mjs` sets no `output` and no adapter;
`@astrojs/vercel` is not installed. So **an Astro API route is not available** — it would
flip the whole build to hybrid. Phase A uses a bare Vercel function at `/api/`, which
Vercel picks up independently of the framework preset. Task A1 verifies that before any
code depends on it.

**3. This plan is self-contained.** The look was approved from
`previews/sky-3d/index.html`, but that directory is **gitignored and will not exist in a
fresh checkout**, so every gradient stop, lobe row and constant is written out here rather
than referenced. If the preview happens to be on disk it is a useful sanity check, never a
dependency. Approved constants: **round 0.62 · oval 0.72 · size 0.72× · deck 320 m ·
26 clouds.**

---

## File structure

```
api/live.js                                    NEW  A · Vercel function: met.no with a
                                                    compliant UA + shared cache. Plain JS,
                                                    no framework, no build step.
src/scripts/climate-engine/heat-map-app.ts     EDIT A · one fetch URL
                                               EDIT B · ~8 lines: create, advance, dispose
src/components/ClimateEngine/HeatMapStage.astro EDIT A · CC BY link on the Met Norway credit
                                               EDIT B · cloud readout pill

src/scripts/climate-engine/cloud-sprites.ts    NEW  B · PURE. Lobe layout, fit(), gradients,
                                                    cumulus()/veil()/shadowTex(). Takes a
                                                    canvas factory so node can test it.
src/scripts/climate-engine/cloud-layer.ts      NEW  B · THREE wrapper: sprite pool, drift,
                                                    shadow planes, dispose. Sibling of
                                                    water-layer.ts.

tests/unit/heat-map-cloud.test.mjs             NEW  fit() borders, fuse() curve, render-only
                                                    tripwires, null-live guard
tests/unit/metno-proxy.test.mjs                NEW  A · UA present, no key leaked, cache hdrs
```

---

## Phase A — met.no compliance (~1 hour)

The page currently calls `https://api.met.no/...` directly from every visitor's browser
with no headers. Their terms:

> "All requests **must** (if possible) include an identifying User Agent-string… Failure
> to identify risks being **blocked without warning**."
> "Browsers and mobile apps **should not contact the API directly**, but instead use a
> local proxy (backend for frontend) server."
> "Anything over 20 requests/second **per application (total, not per client)**"

`User-Agent` is a forbidden header in browser `fetch()`, so this cannot be fixed in place.

### Task A1: Prove a bare Vercel function works on this static build

**Files:**
- Create: `api/ping.js`

- [ ] **Step 1: Write the smallest possible function**

Create `api/ping.js`:

```js
export default function handler(req, res) {
  res.status(200).json({ ok: true, from: 'vercel-function' });
}
```

- [ ] **Step 2: Deploy a preview and hit it**

```bash
npx vercel deploy --yes 2>&1 | tail -3
```

Take the deployment URL from the output, then:

```bash
curl -s "https://<deployment-url>/api/ping"
```

Expected: `{"ok":true,"from":"vercel-function"}`

**If this returns 404**, the framework preset is not exposing `/api`. Do not continue
guessing — stop and report. The fallback is installing `@astrojs/vercel` and setting
`output: 'server'` in `astro.config.mjs`, which is a larger change than this plan covers
and needs its own review.

- [ ] **Step 3: Confirm the static site still builds and serves**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://<deployment-url>/heat-map"
```

Expected: `200`

- [ ] **Step 4: Delete the probe and commit nothing yet**

```bash
rm api/ping.js
```

The probe was a question, not a feature. Task A2 writes the real function.

### Task A2: The met.no proxy

**Files:**
- Create: `api/live.js`
- Test: `tests/unit/metno-proxy.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/metno-proxy.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = () => readFile(join(ROOT, 'api/live.js'), 'utf8');

test('the proxy identifies itself, as met.no requires', async () => {
  const s = await src();
  assert.match(s, /['"]User-Agent['"]/,
    'met.no: "All requests must include an identifying User Agent-string… Failure to '
    + 'identify risks being blocked without warning." A browser cannot set this header, '
    + 'which is the whole reason this proxy exists.');
  assert.match(s, /deltaclimate\.earth/,
    'the UA must carry the domain so met.no can identify us');
  assert.match(s, /@/, 'the UA must carry a contact address');
});

test('only latitude and longitude reach met.no', async () => {
  const s = await src();
  assert.doesNotMatch(s, /req\.url/,
    'forwarding the raw URL would pass arbitrary query strings upstream; read lat/lon '
    + 'from req.query and rebuild the URL');
  assert.match(s, /Number\.isFinite/,
    'lat/lon must be parsed as numbers, not interpolated as strings');
});

test('responses are cached so N visitors are not N upstream calls', async () => {
  const s = await src();
  assert.match(s, /Cache-Control/,
    'met.no asks clients to respect cache headers; collapsing visitors into one upstream '
    + 'call per window is the point of a backend-for-frontend');
  assert.match(s, /s-maxage/, 'the shared CDN cache is what actually collapses the calls');
});

test('no secret is present — this endpoint needs none', async () => {
  const s = await src();
  assert.doesNotMatch(s, /process\.env\.[A-Z_]*(KEY|TOKEN|SECRET)/,
    'met.no is keyless; anything that looks like a credential here is a mistake');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/unit/metno-proxy.test.mjs`
Expected: FAIL — `ENOENT: no such file or directory, open '.../api/live.js'`

- [ ] **Step 3: Write the function**

Create `api/live.js`:

```js
/**
 * met.no locationforecast, proxied.
 *
 * WHY THIS EXISTS. api.met.no's terms require an identifying User-Agent and say
 * plainly that browsers "should not contact the API directly, but instead use a
 * local proxy (backend for frontend) server". `User-Agent` is a forbidden header
 * in browser fetch(), so the compliance gap could not be closed in place — the
 * call had to move off the client.
 *
 * The rate limit is "20 requests/second per APPLICATION (total, not per client)",
 * so a per-visitor call is also the wrong shape as traffic grows. s-maxage
 * collapses every visitor in a 10-minute window into one upstream request.
 *
 * met.no is keyless and CC BY 4.0. There is no secret here and there must not be.
 */
const UA = 'delta-climate-research/1.0 (https://deltaclimate.earth; kumarantar98@gmail.com)';
const UPSTREAM = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';

/* met.no publishes hourly; 10 minutes is well inside that and keeps the freshness
   readout honest, while cutting upstream calls by however many visitors arrive. */
const SHARED_MAX_AGE = 600;

export default async function handler(req, res) {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)
      || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    res.status(400).json({ error: 'lat and lon required' });
    return;
  }
  try {
    const upstream = await fetch(
      `${UPSTREAM}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    );
    if (!upstream.ok) {
      res.status(502).json({ error: `met.no ${upstream.status}` });
      return;
    }
    const body = await upstream.json();
    res.setHeader('Cache-Control',
      `public, max-age=60, s-maxage=${SHARED_MAX_AGE}, stale-while-revalidate=1800`);
    /* The client reads this to age the reading against the server's clock rather
       than the visitor's — see the `served` handling in heat-map-app.ts. */
    res.setHeader('Date', new Date().toUTCString());
    res.status(200).json(body);
  } catch {
    res.status(502).json({ error: 'met.no unreachable' });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/metno-proxy.test.mjs`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add api/live.js tests/unit/metno-proxy.test.mjs
git commit -m "feat(live): proxy met.no with a compliant User-Agent

Their terms require identification and say browsers should not call the API
directly. User-Agent is a forbidden header in browser fetch(), so this could not
be fixed in place. s-maxage also collapses N visitors into one upstream call,
which the per-application rate limit needs as traffic grows."
```

### Task A3: Point the client at the proxy

**Files:**
- Modify: `src/scripts/climate-engine/heat-map-app.ts:1122`

- [ ] **Step 1: Change the fetch URL**

Find this line (currently 1122):

```ts
        const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${w.lat}&lon=${w.lon}`);
```

Replace with:

```ts
        /* Through our own function, never api.met.no directly: their terms require
           an identifying User-Agent, which a browser fetch cannot set. See api/live.js. */
        const r = await fetch(`/api/live?lat=${w.lat}&lon=${w.lon}`);
```

- [ ] **Step 2: Verify nothing downstream changes**

The proxy returns met.no's body verbatim, so `ts.data.instant.details` still parses.
Confirm the parse line is untouched:

Run: `grep -n "cloud: dd.cloud_area_fraction" src/scripts/climate-engine/heat-map-app.ts`
Expected: one match at ~line 1138.

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: `0 errors`

- [ ] **Step 4: Commit**

```bash
git add src/scripts/climate-engine/heat-map-app.ts
git commit -m "fix(live): call met.no through our proxy, not from the visitor's browser"
```

### Task A4: Complete the CC BY attribution

**Files:**
- Modify: `src/components/ClimateEngine/HeatMapStage.astro:196`

- [ ] **Step 1: Add the licence link**

CC BY 4.0 requires "appropriate credit, a link to the license, and indication if changes
were made". We credit Met Norway but do not link the licence. Find (line 196):

```astro
        <div class="k">Live ambient · Met Norway <span class="livedot" id="livedot"></span></div>
```

Replace with:

```astro
        <div class="k">Live ambient · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">Met Norway (CC BY 4.0)</a> <span class="livedot" id="livedot"></span></div>
```

- [ ] **Step 2: Verify it renders and the link is not styled away**

Run: `npm run build && grep -c "creativecommons.org/licenses/by/4.0" dist/heat-map/index.html`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add src/components/ClimateEngine/HeatMapStage.astro
git commit -m "docs(live): link the CC BY 4.0 licence, as the attribution requires"
```

**Phase A exit:** deploy to a preview URL, confirm `/api/live?lat=22.528&lon=88.3659`
returns JSON with an `air_temperature`, confirm the heat map's live readout still
populates, and confirm a second request within 10 minutes is served from cache
(`x-vercel-cache: HIT`).

---

## Phase B — the cloud layer (~half a day)

### Task B1: Pure sprite generation

**Files:**
- Create: `src/scripts/climate-engine/cloud-sprites.ts`
- Test: `tests/unit/heat-map-cloud.test.mjs`

The two bugs this task exists to prevent are recorded in the spec §5: lobes placed in
canvas pixels overflowed the bitmap so its rectangle became the silhouette (the "straight
edges"), and a gradient fading from the centre read as haze rather than a curved bump.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/heat-map-cloud.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutCumulus, layoutVeil, fitLobes, cloudFuse, CLOUD }
  from '../../src/scripts/climate-engine/cloud-sprites.ts';

/** Deterministic source so a layout can be asserted at all. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

test('no lobe reaches the sprite border, at any roundness or ovalness', () => {
  // This is the "straight edges" bug: lobes were positioned in canvas pixels and
  // overflowed, so the bitmap's own rectangle became the cloud's silhouette.
  for (const oval of [0, 0.36, 0.72, 1]) {
    const W = 512, H = Math.round(W * (0.74 - oval * 0.32));
    const lobes = layoutCumulus(seeded(7723117), oval);
    fitLobes(lobes, W, H, CLOUD.PAD);
    for (const L of lobes) {
      const gap = Math.min(L.cx - L.rx, L.cy - L.ry, W - (L.cx + L.rx), H - (L.cy + L.ry));
      assert.ok(gap >= W * 0.08,
        `oval ${oval}: a lobe sits ${gap.toFixed(1)}px from the border (need ≥ ${W * 0.08}). `
        + 'Overflow here is what made the clouds look like rectangles.');
    }
  }
});

test('ovalness widens the silhouette monotonically', () => {
  const aspect = (oval) => {
    const W = 512, H = Math.round(W * (0.74 - oval * 0.32));
    const lobes = layoutCumulus(seeded(7723117), oval);
    fitLobes(lobes, W, H, CLOUD.PAD);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const L of lobes) {
      minX = Math.min(minX, L.cx - L.rx); maxX = Math.max(maxX, L.cx + L.rx);
      minY = Math.min(minY, L.cy - L.ry); maxY = Math.max(maxY, L.cy + L.ry);
    }
    return (maxX - minX) / (maxY - minY);
  };
  const a0 = aspect(0), a1 = aspect(0.72), a2 = aspect(1);
  assert.ok(a0 < a1 && a1 < a2, `aspect must increase with oval: ${a0} ${a1} ${a2}`);
  assert.ok(a1 > 3 && a1 < 4, `at the approved oval 0.72 expect ~3.4:1, got ${a1.toFixed(2)}`);
});

test('lobes are ellipses, squashed hardest at the base', () => {
  const lobes = layoutCumulus(seeded(7723117), 0.72).filter(L => L.main);
  const base = lobes.filter(L => L.cy > 0.45), crown = lobes.filter(L => L.cy < 0.2);
  const flat = (a) => a.reduce((s, L) => s + L.ry / L.rx, 0) / a.length;
  assert.ok(flat(base) < flat(crown),
    'a cumulus has a flat bottom and a domed top; base lobes must be flatter than crowns');
});

test('cover crosses from cumulus to veil, continuously', () => {
  assert.equal(cloudFuse(0), 0, 'clear sky is all cumulus');
  assert.equal(cloudFuse(1), 1, 'overcast is all veil');
  assert.equal(cloudFuse(0.42), 0, 'the crossover starts at 42% cover');
  let prev = -1;
  for (let c = 0; c <= 1.0001; c += 0.02) {
    const f = cloudFuse(c);
    assert.ok(f >= prev - 1e-9, `fuse must not decrease: ${c} gave ${f} after ${prev}`);
    assert.ok(f >= 0 && f <= 1, `fuse out of range at ${c}: ${f}`);
    prev = f;
  }
});

test('the veil layout also stays inside its border', () => {
  const W = 768, H = Math.round(W * 0.44);
  const lobes = layoutVeil(seeded(31337));
  fitLobes(lobes, W, H, CLOUD.PAD);
  for (const L of lobes) {
    const gap = Math.min(L.cx - L.rx, L.cy - L.ry, W - (L.cx + L.rx), H - (L.cy + L.ry));
    assert.ok(gap >= W * 0.08, `veil lobe ${gap.toFixed(1)}px from the border`);
  }
});

test('the approved constants are pinned', () => {
  assert.equal(CLOUD.ROUND, 0.62);
  assert.equal(CLOUD.OVAL, 0.72);
  assert.equal(CLOUD.SIZE, 0.72);
  assert.equal(CLOUD.DECK_M, 320);
  assert.equal(CLOUD.COUNT, 26);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/unit/heat-map-cloud.test.mjs`
Expected: FAIL — `Cannot find module '.../cloud-sprites.ts'`

- [ ] **Step 3: Write the implementation**

Create `src/scripts/climate-engine/cloud-sprites.ts`. Port the sprite code from
`previews/sky-3d/index.html` (functions `fit`, `cumulus`, `veil`, `shadowTex`), splitting
the *layout* (pure, testable) from the *painting* (needs a canvas):

```ts
/**
 * cloud-sprites.ts — the cloud's shape, as pure geometry plus a painter.
 *
 * RENDER ONLY. Nothing here reaches SimLayers or Spatial. The cover this draws is
 * `state.live.cloud`, which heat-map-model.ts already feeds to skyTemperatureC and
 * to the direct-sun term — so this is the model's own input made visible, not a
 * second opinion about the sky.
 *
 * TWO BUGS ARE ENCODED AS STRUCTURE HERE, because both shipped in the preview and
 * both looked like styling problems rather than defects:
 *
 *   1. Lobes were positioned in canvas pixels and the outer ones ran past the
 *      bitmap bounds, so the texture's RECTANGLE became the cloud's silhouette.
 *      Layout is now abstract and `fitLobes` scales it in with a margin. Guarded.
 *   2. A gradient that fades from the centre reads as haze, not as a bump. Alpha
 *      holds near-full to a PLATEAU and only then falls — that plateau is what
 *      draws a curved edge.
 *
 * Lobes are ellipses, squashed hardest at the base and near-round at the crown,
 * which is what gives a cumulus its flat bottom and domed top.
 */

/** Approved from previews/sky-3d/index.html, 2026-08-05. */
export const CLOUD = Object.freeze({
  ROUND: 0.62,
  OVAL: 0.72,
  SIZE: 0.72,
  /** metres. Real cloud base is nearer 700 m; compressed for legibility and labelled. */
  DECK_M: 320,
  COUNT: 26,
  /** fraction of the sprite kept clear on every side */
  PAD: 0.13,
  /** cover at which cumulus start fusing into veils, and the width of that fuse */
  FUSE_AT: 0.42,
  FUSE_SPAN: 0.44,
});

export interface Lobe {
  cx: number; cy: number; rx: number; ry: number; main?: boolean;
}

/** 0 = discrete cumulus, 1 = merged veil. Continuous and monotonic in cover. */
export function cloudFuse(cover: number): number {
  return Math.max(0, Math.min(1, (cover - CLOUD.FUSE_AT) / CLOUD.FUSE_SPAN));
}

/** Scale an abstract lobe cluster into a canvas, leaving `pad` clear on every side. */
export function fitLobes(lobes: Lobe[], W: number, H: number, pad: number): void {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const L of lobes) {
    minX = Math.min(minX, L.cx - L.rx); maxX = Math.max(maxX, L.cx + L.rx);
    minY = Math.min(minY, L.cy - L.ry); maxY = Math.max(maxY, L.cy + L.ry);
  }
  const availW = W * (1 - 2 * pad), availH = H * (1 - 2 * pad);
  const s = Math.min(availW / (maxX - minX), availH / (maxY - minY));
  const offX = W * pad + (availW - (maxX - minX) * s) / 2;
  const offY = H * pad + (availH - (maxY - minY) * s) / 2;
  for (const L of lobes) {
    L.cx = offX + (L.cx - minX) * s;
    L.cy = offY + (L.cy - minY) * s;
    L.rx *= s; L.ry *= s;
  }
}

const ROWS = [
  { n: 6, y: 0.52, r: [0.125, 0.165], s: 1.52, sq: 0.60 },
  { n: 5, y: 0.36, r: [0.130, 0.175], s: 1.26, sq: 0.70 },
  { n: 3, y: 0.22, r: [0.115, 0.155], s: 0.80, sq: 0.80 },
  { n: 2, y: 0.11, r: [0.088, 0.120], s: 0.40, sq: 0.86 },
];

export function layoutCumulus(rnd: () => number, oval: number): Lobe[] {
  const SPREAD = 0.70 + oval * 0.62, SQUASH = 1.24 - oval * 0.46;
  const lobes: Lobe[] = [];
  for (const row of ROWS)
    for (let i = 0; i < row.n; i++) {
      const u = row.n === 1 ? 0.5 : i / (row.n - 1);
      const rx = row.r[0] + rnd() * (row.r[1] - row.r[0]);
      lobes.push({
        cx: 0.9 + (u - 0.5) * row.s * SPREAD + (rnd() - 0.5) * 0.06,
        cy: row.y + (rnd() - 0.5) * 0.035,
        rx, ry: rx * Math.min(0.94, row.sq * SQUASH + (rnd() - 0.5) * 0.07),
        main: true,
      });
    }
  /* Second octave. A handful of big shapes reads as a cartoon; real cumulus
     outlines are fractal, so smaller bumps ride the silhouette. */
  const mains = lobes.slice();
  for (let i = 0; i < 26; i++) {
    const L = mains[(rnd() * mains.length) | 0];
    const a = L.cy < 0.30 ? Math.PI * (1.02 + rnd() * 0.96)
      : (rnd() < 0.5 ? Math.PI * (0.70 + rnd() * 0.55) : Math.PI * (1.02 + rnd() * 0.96));
    const rx = L.rx * (0.24 + rnd() * 0.26);
    lobes.push({
      cx: L.cx + Math.cos(a) * L.rx * (0.70 + rnd() * 0.24),
      cy: L.cy + Math.sin(a) * L.ry * (0.66 + rnd() * 0.26),
      rx, ry: rx * (0.66 + rnd() * 0.22),
    });
  }
  return lobes;
}

export function layoutVeil(rnd: () => number): Lobe[] {
  const lobes: Lobe[] = [];
  for (let i = 0; i < 15; i++) {
    const rx = 0.11 + rnd() * 0.15;
    lobes.push({
      cx: rnd() * 1.9, cy: 0.5 + (rnd() - 0.5) * 0.34,
      rx, ry: rx * (0.30 + rnd() * 0.18),
    });
  }
  return lobes;
}
```

Then append the painters. These are not unit-tested — their correctness is visual and
Task B5 is the check — but the gradient stops are load-bearing and are given in full here
rather than by reference, because `previews/` is gitignored and will not exist in a fresh
checkout:

```ts
/** Alpha holds to this fraction of the radius, then falls. THE plateau — a gradient
 *  that fades from the centre reads as haze rather than as a curved bump. */
const plateau = (round: number) => 0.46 + round * 0.40;

export function paintCumulus(
  ctx: CanvasRenderingContext2D, lobes: Lobe[], W: number, H: number, round: number,
): void {
  let top = Infinity, bot = -Infinity;
  for (const L of lobes) { top = Math.min(top, L.cy - L.ry); bot = Math.max(bot, L.cy + L.ry); }
  const span = bot - top, P = plateau(round);

  ctx.save(); ctx.filter = `blur(${W * 0.022}px)`;
  const bg = ctx.createLinearGradient(0, bot - span * 0.38, 0, bot);
  bg.addColorStop(0, 'rgba(118,142,164,.46)'); bg.addColorStop(1, 'rgba(106,130,152,0)');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.ellipse(W * 0.5, bot - span * 0.12, W * 0.36, span * 0.16, 0, 0, 7);
  ctx.fill(); ctx.restore();

  for (const L of [...lobes].sort((a, b) => b.cy - a.cy)) {
    const hf = 1 - (L.cy - top) / span;                 // 0 base → 1 crown
    const lum = 236 + hf * 19, mid = 196 + hf * 46;
    ctx.save(); ctx.translate(L.cx, L.cy); ctx.scale(1, L.ry / L.rx);
    const gr = ctx.createRadialGradient(-L.rx * 0.20, -L.rx * 0.34, L.rx * 0.05, 0, 0, L.rx);
    gr.addColorStop(0.00, 'rgba(255,255,255,.97)');
    gr.addColorStop(P * 0.62, `rgba(${lum | 0},${(lum + 2) | 0},255,.95)`);
    gr.addColorStop(P, `rgba(${mid | 0},${(mid + 8) | 0},${(mid + 20) | 0},.90)`);
    gr.addColorStop(P + (1 - P) * 0.40,
      `rgba(${(156 + hf * 48) | 0},${(172 + hf * 46) | 0},${(192 + hf * 40) | 0},.40)`);
    gr.addColorStop(P + (1 - P) * 0.72,
      `rgba(${(128 + hf * 42) | 0},${(146 + hf * 40) | 0},${(168 + hf * 34) | 0},.11)`);
    gr.addColorStop(1.00, 'rgba(116,136,160,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, L.rx, 0, 7); ctx.fill();
    if (L.main) {                                        // rim light, big bumps only
      ctx.filter = `blur(${L.rx * 0.10}px)`;
      ctx.strokeStyle = `rgba(255,255,255,${0.13 + hf * 0.23})`;
      ctx.lineWidth = L.rx * 0.14;
      ctx.beginPath(); ctx.arc(0, 0, L.rx * P * 0.90, Math.PI * 1.16, Math.PI * 1.90);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export function paintVeil(
  ctx: CanvasRenderingContext2D, lobes: Lobe[], W: number, H: number, round: number,
): void {
  const P = 0.38 + round * 0.34;
  ctx.filter = `blur(${W * (0.030 - round * 0.014)}px)`;
  for (const L of [...lobes].sort((a, b) => b.cy - a.cy)) {
    const hf = 1 - L.cy / H;
    ctx.save(); ctx.translate(L.cx, L.cy); ctx.scale(1, L.ry / L.rx);
    const gr = ctx.createRadialGradient(0, -L.rx * 0.20, 0, 0, 0, L.rx);
    gr.addColorStop(0, `rgba(255,255,255,${0.30 + hf * 0.20})`);
    gr.addColorStop(P,
      `rgba(${(226 + hf * 24) | 0},${(234 + hf * 18) | 0},${(242 + hf * 12) | 0},${0.23 + hf * 0.12})`);
    gr.addColorStop(P + (1 - P) * 0.5, 'rgba(202,216,230,.09)');
    gr.addColorStop(1, 'rgba(186,202,216,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, L.rx, 0, 7); ctx.fill(); ctx.restore();
  }
}

export function paintShadow(ctx: CanvasRenderingContext2D, px: number): void {
  const gr = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  gr.addColorStop(0, 'rgba(6,14,18,.62)');
  gr.addColorStop(0.55, 'rgba(6,14,18,.30)');
  gr.addColorStop(1, 'rgba(6,14,18,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, px, px);
}

/** Canvas aspects the layouts are designed for. The billboard MUST use these — a
 *  hardcoded aspect stretches the ovals back into circles and the fix looks inert. */
export const CUMULUS_ASPECT = 0.74 - CLOUD.OVAL * 0.32;   // 0.51
export const VEIL_ASPECT = 0.58 - CLOUD.OVAL * 0.22;      // 0.42
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/heat-map-cloud.test.mjs`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/climate-engine/cloud-sprites.ts tests/unit/heat-map-cloud.test.mjs
git commit -m "feat(cloud): sprite geometry, with the clipping bug guarded by a test"
```

### Task B2: The three.js layer

**Files:**
- Create: `src/scripts/climate-engine/cloud-layer.ts`

No unit test: this is a THREE constructor whose geometry is covered by B1 and whose
correctness is visual. The tripwires in B4 cover what it must not do.

- [ ] **Step 1: Write the implementation**

Create `src/scripts/climate-engine/cloud-layer.ts`, porting the sprite/shadow setup and
the per-frame update from `previews/sky-3d/index.html`:

```ts
/**
 * cloud-layer.ts — the ward's measured cloud cover, drawn as sky.
 *
 * RENDER ONLY, in the sense water-layer.ts and road-layer.ts mean it.
 *
 * NOT DRAPED ON THE GROUND, and that is the whole design. A Himawari pixel is
 * ~2 km at Kolkata against a 1,400 m ward — one cloud pixel is wider than the ward
 * — so satellite cloud cannot be a map layer here. This draws COVER, a scalar
 * met.no measures, as sprites at altitude. It never claims structure inside the ward.
 *
 * The deck sits at CLOUD.DECK_M (320 m) against a real base nearer 700 m. That
 * compression is labelled on screen, the same contract terrain.ts keeps for its ×4.
 *
 * Sprites are baked ONCE per session — they are weather, not geography — and drift
 * and opacity are transform writes only. No geometry is rebuilt after boot.
 */
import * as THREE from 'three';
import { CLOUD, cloudFuse } from './cloud-sprites';

export interface CloudLayer {
  readonly group: THREE.Group;
  /** advance drift and cross-fade; seconds, and cover 0..1 from state.live */
  update(seconds: number, cover: number, windMs: number, fromDeg: number): void;
  /** key-light multiplier for this cover — the SAME scalar the physics reads, so
   *  what the eye infers about sunlight cannot drift from what the model computes */
  sunFactor(cover: number): number;
  dispose(): void;
}

/** Deterministic, so every session bakes the same sky and a screenshot is reproducible. */
function seeded(s: number): () => number {
  let v = s >>> 0;
  return () => (v = (v * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function bake(
  W: number, H: number, paint: (ctx: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Drift field, metres. Wide enough that a cloud leaves the frame before it wraps. */
const FIELD = 2600;

export function createCloudLayer(
  groundAt: (x: number, y: number) => number,
): CloudLayer | null {
  const rnd = seeded(7723117);
  const CUM: THREE.CanvasTexture[] = [], VEI: THREE.CanvasTexture[] = [];
  for (let i = 0; i < 4; i++) {
    const W = 512, H = Math.round(W * CUMULUS_ASPECT);
    const lobes = layoutCumulus(rnd, CLOUD.OVAL);
    fitLobes(lobes, W, H, CLOUD.PAD);
    CUM.push(bake(W, H, ctx => paintCumulus(ctx, lobes, W, H, CLOUD.ROUND)));
  }
  for (let i = 0; i < 3; i++) {
    const W = 768, H = Math.round(W * VEIL_ASPECT);
    const lobes = layoutVeil(rnd);
    fitLobes(lobes, W, H, CLOUD.PAD);
    VEI.push(bake(W, H, ctx => paintVeil(ctx, lobes, W, H, CLOUD.ROUND)));
  }
  const SHA = bake(256, 256, ctx => paintShadow(ctx, 256));

  const group = new THREE.Group();
  const clouds = [];
  for (let i = 0; i < CLOUD.COUNT; i++) {
    const cu = new THREE.Sprite(new THREE.SpriteMaterial({
      map: CUM[(rnd() * CUM.length) | 0], transparent: true, depthWrite: false, opacity: 0 }));
    const ve = new THREE.Sprite(new THREE.SpriteMaterial({
      map: VEI[(rnd() * VEI.length) | 0], transparent: true, depthWrite: false, opacity: 0 }));
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: SHA, transparent: true, depthWrite: false, opacity: 0 }));
    sh.rotation.x = -Math.PI / 2;
    group.add(cu, ve, sh);
    clouds.push({
      cu, ve, sh,
      x: -FIELD + rnd() * FIELD * 2, z: -FIELD + rnd() * FIELD * 2,
      y: CLOUD.DECK_M + (rnd() - 0.5) * 110,
      sc: (300 + rnd() * 380) * CLOUD.SIZE,
      a: 0.55 + rnd() * 0.45, rank: rnd(),
    });
  }

  return {
    group,
    sunFactor: (cover) => 1 - cover * 0.62,
    update(seconds, cover, windMs, fromDeg) {
      const fuse = cloudFuse(cover);
      /* met.no reports the direction wind comes FROM; cloud travels the opposite way. */
      const bear = (fromDeg + 180) * Math.PI / 180;
      const vx = Math.sin(bear), vz = Math.cos(bear);
      for (const c of clouds) {
        const wx = (((c.x + vx * windMs * seconds * 16) + FIELD) % (FIELD * 2)) - FIELD;
        const wz = (((c.z + vz * windMs * seconds * 16) + FIELD) % (FIELD * 2)) - FIELD;
        /* Which clouds exist at all is set by cover — at 10 % the sky is nearly
           empty, not 26 faint ghosts. */
        const on = cover > 0.02 && c.rank < Math.min(1, 0.18 + cover * 0.95);
        const base = on ? Math.min(1, cover * 1.5) * c.a : 0;
        c.cu.position.set(wx, c.y, wz);
        c.cu.scale.set(c.sc, c.sc * CUMULUS_ASPECT, 1);
        c.cu.material.opacity = base * (1 - fuse) * 0.96;
        c.ve.position.set(wx, c.y - c.sc * 0.03, wz);
        const vw = c.sc * 1.7 * (0.9 + fuse * 0.4);
        c.ve.scale.set(vw, vw * VEIL_ASPECT, 1);
        c.ve.material.opacity = base * fuse * 0.9;
        const sr = c.sc * (1.1 + fuse * 0.8);
        /* Offset along the light, and seated on the drawn ground so it follows relief. */
        c.sh.position.set(wx - 130, groundAt(wx - 130, wz + 95) + 1.2, wz + 95);
        c.sh.scale.set(sr, sr, 1);
        c.sh.material.opacity = base * (0.55 - fuse * 0.22);
      }
    },
    dispose() {
      for (const c of clouds) {
        c.cu.material.dispose(); c.ve.material.dispose();
        c.sh.material.dispose(); c.sh.geometry.dispose();
      }
      [...CUM, ...VEI, SHA].forEach(t => t.dispose());
    },
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: `0 errors`

- [ ] **Step 3: Commit**

```bash
git add src/scripts/climate-engine/cloud-layer.ts
git commit -m "feat(cloud): the deck as sky — sprites at altitude, shadows on the city"
```

### Task B3: Wire it into the scene

**Files:**
- Modify: `src/scripts/climate-engine/heat-map-app.ts` (5 edits)

- [ ] **Step 1: Carry wind direction through the parse, FIRST**

This comes first because Step 4 reads `state.live.windFrom`; doing it later leaves an
intermediate commit that does not type-check.

`wind_from_direction` is in the met.no response and currently discarded. Add it to
`Ambient` in `src/scripts/climate-engine/heat-map-model.ts:167`:

```ts
  tAir: number; rh: number; wind: number; cloud: number; feels: number;
  /** met.no `wind_from_direction`, degrees. Cloud advection ONLY — the MODEL uses
   *  wind as a scalar (`p.h * p.wind`) and has no direction term anywhere. Do not
   *  wire this into the physics believing it already belongs there. */
  windFrom?: number;
```

and populate it at `heat-map-app.ts:1138`, inside the existing object literal:

```ts
        windFrom: dd.wind_from_direction,
```

Run: `npm run check`
Expected: `0 errors`

- [ ] **Step 2: Add the import**

At line 27 the water import reads:

```ts
import { createWaterLayer, type WaterLayer } from './water-layer';
```

Add beneath it:

```ts
import { createCloudLayer, type CloudLayer } from './cloud-layer';
```

- [ ] **Step 3: Add the handle**

At line 763:

```ts
  let waterLayer: WaterLayer | null = null;
```

Add beneath it:

```ts
  let cloudLayer: CloudLayer | null = null;
```

- [ ] **Step 4: Advance it from the existing render callback**

Find this block (currently 722-728):

```ts
      if (waterLayer) {
        waterLayer.setView(map.getBearing(), map.getPitch());
        if (!reduceMotion) waterLayer.setTime(performance.now() / 1000);
      }
```

Insert directly after it:

```ts
      /* The deck rides the same repaints the water does. Reduced motion holds it
         at a still frame on the measured cover rather than animating slower.
         A null reading draws nothing — an invented sky is the loader's deleted
         land dust all over again. */
      if (cloudLayer && state.live) {
        cloudLayer.update(
          reduceMotion ? 0 : performance.now() / 1000,
          state.live.cloud / 100, state.live.wind, state.live.windFrom ?? 0,
        );
        if (keyL) keyL.intensity = 2.1 * cloudLayer.sunFactor(state.live.cloud / 100);
      }
```

- [ ] **Step 5: Create it once, after the scene exists**

Find (currently 870):

```ts
      if (wl) { waterLayer = wl; threeScene.add(wl.mesh); }
```

Insert directly after:

```ts
      /* Baked once and kept across ward switches — cloud is weather, not geography.
         Only the drape reference changes, and the deck is far enough above the
         ground for that to be immaterial. */
      if (!cloudLayer) {
        cloudLayer = createCloudLayer((x, y) => terrainDrawAt(terrainCache[name] ?? null, x, y));
        if (cloudLayer) threeScene.add(cloudLayer.group);
      }
```

- [ ] **Step 6: Keep the deck repainting while it drifts**

Find (currently 731):

```ts
      if (growU.value < 1 || fieldDirty) { fieldDirty = false; map.triggerRepaint(); }
```

Replace with:

```ts
      /* The deck drifts when nothing else is changing, so it needs its own repaint
         reason — but only when there is wind to drift on, and never under reduced
         motion. This is the one new source of continuous repaint; Task B5 measures it. */
      const drifting = !reduceMotion && !!cloudLayer && (state.live?.wind ?? 0) > 0;
      if (growU.value < 1 || fieldDirty || drifting) { fieldDirty = false; map.triggerRepaint(); }
```

- [ ] **Step 7: Dispose**

Find (currently 1441):

```ts
    waterLayer?.dispose();
```

Insert after:

```ts
    cloudLayer?.dispose();
```

- [ ] **Step 8: Type-check and run the suite**

Run: `npm run check && npm run test:unit`
Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git add src/scripts/climate-engine/heat-map-app.ts src/scripts/climate-engine/heat-map-model.ts
git commit -m "feat(cloud): draw the measured deck, dimming the key light on the same scalar"
```

### Task B4: The tripwires

**Files:**
- Modify: `tests/unit/heat-map-cloud.test.mjs`

- [ ] **Step 1: Append the guards**

```js
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => readFile(join(ROOT, 'src/scripts/climate-engine', p), 'utf8');
/** Comments must be stripped: these files are REQUIRED to name SimLayers in prose. */
const code = async (p) => (await src(p))
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('the cloud layer stays render-only', async () => {
  for (const f of ['cloud-sprites.ts', 'cloud-layer.ts']) {
    const t = await code(f);
    assert.doesNotMatch(t, /SimLayers/, `${f} must not reach the simulation's layers`);
    assert.doesNotMatch(t, /buildSpatial|Spatial\b/, `${f} must not reach intervention targeting`);
  }
});

test('there is exactly one cloud source, and the model already reads it', async () => {
  const model = await src('heat-map-model.ts');
  assert.match(model, /skyTemperatureC\(baseTair, rh, cloud\)/,
    'the model must still consume measured cover for T_sky — if this moved, the deck '
    + 'is no longer drawing the input the simulation uses, which is its entire claim');
  assert.match(model, /sun: 1 \* \(1 - 0\.6 \* cloud\)/,
    'cover must still cut direct sun; the layer dims the key light to match');
  for (const f of ['cloud-sprites.ts', 'cloud-layer.ts']) {
    const t = await code(f);
    assert.doesNotMatch(t, /gibs|earthdata|himawari|forecast/i,
      `${f} introduces a SECOND cloud source. The deck must draw state.live.cloud and `
      + 'nothing else, or the sky on screen is not the sky the model is using.');
  }
});

test('a null reading draws no sky', async () => {
  const app = await src('heat-map-app.ts');
  assert.match(app, /if \(cloudLayer && state\.live\)/,
    'an invented deck with no measurement behind it is the loader land-dust mistake');
});

test('wind direction is documented as advection-only', async () => {
  const model = await src('heat-map-model.ts');
  assert.match(model, /windFrom\?: number/, 'Ambient must carry the direction');
  assert.match(model, /wind as a scalar/,
    'the comment must state the model has no direction term, so nobody wires windFrom '
    + 'into the physics believing it already belongs there');
});
```

- [ ] **Step 2: Run them**

Run: `node --import tsx --test tests/unit/heat-map-cloud.test.mjs`
Expected: PASS — 10 tests.

- [ ] **Step 3: Watch a tripwire fail, then revert**

Temporarily change `heat-map-model.ts:367` from `sun: 1 * (1 - 0.6 * cloud)` to
`sun: 1`, then:

Run: `node --import tsx --test tests/unit/heat-map-cloud.test.mjs`
Expected: FAIL, naming the direct-sun term.

```bash
git checkout src/scripts/climate-engine/heat-map-model.ts
```

A guard nobody has watched fail is a guard nobody knows works.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/heat-map-cloud.test.mjs
git commit -m "test(cloud): pin the single cloud source and the render-only boundary"
```

### Task B5: Honesty labels, frame budget, visual check

**Files:**
- Modify: `src/components/ClimateEngine/HeatMapStage.astro`

- [ ] **Step 1: Add the cloud readout**

The credits line at `:236` gains the compression note. Find `Ground SRTM via AWS terrain
tiles, <span id="terrLab">indicative</span>` and add after it:

```astro
 · Cloud deck at compressed altitude, cover from Met Norway
```

- [ ] **Step 2: Measure the frame cost**

The deck adds a continuous repaint. Start the dev server, open `/heat-map`, and in the
console:

```js
let n = 0, t = 0, last = performance.now();
const id = setInterval(() => {}, 0);
requestAnimationFrame(function f(now) {
  t += now - last; last = now; n++;
  if (n < 240) requestAnimationFrame(f);
  else { console.log('mean frame', (t / n).toFixed(2), 'ms'); clearInterval(id); }
});
```

Run it with the deck present, then with `Cloud` cover forced to 0 (which draws no
sprites), and take the difference.

Expected: **under 1.5 ms/frame at DPR 2**. If it exceeds that, do not tune quietly —
report the number. The spec's §9 makes this a gate, not a guideline.

- [ ] **Step 3: Visual check across the three wards**

```bash
npm run dev
```

Open `http://localhost:4321/heat-map` and check:

1. **The deck is above the city, never on it** — orbit and confirm sprites never touch
   the ground plane or drape over roofs
2. **Shadows cross the massing** and facades genuinely dim as they pass
3. **Cover drives character** — the live reading today is high, so expect veils; there is
   no slider in the real app, so verify by temporarily returning a fixed cover from the
   parse and restoring it afterwards
4. **Ward switch keeps the deck** — it must not rebuild or flicker
5. **Reduced motion** — enable it in the OS and confirm a still frame, not slow drift

- [ ] **Step 4: Full verify**

Run: `npm run verify`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/components/ClimateEngine/HeatMapStage.astro
git commit -m "feat(cloud): label the compressed deck altitude and the cover's source"
```

---

## What could go wrong

| Symptom | Cause | Response |
|---|---|---|
| `/api/live` 404s on Vercel | framework preset not exposing `/api` | Task A1 catches this before anything depends on it. Stop and report; the fallback is an SSR adapter and needs its own review |
| Live readout empty after A3 | proxy returning 502, or lat/lon not parsed | `curl` the endpoint directly; the function validates with `Number.isFinite` |
| met.no blocks us | UA missing or malformed | The A2 test asserts UA, domain and contact are all present |
| Clouds look like rectangles | lobes overflowing the sprite | The B1 border test fails first — it is the whole reason that test exists |
| Ovals render as circles | billboard scaled by a hardcoded aspect instead of the baked one | B2 step 1 calls this out; it makes the fix look like a no-op |
| Battery drain / hot fans | the deck's continuous repaint | B3 step 5 gates it on wind > 0 and reduced motion; B5 step 2 measures it |
| A sky with no measurement behind it | `state.live` null | B4 pins the `state.live` guard |
| Someone adds a GIBS raster later | it would show a sky the model is not using | B4's single-source tripwire greps for it by name |
| Published numbers move | they cannot — no `SimLayers`, `Spatial` or `accuracy.ts` in any task | B4's render-only tripwire |

## Out of scope

Wind streaks (cut — the model uses wind as a scalar) · GIBS Himawari raster (~2 km/pixel
against a 1,400 m ward; needs a flown-out regional view, its own feature) · MODIS AOD (a
dry-season instrument: 108.6 valid obs/pixel Nov–Feb against **2** in monsoon) ·
kepler.gl / deck.gl · any Windy product · `accuracy.ts`, `SimLayers`, `Spatial`, the cost
model, and every published figure.
