# New-city badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dismissible bronze badge in the top-left of the OBOS map frame that names a recently added city and links to its twin, so a reader who lands on Kolkata discovers Bengaluru.

**Architecture:** One pure module holds both decisions — is a city new, and where does it open — with the clock and the storage injected so every branch is testable without a browser. `HeatMapStage.astro` renders the markup and owns the CSS (that file's documented no-`<style>` rule for the console's furniture); `console-shell.ts` wires the dismiss button through its existing `on()`/cleanup contract.

**Tech Stack:** Astro 5 components, TypeScript (strict), `node --import tsx --test` for unit tests, Playwright for the browser test.

**Spec:** `docs/superpowers/specs/2026-09-16-new-city-badge-design.md` (approved 2026-09-16).

---

## Facts this plan rests on (verified 2026-09-16, file:line)

| Fact | Where |
|---|---|
| `--bronze:#b08d57` | `src/components/ClimateEngine/HeatMapStage.astro:833` |
| The console's existing solid-bronze surface: `background:var(--bronze);color:#0d0a05;border:0` | `HeatMapStage.astro:2007` (`.cta`) |
| Insertion anchor, unique in the file: `<div class="loadchip" id="loadchip"></div>` | `HeatMapStage.astro:384` |
| Top-left of `.map` is free: `.synthetic` is `top:20px` centred, `.loadchip` `top:118px` centred, `.place` `left:50%;top:34%`, `.compass` `left:26px;bottom:26px`, `.sunline` `left:26px;bottom:104px` | `HeatMapStage.astro:1754, 1792, 1713, 1108, 1140` |
| The scene auto-orbits forever, pausing 2.5 s after interaction | `heat-map-app.ts:403` |
| `mountConsoleShell()` returns a disposer and owns `on(node, ev, fn)`, which pushes its own removal onto `cleanup` | `shell/console-shell.ts:97` |
| It is mounted by dynamic import from the area page | `src/pages/heat-map/[country]/[city]/[area].astro:98-99` |
| `defaultStore()` is PRIVATE; the module argues against duplicating it | `shell/layout-state.ts:87-93, 100-102` |
| Storage keys are namespaced `obos:` | `shell/layout-state.ts:44-45` |
| `ResolvedScope.city.id` exists | `scope/resolve.ts:175, 363` |
| `hasData` IS the registry's `drawable`; `publishes` is `shipsData` | `scope/resolve.ts:368-369` |
| `CityRecord` holds a city's facts | `src/data/cities.ts:70-77` |
| `areaPath(key)` builds `/heat-map/<country>/<city>/<area>/` | `scope/paths.ts:111-114` |
| `AREA_KEYS` is every registered key, in declaration order | `scope/registry.ts:412` |
| Bengaluru's areas, in declaration order: `indiranagar`, `mg-road`, `whitefield`, all `drawable: true`, all `shipsData: false` | `scope/registry.ts:212-214` |
| An `.astro` component cannot be imported in unit tests — they are SOURCE assertions | `tests/unit/obos-shell.test.mjs:26-40` |

**Why the destination is derived, not typed.** `drawableAreaIds()` flattens ids across the whole registry and `areaKeysInCity()` needs a key you already have, so neither answers "an openable area in city X". Task 2 writes that function.

**MG Road is the destination** because the spec asks for the landmark ward. Bengaluru declares `indiranagar` first, so "first drawable area" would pick the wrong one — the advertised area is therefore named in the city record (Task 1), not inferred from order.

---

## File structure

| File | Responsibility |
|---|---|
| Modify `src/data/cities.ts` | `CityRecord` gains `since` and `showcase`: when the city became reachable, and which ward best represents it. |
| Modify `src/scripts/climate-engine/shell/layout-state.ts` | Export the existing `defaultStore()` so one store accessor serves both features. |
| Create `src/scripts/climate-engine/shell/new-city.ts` | Pure rules: which city is new, where it opens, whether it was dismissed. No DOM. |
| Modify `src/components/ClimateEngine/HeatMapStage.astro` | Render the badge in `.map`; its CSS in the `is:global` block. |
| Modify `src/scripts/climate-engine/shell/console-shell.ts` | Wire the dismiss button through the existing `on()` helper. |
| Create `tests/unit/obos-new-city.test.mjs` | The module's behaviour, plus source assertions on the markup and CSS. |
| Create `tests/e2e/heat-map-new-city.spec.ts` | The badge in a browser: present on Kolkata, absent on Bengaluru, dismissal survives reload. |

---

### Task 1: The city record learns two facts

**Files:**
- Modify: `src/data/cities.ts:70-77` (the `CityRecord` interface) and `src/data/cities.ts:124-130` (the `CITIES` map)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/obos-new-city.test.mjs` with exactly this:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { CITIES } from '../../src/data/cities.ts';

/**
 * THE CITY RECORD CARRIES WHEN IT ARRIVED, AND WHAT TO SHOW.
 *
 * `since` is the date a city became reachable in production. The badge's window
 * is measured from it, so the announcement retires itself rather than living as
 * copy someone must remember to delete. `showcase` names the ward worth opening
 * first: Bengaluru declares indiranagar first in the registry, so "the first
 * drawable area" would send a reader somewhere the city is not at its best.
 */
test('Bengaluru declares when it arrived and which ward represents it', () => {
  const blr = CITIES.bengaluru;
  assert.ok(blr, 'the registry has no bengaluru city record');
  assert.match(blr.since ?? '', /^\d{4}-\d{2}-\d{2}$/,
    `bengaluru.since must be an ISO date, got ${JSON.stringify(blr.since)}`);
  assert.equal(blr.showcase, 'mg-road',
    'MG Road is the ward with the citable landmarks (Vidhana Soudha, UB Tower)');
  assert.ok(blr.wards.some((w) => w.id === blr.showcase),
    `bengaluru.showcase "${blr.showcase}" is not one of its wards`);
});

test('Kolkata declares no arrival date, so it is never announced as new', () => {
  assert.equal(CITIES.kolkata.since, undefined,
    'Kolkata predates the badge; a date here would advertise the city the reader is already in');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test tests/unit/obos-new-city.test.mjs`
Expected: FAIL — `bengaluru.since must be an ISO date, got undefined`.

- [ ] **Step 3: Add the two fields**

In `src/data/cities.ts`, inside `export interface CityRecord`, after `readonly cellMeters: number;`, add:

```ts
  /**
   * The day this city became reachable in production, ISO `YYYY-MM-DD`.
   *
   * ABSENT MEANS ESTABLISHED, not unknown. The new-city badge measures its window
   * from this date and stops announcing the city when the window passes, so the
   * announcement expires on its own rather than as a line of copy somebody has to
   * remember to delete. Kolkata has none because it has always been here.
   */
  readonly since?: string;
  /**
   * The ward to open when the city is announced, by ward id.
   *
   * NOT "the first one". Bengaluru declares indiranagar first and its landmarks
   * are in MG Road; a reader who follows an announcement should land where the
   * city is recognisable.
   */
  readonly showcase?: string;
```

Then in `export const CITIES`, change the bengaluru entry to:

```ts
  bengaluru: { id: 'bengaluru', name: 'Bengaluru', country: 'India',
    cellMeters: declaredCellMeters(BENGALURU_WARDS), wards: BENGALURU_WARDS,
    since: '2026-09-16', showcase: 'mg-road' },
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test tests/unit/obos-new-city.test.mjs`
Expected: `pass 2`, `fail 0`.

- [ ] **Step 5: Mutation proof**

Change `showcase: 'mg-road'` to `showcase: 'whitefield'`; the second assertion must fail. Change it back. Then change `since` to `'16-09-2026'`; the date assertion must fail. Change it back. Paste both FAIL lines and the restored PASS.

- [ ] **Step 6: Gates and commit**

Run: `npm run check`
Expected: `0 errors`.

```bash
git add src/data/cities.ts tests/unit/obos-new-city.test.mjs
git commit -m "feat(obos): a city record says when it arrived and which ward shows it best

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The pure rules module

**Files:**
- Modify: `src/scripts/climate-engine/shell/layout-state.ts:87-93`
- Create: `src/scripts/climate-engine/shell/new-city.ts`
- Modify: `tests/unit/obos-new-city.test.mjs`

- [ ] **Step 1: Export the store accessor**

In `src/scripts/climate-engine/shell/layout-state.ts`, change line 87 from `function defaultStore()` to:

```ts
export function defaultStore(): LayoutStore | null {
```

Leave its body and docblock untouched. (The file already argues the case at lines 100-102: "the copy that gets a fix is never both of them".)

- [ ] **Step 2: Write the failing tests**

Append to `tests/unit/obos-new-city.test.mjs`:

```js
import {
  NEW_CITY_DAYS,
  newCityKey,
  newCityToAnnounce,
  wasDismissed,
  rememberDismissed,
} from '../../src/scripts/climate-engine/shell/new-city.ts';

/** A store that records writes, like the ones obos-shell.test.mjs uses. */
const fakeStore = (seed = {}) => {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
};

/** A store that throws on both halves — a private window, or blocked site data. */
const hostileStore = () => ({
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('SecurityError'); },
});

const DAY = 86_400_000;
const ARRIVED = Date.parse('2026-09-16T00:00:00Z');

test('a city inside the window is announced, and names its showcase ward', () => {
  const found = newCityToAnnounce('kolkata', new Date(ARRIVED + 3 * DAY), fakeStore());
  assert.equal(found?.id, 'bengaluru');
  assert.equal(found?.name, 'Bengaluru');
  assert.equal(found?.href, '/heat-map/in/bengaluru/mg-road/');
});

test('the window is ninety days: a city 89 days old is still announced, 91 days old is not', () => {
  /* LITERALS ON PURPOSE. Deriving the boundary from NEW_CITY_DAYS makes the
     constant cancel out of its own guard: cutoff lands one day after arrival for
     D = 1, 90 or 90_000 alike, so every value passes and the ninety is pinned by
     nothing. Two literal days either side pin the number and the comparison. */
  const store = fakeStore();
  assert.equal(newCityToAnnounce('kolkata', new Date(ARRIVED + 89 * DAY), store)?.id, 'bengaluru',
    'a city 89 days old is inside a ninety-day window');
  assert.equal(newCityToAnnounce('kolkata', new Date(ARRIVED + 91 * DAY), store), null,
    'a city 91 days old is outside it, and the badge retires itself');
  assert.equal(NEW_CITY_DAYS, 90,
    'the two day counts above are written against a ninety-day window');
});

test('the reader is never told about the city they are already in', () => {
  const when = new Date(ARRIVED + DAY);
  assert.equal(newCityToAnnounce('bengaluru', when, fakeStore()), null);
});

test('a dismissed city stays dismissed, and only that city', () => {
  const store = fakeStore();
  const when = new Date(ARRIVED + DAY);
  assert.equal(newCityToAnnounce('kolkata', when, store)?.id, 'bengaluru');
  rememberDismissed('bengaluru', store);
  assert.equal(wasDismissed('bengaluru', store), true);
  assert.equal(wasDismissed('someplace-else', store), false);
  assert.equal(newCityToAnnounce('kolkata', when, store), null);
});

test('the key is namespaced like every other preference this console stores', () => {
  assert.equal(newCityKey('bengaluru'), 'obos:new-city:bengaluru');
});

test('an unreadable store shows the badge rather than swallowing it', () => {
  const when = new Date(ARRIVED + DAY);
  assert.equal(newCityToAnnounce('kolkata', when, hostileStore())?.id, 'bengaluru');
  assert.equal(wasDismissed('bengaluru', hostileStore()), false);
  assert.doesNotThrow(() => rememberDismissed('bengaluru', hostileStore()));
});

test('a null store is the same as no store, never a crash', () => {
  const when = new Date(ARRIVED + DAY);
  assert.equal(newCityToAnnounce('kolkata', when, null)?.id, 'bengaluru');
  assert.doesNotThrow(() => rememberDismissed('bengaluru', null));
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `node --import tsx --test tests/unit/obos-new-city.test.mjs`
Expected: FAIL — cannot find module `new-city.ts`.

- [ ] **Step 4: Write the module**

Create `src/scripts/climate-engine/shell/new-city.ts`:

```ts
/**
 * WHICH CITY IS NEW, AND WHERE IT OPENS.
 *
 * A reader who follows any front door lands on one Kolkata ward
 * (`DEFAULT_AREA` in scope/registry.ts), and Bengaluru is reachable only as an
 * unlabelled option inside a collapsible select. Its pages are deliberately
 * `noindex` until a catalogue record exists, so search cannot find it either.
 * This module decides what the console should say about that.
 *
 * PURE, AND BOTH INPUTS INJECTED. The clock is a parameter because a test that
 * waits ninety days is not a test, and the store is a parameter because reading
 * `localStorage` THROWS on a document with site data blocked — see layout-state.ts,
 * whose accessor this reuses rather than copies.
 */
import { CITIES } from '../../../data/cities.ts';
import { areaPath } from '../scope/paths.ts';
import { AREA_KEYS, isDrawable, splitKey, type AreaKey } from '../scope/registry.ts';
import { defaultStore, type LayoutStore } from './layout-state.ts';

/** How long a city counts as new, in days. */
export const NEW_CITY_DAYS = 90;

/**
 * When a city arrived, in epoch milliseconds, or NaN if it declares no usable date.
 *
 * EXPORTED SO THE TEST AND THE CONSUMER CANNOT DRIFT. The `Z` is load-bearing:
 * `Date.parse('2026-09-16T00:00:00')` is local time, which at UTC+14 is fourteen
 * hours early and round-trips to the fifteenth — a whole day at the window's edge.
 * Two copies of this concatenation is two chances to lose the Z, so there is one.
 *
 * NaN IS THE SILENT CASE, and deliberately so: a city that declares no date, or a
 * malformed one, is never announced rather than wrongly announced. A forgotten
 * field costs an opportunity; a wrong one puts a lie on screen.
 */
export function arrivedMs(city: { readonly since?: string }): number {
  return city.since ? Date.parse(`${city.since}T00:00:00Z`) : NaN;
}

/** What the badge needs to render itself, and nothing more. */
export interface NewCity {
  readonly id: string;
  readonly name: string;
  readonly href: string;
}

/** Namespaced like `obos:rail` and `obos:panel`, one key per city. */
export function newCityKey(cityId: string): string {
  return `obos:new-city:${cityId}`;
}

/**
 * The area to open for a city: its declared showcase when that area can actually
 * be drawn, else the first drawable one.
 *
 * DERIVED, NEVER TYPED. A hard-coded URL survives a ward rename and a
 * `drawable: false`, and the reader is the one who finds out.
 */
function openableAreaKey(cityId: string): AreaKey | null {
  const inCity = AREA_KEYS.filter((key) => splitKey(key).city === cityId);
  const drawable = inCity.filter((key) => {
    const { country, city, area } = splitKey(key);
    return isDrawable(country, city, area);
  });
  const showcase = CITIES[cityId]?.showcase;
  const preferred = drawable.find((key) => splitKey(key).area === showcase);
  return preferred ?? drawable[0] ?? null;
}

/** TRUE only when this store says this city was dismissed. Anything else is false. */
export function wasDismissed(cityId: string, store: LayoutStore | null = defaultStore()): boolean {
  try {
    return store?.getItem(newCityKey(cityId)) === 'dismissed';
  } catch {
    return false;
  }
}

/** Remember it, or fail to and carry on: the badge is already off the screen. */
export function rememberDismissed(cityId: string, store: LayoutStore | null = defaultStore()): void {
  try {
    store?.setItem(newCityKey(cityId), 'dismissed');
  } catch {
    /* the preference is a convenience; the reader's click already took effect */
  }
}

/**
 * The city worth announcing to a reader standing in `openCityId`, or null.
 *
 * The most recent arrival wins, so two cities landing in one quarter still
 * produce one badge rather than a row of them.
 */
export function newCityToAnnounce(
  openCityId: string,
  now: Date = new Date(),
  store: LayoutStore | null = defaultStore(),
): NewCity | null {
  const cutoff = now.getTime() - NEW_CITY_DAYS * 86_400_000;
  const candidates = Object.values(CITIES)
    .filter((city) => city.id !== openCityId)
    .filter((city) => {
      const since = arrivedMs(city);
      return Number.isFinite(since) && since > cutoff && since <= now.getTime();
    })
    .filter((city) => !wasDismissed(city.id, store))
    .sort((a, b) => arrivedMs(b) - arrivedMs(a));

  for (const city of candidates) {
    const key = openableAreaKey(city.id);
    if (key) return { id: city.id, name: city.name, href: areaPath(key) };
  }
  return null;
}
```

- [ ] **Step 5: Run them and watch them pass**

Run: `node --import tsx --test tests/unit/obos-new-city.test.mjs`
Expected: `fail 0`.

Note: if `isDrawable` or `splitKey` is not exported from `scope/registry.ts`, export it there rather than re-deriving the logic here, and say so in your report.

- [ ] **Step 5b: Point Task 1's date test at the shared parse**

`tests/unit/obos-new-city.test.mjs` parses the arrival date itself, and `new-city.ts` now exports `arrivedMs` for exactly that reason: two copies of `` `${since}T00:00:00Z` `` are two chances for one of them to lose the `Z`, and a local-time parse is fourteen hours early at UTC+14 — a whole day at the window's edge.

In that test file, add `arrivedMs` to the `new-city.ts` import, then inside the date loop replace:

```js
    const t = Date.parse(`${city.since}T00:00:00Z`);
```

with:

```js
    const t = arrivedMs(city);
```

Leave every assertion, the `checked` counter and the messages exactly as they are. Re-run the file: still passing, same count.

**Mutation proof:** temporarily drop the `Z` inside `arrivedMs` (`Date.parse(\`${city.since}T00:00:00\`)`) and run with `TZ=Pacific/Kiritimati node --import tsx --test tests/unit/obos-new-city.test.mjs` — the round-trip assertion must fail, reporting `2026-09-15`. Restore the `Z` and show it passing under the same `TZ`.

- [ ] **Step 6: Mutation proofs (paste each FAIL, then the restored PASS)**

1. In `newCityToAnnounce`, delete the `.filter((city) => city.id !== openCityId)` line — "the reader is never told about the city they are already in" must fail.
2. Change `NEW_CITY_DAYS` to `90_000` — the 91-day assertion in "the window is ninety days" must fail, because a city 91 days old would still be announced. Then change it to `1` — the 89-day assertion must fail, because nothing would be announced. Both directions are required: a test that only checks one side passes for a constant that is far too large OR far too small.
3. In `openableAreaKey`, replace `preferred ?? drawable[0]` with `drawable[0]` — the showcase assertion in the first announce test must fail (it would return indiranagar).
4. In `wasDismissed`, change the `catch` to `return true` — "an unreadable store shows the badge" must fail.

- [ ] **Step 7: Gates and commit**

Run: `npm run check` and `npm run test:unit`
Expected: `0 errors`; all tests pass.

```bash
git add src/scripts/climate-engine/shell/new-city.ts src/scripts/climate-engine/shell/layout-state.ts tests/unit/obos-new-city.test.mjs
git commit -m "feat(obos): the rules for which city is new and where it opens

Both inputs injected — the clock because a ninety-day wait is not a test, the
store because reading localStorage throws on a blocked document. Reuses
layout-state's accessor rather than copying it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The badge on screen

**Files:**
- Modify: `src/components/ClimateEngine/HeatMapStage.astro` (frontmatter, the `.map` container at :384, the `is:global` block near :1792)
- Modify: `tests/unit/obos-new-city.test.mjs`

- [ ] **Step 1: Write the failing source assertions**

Append to `tests/unit/obos-new-city.test.mjs`:

```js
import { readFile } from 'node:fs/promises';

/* SOURCE ASSERTIONS, for the reason obos-shell.test.mjs states at its head: an
   .astro component cannot be imported under `node --import tsx --test`. Each one
   names the property of the source it reads and why that forces the property of
   the rendered page that matters. */
const stage = await readFile(
  new URL('../../src/components/ClimateEngine/HeatMapStage.astro', import.meta.url), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ').trim();

test('the badge is a link with a SIBLING dismiss button, never a button inside a link', () => {
  const markup = flat(stage);
  assert.match(markup, /<div class="newcity" id="newCity"[^>]*>/,
    'the badge container is missing');
  const block = markup.slice(markup.indexOf('<div class="newcity"'));
  const end = block.indexOf('</div>');
  const inner = block.slice(0, end);
  assert.match(inner, /<a [^>]*href=/, 'the badge must contain a real link');
  assert.match(inner, /<button [^>]*id="newCityHide"/, 'the dismiss control must be a button');
  assert.ok(inner.indexOf('</a>') < inner.indexOf('<button'),
    'the button must CLOSE the link before opening: a button inside an anchor is invalid '
    + 'HTML and traps keyboard users');
});

test('both controls carry their own name, because bronze alone says nothing to a screen reader', () => {
  const markup = flat(stage);
  const block = markup.slice(markup.indexOf('<div class="newcity"'));
  const inner = block.slice(0, block.indexOf('</div>'));
  assert.match(inner, /<a [^>]*aria-label=\{`\$\{newCity\.name\} — newly added city`\}/,
    'the link must name the city AND say it is newly added: "Bengaluru →" alone tells a '
    + 'screen-reader user nothing about why it is there');
  assert.match(inner, /<button [^>]*aria-label="Dismiss"/,
    'a bare × has no accessible name');
  assert.match(markup, /\.newcity a:focus-visible,\.newcity button:focus-visible\{outline:/,
    'both controls need a visible focus ring — they sit on a bronze fill, where the '
    + "browser's default ring is nearly invisible");
});

test('the badge renders only where it can be true', () => {
  const markup = flat(stage);
  assert.match(markup, /newCityToAnnounce\(scope\.city\.id\)/,
    'the component must ask the module, not decide for itself');
  assert.match(markup, /newCity &&/,
    'nothing renders when there is no city to announce');
  assert.match(markup, /data-since=\{newCity\.since\}/,
    'the arrival date must travel to the client: these pages are prerendered, so the shell '
    + 'has the only live clock and needs the date to re-check the window');
});

test('the badge is solid bronze with no border, the pairing this console already ships', () => {
  const css = flat(stage);
  const rule = css.slice(css.indexOf('.newcity{'), css.indexOf('.newcity{') + 400);
  assert.ok(css.includes('.newcity{'), 'the badge has no CSS rule');
  assert.match(rule, /background:var\(--bronze\)/, 'the fill must be the bronze token');
  assert.match(rule, /color:#0d0a05/, 'the text must be the near-black .cta pairs with bronze');
  assert.match(rule, /border:0/, 'the founder asked for no border');
  assert.match(rule, /position:absolute/, 'it is pinned to the frame, not floating over the model');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --import tsx --test tests/unit/obos-new-city.test.mjs`
Expected: FAIL — "the badge container is missing".

- [ ] **Step 3: Compute the city in the frontmatter**

In `src/components/ClimateEngine/HeatMapStage.astro`, beside the other scope imports near line 21, add:

```ts
import { newCityToAnnounce } from '../../scripts/climate-engine/shell/new-city.ts';
```

Then, after `scope` is resolved in the frontmatter, add:

```ts
/* THE OTHER CITY, ANNOUNCED ONCE. Server-rendered rather than drawn by the app:
   the markup is identical for every reader, and the two reader-specific facts —
   whether they dismissed it, and whether the window is still open on THEIR clock —
   are applied by console-shell.ts on mount. Rendering it client-side would mean a
   badge that pops in after the scene has settled.

   THE ARRIVAL DATE TRAVELS WITH IT, as `data-since`, and that is load-bearing.
   These pages are prerendered, so the `new Date()` this call uses is the BUILD
   clock: without the date on the element the shell could not tell a window that
   is still open from one that closed two months and no deploys ago. */
const newCity = scope.area.hasData ? newCityToAnnounce(scope.city.id) : null;
```

- [ ] **Step 4: Render it**

In the `.map` container, directly after the line `<div class="loadchip" id="loadchip"></div>`, add:

```astro
    {newCity && (
      <div class="newcity" id="newCity" data-city={newCity.id} data-since={newCity.since} hidden>
        <a href={newCity.href} aria-label={`${newCity.name} — newly added city`}>
          <span class="nc-eyebrow">New city</span>
          <span class="nc-name">{newCity.name} <span aria-hidden="true">→</span></span>
        </a>
        <button type="button" id="newCityHide" aria-label="Dismiss">×</button>
      </div>
    )}
```

It ships `hidden`. `console-shell.ts` removes that in Task 4 once it knows the reader has not dismissed it — so a dismissed reader never sees a flash of it before the script runs.

- [ ] **Step 5: Style it**

In the `is:global` block, directly after the `.loadchip.fail::after` rule, add:

```css
  /* THE OTHER CITY. Top-left is the only free corner: .synthetic and the stamp are
     top-centre, .loadchip sits at 118px, .place at 34%, and the compass, sun line,
     chip row and tip hint own the bottom. PINNED TO THE FRAME, never floating over
     the model — the idle orbit turns the scene forever (heat-map-app.ts), so any
     patch of empty sky fills with buildings at another bearing.
     Solid bronze with #0d0a05 on it is the pairing .cta already ships. */
  .newcity{position:absolute;top:14px;left:14px;z-index:6;display:flex;align-items:center;gap:2px;
    background:var(--bronze);color:#0d0a05;border:0;border-radius:9px;
    box-shadow:0 6px 18px rgb(0 0 0 /.35)}
  .newcity[hidden]{display:none}
  .newcity a{display:block;padding:8px 4px 8px 11px;color:inherit;text-decoration:none}
  .newcity .nc-eyebrow{display:block;font-family:var(--mono);font-size:.44rem;letter-spacing:.2em;
    text-transform:uppercase;opacity:.72}
  .newcity .nc-name{display:block;font-size:.74rem;font-weight:700;letter-spacing:-.01em;margin-top:1px}
  .newcity button{background:none;border:0;color:inherit;opacity:.55;cursor:pointer;
    font-size:.8rem;line-height:1;padding:8px 10px 8px 6px}
  .newcity button:hover{opacity:1}
  .newcity a:focus-visible,.newcity button:focus-visible{outline:2px solid #0d0a05;outline-offset:-3px;border-radius:7px}
  /* Phones: the eyebrow goes, the name and arrow stay. */
  @media (pointer:coarse) and (max-width:560px){
    .newcity{top:10px;left:10px;border-radius:8px}
    .newcity .nc-eyebrow{display:none}
    .newcity .nc-name{font-size:.66rem}
    .newcity a{padding:6px 3px 6px 9px}
  }
```

- [ ] **Step 6: Run them and watch them pass**

Run: `node --import tsx --test tests/unit/obos-new-city.test.mjs`
Expected: `fail 0`.

- [ ] **Step 7: Mutation proofs**

1. Change `border:0` to `border:1px solid #0d0a05` — the CSS assertion must fail. Revert.
2. Move the `<button>` inside the `<a>` — the nesting assertion must fail. Revert.

- [ ] **Step 8: Gates and commit**

Run: `npm run check` and `npm run test:unit`
Expected: `0 errors`; all pass.

```bash
git add src/components/ClimateEngine/HeatMapStage.astro tests/unit/obos-new-city.test.mjs
git commit -m "feat(obos): render the new-city badge in the map's free corner

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Dismissal, wired through the shell

**Files:**
- Modify: `src/scripts/climate-engine/shell/console-shell.ts` (inside `mountConsoleShell`, after the sidebar wiring)
- Modify: `tests/unit/obos-new-city.test.mjs`

- [ ] **Step 1: Write the failing source assertion**

Append to `tests/unit/obos-new-city.test.mjs`:

```js
const shellSrc = await readFile(
  new URL('../../src/scripts/climate-engine/shell/console-shell.ts', import.meta.url), 'utf8');

test('the shell unhides the badge and wires its dismiss through the same cleanup as everything else', () => {
  const src = flat(shellSrc);
  assert.match(src, /newCityHide/, 'the shell never looks for the dismiss button');
  assert.match(src, /wasDismissed/, 'the shell must ask whether this reader dismissed it');
  assert.match(src, /rememberDismissed/, 'a dismissal that is not remembered is not a dismissal');
  assert.match(src, /on\(hide, 'click'/,
    "the listener must go through mountConsoleShell's on(), which pushes its own removal "
    + 'onto cleanup — a bare addEventListener survives the page swap and leaks');
  assert.match(src, /arrivedMs\(\{ since: newCity\?\.dataset\.since \}\)/,
    'the shell must re-check the window on a LIVE clock: these pages are prerendered, so the '
    + "component's new Date() froze at build time and the badge would announce for ever");
  assert.match(src, /NEW_CITY_DAYS/,
    'the client-side window must read the same constant as the module, not a second literal');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test tests/unit/obos-new-city.test.mjs`
Expected: FAIL — "the shell never looks for the dismiss button".

- [ ] **Step 3: Wire it**

In `src/scripts/climate-engine/shell/console-shell.ts`, add to the imports:

```ts
import { NEW_CITY_DAYS, arrivedMs, rememberDismissed, wasDismissed } from './new-city.ts';
```

Then, inside `mountConsoleShell()` after the sidebar/pane wiring and before the function returns its disposer, add:

```ts
  /* ── the other city ──────────────────────────────────────────────────────── */

  /* SERVER-RENDERED HIDDEN, REVEALED HERE. The markup is the same for everyone,
     and the one fact that differs per reader lives in their own browser. Doing it
     this way round means a reader who dismissed it never sees it flash. */
  const newCity = consoleRoot.querySelector<HTMLElement>('#newCity');
  const cityId = newCity?.dataset.city ?? '';
  /* THE WINDOW IS RE-CHECKED HERE, ON A LIVE CLOCK, and that is not belt and
     braces. These pages are prerendered — no `output`, no adapter, `getStaticPaths`
     — so the `new Date()` the component used is the BUILD clock, frozen. Without
     this the badge would keep announcing on day 120 and day 300 until somebody
     redeployed, which is exactly what the arrival date exists to prevent. */
  const stillNew = arrivedMs({ since: newCity?.dataset.since })
    > Date.now() - NEW_CITY_DAYS * 86_400_000;
  if (newCity && cityId && stillNew && !wasDismissed(cityId)) {
    newCity.hidden = false;
    const hide = newCity.querySelector<HTMLButtonElement>('#newCityHide');
    on(hide, 'click', () => {
      newCity.hidden = true;
      rememberDismissed(cityId);
    });
  }
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test tests/unit/obos-new-city.test.mjs`
Expected: `fail 0`.

- [ ] **Step 5: Mutation proof**

Replace `on(hide, 'click', …)` with `hide?.addEventListener('click', …)` — the last assertion must fail. Revert.

- [ ] **Step 6: Gates and commit**

Run: `npm run check` and `npm run test:unit`
Expected: `0 errors`; all pass.

```bash
git add src/scripts/climate-engine/shell/console-shell.ts tests/unit/obos-new-city.test.mjs
git commit -m "feat(obos): reveal the new-city badge, and remember a dismissal

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The browser test

**Files:**
- Create: `tests/e2e/heat-map-new-city.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from '@playwright/test';
import { newCityToAnnounce } from '../../src/scripts/climate-engine/shell/new-city.ts';

/**
 * THE BADGE, IN A BROWSER.
 *
 * The unit tests prove the rules and the markup; only a browser proves the badge
 * is revealed, that its link goes where it says, and that a dismissal survives a
 * reload — which is the whole promise of a dismissible announcement.
 *
 * THE EXPECTATION IS DERIVED, NOT TYPED, and that is what stops this test dying
 * of old age. `since` starts a 90-day window; a spec that simply asserts "the
 * badge is there" passes until the window closes and then fails for ever, with no
 * code change and nothing wrong. So it asks the module the page asks — on the same
 * real clock — and asserts the DOM agrees: present while the window is open,
 * absent once it is not.
 */
const KOLKATA = '/heat-map/in/kolkata/ballygunge/';
const BENGALURU = '/heat-map/in/bengaluru/mg-road/';

test('Kolkata announces Bengaluru, and the dismissal sticks', async ({ page }) => {
  const announced = newCityToAnnounce('kolkata', new Date(), null);
  const thrown: string[] = [];
  page.on('pageerror', (error) => thrown.push(String(error)));

  await page.goto(KOLKATA, { waitUntil: 'domcontentloaded' });
  const badge = page.locator('#newCity');

  if (!announced) {
    /* The window has closed. That is the badge working, not failing — and the
       assertion still has teeth: a badge rendering past its own window fails here.
       SAY WHICH BRANCH RAN. Past the window both tests in this file reduce to
       "no badge", which is also exactly what a completely broken feature looks
       like; the run has to be able to tell those apart afterwards. */
    console.log('new-city e2e: WINDOW CLOSED branch — asserting absence');
    await expect(page.locator('#bcount')).not.toHaveText(/^—/, { timeout: 30_000 });
    await expect(badge).toHaveCount(0);
    return;
  }
  console.log(`new-city e2e: ANNOUNCING branch — expecting ${announced.name} at ${announced.href}`);

  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge.locator('a')).toHaveAttribute('href', announced.href);
  await expect(badge).toContainText(announced.name);

  await badge.locator('#newCityHide').click();
  await expect(badge).toBeHidden();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#bcount')).not.toHaveText(/^—/, { timeout: 30_000 });
  await expect(page.locator('#newCity')).toBeHidden();

  expect(thrown, `threw:\n${thrown.join('\n')}`).toEqual([]);
});

test('Bengaluru does not announce itself', async ({ page }) => {
  await page.goto(BENGALURU, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#bcount')).not.toHaveText(/^—/, { timeout: 30_000 });
  await expect(page.locator('#newCity')).toHaveCount(0);
});
```

- [ ] **Step 2: Build and run it**

No Playwright browsers are bundled here. Create an UNTRACKED `.pw-chrome.config.ts` at the repo root:

```ts
import base from './playwright.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({ ...base, use: { ...base.use, channel: 'chrome' } });
```

Run `npm run build`, then:

`npx playwright test -c .pw-chrome.config.ts tests/e2e/heat-map-new-city.spec.ts --project=chromium-tier0 --retries=0 --reporter=line`

Both in the FOREGROUND with the Bash tool's timeout at 600000. Never background Playwright and wait. Expected: `2 passed`.

- [ ] **Step 3: Mutation proof**

In `console-shell.ts`, comment out `newCity.hidden = false;`, rebuild, and re-run: the first test must fail on `toBeVisible`. Restore, rebuild, re-run: `2 passed`. Delete `.pw-chrome.config.ts`.

- [ ] **Step 4: Say which branch ran**

The spec logs `ANNOUNCING branch` or `WINDOW CLOSED branch`. Quote that line from the run in your report, and state plainly which one it was. Today it must be `ANNOUNCING` — Bengaluru's `since` is inside the window, so a `WINDOW CLOSED` run means the badge is not rendering and the test passed for the wrong reason.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/heat-map-new-city.spec.ts
git commit -m "test(e2e): the new-city badge appears, links to Bengaluru and stays dismissed

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Final verification

**Files:** none changed.

- [ ] **Step 1: Every gate**

| Command | Expected |
|---|---|
| `npm run check` | `0 errors` |
| `npm run typecheck` | `Success` |
| `npm run test:unit` | `fail 0`; report the count |
| `npm run build` | completes |
| e2e: `heat-map-new-city`, `heat-map-second-city`, `heat-map-bengaluru-resilience` | all pass |

- [ ] **Step 2: Re-stamp the arrival date**

`src/data/cities.ts` carries `since: '2026-09-16'`, and the field's own docblock says it is the day the city became reachable **in production**. Bengaluru is not: PR #29 is open, not merged. The 90-day window is therefore already burning down against a date that has not happened, and if the merge slips past 2026-12-15 the badge retires before it ever announces — with every gate green, because no test can know the merge date.

So: set `since` to the day this work actually merges to `main`. If that day is not yet known, leave it and put the re-stamp on the merge checklist — but say so explicitly in the Step 3 report rather than letting it pass silently.

```bash
# when the merge date is known
# edit src/data/cities.ts: since: '<YYYY-MM-DD of the merge>'
npm run test:unit   # the date tests must still pass
git add src/data/cities.ts
git commit -m "chore(obos): stamp Bengaluru's arrival with its real merge date

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Look at it**

With `npm run dev` running, open `http://localhost:4321/heat-map/in/kolkata/ballygunge/` and confirm: the badge sits top-left, solid bronze, no border; it does not collide with the provenance strip or the construction stamp at 1280 or at 1920; and at 390px width the eyebrow is gone and the card still reads.

- [ ] **Step 4: Report**

Report every gate result, the unit-test count, whether `since` was re-stamped or deferred to the merge checklist, and a screenshot or description of the badge at desktop and phone width.
