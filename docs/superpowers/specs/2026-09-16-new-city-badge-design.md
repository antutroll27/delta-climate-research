# A "new city" badge in the OBOS console — design

> **Status:** approved by the founder 2026-09-16. Scope: the console only.

**Goal.** A reader who opens OBOS lands on Kolkata and never learns Bengaluru exists. One dismissible badge, pinned to the top-left of the map frame, names the newly added city and links to its twin.

---

## 1. Why discovery fails today (measured, not assumed)

| Fact | Where |
|---|---|
| Every front door lands on one Kolkata ward. `DEFAULT_AREA = 'in/kolkata/ballygunge'` feeds the nav's Heat Map link, both buttons in the landing page's OBOS section, the `/heat-map` redirect and Compare's Explore link. | `scope/registry.ts:80`, `scope/paths.ts:117` |
| Bengaluru **is** already reachable: one unlabelled `<option>` in the console's City select, inside a collapsible sidebar panel. | `shell/ScopeSwitcher.astro:156` |
| Search cannot surface it. Bengaluru's areas are `shipsData: false`, which drives both `noindex` and absence from the sitemap, because they publish no catalogue record. | `scope/registry.ts:212`, `scope/resolve.ts:200-208`, `astro.config.mjs:86` |
| The landing page still reads "Kolkata · live" and "Dubai next", and never mentions Bengaluru. | `sections/Obos.astro:21-33` |

The last row is a real gap and is **out of scope here** (§7).

## 2. The decision

A badge **inside the console**, because that is where the reader already is when the gap bites. Dismissible, and once dismissed it stays gone.

Rejected, with reasons: a fourth card in the ward strip (costs the three Kolkata cards ~25% width each and reads as a fourth *ward*); a transient loadchip-style line (shares a slot with the real loading chip, and transient things get missed); a badge on the City select alone (semantically right, but the panel collapses and the select is closed — the invisibility we are fixing).

## 3. Placement and appearance

**Top-left of the map frame is the only free corner**, verified against the pinned furniture: `.synthetic` top-centre (`top:20px`), `.stamp-slot` below it, `.loadchip` centred at `top:118px`, `.place` (the ward name) at `left:50%;top:34%`, `.compass` at `left:26px;bottom:26px`, `.sunline` at `left:26px;bottom:104px`, `.chiprow` and `.tiphint` bottom-centre.

**Pinned to the frame, never floating over the model.** The scene auto-orbits forever, pausing 2.5 s after any interaction (`heat-map-app.ts:403`), so any "empty" sky fills with buildings at another bearing.

**Solid bronze, no border,** inheriting the pairing the console already ships for a solid bronze surface — `.cta` at `HeatMapStage.astro:2007` is `background:var(--bronze); color:#0d0a05; border:0`, and the bronze provenance keys (`.src-row .k`) use the same near-black on the same fill. `--bronze` is `#b08d57` (`HeatMapStage.astro:833`).

- Two lines: a mono eyebrow `NEW CITY` at ~0.44rem, letter-spacing .2em, 72% opacity; then the city name at ~0.74rem, weight 700, with a trailing `→`.
- Radius 9px, padding ~8px 10px, a soft drop shadow so it holds against a bright basemap.
- At ≤560px the eyebrow drops; the name and arrow remain.

**Markup shape — a container, not a nested control.** A dismiss button inside a link is invalid HTML and traps keyboard users:

```html
<div class="newcity" id="newCity">
  <a href="/heat-map/in/bengaluru/mg-road/">…eyebrow + name…</a>
  <button type="button" id="newCityHide" aria-label="Dismiss">×</button>
</div>
```

It mounts in the `.map` container beside `.synthetic`, `.stamp-slot` and `.loadchip`. Styles live in `HeatMapStage.astro`'s `is:global` block, consistent with that file's documented rule.

## 4. Behaviour

- **A real link.** Crossing cities is a full navigation in this codebase (`console-shell.ts:391`'s `sameCity` gate, else `location.assign`), so an `<a>` is the honest control: middle-click and "open in new tab" work.
- **Destination:** the city's most recognisable ward, `in/bengaluru/mg-road`, built through `areaPath()` rather than a typed URL.
- **Never on the city it advertises.** Hidden when the open area is already in that city.
- **Never on a page that ships no artefacts** (`scope.area.hasData === false`), which already renders a statement rather than an instrument.
- **Dismissal** hides it immediately and is remembered per city.

## 5. Where the two facts live

**"New" is a date, not a flag.** `CityRecord` (`src/data/cities.ts:70`) gains `readonly since?: string` — an ISO date, the day the city became reachable in production. A city is new while `now − since < NEW_CITY_DAYS` (90). When the window passes the badge retires itself; no copy for anyone to remember to delete.

- Bengaluru's `since` is the date PR #29 merges. Set `'2026-09-16'`; if the merge slips, that one line moves.
- If two cities are ever new at once, the most recent wins and only one badge renders.
- The comparison takes an injected clock so tests do not depend on the real date.

**"Dismissed" reuses the existing store.** `shell/layout-state.ts` already defines `LayoutStore { getItem, setItem }` with a `defaultStore()` that survives the SecurityError raised by merely *reading* `localStorage` in a private window. The badge takes the same injectable-store shape and the same `obos:` key prefix: `obos:new-city:<cityId>`. An unreadable or unwritable store means the badge simply shows; nothing breaks.

## 6. Accessibility

- The link's accessible name states both facts: e.g. "Bengaluru — newly added city".
- The dismiss button is a real `<button>` with `aria-label="Dismiss"`, focusable separately, and a visible focus ring matching the console's existing `:focus-visible` treatment.
- Colour is never the only signal: the word "NEW CITY" carries the meaning.
- No motion on arrival beyond the console's existing fade conventions, and nothing that ignores `prefers-reduced-motion`.

## 7. Out of scope

- The landing page's stale copy ("three Kolkata wards", "Dubai next") and the `DEFAULT_AREA` front door. Both are real, both are bigger, and both are recorded here so the next session can pick them up.
- Making Bengaluru indexable. That waits on its catalogue record, deliberately.

## 8. How it is proven

Unit, with an injected clock and an injected store:

1. A city inside the window is named; outside it, nothing renders.
2. The badge never names the city the reader is already in.
3. Dismissal is remembered per city; a second city still shows.
4. An unreadable store still shows the badge, and a failing write does not throw.
5. The destination resolves through `areaPath`, so a renamed ward cannot leave a dead link.

Browser, on a Kolkata ward:

6. The badge is present, its `href` points at Bengaluru, the × removes it, and it stays gone after a reload.
7. It is absent on a Bengaluru ward page.

Every test carries a mutation proof, as with the rest of this branch.
