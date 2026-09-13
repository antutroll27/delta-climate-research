# OBOS Shell (Plan A — the console) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn OBOS from a map with floating panels into an ops console — icon rail, Country → City → Area switcher, layer tree — where every control is backed by something real.

**Architecture:** A layer registry mirroring `scope/registry.ts`, in which a layer declares *what it depends on* and availability is derived rather than restated. The 1,050-line stage is extracted into four focused components. The rail becomes the only navigation and carries the Explore/Compare mode, so both routes render one shell.

**Tech Stack:** Astro 7 (static), TypeScript strict, Node's test runner via tsx, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-obos-shell-design.md`

---

## Scope: this is Plan A of two

The spec describes 13 layers. Splitting it out during planning gave 18 tasks —
nearly double spec 1's ten — so it is two plans:

| plan | scope |
|---|---|
| **A (this one)** | registry, tokens, 4 components, rail-as-navigation, shared shell, and the **6 layers that already exist** |
| **B (next)** | the 7 new layers — UTFVI, corridors, cool-roof, PV, refuge, ECOSTRESS, stations — plus the 3 `paths()` keys they need |

**A ships a working console on its own.** Its registry declares only layers whose
`needs` resolve against path keys that exist today, so it never references
something it does not build. B extends the same table.

---

## File Structure

| Path | Responsibility | Status |
|---|---|---|
| `src/scripts/climate-engine/scope/layers.ts` | The layer registry, `LayerId`, availability, `assertLayerLogic()` | create |
| `src/components/ClimateEngine/shell/IconRail.astro` | 5 rail sections, active state, tooltips | create |
| `src/components/ClimateEngine/shell/ScopeSwitcher.astro` | Country → City → Area, tier badge | create |
| `src/components/ClimateEngine/shell/LayerTree.astro` | Groups, checkboxes, n/total, disabled + reason | create |
| `src/components/ClimateEngine/shell/InterventionPane.astro` | Today's toolbox, content unchanged | create |
| `src/components/ClimateEngine/HeatMapStage.astro` | Thin shell composing the above | modify |
| `src/components/ClimateEngine/compare/PairedBench.astro` | Adopts rail + switcher; internals untouched | modify |
| `src/scripts/climate-engine/heat-map-app.ts` | Rail tab state, layer toggles | modify |
| `tests/unit/obos-layers.test.mjs` | Registry, availability, token guard | create |
| `tests/e2e/heat-map-shell.spec.ts` | Rail navigation, both routes, disabled rows | create |

A `shell/` directory keeps the four components together — they change together
and nothing else needs them.

---

## Task 1: The layer registry

**Files:**
- Create: `src/scripts/climate-engine/scope/layers.ts`
- Create: `tests/unit/obos-layers.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/obos-layers.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  LAYERS, LAYER_IDS, isLayerId, splitLayerId, layerAvailability, assertLayerLogic,
} from '../../src/scripts/climate-engine/scope/layers.ts';
import { paths, cityPaths } from '../../src/scripts/climate-engine/scope/paths.ts';

test('layer registry invariants hold', () => {
  assertLayerLogic();
});

test('every layer produces an id', () => {
  assert.ok(LAYER_IDS.includes('thermal/surface'));
  assert.ok(LAYER_IDS.includes('ground/street'));
  assert.equal(LAYER_IDS.length, 6);
});

test('isLayerId rejects anything unregistered', () => {
  assert.equal(isLayerId('thermal/surface'), true);
  assert.equal(isLayerId('thermal/typo'), false);
  assert.equal(isLayerId('surface'), false);
  assert.equal(isLayerId(null), false);
});

test('splitLayerId returns the two parts', () => {
  assert.deepEqual(splitLayerId('green/trees'), { group: 'green', item: 'trees' });
});

test('availability is DERIVED from paths, never declared', () => {
  // Kolkata ships every artefact these six need.
  for (const id of LAYER_IDS) {
    const a = layerAvailability(id, 'in/kolkata/ballygunge', { mapillary: true });
    assert.equal(a.available, true, `${id} should be available in Kolkata`);
  }
  // Dubai ships nothing, so every artefact-backed layer is unavailable WITH A REASON.
  for (const id of LAYER_IDS) {
    const a = layerAvailability(id, 'ae/dubai/al-quoz', { mapillary: true });
    if (a.available) continue;                       // the capability layer may still be on
    assert.ok(a.reason && a.reason.length > 0, `${id} must say WHY it is unavailable`);
  }
});

test('a capability layer follows the capability, not the artefacts', () => {
  // Street-level imagery has NO local artefact -- it fetches Mapillary tiles with a
  // token and tree-shakes out when that token is unset. Collapsing it into the
  // artefact axis would have meant inventing a file that does not exist.
  const on  = layerAvailability('ground/street', 'in/kolkata/ballygunge', { mapillary: true });
  const off = layerAvailability('ground/street', 'in/kolkata/ballygunge', { mapillary: false });
  assert.equal(on.available, true);
  assert.equal(off.available, false);
  assert.match(off.reason, /token|mapillary/i);
});

test('every artefact a layer needs is a real path key', async () => {
  // A layer depending on an artefact nobody produces would sit permanently greyed
  // and look deliberate -- indistinguishable from a city that lacks the data.
  const areaKeys = new Set(Object.keys(paths('in/kolkata/ballygunge')));
  const cityKeys = new Set(Object.keys(cityPaths('in/kolkata/ballygunge')));
  let checked = 0;
  for (const id of LAYER_IDS) {
    const { group, item } = splitLayerId(id);
    const needs = LAYERS[group].items[item].needs;
    if (typeof needs !== 'string') continue;          // capability form
    assert.ok(areaKeys.has(needs) || cityKeys.has(needs),
      `${id} needs "${needs}", which is not a key of AreaPaths or CityPaths`);
    checked += 1;
  }
  // Guard the guard: if needs ever stopped being a string, this loop would pass
  // while checking nothing.
  assert.equal(checked, 5, 'expected 5 artefact-backed layers of 6');
});

test('no layer declares a city list', async () => {
  // The fourth-table defect, one dimension over. Availability is derived; a layer
  // naming a city would be a second copy of what the registry already knows.
  const src = await readFile(
    new URL('../../src/scripts/climate-engine/scope/layers.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
  for (const banned of ['kolkata', 'dubai', 'ballygunge', 'baruipur', 'barrackpore']) {
    assert.ok(!new RegExp(`\\b${banned}\\b`, 'i').test(code),
      `layers.ts names "${banned}" -- availability must be derived, not declared`);
  }
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `node --import tsx --test tests/unit/obos-layers.test.mjs`
Expected: FAIL — cannot find module `scope/layers.ts`.

- [ ] **Step 3: Write the registry**

Create `src/scripts/climate-engine/scope/layers.ts`:

```ts
/**
 * What the map can draw, and what each of those things needs to exist.
 *
 * SHAPED LIKE scope/registry.ts ON PURPOSE. A layer declares WHAT IT DEPENDS ON
 * and availability is DERIVED by asking paths(). It never declares "available in
 * Kolkata" -- that would be a second copy of what the registry already knows,
 * free to disagree with it. The scope migration deleted a redundant ward table
 * for exactly that reason; this is the same defect one dimension over.
 *
 * TWO KINDS OF DEPENDENCY, because there genuinely are two:
 *
 *   an ARTEFACT   a key of AreaPaths or CityPaths, resolved by paths()
 *   a CAPABILITY  { cap: 'mapillary' } -- street-level imagery fetches tiles
 *                 from tiles.mapillary.com with an access token and has NO local
 *                 artefact at all; the feature tree-shakes out when the token is
 *                 unset. Its availability is a build-time fact, not a file.
 *
 * Collapsing the second into the first would have meant inventing a file that
 * does not exist, purely so the model stayed uniform.
 *
 * PLAN A DECLARES ONLY THE SIX LAYERS THAT ALREADY RENDER. Plan B adds UTFVI
 * bands, cooling corridors, cool-roof candidates, rooftop PV, refuge access,
 * ECOSTRESS overpasses and air-quality stations, together with the three
 * paths() keys three of them need. A registry that named a layer nobody draws
 * would ship a permanently greyed row that looks deliberate.
 */
import { paths, cityPaths } from './paths.ts';
import type { AreaKey } from './registry.ts';

/** Runtime capabilities a layer can depend on instead of an artefact. */
export interface Capabilities { readonly mapillary: boolean }

interface LayerEntry {
  readonly label: string;
  /** an AreaPaths/CityPaths key, or a runtime capability */
  readonly needs: string | { readonly cap: keyof Capabilities };
  /** on by default */
  readonly on: boolean;
}

interface LayerGroup {
  readonly label: string;
  readonly items: Record<string, LayerEntry>;
}

export const LAYERS = {
  thermal: { label: 'Thermal field', items: {
    surface: { label: 'Surface temperature', needs: 'surface', on: true },
  }},
  green: { label: 'Green infrastructure', items: {
    canopy: { label: 'Tree canopy (CHM)', needs: 'canopy', on: true },
    trees:  { label: 'Tree instances',    needs: 'trees',  on: true },
  }},
  built: { label: 'Built form', items: {
    footprints: { label: 'Building footprints', needs: 'ward', on: true },
    heights:    { label: 'Building heights',    needs: 'ward', on: false },
  }},
  ground: { label: 'Ground truth', items: {
    street: { label: 'Street-level imagery', needs: { cap: 'mapillary' }, on: false },
  }},
} as const satisfies Record<string, LayerGroup>;

type Registry = typeof LAYERS;

/**
 * The derived id. Same mapped-type shape as AreaKey, and the same reason: a
 * hand-maintained union can silently disagree with the data it describes.
 */
export type LayerId = {
  [G in keyof Registry]: Registry[G] extends { items: infer I }
    ? { [N in keyof I]: `${G & string}/${N & string}` }[keyof I]
    : never
}[keyof Registry];

const parts = new Map<string, { group: string; item: string }>();
for (const [g, group] of Object.entries(LAYERS)) {
  for (const n of Object.keys(group.items)) parts.set(`${g}/${n}`, { group: g, item: n });
}

export const LAYER_IDS: readonly LayerId[] =
  Object.freeze([...parts.keys()] as LayerId[]);

export function isLayerId(value: unknown): value is LayerId {
  return typeof value === 'string' && parts.has(value);
}

/** Parts are REMEMBERED, not re-parsed -- the same fix splitKey needed. */
export function splitLayerId(id: LayerId): { group: string; item: string } {
  return parts.get(id)!;
}

export interface Availability {
  readonly available: boolean;
  /** Present when unavailable. Names the artefact or capability, for the UI. */
  readonly reason: string;
}

/**
 * DISABLED MEANS DISABLED WITH A REASON. Never hidden -- a missing row reads as
 * "this does not exist", which is a different and wronger claim than "we do not
 * have it here". Never a live control that does nothing, which is the defect the
 * spec-1 audit found twice.
 */
export function layerAvailability(
  id: LayerId, key: AreaKey, caps: Capabilities,
): Availability {
  const { group, item } = splitLayerId(id);
  const entry = (LAYERS as unknown as Record<string, LayerGroup>)[group].items[item];

  if (typeof entry.needs !== 'string') {
    const ok = caps[entry.needs.cap];
    return ok
      ? { available: true, reason: '' }
      : { available: false, reason: `no ${entry.needs.cap} token` };
  }

  const area = paths(key);
  const city = cityPaths(key);
  const url = (area as Record<string, string> | null)?.[entry.needs]
    ?? (city as unknown as Record<string, string | null>)[entry.needs]
    ?? null;
  return url
    ? { available: true, reason: '' }
    : { available: false, reason: `no ${entry.needs} artefact` };
}

/** Runnable checks. Each guards a way this silently stops meaning anything. */
export function assertLayerLogic(): void {
  const fails: string[] = [];
  const a = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };

  a(LAYER_IDS.length > 0, 'the registry produced no layers');
  a(LAYER_IDS.length === new Set(LAYER_IDS).size, 'duplicate layer id');

  for (const [g, group] of Object.entries(LAYERS)) {
    a(!g.includes('/'), `group slug "${g}" contains a slash and would split wrongly`);
    a(Object.keys(group.items).length > 0, `group "${g}" has no layers`);
    for (const [n, entry] of Object.entries(group.items)) {
      a(!n.includes('/'), `layer slug "${g}/${n}" contains a slash`);
      a(entry.label.trim().length > 0, `${g}/${n} has no label`);
    }
  }

  for (const line of fails) console.error(`  FAIL ${line}`);
  if (fails.length) throw new Error(`${fails.length} layer check(s) failed`);
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `node --import tsx --test tests/unit/obos-layers.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Prove the derived type constrains**

```bash
cat > /tmp/layerid-neg.ts <<'EOF'
import type { LayerId } from '/Volumes/VSTSAMPLES/Projects/Angad/.claude/worktrees/obos-scope-model/src/scripts/climate-engine/scope/layers.ts';
const good: LayerId = 'thermal/surface';
const bad: LayerId = 'thermal/typo';
export { good, bad };
EOF
npx tsc --noEmit --strict --target es2022 --moduleResolution bundler --module esnext --allowImportingTsExtensions --ignoreConfig /tmp/layerid-neg.ts
```
Expected: exactly ONE error, on `bad`. If neither errors, the type is not constraining — stop and fix.

- [ ] **Step 6: PROVE EACH GUARD BITES**

Required. Six guards in spec 1 passed while protecting nothing. For each, break it, confirm the specific failure, revert:

| break | expected |
|---|---|
| add a layer with `needs: 'nonsense'` | the real-path-key test names it |
| add `city: 'kolkata'` to a layer entry | the no-city-list test fires |
| a group slug containing `/` | `assertLayerLogic` check fires |
| make `layerAvailability` always return `available: true` | the Dubai reason test fires |
| make it always return `false` with an empty reason | the reason-length test fires |

Report a table.

- [ ] **Step 7: Run the suite and commit**

Run: `npm run test:unit` — expect 550 + 7 = 557 passing.

```bash
git add src/scripts/climate-engine/scope/layers.ts tests/unit/obos-layers.test.mjs
git commit -m "feat(obos): a layer registry where availability is derived, not declared

A layer declares WHAT IT DEPENDS ON; availability comes from asking paths().
A per-layer city list would be a second copy of what the scope registry already
knows -- the fourth-table defect one dimension over.

Two dependency kinds, because there are genuinely two: an artefact key, and a
runtime capability. Street-level imagery has NO local artefact -- it fetches
Mapillary tiles with a token and tree-shakes out when that token is unset.
Collapsing that into the artefact axis would have meant inventing a file that
does not exist purely to keep the model uniform.

Declares only the six layers that already render. Plan B adds the other seven
and the three paths() keys they need; a registry naming a layer nobody draws
would ship a permanently greyed row that looks deliberate."
```

---

## Task 2: The token pass

**Files:**
- Modify: `src/components/ClimateEngine/HeatMapStage.astro` (style block)
- Modify: `tests/unit/obos-layers.test.mjs`

**Measured:** 13 token values are declared, and **12 longhand duplicates** of
four of them appear elsewhere in the same file — `--cyan` ×4, `--bronze` ×3,
`--red` ×3, `--surface2` ×2. That is the same two-copies defect the scope
migration spent two days deleting, in CSS.

- [ ] **Step 1: Write the failing guard**

Append to `tests/unit/obos-layers.test.mjs`:

```js
test('no stylesheet writes a colour a token already declares', async () => {
  /* #6fcad6 appeared FOUR times longhand beside `--cyan: #6fcad6`. A colour with
     two spellings drifts the moment someone edits one -- the CSS form of the
     defect this migration exists to end. */
  const files = [
    'src/components/ClimateEngine/HeatMapStage.astro',
    'src/components/ClimateEngine/shell/IconRail.astro',
    'src/components/ClimateEngine/shell/ScopeSwitcher.astro',
    'src/components/ClimateEngine/shell/LayerTree.astro',
    'src/components/ClimateEngine/shell/InterventionPane.astro',
  ];
  const offences = [];
  for (const rel of files) {
    let src;
    try { src = await readFile(new URL(`../../${rel}`, import.meta.url), 'utf8'); }
    catch { continue; }                       // component not created yet
    const decl = new Map();
    for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) {
      decl.set(m[2].toLowerCase(), m[1]);
    }
    for (const [hex, token] of decl) {
      const n = [...src.matchAll(new RegExp(hex, 'gi'))].length - 1;
      if (n > 0) offences.push(`${rel}: ${hex} written longhand ${n}x beside ${token}`);
    }
  }
  assert.deepEqual(offences, []);
});
```

Then, in the same file, the guard the spec names and this plan otherwise
forgot:

```js
test('the new components use scoped styles, and never :global inside is:global', async () => {
  /* The stage's 581-line block is is:global for a REAL reason: MapLibre injects
     its own DOM and heat-map-app.ts re-classes elements at runtime, and Astro's
     scoping hash only reaches markup Astro rendered. That reason does not extend
     to a rail, a switcher, a tree and a pane, which are static -- so they scope,
     and the global surface SHRINKS rather than grows.

     The second half matters more than it looks: a :global(...) written INSIDE an
     is:global block ships verbatim, and the browser discards the whole rule.
     HeatMapStage.astro already carries two comments warning about it. Four new
     files is four new chances to repeat it. */
  const shell = ['IconRail', 'ScopeSwitcher', 'LayerTree', 'InterventionPane'];
  for (const name of shell) {
    let src;
    try {
      src = await readFile(new URL(
        `../../src/components/ClimateEngine/shell/${name}.astro`, import.meta.url), 'utf8');
    } catch { continue; }                     // not created yet
    // InterventionPane is the documented exception: it holds runtime-classed ids.
    if (name !== 'InterventionPane') {
      assert.ok(!/<style\s+is:global/.test(src),
        `${name}.astro uses is:global -- its markup is static, so it can scope`);
    }
    const styles = [...src.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)];
    for (const [, attrs, body] of styles) {
      if (!attrs.includes('is:global')) continue;
      assert.ok(!/:global\(/.test(body),
        `${name}.astro writes :global() inside an is:global block -- it ships `
        + 'verbatim and the browser discards the entire rule');
    }
  }
});
```

- [ ] **Step 2: Run it, confirm it fails with 4 offences**

Run: `node --import tsx --test tests/unit/obos-layers.test.mjs`
Expected: FAIL listing `--cyan` ×4, `--bronze` ×3, `--red` ×3, `--surface2` ×2.

- [ ] **Step 3: Replace each longhand use with its token**

In `HeatMapStage.astro`'s style block, replace every occurrence of `#6fcad6`
with `var(--cyan)`, `#b08d57` with `var(--bronze)`, `#e5484d` with `var(--red)`
and `#093a3e` with `var(--surface2)` — **except the four declarations
themselves**, which must keep their literals.

Two places need care: a hex inside a `linear-gradient()` or `radial-gradient()`
takes `var()` fine, but a hex inside an SVG `stroke=""` attribute in the markup
does **not** — those are attributes, not CSS. Leave any attribute literals alone
and note them; the guard only scans for a hex that a token also declares, and an
attribute one is still a duplicate. If an attribute duplicate exists, convert the
element to use `stroke="currentColor"` and set `color` in CSS.

- [ ] **Step 4: Run the guard, confirm it passes**

Run: `node --import tsx --test tests/unit/obos-layers.test.mjs`
Expected: PASS.

- [ ] **Step 5: Confirm the page still renders identically**

Run: `npm run build && npm run test:e2e:built`
Expected: pass. `runtime-performance.spec.ts:109` is a KNOWN flake under
full-suite GPU contention that passes in isolation — do not chase it.

- [ ] **Step 6: Prove the guard bites**

Add `color:#6fcad6` anywhere in the style block, run the guard, confirm it names
the file and count, revert. Report.

- [ ] **Step 7: Commit**

```bash
git add src/components/ClimateEngine/HeatMapStage.astro tests/unit/obos-layers.test.mjs
git commit -m "refactor(obos): twelve colours had two spellings

Measured: 13 token values declared, and 12 longhand duplicates of four of them
in the same file -- --cyan x4, --bronze x3, --red x3, --surface2 x2. A colour
with two spellings drifts the moment someone edits one, which is the CSS form of
the defect the scope migration spent two days deleting.

The guard scans every shell stylesheet for a hex a token already declares, and
was watched to fail before it was trusted."
```

---

## Task 3: `IconRail.astro`

**Files:**
- Create: `src/components/ClimateEngine/shell/IconRail.astro`

- [ ] **Step 1: Create the component**

```astro
---
/**
 * The rail is the ONLY navigation, and it carries the mode.
 *
 * Explore and Compare used to be top tabs; they are now where the rail has taken
 * you. Two of the five sections navigate to a route, three swap the sidebar pane
 * -- mixed verbs, deliberately, because that is what every ops console does and
 * one navigation is easier to learn than two.
 *
 * `active` is the section this page IS, so aria-current is a fact rather than a
 * claim. The stage's Explore link used to carry aria-current="page" while
 * pointing somewhere else entirely.
 */
import { DEFAULT_AREA_PATH } from '../../../scripts/climate-engine/scope/paths.ts';

export type RailSection = 'map' | 'layers' | 'analysis' | 'reports' | 'scenarios';
interface Props { active: RailSection; explorePath?: string }
const { active, explorePath = DEFAULT_AREA_PATH } = Astro.props;

/** `href` navigates; its absence swaps the sidebar pane. */
const SECTIONS = [
  { id: 'map',       label: 'Map',       href: explorePath },
  { id: 'layers',    label: 'Layers' },
  { id: 'analysis',  label: 'Analysis',  href: '/heat-map/compare/' },
  { id: 'reports',   label: 'Reports' },
  { id: 'scenarios', label: 'Scenarios' },
] as const;
---
<nav class="rail" aria-label="Sections">
  <span class="rail__mark" aria-hidden="true">
    <img src="/logo-mark-96.webp" alt="" width="30" height="30" decoding="async" />
  </span>
  {SECTIONS.map((s) => (
    s.href && s.id !== active
      ? <a class="rail__btn" href={s.href} data-rail={s.id}>
          <span class="rail__label">{s.label}</span>
        </a>
      : <button class="rail__btn" type="button" data-rail={s.id}
                aria-current={s.id === active ? 'page' : undefined}>
          <span class="rail__label">{s.label}</span>
        </button>
  ))}
</nav>

<style>
  /* SCOPED, not is:global. This markup is fully Astro-rendered and static -- the
     app only toggles aria-current on elements that already exist -- so Astro's
     scoping hash reaches every selector here. is:global is reserved for the map,
     where MapLibre injects DOM the hash can never reach. */
  .rail { display:flex; flex-direction:column; align-items:center; gap:4px;
          padding:12px 0; background:var(--rail-bg); border-right:1px solid var(--line); }
  .rail__mark { margin-bottom:14px; }
  .rail__btn { width:38px; height:38px; border:0; background:none; border-radius:8px;
               display:grid; place-items:center; color:var(--faint); cursor:pointer;
               position:relative; transition:color .18s, background .18s; }
  .rail__btn:hover { color:var(--ink); background:rgb(111 202 214 / .06); }
  .rail__btn[aria-current="page"] { color:var(--cyan); background:rgb(111 202 214 / .10); }
  .rail__btn[aria-current="page"]::before { content:""; position:absolute; left:-12px;
    top:9px; bottom:9px; width:2px; border-radius:0 2px 2px 0; background:var(--cyan); }
  .rail__btn:focus-visible { outline:2px solid var(--cyan); outline-offset:2px; }
  .rail__label { position:absolute; width:1px; height:1px; overflow:hidden;
                 clip:rect(0 0 0 0); white-space:nowrap; }
  @media (prefers-reduced-motion:reduce) { .rail__btn { transition:none; } }
</style>
```

**Note on the icons:** the mockup uses inline SVG paths per section. Copy them
verbatim from `preview-obos/shell.html` into each `<button>`/`<a>` before the
`<span class="rail__label">`, keeping `aria-hidden="true"` on the `<svg>` so the
visually-hidden label is what a screen reader announces.

- [ ] **Step 2: Add the `--rail-bg` token**

In `HeatMapStage.astro`'s `:root` block, add `--rail-bg:#040808;` beside the
existing tokens. It is darker than `--base` on purpose: the rail reads as sitting
behind the app.

- [ ] **Step 3: Verify it compiles**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ClimateEngine/shell/IconRail.astro src/components/ClimateEngine/HeatMapStage.astro
git commit -m "feat(obos): the icon rail, scoped styles and an honest aria-current

Two sections navigate, three swap the sidebar -- mixed verbs on purpose, because
one navigation is easier to learn than two. `active` is what the page IS, so
aria-current states a fact; the old Explore tab claimed it while pointing
somewhere else.

Scoped styles, not is:global: this markup is fully Astro-rendered, so the
scoping hash reaches it. is:global stays where MapLibre injects DOM."
```

---

## Task 4: `ScopeSwitcher.astro`

**Files:**
- Create: `src/components/ClimateEngine/shell/ScopeSwitcher.astro`

- [ ] **Step 1: Create the component**

```astro
---
/**
 * Country -> City -> Area, with the tier badge.
 *
 * Every value here is REAL as of spec 1: the tier is a CityTier off the registry,
 * and an area that ships no data cannot be selected into a fetch because paths()
 * returns null for it. In the mockup all of this was hardcoded.
 *
 * The card labels are visually hidden rather than deleted: "India" alone in a
 * button does not say what it selects, and a screen reader gets nothing from it.
 */
import { REGISTRY, AREA_KEYS, splitKey } from '../../../scripts/climate-engine/scope/registry.ts';
import { resolve } from '../../../scripts/climate-engine/scope/resolve.ts';
import type { AreaKey } from '../../../scripts/climate-engine/scope/registry.ts';

interface Props { current: AreaKey }
const { current } = Astro.props;
const scope = resolve(current);
const { country, city } = splitKey(current);

const countries = Object.entries(REGISTRY).map(([id, c]) => ({ id, name: c.name }));
const cities = Object.entries(
  (REGISTRY as Record<string, { cities: Record<string, { name?: string }> }>)[country].cities,
).map(([id]) => ({ id, ...resolve(`${country}/${id}/${Object.keys(
  (REGISTRY as any)[country].cities[id].areas)[0]}` as AreaKey).city }));
const areas = AREA_KEYS
  .filter((k) => k.startsWith(`${country}/${city}/`))
  .map((k) => ({ key: k, ...resolve(k).area }));

const TIER_LABEL = { validated: 'Validated', zone: 'Zone-calib.', geometry: 'Geometry' } as const;
---
<div class="scope">
  <p class="scope__lbl">Scope</p>

  <label class="scope__card">
    <span class="scope__k">Country</span>
    <select class="scope__v" data-scope="country">
      {countries.map((c) => <option value={c.id} selected={c.id === country}>{c.name}</option>)}
    </select>
  </label>

  <label class="scope__card">
    <span class="scope__k">City</span>
    <select class="scope__v" data-scope="city">
      {cities.map((c) => <option value={c.id} selected={c.id === city}>{c.name}</option>)}
    </select>
    <span class={`scope__tier scope__tier--${scope.tier}`}>{TIER_LABEL[scope.tier]}</span>
  </label>

  <label class="scope__card">
    <span class="scope__k">Area</span>
    <select class="scope__v" data-scope="area">
      {areas.map((a) => (
        <option value={a.id} selected={a.id === scope.area.id} disabled={!a.hasData}>
          {a.name}{a.hasData ? '' : ' — no data'}
        </option>
      ))}
    </select>
  </label>
</div>

<style>
  .scope { padding:12px 14px 11px; border-bottom:1px solid var(--line);
           display:flex; flex-direction:column; gap:5px; }
  .scope__lbl { font-family:var(--mono); font-size:.62rem; letter-spacing:.14em;
                text-transform:uppercase; color:var(--faint); margin:0 0 4px; }
  .scope__card { display:flex; align-items:center; gap:8px; padding:6px 9px;
                 border-radius:7px; background:rgb(9 58 62 / .42);
                 transition:background .18s; cursor:pointer; }
  .scope__card:hover { background:rgb(9 58 62 / .68); }
  .scope__card:focus-within { outline:2px solid var(--cyan); outline-offset:2px; }
  .scope__k { position:absolute; width:1px; height:1px; overflow:hidden;
              clip:rect(0 0 0 0); white-space:nowrap; }
  .scope__v { flex:1; min-width:0; border:0; background:none; color:var(--paper);
              font-family:var(--sans); font-size:.82rem; font-weight:600; cursor:pointer; }
  .scope__tier { font-family:var(--mono); font-size:.53rem; letter-spacing:.08em;
                 text-transform:uppercase; padding:2px 4px; border-radius:3px; }
  .scope__tier--validated { background:rgb(93 185 138 / .16); color:var(--green); }
  .scope__tier--zone      { background:rgb(176 141 87 / .18); color:var(--bronze); }
  .scope__tier--geometry  { background:rgb(92 113 115 / .22); color:var(--faint); }
  @media (prefers-reduced-motion:reduce) { .scope__card { transition:none; } }
</style>
```

**Why `<select>` and not the mockup's custom dropdown:** a native select is
keyboard-accessible, screen-reader-correct and mobile-correct for free, and it
supports `disabled` on an option — which is exactly how a no-data area should
present. The mockup's styled listbox can replace it later without changing the
data flow. Shipping a custom listbox without a roving tabindex and arrow-key
handling would be a worse control than the one it replaces.

- [ ] **Step 2: Add the `--green` token if absent**

Check `HeatMapStage.astro`'s `:root` for `--green`. If it is not declared, add
`--green:#5db98a;`.

- [ ] **Step 3: Verify and commit**

Run: `npm run check` — 0 errors.

```bash
git add src/components/ClimateEngine/shell/ScopeSwitcher.astro src/components/ClimateEngine/HeatMapStage.astro
git commit -m "feat(obos): the scope switcher, with real tiers and unselectable empty areas

Every value is real as of spec 1: the tier is a CityTier off the registry, and an
area that ships no data renders disabled rather than selectable-then-refused.

Native <select> rather than the mockup's custom listbox: keyboard, screen-reader
and mobile behaviour for free, and `disabled` on an option is exactly how a
no-data area should present. A custom listbox without roving tabindex and arrow
keys would be a worse control than the one it replaces."
```

---

## Task 5: `LayerTree.astro`

**Files:**
- Create: `src/components/ClimateEngine/shell/LayerTree.astro`

- [ ] **Step 1: Create the component**

```astro
---
/**
 * The layer tree. Groups, checkboxes, a live n/total, and rows that say WHY they
 * are unavailable.
 *
 * A layer that cannot be drawn here is DISABLED WITH ITS REASON NAMED -- never
 * hidden, which reads as "this does not exist", and never live-but-inert, which
 * is the defect the spec-1 audit found twice: a control that does nothing and
 * says nothing.
 */
import { LAYERS, LAYER_IDS, splitLayerId, layerAvailability }
  from '../../../scripts/climate-engine/scope/layers.ts';
import type { AreaKey } from '../../../scripts/climate-engine/scope/registry.ts';

interface Props { current: AreaKey; mapillary: boolean }
const { current, mapillary } = Astro.props;

const groups = Object.entries(LAYERS).map(([gid, group]) => {
  const rows = LAYER_IDS
    .filter((id) => splitLayerId(id).group === gid)
    .map((id) => {
      const { item } = splitLayerId(id);
      const entry = (LAYERS as any)[gid].items[item];
      const avail = layerAvailability(id, current, { mapillary });
      return { id, label: entry.label, on: entry.on && avail.available, ...avail };
    });
  return { gid, label: group.label, rows,
           live: rows.filter((r) => r.on).length, total: rows.length };
});
---
<div class="tree">
  {groups.map((g) => (
    <section class="tree__group">
      <h3 class="tree__head">
        {g.label}<span class="tree__count" data-count={g.gid}>{g.live} / {g.total}</span>
      </h3>
      <ul class="tree__list">
        {g.rows.map((r) => (
          <li class={r.available ? 'tree__row' : 'tree__row tree__row--off'}>
            <label>
              <input type="checkbox" data-layer={r.id}
                     checked={r.on} disabled={!r.available} />
              <span class="tree__name">{r.label}</span>
              {r.available ? null : <span class="tree__why">{r.reason}</span>}
            </label>
          </li>
        ))}
      </ul>
    </section>
  ))}
</div>

<style>
  .tree__group { border-bottom:1px solid var(--line); }
  .tree__head { display:flex; align-items:center; gap:8px; margin:0; padding:10px 14px;
                font-family:var(--mono); font-size:.65rem; letter-spacing:.13em;
                text-transform:uppercase; color:var(--ink); font-weight:400; }
  .tree__count { margin-left:auto; font-size:.62rem; color:var(--faint); }
  .tree__list { list-style:none; margin:0; padding:0 14px 11px; }
  .tree__row label { display:flex; align-items:center; gap:9px; padding:5px 0;
                     font-size:.81rem; color:var(--ink); cursor:pointer; }
  .tree__row--off label { opacity:.4; cursor:not-allowed; }
  .tree__row input { width:14px; height:14px; accent-color:var(--cyan); flex:none; }
  .tree__row input:focus-visible { outline:2px solid var(--cyan); outline-offset:2px; }
  .tree__name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tree__why { font-family:var(--mono); font-size:.57rem; letter-spacing:.06em;
               color:var(--bronze); }
</style>
```

- [ ] **Step 2: Verify and commit**

Run: `npm run check` — 0 errors.

```bash
git add src/components/ClimateEngine/shell/LayerTree.astro
git commit -m "feat(obos): the layer tree, where an unavailable row says why

Disabled WITH the artefact or capability named -- never hidden, which reads as
'this does not exist', and never live-but-inert, which is the control that does
nothing and says nothing the spec-1 audit found twice."
```

---

## Task 6: `InterventionPane.astro`

**Files:**
- Create: `src/components/ClimateEngine/shell/InterventionPane.astro`
- Modify: `src/components/ClimateEngine/HeatMapStage.astro` (remove `aside.panel.left`)

- [ ] **Step 1: Move the toolbox verbatim**

Open `HeatMapStage.astro` and locate `<aside class="panel left">` (around line
327) through its closing `</aside>`. Move that markup into
`src/components/ClimateEngine/shell/InterventionPane.astro` **unchanged** — the
same sliders, the same segmented controls, the same score ring, the same ids.

Add the frontmatter it needs:

```astro
---
/**
 * Today's Green Infrastructure Toolbox, moved out of the 1,050-line stage
 * unchanged. Content is deliberately untouched: this task is about WHERE it
 * lives, and mixing a move with an edit makes both unreviewable.
 *
 * Its ids are load-bearing -- heat-map-app.ts queries them by name -- so they
 * are preserved exactly. Styles stay is:global for the same reason: the app
 * writes classes onto these elements at runtime.
 */
import type { ResolvedScope } from '../../../scripts/climate-engine/scope/resolve.ts';
interface Props { scope: ResolvedScope }
const { scope } = Astro.props;
---
```

Replace any `scope.` references the moved markup used with the prop.

- [ ] **Step 2: Confirm nothing changed but the location**

Run:
```bash
npm run build && npm run test:e2e:built
```
Expected: pass. The toolbox e2e specs exercise these ids; if any fails, an id was
renamed during the move — revert and move verbatim.

- [ ] **Step 3: Commit**

```bash
git add src/components/ClimateEngine/shell/InterventionPane.astro src/components/ClimateEngine/HeatMapStage.astro
git commit -m "refactor(obos): extract the toolbox, unchanged

A move, not an edit. Ids are load-bearing -- heat-map-app.ts queries them by
name -- so they are preserved exactly, and the styles stay is:global because the
app writes classes onto these elements at runtime. Mixing a move with an edit
makes both unreviewable."
```

---

## Task 7: Compose the shell, and remove the top tabs

**Files:**
- Modify: `src/components/ClimateEngine/HeatMapStage.astro`
- Modify: `src/scripts/climate-engine/heat-map-app.ts`

- [ ] **Step 1: Restructure the stage**

Replace `<header class="top">`'s `<nav class="tool-modes">` block (the Explore
and Compare links, around lines 104-111) — delete it. The rail now carries the
mode.

Change the stage's grid so the rail and sidebar are columns:

```css
  .stage { position:fixed; inset:0; display:grid;
           grid-template-columns:var(--rail-w) var(--side-w) 1fr;
           grid-template-rows:auto 1fr auto; }
```

Add `--rail-w:56px; --side-w:300px;` to `:root`.

Compose:

```astro
<IconRail active="map" explorePath={here} />
<aside class="side">
  <ScopeSwitcher current={scope.key} />
  <div class="side__panes">
    <div class="pane pane--on" data-pane="map"><InterventionPane scope={scope} /></div>
    <div class="pane" data-pane="layers"><LayerTree current={scope.key} mapillary={hasMapillary} /></div>
    <div class="pane" data-pane="reports">
      <p class="pane__note">Ward report, with the provenance and confidence tier attached.</p>
      <a class="cta" id="report-link" href={reportHref} download>Generate ward report ↗</a>
    </div>
    <div class="pane" data-pane="scenarios">
      <p class="pane__note">Saved intervention sets, compared side by side.
        <b>Not built yet</b> — the model exists in <code>dc-urs-scenario.ts</code>;
        the UI lands with Plan B.</p>
    </div>
  </div>
</aside>
```

`hasMapillary` is the same check `heat-map-app.ts:259` already makes — read it
from the environment in the stage's frontmatter, do not invent a second one:

```ts
const hasMapillary = Boolean(import.meta.env.PUBLIC_MAPILLARY_TOKEN);
```

A second spelling of "is street-level imagery available" is exactly the
two-copies defect this whole sequence keeps deleting.

The `reports` and `scenarios` panes hold the report link and a stated
placeholder respectively. **A pane that is not built says so**; it does not
render an empty box.

- [ ] **Step 2: Wire the rail in `heat-map-app.ts`**

```ts
/* RAIL PANES. Clicking the active section collapses the sidebar -- the
   behaviour people already have from VS Code. Panes cross-fade on opacity and
   transform ONLY; animating layout on a 300px column costs a relayout per
   frame, and this project's signature is 60fps motion. */
function bindRail(root: HTMLElement): void {
  const panes = [...root.querySelectorAll<HTMLElement>('[data-pane]')];
  for (const btn of root.querySelectorAll<HTMLElement>('button[data-rail]')) {
    btn.addEventListener('click', () => {
      const next = btn.dataset.rail!;
      if (btn.getAttribute('aria-current') === 'page') {
        root.classList.toggle('is-collapsed');
        return;
      }
      root.classList.remove('is-collapsed');
      for (const b of root.querySelectorAll('button[data-rail]')) {
        b.toggleAttribute('aria-current', b === btn);
        if (b === btn) b.setAttribute('aria-current', 'page');
      }
      for (const p of panes) p.classList.toggle('pane--on', p.dataset.pane === next);
    });
  }
}
```

- [ ] **Step 3: Wire the layer checkboxes**

```ts
/* One handler for every layer. The checkbox is the source of truth for
   visibility; a disabled one cannot be reached, so a layer whose artefact is
   missing can never be switched on. */
for (const box of root.querySelectorAll<HTMLInputElement>('input[data-layer]')) {
  box.addEventListener('change', () => {
    setLayerVisible(box.dataset.layer!, box.checked);
    refreshGroupCounts(root);
  });
}
```

`setLayerVisible` maps a `LayerId` to the existing visibility call for that
layer — surface, canopy, trees, footprints, heights, street. Use a `switch` over
`LayerId`; because the type is derived, a missing case is a compile error.

`refreshGroupCounts` keeps each group's `n / total` honest after a toggle:

```ts
/* The count is DERIVED from the checkboxes, not tracked alongside them. A
   parallel counter is a second copy of the same fact and drifts the first time
   a layer is toggled by anything but a click. */
function refreshGroupCounts(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-count]')) {
    const gid = el.dataset.count!;
    const boxes = [...root.querySelectorAll<HTMLInputElement>('input[data-layer]')]
      .filter((b) => b.dataset.layer!.startsWith(`${gid}/`));
    el.textContent = `${boxes.filter((b) => b.checked).length} / ${boxes.length}`;
  }
}
```

- [ ] **Step 4: Verify**

Run: `npm run check && npm run test:unit && npm run build`
Expected: all pass. Existing e2e specs that assert on `.tool-modes` will fail —
update them to the rail, do not weaken them.

- [ ] **Step 5: Commit**

```bash
git add src/components/ClimateEngine/HeatMapStage.astro src/scripts/climate-engine/heat-map-app.ts tests/
git commit -m "feat(obos): the rail becomes the only navigation

Explore and Compare stop being top tabs and become where the rail has taken you.
Panes cross-fade on opacity and transform only -- animating layout on a 300px
column costs a relayout per frame, and this project's signature is 60fps motion.

setLayerVisible switches over the DERIVED LayerId, so a layer added to the
registry without a renderer is a compile error rather than a silent no-op."
```

---

## Task 8: `PairedBench.astro` adopts the shell

**Files:**
- Modify: `src/components/ClimateEngine/compare/PairedBench.astro`

**Measured:** 194 lines, 84 uses of its own `heat-compare__` BEM vocabulary, plus
an editorial intro (eyebrow, h1, method paragraph). **Wrap it; do not rewrite
it.** Rewriting 84 class uses is a different task with different risk.

- [ ] **Step 1: Replace its header with the shell**

Delete `<header class="heat-compare__header">` (lines 14-20) — the brand, the
Explore/Compare nav, and the brief link. Add the rail and switcher:

```astro
<IconRail active="analysis" />
<aside class="side">
  <ScopeSwitcher current={paneA} />
  <div class="side__panes">
    <div class="pane pane--on" data-pane="analysis">
      {/* the A/B pickers and phase selector move here from the bench chrome */}
    </div>
  </div>
</aside>
```

The brief link moves into the Analysis pane, where the method copy now lives.

- [ ] **Step 2: Move the editorial intro into the pane**

`<section class="heat-compare__intro">` holds an eyebrow, an h1 and a method
paragraph. The h1 stays on the page — it is the document title and removing it
would leave the route without one. The **method paragraph** moves into the
Analysis pane above the pickers, next to the brief link, where a reader looking
for scope and limits will be.

- [ ] **Step 3: Constrain the A/B pair to one city**

The Analysis pane must not permit A and B in different cities: comparing across
countries would mix two climates and two currencies. Build both selects from
`areaKeysInCity(...)`, which spec 1's `nextDistinctArea` already relies on.

- [ ] **Step 4: Verify the compare route still works**

```bash
npm run build && npx playwright test tests/e2e/heat-map-compare.spec.ts
```
Expected: pass. That spec drives `?a=barrackpore&b=ballygunge` — the **non-default
pair**, deliberately: `ballygunge`+`baruipur` IS the default, so a fallback would
be indistinguishable from a correct resolve, and that exact mistake already let a
test pass against a broken bridge in spec 1.

- [ ] **Step 5: Commit**

```bash
git add src/components/ClimateEngine/compare/PairedBench.astro
git commit -m "feat(obos): Compare joins the console

One shell across both routes: the rail and scope switcher wrap the bench, and
its 84 heat-compare__ class uses are untouched -- wrapping is a different risk
from rewriting.

The A/B pair is constrained to one city; comparing across countries would mix
two climates and two currencies."
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the gate**

Run: `npm run verify`
Expected: exit 0.

- [ ] **Step 2: Confirm the goldens never moved**

Run: `git diff origin/feat/obos-scope-model HEAD -- data/calibration/`
Expected: empty. Nothing in this plan touches the physics; if it moved, a shell
change reached into the model.

- [ ] **Step 3: Drive both routes**

```bash
npm run build && npx astro preview --port 4330
```

Check by hand:
- `/heat-map/in/kolkata/ballygunge/` — rail present, Map active, toolbox in the sidebar
- Switch to Layers — six rows, group counts live, checkboxes toggle the map
- `/heat-map/ae/dubai/al-quoz/` — every artefact-backed row disabled **with its reason named**
- Click Analysis — lands on Compare, rail still there, Analysis active
- `/heat-map/compare/?a=barrackpore&b=ballygunge` — Barrackpore vs Ballygunge
- Click the active rail section — sidebar collapses; click another — it reopens

- [ ] **Step 4: Commit and push**

```bash
git add -A && git commit -m "chore(obos): shell green end to end"
git push -u origin feat/obos-shell
```

---

## Out of scope

Plan B, and each its own task there: UTFVI bands, cooling corridors, cool-roof
candidates, rooftop PV, refuge access, ECOSTRESS overpasses, air-quality
stations, and the three `paths()` keys three of them need.

Also out of scope, and unchanged from the spec: making refuge access respond
live to the tree slider; Dubai's thermal data (spec 3); the light theme; per-city
basemap styling; and the five Important findings the spec-1 audit deferred — in
particular the four Python scripts that still hardcode the ward tuple, which is
not a UI problem.
