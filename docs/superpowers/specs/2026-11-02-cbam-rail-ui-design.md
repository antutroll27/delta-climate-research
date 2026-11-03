# CBAM Calculator — rail and bento redesign

**Date:** 2 November 2026
**Status:** design approved in preview, piece by piece, 2 November 2026. Open decisions are listed in §11; nothing ships to production without the founder's word.
**Route:** `/cbam/cbam-calculator/` (unchanged)
**Approved visual reference (in the repo):** `docs/superpowers/specs/2026-11-02-cbam-rail-ui/`. It holds `screens/` (28 screenshots), `preview/` (the working preview, with `bento.html` as the approved design) and `generator/` (`build_bento.py`, which regenerates it byte-identically). Its README covers how to open it and where it differs from this spec. The working copy the founder iterated on is `/Volumes/PortableSSD/OBOS Lab/previews/25-cbam-rail/`. **The reference is the visual authority for every pixel decision in this spec.** Where this text and the reference disagree on a look, the reference wins. Where they disagree on behaviour or honesty, this text wins.
**Related:** `docs/research/2026-11-02-cbam-audit.md` (the audit; its fixes ship first, §10), `docs/cbam-calculator-portability.md` (§7.1 non-negotiables). (The page's header comment cites `docs/cbam-calculator-ui-astro.md`; that file is not in the repo, and this spec replaces it as the layout reference.)

---

## 1. Why

Today the calculator is one long page under the site header. The form is on the left. Under the result sit the three-year strip, eight graphs, the line cards, the totals and the provenance, all stacked. Three problems follow:

- **The page is too dense to read.** A first-time exporter sees every card at once and cannot tell which one answers their question.
- **Adding a line hides the answer.** Once a line is in the list, the preview of the line being edited disappears. The strip and graphs are cleared, and the form stops previewing. A user editing the next line sees nothing change.
- **It does not look like our other instruments.** OBOS v2 and the Birkenhead twin share one design system: plates with no outlines, Helvetica Neue, monotone pictograms and a left rail. The calculator is the odd one out.

## 2. What changes, in one paragraph

The calculator becomes a full-screen app with a **left rail of six views**: Estimate, Three years, Why it changes, Shipment list, Export, and Rules & sources. A **title card** at the top of the rail always shows the line being priced. The content of each view is laid out as **bento tiles**: mixed-weight cards with full-stop titles, big numerals, and medium-to-large monotone illustrations. On Estimate, **the inputs are a numbered left column** ("Your line.", fields 1–5) and the results are tiles on the right. The engine, the figures, every refusal, and every honesty rule stay exactly as they are. **Only the presentation layer changes**, plus one behaviour, stated in §6.3.

## 3. Non-goals

- **No engine change.** The files under `src/scripts/cbam-algos/` that are listed in `UPSTREAM.json` stay byte-for-byte vendored. `cbam-app.ts` sits beside them, is ours, and changes.
- **No new figures, data or claims.** Every number on every tile comes from a model that exists today, listed in §7. If a tile would need a figure no model produces, the tile is cut. We do not invent the figure.
- **No change to the print document** (`buildPrintDocument`) or to the CSV columns.
- **No change to the colour law.** Bronze marks Commission defaults and the mark-up on them, cyan marks verified figures, and ink is used for everything else. The palette stays on the OG Delta tokens. The Cotton and Pearl trials remain trials (§11).
- **No new runtime dependency.** The page stays a plain Astro page with a `<script>` module and no framework, as it is today.

## 4. The shell

### 4.1 Layout

| Device | Shell |
|---|---|
| Desktop, ≥ 900 px | A full-height **left rail**, 248 px wide, collapsible to 72 px icons. The **main area** to its right scrolls on its own. No site `Nav` and no `Footer`: the rail carries the Delta mark, which links to `/`. |
| Phone, < 900 px | A **top bar** (48–54 px) shows the product eyebrow and the line being priced. A **bottom tab bar** holds Estimate · 3 years · Why · List · More. More opens Export and Rules & sources. |

The rail, top to bottom:
1. **The lockup:** Delta mark, then "**Delta** Climate", and under it **CBAM CALCULATOR** in small caps (approved 2 November).
2. **The title card:** "Line being priced", the CN code as a big numeral, the good's short name, then two meta rows (origin · route; mass · date). It updates whenever the draft line changes. With no complete draft, it reads "No line yet" and shows the empty pictogram.
3. **The six view buttons**, each with a monotone icon. Shipment list carries a count badge.
4. **Collapse menu.** The collapsed state is remembered in `localStorage`, wrapped in try/catch.

### 4.2 Views and the URL

- **One route; the view lives in the hash:** `#estimate` (the default), `#three-years`, `#why`, `#list`, `#export`, `#rules`. An unknown hash falls back to Estimate.
- **The pack loads once.** The form state and the list persist across views; switching views never re-runs the engine.
- **Each view is a `<section data-view="…">`.** The inactive ones carry `hidden`. Switching views:
  - sets `aria-current="page"` on the rail button;
  - moves focus to the view's `<h1>` (with `tabindex="-1"`);
  - updates the hash with `history.replaceState`, so the back button does not walk through views;
  - replays the entry animation (§8.3).
- **Views that need a priced line** (Three years, Why) show an empty-state card when there is none: "Price a line first", with a button to Estimate. The card is CSS-driven: it shows when the content container is `:empty`.

### 4.3 Type, tokens, themes

- **Type:** Helvetica Neue through a CSS stack, never embedded (it is licensed): `"Helvetica Neue", Helvetica, Arial, sans-serif`. This page drops Mona Sans and the Noplato mono. The approved twin decision covers instruments, and this is one.
- **Interim (phases 1–3):** the shell defaults to Dark. Today's cards, re-homed unchanged, are drawn for a dark ground; in Light the attest label measured 1.01:1. Light follows the OS again once the cards are restyled (phase 4). `?theme=light` previews it meanwhile.
- **Plates only, no Glass:** there is no map to blur. **Light and Dark**, following `prefers-color-scheme`, with `?theme=` for testing.
- **Tokens** are copied from the preview's `system.css` and `bento.css` into one stylesheet scoped to the page. Tile surfaces use `--card`, ink uses `--ink`/`--ink-2`, and the data colours are `--bronze` and `--cyan`.
- **Plates have no outline** (`border: 0`). Radius and shadow come from the preview.
- **Icon tones** are monotone, distinguished by alpha. The defining rule is `--ic-a: var(--ink-2)`; `--ic-c` is 72%, `--ic-b`/`--ic-d` are 45%, and `--ic-n` is 30%. The hero tile overrides them to on-ink tones. Illustrations never use bronze or cyan, so colour keeps meaning only provenance.

## 5. The views

Tile lists are in reading order. "Model" names the existing function that supplies every figure on the tile (§7).

### 5.1 Estimate — inputs left, results right

**Left column, "Your line.", subtitle "Fill these in, top to bottom. The estimate updates as you go."** The column is `minmax(360px, 440px)`. Each step is a numbered plate whose control looks like a field:

| # | Step | Control | Existing id(s) kept |
|---|---|---|---|
| 1 | **Good.** | A field showing `code — short name` and a **Change** pill. Change opens the **good sheet**: a search box, sector chips (Iron & steel · Aluminium · Cement · Fertilisers · Hydrogen) and a result list from `pack.classifications`. No Electricity chip: 0 of 572 goods are electricity. | `#cbCn` (the sheet writes to it), `#cbCnList` |
| 2 | **Origin & route.** | Origin `<select>`, then the route as **segmented buttons** (`role="radiogroup"`) mirrored to the hidden `#cbRoute` select. A route with no direct default is marked "verified figures only". | `#cbCountry`, `#cbRoute`, `#cbRouteNote` |
| 3 | **Import date.** | Native `<input type="date">`, plus a caption with the price period ("2026-Q1 · price €75.36, set per quarter in 2026"). | `#cbDate`, `#cbDateNote` |
| 4 | **Net mass.** | A text field with a `t` suffix (`inputmode="decimal"`, from the audit's H1 fix), the hint "Use a decimal point: 0.85, not 0,85.", and a mini ruler from 0 to the 50 t de minimis mark. | `#cbMass` |
| 5 | **Emissions data.** | Two **option cards** (`role="radio"`): "Commission default + mark-up" and "My verified figures". The verified fields, attestation and reference slide open under the second card. Scope (direct + indirect) appears here only for goods with an indirect default, as today. | `#cbTier` (mirrored), `#cbVerifiedRow`, `#cbSeeDirect`, `#cbSeeIndirectRow`, `#cbSeeIndirect`, `#cbAttest`, `#cbRef`, `#cbScopeRow`, `#cbScope` |

Below step 5 sits **Add line to the list** (`#cbAdd`). The status line (`#cbStatus`) lives in the shell, not here (§6.3).

**Right column, results.** Each tile has a refused or empty state (§6.1):

| Tile | Content | Model |
|---|---|---|
| **Certificates.** (hero, inverted) | The certificate count as the giant numeral; the € cost when priced; the price and quarter; a tier chip; and "What-if · CSCF unpublished". | `estimateFromPack` → `CertificateEstimate`, `renderPriceRow` |
| **Chargeable.** | The card itself is the bar: the fill width equals the chargeable share (69.4% in the reference case). It shows tCO₂e chargeable and embedded, and the **Free allocation** share with its factor. | `estimate.terms` (today's `renderWaterfall` inputs) |
| **Three years.** | A stacked deck of 2026, 2027 and 2028 counts; "+x% by 2028"; and the no-price note. A ↗ link leads to Three years. | `outlook()` |
| **Provenance.** | The snapshot as a **dot fingerprint** (64 bits of the hash), the data tier, the rule pack, and the folded notes. | `decorateSnapshot`, `renderStamp` inputs |

**The framing banner on Estimate:** a one-line summary with the full §7.1 text inside a `<details>` (the approved preview). This needs the CEO's sign-off before it ships (§11, D1). Until he says yes, the full banner stays visible on Estimate.

**Editors (sheets).** Only the Good step opens a sheet. In the preview, Origin, Date, Mass and Data also had sheets; they are replaced by the inline controls above, which the founder chose on 2 November ("users can't see how to change the value"). Sheets slide in from the **left**, over the input column. Esc and the scrim both close them, and focus is trapped inside while one is open and returns to the trigger when it closes.

### 5.2 Three years

The tiles:
- **2026., 2027., 2028.** Three year plates, each with the certificate count, the cost or "none published", the price locator and the mark-up step.
- **Your own price.** An assumed-price input (`#cbOlPrice`, unchanged), with the copy "Your assumption, not a forecast and not a published price."
- **Why it rises.** The share split of the extra certificates (`splitBetween`), with withheld states for refused, floor and tier-changes.
- **The working.** Year by year and exact; the rows from `renderOutlookRows`, folded by default.

Model: `outlook()`, `outlookPriceSlots`, `parseAssumedPrice`, `assumedCost`.

### 5.3 Why it changes

| Tile | Model |
|---|---|
| **Mark-up share.** (share of the rise that is mark-up) | `graphsModel` → `sentenceShare`, `plotShare` data |
| **Charged.** (100-dot waffle per year, switchable) | `chargedCells`, `sentenceCharged`, `chargedKind` |
| **What the mark-up adds.** (stacked bars) | `sentenceMarkup`, `plotMarkup` data |
| **Free allocation.** (phase-out columns, 2026–2034) | `phaseModel`, `sentencePhase` |
| **Does the origin matter?** (origin strip) | `originsModel`, `sentenceOrigins` |
| **What would it cost at my own price?** | `sentenceCost`, `costParts`, `#cgSecond` |

**Cut from this view:** the dot cascade (`plotCascade`) and the year-step chart (`plotSteps`). Their facts survive in Mark-up share and Three years. This needs the founder's OK (§11, D2). Cutting the cascade also removes the audit's **H2** attack surface. H2 is still fixed first (§10), because the old UI ships until this lands.

Every tile keeps an accessible table equivalent (the existing `tableCost`/`tableCharged` pattern), folded under "Show as table".

### 5.4 Shipment list

The tiles:
- **Total.** The line count, the what-if label, the certificates, the € cost, Export, and Add a line. Model: `sumTotals`, with the audit's C2 fix in place.
- **Annual de minimis.** One plate per calendar year in the list: the eligible mass against the 50 t ruler, the verdict tag, and the attestation checkbox (`data-attest`). Model: `thresholdByYear`, rendered by `renderYearThreshold`'s successor.
- **Line n.** One plate per line: the tier chip, the good name, the code · origin · route · mass · date, the certificates, the €, the price locator, a **Share of the total** bar, and Remove (`data-remove`). A refused line shows its reason in place of the figures. Model: `renderLineCard`'s inputs.

### 5.5 Export

The tiles:
- **CSV.** The column count, line count, "full precision", a 6-row preview of the real CSV, and the `#cbCsv` button.
- **Document.** "Printable", the generation date, what it contains, and the `#cbDoc` button. `#cbPrint` stays outside the views, exactly as today.
- **What travels with it.** The rule-pack fingerprint and one fingerprint per line, drawn as dots. Model: `lineFingerprint`, the snapshot.

Both buttons are disabled with no lines, as today.

### 5.6 Rules & sources

The tiles:
- **Framing.** The §7.1 banner, in full and unfolded, once D1 moves it here (§6.2). Until then, this tile links to it on Estimate.
- **Not yet published.** The two inputs the law still owes: CSCF, and 2027/28 prices.
- **Colour key.** Bronze, cyan, ink.
- **Rule pack.** The id, version, supersedes, valid-from, as-published date and basis.
- **Method.** The footnote, with an updated count (§11, D4).
- **Sources.** The pack's sources, with legal status and retrieval date.

## 6. Behaviour and honesty — what must not regress

### 6.1 Every tile has its refusal

The preview shows only the happy path. In the real build, **every tile that renders a figure must also render each state its model can return**. Those states are: idle (the input is incomplete), refused (with the engine's reason, verbatim), no price published, verified-only route, mixed tier, residual-default disclosure, and threshold error. Today these are held by the exhaustive `switch` in `cbam-app.ts` and pinned by `tests/unit/cbam-render.test.mjs` (138 tests). **Every one of those assertions is ported to the new renderers, not deleted.** A port that loosens an assertion to go green is a defect.

### 6.2 The §7.1 banner stays markup, exactly

`cbam-render.test.mjs` pins the banner by reading `cbam-calculator.astro` and matching `<div class="cb-banner" role="note"> … </div>` exactly, closed at both ends. The redesign keeps that element **once**, verbatim. Until D1 is decided it stays where it is today, at the top of Estimate and before the `cb-grid` that the second pin slices to. If the CEO approves the fold, phase 4 moves it into the Rules view and puts a one-line summary on Estimate. The summary is extra markup, not a replacement.

The eyebrow pin (`<p class="cb-eyebrow">Provisional · …</p>`) is the one §7.1 element the design drops: the approved look has no "Provisional" pill. **That is a change to a non-negotiable and needs the CEO's word (§11, D1).** Until then, the eyebrow stays in markup, placed under the Rules framing title.

### 6.3 The one behaviour change: the draft always previews

Today, once a line is in the list, `renderAll()` puts the list into `#cbOut` and clears the strip and graphs, and `refresh()` stops previewing (`if (!lines.length) run()`). With separate views that is wrong: the list has its own view, so Estimate must keep previewing the draft line.

- The list renders into a new **`#cbList`** in the Shipment list view.
- `#cbOut`, `#cbOutlook` and `#cbGraphs` **always** show the draft line.
- Removing the last line moves focus to the Shipment list heading, not to `#cbAdd`, which sits on the hidden Estimate view.
- `#cbStatus` keeps announcing the list summary after Add, Remove and attest. **It moves out of the views** into a status strip at the foot of the main area, visible from every view and hidden while empty (`:empty`). A live region inside a `hidden` view is never announced, and Remove and attest happen in the List view while the old position is on Estimate. `#cbOutWrap` stays `aria-live="polite"` permanently (it holds one draft again), and `#cbList` is `aria-live="off"`. The existing reason for turning the region off (a wall of cards read on every click) moves with the list.

### 6.4 Ids and hooks

- **Every id in today's DOM contract survives with the same meaning:** `cbAdd cbAttest cbCn cbCnList cbCountry cbCsv cbDate cbDateNote cbDoc cbGraphs cbMass cbOut cbOutWrap cbOutlook cbPrint cbProv cbRef cbRoute cbRouteNote cbScope cbScopeRow cbSeeDirect cbSeeIndirect cbSeeIndirectRow cbStatus cbTier cbVerifiedRow`, plus `cbOlPrice` and `cgSecond`, which are generated.
- **The `data-*` hooks keep their names:** `data-remove`, `data-attest`, `data-line`, `data-cg`, `data-cg-card`, `data-ol`.
- New renderers keep the class hooks the e2e suite reads (`cb-line`, `cb-thresh`, `cb-ol-yr`, `cb-ol-n`, `cg-card`, `cg-t`, …) **alongside** their `b-` design classes. A hook is renamed only together with the test that reads it, in the same commit.

### 6.5 Accessibility

- The rail is a `<nav aria-label="Calculator sections">` of buttons, with `aria-current`.
- Segmented routes and option cards are real radio groups (arrow keys, `aria-checked`). The hidden native `<select>`s stay the source of truth for `cbam-app.ts`.
- The good sheet is a dialog (`role="dialog"`, `aria-modal`, labelled, focus-trapped).
- Every chart has a table equivalent, and every illustration is `aria-hidden`.
- Contrast is AA on both themes, and it is checked (§9).
- Reduced motion switches off all entry animation.
- **The audit's M3 fix carries over:** a year with no rules is explained in text, never only inside a disabled control.

## 7. Architecture

- **Models stay; renderers are replaced.** The pure model layer (`outlook`, `graphsModel`, `phaseModel`, `originsModel`, `thresholdByYear`, `sumTotals`, `csvRows`, `estimateFromPack`) is untouched. Each view gets a **renderer module of pure functions** returning HTML strings, the same pattern as today, so the existing unit-test style (render, then assert on the string) carries over:
  - `src/scripts/cbam-ui/views.ts`: hash ↔ view, the rail state and entry replay. DOM-light, with a pure core.
  - `src/scripts/cbam-ui/tiles-estimate.ts`: hero, chargeable, deck, provenance.
  - `src/scripts/cbam-ui/tiles-years.ts`: Three years.
  - `src/scripts/cbam-ui/tiles-why.ts`: Why it changes.
  - `src/scripts/cbam-ui/tiles-list.ts`: total, de minimis, line plates.
  - `src/scripts/cbam-ui/tiles-export.ts`: CSV preview, document, fingerprints.
  - `src/scripts/cbam-ui/fingerprint.ts`: hash → dot grid. Shared by provenance and export.
  - `src/scripts/cbam-ui/illustrations.ts`: the illustration SVG strings, copied from `build_bento.py`'s `ILL_*` constants (no `ILL_CERT`; the founder removed it).
  - `src/scripts/cbam-ui/good-sheet.ts`: the search, chips and list over `pack.classifications`. It writes `#cbCn` and dispatches `input`.
  - `src/styles/cbam-app.css`: tokens, shell, tiles and animation. Imported by the page alone.
- **`cbam-app.ts` keeps wiring and state.** Its `render*` functions are retired one view at a time, each replaced by a call into the matching `tiles-*` module. Old renderers are deleted only once their tests have been ported.
- **The Rules view and the shell are static markup** in `cbam-calculator.astro`. The pack-dependent parts of Rules (the rule-pack card and sources) are filled once, after `ensurePack()`.

## 8. Illustrations and motion

### 8.1 Illustrations

These are medium-to-large monotone SVGs on specific tiles, as approved:

| Illustration | Tile |
|---|---|
| Tube, cement bag or ingot, by sector | Estimate step 1, Good. (none for fertilisers or hydrogen) |
| Pin with three routes | Step 2, Origin & route |
| Calendar (smaller) | Step 3, Import date |
| Platform scale (smaller) | Step 4, Net mass |
| (none) | Step 5, Emissions data |
| Factory | Chargeable., bronze half |
| Voucher | Chargeable., free-allocation half |
| Steps (mark-up staircase) | Why · Mark-up share |
| Scale | Why · Charged |
| Crates | List · Total |
| Gauge (needle) | List · Annual de minimis, on above-threshold years only |
| Shield | Rules · Framing |

Corrected 2 November from the approved preview (`generator/build_bento.py`, `screens/`). An earlier draft of this table mis-placed four rows.

- Each good's step pictogram (tube, cement bag, ingot) follows the sector.
- **Removed by the founder:** the certificates illustration and the emissions-data illustration.

### 8.2 Positions

The positions are those of the preview's `.b-ill-*` rules, in `bento.css`. An illustration never overlaps a numeral or a title. This is checked at 1440, 1280 and 390 px.

### 8.3 Entry animation (approved 2 November)

The motion plays when the user enters a view:
- **Illustrations and pictograms:** each child rises and fades in, staggered 70 ms (`bRise`, 0.9 s).
- **Bars without text** grow from their baseline (`bGrowX`, `bGrowY`).
- **Bars with text** slide or lift (`bSlide`, `bLift`) and never scale, so their numbers are never squashed.
- **Dot grids** pop in a ripple (`bPop`, 9 ms stagger).
- **The gauge needle** sweeps 130° (`bNeedle`).

Rules for all of it:
- Easing is `cubic-bezier(.65,0,.35,1)`.
- It animates **transform and opacity only** (the 60 fps rule).
- It replays on every view entry: `views.ts` removes the `b-anim` class from the view, forces a reflow and re-adds it.
- `--i` stagger indices are set once per render.
- `prefers-reduced-motion: reduce` switches all of it off.

## 9. Testing and acceptance

- **Unit tests** (`npm run test:unit`):
  - every `cbam-render.test.mjs` assertion is ported to the new renderer;
  - new tests cover `views.ts` (hash parsing and fallback), `fingerprint.ts` (bits → dots, deterministic) and `good-sheet.ts` (search and sector filter over the real pack);
  - the banner and eyebrow pins stay green.
- **E2E** (`tests/e2e/cbam-lines.spec.ts`, chromium, firefox-cbam and webkit-cbam):
  - one `view(page, name)` helper navigates by the rail;
  - list assertions move from `#cbOut` to `#cbList`;
  - new specs cover the rail and hash round-trip, the draft still previewing with lines present (§6.3), the good sheet's keyboard path, and the phone tab bar.
- **Checks:** `npm run check` (astro check) is clean.
- **Visual:** headless screenshots of every view and the good sheet, in light, dark and phone, are compared with the preview by eye, with no illustration overlap. Per the founder's standing rule, no browser window is opened in front of him.
- **A11y and contrast:** the axe pass in `core-accessibility.spec.ts` gains the calculator's six views.
- **Perf:**
  - the entry animation holds 60 fps on a mid-range laptop profile (no layout or paint thrash: transform and opacity only);
  - the first view paints with the pack still loading.
- **CI is the browser gate.** Locally: check, unit, and the targeted specs. The full Playwright run happens in CI.

## 10. Order of work

0. **The audit-fix PR on today's UI** (founder decision 2 November): H1, C2, H2, M2, M3 from the audit. It ships first and on its own. C1 and C3 are fixed upstream in CBM and re-vendored.
1. **Shell:**
   - the rail, title card, views, hash routing, tokens, phone bars and animation infrastructure;
   - today's cards are re-homed into views unchanged;
   - `#cbList` is split out (§6.3).
2. **Estimate:** the inputs column, the good sheet, and the four result tiles.
3. **Three years and Why it changes.**
4. **List, Export, Rules,** and the title card's final form.
5. **Illustrations, motion, phone polish,** then the a11y, contrast and perf pass, an independent audit, and release on the founder's word.

Each phase is a PR into the integration branch `feat/cbam-rail-ui`. Production gets **one** merge, after phase 5. The detailed plans live in `docs/superpowers/plans/2026-11-02-cbam-rail-ui-*.md`.

## 11. Open decisions

| # | Decision | Owner | Default until decided |
|---|---|---|---|
| D1 | Fold the §7.1 banner to one line plus `<details>` on Estimate, and drop the "Provisional" eyebrow pill. | CEO (the wording was approved 14 October) | Full banner visible on Estimate; eyebrow kept on Rules |
| D2 | Cut the dot cascade and the year-step chart from Why. | Founder | Cut (the approved preview) |
| D3 | The verified-figures colour (cyan) and the long-term palette (OG, Cotton or Pearl). | Founder | OG bronze/cyan |
| D4 | The method footnote count: today's "183 of 574" is stale against the 572-good pack. Re-measure, and print the measured figure. | Engineering, measured | Re-measured in phase 4 |
| D5 | A source for short good names (the pack carries only the long CN description). | Founder | The full CN description, clamped to two lines by CSS, with the full text in `title` (no invented names) |
| D6 | Build the guided "Price a line" flow for first-time users. | Founder | Not built |
