# Heat-map Boot Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single text chip shown during `/heat-map`'s cold boot with a ground-rise point cloud of the ward's own real data, resolving into the existing 2D→3D grow-in.

**Architecture:** Three units with one job each. A pure progress module (`loader-progress.ts`) turns stage events into monotonic 0–1 — node-testable, no DOM. A self-contained worker (`public/heat-loader-engine.js`) owns every drawn pixel on an OffscreenCanvas 2D context. `heat-map-app.ts` posts stage events and already-fetched data; it never waits on the loader. The loader observes the boot and can never break it.

**Contract:** [`../specs/2026-08-04-heat-map-loader-design.md`](../specs/2026-08-04-heat-map-loader-design.md)
**Visual reference:** `previews/heat-loader/particles.html`, style **ground rise**. Every constant below is lifted from it — read it before Task 3.

**Tech Stack:** Worker + OffscreenCanvas 2D (no WebGL — MapLibre owns the GL context), TypeScript for the pure module, `node --test --experimental-strip-types` for unit tests.

**The one rule that outranks the others:** the loader must never delay or break the map. Every integration point is fire-and-forget: no `await`, no throw that escapes, and ward-ready always dissolves the overlay even if every stage event went missing.

---

### Task 1: `loader-progress.ts` — the pure module

**Files:**
- Create: `src/scripts/climate-engine/loader-progress.ts`
- Test: `tests/unit/loader-progress.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STAGE_WEIGHTS, STAGE_ORDER, SKIP_FAST_MS,
  createProgress, assertLoaderProgressLogic,
} from '../../src/scripts/climate-engine/loader-progress.ts';

test('the module self-checks', () => { assertLoaderProgressLogic(); });

test('weights sum to exactly 1 — a drifting sum silently rescales the wave', () => {
  const sum = STAGE_ORDER.reduce((t, s) => t + STAGE_WEIGHTS[s], 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}, not 1`);
});

test('progress only ever moves forward', () => {
  // The wave radius is drawn from this. A number that dips would suck the city
  // back into the ground mid-rise, which reads as a bug even when loading is fine.
  const p = createProgress();
  const seen = [p.value()];
  for (const s of ['ward', 'shell', 'surface', 'vector', 'sim']) {   // deliberately out of order
    p.complete(s);
    seen.push(p.value());
  }
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], `progress went backwards: ${seen[i-1]} -> ${seen[i]}`);
  }
  assert.equal(seen.at(-1), 1);
});

test('an unknown or repeated stage changes nothing', () => {
  const p = createProgress();
  p.complete('ward');
  const after = p.value();
  p.complete('ward');            // repeat
  p.complete('nonsense');        // typo'd event name
  assert.equal(p.value(), after);
});

test('skip-fast: a warm cache never gets a performance', () => {
  // Under this threshold the overlay must not mount at all — an animation that
  // flashes for 200 ms is worse than no animation.
  assert.equal(SKIP_FAST_MS, 400);
  const p = createProgress();
  assert.equal(p.shouldSkip(399), true);
  assert.equal(p.shouldSkip(401), false);
});

test('every stage is reachable and named once', () => {
  assert.deepEqual([...new Set(STAGE_ORDER)], [...STAGE_ORDER]);
  for (const s of STAGE_ORDER) assert.ok(STAGE_WEIGHTS[s] > 0, `${s} has no weight`);
});
```

- [ ] **Step 2: Run it to watch it fail**

Run: `node --test --experimental-strip-types tests/unit/loader-progress.test.mjs`
Expected: FAIL — `Cannot find module .../loader-progress.ts`

- [ ] **Step 3: Write the module**

```ts
/**
 * loader-progress.ts — stage events in, one monotonic 0–1 out.
 *
 * WHY THIS IS ITS OWN MODULE. The boot loader's wave radius is drawn from this
 * number, and the number must never go backwards: a dip would suck the risen
 * city back into the ground mid-animation, which reads as a bug even when
 * loading is perfectly healthy. Keeping the arithmetic here — pure, no DOM, no
 * worker — is what makes that guarantee testable in node.
 *
 * WHY WEIGHTS AND NOT A COUNT. The five stages do not take similar time. On a
 * cold mobile connection the ward JSON and the surface PNG dominate; counting
 * stages equally would park the wave at 20 % through the longest wait and then
 * jump. The weights are rough by necessity — they are a shape for the animation,
 * never a claim about the data, which is why nothing here is ever displayed as
 * a percentage.
 */

/** The stages, in the order `loadWard` actually completes them. */
export const STAGE_ORDER = ['shell', 'ward', 'surface', 'vector', 'sim'] as const;
export type Stage = (typeof STAGE_ORDER)[number];

/**
 * Sum EXACTLY 1. A drifting sum silently rescales the wave, so the unit test
 * pins it rather than trusting arithmetic done by eye.
 *
 *   shell   app bundle parsed + MapLibre style load
 *   ward    /heat-map/data/{ward}.json — the biggest single fetch
 *   surface the measured Sentinel-2 PNG
 *   vector  roads + water + terrain artefacts
 *   sim     first equilibrium burst
 */
export const STAGE_WEIGHTS: Record<Stage, number> = {
  shell: 0.25, ward: 0.20, surface: 0.20, vector: 0.15, sim: 0.20,
};

/**
 * Below this, the overlay never mounts. A warm cache resolves in ~200 ms and an
 * animation that flashes for a fifth of a second is worse than none: the eye
 * registers a glitch, not a loader.
 */
export const SKIP_FAST_MS = 400;

export interface Progress {
  /** Record a completed stage. Unknown names and repeats are no-ops. */
  complete(stage: string): void;
  /** Current progress, 0–1, monotonic. */
  value(): number;
  /** True when the whole boot beat the skip threshold. */
  shouldSkip(elapsedMs: number): boolean;
}

export function createProgress(): Progress {
  const done = new Set<Stage>();
  let shown = 0;
  return {
    complete(stage: string): void {
      if ((STAGE_ORDER as readonly string[]).includes(stage)) done.add(stage as Stage);
    },
    value(): number {
      let target = 0;
      for (const s of done) target += STAGE_WEIGHTS[s];
      /* Monotonic by construction: the reported value never decreases even if a
         caller were to hand back a smaller set. */
      shown = Math.max(shown, Math.min(1, target));
      return shown;
    },
    shouldSkip(elapsedMs: number): boolean {
      return elapsedMs < SKIP_FAST_MS;
    },
  };
}

/** ponytail: one runnable check — the guarantees the worker leans on. */
export function assertLoaderProgressLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`loader-progress: ${m}`); };
  const sum = STAGE_ORDER.reduce((t, s) => t + STAGE_WEIGHTS[s], 0);
  ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}, not 1`);

  const p = createProgress();
  ok(p.value() === 0, 'a fresh progress must start at 0');
  p.complete('ward');
  const a = p.value();
  ok(a > 0 && a < 1, `one stage should be partial, got ${a}`);
  p.complete('ward');
  ok(p.value() === a, 'a repeated stage must change nothing');
  p.complete('not-a-stage');
  ok(p.value() === a, 'an unknown stage must change nothing');
  for (const s of STAGE_ORDER) p.complete(s);
  ok(p.value() === 1, 'all stages must reach exactly 1');
  ok(p.shouldSkip(SKIP_FAST_MS - 1) && !p.shouldSkip(SKIP_FAST_MS + 1), 'skip threshold is wrong');
}
```

- [ ] **Step 4: Run the test to watch it pass**

Run: `node --test --experimental-strip-types tests/unit/loader-progress.test.mjs`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/climate-engine/loader-progress.ts tests/unit/loader-progress.test.mjs
git commit -m "feat(loader): pure progress module -- weighted, monotonic, node-tested

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The overlay markup

**Files:**
- Modify: `src/components/ClimateEngine/HeatMapStage.astro` — insert directly after `<div id="mlmap"></div>` (line ~27), plus styles in the existing `<style>` block

- [ ] **Step 1: Add the markup**

Insert immediately after `<div id="mlmap"></div>`:

```html
    <!-- Boot loader. Sits over the MAP only: the HUD panels are ready in ~300 ms
         and hiding them would be theatre at the reader's expense. Removed by
         heat-map-app.ts at ward-ready, and never mounted at all when the boot
         beats loader-progress's SKIP_FAST_MS. -->
    <div class="bootl" id="bootl" hidden>
      <canvas id="bootlCanvas" aria-hidden="true"></canvas>
      <!-- The ticker is the accessible surface: a screen reader hears the real
           stages complete, which is exactly what the canvas is showing. -->
      <div class="bootl-tick" id="bootlTick" role="status" aria-live="polite"></div>
      <div class="bootl-rail"><i id="bootlRail"></i></div>
      <div class="bootl-telem" id="bootlTelem"></div>
      <div class="bootl-phase" id="bootlPhase">Acquiring point cloud</div>
    </div>
```

- [ ] **Step 2: Add the styles**

Append to the existing `<style>` block:

```css
  /* ── boot loader ──────────────────────────────────────────────────────────
     Absolute over #mlmap, beneath every HUD control (z-index 3+ owns those).
     Only opacity animates on teardown — the house rule about never animating
     layout properties applies here as much as anywhere. */
  .bootl{position:absolute;inset:0;z-index:2;pointer-events:none;opacity:1;transition:opacity .3s ease-out}
  .bootl.off{opacity:0}
  .bootl canvas{position:absolute;inset:0;width:100%;height:100%}
  .bootl-tick{position:absolute;left:22px;bottom:16px;font-family:var(--mono);font-size:.55rem;
    letter-spacing:.16em;text-transform:uppercase;color:var(--cyan);line-height:1.9}
  .bootl-tick .done{color:var(--faint)}
  .bootl-rail{position:absolute;left:22px;bottom:48px;width:130px;height:2px;background:rgb(111 202 214/.15)}
  .bootl-rail i{display:block;height:100%;width:0;background:var(--cyan);
    transition:width .4s cubic-bezier(.22,1,.36,1)}
  .bootl-telem{position:absolute;right:22px;top:20px;text-align:right;font-family:var(--mono);
    font-size:.52rem;letter-spacing:.15em;text-transform:uppercase;color:var(--faint);line-height:2}
  .bootl-telem b{color:var(--cyan);font-weight:400}
  .bootl-phase{position:absolute;right:22px;bottom:16px;font-family:var(--mono);font-size:.52rem;
    letter-spacing:.22em;text-transform:uppercase;color:var(--faint)}
  body.studio .bootl-tick{color:#0e7b8c}
  body.studio .bootl-rail i{background:#0e7b8c}
  @media (max-width:640px){
    .bootl-telem{display:none}      /* the ticker survives; telemetry is the luxury */
    .bootl-tick{left:14px;bottom:12px;font-size:.5rem}
    .bootl-rail{left:14px;bottom:40px;width:96px}
  }
```

- [ ] **Step 3: Verify nothing moved**

Run: `npm run verify`
Expected: exit 0. The overlay is `hidden`, so the page is byte-identical in behaviour at this point.

- [ ] **Step 4: Commit**

```bash
git add src/components/ClimateEngine/HeatMapStage.astro
git commit -m "feat(loader): overlay markup and styles, inert until wired

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `public/heat-loader-engine.js` — the worker

**Files:**
- Create: `public/heat-loader-engine.js`

**Read `previews/heat-loader/particles.html` first** (`STYLE === 'rise'` branch, the wavefront band block, the particle build loops). Every constant below comes from it, already tuned and approved: stacking `h/4` capped at 14, wireframe rings at `[0.15, 0.55, 1]` above 20 m and `[0.3, 1]` above 8 m, roads every 13 m, water fills at `[0.15, 0.32, 0.5, 0.66, 0.82, 0.93]`, 3,400 land dust, 130 wavefront dots, rotation `0.11 rad/s`, pitch factor `0.42`, perspective `1/(1 + rz*0.00028)`.

- [ ] **Step 1: Write the engine**

```js
/**
 * heat-loader-engine.js — the /heat-map boot loader, in a Worker.
 *
 * Sibling of holo-engine.js and deliberately the same shape: it owns every drawn
 * pixel, runs on an OffscreenCanvas, and speaks a tiny message protocol. 2D
 * context only — MapLibre owns the page's WebGL context and a second one on the
 * same canvas stack is a fight nobody wins.
 *
 * WHAT IT DRAWS. The ward as its own real data: buildings from the ward JSON
 * (position, measured height, heat-ramp colour), roads sampled along the real
 * OSM ways, water polygons filled, plus a bounded land-dust scatter that is
 * presentation and claims nothing. A radial wave travels outward from the ward
 * centre; behind it the city rises out of the dust floor.
 *
 * THE WAVE PURSUES REAL PROGRESS. Its radius chases the value from
 * loader-progress.ts, eased, never backwards. So the animation IS the wait: a
 * warm cache produces a fast rise, a slow connection a slow one, and neither
 * needs a fabricated percentage.
 *
 * PROTOCOL (main thread → worker)
 *   init     {canvas, width, height, dpr, reduceMotion}
 *   data     {kind:'buildings'|'roads'|'water', payload}   as each fetch resolves
 *   progress {value}                                        0–1 from loader-progress
 *   stage    {label, index, total}                          ticker text
 *   resolve  {}                                             settle, then done
 *   stop     {}                                             teardown
 * (worker → main thread)
 *   {type:'telem', pts, total}      live counts for the telemetry block
 *   {type:'done'}                   settle finished; safe to remove the overlay
 */
'use strict';

var W = 0, H = 0, DPR = 1, ctx = null, reduce = false;
var raf = 0, t0 = 0, running = false;

/* particle classes */
var CLS_BUILDING = 0, CLS_ROAD = 1, CLS_WATER = 2, CLS_LAND = 3;
var CLS_COLOUR = [null, [57, 85, 92], [41, 167, 157], [58, 68, 67]];
var RAMP = [[.435,.792,.839],[.624,.725,.541],[.690,.553,.341],[.831,.420,.290],[.898,.282,.302]];

/* the ward's half-window, metres — matches WardData.sizeM / 2 for every ward */
var HALF_M = 700;

var pts = [];            // {x, z, y, h, cls}
var callouts = [];       // five tallest {x, z, h}
var seedArr = null;      // per-particle jitter, stable across frames

var pTarget = 0, pShown = 0;      // pursued progress
var settleT = 0, settling = false, doneSent = false;

function ramp(t) {
  var i = Math.min(RAMP.length - 2, Math.floor(t * (RAMP.length - 1)));
  var f = t * (RAMP.length - 1) - i;
  return [
    255 * (RAMP[i][0] + (RAMP[i+1][0] - RAMP[i][0]) * f),
    255 * (RAMP[i][1] + (RAMP[i+1][1] - RAMP[i][1]) * f),
    255 * (RAMP[i][2] + (RAMP[i+1][2] - RAMP[i][2]) * f),
  ];
}

/* ── particle building, from the real artefacts ─────────────────────────────
   Density is halved on coarse pointers by `stride`: the wave and the massing
   read the same, the frame budget does not. */
function addBuildings(rows, stride) {
  var tall = [];
  for (var r = 0; r < rows.length; r += 1) {
    var b = rows[r], h = b[0];
    var cx = 0, cy = 0, n = (b.length - 1) / 2;
    for (var k = 1; k < b.length; k += 2) { cx += b[k]; cy += b[k+1]; }
    cx /= n; cy /= n;
    var stack = Math.max(1, Math.min(14, Math.round(h / (4 * stride))));
    for (var s = 0; s < stack; s++)
      pts.push({ x: cx, z: cy, y: h * (s + 0.7) / stack, h: h, cls: CLS_BUILDING });
    /* wireframe massing: a tower must read as a volume, not a bead chain */
    if (n >= 4 && h > 8) {
      var levels = h > 20 ? [0.15, 0.55, 1] : [0.3, 1];
      for (var L = 0; L < levels.length; L++)
        for (var i = 1; i < b.length; i += 2 * stride)
          pts.push({ x: b[i], z: b[i+1], y: h * levels[L], h: h, cls: CLS_BUILDING });
    }
    tall.push({ x: cx, z: cy, h: h });
  }
  tall.sort(function (a, b2) { return b2.h - a.h; });
  callouts = tall.slice(0, 5);
}

function addRoads(ways, stride) {
  var step = 13 * stride;
  for (var w = 0; w < ways.length; w++) {
    var p = ways[w].p;
    for (var i = 0; i + 3 < p.length; i += 2) {
      var dx = p[i+2] - p[i], dy = p[i+3] - p[i+1], len = Math.hypot(dx, dy);
      for (var d = 0; d < len; d += step)
        pts.push({ x: p[i] + dx*d/len, z: p[i+1] + dy*d/len, y: 1.5, h: 0, cls: CLS_ROAD });
    }
  }
}

function addWater(polys) {
  for (var w = 0; w < polys.length; w++) {
    var p = polys[w].p, cx = 0, cy = 0, n = p.length / 2;
    for (var i = 0; i < p.length; i += 2) { cx += p[i]; cy += p[i+1]; }
    cx /= n; cy /= n;
    var fills = [0.15, 0.32, 0.5, 0.66, 0.82, 0.93];
    for (var j = 0; j < p.length; j += 2) {
      pts.push({ x: p[j], z: p[j+1], y: 0.8, h: 0, cls: CLS_WATER });
      for (var f = 0; f < fills.length; f++)
        pts.push({ x: cx + (p[j]-cx)*fills[f], z: cy + (p[j+1]-cy)*fills[f],
                   y: 0.8, h: 0, cls: CLS_WATER });
    }
  }
}

function addLand(count) {
  for (var i = 0; i < count; i++)
    pts.push({ x: (Math.random()*2-1)*HALF_M*0.99, z: (Math.random()*2-1)*HALF_M*0.99,
               y: 0.4, h: 0, cls: CLS_LAND });
}

function reseed() {
  seedArr = new Float32Array(pts.length);
  for (var i = 0; i < pts.length; i++) seedArr[i] = Math.random();
}

/* ── render ─────────────────────────────────────────────────────────────── */
function draw(now) {
  if (!running || !ctx) return;
  if (!t0) t0 = now;
  var sec = (now - t0) / 1000;

  /* pursue: eased, monotonic. The wave can lag reality but never lead it. */
  pShown += (pTarget - pShown) * 0.06;
  if (pShown > pTarget) pShown = pTarget;
  if (settling) settleT = Math.min(1, settleT + 0.02);

  var condense = 1 - Math.pow(1 - Math.min(1, pShown), 4);
  var settle = settleT < 0 ? 0 : 1 - Math.pow(1 - settleT, 4);

  ctx.clearRect(0, 0, W, H);

  var rot = reduce ? 0 : sec * 0.11;
  var cosR = Math.cos(rot), sinR = Math.sin(rot);
  var scale = Math.min(W, H) / 2050, cx2 = W / 2, cy2 = H * 0.55;

  function proj(x, y, z) {
    var rx = x * cosR - z * sinR, rz = x * sinR + z * cosR;
    var persp = 1 / (1 + rz * 0.00028);
    return [cx2 + rx * scale * persp * DPR, cy2 - (y - rz * 0.42) * scale * DPR, persp];
  }

  /* survey grid, drawing on as the massing resolves */
  var gridA = Math.max(0, condense - 0.35) * 0.14 * (1 - settle * 0.5);
  if (gridA > 0.005) {
    ctx.strokeStyle = 'rgb(111 202 214 / ' + gridA + ')';
    ctx.lineWidth = 0.7 * DPR;
    for (var v = -700; v <= 700; v += 175) {
      for (var axis = 0; axis < 2; axis++) {
        ctx.beginPath();
        for (var u = -700, first = true; u <= 700; u += 70) {
          var q = axis ? proj(v, 0, u) : proj(u, 0, v);
          first ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]);
          first = false;
        }
        ctx.stroke();
      }
    }
  }

  /* particles: the rise wave */
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i], sd = seedArr[i];
    var dist = Math.hypot(p.x, p.z) / (HALF_M * 1.41);
    var local = Math.min(1, Math.max(0, (condense * 1.25 - dist - sd * 0.08) / 0.3));
    var rise = 1 - Math.pow(1 - local, 3);
    var y = local <= 0
      ? 0.3 + Math.sin(sec * 1.7 + sd * 11) * 0.9              // dust breathes ahead of the wave
      : p.y * rise * (1 + 0.1 * Math.sin(local * Math.PI));    // slight overshoot on arrival
    if (p.cls === CLS_BUILDING) y *= (1 - settle);
    if (p.cls === CLS_WATER && local > 0.9) y += Math.sin(sec * 2.1 + sd * 12) * 1.6;

    var q2 = proj(p.x, y, p.z), cr, cg, cb, a, rad;
    if (local < 0.96) { cr = 111; cg = 202; cb = 214; a = 0.20 + 0.34 * local; rad = 1.1; }
    else if (p.cls === CLS_BUILDING) {
      var c = ramp(Math.min(1, p.h / 40));
      cr = c[0]; cg = c[1]; cb = c[2]; a = 0.85 * (1 - settle * 0.65); rad = 1.6;
    } else {
      var cc = CLS_COLOUR[p.cls];
      cr = cc[0]; cg = cc[1]; cb = cc[2];
      a = (p.cls === CLS_WATER ? 0.75 : p.cls === CLS_ROAD ? 0.55 : 0.30) * (1 - settle * 0.25);
      rad = p.cls === CLS_WATER ? 1.5 : 1.1;
    }
    var rr = rad * DPR * q2[2];
    ctx.fillStyle = 'rgb(' + (cr|0) + ' ' + (cg|0) + ' ' + (cb|0) + ' / ' + a + ')';
    ctx.fillRect(q2[0] - rr/2, q2[1] - rr/2, rr, rr);
  }

  /* wavefront: 130 twinkling dots, NOT a vector ring — the whole scene is
     particles and a drawn circle broke that language. Constant cost at any radius. */
  if (condense < 1 && !reduce) {
    var waveR = Math.max(0, condense * 1.25 - 0.02) * (HALF_M * 1.41);
    if (waveR > 4 && waveR < HALF_M * 1.43) {
      for (var d2 = 0; d2 < 130; d2++) {
        var ang = d2 * 2.39996 + sec * 0.35;                    // golden angle: never a bead ring
        var jit = Math.sin(sec * 2.4 + d2 * 1.7);
        var rr2 = waveR + jit * 26 - 8;
        if (rr2 <= 2) continue;
        var q3 = proj(Math.cos(ang) * rr2, Math.abs(jit) * 5, Math.sin(ang) * rr2);
        var tw = 0.5 + 0.5 * Math.sin(sec * 3.1 + d2 * 2.3);
        var aa = (0.10 + 0.34 * tw) * (1 - condense * 0.45);
        var rw = (0.9 + 0.9 * tw) * DPR * q3[2];
        ctx.fillStyle = 'rgb(111 202 214 / ' + aa + ')';
        ctx.fillRect(q3[0] - rw/2, q3[1] - rw/2, rw, rw);
      }
    }
  }

  /* height callouts, appearing as the wave reaches each tower */
  if (callouts.length && settle < 0.9) {
    ctx.font = (9 * DPR) + "px 'Noplato Mono', ui-monospace, monospace";
    for (var c2 = 0; c2 < callouts.length; c2++) {
      var co = callouts[c2];
      var cd = Math.hypot(co.x, co.z) / (HALF_M * 1.41);
      var lv = Math.min(1, Math.max(0, (condense * 1.25 - cd) / 0.12));
      if (lv <= 0) continue;
      var base = proj(co.x, co.h * (1 - settle), co.z);
      var tx = base[0] + 34 * DPR, ty = base[1] - (26 + c2 * 4) * DPR;
      ctx.strokeStyle = 'rgb(111 202 214 / ' + (0.4 * lv * (1 - settle)) + ')';
      ctx.lineWidth = 0.8 * DPR;
      ctx.beginPath();
      ctx.moveTo(base[0], base[1]);
      ctx.lineTo(base[0] + 14 * DPR, ty + 3 * DPR);
      ctx.lineTo(tx, ty + 3 * DPR);
      ctx.stroke();
      ctx.fillStyle = 'rgb(236 237 240 / ' + (0.75 * lv * (1 - settle)) + ')';
      ctx.fillText(co.h.toFixed(1) + ' M', tx + 3 * DPR, ty);
    }
  }

  if (settling && settleT >= 1 && !doneSent) { doneSent = true; self.postMessage({ type: 'done' }); }
  raf = requestAnimationFrame(draw);
}

/* ── protocol ───────────────────────────────────────────────────────────── */
function start() {
  if (running) return;
  running = true;
  raf = requestAnimationFrame(draw);
}

self.onmessage = function (e) {
  var m = e.data;
  if (m.type === 'init') {
    ctx = m.canvas.getContext('2d');
    DPR = Math.min(m.dpr || 1, 2);
    W = m.canvas.width = Math.round(m.width * DPR);
    H = m.canvas.height = Math.round(m.height * DPR);
    reduce = !!m.reduceMotion;
    addLand(Math.round(3400 / (m.stride || 1)));
    reseed();
    if (reduce) { pTarget = 1; pShown = 1; }
    start();
  } else if (m.type === 'data') {
    var stride = m.stride || 1;
    if (m.kind === 'buildings') addBuildings(m.payload, stride);
    else if (m.kind === 'roads') addRoads(m.payload, stride);
    else if (m.kind === 'water') addWater(m.payload);
    reseed();
    self.postMessage({ type: 'telem', pts: pts.length });
  } else if (m.type === 'progress') {
    pTarget = Math.max(pTarget, Math.min(1, m.value));      // monotonic at the boundary too
  } else if (m.type === 'resolve') {
    pTarget = 1;
    settling = true;
    if (reduce) { settleT = 1; }
  } else if (m.type === 'resize') {
    if (!ctx) return;
    DPR = Math.min(m.dpr || 1, 2);
    W = ctx.canvas.width = Math.round(m.width * DPR);
    H = ctx.canvas.height = Math.round(m.height * DPR);
  } else if (m.type === 'stop') {
    running = false;
    cancelAnimationFrame(raf);
    pts = []; callouts = []; seedArr = null;
  }
};
```

- [ ] **Step 2: Syntax check**

Run: `node --check public/heat-loader-engine.js`
Expected: no output (valid).

- [ ] **Step 3: Commit**

```bash
git add public/heat-loader-engine.js
git commit -m "feat(loader): worker engine -- ground rise over OffscreenCanvas 2D

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire it into the app

**Files:**
- Modify: `src/scripts/climate-engine/heat-map-app.ts` — import (line ~29), boot block after the map is constructed (~line 72), stage posts inside `loadWard`, teardown at ward-ready

- [ ] **Step 1: Add the import**

After the `terrain` import (line ~29):

```ts
import { createProgress, type Progress } from './loader-progress';
```

- [ ] **Step 2: Add the boot block**

After `map.addControl(new maplibregl.ScaleControl(...))` (~line 71):

```ts
  /* ── boot loader ────────────────────────────────────────────────────────
     FIRE AND FORGET, ALWAYS. Every call below is wrapped or guarded: the
     loader watches the boot and must never be able to delay or break it. A
     worker that fails to construct, a canvas that will not transfer, a stage
     event that never arrives — each leaves the map booting exactly as it does
     today, with the overlay simply never appearing or fading early. */
  const bootT0 = performance.now();
  const bootProgress: Progress = createProgress();
  let bootWorker: Worker | null = null;
  let bootShown = false;

  const bootEl = el('bootl');
  const bootCanvas = document.getElementById('bootlCanvas') as HTMLCanvasElement | null;
  const bootStride = matchMedia('(pointer: coarse)').matches ? 2 : 1;

  function bootPost(m: Record<string, unknown>): void {
    try { bootWorker?.postMessage(m); } catch { /* the loader is never load-bearing */ }
  }

  function bootStage(stage: string, label: string, index: number): void {
    bootProgress.complete(stage);
    bootPost({ type: 'progress', value: bootProgress.value() });
    const tickEl = el('bootlTick'), railEl = el('bootlRail');
    if (tickEl) {
      const lines = tickEl.querySelectorAll('div');
      lines.forEach(l => l.classList.add('done'));
      const line = document.createElement('div');
      line.textContent = `▸ ${label}`;
      tickEl.appendChild(line);
    }
    if (railEl) railEl.style.width = `${bootProgress.value() * 130}px`;
    const phaseEl = el('bootlPhase');
    if (phaseEl) {
      phaseEl.textContent = index >= 4 ? 'Settling to ground'
        : index >= 2 ? 'Reconstructing massing' : 'Acquiring point cloud';
    }
  }

  function bootStart(): void {
    if (bootShown || !bootEl || !bootCanvas) return;
    /* A warm cache resolves in ~200 ms; an animation that flashes for a fifth of
       a second registers as a glitch, not a loader. */
    if (bootProgress.shouldSkip(performance.now() - bootT0)) return;
    try {
      if (!('transferControlToOffscreen' in bootCanvas) || typeof Worker !== 'function') return;
      const off = (bootCanvas as HTMLCanvasElement & {
        transferControlToOffscreen(): OffscreenCanvas }).transferControlToOffscreen();
      bootWorker = new Worker('/heat-loader-engine.js');
      bootWorker.onmessage = (ev: MessageEvent) => {
        const m = ev.data as { type: string; pts?: number };
        if (m.type === 'telem') {
          const t = el('bootlTelem');
          if (t) t.innerHTML = `${state.ward} · 22.528°N 88.366°E<br>`
            + `pts <b>${(m.pts ?? 0).toLocaleString()}</b><br>`
            + `overture 2026-07-22.0 · ee 2.5d 2023`;
        } else if (m.type === 'done') bootEnd();
      };
      bootWorker.postMessage({
        type: 'init', canvas: off, width: bootEl.clientWidth, height: bootEl.clientHeight,
        dpr: devicePixelRatio, reduceMotion: reduceMotion, stride: bootStride,
      }, [off as unknown as Transferable]);
      bootEl.hidden = false;
      bootShown = true;
    } catch { bootWorker = null; }
  }

  function bootEnd(): void {
    if (!bootEl) return;
    bootEl.classList.add('off');
    setTimeout(() => {
      bootEl.hidden = true;
      bootPost({ type: 'stop' });
      bootWorker?.terminate();
      bootWorker = null;
    }, 320);
  }
  cleanup.push(() => { bootWorker?.terminate(); bootWorker = null; });
```

- [ ] **Step 3: Post the stages from `loadWard`**

Inside `loadWard`, add each call immediately after the await it reports. `firstBoot` guards ward switches — the loader belongs to the cold boot only.

```ts
  let firstBoot = true;
```
(declare beside `let mode: 'relief' | 'iso' = 'relief', env = 'dark';`)

Then in `loadWard`, after `cache[name] = await (...).json();`:
```ts
    if (firstBoot) { bootStart(); bootStage('ward', `footprints ×${d.b.length.toLocaleString()}`, 1); bootPost({ type: 'data', kind: 'buildings', payload: d.b, stride: bootStride }); }
```
after `surfaceCache[name] ??= await loadWardSurface(name);`:
```ts
    if (firstBoot) bootStage('surface', 'sentinel-2 surface', 2);
```
after the roads fetch line:
```ts
    if (firstBoot) { bootStage('vector', `roads ×${roadsCache[name].ways.length}`, 3); bootPost({ type: 'data', kind: 'roads', payload: roadsCache[name].ways, stride: bootStride }); }
```
after the water fetch block (where `waterCache[name]` is assigned):
```ts
    if (firstBoot) bootPost({ type: 'data', kind: 'water', payload: waterCache[name].polys });
```
at the very end of `loadWard`, after the existing grow-in setup:
```ts
    if (firstBoot) { firstBoot = false; bootStage('sim', 'sim warm-up', 4); bootPost({ type: 'resolve' }); }
```

And in the `map.on('style.load', …)` handler at the bottom of the file, before `loadWard('ballygunge')`:
```ts
    bootStage('shell', 'basemap', 0);
```

- [ ] **Step 4: Type-check and verify**

Run: `npx tsc --noEmit -p tsconfig.json && npm run verify`
Expected: no type errors; verify exit 0.

- [ ] **Step 5: See it, and prove the handoff**

```bash
npm run dev &
sleep 12
```
Open `http://localhost:4321/heat-map/` with the network throttled to *Slow 3G* in DevTools. Expected: dust appears immediately, the wave rises the ward as each stage ticks, the massing settles, the overlay fades, and the existing grow-in plays. Then reload with throttling **off**: the overlay should not appear at all (skip-fast).

Three more checks, each pinning a spec promise:
- **Ward switch:** click Baruipur. The overlay must NOT reappear — cold boot only.
- **Client-side nav:** go to `/heat-map/compare/` and back. No stray canvas, no leaked worker (DevTools → Sources → Threads shows none), console clean.
- **Reduced motion:** set `prefers-reduced-motion: reduce` (DevTools → Rendering → Emulate CSS media). The overlay shows the settled frame with a live ticker and no motion.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/climate-engine/heat-map-app.ts
git commit -m "feat(loader): wire the boot loader -- fire-and-forget, cold boot only

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Guard tests

**Files:**
- Create: `tests/unit/heat-map-loader.test.mjs`

- [ ] **Step 1: Write them**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = await readFile(join(ROOT, 'src/scripts/climate-engine/heat-map-app.ts'), 'utf8');
const engine = await readFile(join(ROOT, 'public/heat-loader-engine.js'), 'utf8');
const stage = await readFile(join(ROOT, 'src/components/ClimateEngine/HeatMapStage.astro'), 'utf8');

/** Source with comments stripped, so a tripwire greps CODE and not its own explanation. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('the loader never awaits, so it cannot delay the map', () => {
  // The load-bearing property. If a future edit awaits the worker or a loader
  // fetch, the decoration starts gating the instrument.
  const code = stripComments(app);
  assert.ok(!/await\s+boot/.test(code), 'something awaits a boot* call — the loader must be fire-and-forget');
  assert.ok(!/bootPost\([^)]*await/.test(code), 'an await leaked into a loader post');
});

test('every worker call is guarded, so a worker failure cannot break the boot', () => {
  const code = stripComments(app);
  assert.match(code, /function bootPost[\s\S]{0,200}try\s*{/, 'bootPost must swallow postMessage failures');
  assert.match(code, /function bootStart[\s\S]{0,900}catch/, 'bootStart must catch worker/transfer failures');
});

test('the loader fetches nothing — it renders what loadWard already loaded', () => {
  // A second fetch of the ward JSON would double the very cost this is covering.
  assert.ok(!/fetch\s*\(/.test(stripComments(engine)),
    'the worker fetches — it must only receive data the app already has');
});

test('the overlay starts hidden and sits below the HUD', () => {
  assert.match(stage, /id="bootl"[^>]*hidden/, 'the overlay must be hidden until bootStart shows it');
  assert.match(stage, /\.bootl\{[^}]*z-index:2/, 'the overlay must sit below the HUD controls');
  assert.match(stage, /\.bootl\{[^}]*pointer-events:none/, 'the overlay must never eat clicks');
});

test('the ticker is the accessible surface', () => {
  // The canvas is aria-hidden; a screen reader hears the real stages instead.
  assert.match(stage, /id="bootlCanvas"[^>]*aria-hidden="true"/);
  assert.match(stage, /id="bootlTick"[^>]*role="status"[^>]*aria-live="polite"/);
});

test('reduced motion gets the settled frame, never the animation', () => {
  assert.match(engine, /reduce\s*\)\s*\{\s*pTarget = 1; pShown = 1/,
    'reduced motion must start fully risen');
  assert.match(engine, /condense < 1 && !reduce/, 'the wavefront must not animate under reduced motion');
});

test('the wavefront cost is constant, not proportional to radius', () => {
  // A ring that adds dots as it grows would spike the frame budget exactly when
  // the most particles are already on screen.
  assert.match(engine, /d2 < 130/, 'the wavefront band must be a fixed dot count');
});

test('the loader is cold-boot only — a ward switch must not replay it', () => {
  const code = stripComments(app);
  assert.match(code, /firstBoot = false/, 'firstBoot must be cleared after the first ward');
  const posts = code.match(/bootStage\(/g) ?? [];
  assert.ok(posts.length >= 5, `expected 5 stage posts, found ${posts.length}`);
});
```

- [ ] **Step 2: Run them**

Run: `node --test tests/unit/heat-map-loader.test.mjs`
Expected: PASS, 8/8.

- [ ] **Step 3: Full verify**

Run: `npm run verify`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/heat-map-loader.test.mjs
git commit -m "test(loader): eight guards -- fire-and-forget, no fetches, a11y, cold-boot only

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## What could go wrong

| symptom | response |
|---|---|
| overlay never appears | expected on a warm cache — that is `SKIP_FAST_MS`. Throttle to Slow 3G to see it |
| overlay appears then hangs | a stage event is missing; `resolve` at the end of `loadWard` always fires, so check `firstBoot` was still true |
| overlay survives a client-side nav | `cleanup.push` terminates the worker (Task 4 step 2). The hologram's `data-astro-rerun` lesson does NOT apply here: that attribute exists for `is:inline` scripts in Astro markup, and this boot block lives inside `heat-map-app.ts`, which the page already re-runs through its own mount/cleanup lifecycle. Verified by the nav check in Task 4 step 5 |
| canvas blank, no error | `transferControlToOffscreen` succeeded but `init` never arrived — check the transfer list is `[off]` |
| jank on a phone | `bootStride = 2` should halve density; confirm `(pointer: coarse)` matched |
| ward switch replays the loader | `firstBoot` was not cleared — the last line of `loadWard` |

## Sequencing

Tasks 1 → 2 → 3 → 4 → 5, strictly: the app wiring (4) references both the module (1) and the markup (2), and the worker (3) must exist before the wiring can be seen working. One commit per task, `npm run verify` green on every one. No change to `accuracy.ts`, the sim, or the grow-in.
