# Solar in the console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the certified rooftop-solar screen into the console — a Solar section on the rail with its own pane, a solar block on the building card, a solar block on the ward panel — with the strict-mask floor printed wherever the headline is and the tariff an assumption the reader can change.

**Architecture:** The console reads `public/heat-map/data/pv-<ward>.json` (already on the CDN, with `loss_strict`, `totals`, `stratum` since commit `99afb8c`) as an eleventh lazy fetch in the ward loader, cached per ward like provenance and validated against the ward's building count. Three painters in `heat-map-app.ts` — card, ward panel, pane — read the cache; the only arithmetic in the browser is rupees = kWh × tariff and a sort for the ten best roofs. No new dependency, no change to the physics or the artefacts. Spec: `docs/superpowers/specs/2026-09-05-solar-console-design.md`.

**Tech Stack:** Astro components (`HeatMapStage.astro`, `PairedBench.astro`, `IconRail.astro`), TypeScript (`heat-map-app.ts`, `paths.ts`, `types.ts`), `node --test` source assertions in `tests/unit/obos-shell.test.mjs`, Playwright e2e on `chromium-tier0`, the existing studio contrast gate.

**Working tree:** `/Volumes/VSTSAMPLES/Projects/angad-built` (pushes to `origin/main`). exFAT: refresh and rebase in ONE invocation (`git update-index -q --refresh; git fetch -q origin; git rebase -q origin/main`); never `reset --hard`. Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `npm run check` (astro check, the TypeScript gate; `npm run typecheck` is mypy for the Python) after every code task; `npm run build` before any e2e (the suite runs against `dist/`).

---

## File structure

| file | responsibility |
|---|---|
| `src/components/ClimateEngine/shell/IconRail.astro` | the `solar` section in the rail's typed list |
| `tests/unit/obos-shell.test.mjs` | the rail's section pin moves from five to six; new source assertions for the wiring |
| `src/scripts/climate-engine/scope/paths.ts` | the `pv` path |
| `src/scripts/climate-engine/types.ts` | `PvFile` |
| `src/scripts/climate-engine/heat-map-app.ts` | `pvCache` + `asPvFile`, the fetch, `paintSolarCard`, `paintSolarWard`, `paintSolarPane`, the tariff store, the CSV builder, row → `select` |
| `src/components/ClimateEngine/HeatMapStage.astro` | card block, panel block, Solar pane, their CSS (dark + studio) |
| `src/components/ClimateEngine/compare/PairedBench.astro` | the Solar pane's "needs a map" body |
| `tests/e2e/solar-pane.spec.ts` | the real page: panel, pane, tariff, CSV, row → card |
| `docs/evidence/known-limitations.md` | the "gap for whoever builds the card" paragraph closes |

---

### Task 1: The rail learns a sixth section

**Files:**
- Modify: `tests/unit/obos-shell.test.mjs:47-48`, `:123-130`, `:145`, `:259`
- Modify: `src/components/ClimateEngine/shell/IconRail.astro:102`, `:199-207`

- [ ] **Step 1: Move the harness's pin from five sections to six (the failing test)**

In `tests/unit/obos-shell.test.mjs` replace:
```js
/** The five sections the design gives the rail. Not four, and not six. */
const SECTION_IDS = ['analysis', 'layers', 'map', 'reports', 'scenarios'];
```
with:
```js
/** The six sections the design gives the rail. Not five, and not seven. Solar
    joined on 2026-09-06 (spec 2026-09-05-solar-console-design.md §2.1): a pane
    that ranks a ward's roofs, not a route. Sorted, because the test sorts. */
const SECTION_IDS = ['analysis', 'layers', 'map', 'reports', 'scenarios', 'solar'];
```
Replace:
```js
test('the rail carries all five sections, each declared exactly once', async () => {
  const { frontmatter } = await railSource();
  const ids = sectionTable(frontmatter).map((s) => s.id);
  assert.equal(ids.length, 5,
    `the rail declares ${ids.length} sections, not 5: ${ids.join(', ') || '(none)'}`);
  assert.deepEqual([...ids].sort(), SECTION_IDS,
    'the rail must carry exactly Map, Layers, Analysis, Reports and Scenarios, '
    + `each once -- it declares: ${ids.join(', ')}`);
});
```
with:
```js
test('the rail carries all six sections, each declared exactly once', async () => {
  const { frontmatter } = await railSource();
  const ids = sectionTable(frontmatter).map((s) => s.id);
  assert.equal(ids.length, 6,
    `the rail declares ${ids.length} sections, not 6: ${ids.join(', ') || '(none)'}`);
  assert.deepEqual([...ids].sort(), SECTION_IDS,
    'the rail must carry exactly Map, Layers, Analysis, Solar, Reports and Scenarios, '
    + `each once -- it declares: ${ids.join(', ')}`);
});
```
Replace BOTH occurrences of `for (const id of ['layers', 'reports', 'scenarios']) {` (lines ~145 and ~259) with `for (const id of ['layers', 'solar', 'reports', 'scenarios']) {`.

- [ ] **Step 2: Run the unit suite to verify it fails**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && npm run -s test:unit 2>&1 | grep -E "not ok|the rail declares|ℹ fail"`
Expected: `the rail declares 5 sections, not 6` and `ℹ fail 1` (or more, all in the rail tests).

- [ ] **Step 3: Add the section to the rail**

In `src/components/ClimateEngine/shell/IconRail.astro` replace:
```ts
/** The five places the rail can be. Exported for callers to name one. */
export type RailSection = 'map' | 'layers' | 'analysis' | 'reports' | 'scenarios';
```
with:
```ts
/** The six places the rail can be. Exported for callers to name one. */
export type RailSection = 'map' | 'layers' | 'analysis' | 'solar' | 'reports' | 'scenarios';
```
and insert, immediately after the `analysis` entry in `SECTIONS` (the line ending `d: 'M3 3v18h18M7 15l4-5 3 3 5-7' } },`):
```ts
  /* SOLAR — a pane, not a route: the ward's roofs ranked by what they would make,
     each row selecting its building on the map, and the list to take away.
     Sits after Analysis because it reads the ward the reader is standing on. */
  { id: 'solar', label: 'Solar', href: null, body: 'always', icon: {
    circle: [12, 12, 4], d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1' } },
```

- [ ] **Step 4: Run the unit suite and typecheck to verify they pass**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && npm run -s test:unit 2>&1 | grep -E "ℹ (pass|fail)" && npm run -s check 2>&1 | tail -1`
Expected: `ℹ fail 0` and `Success`. (Both routes will render a button for `solar` that opens no pane until Task 5 — the harness's pane-per-always-section check, if any fires, is answered in Task 5; report it if it does.)

- [ ] **Step 5: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add tests/unit/obos-shell.test.mjs src/components/ClimateEngine/shell/IconRail.astro
git commit -m "feat(shell): a sixth rail section, Solar — a pane, not a route

The harness pinned the rail to five sections by name; the pin moves to six
with the reason written down. The pane itself lands with the screen.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The solar file joins the ward bundle

**Files:**
- Modify: `src/scripts/climate-engine/scope/paths.ts:85-96`, `:196-210`
- Modify: `src/scripts/climate-engine/types.ts` (append after `export interface SimStats { … }`)
- Modify: `src/scripts/climate-engine/heat-map-app.ts:14`, `:1038`, `:1244-1284`

- [ ] **Step 1: The path**

In `paths.ts` change the comment `/** The ten per-area artefacts. Names are the callers' vocabulary, not the files'. */` to `/** The eleven per-area artefacts. Names are the callers' vocabulary, not the files'. */`, add `  readonly pv: string;` after `  readonly layers: string;` in `AreaPaths`, and add `    pv: \`${DATA}pv-${area}.json\`,` after `    layers: \`${DATA}${area}-layers.json\`,` in the returned object.

- [ ] **Step 2: The type**

In `types.ts`, immediately after the closing `}` of `export interface SimStats { … }`, add:
```ts
/**
 * The rooftop-solar screen, one file per ward, written by scripts/build-pv-yield.py.
 * Arrays join the ward's `b` rows BY INDEX — there is no id — so a file whose
 * lengths disagree with the ward is a wrong-ward file and must be refused.
 * `loss` is the central cell (buildings + trees); `loss_strict` is the strict-mask
 * floor the card prints beside it; `totals` and `stratum` are the laboratory's
 * ward numbers, carried so the browser never re-derives them.
 */
export interface PvFile {
  readonly ward: string;
  readonly kwp: readonly number[];
  readonly kwh: readonly number[];
  readonly loss: readonly number[];
  readonly loss_buildings: readonly number[];
  readonly loss_trees: readonly number[];
  readonly loss_raised: readonly number[];
  readonly loss_strict: readonly number[];
  readonly specific_yield: number;
  readonly packing_factor: number;
  readonly basis: string;
  readonly totals: {
    readonly capacity_mwp: number;
    readonly capacity_mwp_range: readonly [number, number];
    readonly generation_gwh_yr: number;
    readonly shading_loss_gwh_yr: number;
    readonly mean_loss: number;
    readonly mean_loss_strict: number;
    readonly mean_loss_trees: number;
    readonly mean_loss_raised: number;
  };
  readonly stratum: {
    readonly threshold_kwp: number;
    readonly n: number;
    readonly share_losing_5pct: number;
    readonly mean_loss: number;
  };
}
```

- [ ] **Step 3: The cache, the validator and the fetch**

In `heat-map-app.ts` change the import on line 14 to:
```ts
import { DEFAULT_PARAMS, greenReferenceContrastC, type ClimateConstants, type PvFile, type SimLayers, type SimParams } from './types';
```
Immediately after the line `  const provCache: Record<string, { src: string[]; confidence: number[] } | null> = {};` add:
```ts
  /* THE ROOFTOP-SOLAR SCREEN, one file per ward, fetched with the bundle and
     cached like provenance. `null` is "no screen ships here", and everything
     solar stays hidden; `undefined` is "not fetched yet". A file whose arrays
     disagree with the ward's building count is refused, because the join is by
     index with no id: a wrong-ward file would hand every roof a stranger's
     figures without a single error, and the card would print them in good faith. */
  const pvCache: Record<string, PvFile | null> = {};
  function asPvFile(raw: unknown, buildings: number): PvFile | null {
    if (!raw || typeof raw !== 'object') return null;
    const f = raw as PvFile;
    const arrays = [f.kwp, f.kwh, f.loss, f.loss_buildings, f.loss_trees, f.loss_raised, f.loss_strict];
    if (!arrays.every((a) => Array.isArray(a) && a.length === buildings) || !f.totals || !f.stratum) {
      console.warn(`solar screen for ${String(f.ward ?? '?')} does not match this ward's ${buildings} buildings — ignored`);
      return null;
    }
    return f;
  }
```
In `loadWard`, change the destructuring line
```ts
      const [d, terrain, water, wardSurface, roads, labels, provenance, canopy, trees] = await Promise.all([
```
to
```ts
      const [d, terrain, water, wardSurface, roads, labels, provenance, canopy, trees, pvRaw] = await Promise.all([
```
and add, as the LAST element of that `Promise.all` array (after the `trees` entry that ends `asTreesFile(await r.json()) : null)), null),`):
```ts
        pvCache[name] !== undefined
          ? Promise.resolve(pvCache[name] as unknown)
          : optional(fetch(P.pv, { signal: token.signal })
            .then(async (r) => (r.ok ? await r.json() as unknown : null)), null as unknown),
```
Then change the cache-assignment line
```ts
      canopyCache[name] = canopy;
```
to
```ts
      canopyCache[name] = canopy;
      pvCache[name] = asPvFile(pvRaw, d.b.length);
```

- [ ] **Step 4: Typecheck, and prove the Python readers of types.ts still pass**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && npm run -s check 2>&1 | tail -1 && npm run -s test:py 2>&1 | tail -2`
Expected: `0 errors` from astro check and the Python chain's last lines unchanged (`self-check: ok`). If a Python reader of `types.ts` objects to the new interface, report BLOCKED with its message — do not move the interface.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add src/scripts/climate-engine/scope/paths.ts src/scripts/climate-engine/types.ts src/scripts/climate-engine/heat-map-app.ts
git commit -m "feat(console): the ward bundle fetches its solar screen, validated by building count

Eleventh lazy artefact, cached like provenance. A file whose arrays disagree
with the ward is refused: the join is by index with no id.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The card block

**Files:**
- Modify: `src/components/ClimateEngine/HeatMapStage.astro:483-484` (markup), `:1160` (CSS)
- Modify: `src/scripts/climate-engine/heat-map-app.ts:709` (call), after `paintCard` (the painter and the tariff store)

- [ ] **Step 1: Markup**

In `HeatMapStage.astro`, between the card's `        </dl>` (the line after `<dt>Surface</dt><dd id="bcT">—</dd>`) and `        <div class="sv-thumb" id="svThumb" hidden></div>`, insert:
```astro
        {/* ROOFTOP SOLAR — a screening estimate ABOUT the building, under the
            measured rows and in a different ink. Painted by paintSolarCard from
            the ward's solar file; hidden when none ships. "At least" is the
            strict-mask floor: the mask rule is the largest lever in the estimate,
            so the headline never prints without it (spec §2.4). */}
        <div class="bc-sol" id="bcSol" hidden>
          <div class="bc-h"><span>Rooftop solar</span><span>screening</span></div>
          <dl>
            <dt>Installable</dt><dd id="bcSolKwp" class="sun">—</dd>
            <dt>Yield</dt><dd id="bcSolKwh">—</dd>
            <dt>Shaded</dt><dd id="bcSolLoss">—</dd>
            <dt>At least</dt><dd id="bcSolFloor">—</dd>
            <dt>Raised 2 m</dt><dd id="bcSolRaised">—</dd>
            <dt>Worth</dt><dd id="bcSolRs">—</dd>
          </dl>
          <p class="bc-sol-note">Screening estimate · not bankable · canopy Meta/WRI CHM v2 · 0.5 m grid · NASA POWER irradiance</p>
        </div>
```

- [ ] **Step 2: CSS**

Immediately after the line `  .bc-prov:empty{display:none}` add:
```css
  /* ROOFTOP SOLAR on the card: the card's own grid and notes, ruled off and headed
     in amber, because it is a screening estimate about the building and must never
     read as one of the measured rows above it. */
  .bc-sol{margin:.55rem 0 0;padding-top:.5rem;border-top:1px solid rgb(242 181 68 /.35)}
  .bc-sol .bc-h{color:var(--sun);margin-bottom:.35rem}
  .bc-sol dd.sun{color:var(--sun)}
  .bc-sol-note{margin:.4rem 0 0;font:400 .46rem var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--bronze);line-height:1.6}
  /* Clay: amber on the near-white card fails 4.5:1, so the card's amber steps
     down to an ink that clears it; the studio contrast gate is the proof. */
  body.studio .bc-sol .bc-h,body.studio .bc-sol dd.sun{color:#7a5200}
  body.studio .bc-sol{border-top-color:rgb(122 82 0 /.35)}
```

- [ ] **Step 3: The painter and the tariff store**

In `heat-map-app.ts`, immediately after the closing `  }` of `paintCard` (the line after `    setHTML('bcIns', parts.join('<br>'));`), add:
```ts
  /* ── rooftop solar, per building ──
     Every figure is read from the ward's solar file by the building's index; the
     only arithmetic here is rupees = kWh × tariff. The floor is the strict-mask
     cell — the mask rule is the largest lever in the estimate (spec §2.4) — and
     it prints wherever the headline does. */
  const TARIFF_KEY = 'delta:hm-tariff';
  const TARIFF_DEFAULT = 8.0;
  /* An ASSUMPTION the reader can change and the page remembers, like the clock
     format: a person's preference, not the visit's. Guarded because storage
     throws outright in some privacy modes. */
  let tariff = TARIFF_DEFAULT;
  try {
    const t = Number(localStorage.getItem(TARIFF_KEY));
    if (Number.isFinite(t) && t > 0) tariff = t;
  } catch { /* default stands */ }
  const inr = (v: number): string => v >= 1e7 ? `₹${(v / 1e7).toFixed(1)} cr`
    : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : `₹${Math.round(v).toLocaleString()}`;
  const pct = (f: number): string => (f < 0.005 ? 'none' : `−${Math.round(f * 100)}%`);
  function paintSolarCard(b: BuildingMeta) {
    const box = el('bcSol');
    const pv = pvCache[state.ward];
    if (!box) return;
    if (!pv) { box.setAttribute('hidden', ''); return; }
    const i = b.idx;
    setHTML('bcSolKwp', `${pv.kwp[i].toFixed(1)} kWp<small>${Math.round(pv.packing_factor * 100)}% of roof · floor</small>`);
    setHTML('bcSolKwh', `${Math.round(pv.kwh[i]).toLocaleString()} kWh/yr<small>${Math.round(pv.specific_yield).toLocaleString()} kWh per kWp</small>`);
    setHTML('bcSolLoss', `${pct(pv.loss[i])}<small>of which trees ${Math.round(pv.loss_trees[i] * 100)}% · annual</small>`);
    setHTML('bcSolFloor', `${pct(pv.loss_strict[i])}<small>under a strict roof mask</small>`);
    setHTML('bcSolRaised', `${pct(pv.loss_raised[i])}<small>elevated mounting · what-if</small>`);
    setHTML('bcSolRs', `${inr(pv.kwh[i] * tariff)}/yr<small>at ₹${tariff.toFixed(2)} per kWh · assumed</small>`);
    box.removeAttribute('hidden');
  }
```
and change the line `    setHTML('bcIns', parts.join('<br>'));` (the last statement of `paintCard`) to:
```ts
    setHTML('bcIns', parts.join('<br>'));
    paintSolarCard(b);
```

- [ ] **Step 4: Typecheck and build**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && npm run -s check 2>&1 | tail -1 && npm run -s build 2>&1 | grep -E "error|Complete!" | head -2`
Expected: `0 errors`, `[build] Complete!`.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add src/components/ClimateEngine/HeatMapStage.astro src/scripts/climate-engine/heat-map-app.ts
git commit -m "feat(console): the rooftop-solar block on the building card, floor beside headline

Installable, yield, shaded with the tree share, the strict-mask floor, the
raised-array what-if, and worth at a tariff the reader sets and the page
remembers. Amber steps down to an ink on Clay.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The ward panel block

**Files:**
- Modify: `src/components/ClimateEngine/HeatMapStage.astro:529` (markup), `:1488` (CSS)
- Modify: `src/scripts/climate-engine/heat-map-app.ts` (after `paintSolarCard`; the call in `loadWard` after `currentWardSizeM = d.sizeM;`)

- [ ] **Step 1: Markup**

Immediately after `      <div class="histo" id="histo"></div>` insert:
```astro
      {/* ROOFTOP SOLAR, whole ward. Amber, not cyan: the heat above is CALIBRATED
          against ECOSTRESS; this is a SCREENING estimate, and the chip says so.
          Every number is the laboratory's (`totals`, `stratum` in the ward's solar
          file); the browser multiplies by the tariff and nothing else. Hidden when
          no screen ships for the area. */}
      <div class="metric sep solm" id="solm" hidden>
        <div class="k">Rooftop solar · installable, whole ward</div>
        <div class="lst sun" id="solKwp">—<span class="u">MWp</span></div>
        <div class="conf screening" id="solConf"></div>
      </div>
      <div class="mrow solm" id="solRows" hidden>
        <div><div class="k">Annual yield</div><div class="val" id="solKwh">—</div></div>
        <div><div class="k">Worth at tariff</div><div class="val sun" id="solRs">—</div></div>
        <div><div class="k">Roofs ≥ 3 kWp</div><div class="val" id="solBig">—</div></div>
        <div><div class="k">Losing ≥ 5 %, of those</div><div class="val sun" id="solSh">—</div></div>
      </div>
      <p class="solfloor" id="solFloor" hidden></p>
```

- [ ] **Step 2: CSS**

Immediately after the line beginning `  .histo{position:relative;display:flex;` add:
```css
  /* ROOFTOP SOLAR block: the heat panel's grammar in the screening ink. The
     panel ground is dark in both themes, so amber clears 4.5:1 unaided. */
  .metric.sep{border-top:1px solid var(--line)}
  .solm .lst.sun{color:var(--sun)}
  .mrow .val.sun{color:var(--sun)}
  .mrow .val small{display:block;font-family:var(--mono);font-size:.5rem;letter-spacing:.08em;text-transform:uppercase;color:var(--bronze);margin-top:2px}
  .conf.screening{background:rgb(242 181 68 /.1);border:1px solid rgb(242 181 68 /.4);color:var(--paper)}
  .conf.screening b{font-family:var(--mono);font-weight:400}
  .solfloor{margin:0;padding:0 16px 16px;font-family:var(--sans);font-size:.66rem;line-height:1.45;color:var(--sun)}
```

- [ ] **Step 3: The painter, and its call on every ward load**

In `heat-map-app.ts`, immediately after the closing `  }` of `paintSolarCard`, add:
```ts
  /* ── rooftop solar, whole ward ──
     The laboratory's totals and stratum, printed; the tariff line is the one
     product this file computes. Hidden as a block when no screen ships. */
  function paintSolarWard() {
    const pv = pvCache[state.ward];
    const show = (id: string, on: boolean) => {
      const e = el(id);
      if (!e) return;
      if (on) e.removeAttribute('hidden'); else e.setAttribute('hidden', '');
    };
    for (const id of ['solm', 'solRows', 'solFloor']) show(id, pv !== null && pv !== undefined);
    if (!pv) return;
    const t = pv.totals, s = pv.stratum, n = pv.kwp.length;
    setHTML('solKwp', `${t.capacity_mwp.toFixed(1)}<span class="u">MWp</span>`);
    setHTML('solConf', `Screening · <b>${t.capacity_mwp_range[0].toFixed(1)}–${t.capacity_mwp_range[1].toFixed(1)} MWp</b> · not bankable`);
    setHTML('solKwh', `${t.generation_gwh_yr.toFixed(1)}<small>GWh/yr · floor</small>`);
    setHTML('solRs', `${inr(t.generation_gwh_yr * 1e6 * tariff)}<small>per yr at ₹${tariff.toFixed(2)} · assumed</small>`);
    setHTML('solBig', `${s.n.toLocaleString()}<small>${Math.round(100 * s.n / n)}% of ${n.toLocaleString()} roofs</small>`);
    setHTML('solSh', `${Math.round(s.share_losing_5pct * 100)}%<small>of those roofs</small>`);
    setText('solFloor', `Shading costs ${t.shading_loss_gwh_yr.toFixed(1)} GWh a year — at least `
      + `${(t.mean_loss_strict * 100).toFixed(1)}% of yield under a strict roof mask (headline ${(t.mean_loss * 100).toFixed(1)}%).`);
  }
```
In `loadWard`, change `    currentWardSizeM = d.sizeM;` to:
```ts
    currentWardSizeM = d.sizeM;
    paintSolarWard();
```

- [ ] **Step 4: Typecheck, build, and see it on the page**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && npm run -s check 2>&1 | tail -1 && npm run -s build 2>&1 | grep -E "error|Complete!" | head -2`
Expected: `0 errors`, `[build] Complete!`.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add src/components/ClimateEngine/HeatMapStage.astro src/scripts/climate-engine/heat-map-app.ts
git commit -m "feat(console): the ward's rooftop-solar block on the right panel, laboratory numbers only

Installable MWp as the floor of the packing interval, the interval on an amber
screening chip, yield and worth, the installable-roof stratum, and one line for
the strict-mask floor.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The Solar pane — tariff, ten roofs, row → building, CSV

**Files:**
- Modify: `src/components/ClimateEngine/HeatMapStage.astro:252` (pane before Scenarios), `:818` (CSS)
- Modify: `src/components/ClimateEngine/compare/PairedBench.astro:103` (pane before Scenarios)
- Modify: `src/scripts/climate-engine/heat-map-app.ts` (after `paintSolarWard`; one line inside it; the wiring after the clock's `onFormat` listeners)

- [ ] **Step 1: The pane on the Explore route**

In `HeatMapStage.astro`, immediately before `      <div class="pane" data-pane="scenarios">` insert:
```astro
      {/* SOLAR — the consultant's deliverable: which roofs, how much, how sure.
          Painted by paintSolarPane from the ward's solar file. The tariff is an
          ASSUMPTION the reader can change and the page remembers; the list is the
          ten best roofs by yield, each row selecting its building on the map; the
          download is every roof, built in the browser on click. Gated like
          Reports: an area that ships no artefacts ships no screen. */}
      <div class="pane" data-pane="solar">
        <section class="pane-body" aria-labelledby="pane-solar-h">
          <p class="pane-h" id="pane-solar-h">Solar · <span id="solPaneArea">{scope.area.name}</span></p>
          {scope.area.hasData ? (
          <Fragment>
          <p class="pane-note" id="solPaneSum">Loading the rooftop-solar screen…</p>
          <div class="sol-tariff">
            <label for="solTariff">Tariff · assumed · change it</label>
            <span><span aria-hidden="true">₹</span><input id="solTariff" type="number" inputmode="decimal" min="0" step="0.25" value="8.00" aria-describedby="solTariffNote"> / kWh</span>
          </div>
          <p class="pane-note sol-small" id="solTariffNote">CESC domestic slabs run ₹4.07–9.21 per unit (2025-26 tariff order); a solar unit displaces the top of the bill. Not a rate we assert.</p>
          <p class="pane-h">Best roofs by annual yield</p>
          <table class="roofs" aria-label="The ten best roofs by annual yield; each row selects its building on the map">
            <thead><tr><th scope="col">#</th><th scope="col">kWp</th><th scope="col">kWh/yr</th><th scope="col">shaded</th><th scope="col">m²</th></tr></thead>
            <tbody id="solList"></tbody>
          </table>
          <p class="pane-note sol-small">Yield uses NASA POWER irradiance and a Mumbai packing factor; shading is computed from this ward's own geometry and canopy, and the mask rule is its largest uncertainty — "at least" is the strict-mask floor. Screening only, not bankable.</p>
          <a class="cta" id="solCsv" href="#" download>Download roof list · CSV ↓</a>
          </Fragment>
          ) : (
          <p class="pane-note">No solar screen ships for {scope.area.name}. The screen needs footprints, heights and canopy, and this area ships none.</p>
          )}
        </section>
      </div>
```

- [ ] **Step 2: The pane on the Compare route**

In `PairedBench.astro`, immediately before `        <div class="pane" data-pane="scenarios">` insert:
```astro
        <div class="pane" data-pane="solar">
          <section class="pane-body" aria-labelledby="pane-solar-h">
            <p class="pane-h" id="pane-solar-h">Solar</p>
            <p class="pane-note">Solar reads one ward's roofs on the map — which roofs, how much, how sure — and hands over the list. Compare draws two thermal fields and no map, so there is no roof here to click.</p>
            <a class="pane-out" href={DEFAULT_AREA_PATH}>Open the map <span aria-hidden="true">→</span></a>
          </section>
        </div>
```

- [ ] **Step 3: CSS**

In `HeatMapStage.astro`, immediately after the line `  .pane-note{font-size:.78rem;line-height:1.62;color:var(--ink)}` add:
```css
  /* THE SOLAR PANE. The sidebar ground is dark in both themes, so amber and the
     faint mono clear 4.5:1 as they do on the pane headings. */
  .sol-tariff{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--line-hi);border-radius:8px;font:400 .58rem var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink)}
  .sol-tariff span{display:flex;align-items:center;gap:4px;color:var(--sun);text-transform:none;letter-spacing:.02em;font-size:.72rem}
  .sol-tariff input{width:4.6rem;font:400 .8rem var(--mono);color:var(--paper);background:var(--surface);border:1px solid var(--line-hi);border-radius:6px;padding:3px 6px}
  .sol-tariff input:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
  .sol-small{font-size:.66rem}
  .roofs{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:.64rem}
  .roofs th{text-align:right;font-weight:400;font-size:.46rem;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);padding:0 0 6px;border-bottom:1px solid var(--line-hi)}
  .roofs th:first-child,.roofs td:first-child{text-align:left}
  .roofs td{padding:6px 0;border-bottom:1px solid var(--line);text-align:right;color:var(--paper);white-space:nowrap}
  .roofs td.id{color:var(--cyan)} .roofs td.sh{color:var(--sun)} .roofs td.sh.z{color:var(--faint)} .roofs td.a{color:var(--ink)}
  /* a single footprint over a hectare is a market shed or a merged record — bronze, so it reads as one */
  .roofs tr.big td{color:var(--bronze)}
  .roofs tbody tr{cursor:pointer} .roofs tbody tr:hover td{color:var(--paper)}
  .roofs tbody tr:focus-visible{outline:2px solid var(--cyan);outline-offset:-2px}
```

- [ ] **Step 4: The pane painter, the rows, the CSV, the tariff**

In `heat-map-app.ts`, inside `paintSolarWard`, change the line `    if (!pv) return;` to `    if (!pv) { paintSolarPane(null); return; }` and add, as the LAST statement of `paintSolarWard` (after the `setText('solFloor', …)` statement): `    paintSolarPane(pv);`.

Immediately after the closing `  }` of `paintSolarWard`, add:
```ts
  /* ── the Solar pane ──
     The ten best roofs by yield, each row a building on the map; the download is
     every roof. The CSV is built on first click and the object URL is dropped on
     the next ward load or tariff change, so a stale list can never be handed
     over under a fresh number. */
  let csvUrl: string | null = null;
  function dropCsv() { if (csvUrl) { URL.revokeObjectURL(csvUrl); csvUrl = null; } }
  function areaName(): string { return (wardOf(state.ward)?.name ?? state.ward).replace(/<[^>]+>/g, ''); }
  function paintSolarPane(pv: PvFile | null) {
    dropCsv();
    setText('solPaneArea', areaName());
    const sum = el('solPaneSum'), list = el('solList'), link = el('solCsv') as HTMLAnchorElement | null;
    if (!sum || !list || !link) return;
    if (!pv) {
      sum.textContent = `No solar screen ships for ${areaName()}.`;
      list.innerHTML = '';
      link.setAttribute('hidden', '');
      return;
    }
    const t = pv.totals, s = pv.stratum, n = pv.kwp.length;
    sum.innerHTML = `<b>${t.capacity_mwp.toFixed(1)} MWp</b> installable across <b>${n.toLocaleString()}</b> real roofs, `
      + `the floor of a <b>${t.capacity_mwp_range[0].toFixed(1)}–${t.capacity_mwp_range[1].toFixed(1)} MWp</b> interval. `
      + `<b>${Math.round(s.share_losing_5pct * 100)}%</b> of the roofs that could carry 3 kWp or more lose at least 5% of their yield to shade. `
      + `Shading takes <b>${(t.mean_loss * 100).toFixed(1)}%</b> of the ward's yield — <b>at least ${(t.mean_loss_strict * 100).toFixed(1)}%</b> `
      + `under a strict roof mask; trees are <b>${(t.mean_loss_trees * 100).toFixed(1)} points</b> of it.`;
    const order = [...pv.kwh.keys()].sort((a, b) => pv.kwh[b] - pv.kwh[a]).slice(0, 10);
    list.innerHTML = order.map((i) => {
      const meta = registry.find((b) => b.idx === i);
      const area = meta ? Math.round(meta.areaM2) : 0;
      const L = pv.loss[i];
      return `<tr tabindex="0" data-idx="${i}"${area > 10_000 ? ' class="big"' : ''}>`
        + `<td class="id">#${i}</td><td>${pv.kwp[i].toFixed(0)}</td><td>${Math.round(pv.kwh[i]).toLocaleString()}</td>`
        + `<td class="sh${L < 0.005 ? ' z' : ''}">${L < 0.005 ? '—' : `−${Math.round(L * 100)}%`}</td>`
        + `<td class="a">${area.toLocaleString()}</td></tr>`;
    }).join('');
    link.removeAttribute('hidden');
    link.download = `solar-${areaOf(state.ward)}.csv`;
    link.href = '#';
  }
  function buildCsv(pv: PvFile): string {
    const w = wardOf(state.ward);
    const byIdx = new Map(registry.map((b) => [b.idx, b] as const));
    const rows = ['idx,lat,lon,footprint_m2,kwp,kwh_yr,loss,loss_buildings,loss_trees,loss_strict,loss_raised,worth_inr_yr,tariff_inr_kwh,basis'];
    for (let i = 0; i < pv.kwp.length; i += 1) {
      const b = byIdx.get(i);
      const ll = b ? wardLatLon(w, b.cx, b.cz) : null;
      rows.push([
        i, ll ? ll.lat.toFixed(5) : '', ll ? ll.lon.toFixed(5) : '', b ? Math.round(b.areaM2) : '',
        pv.kwp[i], pv.kwh[i], pv.loss[i], pv.loss_buildings[i], pv.loss_trees[i], pv.loss_strict[i], pv.loss_raised[i],
        Math.round(pv.kwh[i] * tariff), tariff.toFixed(2), i === 0 ? `"${pv.basis.replace(/"/g, '""')}"` : '',
      ].join(','));
    }
    return `${rows.join('\n')}\n`;
  }
  const onCsv = (e: Event) => {
    const link = e.currentTarget as HTMLAnchorElement;
    const pv = pvCache[state.ward];
    if (!pv) { e.preventDefault(); return; }
    if (!csvUrl) csvUrl = URL.createObjectURL(new Blob([buildCsv(pv)], { type: 'text/csv;charset=utf-8' }));
    link.href = csvUrl;             // the default action follows with the real URL
  };
  const onRow = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-idx]');
    if (!tr) return;
    e.preventDefault();
    const b = registry.find((x) => x.idx === Number(tr.dataset.idx));
    if (b) select(b);
  };
  const tariffInput = el('solTariff') as HTMLInputElement | null;
  if (tariffInput) tariffInput.value = tariff.toFixed(2);
  const onTariff = () => {
    const v = Number(tariffInput?.value);
    if (!Number.isFinite(v) || v <= 0) return;
    tariff = v;
    try { localStorage.setItem(TARIFF_KEY, String(v)); } catch { /* preference is transient */ }
    dropCsv();
    paintSolarWard();
    if (selected) paintSolarCard(selected);
  };
  el('solCsv')?.addEventListener('click', onCsv);
  el('solList')?.addEventListener('click', onRow);
  el('solList')?.addEventListener('keydown', onRow);
  tariffInput?.addEventListener('input', onTariff);
  cleanup.push(() => {
    el('solCsv')?.removeEventListener('click', onCsv);
    el('solList')?.removeEventListener('click', onRow);
    el('solList')?.removeEventListener('keydown', onRow);
    tariffInput?.removeEventListener('input', onTariff);
    dropCsv();
  });
```
`paintSolarPane`, `select`, `registry`, `wardOf`, `areaOf`, `wardLatLon`, `cleanup`, `selected` all exist in this scope already; the functions are declarations and hoist, so `paintSolarWard` may call `paintSolarPane` before its text position.

- [ ] **Step 4b: The rail's own prose stops saying five**

In `src/components/ClimateEngine/shell/IconRail.astro`'s header comment (found by the review of Task 1): change "two of the five places the rail can take you" to "two of the six places the rail can take you"; add Solar to the prose list of sections (after Analysis: `Solar      swaps the sidebar pane: the ward's roofs ranked, each row a building on the map`); change "Two of the five change the URL and four of them change what the sidebar shows" to "Two of the six change the URL and five of them change what the sidebar shows"; and in the grouping paragraph change "the five" / "Five rows do not need to be grouped" to "the six" / "Six rows do not need to be grouped". Leave the historical "five glyphs whose only labels were tooltips" alone: it describes the rail this one replaced.

- [ ] **Step 5: Typecheck, build, then the unit suite (the harness's pane checks now have their pane)**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && npm run -s check 2>&1 | tail -1 && npm run -s build 2>&1 | grep -E "error|Complete!" | head -2 && npm run -s test:unit 2>&1 | grep -E "ℹ (pass|fail)"`
Expected: `0 errors`, `[build] Complete!`, `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add src/components/ClimateEngine/HeatMapStage.astro src/components/ClimateEngine/compare/PairedBench.astro src/scripts/climate-engine/heat-map-app.ts
git commit -m "feat(console): the Solar pane — an assumed tariff, ten roofs that select their building, a CSV of every roof

The tariff is remembered like the clock format and repaints every rupee figure.
Rows over a hectare render in bronze. Compare says why it has no roof to click.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Tests — the wiring by source, the screen on the real page, the studio gate

**Files:**
- Modify: `tests/unit/obos-shell.test.mjs` (append)
- Create: `tests/e2e/solar-pane.spec.ts`

- [ ] **Step 1: Source assertions**

Append to `tests/unit/obos-shell.test.mjs`:
```js

test('the solar screen is wired end to end and never prints a headline without its floor', async () => {
  /* Source assertions, the harness's idiom: the card block is painted only when a
     building is selected on a WebGL canvas the software renderer cannot reliably
     click, so the wiring is pinned here and the page test reaches the card
     through a ranked row instead. */
  const stage = await readFile(new URL('../../src/components/ClimateEngine/HeatMapStage.astro', import.meta.url), 'utf8');
  const bench = await readFile(new URL('../../src/components/ClimateEngine/compare/PairedBench.astro', import.meta.url), 'utf8');
  const app = await readFile(new URL('../../src/scripts/climate-engine/heat-map-app.ts', import.meta.url), 'utf8');
  const paths = await readFile(new URL('../../src/scripts/climate-engine/scope/paths.ts', import.meta.url), 'utf8');
  for (const [name, src] of [['HeatMapStage', stage], ['PairedBench', bench]]) {
    assert.match(src, /data-pane="solar"/,
      `${name} renders no Solar pane -- the rail section is 'always', so a route without the pane shows a button that opens nothing`);
  }
  assert.match(paths, /pv:\s*`\$\{DATA\}pv-\$\{area\}\.json`/, 'paths.ts names no solar file');
  assert.match(app, /pvCache\[name\] = asPvFile\(pvRaw, d\.b\.length\)/,
    'the ward loader does not validate the solar file against the building count -- '
    + "a wrong-ward file would hand every roof a stranger's figures");
  assert.match(app, /pv\.loss_strict\[i\]/,
    'the card does not print the strict-mask floor -- the mask rule is the largest lever and the headline must never print alone');
  assert.match(app, /mean_loss_strict/, 'the ward panel and pane do not print the strict-mask floor');
  assert.match(app, /paintSolarCard\(b\)/, 'paintCard does not paint the solar block');
  assert.match(app, /localStorage\.setItem\(TARIFF_KEY/, 'the tariff is not remembered');
  assert.doesNotMatch(stage + bench + app, /payback/i,
    'a payback figure has no place here: it needs capex and subsidy assumptions, and that is where liability lives');
});
```

- [ ] **Step 1b: Two titles that stopped being true in Task 1**

In `tests/unit/obos-shell.test.mjs` change the test title `'the rail carries the mode: two sections navigate, three swap the pane'` to `'the rail carries the mode: two sections navigate, four swap the pane'`, and in the comment beneath it change "Layers, Reports
     and Scenarios swap the sidebar pane" to "Layers, Solar, Reports
     and Scenarios swap the sidebar pane" (match the existing line breaks). In `tests/e2e/heat-map-compare.spec.ts`, the test titled "every rail section opens a body that says what it holds here" iterates a hardcoded `['layers', 'reports', 'scenarios']`: add `'solar'` so the title stays true now that Compare renders a Solar body.

- [ ] **Step 2: Run the unit suite**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && npm run -s test:unit 2>&1 | grep -E "ℹ (pass|fail)"`
Expected: `ℹ fail 0`, pass count one higher than before.

- [ ] **Step 3: The page test**

Create `tests/e2e/solar-pane.spec.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

/* THE SOLAR SCREEN ON THE REAL PAGE. The panel and the pane render from the ward
   file, so they are asserted directly; the card is reached through a ranked row,
   because no test can reliably click a building on the software renderer. The
   floor is asserted wherever the headline is: that is the one claim the design
   makes about itself. */
const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';
const HEADER = 'idx,lat,lon,footprint_m2,kwp,kwh_yr,loss,loss_buildings,loss_trees,loss_strict,loss_raised,worth_inr_yr,tariff_inr_kwh,basis';

test.describe('the solar screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BALLYGUNGE);
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 30_000 });
  });

  test('the ward panel prints the floor beside the headline', async ({ page }) => {
    await expect(page.locator('#solKwp')).toHaveText(/\d+\.\d\s*MWp/, { timeout: 15_000 });
    await expect(page.locator('#solConf')).toContainText('Screening');
    await expect(page.locator('#solFloor')).toContainText('strict roof mask');
  });

  test('the Solar pane ranks ten roofs, remembers the tariff, and hands over every roof', async ({ page }) => {
    await page.locator('[data-rail="solar"]').click();
    await expect(page.locator('.pane[data-pane="solar"]')).toHaveClass(/is-on/);
    await expect(page.locator('#solList tr')).toHaveCount(10, { timeout: 15_000 });
    await expect(page.locator('#solPaneSum')).toContainText('MWp');
    await expect(page.locator('#solPaneSum')).toContainText('strict roof mask');

    const before = await page.locator('#solRs').innerText();
    await page.locator('#solTariff').fill('10');
    await expect(page.locator('#solRs')).not.toHaveText(before);
    await expect(page.locator('#solRs')).toContainText('₹10.00');
    await page.reload();
    await expect(page.locator('#lst')).not.toContainText('—', { timeout: 30_000 });
    await expect(page.locator('#solTariff')).toHaveValue('10.00');

    await page.locator('[data-rail="solar"]').click();
    await expect(page.locator('#solList tr')).toHaveCount(10, { timeout: 15_000 });
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#solCsv').click()]);
    expect(download.suggestedFilename()).toBe('solar-ballygunge.csv');
    const text = await readFile((await download.path()) as string, 'utf8');
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines.length).toBe(1 + 3527);           // one row per Ballygunge building
    expect(lines[1].split(',')[12]).toBe('10.00'); // the tariff the reader set
  });

  test('a ranked row selects its building, and the card prints the floor', async ({ page }) => {
    await page.locator('[data-rail="solar"]').click();
    await expect(page.locator('#solList tr')).toHaveCount(10, { timeout: 15_000 });
    const row = page.locator('#solList tr').first();
    const idx = await row.getAttribute('data-idx');
    await row.click();
    await expect(page.locator('#bcard')).toBeVisible();
    await expect(page.locator('#bcId')).toHaveText(`#${idx}`);
    await expect(page.locator('#bcSol')).toBeVisible();
    await expect(page.locator('#bcSolFloor')).toContainText('strict roof mask');
    await expect(page.locator('#bcSolRs')).toContainText('assumed');
  });
});
```

- [ ] **Step 4: Build and run the new spec, the routing suite and the studio contrast gate**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && npm run -s build 2>&1 | grep -E "error|Complete!" | head -2 && npx playwright test tests/e2e/solar-pane.spec.ts tests/e2e/console-contrast.spec.ts tests/e2e/heat-map-routing.spec.ts --project=chromium-tier0 --reporter=line 2>&1 | grep -E "passed|failed|flaky|✘|Error:" | head -12`
Expected: all passed, none failed. If the contrast gate lists a new selector, the offending colour is named in its report: fix the CSS in Task 3/5 (never the gate) and rerun.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add tests/unit/obos-shell.test.mjs tests/e2e/solar-pane.spec.ts
git commit -m "test(console): the solar screen — wiring by source, the screen on the real page

Panel and pane asserted directly; the card reached through a ranked row; the
floor asserted wherever the headline is; the CSV has one row per building and
carries the tariff the reader set.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Docs, the full gate, push, CI

**Files:**
- Modify: `docs/evidence/known-limitations.md` (the 2026-09-05 addendum's "A gap for whoever builds the card" paragraph)

- [ ] **Step 1: Close the gap in the limitations note**

In `docs/evidence/known-limitations.md`, replace the paragraph beginning `> **A gap for whoever builds the card.**` (through `overstating what was measured.`) with:
```markdown
> **The card prints the floor (closed 2026-09-06).** The console's Solar section, card block and
> ward-panel block (spec `docs/superpowers/specs/2026-09-05-solar-console-design.md`) read
> `loss_strict` and print "at least X % under a strict roof mask" wherever the headline appears,
> with the tariff shown as an assumption the reader can change. The eight-cell table still lives
> only in `data/calibration/pv-shading-trees-<ward>.json`.
```

- [ ] **Step 2: The whole gate**

Run: `cd /Volumes/VSTSAMPLES/Projects/angad-built && npm run verify 2>&1 | tail -6`
Expected: every stage green, the built e2e suite passing. Budget 20 minutes.

- [ ] **Step 3: Commit, push with the exFAT recipe, watch CI**

```bash
cd /Volumes/VSTSAMPLES/Projects/angad-built
git add docs/evidence/known-limitations.md
git commit -m "docs(evidence): the card prints the floor — the band gap closes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git update-index -q --refresh; git fetch -q origin; git rebase -q origin/main
git push -q origin HEAD:main
sleep 25; gh run list --branch main --limit 1 --json databaseId,status,headSha -q '.[]|"\(.databaseId) \(.status) \(.headSha[0:7])"'
```
Then `gh run watch <id> --exit-status --interval 30` (in the background; the job takes ~18 minutes under a 30-minute limit). Expected: `success`.

- [ ] **Step 4: Report**

Say what is live: the Solar section, the card block, the panel block; that the floor prints in all three places; the tariff default and where it is remembered; the CSV's shape; and the two things still open — the tariff figure itself, and that the ranked row selects but does not fly the camera to its building.

---

## Self-review against the spec

- **§2.1 rail section, always-pane** → Task 1 (rail + harness pin), Task 5 (both routes' panes). ✓
- **§2.2 card block under the measured rows, bronze provenance** → Task 3. ✓
- **§2.3 panel block, amber chip** → Task 4. ✓
- **§2.4 floor wherever the headline is** → card (`bcSolFloor`, Task 3), panel (`solFloor`, Task 4), pane summary (Task 5); asserted in Task 6 in all three. ✓
- **§2.5 tariff assumed, labelled, remembered (`delta:hm-tariff`)** → Task 3 (store), Task 5 (control + note + repaint). ✓
- **§2.6 no payback** → Task 6 source assertion. ✓
- **§2.7 no physics/artefact change** → nothing in the plan touches `scripts/` or `data/`. ✓
- **§3 data: `pv` path, `PvFile`, lazy fetch, `pvCache`, length validation with a warning** → Task 2. ✓
- **§4 card rows and notes** → Task 3, ids `bcSolKwp/Kwh/Loss/Floor/Raised/Rs`. ✓
- **§5 panel rows from `totals`/`stratum`, chip with the interval, floor line** → Task 4. ✓
- **§6 pane: summary, tariff control + band note, ten rows with area and bronze over 10,000 m², row → `select`, honesty note, CSV with the named columns, no-data body, Compare body** → Task 5. ✓ (The camera does not fly to a selected row; the spec asks only that the row selects.)
- **§7 files** → each named file has a task; `console-shell.ts` untouched as the spec says. ✓
- **§9 verification: unit, e2e, contrast gate, verify, CI, preview** → Tasks 6–7 (the preview was refreshed before the plan and is the visual baseline). ✓
- **Type consistency:** `PvFile` fields used in Tasks 3–5 match Task 2's interface (`kwp, kwh, loss, loss_trees, loss_raised, loss_strict, packing_factor, specific_yield, basis, totals.{capacity_mwp, capacity_mwp_range, generation_gwh_yr, shading_loss_gwh_yr, mean_loss, mean_loss_strict, mean_loss_trees}, stratum.{n, share_losing_5pct}`); `paintSolarCard(b: BuildingMeta)`, `paintSolarWard()`, `paintSolarPane(pv: PvFile | null)`, `buildCsv(pv: PvFile)`, `inr`, `pct`, `tariff`, `TARIFF_KEY`, `csvUrl`, `dropCsv`, `areaName` — same names throughout; ids in markup match the ids the painters and tests use. ✓
- **Placeholders:** none.
