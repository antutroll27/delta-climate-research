# CBAM Calculator redesign, phase 2: Estimate — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution model.** Each task is built by one Sonnet 5.5 (high effort) agent that is given **only that task's text**. Every task therefore repeats the context it needs. Opus 5.5 reviews the whole phase in the last task, before the PR. Tasks run in order: each one assumes the commits of the tasks before it are on the branch.

**Goal:** The Estimate view becomes the approved bento layout. On the left is a numbered input column ("Your line.", steps 1–5) with a good sheet. On the right are four result tiles: Certificates, Chargeable, Three years and Provenance. Every refusal and honesty state the old result card showed survives, and so does every assertion that pinned it.

**Architecture:** The models are unchanged. Four new pure renderer modules return HTML strings, like the page's existing renderers:
- `src/scripts/cbam-ui/format.ts`: one spelling of numbers, prices and tier labels, moved out of `cbam-app.ts`.
- `src/scripts/cbam-ui/fingerprint.ts`: a hash drawn as dots.
- `src/scripts/cbam-ui/tiles-estimate.ts`: the four tiles, the idle state, the thrown state and the deck.
- `src/scripts/cbam-ui/inputs-estimate.ts`: route segments, the verified-only marker, the mass ruler and the date caption, plus one DOM helper that mirrors a hidden native `<select>` into an ARIA radio group.

A fifth module, `src/scripts/cbam-ui/good-sheet.ts`, holds the search model and the dialog's DOM. The hidden `#cbRoute` and `#cbTier` selects remain the source of truth for `cbam-app.ts`; the new controls write to them and dispatch `change`. All new styling is in `src/styles/cbam-bento.css`, scoped under `.cbx`, and it uses the preview's own `b-` class names verbatim so that phases 3–4 can append their sections with the same primitives.

**Tech Stack:** Astro 5 page with a plain `<script>` module, TypeScript, `node --test` through tsx for unit tests, and Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-11-02-cbam-rail-ui-design.md` (§5.1, §6, §7, §11). **Visual reference:** `docs/superpowers/specs/2026-11-02-cbam-rail-ui/` (`screens/1-estimate-*.jpg`, `screens/7-good-sheet-*.jpg`, `preview/bento.html`, `preview/bento.css`). **Roadmap:** `docs/superpowers/plans/2026-11-02-cbam-rail-ui-00-roadmap.md`. **Phase 1 plan** (format model): `docs/superpowers/plans/2026-11-02-cbam-rail-ui-01-shell.md`.

> **Environment notes (measured 2 Nov 2026):** macOS has no `timeout` command, so run Playwright in the foreground through the Bash tool's own timeout. The Chromium project is `chromium-tier0`; there is no `chromium`. `npm run test:unit` must run **after** `npm run build`, because about 59 OBOS and heat-map unit tests read `dist/`.

---

## Decisions this plan takes (Opus review: confirm or overturn)

1. **The hidden selects stay actionable, and the 78 existing `selectOption`/`fill` calls in `tests/e2e/cbam-lines.spec.ts` are not rewritten.** `#cbRoute` and `#cbTier` get class `b-native`: 1×1 px, `clip-path: inset(50%)`, `tabindex="-1"`, `aria-hidden="true"`. Playwright's `selectOption` checks *visible* and *enabled*; "visible" means a non-empty bounding box with no `visibility:hidden`, and a 1×1 clipped box passes. Rewriting the suite to click segments would change 78 call sites in tests whose subject is not the control, so it risks a loosened assertion. It would also stop exercising the select that `cbam-app.ts` actually reads. The new controls are proved instead by a new spec, `tests/e2e/cbam-estimate.spec.ts`, which drives them both ways: click and arrow keys write the select, and `selectOption` on the select moves the radios.
2. **`#cbCn` stays a visible text input** (with `list="cbCnList"` and the pinned placeholder), and the **Change** pill opens the sheet. The e2e suite fills `#cbCn` 15 times, and `cbam-render.test.mjs` pins its placeholder. The spec's "field showing code — name" is rendered as the input (the code) plus `#cbCnName` beneath it (the full CN description, clamped to two lines, per D5).
3. **The draft de minimis card (`renderDraftThreshold`, unchanged) stays inside `#cbOut`, first**, as a full-width legacy plate. Its own copy says "the exposure **below** stands", and `run()` puts it above the result on purpose ("you may owe nothing at all" outranks "here is what you would owe"). It keeps its legacy `cb-*` look until phase 4 restyles the threshold cards.
4. **The deck is filled by `paintOutlook`**, from the `Outlook` it already computes, into a `[data-deck]` slot that `runPreview` renders. The engine is not run twice, and the deck carries no `cb-ol-*` class: `cbam-lines.spec.ts` reads `.cb-ol-n` and `.cb-ol-yr` page-wide, and a second match would break strict mode.
5. **Chargeable is "the card is the bar".** The bar's width is exactly `net ÷ total embedded`. When that share is under 40 %, and on every phone, the bar becomes a strip along the tile's foot and the text sits on the plate (`b-fill-low`). A bar is never widened to fit its label. The colour follows the stamped tier: bronze for defaults, cyan for verified, and ink for the mixed tier, because neither colour alone is true of it.
6. **"Embedded" on the Chargeable tile is the DIRECT term**, labelled `Embedded emissions (direct)`. Indirect gets its own tag, `+ Indirect (electricity) · no free allocation`. This is the pinned rule "the indirect component is shown as its own line, never folded into embedded". The preview's single "475.2 tCO₂e embedded" chip would have folded the two together for cement.
7. **One new sentence**, shown only when the engine's floor applied (free allocation > direct emissions, measured on 8 of 4,564 priced sample lines): "Free allocation exceeds the direct emissions, so the direct charge is zero. It never goes below zero." It restates `max(0, direct − FA)` from `certificate-estimate.ts`. **Founder to confirm the wording.**
8. **The provenance notes fold** under "Notes · N" (spec §5.1: "the folded notes"). They stay in the DOM, so `toContainText` and the unit pins still read them. The "Origin basis" row, which carries "Residual bucket", stays unfolded.
9. **The option card copy drops the preview's "Mark-up 10% in 2026"**. That is false for fertilisers: measured, the pack's fertiliser mark-up is 1 %. The deck states the mark-up from the model instead (`directMarkupPct`), so for 28080000 it reads "Mark-up 1 → 1 → 1%".
10. **A result in the good sheet is picked on click or Enter**, with no separate "Use this good" confirm. That is one control fewer in the dialog's keyboard path.

---

## Render tests mapped (spec §6.1: "every assertion ported, none loosened")

Measured with a script that reads every `test(` body in `tests/unit/cbam-render.test.mjs` (145 tests today), skips comment lines, and lists each body that calls `renderResult(`, `renderPriceRow(`, `renderAttestation(`, `renderDraftThreshold(`, `draft(` or `renderThreshold(`, or reads `cbam-calculator.astro` or `cbam-app.ts`. That gives **33 tests**. A further test in `tests/unit/build-contracts.test.mjs` pins the idle copy.

**`renderResult`, `renderPriceRow` and `renderAttestation` are NOT retired in phase 2.** `renderLineCard` (the List view) still calls `renderResult`, and the List view is phase 4. So every original test stays as it is, still green, and **guarding the List card**. Task 6 adds a **twin** for each of the 19 tests below, asserting the same thing on the new tiles, with the hook regexes tightened (see Task 6) so no twin can pass vacuously.

| # | Test (verbatim name) | Phase-2 treatment |
|---|---|---|
| 1 | `the indirect component is shown as its own line, never folded into embedded` | Twin on `renderEstimateTiles`: same three regexes, plus the direct figure printed beside the label |
| 2 | `a direct-only sector is unaffected by the scope control` | Twin, plus a premise that the detector fires on the cement line |
| 3 | `NON-NEGOTIABLE 2 — a refusal renders NO figure of any kind` | Twin, with `\bcb-fig\b`/`\bcb-cost\b` and positive premises on a priced line |
| 4 | `NON-NEGOTIABLE 3 — CSCF-pending is labelled a what-if, never a figure` | Twin, plus the warn paragraph equal to `renderResult`'s word for word |
| 5 | `NON-NEGOTIABLE 5 — the provenance stamp travels on EVERY branch` | Twin, plus Data tier and Rule packages rows |
| 6 | `NON-NEGOTIABLE 4 — nothing claims a filing or registry validation` | Twin over tiles, idle and thrown output |
| 7 | `the residual sheet answers for unlisted ORIGINS, never for a good a listed sheet omits` | Twin of the render half, plus the deck for the refused line. The engine half needs no twin: it tests the engine |
| 8 | `a residual-basis figure says so — it must not read as the origin's own value` | Twin |
| 9 | `the renderer handles every status the engine can return` | Twin, plus each status's tag text |
| 10 | `the pre-pack fallback text renders in full, never truncated as though it were a hash` | Twin, plus no dot grid for a non-hash |
| 11 | `renderStamp truncates a genuine 64-hex-char snapshotHash to its first 16 chars plus an ellipsis` | Twin, plus a 64-dot grid that leaks no further hex |
| 12 | `a 2027 or 2028 date counts certificates, with no price and no cost` | Twin on the tiles AND the deck |
| 13 | `the price row: a published price shows it; an unpublished one says "none published", never "pending"` | `renderPriceRow` moves to `format.ts` unchanged and is re-exported. The twin asserts the hero embeds its exact output |
| 14 | `§1 marks a verified row and transcribes the reference the importer cited` | Twin: the tile's Data tier equals the card's, which equals the document's |
| 15 | `§1 transcribes the verifier reference on a MIXED row — it certifies the half that is real` | Twin, as 14, for the mixed tier |
| 16 | `renderAttestation gates on the TIER, not on an external if — the preview shipped without one` | Twin: the tiles place the attestation they are handed, whole; a default line carries none |
| 17 | `a year with no published threshold row gets a card on the PREVIEW too, not silence` | One twin covers 17–19: the tiles carry `renderDraftThreshold`'s output byte for byte, first, and render no plate when it is `''` |
| 18 | `the other three nulls stay silent — an absent card is the right answer for them` | (as 17) |
| 19 | `a year that HAS a published row is untouched — the same card, byte for byte` | (as 17) |
| 20 | `NON-NEGOTIABLE 1 — the banner names both tiers, and concedes everything it conceded before` | Unchanged, must stay green. The banner keeps its bytes, and `cb-grid` stays the first token after it (the class stays on the new grid; Task 11) |
| 21 | `the CN placeholder teaches a code the corpus actually publishes` | Unchanged; `#cbCn` keeps `placeholder="e.g. 2523100090 — grey cement clinker"` |
| 22 | `renderAttestation: a REFUSED mixed line drops the electricity clause — the card has no such component` | Unchanged source pin: `renderAttestation(` ×3 and `hasFigure(` ×2 in `cbam-app.ts`. The preview call keeps its exact form inside `runPreview` (Task 12) |
| 23 | `the attestation question has ONE spelling and five call sites — the only pin defaultPathComparison can have` | Unchanged; no new `=== 'verified-direct+default-indirect'` in `cbam-app.ts`. The tier switches in the new modules use `case` |
| 24 | `the script pins the pack it will accept to the manifest that seals the pack bytes` | Unchanged; `PACK_INTEGRITY` stays in `cbam-app.ts` |
| 25–29 | `a line under 50 t is INDETERMINATE, never exempt` · `a line over 50 t is ABOVE the threshold, and says the exposure stands` · `the threshold card always cites the amending regulation` · `the two threshold cards name a sector identically — "iron & steel", never "iron and steel"` · `hydrogen and electricity are outside the exemption, so no card is shown` | Unchanged: `renderThreshold` and `renderDraftThreshold` are not touched, and their output reaches the tiles byte for byte (twin 17) |
| 30–33 | `renderAttestation on a MIXED line names both halves — attested direct, Commission electricity` · `renderAttestation: a REFUSED fully-verified line keeps ATTESTED_NOTE unchanged` · `renderAttestation: a default-tier line still says nothing, priced or refused` · `renderAttestation: a call that cannot answer "priced?" must not answer it by default` | Unchanged: the function is unchanged, and its preview output reaches the hero whole (twin 16) |
| — | `build-contracts.test.mjs`: `the calculator states its idle prompt identically in the page and in the script` | Unchanged: the idle literal stays in `cbam-app.ts`, and `<p class="cb-idle">…</p>` stays the first such paragraph in the page. A new pin (Task 4) holds the static `#cbOut` equal to `renderEstimateIdle(IDLE)` |

**Unmappable: none.**

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `src/scripts/cbam-ui/format.ts` | create | `esc`, `num`, `eur`, `inputRefusal`, `tierLabel`, `renderPriceRow` (moved), plus `originBasisLabel` and `snapshotLabel` |
| `src/scripts/cbam-ui/fingerprint.ts` | create | `fingerprintBits`, `renderFingerprint` |
| `src/scripts/cbam-ui/tiles-estimate.ts` | create | `renderEstimateTiles`, `renderEstimateIdle`, `renderEstimateThrown`, `renderDeck`, `chargeableSplit`, `tierTone` |
| `src/scripts/cbam-ui/inputs-estimate.ts` | create | `verifiedOnlyRoutes`, `verifiedOnlyNote`, `segmentLabel`, `renderRouteSegments`, `renderMassRuler`, `renderDatePeriod`, `mountRadioMirror` |
| `src/scripts/cbam-ui/good-sheet.ts` | create | `SECTOR_CHIPS`, `searchGoods`, `goodCaption`, `renderSectorChips`, `renderGoodResults`, `mountGoodSheet` |
| `src/styles/cbam-bento.css` | create | Tile tokens, shared `b-` primitives, the Estimate section, the sheet, remnant overrides |
| `src/scripts/cbam-algos/cbam-app.ts` | modify | Imports `format.ts`; `syncRoutes` marks `data-vo`; `runPreview` renders tiles; deck, ruler and date caption painted; mirrors and sheet mounted |
| `src/pages/cbam/cbam-calculator.astro` | modify | Estimate view markup, sheet markup, stylesheet import, dead scoped rules removed |
| `playwright.config.ts` | modify | `firefox-cbam` and `webkit-cbam` also match `cbam-estimate.spec.ts` |
| `tests/unit/cbam-format.test.mjs` | create | `originBasisLabel`, `snapshotLabel`, the `renderPriceRow` re-export |
| `tests/unit/cbam-fingerprint.test.mjs` | create | Bits, grid, refusal of non-hex |
| `tests/unit/cbam-tiles-estimate.test.mjs` | create | Chargeable split, floor, zero, tones, deck, idle/thrown, static-markup pin |
| `tests/unit/cbam-render.test.mjs` | modify (append only) | The 19 twins (16 test blocks) |
| `tests/unit/cbam-inputs-estimate.test.mjs` | create | Verified-only routes, segments, ruler, date caption |
| `tests/unit/cbam-good-sheet.test.mjs` | create | Search, sectors, escaping, the result cap, the chips in the page |
| `tests/unit/cbam-bento-contrast.test.mjs` | create | WCAG AA for every text and mark pair, both themes |
| `tests/e2e/cbam-estimate.spec.ts` | create | Mirrors, tiles, sheet keyboard path, ruler, caption, phone, axe in both themes |

Facts measured for this plan on the real pack (`public/cbam/estimator-pack.json`, 572 goods, 122 origins):
- **Sectors:** iron & steel 478, aluminium 58, fertilisers 27, cement 8, hydrogen 1, electricity 0.
- **Routes:** the most offered for any good is 4.
- **73063077 / IN / 2026:** routes `(C)`, `(D)`, `(E)`; `(D)` and `(E)` refuse on defaults with `NO_DIRECT_DEFAULT`. At 100 t on 2026-03-15, `(C)` gives 329.8275 certificates and €24,855.80, embedded 475.2 tCO₂e, free allocation 145.3725, factor 0.975. The outlook gives 329.8275 / 376.755 / 427.41, mark-up 10 / 20 / 30, a rise of +29.59 %, and no price for 2027 or 2028.
- **The floor case:** 2523100090 / DZ / (A), 100 t, verified direct 0.1, direct and indirect. That is the mixed tier: direct 10, free allocation 64.935, indirect 4.4, net 4.4, total 14.4, so 30.6 % chargeable.
- **Zero embedded:** verified 0 on 73063077 / IN / (C) gives a total of 0.
- **Descriptions:** 265 of 572 contain `<`, `&`, `>` or `"`, so escaping is exercised by real data.

---

## Standing rules (repeated inside every task)

Every task below opens with this block, because each builder sees only its own task:

> **Standing rules.** Work only in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p2` (branch `feat/cbam-rail-ui-p2`). Never edit a file listed in `src/scripts/cbam-algos/UPSTREAM.json`; `npm run test:unit` runs `scripts/cbam-sync-check.mjs` first and fails on any such edit. `src/scripts/cbam-algos/cbam-app.ts` is ours and may change. Never loosen, skip or delete an assertion: if a test blocks you, the code is wrong. Grep, never count from memory. Stage named paths only (never `git add -A`), and never `git stash`. Scratch files go in `/Volumes/OBOSLab/tmp/`, never `~/` or `/tmp`. Never open a visible browser. Playwright runs headless, in the foreground, through the Bash tool's own timeout (macOS has no `timeout`); the Chromium project is `chromium-tier0`. `npm run test:unit` only after `npm run build`, because about 59 OBOS and heat-map unit tests read `dist/`; for a single file use `node --import tsx --test <file>`, which needs no build. End every commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stop at the time budget and report what is done and what is left.

---

### Task 1: Worktree, branch and baseline

**Budget:** 15 min. **Files:** none.

> **Standing rules.** Work only in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p2` (branch `feat/cbam-rail-ui-p2`). Never edit a file listed in `src/scripts/cbam-algos/UPSTREAM.json`. Never loosen an assertion. Stage named paths only; never `git stash`. Scratch goes in `/Volumes/OBOSLab/tmp/`. `npm run test:unit` only after `npm run build`. Stop at the budget and report.

Context: phase 1 of the CBAM rail redesign is committed on the local branch `feat/cbam-rail-ui` (HEAD `447b4ac`, worktree `/Volumes/OBOSLab/worktrees/cbam-rail-ui`). It has not been pushed: `origin/feat/cbam-rail-ui` does not exist. Phase 2 branches from it. `/Volumes/OBOSLab` is an APFS sparsebundle and must be mounted (`ls /Volumes/OBOSLab` lists `worktrees`).

- [ ] **Step 1: Confirm the base.**

Run: `git -C /Volumes/OBOSLab/worktrees/cbam-rail-ui log --oneline -1 feat/cbam-rail-ui`

Expected: `447b4ac feat(cbam): phase 1 shell complete — lines spec on the views, three shell fixes`. If HEAD has moved, use the new HEAD and say so in the report. If the branch is missing, **stop and report**.

- [ ] **Step 2: Create the branch and worktree.**

```bash
git -C /Volumes/OBOSLab/worktrees/cbam-rail-ui worktree add -b feat/cbam-rail-ui-p2 /Volumes/OBOSLab/worktrees/cbam-rail-ui-p2 feat/cbam-rail-ui
cd /Volumes/OBOSLab/worktrees/cbam-rail-ui-p2 && npm ci
```

- [ ] **Step 3: Baseline.**

Run: `cd /Volumes/OBOSLab/worktrees/cbam-rail-ui-p2 && npm run check && npm run build && npm run test:unit 2>&1 | tail -8`

Expected: check clean; unit `# fail 0`. Record `# pass N` in the report as **BASELINE_UNIT**; Task 13 compares against it. Also record:

```bash
grep -c "^test(" tests/unit/cbam-render.test.mjs          # expected 145
grep -c "^\s*test(" tests/e2e/cbam-lines.spec.ts          # expected 57
grep -c "^\s*test(" tests/e2e/cbam-shell.spec.ts          # expected 8
```

If a count differs, report the measured number and use it from here on.

---

### Task 2: `format.ts` — one spelling of every number, price and tier

**Budget:** 30 min.
**Files:**
- Create: `src/scripts/cbam-ui/format.ts`
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (move only, no behaviour change)
- Test: `tests/unit/cbam-format.test.mjs`

> **Standing rules.** Work only in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p2` (branch `feat/cbam-rail-ui-p2`). Never edit a file listed in `src/scripts/cbam-algos/UPSTREAM.json`; `cbam-app.ts` is ours. Never loosen, skip or delete an assertion. Grep, never count from memory. Stage named paths only; never `git stash`. Scratch goes in `/Volumes/OBOSLab/tmp/`. `npm run test:unit` only after `npm run build`; single files with `node --import tsx --test <file>`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stop at the budget and report.

Context: the new tile renderers (in `src/scripts/cbam-ui/`) must print certificates, euros, tier names, origin basis and the price row with **the same wording** as `cbam-app.ts`. A second spelling of one fact is the defect class this calculator's tests exist to catch. `tiles-estimate.ts` cannot import from `cbam-app.ts`, because `cbam-app.ts` will import `tiles-estimate.ts` and that would be an import cycle. So the shared helpers move to a leaf module. **This is a pure move:** every existing unit test must stay green without edits.

Source-text pins in `tests/unit/cbam-render.test.mjs` that this move must not disturb, all counted over the non-comment lines of `cbam-app.ts`:
- `renderAttestation(` must appear exactly 3 times.
- `renderAttestation\([^()]*hasFigure\(e\)\)` must appear exactly 2 times.
- `\bhasFigure\(` must appear exactly 2 times.
- `isAttested(` must appear exactly 5 times.
- `[!=]==\s*'verified-direct\+default-indirect'` must appear exactly once.
- `const _exhaustive: never = line.tier;` must be present.

**None of these functions moves.**

- [ ] **Step 1: Write the failing test.**

```js
// tests/unit/cbam-format.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { renderPriceRow as fromApp } from '../../src/scripts/cbam-algos/cbam-app.ts';
import {
  eur, num, originBasisLabel, renderPriceRow, snapshotLabel, tierLabel,
} from '../../src/scripts/cbam-ui/format.ts';

test('one price row: cbam-app re-exports the format module\'s, not a copy of it', () => {
  assert.equal(fromApp, renderPriceRow);
});

test('origin basis reads as the stamp has always read it', () => {
  assert.equal(originBasisLabel('residual'), 'Residual bucket');
  assert.equal(originBasisLabel('country'), "Origin's own published value");
  assert.equal(originBasisLabel(null), '—');
});

test('a real hash is shortened to 16 characters and an ellipsis; anything 24 or shorter is shown whole', () => {
  const h = '8bbba79e7f33f0e4943140c28e91a8810612f2fa770bd6dcad33fdb7045e4c05';
  assert.equal(snapshotLabel(h), '8bbba79e7f33f0e4…');
  assert.equal(snapshotLabel('not yet computed'), 'not yet computed');
  assert.equal(snapshotLabel('x'.repeat(24)), 'x'.repeat(24));
});

test('the moved helpers behave exactly as before', () => {
  assert.equal(num('329.8275'), '329.828');
  assert.equal(num('   '), '—');
  assert.equal(eur('24855.80'), '€24,855.80');
  assert.equal(eur(null), '—');
  assert.equal(tierLabel('verified-direct+default-indirect'), 'Verified direct + Commission indirect');
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `node --import tsx --test tests/unit/cbam-format.test.mjs`

Expected: FAIL with "Cannot find module … format.ts".

- [ ] **Step 3: Create `format.ts` by moving code, not retyping it.** Locate each definition:

```bash
grep -n "^const esc = \|^const num = \|^const eur = \|^const inputRefusal = \|^function tierLabel\|^export function renderPriceRow" src/scripts/cbam-algos/cbam-app.ts
```

Cut each of these six definitions out of `cbam-app.ts`, **together with the doc comment directly above it**, and paste them into the new file in this order: `esc`, `num`, `eur`, `inputRefusal`, `tierLabel`, `renderPriceRow`. Add `export` to each `const` and `function`. The file starts and ends like this:

```ts
// src/scripts/cbam-ui/format.ts
// One spelling of every number, price, tier and provenance label the calculator prints. Moved out of
// cbam-app.ts in phase 2 of the rail redesign (spec §7) so the tile renderers in cbam-ui/ print a
// fact in the same words as the line card and the printable document. cbam-app.ts imports these
// back; cbam-ui modules import them directly (importing cbam-app.ts would be a cycle).
import type { CertificateEstimate, DataTier } from '../cbam-algos/cbam/certificate-estimate.ts';

// … the six moved definitions, each with its doc comment, each exported …

/** The stamp's "Origin basis" row: which default sheet answered, in words. */
export function originBasisLabel(basis: CertificateEstimate['stamp']['originBasis']): string {
  return basis === 'residual' ? 'Residual bucket' : basis === 'country' ? "Origin's own published value" : '—';
}

/**
 * The stamp's "Snapshot" row. A real snapshot is a 64-char sha256 and is shortened; anything of 24
 * characters or fewer (the pre-pack 'not yet computed', the vendored 'unsealed-pack') is shown
 * whole, because slicing it would read as a garbled hash (see decorateSnapshot in cbam-app.ts).
 */
export function snapshotLabel(hash: string): string {
  return hash.length > 24 ? `${hash.slice(0, 16)}…` : hash;
}
```

`tierLabel` takes a `DataTier`, so the `import type` covers it. Delete any import the moved code no longer needs, and keep any that it does.

- [ ] **Step 4: Rewire `cbam-app.ts`.** Under its existing imports add:

```ts
import {
  esc, eur, inputRefusal, num, originBasisLabel, renderPriceRow, snapshotLabel, tierLabel,
} from '../cbam-ui/format.ts';
// cbam-render.test.mjs imports renderPriceRow from this module; the format module owns it now.
export { renderPriceRow };
```

In `renderStamp`, replace the two inline expressions with the shared labels, so that the stamp and the new Provenance tile cannot drift apart:

```ts
    ['Origin basis', originBasisLabel(s.originBasis)],
```

```ts
    ['Snapshot', snapshotLabel(s.snapshotHash)],
```

Keep the comment that explains the 24-character rule where it is; it still describes `snapshotLabel`.

- [ ] **Step 5: Confirm the move landed and the pins hold.**

```bash
grep -n "^const esc = \|^const num = \|^const eur = \|^function tierLabel\|^export function renderPriceRow" src/scripts/cbam-algos/cbam-app.ts   # expect: no output
node --import tsx --test tests/unit/cbam-format.test.mjs tests/unit/cbam-render.test.mjs tests/unit/cbam-lines.test.mjs tests/unit/cbam-outlook.test.mjs
npm run check
```

Expected: every test passes (cbam-render: 145 pass, 0 fail); check is clean.

- [ ] **Step 6: Commit.**

```bash
git add -- src/scripts/cbam-ui/format.ts src/scripts/cbam-algos/cbam-app.ts tests/unit/cbam-format.test.mjs
git commit -m "refactor(cbam): one spelling of numbers, prices and tiers in cbam-ui/format.ts

Pure move out of cbam-app.ts so the phase-2 tiles print every fact in the line card's words.
renderPriceRow is re-exported; renderStamp reads originBasisLabel/snapshotLabel.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `fingerprint.ts` — a hash drawn as dots

**Budget:** 25 min.
**Files:**
- Create: `src/scripts/cbam-ui/fingerprint.ts`
- Test: `tests/unit/cbam-fingerprint.test.mjs`

> **Standing rules.** Work only in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p2` (branch `feat/cbam-rail-ui-p2`). Never edit a file listed in `src/scripts/cbam-algos/UPSTREAM.json`. Never loosen an assertion. Stage named paths only; never `git stash`. Scratch goes in `/Volumes/OBOSLab/tmp/`. Single test files with `node --import tsx --test <file>`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stop at the budget and report.

Context: spec §5.1 and §5.5. The Provenance tile (phase 2) and the Export tile (phase 4) draw a hash as an 8×8 grid of dots, so that two copies can be compared at a glance. The grid encodes **the first 64 bits = the first 16 hex characters**, most significant bit first, row by row. That is exactly the prefix the stamp prints as text (`snapshotLabel`: the first 16 characters and an ellipsis), so the dots never reveal more than the text beside them. The preview's grid for snapshot `f6af39ae…` reads `1111 0110 1010 1111 0011 1001 1010 1110` across its first 32 dots, which confirms the bit order. A placeholder such as `not yet computed` or `unsealed-pack` has no bits, so **no grid**. The grid is decoration with a text twin, so it is `aria-hidden`.

- [ ] **Step 1: Write the failing test.**

```js
// tests/unit/cbam-fingerprint.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintBits, renderFingerprint } from '../../src/scripts/cbam-ui/fingerprint.ts';

const bitString = (h) => fingerprintBits(h).map((b) => (b ? '1' : '0')).join('');

test('64 bits: the first 16 hex characters, most significant bit first', () => {
  const bits = fingerprintBits(`0123456789abcdef${'0'.repeat(48)}`);
  assert.equal(bits.length, 64);
  assert.equal(bitString(`0123456789abcdef${'0'.repeat(48)}`),
    '0000000100100011010001010110011110001001101010111100110111101111');
  assert.equal(bits.filter(Boolean).length, 32, 'the popcount of 0..f is 32');
});

test('the order matches the approved preview (snapshot f6af39ae…)', () => {
  assert.ok(bitString(`f6af39ae${'0'.repeat(56)}`).startsWith('11110110101011110011100110101110'));
});

test('case does not change the drawing, and characters past the 16th are not drawn', () => {
  const a = `ABCDEF0123456789${'1'.repeat(48)}`;
  const b = `abcdef0123456789${'f'.repeat(48)}`;
  assert.deepEqual(fingerprintBits(a), fingerprintBits(b));
});

test('a placeholder, or anything shorter than 16 hex characters, has no bits and no grid', () => {
  for (const s of ['not yet computed', 'unsealed-pack', '0123', '', `g${'0'.repeat(63)}`]) {
    assert.equal(fingerprintBits(s), null, s);
    assert.equal(renderFingerprint(s), '', s);
  }
});

test('the grid: 64 dots, hidden from assistive tech, and no hex text in it', () => {
  const h = '8bbba79e7f33f0e4943140c28e91a8810612f2fa770bd6dcad33fdb7045e4c05';
  const html = renderFingerprint(h);
  assert.equal((html.match(/<i\b/g) ?? []).length, 64);
  assert.match(html, /^<div class="b-fp" aria-hidden="true">/);
  assert.doesNotMatch(html, /[0-9a-f]{6}/, 'the drawing must not carry the hash as text');
  assert.equal(renderFingerprint(h), html, 'deterministic');
  assert.match(renderFingerprint(h, 'b-fp-sm'), /^<div class="b-fp b-fp-sm"/);
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `node --import tsx --test tests/unit/cbam-fingerprint.test.mjs`

Expected: FAIL, module not found.

- [ ] **Step 3: Implement.**

```ts
// src/scripts/cbam-ui/fingerprint.ts
// A hash drawn as dots (spec §5.1 Provenance, §5.5 Export): its first 64 bits, the first 16 hex
// characters, as an 8 × 8 grid, most significant bit first, row by row. Exactly the prefix the
// stamp prints as text, so the drawing never shows more than the words beside it. aria-hidden:
// the hex prefix is the accessible form.

const HEX16 = /^[0-9a-f]{16}/i;

/** 64 booleans, or null when the string does not start with 16 hex digits (a placeholder). */
export function fingerprintBits(hash: string): boolean[] | null {
  const m = HEX16.exec(hash);
  if (!m) return null;
  const bits: boolean[] = [];
  for (const ch of m[0]) {
    const n = parseInt(ch, 16);
    for (let b = 3; b >= 0; b -= 1) bits.push(((n >> b) & 1) === 1);
  }
  return bits;
}

/** The dot grid, or '' when there are no bits to draw. `extraClass` is ours, never user text. */
export function renderFingerprint(hash: string, extraClass = ''): string {
  const bits = fingerprintBits(hash);
  if (!bits) return '';
  const cls = extraClass ? `b-fp ${extraClass}` : 'b-fp';
  return `<div class="${cls}" aria-hidden="true">${bits.map((on) => (on ? '<i class="on"></i>' : '<i></i>')).join('')}</div>`;
}
```

- [ ] **Step 4: Run it and confirm it passes.**

Run: `node --import tsx --test tests/unit/cbam-fingerprint.test.mjs`

Expected: 5 pass.

- [ ] **Step 5: Commit.**

```bash
git add -- src/scripts/cbam-ui/fingerprint.ts tests/unit/cbam-fingerprint.test.mjs
git commit -m "feat(cbam): fingerprint.ts — a hash's first 64 bits as an 8x8 dot grid (spec §5.1, §5.5)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `tiles-estimate.ts` — Certificates, Chargeable, Provenance, idle and thrown

**Budget:** 45 min.
**Files:**
- Create: `src/scripts/cbam-ui/tiles-estimate.ts`
- Test: `tests/unit/cbam-tiles-estimate.test.mjs`

> **Standing rules.** Work only in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p2` (branch `feat/cbam-rail-ui-p2`). Never edit a file listed in `src/scripts/cbam-algos/UPSTREAM.json`; you may import from those files. Never loosen an assertion. Grep, never count from memory. Stage named paths only; never `git stash`. Scratch goes in `/Volumes/OBOSLab/tmp/`. Single test files with `node --import tsx --test <file>`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stop at the budget and report.

Context. Spec §5.1: the Estimate view's right column is four tiles, all rendered into `#cbOut` by pure functions returning HTML strings. Today `#cbOut` holds three things: `renderDraftThreshold(...)`, then `renderResult(e)` (a four-branch switch on `e.status`: `ok`, `zero_by_fiat`, `cscf_pending`, `unavailable`), then `renderAttestation(...)`. All are in `src/scripts/cbam-algos/cbam-app.ts`.

This module replaces the middle part for the preview. The threshold card and the attestation are **handed in as finished HTML**: `cbam-render.test.mjs` pins, by counting source text in `cbam-app.ts`, that `renderAttestation(` and `hasFigure(` are called from there exactly as today. Shared formatting comes from `src/scripts/cbam-ui/format.ts` (`esc`, `num`, `eur`, `inputRefusal`, `tierLabel`, `renderPriceRow`, `originBasisLabel`, `snapshotLabel`), and the dots from `src/scripts/cbam-ui/fingerprint.ts` (`renderFingerprint`).

Rules this task must honour:
- **Spec §6.1:** every tile renders every state. A refusal shows the engine's reason verbatim and **no figure of any kind**, not even a zero.
- **Spec §6.4, e2e hooks:** `cbam-lines.spec.ts` reads `#cbOut .cb-n` (exact text), `#cbOut .cb-cost` (exact text), `#cbOut .cb-fig` (visible) and `.cb-thresh`, and asserts `#cbOut` does not contain `tCO` while idle, or `€` on a 2027 line. `.cb-fig`, `.cb-n` and `.cb-cost` must therefore appear **once**, on the hero. The deck must carry no `cb-ol-*` class.
- The threshold card says "the exposure **below** stands", so it renders **first**.
- **Colour law:** bronze = Commission default (+ mark-up), cyan = verified, ink = neither alone (the mixed tier).
- **The Chargeable tile** prints the DIRECT emissions as `Embedded emissions (direct)`, and indirect separately as `+ Indirect (electricity) · no free allocation`. A pinned test forbids folding indirect into "embedded".
- **The chargeable share** is `net ÷ total embedded`, rounded half-up to 1 dp. The free-allocation figure shown is the complement, so the two always sum to 100.0. When `totalEmbeddedTco2e` is 0 there is no share. When the free allocation exceeds the direct emissions, the engine floored the direct charge at zero (`max(0, direct − FA)`), and the tile says so.

Measured on the real pack for the tests below:
- **73063077 / IN / (C) / 100 t / 2026-03-15:** `cscf_pending`, emissions 475.2, FA 145.3725, net 329.8275, total 475.2, certificates 329.8275, €24,855.80, factor 0.975 (2026), price 2026-Q1 €75.36.
- **The same with verified direct 0:** total 0.
- **2523100090 / DZ / (A) / 100 t, direct and indirect, verified direct 0.1:** tier `verified-direct+default-indirect`, direct 10, FA 64.935, indirect 4.4, net 4.4, total 14.4.
- **73063077 / IN / (D) with verified 1.2:** tier `actual-verified`.

- [ ] **Step 1: Write the failing test.**

```js
// tests/unit/cbam-tiles-estimate.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { estimateFromPack } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';
import {
  chargeableSplit, renderEstimateIdle, renderEstimateThrown, renderEstimateTiles, tierTone,
} from '../../src/scripts/cbam-ui/tiles-estimate.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));
const est = (over) => estimateFromPack(pack, {
  cn: '73063077', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15', ...over,
});
const tiles = (e, over = {}) => renderEstimateTiles({
  estimate: e, importDate: '2026-03-15', threshold: '', attestation: '', ...over,
});
const IDLE = 'Choose a good, origin, route, mass and import date to see the provisional exposure.';

test('chargeable share: net over total embedded, one decimal, and the rest is its complement', () => {
  assert.deepEqual(chargeableSplit('475.2', {
    faaTco2e: '145.3725', netTco2e: '329.8275', totalEmbeddedTco2e: '475.2',
    certificates: '329.8275', costEur: '24855.80', indirectTco2e: '0',
  }), { chargeablePct: '69.4', restPct: '30.6', floored: false });
});

test('the tiles for a priced default line: hero, bar, direct embedded, factor, provenance', () => {
  const html = tiles(est());
  assert.ok(html.includes('<div class="b-mega cb-fig"><span class="cb-n">329.828</span></div>'));
  assert.ok(html.includes('<span class="b-tag cb-cost">€24,855.80</span>'));
  assert.equal((html.match(/\bcb-n\b/g) ?? []).length, 1, '#cbOut .cb-n must stay one element');
  assert.equal((html.match(/\bcb-cost\b/g) ?? []).length, 1);
  assert.equal((html.match(/\bcb-fig\b/g) ?? []).length, 1);
  assert.ok(html.includes('style="--share:69.4%"'));
  assert.match(html, />69\.4<span class="b-u">%<\/span>/);
  assert.match(html, />30\.6<span class="b-u">%<\/span>/);
  assert.ok(html.includes('Embedded emissions (direct) · 475.2 tCO₂e'));
  assert.ok(html.includes('145.373 tCO₂e · CBAM factor 2026 0.975'));
  assert.ok(html.includes('329.828 tCO₂e'));
  assert.match(html, /class="chip bronze"><i><\/i>Commission default \+ mark-up</);
  assert.match(html, /b-fill-bronze/);
  assert.doesNotMatch(html, /b-fill-low/, '69.4 % holds its own text');
  assert.doesNotMatch(html, /exceeds the direct emissions/);
  assert.match(html, /Import of 15 Mar 2026/);
  assert.match(html, /<div data-deck><\/div>/, 'the deck slot is painted by paintOutlook');
  assert.doesNotMatch(html, /cb-ol-/, 'the deck must not collide with the strip\'s e2e hooks');
});

test('the engine floor is stated where it applied, and a low share draws the bar as a strip', () => {
  const e = estimateFromPack(pack, {
    cn: '2523100090', country: 'DZ', route: '(A)', massT: '100', date: '2026-03-15',
    emissionsScope: 'direct_and_indirect', verified: { directTco2ePerT: '0.1' },
  });
  assert.equal(e.stamp.tier, 'verified-direct+default-indirect', 'premise: mixed');
  assert.deepEqual(chargeableSplit(e.emissionsTco2e, e.scenario),
    { chargeablePct: '30.6', restPct: '69.4', floored: true });
  const html = tiles(e);
  assert.ok(html.includes('Free allocation exceeds the direct emissions, so the direct charge is zero. It never goes below zero.'));
  assert.ok(html.includes('+ Indirect (electricity) · no free allocation · 4.4 tCO₂e'));
  assert.match(html, /b-fill-ink b-fill-low/, 'mixed tier is ink; 30.6 % is a strip');
  assert.match(html, /class="chip ink"><i><\/i>Verified direct \+ Commission indirect</);
});

test('nothing embedded: no share is invented', () => {
  const e = est({ verified: { directTco2ePerT: '0' } });
  assert.equal(e.scenario.totalEmbeddedTco2e, '0', 'premise');
  assert.equal(chargeableSplit(e.emissionsTco2e, e.scenario), null);
  const html = tiles(e);
  assert.ok(html.includes('style="--share:0%"'));
  assert.match(html, /<div class="b-mid">—<\/div>/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('tier tones follow the colour law', () => {
  assert.equal(tierTone('default+markup'), 'bronze');
  assert.equal(tierTone('actual-verified'), 'cyan');
  assert.equal(tierTone('verified-direct+default-indirect'), 'ink');
  const v = tiles(est({ route: '(D)', verified: { directTco2ePerT: '1.2' } }));
  assert.match(v, /class="chip cyan"><i><\/i>Verified actual</);
  assert.match(v, /b-fill-cyan/);
});

test('idle: the prompt sits in the hero as cb-idle, escaped, and no tile claims anything', () => {
  const html = renderEstimateIdle(IDLE);
  assert.ok(html.includes(`<p class="cb-idle">${IDLE}</p>`));
  for (const re of [/\bcb-fig\b/, /\bcb-cost\b/, /tCO/, /€/, /b-mid/, /b-fp/]) assert.doesNotMatch(html, re);
  assert.ok(renderEstimateIdle('<b>x</b> & y').includes('<p class="cb-idle">&lt;b&gt;x&lt;/b&gt; &amp; y</p>'));
});

test('thrown: "No estimate" and the message, escaped, with no figure', () => {
  const html = renderEstimateThrown('Bad <thing> & more');
  assert.match(html, /cb-tag unavail">No estimate</);
  assert.ok(html.includes('<p class="cb-reason">Bad &lt;thing&gt; &amp; more</p>'));
  assert.doesNotMatch(html, /\bcb-fig\b|\bcb-cost\b|tCO/);
});

test('a refusal keeps the hero, provenance and the reason, and draws no figure anywhere', () => {
  const e = est({ route: '(D)' });
  assert.equal(e.status, 'unavailable', 'premise: (D) has no direct default for India');
  const html = tiles(e);
  assert.ok(html.includes(`<p class="cb-reason">${e.reason.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</p>`));
  assert.match(html, /<span>Missing rule<\/span><code>default\/73063077\/IN\/\(D\)\/2026<\/code>/);
  for (const re of [/\bcb-fig\b/, /\bcb-cost\b/, /tCO/, /b-mid/, /€/]) assert.doesNotMatch(html, re);
  assert.match(html, /Provenance\./);
});

test('the threshold card goes first, whole; no card means no plate', () => {
  const card = '<section class="cb-card cb-thresh">X</section>';
  const html = tiles(est(), { threshold: card });
  assert.ok(html.startsWith(`<div class="b-s2 b-legacy cb-out">${card}</div>`));
  assert.doesNotMatch(tiles(est()), /b-legacy|cb-thresh/);
});

test('the attestation is placed whole, inside the hero', () => {
  const att = '<p class="cb-sub cb-attested">ATTESTED</p>';
  const html = tiles(est(), { attestation: att });
  const hero = /<section class="b-t b-hero[^"]*">[\s\S]*?<\/section>/.exec(html)[0];
  assert.ok(hero.includes(att));
});

test('the page ships the idle tiles as static markup, identical to renderEstimateIdle', () => {
  const page = readFileSync(fileURLToPath(
    new URL('../../src/pages/cbam/cbam-calculator.astro', import.meta.url)), 'utf8');
  const m = /<div id="cbOut" class="b-bento b-out">([\s\S]*?)<\/div>\s*<p class="cb-source" id="cbProv">/.exec(page);
  assert.ok(m, 'the page must carry #cbOut as <div id="cbOut" class="b-bento b-out"> followed by #cbProv');
  const norm = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
  assert.equal(norm(m[1]), norm(renderEstimateIdle(IDLE)));
});
```

The last test stays red until Task 11 writes the markup. Note that in the report; it is expected.

- [ ] **Step 2: Run it and confirm it fails.**

Run: `node --import tsx --test tests/unit/cbam-tiles-estimate.test.mjs`

Expected: FAIL, module not found.

- [ ] **Step 3: Implement.**

```ts
// src/scripts/cbam-ui/tiles-estimate.ts
// The Estimate view's result tiles (spec §5.1): Certificates (the inverted hero), Chargeable (the
// card is the bar), Three years (a stacked deck) and Provenance (the snapshot as dots). Pure
// functions returning HTML strings, like every renderer on this page, so cbam-render.test.mjs can
// render and assert. Every tile renders every state its model can return (spec §6.1).
//
// HOOKS (spec §6.4). The e2e suite reads .cb-fig, .cb-n, .cb-cost, .cb-res, .cb-tag inside #cbOut.
// They sit on the hero ALONE, beside the b- classes, so `#cbOut .cb-n` stays one element. The deck
// carries no cb-ol-* class: cbam-lines.spec.ts reads .cb-ol-n and .cb-ol-yr page-wide.
//
// WHAT IS HANDED IN, NOT BUILT HERE: the de minimis card (renderDraftThreshold) and the
// attestation (renderAttestation(…, hasFigure(e))). cbam-render.test.mjs pins, by source text,
// that cbam-app.ts calls those exactly as it always has; this module only places their output.
import Decimal from 'decimal.js';
import type { CertificateEstimate, DataTier, EstimateFigure } from '../cbam-algos/cbam/certificate-estimate.ts';
import { formatDecimal, formatPackDate, unpricedYears, type Outlook, type OutlookFigureYear } from '../cbam-outlook.ts';
import { renderFingerprint } from './fingerprint.ts';
import {
  esc, eur, inputRefusal, num, originBasisLabel, renderPriceRow, snapshotLabel, tierLabel,
} from './format.ts';

type Priced = Exclude<CertificateEstimate, { status: 'unavailable' }>;

/** The engine's figure for a priced line: the final figure, or the labelled what-if. */
const figureOf = (e: Priced): EstimateFigure => (e.status === 'cscf_pending' ? e.scenario : e.figure);

/** Colour law (spec §3): bronze = Commission default, cyan = verified, ink = neither alone. */
export function tierTone(tier: DataTier): 'bronze' | 'cyan' | 'ink' {
  switch (tier) {
    case 'default+markup': return 'bronze';
    case 'actual-verified': return 'cyan';
    case 'verified-direct+default-indirect': return 'ink';
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

/** The status tag, in renderResult's own words: the tag is what tells a figure from a refusal. */
function statusTag(e: CertificateEstimate): string {
  let tone: 'ok' | 'pending' | 'unavail';
  let text: string;
  switch (e.status) {
    case 'ok': tone = 'ok'; text = 'Priced'; break;
    case 'zero_by_fiat': tone = 'ok'; text = 'Priced · free allocation nil by law'; break;
    case 'cscf_pending': tone = 'pending'; text = `What-if · CSCF for ${e.cscfYear} unpublished`; break;
    case 'unavailable': tone = 'unavail'; text = 'No estimate'; break;
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
  return `<span class="b-tag cb-tag ${tone}">${esc(text)}</span>`;
}

function hero(e: CertificateEstimate, importDate: string, attestation: string): string {
  const head = '<div class="b-t-h"><div><h3 class="b-t-ti">Certificates.</h3>'
    + `<p class="b-t-sub">Import of ${esc(formatPackDate(importDate))}</p></div>`
    + `<span class="chip ${tierTone(e.stamp.tier)}"><i></i>${esc(tierLabel(e.stamp.tier))}</span></div>`;
  if (e.status === 'unavailable') {
    // NON-NEGOTIABLE 2: no figure block, no cost, no zero. The reason and the selector, verbatim.
    const sel = e.selector
      ? `<div class="cb-sel"><span>${inputRefusal(e.selector) ? 'Refused input' : 'Missing rule'}</span>`
        + `<code>${esc(e.selector)}</code></div>`
      : '';
    return `<section class="b-t b-hero b-s2 cb-res cb-unavail">${head}<div class="b-tags">${statusTag(e)}</div>`
      + `<p class="cb-reason">${esc(e.reason)}</p>${sel}`
      + '<p class="b-t-sub">We show no deduction rather than guess one. Picking a nearby benchmark '
      + 'would produce a number that looks authoritative and is not.</p>'
      + `${attestation}</section>`;
  }
  const f = figureOf(e);
  let note: string;
  switch (e.status) {
    case 'ok':
      note = `<p class="b-t-sub">Cross-sectoral correction factor ${esc(e.cscf)}</p>`;
      break;
    case 'zero_by_fiat':
      note = `<p class="b-t-sub">No free allocation applies · ${esc(e.locator)}</p>`;
      break;
    case 'cscf_pending':
      // NON-NEGOTIABLE 3, word for word renderResult's paragraph (a twin test compares the two).
      note = '<p class="b-t-sub cb-warn">Not a final figure. The Commission has not published the '
        + `cross-sectoral correction factor for ${esc(String(e.cscfYear))}; this assumes `
        + `CSCF&nbsp;=&nbsp;${esc(e.scenario.assumedCscf)}, the largest the factor can legally be `
        + '(the last value actually set, 2021–25). CSCF only ever reduces the free allocation that '
        + 'offsets a bill, so this is a floor: the real figure cannot be lower, and may be higher.</p>';
      break;
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
  return `<section class="b-t b-hero b-s2 cb-res">${head}`
    + `<div class="b-mega cb-fig"><span class="cb-n">${num(f.certificates)}</span></div>`
    + '<p class="b-t-sub cb-u">certificates</p>'
    + `<div class="b-tags">${f.costEur ? `<span class="b-tag cb-cost">${eur(f.costEur)}</span>` : ''}${statusTag(e)}</div>`
    + `${renderPriceRow(e)}${note}${attestation}</section>`;
}

export interface ChargeableSplit { chargeablePct: string; restPct: string; floored: boolean }

/**
 * The share of the embedded emissions that is charged, to 1 dp half up, and its complement (so
 * the two always sum to 100.0). Null when nothing is embedded: no share is invented. `floored`
 * is the engine's own floor, max(0, direct − free allocation): FA larger than the direct term.
 */
export function chargeableSplit(directTco2e: string, f: EstimateFigure): ChargeableSplit | null {
  const total = new Decimal(f.totalEmbeddedTco2e);
  if (!total.isFinite() || total.lte(0)) return null;
  const pct = new Decimal(f.netTco2e).div(total).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  return {
    chargeablePct: pct.toFixed(1),
    restPct: new Decimal(100).minus(pct).toFixed(1),
    floored: new Decimal(f.faaTco2e).gt(directTco2e),
  };
}

/** Under this share the fill cannot hold its own text, so it is drawn as a strip (decision 5). */
const LOW_SHARE = 40;
const CHARGEABLE_EMPTY = '<section class="b-t b-fill b-s2 b-fill-none"><div class="b-fl-in">'
  + '<h3 class="b-t-ti">Chargeable.</h3></div></section>';

function chargeable(e: CertificateEstimate): string {
  if (e.status === 'unavailable') return CHARGEABLE_EMPTY;
  const f = figureOf(e);
  const split = chargeableSplit(e.emissionsTco2e, f);
  const low = !split || Number(split.chargeablePct) < LOW_SHARE;
  const share = (v: string | undefined): string => (v === undefined ? '—' : `${v}<span class="b-u">%</span>`);
  // The indirect term is its OWN tag, never folded into "embedded" (pinned in cbam-render.test.mjs).
  const indirect = Number(f.indirectTco2e) > 0
    ? `<span class="b-tag">+ Indirect (electricity) · no free allocation · ${num(f.indirectTco2e)} tCO₂e</span>`
    : '';
  return `<section class="b-t b-fill b-s2 b-fill-${tierTone(e.stamp.tier)}${low ? ' b-fill-low' : ''}" `
    + `style="--share:${split ? split.chargeablePct : '0'}%">`
    + '<i class="b-fl-bar" aria-hidden="true"></i>'
    + '<div class="b-fl-in"><h3 class="b-t-ti">Chargeable.</h3>'
    + `<div class="b-mid">${share(split?.chargeablePct)}</div>`
    + `<p class="b-t-sub">${num(f.netTco2e)} tCO₂e</p></div>`
    + '<div class="b-fl-rest">'
    + `<div class="b-tags"><span class="b-tag">Embedded emissions (direct) · ${num(e.emissionsTco2e)} tCO₂e</span>${indirect}</div>`
    + '<h3 class="b-t-ti">Free allocation.</h3>'
    + `<div class="b-mid">${share(split?.restPct)}</div>`
    + `<p class="b-t-sub">${num(f.faaTco2e)} tCO₂e · CBAM factor ${esc(String(e.terms.cbamFactorYear))} ${esc(e.terms.cbamFactor)}</p>`
    + (split?.floored
      ? '<p class="b-t-sub">Free allocation exceeds the direct emissions, so the direct charge is zero. It never goes below zero.</p>'
      : '')
    + '</div></section>';
}

/** The deck's shell; paintOutlook (cbam-app.ts) fills [data-deck] from the outlook it computes. */
const DECK_SHELL = '<section class="b-t b-s2 b-yrs" aria-live="off">'
  + '<button type="button" class="b-go" data-goto="three-years" aria-label="Open Three years">'
  + '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4 10 10 4M5 4h5v5"/></svg></button>'
  + '<h3 class="b-t-ti">Three years.</h3><div data-deck></div></section>';

const PROVENANCE_EMPTY = '<section class="b-t b-s2 b-prov"><div class="b-pv"><h3 class="b-t-ti">Provenance.</h3></div></section>';

/** NON-NEGOTIABLE 5: the stamp on every branch, refusals included. Notes fold (spec §5.1). */
function provenance(e: CertificateEstimate): string {
  const s = e.stamp;
  const rows: [string, string][] = [
    ['Data tier', tierLabel(s.tier)],
    ['Origin basis', originBasisLabel(s.originBasis)],
    ['Rule packages', s.rulePackages.join(' · ') || '—'],
    ['Snapshot', snapshotLabel(s.snapshotHash)],
  ];
  const notes = s.notes.length
    ? `<details class="disc quiet"><summary><span>Notes · ${s.notes.length}</span>`
      + '<span class="chev" aria-hidden="true">›</span></summary>'
      + `<ul class="notes cb-notes">${s.notes.map((n) => `<li class="foot">${esc(n)}</li>`).join('')}</ul></details>`
    : '';
  return `<section class="b-t b-s2 b-prov">${renderFingerprint(s.snapshotHash)}<div class="b-pv">`
    + '<h3 class="b-t-ti">Provenance.</h3>'
    + `<dl class="kv">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
    + (s.provisional ? '<p class="b-t-sub cb-prov">Provisional — at least one input is not final</p>' : '')
    + `${notes}</div></section>`;
}

export interface EstimateTilesInput {
  estimate: CertificateEstimate;
  /** The form's import date (ISO day), for "Import of 15 Mar 2026". */
  importDate: string;
  /** renderDraftThreshold's output, '' when no card is owed. Rendered first: its copy says "below". */
  threshold: string;
  /** renderAttestation(…, hasFigure(e))'s output, '' for a default line. Placed whole in the hero. */
  attestation: string;
}

export function renderEstimateTiles(t: EstimateTilesInput): string {
  const thresh = t.threshold ? `<div class="b-s2 b-legacy cb-out">${t.threshold}</div>` : '';
  return thresh + hero(t.estimate, t.importDate, t.attestation) + chargeable(t.estimate) + DECK_SHELL
    + provenance(t.estimate);
}

/** Every pre-engine state (incomplete form, no route, mass or verified refusal): the message, escaped. */
export function renderEstimateIdle(message: string): string {
  return `<section class="b-t b-hero b-s2"><h3 class="b-t-ti">Certificates.</h3><p class="cb-idle">${esc(message)}</p></section>`
    + CHARGEABLE_EMPTY + DECK_SHELL + PROVENANCE_EMPTY;
}

/** The engine threw (a DomainError names what is missing): show it, never a generic failure. */
export function renderEstimateThrown(message: string): string {
  return '<section class="b-t b-hero b-s2 cb-res cb-unavail"><div class="b-t-h"><h3 class="b-t-ti">Certificates.</h3>'
    + `<span class="b-tag cb-tag unavail">No estimate</span></div><p class="cb-reason">${esc(message)}</p></section>`
    + CHARGEABLE_EMPTY + DECK_SHELL + PROVENANCE_EMPTY;
}
```

`formatDecimal`, `unpricedYears`, `Outlook` and `OutlookFigureYear` are used by `renderDeck` in Task 5. Leave those imports in now; `astro check` does not fail on an unused import here. If your linter does, add Task 5's function first.

- [ ] **Step 4: Run it.**

Run: `node --import tsx --test tests/unit/cbam-tiles-estimate.test.mjs && npm run check`

Expected: every test passes **except** `the page ships the idle tiles as static markup…`, which fails with "the page must carry #cbOut…" until Task 11. `npm run check` is clean.

- [ ] **Step 5: Commit.**

```bash
git add -- src/scripts/cbam-ui/tiles-estimate.ts tests/unit/cbam-tiles-estimate.test.mjs
git commit -m "feat(cbam): Estimate tiles — hero, chargeable bar, provenance, idle and thrown states (spec §5.1, §6.1)

The static-markup pin stays red until the page markup lands (Task 11).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Three-years deck

**Budget:** 30 min.
**Files:**
- Modify: `src/scripts/cbam-ui/tiles-estimate.ts` (append `renderDeck`)
- Modify: `tests/unit/cbam-tiles-estimate.test.mjs` (append tests)

> **Standing rules.** Work only in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p2` (branch `feat/cbam-rail-ui-p2`). Never edit a file listed in `src/scripts/cbam-algos/UPSTREAM.json`. Never loosen an assertion. Stage named paths only; never `git stash`. Scratch goes in `/Volumes/OBOSLab/tmp/`. Single test files with `node --import tsx --test <file>`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stop at the budget and report.

Context. Spec §5.1: the Estimate view's "Three years." tile is a stacked deck of the 2026, 2027 and 2028 certificate counts for the line being priced. It also shows the rise by the last year, a note on unpublished prices, and a ↗ button to the Three years view. The model is `outlook(pack, input)` in `src/scripts/cbam-outlook.ts`, which returns an `Outlook`:
- `years[]`: each year is either `{kind:'figure', year, certificates, tier, directMarkupPct, riseOnFirstPct, costEur, …}` or `{kind:'refused', year, reason, selector}`.
- `unpricedYears(view)` lists the figure years with no published price.
- `formatDecimal(value, dp, fixed)` formats an exact decimal string.

`cbam-app.ts` already computes the outlook in `paintOutlook`; Task 12 makes it write `renderDeck(view, massT)` into the `[data-deck]` slot that `renderEstimateTiles` renders.

**The deck is inside `#cbOut`**, so e2e constraints apply: on a 2027 or 2028 line, `#cbOut` must contain no `€` and nothing matching `/quarterly|\(pending\)|Q[1-4] certificate price/i`. The deck also must not use any `cb-ol-*` class. **Colour law:** the bronze deck (rising mark-up) is for a line whose figure years are all on Commission defaults; anything else is drawn in ink.

Measured: 73063077 / IN / (C) / 100 t / 2026-03-15 gives certificates 329.8275, 376.755 and 427.41; mark-up 10, 20 and 30; the last year's `riseOnFirstPct` is 29.586…; unpriced years are 2027 and 2028. 72052100 / IN / (G) / 60 t refuses in all three years with one reason. 28080000 / DZ / default prices with mark-up 1, 1 and 1. 73063077 / IN / (D) with verified direct 1.2 has `directMarkupPct` null.

- [ ] **Step 1: Append the failing tests** to `tests/unit/cbam-tiles-estimate.test.mjs`. Add `renderDeck` to its import from `tiles-estimate.ts`, and add this import line under the others:

```js
import { outlook } from '../../src/scripts/cbam-outlook.ts';
```

```js
const ol = (over) => outlook(pack, {
  cn: '73063077', country: 'IN', route: '(C)', massT: '100', date: '2026-03-15',
  emissionsScope: 'direct_and_indirect', ...over,
});

test('the deck: three counts, the mark-up from the model, the rise, and the missing prices', () => {
  const html = renderDeck(ol(), '100');
  assert.ok(html.includes('<p class="b-t-sub">Same line, same 100 t. Mark-up 10 → 20 → 30%.</p>'));
  for (const [i, y, n] of [[0, 2026, '329.8'], [1, 2027, '376.8'], [2, 2028, '427.4']]) {
    assert.ok(html.includes(`<li class="b-st b-st${i}"><span>${y}</span><b>${n}</b></li>`), `${y}`);
  }
  assert.ok(html.includes('+29.6% by 2028 · No certificate price published for the 2027 and 2028 imports'));
  assert.match(html, /class="b-stack b-stack-bz"/);
  assert.doesNotMatch(html, /€|quarterly|\(pending\)|Q[1-4] certificate price|cb-ol-/i);
});

test('the deck reads the mark-up from the model, never a constant', () => {
  const fert = renderDeck(ol({ cn: '28080000', country: 'DZ', route: 'default' }), '100');
  assert.match(fert, /Mark-up 1 → 1 → 1%\./);
  const verified = renderDeck(ol({ route: '(D)', verified: { directTco2ePerT: '1.2' } }), '100');
  assert.doesNotMatch(verified, /Mark-up/, 'an attested direct figure carries no mark-up');
  assert.match(verified, /class="b-stack b-stack-ink"/);
});

test('refused years say so, with the engine\'s reason verbatim, grouped, and no count', () => {
  const view = ol({ cn: '72052100', route: '(G)', massT: '60' });
  assert.ok(view.years.every((y) => y.kind === 'refused'), 'premise');
  const html = renderDeck(view, '60');
  assert.equal((html.match(/<b>No estimate<\/b>/g) ?? []).length, 3);
  const reason = view.years[0].reason.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  assert.ok(html.includes(`<p class="b-help">2026, 2027 and 2028: ${reason}</p>`));
  assert.doesNotMatch(html, /Mark-up|by 2028/);
});

test('no outlook, no deck', () => {
  assert.equal(renderDeck(null, '100'), '');
});

test('the mass is escaped: it is the user\'s own text', () => {
  assert.match(renderDeck(ol(), '<b>'), /same &lt;b&gt; t\./);
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `node --import tsx --test tests/unit/cbam-tiles-estimate.test.mjs`

Expected: the new tests fail with "renderDeck is not a function" (or "not exported").

- [ ] **Step 3: Append the implementation** to `src/scripts/cbam-ui/tiles-estimate.ts`:

```ts
/* ── the Three-years deck (filled into [data-deck] by paintOutlook) ──────────── */

/** "+29.6%", "−3.1%", "0.0%": exact, one decimal, half up (the strip's own rule). */
const signedPct = (v: string): string => {
  const text = formatDecimal(v, 1, true);
  return text.startsWith('−') || new Decimal(v).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).isZero()
    ? `${text}%` : `+${text}%`;
};

const yearList = (ys: readonly number[]): string => (ys.length <= 1
  ? ys.join('')
  : `${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]}`);

/**
 * The deck: one plate per covered year, the count to 1 dp (the strip's precision), or "No
 * estimate" with the engine's reason beneath. Counts only, never euros: the costs live on the
 * Three years view, which states whose price each one is.
 */
export function renderDeck(view: Outlook | null, massT: string): string {
  if (!view) return '';
  const figs = view.years.filter((y): y is OutlookFigureYear => y.kind === 'figure');
  const allDefault = figs.length > 0 && figs.every((y) => y.tier === 'default+markup');
  const markups = figs.map((y) => y.directMarkupPct);
  const markup = figs.length === view.years.length && markups.every((m): m is string => m !== null)
    ? ` Mark-up ${markups.map((m) => formatDecimal(m, 2, false)).join(' → ')}%.`
    : '';
  const plates = view.years.map((y, i) => (y.kind === 'figure'
    ? `<li class="b-st b-st${i}"><span>${y.year}</span><b>${formatDecimal(y.certificates, 1, true)}</b></li>`
    : `<li class="b-st b-st${i} b-st-none"><span>${y.year}</span><b>No estimate</b></li>`)).join('');
  const foot: string[] = [];
  const first = view.years[0];
  const last = view.years[view.years.length - 1];
  if (first.kind === 'figure' && last.kind === 'figure' && last !== first && last.riseOnFirstPct !== null) {
    foot.push(`${signedPct(last.riseOnFirstPct)} by ${last.year}`);
  }
  const unpriced = unpricedYears(view);
  if (unpriced.length) foot.push(`No certificate price published for the ${yearList(unpriced)} imports`);
  const reasons = new Map<string, number[]>();
  for (const y of view.years) {
    if (y.kind === 'refused') reasons.set(y.reason, [...(reasons.get(y.reason) ?? []), y.year]);
  }
  const why = [...reasons].map(([r, ys]) => `<p class="b-help">${yearList(ys)}: ${esc(r)}</p>`).join('');
  return `<p class="b-t-sub">Same line, same ${esc(massT)} t.${markup}</p>`
    + `<ol class="b-stack ${allDefault ? 'b-stack-bz' : 'b-stack-ink'}">${plates}</ol>`
    + (foot.length ? `<p class="b-t-foot">${foot.map(esc).join(' · ')}</p>` : '')
    + why;
}
```

- [ ] **Step 4: Run it.**

Run: `node --import tsx --test tests/unit/cbam-tiles-estimate.test.mjs && npm run check`

Expected: everything passes except the static-markup pin, which stays red until Task 11. Check is clean.

- [ ] **Step 5: Commit.**

```bash
git add -- src/scripts/cbam-ui/tiles-estimate.ts tests/unit/cbam-tiles-estimate.test.mjs
git commit -m "feat(cbam): the Three-years deck on Estimate — counts, model mark-up, rise, refusals (spec §5.1)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Port the 19 Estimate render tests to the tiles (twins, none loosened)

**Budget:** 40 min.
**Files:**
- Modify: `tests/unit/cbam-render.test.mjs` (add two imports at the top, and append one section at the end; **edit nothing else**)

> **Standing rules.** Work only in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p2` (branch `feat/cbam-rail-ui-p2`). Never edit a file listed in `src/scripts/cbam-algos/UPSTREAM.json`. **Never loosen, skip, reword or delete an existing assertion in this file. This task only adds.** Grep, never count from memory. Stage named paths only; never `git stash`. Scratch goes in `/Volumes/OBOSLab/tmp/`. Single test files with `node --import tsx --test <file>`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stop at the budget and report.

Context. Spec §6.1: every assertion that pinned the Estimate result card is carried to the new renderer, `renderEstimateTiles` in `src/scripts/cbam-ui/tiles-estimate.ts`. Its signature is `({ estimate, importDate, threshold, attestation }) → string`; there is also `renderDeck(outlook, massT)`, `renderEstimateIdle(msg)` and `renderEstimateThrown(msg)`.

The originals keep testing `renderResult`, because the List view's line card still uses it until phase 4. So each original stays **unchanged** and gains a **twin** named `tiles — <original name>`.

Two tightenings, both stricter than the originals and never looser:
- The originals assert `doesNotMatch(html, /class="cb-fig"/)`. The tiles put the hook beside design classes (`class="b-mega cb-fig"`), so that literal could never match and the twin would pass vacuously. The twins match the hook as a word, `/\bcb-fig\b/` and `/\bcb-cost\b/`, **and** assert the hooks are present on a priced line first ("the detector can detect").
- Twins compare against the original renderer's output where wording matters, so a paraphrase fails.

These helpers already exist in this file, with their line numbers today: `run(cn, country, route, massT, date)` (≈35), `draft(cn, massT, date)` (≈323), `withScope(scope)` (≈371), `ATTESTED_NOTE` (≈1769), `vline(over)` (≈1795), `estOf(l)` (≈1806), `mline(over)` (≈1866), `dline(over)` (≈2764) and `docOf(lines, results)` (≈2769). Check them with `grep -n "^const run \|^const draft\|^const withScope\|^const ATTESTED_NOTE\|^const vline\|^const estOf\|^const mline\|^const docOf" tests/unit/cbam-render.test.mjs`. All are module-level, so the appended tests can use them.

- [ ] **Step 1: Record the count before.**

Run: `grep -c "^test(" tests/unit/cbam-render.test.mjs`

Expected: 145. Write the number down; Step 4 expects it plus 16.

- [ ] **Step 2: Add the imports.** In the import block at the top of the file, add:

```js
import { outlook } from '../../src/scripts/cbam-outlook.ts';
import {
  renderDeck, renderEstimateIdle, renderEstimateThrown, renderEstimateTiles,
} from '../../src/scripts/cbam-ui/tiles-estimate.ts';
```

- [ ] **Step 3: Append the twins at the very end of the file.**

```js
/* ── PHASE 2 (rail redesign): the Estimate tiles carry every assertion the result card carried ──
 *
 * Spec §6.1. The preview's result card is now four tiles (tiles-estimate.ts). renderResult still
 * renders the List view's line card until phase 4, so the tests above stay and guard that card;
 * each test here is a TWIN of one above, by name, asserting the same property on the tiles.
 *
 * TIGHTER, NEVER LOOSER. The tiles carry hooks beside design classes (class="b-mega cb-fig"), so
 * the originals' literal /class="cb-fig"/ could never match them and a doesNotMatch on it would
 * pass vacuously. Here the hooks are matched as words, and every absence is preceded by a premise
 * that the same detector fires on a priced line.
 */
const tiles = (e, over = {}) => renderEstimateTiles({
  estimate: e, importDate: '2026-03-15', threshold: '', attestation: '', ...over,
});
const FIG = /\bcb-fig\b/;
const COST = /\bcb-cost\b/;
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

test('tiles — the indirect component is shown as its own line, never folded into embedded', () => {
  const e = withScope('direct_and_indirect');
  const html = tiles(e);
  assert.match(html, /Indirect \(electricity\)/i, 'the indirect term must be visible');
  assert.match(html, /no free allocation/i, 'and must say it gets no deduction');
  assert.match(html, /Embedded emissions \(direct\)/i,
    'the direct term must be labelled direct, or the two read as one number');
  // The figure beside "direct" is the DIRECT term, never direct + indirect.
  assert.ok(html.includes(`Embedded emissions (direct) · ${Number(e.emissionsTco2e).toLocaleString('en-GB', { maximumFractionDigits: 3 })} tCO₂e`));
  assert.ok(!html.includes(`Embedded emissions (direct) · ${Number(e.scenario.totalEmbeddedTco2e).toLocaleString('en-GB', { maximumFractionDigits: 3 })} tCO₂e`),
    'premise: direct (136.4) and total (140.8) differ on this line, so this would catch a fold');
});

test('tiles — a direct-only sector is unaffected by the scope control', () => {
  assert.match(tiles(withScope('direct_and_indirect')), /Indirect \(electricity\)/i,
    'premise: the detector fires where an indirect term exists');
  const ask = estimateFromPack(pack, { cn: '72083800', country: 'IN', route: '(C)',
    massT: '100', date: '2026-03-15', emissionsScope: 'direct_and_indirect' });
  assert.doesNotMatch(tiles(ask), /Indirect \(electricity\)/i,
    'no indirect row when there is no indirect default');
});

test('tiles — NON-NEGOTIABLE 2 — a refusal renders NO figure of any kind', () => {
  const priced = tiles(run('2523100090', 'DZ', '(A)', '100'));
  assert.match(priced, FIG, 'premise: the figure hook is detectable on a priced line');
  assert.match(priced, COST, 'premise: and the cost hook');
  const html = tiles(run('72052100', 'IN', '(C)', '60'));
  assert.match(html, /No estimate/i, 'the refusal must be stated, not implied');
  assert.match(html, /benchmark\/72052100\/column-B\/\(C\)\/2026-03-15/,
    'the missing rule selector must be shown verbatim');
  assert.doesNotMatch(html, FIG, 'a refusal must not render the figure block — no number, not even zero');
  assert.doesNotMatch(html, COST, 'a refusal must not render a cost');
  assert.doesNotMatch(html, /class="b-mid"/, 'and the Chargeable tile shows no share');
  assert.match(html, /<section class="b-t b-fill b-s2 b-fill-none">/,
    'the Chargeable tile is the empty plate: no tonnage, no share');
});

test('tiles — NON-NEGOTIABLE 3 — CSCF-pending is labelled a what-if, never a figure', () => {
  const e = run('2523100090', 'DZ', '(A)', '100');
  const html = tiles(e);
  assert.match(html, /What-if/i, 'the scenario must be labelled as one');
  assert.match(html, /unpublished/i, 'it must say the factor is unpublished');
  assert.match(html, /CSCF\s*(&nbsp;)?=(&nbsp;)?\s*1/, 'the assumed CSCF must be stated, not buried');
  assert.match(html, /Not a final figure/i, 'it must say outright that this is not final');
  const para = (s) => /<p class="[^"]*\bcb-warn\b[^"]*">([\s\S]*?)<\/p>/.exec(s)?.[1].replace(/\s+/g, ' ').trim();
  assert.ok(para(renderResult(e)), 'premise: the card has the paragraph');
  assert.equal(para(html), para(renderResult(e)), 'the same paragraph, word for word — no paraphrase');
});

test('tiles — NON-NEGOTIABLE 5 — the provenance stamp travels on EVERY branch', () => {
  for (const [label, e] of [
    ['priced', run('2523100090', 'DZ', '(A)', '100')],
    ['refused', run('72241010', 'IN', '(F)', '60')],
    ['refused (certain)', run('72052100', 'IN', '(C)', '60')],
  ]) {
    const html = tiles(e);
    assert.match(html, /Provenance/, `${label}: the stamp must render`);
    assert.match(html, /Origin basis/, `${label}: originBasis must be shown`);
    assert.match(html, /Snapshot/, `${label}: the snapshot hash must be shown`);
    assert.match(html, /Data tier/, `${label}: the tier must be shown`);
    assert.match(html, /Rule packages/, `${label}: the rule packages must be shown`);
  }
});

test('tiles — NON-NEGOTIABLE 4 — nothing claims a filing or registry validation', () => {
  const outputs = [
    tiles(run('2523100090', 'DZ', '(A)', '100')), tiles(run('72241010', 'IN', '(F)', '60')),
    renderEstimateIdle('Choose a good, origin, route, mass and import date to see the provisional exposure.'),
    renderEstimateThrown('x'),
  ];
  for (const raw of outputs) {
    const html = raw.toLowerCase();
    for (const forbidden of ['filed', 'submitted to the', 'validated by', 'registry-approved']) {
      assert.ok(!html.includes(forbidden),
        `the readout must never claim "${forbidden}" — it is decision-support, not a declaration`);
    }
  }
});

test('tiles — the residual sheet answers for unlisted ORIGINS, never for a good a listed sheet omits', () => {
  const unlisted = run('76041010', 'AF', '(K)', '100');
  assert.equal(unlisted.stamp.originBasis, 'residual', 'premise');
  const worldAverage = ['210.843', '15,889.09', '355.63', '144.788'];
  const unlistedTiles = tiles(unlisted);
  for (const figure of worldAverage) {
    assert.ok(unlistedTiles.includes(figure),
      `premise: the residual tiles print ${figure}, so looking for it means something`);
  }
  const refused = run('76041010', 'DZ', '(K)', '100');
  assert.equal(refused.status, 'unavailable', 'premise');
  const refusedTiles = tiles(refused);
  assert.doesNotMatch(refusedTiles, FIG, 'a refusal must render no figure block');
  for (const figure of worldAverage) {
    assert.ok(!refusedTiles.includes(figure),
      `the residual world average must not reach a listed origin's tiles — found ${figure}`);
  }
  // The deck sits inside #cbOut too, so it is held to the same rule.
  const deck = renderDeck(outlook(pack, { cn: '76041010', country: 'DZ', route: '(K)', massT: '100',
    date: '2026-03-15', emissionsScope: 'direct_and_indirect' }), '100');
  for (const figure of [...worldAverage, '210.8']) {
    assert.ok(!deck.includes(figure), `nor the deck — found ${figure}`);
  }
});

test('tiles — a residual-basis figure says so — it must not read as the origin\'s own value', () => {
  let residual = null;
  for (const c of pack.classifications.slice(0, 120)) {
    for (const country of ['IN', 'TR', 'CN', 'BR']) {
      const rs = routesFor(pack, c.code, country, 2026);
      if (!rs.length) continue;
      const e = run(c.code, country, rs[0], '10');
      if (e.stamp?.originBasis === 'residual') { residual = e; break; }
    }
    if (residual) break;
  }
  if (!residual) return; // as the original: none in the sampled slice; covered by the AF line above
  assert.match(tiles(residual), /Residual bucket/,
    'a residual-derived figure must name its basis, or a reader believes the Commission '
    + 'priced their country when it did not');
});

test('tiles — the renderer handles every status the engine can return', () => {
  const tagOf = { ok: 'Priced', zero_by_fiat: 'Priced · free allocation nil by law', unavailable: 'No estimate' };
  const seen = new Set();
  for (const [cn, country, route] of [['2523100090', 'DZ', '(A)'], ['72052100', 'IN', '(C)'], ['72083800', 'IN', '(C)']]) {
    const e = run(cn, country, route, '10');
    seen.add(e.status);
    const html = tiles(e);
    assert.ok(html.includes('cb-res'), `${e.status}: must render a result block`);
    assert.ok(html.length > 200, `${e.status}: output looks empty`);
    const tag = e.status === 'cscf_pending' ? `What-if · CSCF for ${e.cscfYear} unpublished` : tagOf[e.status];
    assert.ok(html.includes(`>${tag}</span>`), `${e.status}: the status tag must name the branch`);
  }
  assert.ok(seen.size >= 2, `expected several statuses across probes, saw ${[...seen]}`);
});

test('tiles — the pre-pack fallback text renders in full, never truncated as though it were a hash', () => {
  const e = decorateSnapshot(run('2523100090', 'DZ', '(A)', '100'), '');
  const html = tiles(e);
  assert.match(html, /not yet computed/, 'the fallback text must appear in full');
  assert.doesNotMatch(html, /not yet comput(?!ed)/, 'must not be cut off mid-word');
  assert.doesNotMatch(html, /unsealed-pack/);
  assert.doesNotMatch(html, /class="b-fp/, 'a placeholder is not a hash: no dots are drawn for it');
});

test('tiles — renderStamp truncates a genuine 64-hex-char snapshotHash to its first 16 chars plus an ellipsis', () => {
  const realHash = '8bbba79e7f33f0e4943140c28e91a8810612f2fa770bd6dcad33fdb7045e4c05';
  const html = tiles(decorateSnapshot(run('2523100090', 'DZ', '(A)', '100'), realHash));
  assert.match(html, new RegExp(`${realHash.slice(0, 16)}…`));
  assert.doesNotMatch(html, new RegExp(realHash), 'the full digest must not be printed');
  assert.doesNotMatch(html, new RegExp(realHash.slice(16, 24)), 'nor any hex past the shown prefix');
  assert.equal((/<div class="b-fp"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1].match(/<i\b/g) ?? []).length, 64,
    'the dots draw the same 64 bits the text shows');
});

test('tiles — a 2027 or 2028 date counts certificates, with no price and no cost', () => {
  for (const [date, quarter] of [['2027-03-15', '2027-Q1'], ['2028-12-31', '2028-Q4']]) {
    const input = { cn: '2523100090', country: 'DZ', route: '(A)', massT: '100', date,
      emissionsScope: 'direct_and_indirect' };
    const e = estimateFromPack(pack, input);
    assert.equal(e.status, 'cscf_pending', date);
    assert.equal(e.scenario.costEur, null, date);
    const html = tiles(e, { importDate: date });
    assert.match(html, FIG, `${date}: a count must be shown`);
    assert.ok(html.includes(`<span>Certificate price · imports in ${quarter}</span><b>none published</b>`),
      `${date}: the price row must read "imports in ${quarter}" and "none published"`);
    assert.ok(html.includes(
      `The Commission has not published a certificate price for imports in ${quarter}, so no cost is shown.`),
      `${date}: the engine's note, whole`);
    for (const out of [html, renderDeck(outlook(pack, input), '100')]) {
      assert.doesNotMatch(out, /Q[1-4] certificate price|Certificate price 20\d\d-Q|quarterly|\(pending\)/i,
        `${date}: no wording that presents a quarterly price for this year`);
      assert.doesNotMatch(out, /€/, `${date}: no euro figure of any kind`);
    }
  }
});

test('tiles — the price row: a published price shows it; an unpublished one says "none published", never "pending"', () => {
  const published = run('2523100090', 'DZ', '(A)', '100');
  const row = renderPriceRow(published);
  assert.equal(row, '<div class="cb-row"><span>Certificate price · imports in 2026-Q1</span><b>€75.36</b></div>');
  assert.ok(tiles(published).includes(row), 'the hero carries the price row, exactly');
  const pending = estimateFromPack(pack, { cn: '2523100090', country: 'DZ', route: '(A)', massT: '100', date: '2027-03-15' });
  assert.ok(tiles(pending, { importDate: '2027-03-15' })
    .includes('<div class="cb-row"><span>Certificate price · imports in 2027-Q1</span><b>none published</b></div>'));
});

test('tiles — §1 marks a verified row and transcribes the reference the importer cited (one tier label)', () => {
  for (const [l, ref] of [[vline({ verifiedRef: 'DNV-2026-0042' }), 'DNV-2026-0042'],
    [mline({ verifiedRef: 'BV-2026-0142' }), 'BV-2026-0142']]) {
    const e = estOf(l);
    const card = renderResult(e).match(/<span>Data tier<\/span><b>([^<]+)<\/b>/);
    const tile = tiles(e).match(/<dt>Data tier<\/dt><dd>([^<]+)<\/dd>/);
    assert.ok(card && tile, 'sanity: both render a Data tier row');
    assert.equal(tile[1], card[1], 'the tile names the tier in the card\'s own words');
    assert.ok(docOf([l], [e]).includes(`${tile[1]} — ref ${ref}`),
      'and in the document\'s, so the screen and the paper agree');
  }
});

test('tiles — renderAttestation gates on the TIER: the preview\'s attestation is placed whole, a default line carries none', () => {
  const v = vline({ verifiedRef: 'DNV-2026-0042' });
  const e = estOf(v);
  const att = renderAttestation({ tier: e.stamp.tier, verifiedRef: 'DNV-2026-0042' }, e.status !== 'unavailable');
  assert.ok(att.includes(ATTESTED_NOTE), 'premise: a verified preview owes the attestation');
  assert.ok(tiles(e, { attestation: att }).includes(att), 'the tiles place it whole, not trimmed or reworded');
  const d = run('2523100090', 'DZ', '(A)', '100');
  assert.doesNotMatch(tiles(d, { attestation: renderAttestation({ tier: d.stamp.tier }, true) }), /cb-attested/);
});

test('tiles — the preview\'s de minimis card: carried byte for byte, first, and no plate when none is owed', () => {
  // Twin of: "a year with no published threshold row gets a card on the PREVIEW too, not silence",
  // "the other three nulls stay silent — an absent card is the right answer for them" and
  // "a year that HAS a published row is untouched — the same card, byte for byte".
  const e = run('2523100090', 'DZ', '(A)', '30');
  for (const [m, date] of [['10', '2026-03-15'], ['100', '2026-03-15'], ['30', '2027-03-15']]) {
    const card = draft('2523100090', m, date);
    assert.ok(card.length > 0, `premise: ${m} t on ${date} owes a card`);
    const html = tiles(e, { threshold: card });
    assert.ok(html.includes(card), 'the card, byte for byte');
    assert.ok(html.indexOf(card) < html.indexOf('cb-res'),
      'first: its own copy says "the exposure below stands"');
  }
  for (const silent of [draft('28041000', '10'), draft('99999999', '10'), draft('2523100090', 'abc')]) {
    assert.equal(silent, '', 'premise: the three nulls stay silent');
    assert.doesNotMatch(tiles(e, { threshold: silent }), /cb-thresh|b-legacy/, 'and leave no empty plate');
  }
});
```

- [ ] **Step 4: Run and count.**

```bash
node --import tsx --test tests/unit/cbam-render.test.mjs 2>&1 | tail -6
grep -c "^test(" tests/unit/cbam-render.test.mjs
git diff --stat -- tests/unit/cbam-render.test.mjs
```

Expected: `# fail 0`; the count is the Step 1 number plus 16 (that is, 161); the diff shows insertions only. Run `git diff -- tests/unit/cbam-render.test.mjs | grep '^-[^-]'`, which must print nothing: no existing line changed.

If a twin fails, the **tile** is wrong. Fix it in `src/scripts/cbam-ui/tiles-estimate.ts`, re-run, and commit that file too.

- [ ] **Step 5: Commit.**

```bash
git add -- tests/unit/cbam-render.test.mjs
git commit -m "test(cbam): the Estimate tiles carry every result-card assertion (19 twins, spec §6.1)

Originals untouched: renderResult still renders the List card until phase 4. Hooks matched as
words with positive premises, so no twin can pass vacuously.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `inputs-estimate.ts` — route segments, verified-only marker, ruler, date caption, radio mirror

**Budget:** 45 min.
**Files:**
- Create: `src/scripts/cbam-ui/inputs-estimate.ts`
- Test: `tests/unit/cbam-inputs-estimate.test.mjs`

> **Standing rules.** Work only in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p2` (branch `feat/cbam-rail-ui-p2`). Never edit a file listed in `src/scripts/cbam-algos/UPSTREAM.json`; you may import from them. Never loosen an assertion. Grep, never count from memory. Stage named paths only; never `git stash`. Scratch goes in `/Volumes/OBOSLab/tmp/`. Single test files with `node --import tsx --test <file>`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stop at the budget and report.

Context. Spec §5.1, steps 2–5 of the Estimate input column, and §6.5 (accessibility).

**Step 2, routes.** The production route is chosen with **segmented buttons** (`role="radiogroup"` of `role="radio"`), mirrored to the **hidden native `<select id="cbRoute">`**. That select stays the source of truth: `cbam-app.ts` rebuilds its `<option>`s in `syncRoutes()` by assigning `innerHTML`, sets `.disabled`, sometimes sets `.value` programmatically (one published route is auto-picked), and listens for `change` on it. The e2e suite still drives it with `selectOption`.

So the mirror must do three things:
- Re-render the buttons whenever the options are replaced (a `MutationObserver` on `childList` and the `disabled` attribute; the observer runs in a microtask after `syncRoutes` finishes, so it reads the final `.value`).
- Re-sync `aria-checked` on the select's `change`, **without re-rendering**, so the focused button keeps focus.
- Write `select.value` and dispatch a bubbling `change` when a button is clicked or chosen with the arrow keys. This is the WAI-ARIA radio-group pattern: arrows move and select, focus is roving `tabindex`, and Home/End are supported.

When the select is disabled, its single option's text is the reason (for example "Choose a good and origin first", or "no rules published for 2029"). That text must be **visible** as text (audit M3: "never only inside a disabled control").

A route the Commission publishes **no default value** for is priceable only from verified figures. Ask the engine itself: on the defaults tier, the estimate refuses with `failure.code === 'NO_DIRECT_DEFAULT'`. `cbam-app.ts` (Task 12) marks such options with a `data-vo` attribute, and the mirror draws a cyan dot.

Measured:
- 73063077 / IN / 2026: routes `(C)`, `(D)`, `(E)`, of which `(D)` and `(E)` are verified-only.
- 2523100090 / DZ / 2026: routes `(A)`, `(B)`, of which `(B)` is verified-only.
- Route `'default'` is shown as "Single route", as the select's own text does.

**Step 5, emissions data.** Two option cards mirror the hidden `<select id="cbTier">` (`default+markup` | `actual-verified`). Same mirror, with no re-render, because the cards are static markup.

**Step 3, date.** A caption gives the price period: "Certificate price · imports in 2026-Q1: €75.36", or "…: none published". It is built from `pack.prices` (rows `{quarter, priceEur}`) and the date as the engine parses it (`parseRegulatoryDate(date)` returns `{ok, year, quarter}`). A strip of four quarters marks the date's quarter. It shows nothing for an unreadable date or a quarter with no row; `#cbDateNote` speaks for that case.

**Step 4, mass.** A ruler runs from 0 to twice the de minimis threshold, with the threshold mark at the middle. It is drawn from `resolveThreshold(pack, {cn, massT, date})` (a `ThresholdView`: `knownEligibleMassT`, `thresholdT`, `calendarYear`), and shows nothing when that is null (hydrogen, no rule for the year, or unreadable input). It is `aria-hidden`; the de minimis card in `#cbOut` carries the verdict in words.

- [ ] **Step 1: Write the failing test.**

```js
// tests/unit/cbam-inputs-estimate.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveThreshold, routesFor } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';
import {
  renderDatePeriod, renderMassRuler, renderRouteSegments, segmentLabel, verifiedOnlyNote, verifiedOnlyRoutes,
} from '../../src/scripts/cbam-ui/inputs-estimate.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));

test('verified-only routes are the ones the ENGINE refuses on defaults for want of a direct default', () => {
  const rs = routesFor(pack, '73063077', 'IN', 2026);
  assert.deepEqual(rs, ['(C)', '(D)', '(E)'], 'premise');
  assert.deepEqual([...verifiedOnlyRoutes(pack, '73063077', 'IN', 2026, rs)], ['(D)', '(E)']);
  const dz = routesFor(pack, '2523100090', 'DZ', 2026);
  assert.deepEqual([...verifiedOnlyRoutes(pack, '2523100090', 'DZ', 2026, dz)], ['(B)']);
});

test('the verified-only note names the routes and the origin, and is silent when there are none', () => {
  assert.equal(verifiedOnlyNote(['(D)', '(E)'], 'India'),
    '(D) and (E) price from verified figures only: no Commission default from India.');
  assert.equal(verifiedOnlyNote(['(B)'], 'Algeria'),
    '(B) prices from verified figures only: no Commission default from Algeria.');
  assert.equal(verifiedOnlyNote([], 'India'), '');
  assert.equal(segmentLabel('default'), 'Single route');
  assert.equal(segmentLabel('(C)'), '(C)');
});

const opt = (value, text, over = {}) => ({ value, text, selected: false, disabled: false, verifiedOnly: false, ...over });

test('segments: one radio per offered route, the pick checked, verified-only marked, roving tabindex', () => {
  const html = renderRouteSegments([
    opt('', 'Select a production route…', { disabled: true }),
    opt('(C)', '(C) Carbon steel · blast furnace / basic oxygen furnace', { selected: true }),
    opt('(D)', '(D) x', { verifiedOnly: true }),
  ]);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 2, 'the placeholder is not a route');
  assert.match(html, /aria-checked="true" tabindex="0" data-value="\(C\)"/);
  assert.match(html, /class=" b-vo" aria-checked="false" tabindex="-1" data-value="\(D\)" aria-label="\(D\) x, verified figures only">\(D\)<i aria-hidden="true"><\/i>/);
});

test('segments: with nothing chosen, the first route takes the tab stop and none is checked', () => {
  const html = renderRouteSegments([opt('(A)', '(A)'), opt('(B)', '(B)')]);
  assert.doesNotMatch(html, /aria-checked="true"/);
  assert.match(html, /aria-checked="false" tabindex="0" data-value="\(A\)"/);
});

test('segments: a disabled select\'s reason is shown as text, escaped (audit M3)', () => {
  assert.equal(renderRouteSegments([opt('', 'no rules published for 2029')]),
    '<p class="b-help b-seg-empty">no rules published for 2029</p>');
  assert.match(renderRouteSegments([opt('', '<x>')]), /&lt;x&gt;/);
  assert.equal(renderRouteSegments([]), '');
});

test('the mass ruler: 0 to twice the threshold, the line\'s mass as the fill, nothing when no rule applies', () => {
  const t = resolveThreshold(pack, { cn: '2523100090', massT: '30', date: '2026-03-15' });
  assert.equal(t.thresholdT, '50', 'premise');
  const html = renderMassRuler(t);
  assert.ok(html.startsWith('<div class="b-thr" style="--fill:30.0%"><b></b><em></em></div>'));
  assert.ok(html.includes('<span>50 t de minimis · 2026</span>'));
  assert.match(renderMassRuler(resolveThreshold(pack, { cn: '2523100090', massT: '400', date: '2026-03-15' })), /--fill:100\.0%/);
  assert.equal(renderMassRuler(null), '');
  assert.equal(renderMassRuler(resolveThreshold(pack, { cn: '28041000', massT: '10', date: '2026-03-15' })), '', 'hydrogen');
});

test('the date caption: the engine\'s quarter and the pack\'s price, or "none published"', () => {
  assert.equal(renderDatePeriod(pack.prices, '2026-03-15'),
    '<div class="b-qtr" aria-hidden="true"><i class="on"></i><i></i><i></i><i></i></div>'
    + '<p class="b-help">Certificate price · imports in 2026-Q1: €75.36</p>');
  assert.match(renderDatePeriod(pack.prices, '2026-08-03'), /<i><\/i><i><\/i><i class="on"><\/i><i><\/i>.*imports in 2026-Q3: €82\.32/);
  assert.match(renderDatePeriod(pack.prices, '2027-03-15'), /imports in 2027-Q1: none published<\/p>$/);
  assert.equal(renderDatePeriod(pack.prices, ''), '');
  assert.equal(renderDatePeriod(pack.prices, '2027-1-15'), '');
  assert.equal(renderDatePeriod(pack.prices, '2029-03-15'), '', 'no row: #cbDateNote speaks instead');
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `node --import tsx --test tests/unit/cbam-inputs-estimate.test.mjs`

Expected: FAIL, module not found.

- [ ] **Step 3: Implement.**

```ts
// src/scripts/cbam-ui/inputs-estimate.ts
// The Estimate input column's controls (spec §5.1 steps 2–5, §6.5): route segments and option
// cards mirrored to the hidden native <select>s that cbam-app.ts reads, the verified-only marker,
// the de minimis ruler and the price-period caption. Pure renderers plus one DOM helper.
import Decimal from 'decimal.js';
import { parseRegulatoryDate } from '../cbam-algos/cbam/input.ts';
import { estimateFromPack, type EstimatorPack, type ThresholdView } from '../cbam-algos/estimator/estimate-from-pack.ts';
import { esc, eur, num } from './format.ts';

/** One <option> of a mirrored select, as the mirror reads it. */
export interface RouteOption {
  value: string;
  text: string;
  selected: boolean;
  disabled: boolean;
  /** The option carries data-vo: priceable from verified figures only. */
  verifiedOnly: boolean;
}

export const segmentLabel = (value: string): string => (value === 'default' ? 'Single route' : value);

/**
 * The offered routes the Commission publishes NO direct default value for: on the defaults tier
 * the engine refuses them with NO_DIRECT_DEFAULT, while their benchmark resolves (routesFor only
 * offers routes it can benchmark), so the importer's verified figures price them. Asked of the
 * engine itself, never inferred. The default lookup is keyed on the reporting year alone, so a
 * fixed day in that year and a 1 t mass stand in for the form's.
 */
export function verifiedOnlyRoutes(
  pack: EstimatorPack, cn: string, country: string, year: number, routes: readonly string[],
): Set<string> {
  const out = new Set<string>();
  for (const route of routes) {
    try {
      const e = estimateFromPack(pack, { cn, country, route, massT: '1', date: `${year}-01-01`, emissionsScope: 'direct' });
      if (e.status === 'unavailable' && e.failure.code === 'NO_DIRECT_DEFAULT') out.add(route);
    } catch {
      // A thrown estimate says nothing about the default; leave the route unmarked.
    }
  }
  return out;
}

export function verifiedOnlyNote(labels: readonly string[], origin: string): string {
  if (!labels.length) return '';
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `${list} ${labels.length === 1 ? 'prices' : 'price'} from verified figures only: no Commission default from ${origin}.`;
}

/** The radios for a route select. A select with no route to offer shows its reason as text (M3). */
export function renderRouteSegments(opts: readonly RouteOption[]): string {
  const live = opts.filter((o) => o.value !== '' && !o.disabled);
  if (!live.length) {
    const reason = opts[0]?.text ?? '';
    return reason ? `<p class="b-help b-seg-empty">${esc(reason)}</p>` : '';
  }
  const anyChecked = live.some((o) => o.selected);
  return live.map((o, i) => {
    const tab = o.selected || (!anyChecked && i === 0) ? '0' : '-1';
    const name = o.verifiedOnly ? `${o.text}, verified figures only` : o.text;
    return `<button type="button" role="radio" class="${o.selected ? 'on' : ''}${o.verifiedOnly ? ' b-vo' : ''}" `
      + `aria-checked="${o.selected}" tabindex="${tab}" data-value="${esc(o.value)}" aria-label="${esc(name)}">`
      + `${esc(segmentLabel(o.value))}${o.verifiedOnly ? '<i aria-hidden="true"></i>' : ''}</button>`;
  }).join('');
}

/** 0 → twice the threshold, the threshold mark at the middle. Decoration: the card says the verdict. */
export function renderMassRuler(t: ThresholdView | null): string {
  if (!t) return '';
  let fill: string;
  try {
    const thr = new Decimal(t.thresholdT);
    if (!thr.isFinite() || thr.lte(0)) return '';
    fill = Decimal.min(1, new Decimal(t.knownEligibleMassT).div(thr.times(2))).times(100).toFixed(1);
  } catch {
    return '';
  }
  return `<div class="b-thr" style="--fill:${fill}%"><b></b><em></em></div>`
    + `<p class="b-help b-thr-l2"><span>0</span><span>${num(t.thresholdT)} t de minimis · ${t.calendarYear}</span><span>above</span></p>`;
}

/** The quarter strip and the price row for the date's quarter, as the engine will look it up. */
export function renderDatePeriod(prices: readonly { quarter: string; priceEur: string | null }[], date: string): string {
  const p = parseRegulatoryDate(date);
  if (!p.ok) return '';
  const row = prices.find((r) => r.quarter === p.quarter);
  if (!row) return '';
  const q = Number(p.quarter.slice(-1));
  const strip = `<div class="b-qtr" aria-hidden="true">${[1, 2, 3, 4].map((n) => (n === q ? '<i class="on"></i>' : '<i></i>')).join('')}</div>`;
  return `${strip}<p class="b-help">Certificate price · imports in ${esc(p.quarter)}: ${row.priceEur ? eur(row.priceEur) : 'none published'}</p>`;
}

/**
 * Mirror a hidden native <select> into a role="radiogroup" of role="radio" buttons (spec §6.5).
 * The select stays the source of truth: a pick writes select.value and dispatches a bubbling
 * `change`, exactly as a user changing the select would. With `render`, the buttons are rebuilt
 * whenever the options are replaced (cbam-app.ts's syncRoutes assigns innerHTML); without it, the
 * group's static buttons are only re-checked. A `change` never rebuilds, so focus survives arrows.
 */
export function mountRadioMirror(
  select: HTMLSelectElement,
  group: HTMLElement,
  render?: (opts: RouteOption[]) => string,
): void {
  const radios = (): HTMLElement[] => [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
  const read = (): RouteOption[] => [...select.options].map((o) => ({
    value: o.value,
    text: o.text,
    selected: o.selected && o.value !== '',
    disabled: o.disabled,
    verifiedOnly: o.hasAttribute('data-vo'),
  }));
  const syncChecked = (): void => {
    const rs = radios();
    const current = rs.find((r) => r.dataset.value === select.value && select.value !== '') ?? null;
    for (const r of rs) {
      const on = r === current;
      r.setAttribute('aria-checked', String(on));
      r.classList.toggle('on', on);
      r.tabIndex = -1;
    }
    const stop = current ?? rs[0];
    if (stop) stop.tabIndex = 0;
    group.setAttribute('aria-disabled', String(select.disabled));
  };
  const rebuild = (): void => {
    if (render) {
      const hadFocus = group.contains(document.activeElement);
      group.innerHTML = render(read());
      syncChecked();
      if (hadFocus) radios().find((r) => r.tabIndex === 0)?.focus();
    } else {
      syncChecked();
    }
  };
  const pick = (r: HTMLElement): void => {
    const v = r.dataset.value ?? '';
    if (select.disabled || v === select.value) { syncChecked(); return; }
    select.value = v;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  group.addEventListener('click', (ev) => {
    const r = (ev.target as Element | null)?.closest<HTMLElement>('[role="radio"]');
    if (r && group.contains(r)) pick(r);
  });
  group.addEventListener('keydown', (ev) => {
    const rs = radios();
    const i = rs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    let j = -1;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') j = (i + 1) % rs.length;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') j = (i - 1 + rs.length) % rs.length;
    else if (ev.key === 'Home') j = 0;
    else if (ev.key === 'End') j = rs.length - 1;
    else if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); pick(rs[i]); return; }
    if (j < 0) return;
    ev.preventDefault();
    rs[j].focus();
    pick(rs[j]);
  });
  select.addEventListener('change', syncChecked);
  new MutationObserver(rebuild).observe(select, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'],
  });
  rebuild();
}
```

- [ ] **Step 4: Run it.**

Run: `node --import tsx --test tests/unit/cbam-inputs-estimate.test.mjs && npm run check`

Expected: 7 pass; check clean. `mountRadioMirror` has no unit test (this repo has no DOM in unit tests); `tests/e2e/cbam-estimate.spec.ts` (Task 10) drives it in three browsers.

- [ ] **Step 5: Commit.**

```bash
git add -- src/scripts/cbam-ui/inputs-estimate.ts tests/unit/cbam-inputs-estimate.test.mjs
git commit -m "feat(cbam): Estimate inputs — route segments, verified-only marker, ruler, price caption, radio mirror (spec §5.1, §6.5)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `good-sheet.ts` — search, sector chips, results, the dialog

**Budget:** 45 min.
**Files:**
- Create: `src/scripts/cbam-ui/good-sheet.ts`
- Test: `tests/unit/cbam-good-sheet.test.mjs`

> **Standing rules.** Work only in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p2` (branch `feat/cbam-rail-ui-p2`). Never edit a file listed in `src/scripts/cbam-algos/UPSTREAM.json`; you may import from them. Never loosen an assertion. Grep, never count from memory. Stage named paths only; never `git stash`. Scratch goes in `/Volumes/OBOSLab/tmp/`. Single test files with `node --import tsx --test <file>`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stop at the budget and report.

Context. Spec §5.1 step 1 and §6.5. The Good step's **Change** pill opens the **good sheet**: a dialog sliding in from the left over the input column. It holds a search box, five sector chips and a result list over `pack.classifications` (572 rows of `{code, description}`, where descriptions are the Commission's own and 265 contain `<`, `&`, `>` or `"`).

Picking a result writes the code into `#cbCn` (the visible text input `cbam-app.ts` reads) and dispatches `input` **and then `change`**, because `cbam-app.ts` reacts on `change` (its `onPick`), exactly as the e2e suite does after `fill`.

The dialog's behaviour:
- `role="dialog"`, `aria-modal="true"`, labelled.
- Esc and the scrim close it, and focus returns to the pill.
- While it is open, everything outside it is `inert` (`.cbx-rail`, `.cbx-top`, `.cbx-main`, `.cbx-tabs`), and Tab wraps inside it.

The pack loads lazily (37 MB, on first interaction), so the sheet asks for the goods through an injected `load()` that `cbam-app.ts` binds to its `ensurePack()`.

Sectors come from the vendored `sectorForCn(code)` in `src/scripts/cbam-algos/cbam/sector.ts` (returns `'cement' | 'iron_and_steel' | 'aluminium' | 'fertilisers' | 'hydrogen' | 'electricity' | null`). Measured over the 572 goods: iron & steel 478, aluminium 58, fertilisers 27, cement 8, hydrogen 1, electricity 0. Hence the spec's five chips, with no Electricity chip.

Spec D5: a good's "short name" is its full CN description, clamped to two lines by CSS, with the full text in `title`. No names are invented. Under `#cbCn`, `#cbCnName` shows that description once the code is known.

- [ ] **Step 1: Write the failing test.**

```js
// tests/unit/cbam-good-sheet.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { sectorForCn } from '../../src/scripts/cbam-algos/cbam/sector.ts';
import {
  RESULT_LIMIT, SECTOR_CHIPS, goodCaption, renderGoodResults, renderSectorChips, searchGoods,
} from '../../src/scripts/cbam-ui/good-sheet.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));
const goods = pack.classifications;

test('five chips, one per sector the pack prices, in the spec\'s order; no electricity good exists', () => {
  assert.deepEqual(SECTOR_CHIPS.map((c) => c.label), ['Iron & steel', 'Aluminium', 'Cement', 'Fertilisers', 'Hydrogen']);
  const counts = Object.fromEntries(SECTOR_CHIPS.map((c) => [c.key, searchGoods(goods, '', c.key).length]));
  assert.deepEqual(counts, { iron_and_steel: 478, aluminium: 58, cement: 8, fertilisers: 27, hydrogen: 1 });
  assert.equal(goods.filter((g) => sectorForCn(g.code) === 'electricity').length, 0,
    'the sheet says "No electricity goods are priced here"; that must stay true of the pack');
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), goods.length, 'every good sits under a chip');
});

test('a number searches codes by prefix; spaces and dots in a typed code are ignored', () => {
  const r = searchGoods(goods, '7306', null);
  assert.equal(r.length, 22);
  assert.ok(r.every((g) => g.code.startsWith('7306')));
  assert.deepEqual(searchGoods(goods, '2523 10', null).map((g) => g.code), ['2523100010', '2523100090']);
  assert.deepEqual(searchGoods(goods, '2523.10', null), searchGoods(goods, '252310', null));
});

test('words search descriptions: every word, any order, any case', () => {
  const r = searchGoods(goods, 'welded tube', null);
  assert.equal(r.length, 25);
  assert.ok(r.every((g) => /welded/i.test(g.description) && /tube/i.test(g.description)));
  assert.deepEqual(searchGoods(goods, '  TUBE   Welded ', null), r);
  assert.ok(r.some((g) => g.code === '73063077'));
});

test('a sector narrows the search, and an empty query lists the sector', () => {
  const steel = searchGoods(goods, 'welded tube', 'iron_and_steel');
  assert.ok(steel.every((g) => sectorForCn(g.code) === 'iron_and_steel'));
  assert.deepEqual(searchGoods(goods, '', 'hydrogen').map((g) => g.code), ['28041000']);
});

test('results: escaped, capped, the current code marked, and a no-match says what to try', () => {
  const tube = goods.find((g) => g.code === '73063077');
  const html = renderGoodResults([tube], '73063077');
  assert.ok(html.includes('data-code="73063077"'));
  assert.match(html, /class="b-res on"/);
  assert.ok(html.includes('&lt;= 168,3 mm'), 'the Commission\'s "<=" is escaped');
  assert.ok(html.includes('&quot;gas pipe&quot;'));
  const all = renderGoodResults(goods, '');
  assert.equal((all.match(/class="b-res(?: on)?"/g) ?? []).length, RESULT_LIMIT);
  assert.ok(all.includes(`Showing ${RESULT_LIMIT} of ${goods.length}. Narrow the search to see the rest.`));
  assert.match(renderGoodResults([], ''), /No good matches/);
});

test('the caption under #cbCn is the full CN description, or nothing for an unknown code', () => {
  assert.equal(goodCaption(goods, '73063077'), goods.find((g) => g.code === '73063077').description);
  assert.equal(goodCaption(goods, ' 73063077 '), goodCaption(goods, '73063077'));
  assert.equal(goodCaption(goods, '99999999'), '');
});

test('the chips render pressed state, and the page uses this renderer (one spelling)', () => {
  const html = renderSectorChips('cement');
  assert.equal((html.match(/<button /g) ?? []).length, 5);
  assert.match(html, /data-sector="cement" aria-pressed="true">Cement</);
  assert.match(html, /data-sector="iron_and_steel" aria-pressed="false">Iron &amp; steel</);
  const page = readFileSync(fileURLToPath(
    new URL('../../src/pages/cbam/cbam-calculator.astro', import.meta.url)), 'utf8');
  assert.match(page, /set:html=\{renderSectorChips\(null\)\}/, 'the sheet\'s chips come from this module');
});
```

The last test fails until Task 11 adds the sheet markup. Note that in the report.

- [ ] **Step 2: Run it and confirm it fails.**

Run: `node --import tsx --test tests/unit/cbam-good-sheet.test.mjs`

Expected: FAIL, module not found.

- [ ] **Step 3: Implement.**

```ts
// src/scripts/cbam-ui/good-sheet.ts
// The good sheet (spec §5.1 step 1, §6.5): search the goods the pack prices by CN code or by the
// Commission's own description, narrow by CBAM sector, pick one. Writes #cbCn and dispatches
// `input` then `change` (cbam-app.ts prices on `change`). A modal dialog: labelled, Esc and the
// scrim close it, the page behind is inert, focus returns to the trigger.
import { sectorForCn } from '../cbam-algos/cbam/sector.ts';
import { esc } from './format.ts';

export interface Good { code: string; description: string }

/** Spec §5.1's five chips. No Electricity: measured, 0 of 572 goods are electricity. */
export const SECTOR_CHIPS = [
  { key: 'iron_and_steel', label: 'Iron & steel' },
  { key: 'aluminium', label: 'Aluminium' },
  { key: 'cement', label: 'Cement' },
  { key: 'fertilisers', label: 'Fertilisers' },
  { key: 'hydrogen', label: 'Hydrogen' },
] as const;
export type SectorKey = (typeof SECTOR_CHIPS)[number]['key'];

/** Rendering 572 buttons on every keystroke is wasteful; the count says how many more there are. */
export const RESULT_LIMIT = 50;

/** A number searches codes by prefix (spaces and dots dropped); words must all occur in the description. */
export function searchGoods(goods: readonly Good[], query: string, sector: SectorKey | null): Good[] {
  const pool = sector ? goods.filter((g) => sectorForCn(g.code) === sector) : [...goods];
  const q = query.trim().toLowerCase();
  if (!q) return pool;
  const digits = q.replace(/[\s.]/g, '');
  if (/^\d+$/.test(digits)) return pool.filter((g) => g.code.startsWith(digits));
  const words = q.split(/\s+/);
  return pool.filter((g) => {
    const d = g.description.toLowerCase();
    return words.every((w) => d.includes(w));
  });
}

/** The full CN description for a code (spec D5: no invented short names), or '' if unknown. */
export function goodCaption(goods: readonly Good[], code: string): string {
  const c = code.trim();
  return goods.find((g) => g.code === c)?.description ?? '';
}

export function renderSectorChips(active: SectorKey | null): string {
  return SECTOR_CHIPS.map((c) => `<button type="button" class="b-chipbtn" data-sector="${c.key}" `
    + `aria-pressed="${c.key === active}">${esc(c.label)}</button>`).join('');
}

export function renderGoodResults(list: readonly Good[], current: string): string {
  if (!list.length) return '<p class="b-help">No good matches. Try a CN code, or one word of its description.</p>';
  const shown = list.slice(0, RESULT_LIMIT);
  const more = list.length > RESULT_LIMIT
    ? `<p class="b-help">Showing ${RESULT_LIMIT} of ${list.length}. Narrow the search to see the rest.</p>`
    : '';
  return `<ul class="b-reslist">${shown.map((g) => `<li><button type="button" class="b-res${g.code === current ? ' on' : ''}" `
    + `data-code="${esc(g.code)}"><b class="num">${esc(g.code)}</b><span class="b-res-d">${esc(g.description)}</span></button></li>`).join('')}</ul>${more}`;
}

export interface GoodSheetDeps {
  /** #cbx, the app root: its rail, top bar, main and tabs go inert while the sheet is open. */
  root: HTMLElement;
  sheet: HTMLElement;
  scrim: HTMLElement;
  trigger: HTMLButtonElement;
  /** #cbCn. */
  input: HTMLInputElement;
  /** #cbCnName: the picked good's description, or its initial hint when the code is unknown. */
  caption: HTMLElement | null;
  /** cbam-app.ts's ensurePack(), narrowed to the classifications. Memoized there. */
  load: () => Promise<readonly Good[] | null>;
}

const OUTSIDE = '.cbx-rail, .cbx-top, .cbx-main, .cbx-tabs';

export function mountGoodSheet(d: GoodSheetDeps): void {
  const search = d.sheet.querySelector<HTMLInputElement>('[data-good-search]');
  const chips = d.sheet.querySelector<HTMLElement>('[data-good-chips]');
  const results = d.sheet.querySelector<HTMLElement>('[data-good-results]');
  const count = d.sheet.querySelector<HTMLElement>('[data-good-count]');
  if (!search || !chips || !results) return;
  const hint = d.caption?.textContent ?? '';
  let goods: readonly Good[] | null = null;
  let sector: SectorKey | null = null;

  const paint = (): void => {
    if (!goods) { results.innerHTML = '<p class="b-help">Loading the goods list…</p>'; return; }
    const list = searchGoods(goods, search.value, sector);
    results.innerHTML = renderGoodResults(list, d.input.value.trim());
    if (count) count.textContent = `${list.length} ${list.length === 1 ? 'good' : 'goods'}`;
  };
  const ensure = async (): Promise<readonly Good[] | null> => {
    if (!goods) goods = await d.load();
    return goods;
  };
  const caption = async (): Promise<void> => {
    if (!d.caption) return;
    const g = await ensure();
    const text = g ? goodCaption(g, d.input.value) : '';
    d.caption.textContent = text || hint;
    if (text) d.caption.title = text; else d.caption.removeAttribute('title');
  };
  const setInert = (on: boolean): void => {
    d.root.querySelectorAll<HTMLElement>(OUTSIDE).forEach((el) => el.toggleAttribute('inert', on));
  };
  const open = async (): Promise<void> => {
    d.scrim.hidden = false;
    d.sheet.hidden = false;
    setInert(true);
    d.trigger.setAttribute('aria-expanded', 'true');
    search.value = '';
    sector = null;
    chips.innerHTML = renderSectorChips(null);
    paint();
    search.focus();
    if (!goods) {
      if (await ensure()) paint();
      else results.innerHTML = '<p class="b-help">The goods list could not be loaded. Type the CN code in the Good field instead.</p>';
    }
  };
  const close = (): void => {
    if (d.sheet.hidden) return;
    d.sheet.hidden = true;
    d.scrim.hidden = true;
    setInert(false);
    d.trigger.setAttribute('aria-expanded', 'false');
    d.trigger.focus();
  };
  const choose = (code: string): void => {
    d.input.value = code;
    d.input.dispatchEvent(new Event('input', { bubbles: true }));
    d.input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    void caption();
  };

  d.trigger.addEventListener('click', () => { void open(); });
  d.scrim.addEventListener('click', close);
  search.addEventListener('input', paint);
  d.sheet.addEventListener('click', (ev) => {
    const t = ev.target as Element | null;
    if (t?.closest('[data-good-close]')) { close(); return; }
    const chip = t?.closest<HTMLElement>('[data-sector]');
    if (chip) {
      const key = chip.dataset.sector as SectorKey;
      sector = sector === key ? null : key;
      chips.innerHTML = renderSectorChips(sector);
      chips.querySelector<HTMLElement>(`[data-sector="${key}"]`)?.focus();
      paint();
      return;
    }
    const res = t?.closest<HTMLElement>('[data-code]');
    if (res?.dataset.code) choose(res.dataset.code);
  });
  d.sheet.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key !== 'Tab') return;
    const f = [...d.sheet.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.hasAttribute('disabled'));
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  });
  d.input.addEventListener('change', () => { void caption(); });
}
```

- [ ] **Step 4: Run it.**

Run: `node --import tsx --test tests/unit/cbam-good-sheet.test.mjs && npm run check`

Expected: every test passes except `the chips render pressed state, and the page uses this renderer`, whose page half waits for Task 11. Check is clean.

- [ ] **Step 5: Commit.**

```bash
git add -- src/scripts/cbam-ui/good-sheet.ts tests/unit/cbam-good-sheet.test.mjs
git commit -m "feat(cbam): the good sheet — search by code or description, five sector chips, modal dialog (spec §5.1, §6.5)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `cbam-bento.css` — shared tile primitives, the Estimate section, the sheet, and an AA contrast test

**Budget:** 45 min.
**Files:**
- Create: `src/styles/cbam-bento.css`
- Test: `tests/unit/cbam-bento-contrast.test.mjs`

> **Standing rules.** Work only in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p2` (branch `feat/cbam-rail-ui-p2`). Never edit a file listed in `src/scripts/cbam-algos/UPSTREAM.json`. Never loosen an assertion. Stage named paths only; never `git stash`. Scratch goes in `/Volumes/OBOSLab/tmp/`. Single test files with `node --import tsx --test <file>`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stop at the budget and report.

Context.
- **The visual authority is the approved preview**: `docs/superpowers/specs/2026-11-02-cbam-rail-ui/preview/bento.css` (its "Estimate v2" and "editors" sections) and `screens/1-estimate-desktop-dark.jpg`, `1-estimate-desktop-light.jpg`, `1-estimate-phone-*.jpg` and `7-good-sheet-*.jpg`. Look at them.
- **Class names are the preview's own, verbatim** (`b-t`, `b-hero`, `b-fill`, `b-fl-in`, `b-stack`, `b-st0`, `b-prov`, `b-fp`, `b-inp`, `b-step`, `b-field`, `b-segrow`, `b-opt`, `b-sheet`, `b-chipbtn`, `b-res`, …), so that phases 3 and 4 can append their own view sections to this file with the same primitives.
- **Everything is scoped under `.cbx`**, the app root (phase 1's `src/styles/cbam-app.css` holds the shell, the theme tokens `--ground --card --well --well-2 --line --ink --ink-2 --ink-3 --on-ink --focus --shadow --bronze-t/-f/-bg --cyan-t/-f/-bg`, and the `.cbx[data-theme="dark"]` twin).
- **NOT in this phase:** the `.b-ill-*` illustrations and the `b-anim` keyframes (phase 5). Do not port them, and do not leave placeholders for them.

Rules:
- Plates have no outline (`border:0`).
- Animate nothing.
- The hero is inverted (ink plate, on-ink text).
- Colours that pair text with a background are **plain hex tokens defined here**, never `color-mix`. The contrast test below reads them, so AA is checked in **both** themes. The theme stays dark-by-default until phase 4, but these tiles must pass in light as well.

`.cbx-main` is the scroll container. Phone is under 900 px; the preview stacks to one column under 1100 px. The page also carries legacy scoped styles (`.cb-banner`, `.cb-eyebrow`, `.cb-source`, `.cb-datenote`, `.cb-check`) drawn for a dark ground. This file overrides them inside `.cbx` so the light theme stays legible. Those selectors need a specificity of (0,3,0) or more to beat Astro's scoped `(0,2,0)`.

- [ ] **Step 1: Write the failing contrast test.**

```js
// tests/unit/cbam-bento-contrast.test.mjs
// Every text/background and mark/track pair the Estimate tiles draw, held to WCAG 2.2 AA in BOTH
// themes (spec §6.5). Reads the token blocks of cbam-app.css and cbam-bento.css, so a token edit
// that breaks contrast fails here rather than in an axe run nobody looked at.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
const app = read('src/styles/cbam-app.css');
const bento = read('src/styles/cbam-bento.css');

const block = (css, selector) => {
  const at = css.indexOf(`${selector}{`);
  assert.ok(at >= 0, `${selector}{ … } must exist`);
  return css.slice(at + selector.length + 1, css.indexOf('}', at));
};
const tokens = (body) => Object.fromEntries(
  [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)].map((m) => [m[1], m[2].trim()]));

const LIGHT = { ...tokens(block(app, '.cbx')), ...tokens(block(bento, '.cbx')) };
const DARK = { ...LIGHT, ...tokens(block(app, '.cbx[data-theme="dark"]')), ...tokens(block(bento, '.cbx[data-theme="dark"]')) };

const parse = (v) => {
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (m) { const p = m[1].split(',').map((s) => parseFloat(s)); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error(`cannot evaluate colour "${v}": tile colours must be hex or rgba`);
};
const over = (top, base) => [0, 1, 2].map((i) => top[i] * top[3] + base[i] * (1 - top[3]));
const colour = (theme, ref) => {
  if (Array.isArray(ref)) return over(parse(theme[ref[0]] ?? ref[0]), colour(theme, ref[1]));
  const c = parse(theme[ref] ?? ref);
  assert.equal(c[3], 1, `${ref} is translucent: name the surface it sits on, as [token, base]`);
  return c.slice(0, 3);
};
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const CARD_WELL = ['--well', '--card'];
const PAIRS = [
  // plates and inputs
  ['--ink', '--card', 4.5], ['--ink-2', '--card', 4.5], ['--ink-3', '--card', 4.5],
  ['--ink', CARD_WELL, 4.5], ['--ink-2', CARD_WELL, 4.5], ['--ink-3', CARD_WELL, 4.5],
  ['--ink', ['--well-2', '--card'], 4.5],
  ['--bronze-t', ['--bronze-bg', '--card'], 4.5], ['--cyan-t', ['--cyan-bg', '--card'], 4.5],
  ['--cyan-t', CARD_WELL, 4.5], ['--ink-3', ['--cyan-bg', '--card'], 4.5],
  ['--on-ink', '--ink', 4.5],
  // on the ground: the §7.1 banner, the eyebrow, the rules line
  ['--bronze-t', ['--bronze-bg', '--ground'], 4.5], ['--ink-3', '--ground', 4.5],
  // the inverted hero
  ['--hero-muted', '--ink', 4.5], ['--hero-bronze', '--ink', 4.5], ['--hero-cyan', '--ink', 4.5],
  ['--on-ink', '--hero-well', 4.5], ['--hero-bronze', '--hero-well', 4.5], ['--hero-cyan', '--hero-well', 4.5],
  // the chargeable fills (text on them, and the bar against its track: 3:1, WCAG 1.4.11)
  ['--fill-bz-ink', '--fill-bz', 4.5], ['--fill-cy-ink', '--fill-cy', 4.5],
  ['--fill-bz', CARD_WELL, 3], ['--fill-cy', CARD_WELL, 3], ['--ink', CARD_WELL, 3],
  // the three-years deck
  ['--deck-ink-1', '--deck-1', 4.5], ['--deck-ink-2', '--deck-2', 4.5],
];

for (const [name, theme] of [['light', LIGHT], ['dark', DARK]]) {
  test(`every Estimate text and mark clears WCAG AA in the ${name} theme`, () => {
    const fails = [];
    for (const [fg, bg, min] of PAIRS) {
      const r = ratio(colour(theme, fg), colour(theme, bg));
      if (r < min) fails.push(`${fg} on ${JSON.stringify(bg)}: ${r.toFixed(2)} < ${min}`);
    }
    assert.deepEqual(fails, []);
  });
}

test('the OS-dark block and [data-theme="dark"] carry the same tile tokens', () => {
  assert.deepEqual(tokens(block(bento, '.cbx:not([data-theme="light"])')), tokens(block(bento, '.cbx[data-theme="dark"]')));
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `node --import tsx --test tests/unit/cbam-bento-contrast.test.mjs`

Expected: FAIL with ENOENT for `cbam-bento.css`.

- [ ] **Step 3: Create the stylesheet.** The first rule in the file **must** be the light token block `.cbx{…}`, because the test reads the first `.cbx{`.

```css
/* src/styles/cbam-bento.css — the bento tiles (spec §4.3, §5). Class names are the approved
   preview's own (docs/superpowers/specs/2026-11-02-cbam-rail-ui/preview/bento.css), verbatim, so
   phases 3–4 append their view sections here with the same primitives. Scoped under .cbx.
   Not here until phase 5: the .b-ill-* illustrations and the b-anim entry motion. */

/* Tile tokens. Every text/background pair below is held to WCAG AA in both themes by
   tests/unit/cbam-bento-contrast.test.mjs, which parses these blocks: plain hex only. */
.cbx{--hero-muted:#BFC1BD;--hero-well:#2A2C2A;--hero-bronze:#E0B766;--hero-cyan:#6FCAD6;--fill-bz:#A87A28;--fill-bz-ink:#141614;--fill-cy:#0B6E7C;--fill-cy-ink:#FFFFFF;--deck-1:#E3D3B1;--deck-ink-1:#141614;--deck-2:#B88A3A;--deck-ink-2:#141614}
@media (prefers-color-scheme:dark){.cbx:not([data-theme="light"]){--hero-muted:#4A4D49;--hero-well:#DADFDA;--hero-bronze:#6E4E14;--hero-cyan:#095E6A;--fill-bz:#CFA24A;--fill-bz-ink:#141614;--fill-cy:#6FCAD6;--fill-cy-ink:#071A1D;--deck-1:#3A3524;--deck-ink-1:#F1F3F0;--deck-2:#B88A3A;--deck-ink-2:#141614}}
.cbx[data-theme="dark"]{--hero-muted:#4A4D49;--hero-well:#DADFDA;--hero-bronze:#6E4E14;--hero-cyan:#095E6A;--fill-bz:#CFA24A;--fill-bz-ink:#141614;--fill-cy:#6FCAD6;--fill-cy-ink:#071A1D;--deck-1:#3A3524;--deck-ink-1:#F1F3F0;--deck-2:#B88A3A;--deck-ink-2:#141614}

/* ===== shared primitives (every view) ===== */
.cbx .b-bento{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:minmax(232px,auto);gap:12px}
.cbx .b-t{position:relative;overflow:hidden;background:var(--card);color:var(--ink);border:0;border-radius:26px;padding:20px 20px 18px;box-shadow:var(--shadow);display:flex;flex-direction:column;min-width:0}
.cbx .b-t>*{flex-shrink:0}
.cbx .b-t :is(h2,h3,p,dl,dd,ul,ol){margin:0}
.cbx .b-s2{grid-column:span 2}
.cbx .b-s4{grid-column:span 4}
.cbx .b-r2{grid-row:span 2}
.cbx .b-t-h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.cbx .b-t-ti{font-size:15px;font-weight:600;letter-spacing:-.01em}
.cbx .b-t-sub{font-size:12.5px;color:var(--ink-3);margin-top:2px;line-height:1.4}
.cbx .b-t-foot{margin-top:auto;font-size:11.5px;color:var(--ink-3)}
.cbx .b-mid{font-size:64px;font-weight:400;letter-spacing:-.05em;line-height:1;margin:auto 0 10px;font-variant-numeric:tabular-nums}
.cbx .b-u{font-size:.42em;letter-spacing:-.01em;margin-left:3px}
.cbx .b-tags{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 12px}
.cbx .b-tag{display:inline-flex;align-items:center;min-height:26px;padding:3px 11px;border-radius:99px;background:var(--well);color:var(--ink);font-size:12px;font-weight:600}
.cbx .b-go{position:absolute;top:16px;right:16px;z-index:3;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:var(--ink);display:grid;place-items:center;cursor:pointer}
.cbx .b-go svg{width:14px;height:14px;fill:none;stroke:var(--on-ink);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.cbx .b-help{font-size:11.5px;line-height:1.4;color:var(--ink-3)}
.cbx .b-help:empty{display:none}
.cbx .num{font-variant-numeric:tabular-nums}
.cbx .chip{display:inline-flex;align-items:center;gap:6px;min-height:22px;padding:2px 9px;border-radius:99px;background:var(--well);color:var(--ink-2);font-size:11px;font-weight:600;white-space:nowrap}
.cbx .chip i{width:8px;height:8px;background:currentColor;display:inline-block}
.cbx .chip.bronze{background:var(--bronze-bg);color:var(--bronze-t)}
.cbx .chip.cyan{background:var(--cyan-bg);color:var(--cyan-t)}
.cbx .chip.ink{background:var(--ink);color:var(--on-ink)}
.cbx .kv{margin-top:8px}
.cbx .kv>div{display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid var(--line);font-size:12.5px}
.cbx .kv>div:last-child{border-bottom:0}
.cbx .kv dt{color:var(--ink-2)}
.cbx .kv dd{margin:0;font-weight:700;text-align:right;overflow-wrap:anywhere}
.cbx details.disc summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;font-size:12px;font-weight:600;color:var(--ink-3)}
.cbx details.disc summary::-webkit-details-marker{display:none}
.cbx .chev{width:24px;height:24px;border-radius:50%;background:var(--well);display:grid;place-items:center;flex:none;font-size:14px}
.cbx details[open]>summary .chev{transform:rotate(90deg)}
.cbx .notes{display:flex;flex-direction:column;gap:6px;padding:0;list-style:none}
.cbx .notes .foot{font-size:11.5px;line-height:1.55;color:var(--ink-3)}

/* hero: the inverted tile */
.cbx .b-hero{background:var(--ink);color:var(--on-ink);container-type:inline-size;--ink-3:var(--hero-muted);--well:var(--hero-well);--bronze-t:var(--hero-bronze);--bronze-bg:var(--hero-well);--cyan-t:var(--hero-cyan);--cyan-bg:var(--hero-well)}
.cbx .b-hero .b-tag{color:var(--on-ink)}
.cbx .b-hero .chip.ink{background:var(--on-ink);color:var(--ink)}
.cbx .b-hero .b-mega{font-size:min(150px,16cqi);font-weight:400;letter-spacing:-.06em;line-height:.9;margin:auto 0 6px;font-variant-numeric:tabular-nums}
.cbx .b-hero .cb-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--hero-well);font-size:12.5px;color:var(--hero-muted)}
.cbx .b-hero .cb-row b{color:var(--on-ink);font-weight:600}
.cbx .b-hero :is(.cb-warn,.cb-attested){margin-top:10px;max-width:72ch;font-size:12.5px;line-height:1.5;color:var(--hero-muted)}
.cbx .b-hero :is(.cb-reason,.cb-idle){margin:auto 0 12px;max-width:52ch;font-size:18px;line-height:1.45;color:var(--on-ink)}
.cbx .b-hero .cb-sel{margin:0 0 10px}
.cbx .b-hero .cb-sel span{display:block;font-size:11px;font-weight:600;color:var(--hero-muted)}
.cbx .b-hero .cb-sel code{font-size:12.5px;color:var(--on-ink);word-break:break-all}

/* chargeable: the card is the bar (its width IS the share; never widened to fit a label) */
.cbx .b-fill{flex-direction:row;padding:0;background:var(--well)}
.cbx .b-fl-bar{position:absolute;inset:0 auto 0 0;width:var(--share,0%);border-radius:26px;background:var(--fill-bz)}
.cbx .b-fill-cyan .b-fl-bar{background:var(--fill-cy)}
.cbx .b-fill-ink .b-fl-bar{background:var(--ink)}
.cbx :is(.b-fl-in,.b-fl-rest){position:relative;z-index:1;padding:20px;display:flex;flex-direction:column;min-width:0}
.cbx .b-fl-in{flex:0 0 var(--share,0%)}
.cbx .b-fill-bronze .b-fl-in,.cbx .b-fill-bronze .b-fl-in :is(.b-t-sub,.b-u){color:var(--fill-bz-ink)}
.cbx .b-fill-cyan .b-fl-in,.cbx .b-fill-cyan .b-fl-in :is(.b-t-sub,.b-u){color:var(--fill-cy-ink)}
.cbx .b-fill-ink .b-fl-in,.cbx .b-fill-ink .b-fl-in :is(.b-t-sub,.b-u){color:var(--on-ink)}
.cbx .b-fl-rest{flex:1;align-items:flex-start}
.cbx .b-fl-rest .b-tags{align-self:flex-end;justify-content:flex-end}
.cbx .b-fl-rest .b-tag{background:var(--card)}
/* low share, and every phone: the bar is a strip along the foot, the text sits on the plate */
.cbx .b-fill-low{flex-wrap:wrap;padding-bottom:14px}
.cbx .b-fill-low .b-fl-bar{inset:auto auto 0 0;height:14px;border-radius:0 7px 7px 0}
.cbx .b-fill-low .b-fl-in{flex:1 1 0}
.cbx .b-fill-low .b-fl-in,.cbx .b-fill-low .b-fl-in :is(.b-t-sub,.b-u){color:var(--ink)}
.cbx .b-fill-none{background:var(--card)}
@media (max-width:640px){
  .cbx .b-fill{flex-direction:column;padding-bottom:14px}
  .cbx .b-fill .b-fl-bar{inset:auto auto 0 0;height:14px;border-radius:0 7px 7px 0}
  .cbx .b-fill .b-fl-in{flex:none}
  .cbx .b-fill .b-fl-in,.cbx .b-fill .b-fl-in :is(.b-t-sub,.b-u){color:var(--ink)}
  .cbx .b-fl-rest .b-tags{align-self:flex-start;justify-content:flex-start}
}

/* three years: a stacked deck */
.cbx .b-yrs .b-t-ti{padding-right:40px}
.cbx .b-stack{display:flex;flex-direction:column;margin:auto 0 12px;padding:0;list-style:none}
.cbx .b-st{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:12px 16px;border-radius:18px;margin-top:-8px;position:relative;background:var(--well-2);color:var(--ink)}
.cbx .b-st span{font-size:12px;font-weight:600}
.cbx .b-st b{font-size:28px;font-weight:400;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.cbx .b-st-none b{font-size:15px;font-weight:600;letter-spacing:0}
.cbx .b-st0{z-index:3;margin-top:0}
.cbx .b-st1{z-index:2;margin-left:10px;margin-right:10px;padding-top:18px}
.cbx .b-st2{z-index:1;margin-left:20px;margin-right:20px;padding-top:18px}
.cbx .b-stack-bz .b-st1{background:var(--deck-1);color:var(--deck-ink-1)}
.cbx .b-stack-bz .b-st2{background:var(--deck-2);color:var(--deck-ink-2)}

/* provenance: the snapshot as dots */
.cbx .b-prov{gap:16px}
.cbx .b-fp{flex:none;display:grid;grid-template-columns:repeat(8,1fr);gap:6px;width:150px;padding:14px;border-radius:18px;background:var(--well)}
.cbx .b-fp i{aspect-ratio:1;border-radius:50%;background:color-mix(in oklab,var(--ink) 14%,transparent)}
.cbx .b-fp i.on{background:var(--ink)}
.cbx .b-pv{min-width:0}

/* ===== Estimate: inputs left, results right ===== */
.cbx .b-est{display:grid;grid-template-columns:minmax(360px,440px) minmax(0,1fr);gap:12px;align-items:start;margin-top:18px}
@media (max-width:1100px){.cbx .b-est{grid-template-columns:minmax(0,1fr)}}
.cbx .b-inputs{display:flex;flex-direction:column;gap:10px;min-width:0}
.cbx .b-inputs :is(h2,h3,p){margin:0}
.cbx .b-in-head{padding:2px 6px 4px}
.cbx .b-inp{min-height:0;padding:18px 18px 16px 52px;gap:6px}
.cbx .b-step{position:absolute;left:16px;top:17px;z-index:2;width:24px;height:24px;border-radius:50%;background:var(--ink);color:var(--on-ink);font-size:12px;font-weight:700;display:grid;place-items:center}
.cbx .b-inp>.b-t-ti{margin-bottom:8px}
.cbx .b-lab{font-size:11px;font-weight:600;color:var(--ink-3);margin-top:6px}
.cbx .b-field{display:flex;align-items:center;gap:10px;width:100%;min-height:46px;padding:0 6px 0 14px;border-radius:14px;background:var(--well);color:var(--ink);box-shadow:inset 0 0 0 1.5px transparent}
.cbx .b-field:hover{box-shadow:inset 0 0 0 1.5px var(--ink-3)}
.cbx .b-field:focus-within{box-shadow:inset 0 0 0 2px var(--ink)}
.cbx .b-field :is(input,select){flex:1;min-width:0;height:44px;border:0;background:transparent;color:var(--ink);font:inherit;font-size:15px;outline:0}
.cbx .b-field select{appearance:none;cursor:pointer;padding-right:28px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23888b87' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 8px center}
.cbx .b-field select:disabled{cursor:not-allowed;color:var(--ink-3)}
.cbx .b-fi-ic{width:18px;height:18px;flex:none;fill:none;stroke:var(--ink-3);stroke-width:1.8;stroke-linecap:round}
.cbx .b-pill{flex:none;border:0;cursor:pointer;font:inherit;font-size:12px;font-weight:700;padding:6px 12px;border-radius:99px;background:var(--ink);color:var(--on-ink)}
.cbx .b-field-big{min-height:64px}
.cbx .b-field-big input{height:62px;font-size:40px;letter-spacing:-.04em}
.cbx .b-field-big span{font-size:20px;color:var(--ink-3);padding-right:10px}
.cbx .b-clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cbx .b-thr{position:relative;height:12px;border-radius:6px;background:var(--well-2);margin:8px 0 2px}
.cbx .b-thr b{position:absolute;left:0;top:0;bottom:0;width:var(--fill,0%);border-radius:6px;background:var(--ink)}
.cbx .b-thr em{position:absolute;left:50%;top:-5px;bottom:-5px;width:3px;margin-left:-1.5px;border-radius:2px;background:var(--card);box-shadow:0 0 0 1px var(--ink)}
.cbx .b-thr-l2{display:flex;justify-content:space-between;gap:8px}
.cbx .b-qtr{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:6px 0 4px}
.cbx .b-qtr i{height:8px;border-radius:4px;background:var(--well-2)}
.cbx .b-qtr i.on{background:var(--ink)}
.cbx .b-segrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(64px,1fr));gap:6px}
.cbx .b-segrow button{position:relative;height:42px;border:0;border-radius:12px;background:var(--well);color:var(--ink);font:inherit;font-size:15px;cursor:pointer}
.cbx .b-segrow button.on{background:var(--ink);color:var(--on-ink)}
.cbx .b-segrow i{position:absolute;top:7px;right:8px;width:7px;height:7px;border-radius:50%;background:var(--cyan-f)}
.cbx .b-seg-empty{grid-column:1/-1;padding:10px 0}
.cbx .b-opts{display:grid;gap:6px}
.cbx .b-opt{text-align:left;border:0;border-radius:14px;padding:12px 14px;background:var(--well);color:var(--ink);font:inherit;cursor:pointer;display:flex;flex-direction:column;gap:2px}
.cbx .b-opt b{font-size:14px}
.cbx .b-opt span{font-size:11.5px;line-height:1.4;color:var(--ink-3)}
.cbx .b-opt-bz.on,.cbx .b-opt-bz.on span{background:var(--fill-bz);color:var(--fill-bz-ink)}
.cbx .b-opt-cy b{color:var(--cyan-t)}
.cbx .b-opt-cy.on{background:var(--cyan-bg);box-shadow:inset 0 0 0 2px var(--cyan-f)}
.cbx .b-vfields{display:flex;flex-direction:column;gap:4px;margin-top:4px}
.cbx .b-vfields .cb-check{display:flex;gap:8px;align-items:baseline;margin-top:8px;font-size:12px;line-height:1.5;color:var(--ink-2)}
.cbx .b-vfields .cb-check input{accent-color:var(--ink);flex:none}
.cbx .b-native{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.cbx .b-add{width:100%;height:46px;border:0;border-radius:99px;background:var(--ink);color:var(--on-ink);font:inherit;font-size:14px;font-weight:600;cursor:pointer}
.cbx .b-out{grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:auto}
.cbx .b-out>*{grid-column:1/-1}
.cbx .b-out>:is(.b-yrs,.b-prov){grid-column:auto;min-height:232px}
.cbx .b-out>.b-hero{min-height:400px}
.cbx .b-out>.b-fill{min-height:232px}
.cbx .b-out>.b-fill-none{min-height:120px}
.cbx .b-legacy{min-width:0}
@media (max-width:640px){
  .cbx .b-out{grid-template-columns:minmax(0,1fr)}
  .cbx .b-out>:is(.b-yrs,.b-prov){grid-column:1/-1}
  .cbx .b-out>.b-hero{min-height:0}
  .cbx .b-inp{padding-left:48px}
}

/* legacy Estimate markup, kept for its pins, restyled so the light theme stays legible */
.cbx [data-view="estimate"] .cb-eyebrow{margin:0 4px;font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
.cbx [data-view="estimate"] .cb-banner{margin:12px 4px 0;max-width:96ch;border-radius:18px;padding:14px 18px;background:var(--bronze-bg);color:var(--bronze-t);font-family:var(--sans);font-size:13px;line-height:1.6}
.cbx [data-view="estimate"] .cb-datenote{margin:4px 0 0;color:var(--ink-2)}
.cbx .b-results .cb-source{margin:10px 4px 0;font-family:var(--sans);font-size:11.5px;color:var(--ink-3)}

/* ===== the good sheet: a dialog from the LEFT, over the inputs ===== */
.cbx .b-scrim{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:40}
.cbx .b-sheet{position:fixed;top:16px;left:16px;bottom:16px;width:min(440px,calc(100vw - 32px));z-index:41;background:var(--card);color:var(--ink);border-radius:28px;box-shadow:0 30px 80px -20px rgba(0,0,0,.5);padding:20px 22px;display:flex;flex-direction:column;gap:10px;overflow:auto}
.cbx .b-sheet[hidden],.cbx .b-scrim[hidden]{display:none}
.cbx .b-sheet :is(h2,p){margin:0}
.cbx .b-sheet header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
.cbx .b-x{width:32px;height:32px;border-radius:50%;border:0;background:var(--well);color:var(--ink-2);font-size:20px;cursor:pointer;line-height:1}
.cbx .b-big-in{display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:20px;background:var(--well)}
.cbx .b-big-in:focus-within{box-shadow:inset 0 0 0 2px var(--ink)}
.cbx .b-big-in input{flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:inherit;font-size:28px;letter-spacing:-.03em;outline:0}
.cbx .b-chips{display:flex;flex-wrap:wrap;gap:6px}
.cbx .b-chipbtn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:99px;border:0;background:var(--well);color:var(--ink-2);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.cbx .b-chipbtn[aria-pressed="true"]{background:var(--ink);color:var(--on-ink)}
.cbx .b-reslist{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.cbx .b-res{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left;padding:12px 14px;border-radius:18px;border:0;background:var(--well);color:var(--ink);font:inherit;cursor:pointer}
.cbx .b-res.on{box-shadow:inset 0 0 0 2px var(--ink)}
.cbx .b-res b{font-size:16px}
.cbx .b-res-d{font-size:12px;line-height:1.45;color:var(--ink-2)}
.cbx .b-sheet .b-t-foot{margin-top:4px}
```

- [ ] **Step 4: Run it.**

Run: `node --import tsx --test tests/unit/cbam-bento-contrast.test.mjs`

Expected: 3 pass. If a pair fails, change **only that token's lightness**, keeping its hue family (a bronze stays bronze, a cyan stays cyan). Re-run, and list every changed token in the report. Never lower a threshold in `PAIRS`.

- [ ] **Step 5: Commit.**

```bash
git add -- src/styles/cbam-bento.css tests/unit/cbam-bento-contrast.test.mjs
git commit -m "feat(cbam): cbam-bento.css — shared b- tile primitives, the Estimate section and the good sheet; AA pinned in both themes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: An e2e spec for the Estimate view, which fails first

**Budget:** 35 min.
**Files:**
- Create: `tests/e2e/cbam-estimate.spec.ts`
- Modify: `playwright.config.ts` (two `testMatch` regexes)

> **Standing rules.** Work only in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p2` (branch `feat/cbam-rail-ui-p2`). Never loosen an assertion. Stage named paths only; never `git stash`. Scratch goes in `/Volumes/OBOSLab/tmp/`. **Never open a visible browser.** Playwright runs headless, **in the foreground** through the Bash tool's own timeout (no `run_in_background`; macOS has no `timeout`). The Chromium project is `chromium-tier0`. Playwright starts its own server on a dedicated port (`webServer` in `playwright.config.ts`, `reuseExistingServer: false`). If it reports the port is in use, another session is running Playwright: wait and retry once, then report. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stop at the budget and report.

Context. Phase 2 of the CBAM calculator redesign (spec `docs/superpowers/specs/2026-11-02-cbam-rail-ui-design.md` §5.1, §6.5, §9) turns the Estimate view into:
- **An input column**:
  - Step 1: `#cbCn` plus a `[data-good-open]` "Change" pill opening the dialog `#cbGoodSheet` (with scrim `#cbGoodScrim`, search `[data-good-search]`, chips `[data-sector]` and results `.b-res[data-code]`), and the caption `#cbCnName`.
  - Step 2: `#cbCountry`, plus the radiogroup `#cbRouteSeg` mirroring the hidden `#cbRoute`, with the verified-only note `#cbRouteVo`.
  - Step 3: `#cbDate` and the caption `#cbDatePeriod`.
  - Step 4: `#cbMass` and the ruler `#cbMassRuler`.
  - Step 5: the radiogroup `#cbTierCards` mirroring the hidden `#cbTier`, which opens `#cbVerifiedRow`.
- **Result tiles inside `#cbOut`**: `.b-hero` (with `.cb-n`, `.cb-cost`, `.cb-fig`), `.b-fill`, `.b-yrs` (the deck, with a `[data-goto="three-years"]` button) and `.b-prov` (with the `.b-fp` dot grid).

The view helpers come from phase 1. This spec drives those controls; the existing `cbam-lines.spec.ts` keeps driving the hidden selects with `selectOption`, which works because they are 1×1 px and clipped, not `hidden`.

This task writes the spec **before** the markup and wiring exist (Tasks 11–12), so it must fail now.

Measured on the real pack:
- **73063077 / India:** routes `(C)`, `(D)`, `(E)`, of which `(D)` and `(E)` are verified-only. Nothing is auto-picked, because several routes are published. At 100 t on 2026-03-15, `(C)` gives `.cb-n` "329.828" and `.cb-cost` "€24,855.80", a 69.4 / 30.6 split, and a deck of 329.8 / 376.8 / 427.4 with "+29.6% by 2028". `(D)` refuses with "The Commission publishes no applicable direct default value…".
- **2523100090 / Algeria (A), 100 t:** 50 t de minimis rule for 2026; price 2026-Q1 €75.36; 2027-Q1 none published.
- **28041000 (hydrogen):** no de minimis rule.

- [ ] **Step 1: Write the spec.**

```ts
// tests/e2e/cbam-estimate.spec.ts
// Phase 2 of the rail redesign (spec §5.1, §6.5, §9): the Estimate view's inputs and tiles. The
// hidden #cbRoute / #cbTier stay the source of truth; this spec proves the visible radio groups
// mirror them in both directions, which cbam-lines.spec.ts (driving the selects) cannot see.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const URL = '/cbam/cbam-calculator/';
const IDLE = 'Choose a good, origin, route, mass and import date to see the provisional exposure.';

async function pick(page: Page, cn: string, country: string, date = '2026-03-15'): Promise<void> {
  await page.fill('#cbCn', cn);
  await page.dispatchEvent('#cbCn', 'change');
  await page.fill('#cbDate', date);
  await page.dispatchEvent('#cbDate', 'change');
  await expect(page.locator(`#cbCountry option[value="${country}"]`)).toBeAttached();
  await page.selectOption('#cbCountry', country);
}

const inert = (page: Page) => page.locator('.cbx-main').evaluate((el) => el.hasAttribute('inert'));

test.describe('CBAM Estimate view', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('idle: the hero carries the prompt and no tile claims a figure', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('#cbOut .b-hero .cb-idle')).toHaveText(IDLE);
    await expect(page.locator('#cbOut .cb-fig')).toHaveCount(0);
    await expect(page.locator('#cbOut')).not.toContainText('tCO');
    await expect(page.locator('#cbRouteSeg')).toContainText('Choose a good and origin first');
  });

  test('route segments mirror #cbRoute both ways, and mark verified-only routes', async ({ page }) => {
    await page.goto(URL);
    await pick(page, '73063077', 'IN');
    const seg = page.locator('#cbRouteSeg [role="radio"]');
    await expect(seg).toHaveText(['(C)', '(D)', '(E)']);
    await expect(page.locator('#cbRouteSeg .b-vo')).toHaveText(['(D)', '(E)']);
    await expect(page.locator('#cbRouteVo')).toHaveText(
      '(D) and (E) price from verified figures only: no Commission default from India.');
    await expect(page.locator('#cbRoute')).toHaveValue('');
    await expect(page.locator('#cbRouteSeg [aria-checked="true"]')).toHaveCount(0);

    await seg.nth(0).click();
    await expect(page.locator('#cbRoute')).toHaveValue('(C)');
    await expect(seg.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#cbOut .cb-n')).toHaveText('329.828');
    await expect(page.locator('#cbOut .cb-cost')).toHaveText('€24,855.80');

    // WAI-ARIA radio group: the arrow moves focus AND selects.
    await seg.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(seg.nth(1)).toBeFocused();
    await expect(page.locator('#cbRoute')).toHaveValue('(D)');
    await expect(page.locator('#cbOut .cb-reason')).toContainText('The Commission publishes no applicable direct default value');
    await expect(page.locator('#cbOut .cb-fig')).toHaveCount(0);
    await expect(page.locator('#cbOut .cb-cost')).toHaveCount(0);
    await expect(page.locator('#cbOut .b-prov')).toContainText('Origin basis');

    // …and the select still drives the radios: the lines spec sets routes this way.
    await page.selectOption('#cbRoute', '(E)');
    await expect(seg.nth(2)).toHaveAttribute('aria-checked', 'true');
    await expect(seg.nth(1)).toHaveAttribute('aria-checked', 'false');
  });

  test('the emissions-data cards mirror #cbTier and open the verified panel', async ({ page }) => {
    await page.goto(URL);
    const cards = page.locator('#cbTierCards [role="radio"]');
    await expect(cards.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#cbVerifiedRow')).toBeHidden();
    await cards.nth(1).click();
    await expect(page.locator('#cbTier')).toHaveValue('actual-verified');
    await expect(page.locator('#cbVerifiedRow')).toBeVisible();
    await cards.nth(1).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#cbTier')).toHaveValue('default+markup');
    await expect(page.locator('#cbVerifiedRow')).toBeHidden();
    await page.selectOption('#cbTier', 'actual-verified');
    await expect(cards.nth(1)).toHaveAttribute('aria-checked', 'true');
  });

  test('a priced line fills Chargeable, the deck and Provenance; ↗ opens Three years', async ({ page }) => {
    await page.goto(URL);
    await pick(page, '73063077', 'IN');
    await page.locator('#cbRouteSeg [data-value="(C)"]').click();
    await expect(page.locator('#cbOut .b-fill')).toContainText('69.4');
    await expect(page.locator('#cbOut .b-fill')).toContainText('30.6');
    const deck = page.locator('#cbOut .b-yrs');
    await expect(deck.locator('.b-st b')).toHaveText(['329.8', '376.8', '427.4']);
    await expect(deck).toContainText('+29.6% by 2028');
    await expect(deck).not.toContainText('€');
    await expect(page.locator('#cbOut .b-prov .b-fp i')).toHaveCount(64);
    await deck.locator('[data-goto="three-years"]').click();
    await expect(page.locator('[data-view="three-years"]')).toBeVisible();
  });

  test('the good sheet: keyboard in, search, sector, pick, focus back', async ({ page }) => {
    await page.goto(URL);
    const open = page.locator('[data-good-open]');
    const sheet = page.locator('#cbGoodSheet');
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-good-search]')).toBeFocused();
    expect(await inert(page)).toBe(true);
    await expect(sheet.locator('.b-res').first()).toBeVisible();
    await page.keyboard.type('welded tube');
    await sheet.locator('[data-sector="iron_and_steel"]').click();
    await expect(sheet.locator('[data-sector="iron_and_steel"]')).toHaveAttribute('aria-pressed', 'true');
    const hit = sheet.locator('.b-res[data-code="73063077"]');
    await hit.focus();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeHidden();
    await expect(page.locator('#cbCn')).toHaveValue('73063077');
    await expect(open).toBeFocused();
    expect(await inert(page)).toBe(false);
    await expect(page.locator('#cbCnName')).toContainText('welded');
    // The pick reached cbam-app.ts: the routes follow the good once an origin is chosen.
    await page.selectOption('#cbCountry', 'IN');
    await expect(page.locator('#cbRouteSeg [role="radio"]')).toHaveCount(3);
  });

  test('the good sheet closes on Escape and on the scrim', async ({ page }) => {
    await page.goto(URL);
    const open = page.locator('[data-good-open]');
    await open.click();
    await expect(page.locator('#cbGoodSheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#cbGoodSheet')).toBeHidden();
    await expect(open).toBeFocused();
    await open.click();
    await page.locator('#cbGoodScrim').click({ position: { x: 1300, y: 400 } });
    await expect(page.locator('#cbGoodSheet')).toBeHidden();
  });

  test('the mass ruler and the date caption read the pack', async ({ page }) => {
    await page.goto(URL);
    await pick(page, '2523100090', 'DZ');
    await page.selectOption('#cbRoute', '(A)');
    await page.fill('#cbMass', '100');
    await expect(page.locator('#cbMassRuler')).toContainText('50 t de minimis · 2026');
    await expect(page.locator('#cbDatePeriod')).toContainText('Certificate price · imports in 2026-Q1: €75.36');
    await page.fill('#cbDate', '2027-03-15');
    await page.dispatchEvent('#cbDate', 'change');
    await expect(page.locator('#cbDatePeriod')).toContainText('Certificate price · imports in 2027-Q1: none published');
    await expect(page.locator('#cbDateNote')).toHaveText('');
    await expect(page.locator('#cbMassRuler')).toBeEmpty();
    await pick(page, '28041000', 'DZ');
    await expect(page.locator('#cbMassRuler')).toBeEmpty();
  });

  test('phone: the inputs stack above the tiles, with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(URL);
    await pick(page, '73063077', 'IN');
    await page.locator('#cbRouteSeg [data-value="(C)"]').click();
    await expect(page.locator('#cbOut .cb-cost')).toBeVisible();
    const inputs = await page.locator('.b-inputs').boundingBox();
    const hero = await page.locator('#cbOut .b-hero').boundingBox();
    expect(hero!.y).toBeGreaterThan(inputs!.y + inputs!.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    expect(await page.locator('.cbx-main').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`axe: Estimate with a priced verified line passes in the ${theme} theme`, async ({ page }) => {
      await page.goto(`${URL}?theme=${theme}`);
      await pick(page, '73063077', 'IN');
      await page.locator('#cbRouteSeg [data-value="(C)"]').click();
      await page.locator('#cbTierCards [data-value="actual-verified"]').click();
      await page.fill('#cbSeeDirect', '1.2');
      await page.check('#cbAttest');
      await expect(page.locator('#cbOut .cb-cost')).toBeVisible();
      const r = await new AxeBuilder({ page }).include('[data-view="estimate"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
      expect(r.violations).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Register it for the CBAM browsers.** In `playwright.config.ts` the `firefox-cbam` and `webkit-cbam` projects use `testMatch: /cbam-(lines|shell)\.spec\.ts/`. Change both to `testMatch: /cbam-(lines|shell|estimate)\.spec\.ts/`, then confirm:

Run: `npx playwright test --list tests/e2e/cbam-estimate.spec.ts 2>&1 | tail -3`

Expected: 10 tests per project that matches.

- [ ] **Step 3: Run it and confirm it fails for the right reason.**

```bash
npx playwright test tests/e2e/cbam-estimate.spec.ts --project=chromium-tier0 --reporter=line 2>&1 | tee /Volumes/OBOSLab/tmp/cbam-p2-estimate-red.txt | tail -30
```

Expected: failures with locators not found (`#cbRouteSeg`, `[data-good-open]`, `.b-hero`, …), **not** syntax or import errors.

- [ ] **Step 4: Commit.**

```bash
git add -- tests/e2e/cbam-estimate.spec.ts playwright.config.ts
git commit -m "test(cbam): Estimate e2e — radio mirrors both ways, tiles, good sheet keyboard path, phone, axe in both themes (fails first)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Page markup — the input column, the result grid, the sheet

**Budget:** 45 min.
**Files:**
- Modify: `src/pages/cbam/cbam-calculator.astro`

> **Standing rules.** Work only in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p2` (branch `feat/cbam-rail-ui-p2`). Never edit a file listed in `src/scripts/cbam-algos/UPSTREAM.json`. Never loosen an assertion. Grep, never count from memory. Stage named paths only; never `git stash`. Scratch goes in `/Volumes/OBOSLab/tmp/`. `npm run test:unit` only after `npm run build`; single files with `node --import tsx --test <file>`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stop at the budget and report.

Context. `src/pages/cbam/cbam-calculator.astro` is the calculator page. After phase 1 it is an app shell, `<div class="cbx" id="cbx">`, holding a rail, `<main class="cbx-main">` with six `<section data-view>` views, and phone bars. The Estimate view currently contains, in this order:
- the `<h1>`
- `<p class="cb-eyebrow">`
- an HTML comment
- `<div class="cb-banner" role="note">…</div>`
- `<div class="cb-grid">`, holding the old form (`<section class="cb-form">`) and the result section (`<section id="cbOutWrap" class="cb-out">` with `#cbOut` and `#cbProv`)

This task replaces **only the `<div class="cb-grid">…</div>` block** with the bento layout, adds the good sheet as a direct child of `.cbx`, imports the new stylesheet, and deletes scoped CSS rules the old form used.

Pins that must stay green (read from this file's **source text** by unit tests):
- The banner `<div class="cb-banner" role="note">…</div>` is unchanged, byte for byte. The text between `cb-banner` and the **first following `cb-grid`** must stay free of "will pay", "pay less", "forecast", "expected price" and "not yet". So the new grid keeps the class `cb-grid`, and nothing new may sit between the banner and it.
- `<p class="cb-eyebrow">Provisional · defaults or your verified figures · in-browser</p>` stays.
- `<option value="actual-verified">` stays literally in the markup.
- `#cbCn` keeps `placeholder="e.g. 2523100090 — grey cement clinker"`.
- The **first** `<p class="cb-idle">…</p>` in the file is exactly `<p class="cb-idle">Choose a good, origin, route, mass and import date to see the provisional exposure.</p>`.
- The static `#cbOut` content equals `renderEstimateIdle(IDLE)` from `src/scripts/cbam-ui/tiles-estimate.ts`, once comments and whitespace between tags are normalised (`tests/unit/cbam-tiles-estimate.test.mjs`), and `#cbOut` is written as `<div id="cbOut" class="b-bento b-out">`, followed by `<p class="cb-source" id="cbProv">`.
- The sheet's chips come from `set:html={renderSectorChips(null)}` (`tests/unit/cbam-good-sheet.test.mjs`).
- **Every id in spec §6.4 survives once**, with the same meaning: `cbAdd cbAttest cbCn cbCnList cbCountry cbCsv cbDate cbDateNote cbDoc cbGraphs cbMass cbOut cbOutWrap cbOutlook cbPrint cbProv cbRef cbRoute cbRouteNote cbScope cbScopeRow cbSeeDirect cbSeeIndirect cbSeeIndirectRow cbStatus cbTier cbVerifiedRow`.
- `#cbOutWrap` stays `aria-live="polite"`. `#cbDateNote` stays `role="status" aria-live="polite"`. `#cbVerifiedRow`, `#cbSeeIndirectRow` and `#cbScopeRow` ship `hidden`.

- [ ] **Step 1: Imports.** In the frontmatter, under `import '../../styles/cbam-app.css';`, add:

```ts
import '../../styles/cbam-bento.css';
import { renderSectorChips } from '../../scripts/cbam-ui/good-sheet.ts';
```

- [ ] **Step 2: Replace the grid.** Find the block with `grep -n 'class="cb-grid"\|<section data-view="three-years"' src/pages/cbam/cbam-calculator.astro`. Replace everything from the line `<div class="cb-grid">` through the `</div>` that closes it (the line just before the Estimate view's closing `</section>`) with:

```astro
        <div class="cb-grid b-est">
          <section class="b-inputs" aria-labelledby="cbInH">
            <div class="b-in-head">
              <h2 class="b-t-ti" id="cbInH">Your line.</h2>
              <p class="b-t-sub">Fill these in, top to bottom. The estimate updates as you go.</p>
            </div>

            <section class="b-t b-inp">
              <span class="b-step" aria-hidden="true">1</span>
              <label class="b-t-ti" for="cbCn">Good.</label>
              <div class="b-field">
                <svg class="b-fi-ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="m13 13 3.5 3.5"/></svg>
                <input id="cbCn" list="cbCnList" autocomplete="off" spellcheck="false" aria-describedby="cbCnName"
                       placeholder="e.g. 2523100090 — grey cement clinker" />
                <button type="button" class="b-pill" data-good-open aria-haspopup="dialog" aria-expanded="false"
                        aria-controls="cbGoodSheet" aria-label="Change good">Change</button>
              </div>
              <datalist id="cbCnList"></datalist>
              <!-- Spec D5: the Commission's full CN description, clamped to two lines; the full text in title. -->
              <p class="b-help b-clamp2" id="cbCnName">Type a CN code, or press Change to search by name.</p>
            </section>

            <section class="b-t b-inp" aria-labelledby="cbStep2">
              <span class="b-step" aria-hidden="true">2</span>
              <h3 class="b-t-ti" id="cbStep2">Origin &amp; route.</h3>
              <label class="b-lab" for="cbCountry">Country of origin</label>
              <div class="b-field">
                <select id="cbCountry">
                  <option value="" disabled selected>Select origin…</option>
                </select>
              </div>
              <span class="b-lab" id="cbRouteLab">Production route</span>
              <!-- THE SOURCE OF TRUTH, HIDDEN (spec §6.5). cbam-app.ts rebuilds and reads this select; the
                   radiogroup below mirrors it both ways (inputs-estimate.ts mountRadioMirror). 1×1 and
                   clipped, not [hidden], so cbam-lines.spec.ts's selectOption still reaches it. -->
              <select id="cbRoute" class="b-native" tabindex="-1" aria-hidden="true" disabled>
                <option value="">Choose a good and origin first</option>
              </select>
              <div class="b-segrow" id="cbRouteSeg" role="radiogroup" aria-labelledby="cbRouteLab">
                <p class="b-help b-seg-empty">Choose a good and origin first</p>
              </div>
              <p class="b-help" id="cbRouteVo"></p>
              <!-- THE PROVENANCE HALF, and DELIBERATELY NOT A LIVE REGION: it restates the route just
                   picked, so announcing it would read the same route back twice. -->
              <p class="b-help" id="cbRouteNote"></p>
            </section>

            <section class="b-t b-inp">
              <span class="b-step" aria-hidden="true">3</span>
              <label class="b-t-ti" for="cbDate">Import date.</label>
              <div class="b-field"><input id="cbDate" type="date" value="2026-03-15" /></div>
              <div id="cbDatePeriod"></div>
              <!-- ITS OWN LIVE REGION, DELIBERATELY NOT #cbStatus: it fires on `date` change, and #cbStatus
                   has one writer on the add path. The two never fire on the same interaction. -->
              <p class="cb-datenote b-help" id="cbDateNote" role="status" aria-live="polite"></p>
            </section>

            <section class="b-t b-inp">
              <span class="b-step" aria-hidden="true">4</span>
              <label class="b-t-ti" for="cbMass">Net mass.<span class="cb-sr"> In tonnes.</span></label>
              <div class="b-field b-field-big">
                <input id="cbMass" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="100" aria-describedby="cbMassHint" />
                <span aria-hidden="true">t</span>
              </div>
              <!-- H1 (audit 2026-11-02): a text field, read by the engine's own parser. type="number"
                   re-read 0,85 as 085 in Chromium and priced the figure tenfold. -->
              <p class="b-help" id="cbMassHint">Use a decimal point: 0.85, not 0,85.</p>
              <div id="cbMassRuler" aria-hidden="true"></div>
            </section>

            <section class="b-t b-inp" aria-labelledby="cbStep5">
              <span class="b-step" aria-hidden="true">5</span>
              <h3 class="b-t-ti" id="cbStep5">Emissions data.</h3>
              <select id="cbTier" class="b-native" tabindex="-1" aria-hidden="true">
                <option value="default+markup" selected>Commission default + mark-up</option>
                <option value="actual-verified">My verified figures</option>
              </select>
              <div class="b-opts" id="cbTierCards" role="radiogroup" aria-labelledby="cbStep5">
                <button type="button" role="radio" class="b-opt b-opt-bz on" data-value="default+markup" aria-checked="true" tabindex="0"><b>Commission default + mark-up</b><span>The Commission's published value for this origin and route, with its mark-up.</span></button>
                <button type="button" role="radio" class="b-opt b-opt-cy" data-value="actual-verified" aria-checked="false" tabindex="-1"><b>My verified figures</b><span>Your installation's verified figures. The mark-up does not apply to them.</span></button>
              </div>
              <!-- "My verified figures" reveals the panel; the attestation is the gate — we transcribe a
                   claim, we never bless it. -->
              <div id="cbVerifiedRow" class="b-vfields" hidden>
                <label class="b-lab" for="cbSeeDirect">Verified direct emissions (tCO₂e / tonne)</label>
                <div class="b-field"><input id="cbSeeDirect" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" /></div>
                <!-- Shown only when the indirect side is charged for this good AND the scope includes it.
                     cbam-app.ts CLEARS this input whenever the row is hidden, so a stale value behind an
                     invisible row can never inflate the next line. -->
                <div id="cbSeeIndirectRow" hidden>
                  <label class="b-lab" for="cbSeeIndirect">Verified indirect emissions (tCO₂e / tonne)</label>
                  <div class="b-field"><input id="cbSeeIndirect" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" /></div>
                </div>
                <label class="cb-check"><input id="cbAttest" type="checkbox" />
                  I attest these figures come from an accredited verification (ISO 14064-3 / CBAM
                  Art. 8) — my claim, not checked by this tool.</label>
                <label class="b-lab" for="cbRef">Verification reference (optional)</label>
                <div class="b-field"><input id="cbRef" type="text" placeholder="verifier / report ID" /></div>
                <p class="b-help">Whole-good figures, precursors included — that scope is what a
                  verifier's CBAM report states, and what keeps this estimate on Column B.</p>
              </div>
              <!-- Only for goods the Commission publishes an indirect default for (cement, fertilisers,
                   sintered iron ore). Defaults to INCLUDING indirect: direct-only understates. -->
              <div id="cbScopeRow" hidden>
                <label class="b-lab" for="cbScope">Emissions scope</label>
                <div class="b-field">
                  <select id="cbScope">
                    <option value="direct_and_indirect" selected>Direct + indirect (electricity)</option>
                    <option value="direct">Direct only</option>
                  </select>
                </div>
                <p class="b-help">Indirect emissions are charged for this sector and receive no free allocation —
                  the benchmarks are direct-emission benchmarks.</p>
              </div>
            </section>

            <button id="cbAdd" type="button" class="b-add">Add line to the list</button>
          </section>

          <!-- aria-live: the figure AND the refusal both need announcing. Polite, always: since the rail
               shell (spec §6.3) this region holds the ONE draft line; the list lives in #cbList. -->
          <section id="cbOutWrap" class="b-results" aria-labelledby="cb-res-h" aria-live="polite">
            <h2 id="cb-res-h" class="cb-sr">Provisional exposure</h2>
            <div id="cbOut" class="b-bento b-out">
              <!-- MUST MATCH renderEstimateIdle(run()'s idle copy) in tiles-estimate.ts, after whitespace
                   between tags is dropped: cbam-tiles-estimate.test.mjs pins the two together, and
                   build-contracts.test.mjs pins this cb-idle sentence to cbam-app.ts's, byte for byte.
                   It is what stays on screen if ensurePack() never resolves. -->
              <section class="b-t b-hero b-s2"><h3 class="b-t-ti">Certificates.</h3><p class="cb-idle">Choose a good, origin, route, mass and import date to see the provisional exposure.</p></section>
              <section class="b-t b-fill b-s2 b-fill-none"><div class="b-fl-in"><h3 class="b-t-ti">Chargeable.</h3></div></section>
              <section class="b-t b-s2 b-yrs" aria-live="off"><button type="button" class="b-go" data-goto="three-years" aria-label="Open Three years"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4 10 10 4M5 4h5v5"/></svg></button><h3 class="b-t-ti">Three years.</h3><div data-deck></div></section>
              <section class="b-t b-s2 b-prov"><div class="b-pv"><h3 class="b-t-ti">Provenance.</h3></div></section>
            </div>
            <p class="cb-source" id="cbProv"></p>
          </section>
        </div>
```

The comment inside `#cbOut` must not contain the string `<p class="cb-idle">`; the build-contracts regex takes the first match. The comment above names `cb-idle` without the tag.

- [ ] **Step 3: Add the sheet.** Directly after `</main>` (before `<nav class="cbx-tabs"`), insert:

```astro
    <!-- The good sheet (spec §5.1, §6.5): a modal dialog over the input column. good-sheet.ts wires it;
         while it is open the rail, top bar, main and tab bar are inert. -->
    <div class="b-scrim" id="cbGoodScrim" hidden></div>
    <div class="b-sheet" id="cbGoodSheet" role="dialog" aria-modal="true" aria-labelledby="cbGoodH" aria-describedby="cbGoodSub" hidden>
      <header>
        <div><h2 class="b-t-ti" id="cbGoodH">Good.</h2><p class="b-t-sub" id="cbGoodSub">Search the goods this estimator prices.</p></div>
        <button type="button" class="b-x" data-good-close aria-label="Close">×</button>
      </header>
      <label class="b-big-in"><span class="cb-sr">Search goods by CN code or description</span><input type="search" data-good-search autocomplete="off" spellcheck="false" /></label>
      <div class="b-chips" data-good-chips role="group" aria-label="Sector" set:html={renderSectorChips(null)} />
      <p class="b-help" data-good-count role="status"></p>
      <div data-good-results></div>
      <p class="b-t-foot">Descriptions are the Commission's own. Sectors follow the CBAM Annex I grouping, so some fertilisers sit in chapter 28. No electricity goods are priced here.</p>
    </div>
```

- [ ] **Step 4: Delete the scoped rules the old form used.** In the page's scoped `<style>` (not `is:global`), first check that each class or id has no remaining user:

```bash
for c in cb-form cb-label cb-field cb-select cb-row2 cb-hint cb-lineactions cb-check; do printf '%s: ' "$c"; grep -c "class=\"[^\"]*\b$c\b" src/pages/cbam/cbam-calculator.astro; done
grep -rn "cb-field\|cb-select\|cb-hint\|cb-label" src/scripts --include=*.ts | grep -v "^\s*//" | head
```

Expected: `cb-check` 1 (the attest label, now styled by `cbam-bento.css`); all others 0 in the page and none in `src/scripts`.

Then delete these scoped rules:
- `.cb-grid` and its `@media (min-width: 1024px)` twin (the class stays in markup for the banner pin; a scoped `grid-template-columns` would fight `.b-est`)
- `.cb-form`, `.cb-label`
- `.cb-field`, `.cb-field::placeholder`, `.cb-field:focus-visible`
- `.cb-select`, `.cb-select:disabled`
- `.cb-row2` and its media rule
- `#cbAdd`
- `.cb-hint`, `.cb-hint:empty`
- `.cb-check`, `.cb-check input`
- `#cbVerifiedRow > .cb-label:not(:first-child), #cbSeeIndirectRow`

Keep `.cb-btn` (used by other views), `.cb-note`, `.cb-datenote` and `.cb-datenote:empty`, `.cb-sr`, `.cb-banner`, `.cb-eyebrow`, `.cb-source`, `.cb-foot` and `[hidden]`. Do not touch the `is:global` block.

- [ ] **Step 5: Check every §6.4 id exists exactly once.**

```bash
for id in cbAdd cbAttest cbCn cbCnList cbCountry cbCsv cbDate cbDateNote cbDoc cbGraphs cbMass cbOut cbOutWrap cbOutlook cbPrint cbProv cbRef cbRoute cbRouteNote cbScope cbScopeRow cbSeeDirect cbSeeIndirect cbSeeIndirectRow cbStatus cbTier cbVerifiedRow; do printf '%s %s\n' "$id" "$(grep -c "id=\"$id\"" src/pages/cbam/cbam-calculator.astro)"; done | grep -v " 1$"
```

Expected: no output.

- [ ] **Step 6: Run the pins.**

```bash
node --import tsx --test tests/unit/cbam-render.test.mjs tests/unit/cbam-tiles-estimate.test.mjs tests/unit/cbam-good-sheet.test.mjs tests/unit/cbam-chart-colours.test.mjs 2>&1 | tail -6
npm run check
```

Expected: `# fail 0`; this includes the banner pin, the CN placeholder pin, the static-markup pin and the chips pin, which were red until now. Then the full gate once:

Run: `npm run build && npm run test:unit 2>&1 | tail -6`

Expected: `# fail 0` (`build-contracts` checks the idle prompt).

**The page is now wired to the old `runPreview` until Task 12, so do not run Playwright here.**

- [ ] **Step 7: Commit.**

```bash
git add -- src/pages/cbam/cbam-calculator.astro
git commit -m "feat(cbam): Estimate markup — numbered input column, result bento, good sheet; banner and every §6.4 id kept

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `cbam-app.ts` wiring — tiles, deck, verified-only marks, ruler, caption, mirrors, sheet

**Budget:** 45 min.
**Files:**
- Modify: `src/scripts/cbam-algos/cbam-app.ts` (inside `initCbam` only, plus imports)

> **Standing rules.** Work only in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p2` (branch `feat/cbam-rail-ui-p2`). Never edit a file listed in `src/scripts/cbam-algos/UPSTREAM.json`; `cbam-app.ts` is ours. Never loosen, skip or delete an assertion; if a test blocks you, the code is wrong. Grep, never count from memory. Stage named paths only; never `git stash`. Scratch goes in `/Volumes/OBOSLab/tmp/`. `npm run test:unit` only after `npm run build`. Never open a visible browser. Playwright runs headless, **in the foreground**, through the Bash tool's timeout; the project is `chromium-tier0`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stop at the budget and report.

Context. `src/scripts/cbam-algos/cbam-app.ts` exports `initCbam()`, the calculator's controller. Inside it are closures:
- `ensurePack()` loads the pack once.
- `syncRoutes()` rebuilds the hidden `<select id="cbRoute">` from `routesFor(...)`.
- `runPreview()` validates the form and writes `#cbOut`, returning the priced input or null.
- `paintOutlook(line)` computes `outlookView = outlook(pack, line)` and paints `#cbOutlook`.
- `run()` calls `runPreview`, `paintTitle`, `paintOutlook` and `paintGraphs`.

The page markup (already committed) now has:
- the input column, with `#cbCn` + `[data-good-open]` + `#cbCnName`, `#cbCountry`, the hidden `#cbRoute` + radiogroup `#cbRouteSeg` + `#cbRouteVo`, `#cbDate` + `#cbDatePeriod`, `#cbMass` + `#cbMassRuler`, and the hidden `#cbTier` + radiogroup `#cbTierCards`;
- the dialog `#cbGoodSheet` with `#cbGoodScrim`;
- `#cbOut` as a bento grid.

The new modules are:
- `src/scripts/cbam-ui/tiles-estimate.ts`: `renderEstimateTiles({estimate, importDate, threshold, attestation})`, `renderEstimateIdle(msg)`, `renderEstimateThrown(msg)` and `renderDeck(outlook, massT)`.
- `src/scripts/cbam-ui/inputs-estimate.ts`: `verifiedOnlyRoutes`, `verifiedOnlyNote`, `segmentLabel`, `renderRouteSegments`, `renderMassRuler`, `renderDatePeriod` and `mountRadioMirror(select, group, render?)`.
- `src/scripts/cbam-ui/good-sheet.ts`: `mountGoodSheet({root, sheet, scrim, trigger, input, caption, load})`.

Source-text pins in `tests/unit/cbam-render.test.mjs`, counted over the non-comment lines of this file, must hold after the edit:
- `renderAttestation(` ×3.
- `renderAttestation\([^()]*hasFigure\(e\)\)` ×2.
- `\bhasFigure\(` ×2.
- `isAttested(` ×5.
- `[!=]==\s*'verified-direct\+default-indirect'` ×1.

So **the preview's `renderAttestation({ tier: e.stamp.tier, verifiedRef: v.ok.verifiedRef }, hasFigure(e))` call stays in `runPreview`, spelled exactly so**, and no new `hasFigure(` or `isAttested(` call is added anywhere in this file. The idle sentence literal `'Choose a good, origin, route, mass and import date to see the provisional exposure.'` must stay in this file (`build-contracts.test.mjs`).

- [ ] **Step 1: Count the pins before.**

```bash
f=src/scripts/cbam-algos/cbam-app.ts
code() { grep -v -E '^\s*(//|\*|/\*)' "$f"; }
echo "renderAttestation( $(code | grep -o 'renderAttestation(' | wc -l)  hasFigure( $(code | grep -oE '\bhasFigure\(' | wc -l)  isAttested( $(code | grep -oE '\bisAttested\(' | wc -l)"
```

Expected: `renderAttestation( 3  hasFigure( 2  isAttested( 5`.

- [ ] **Step 2: Imports.** Under the existing `import … from '../cbam-ui/title-card.ts';` add:

```ts
import {
  renderDeck, renderEstimateIdle, renderEstimateThrown, renderEstimateTiles,
} from '../cbam-ui/tiles-estimate.ts';
import {
  mountRadioMirror, renderDatePeriod, renderMassRuler, renderRouteSegments, segmentLabel, verifiedOnlyNote,
  verifiedOnlyRoutes,
} from '../cbam-ui/inputs-estimate.ts';
import { mountGoodSheet } from '../cbam-ui/good-sheet.ts';
```

- [ ] **Step 3: Element lookups.** In `initCbam`, directly after `const listHeading = $('cbxH-list');`, add:

```ts
  // Phase 2 (spec §5.1): the Estimate input column's new controls. All optional, so a stripped
  // page still runs; the hidden #cbRoute and #cbTier stay the source of truth either way.
  const routeSeg = $('cbRouteSeg'), routeVo = $('cbRouteVo'), tierCards = $('cbTierCards');
  const datePeriod = $('cbDatePeriod'), massRuler = $('cbMassRuler'), cnName = $('cbCnName');
  const cbx = $('cbx'), goodSheet = $('cbGoodSheet'), goodScrim = $('cbGoodScrim');
  const goodOpen = document.querySelector<HTMLButtonElement>('[data-good-open]');
```

- [ ] **Step 4: Mark verified-only routes in `syncRoutes`.**

At the top of `syncRoutes()`, after `noRoute = null;`, add `if (routeVo) routeVo.textContent = '';`.

Then find the option builder with `grep -n 'return `<option value="${esc(r)}">${esc(text)}</option>`;' src/scripts/cbam-algos/cbam-app.ts`. The surrounding code is:

```ts
    const opts = rs.map((r) => {
      const text = r === 'default' ? 'single route' : `${r} ${ROUTE_GLOSSARY[r]?.label ?? ''}`.trim();
      return `<option value="${esc(r)}">${esc(text)}</option>`;
    }).join('');
```

Replace it with:

```ts
    // A route the Commission publishes no direct default for prices from verified figures only
    // (spec §5.1). Asked of the engine, marked on the option, so the select stays the one truth
    // and the radio mirror reads it from there.
    const vo = verifiedOnlyRoutes(pack, cn!.value, country!.value, year, rs);
    const opts = rs.map((r) => {
      const text = r === 'default' ? 'single route' : `${r} ${ROUTE_GLOSSARY[r]?.label ?? ''}`.trim();
      return `<option value="${esc(r)}"${vo.has(r) ? ' data-vo' : ''}>${esc(text)}</option>`;
    }).join('');
    if (routeVo) routeVo.textContent = verifiedOnlyNote(rs.filter((r) => vo.has(r)).map(segmentLabel), countryName(country!.value));
```

Keep any comment lines that sat between those statements.

- [ ] **Step 5: `runPreview` renders the tiles.** Make exactly these four replacements, and the try-block and catch-block ones (find each with `grep -n "out!.innerHTML" src/scripts/cbam-algos/cbam-app.ts`):

| Before | After |
|---|---|
| ``out!.innerHTML = `<p class="cb-idle">No estimate: ${esc(noRoute)}.</p>`;`` | ``out!.innerHTML = renderEstimateIdle(`No estimate: ${noRoute}.`);`` |
| `out!.innerHTML = '<p class="cb-idle">Choose a good, origin, route, mass and import date to see the provisional exposure.</p>';` | `out!.innerHTML = renderEstimateIdle('Choose a good, origin, route, mass and import date to see the provisional exposure.');` |
| ``out!.innerHTML = `<p class="cb-idle">${esc(massProblem)}</p>`;`` | `out!.innerHTML = renderEstimateIdle(massProblem);` |
| ``out!.innerHTML = `<p class="cb-idle">${esc(v.error)}</p>`;`` | `out!.innerHTML = renderEstimateIdle(v.error);` |

`renderEstimateIdle` escapes, so the messages go in raw. In the `try` block, replace:

```ts
      out!.innerHTML = t + renderResult(e)
        + renderAttestation({ tier: e.stamp.tier, verifiedRef: v.ok.verifiedRef }, hasFigure(e));
```

with:

```ts
      // Spec §5.1 tiles. The threshold card goes first inside them (its copy says "the exposure
      // below"), and the attestation is still built HERE, by the same call and the same predicate,
      // because cbam-render.test.mjs pins this call site by its source text.
      out!.innerHTML = renderEstimateTiles({
        estimate: e, importDate: date!.value, threshold: t,
        attestation: renderAttestation({ tier: e.stamp.tier, verifiedRef: v.ok.verifiedRef }, hasFigure(e)),
      });
```

In the `catch` block, replace the template that builds `<div class="cb-res cb-unavail">…` with:

```ts
      out!.innerHTML = renderEstimateThrown((err as Error).message);
```

Leave every comment in `runPreview` as it is.

- [ ] **Step 6: The deck, in `paintOutlook`.** Directly after the line `outlookView = line && pack ? outlook(pack, line) : null;`, add:

```ts
    // The Estimate deck (spec §5.1) is drawn from this same outlook, never a second engine run.
    const deck = out!.querySelector<HTMLElement>('[data-deck]');
    if (deck) deck.innerHTML = renderDeck(outlookView, line?.massT ?? '');
```

- [ ] **Step 7: The ruler and the date caption, in `run()`.** Above `function run(): void {` add:

```ts
  /** Steps 3 and 4's captions (spec §5.1): the price period for the date, the line against 50 t. */
  function paintInputs(): void {
    if (datePeriod) datePeriod.innerHTML = pack ? renderDatePeriod(pack.prices, date!.value) : '';
    if (massRuler) {
      massRuler.innerHTML = pack && cn!.value && date!.value && !massRefusal(mass!.value)
        ? renderMassRuler(resolveThreshold(pack, { cn: cn!.value, massT: mass!.value.trim(), date: date!.value }))
        : '';
    }
  }
```

Then make `run()` call it first:

```ts
  function run(): void {
    paintInputs();
    const line = runPreview();
    paintTitle(line);
    paintOutlook(line);
    paintGraphs(line);
  }
```

`resolveThreshold` and `massRefusal` are already imported or defined in this file; confirm with `grep -n "resolveThreshold,\|export function massRefusal" src/scripts/cbam-algos/cbam-app.ts`.

- [ ] **Step 8: Mount the mirrors and the sheet.** Directly before the line `syncVerifiedRows();` that follows the `attest?.addEventListener('change', refresh);` wiring (the "ONCE, AT WIRING TIME" comment), add:

```ts
  // Spec §6.5: the visible radio groups mirror the hidden selects both ways, so cbam-app.ts and
  // the e2e suite keep reading and setting the selects. Mounted after the listeners above, so a
  // pick's `change` reaches syncRouteNote/syncScope/refresh exactly as a select change does.
  if (routeSeg) mountRadioMirror(route, routeSeg, renderRouteSegments);
  if (tier && tierCards) mountRadioMirror(tier, tierCards);
  if (cbx && goodSheet && goodScrim && goodOpen) {
    mountGoodSheet({
      root: cbx, sheet: goodSheet, scrim: goodScrim, trigger: goodOpen, input: cn, caption: cnName,
      load: async () => (await ensurePack())?.classifications ?? null,
    });
  }
```

- [ ] **Step 9: Count the pins after, and run the unit gate.**

Re-run Step 1's command. Expected: `renderAttestation( 3  hasFigure( 2  isAttested( 5`. Then:

```bash
grep -c "Choose a good, origin, route, mass and import date to see the provisional exposure." src/scripts/cbam-algos/cbam-app.ts   # expect 1
npm run check && npm run build && npm run test:unit 2>&1 | tail -6
```

Expected: check clean; `# fail 0`.

- [ ] **Step 10: The browser gate, in the foreground.**

```bash
npx playwright test tests/e2e/cbam-estimate.spec.ts tests/e2e/cbam-shell.spec.ts tests/e2e/cbam-lines.spec.ts --project=chromium-tier0 --reporter=line 2>&1 | tee /Volumes/OBOSLab/tmp/cbam-p2-chromium.txt | tail -40
```

Expected: all pass: 10 + 8 + 57 (or the counts Task 1 recorded). For each failure:
- **A `cbam-estimate.spec.ts` failure** is a defect in the module, markup or wiring. Fix it there.
- **A `cbam-lines` or `cbam-shell` failure** is almost certainly the new markup breaking a hook or a layout assumption (for example a strict-mode double match on `#cbOut .cb-n`, or sideways scroll at 320 px). Fix the code. **Do not edit those two specs in this task.** If you believe a lines-spec expectation is genuinely invalidated by spec §5.1, stop and report it with the test name and the line; it needs the Opus review's ruling.

Repeat until green. Then run `git diff --stat` and confirm that only files of this phase changed.

- [ ] **Step 11: Commit.**

```bash
git add -- src/scripts/cbam-algos/cbam-app.ts
git commit -m "feat(cbam): wire the Estimate tiles — runPreview renders the bento, the deck follows paintOutlook, verified-only routes marked, radio mirrors and the good sheet mounted

Attestation call site, hasFigure/isAttested counts and the idle literal unchanged (pinned).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Also stage and commit any fix you made to an earlier phase-2 file, naming each path.

---

### Task 13: Gate, Firefox, screenshots, Opus review, PR

**Budget:** 45 min (plus the review's own time).
**Files:** none new (a throwaway screenshot spec is created and deleted).

> **Standing rules.** Work only in `/Volumes/OBOSLab/worktrees/cbam-rail-ui-p2` (branch `feat/cbam-rail-ui-p2`). Never edit a file listed in `src/scripts/cbam-algos/UPSTREAM.json`. Never loosen an assertion. Stage named paths only; never `git stash`. Scratch goes in `/Volumes/OBOSLab/tmp/`. `npm run test:unit` only after `npm run build`. **Never open a visible browser**; Playwright runs headless, in the foreground. **Never push or open a PR without the user's explicit word.** Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stop at the budget and report.

Context. Phase 2 of the CBAM rail redesign (spec `docs/superpowers/specs/2026-11-02-cbam-rail-ui-design.md` §5.1) is built on `feat/cbam-rail-ui-p2`. This task proves it and hands it to review. Task 1 recorded **BASELINE_UNIT** (the `# pass` count before phase 2). Phase 2 adds 58 unit tests:

| File | New tests |
|---|---|
| `cbam-format` | 4 |
| `cbam-fingerprint` | 5 |
| `cbam-tiles-estimate` | 16 |
| `cbam-render` twins | 16 |
| `cbam-inputs-estimate` | 7 |
| `cbam-good-sheet` | 7 |
| `cbam-bento-contrast` | 3 |

`tests/e2e/cbam-estimate.spec.ts` adds 10 browser tests.

- [ ] **Step 1: The local gate.**

```bash
npm run check
npm run build && npm run test:unit 2>&1 | tail -6
```

Expected: check clean; `# pass` = BASELINE_UNIT + 58, `# fail 0`. Re-measure each file's count with `grep -c "^test(" <file>` if the total differs, and report each.

- [ ] **Step 2: Chromium, then Firefox once.**

```bash
npx playwright test tests/e2e/cbam-estimate.spec.ts tests/e2e/cbam-shell.spec.ts tests/e2e/cbam-lines.spec.ts --project=chromium-tier0 --reporter=line 2>&1 | tail -15
npx playwright test --project=firefox-cbam --reporter=line 2>&1 | tail -25
```

Expected: both green. `firefox-cbam` runs all three CBAM specs through its `testMatch`. WebKit runs in CI only. Firefox on macOS does not focus a button on click; every keyboard step in the spec calls `.focus()` first for that reason, so a focus failure there is a real defect.

- [ ] **Step 3: Headless screenshots.** Create the throwaway file `tests/e2e/zz-cbam-p2-shots.spec.ts`:

```ts
import { test, type Page } from '@playwright/test';

const OUT = '/Volumes/OBOSLab/tmp/cbam-rail-p2-shots';
async function line(page: Page, cn: string, country: string, route: string, over?: () => Promise<void>): Promise<void> {
  await page.fill('#cbCn', cn); await page.dispatchEvent('#cbCn', 'change');
  await page.locator(`#cbCountry option[value="${country}"]`).waitFor({ state: 'attached' });
  await page.selectOption('#cbCountry', country);
  await page.locator(`#cbRoute option[value="${route}"]`).waitFor({ state: 'attached' });
  await page.selectOption('#cbRoute', route);
  if (over) await over();
  await page.waitForTimeout(600);
}
for (const theme of ['dark', 'light']) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    test(`shots ${theme} ${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      const go = async () => page.goto(`/cbam/cbam-calculator/?theme=${theme}#estimate`);
      const shot = (name: string) => page.screenshot({ path: `${OUT}/${name}-${theme}-${w}.png`, fullPage: false });
      await go(); await shot('1-idle');
      await line(page, '73063077', 'IN', '(C)'); await shot('2-priced');
      await page.locator('#cbOut .b-yrs').scrollIntoViewIfNeeded(); await shot('3-deck-provenance');
      await line(page, '73063077', 'IN', '(D)'); await shot('4-refused');
      await go();
      await line(page, '2523100090', 'DZ', '(A)', async () => {
        await page.selectOption('#cbTier', 'actual-verified');
        await page.fill('#cbSeeDirect', '0.1'); await page.check('#cbAttest');
      });
      await shot('5-mixed-floor');
      await go(); await page.locator('[data-good-open]').click();
      await page.locator('[data-good-search]').fill('welded tube'); await page.waitForTimeout(400);
      await shot('6-good-sheet');
    });
  }
}
```

Run it, then delete it:

```bash
mkdir -p /Volumes/OBOSLab/tmp/cbam-rail-p2-shots
npx playwright test tests/e2e/zz-cbam-p2-shots.spec.ts --project=chromium-tier0 --reporter=line
rm tests/e2e/zz-cbam-p2-shots.spec.ts && git status --short tests/e2e
```

Expected: 24 PNGs; `git status` shows nothing under `tests/e2e`. Look at every PNG beside `docs/superpowers/specs/2026-11-02-cbam-rail-ui/screens/1-estimate-*.jpg` and `7-good-sheet-*.jpg`, and check:
- the inputs column and the tiles follow the reference's layout, radii, type sizes and order;
- no text is clipped, no numeral overflows its tile, and no tile overlaps another;
- the hero is inverted in both themes;
- the Chargeable bar's width matches its percentage, and the low-share and phone variants draw a strip;
- the refused state shows the reason and no figure;
- the sheet slides in on the left with the scrim behind it.

List each deviation from the reference in the report. **Do not open any image in a GUI viewer**; read them with the Read tool.

- [ ] **Step 4: Opus review.** Dispatch an Opus 5.5 reviewer with: this plan; spec §5.1, §6 and §7; `git diff feat/cbam-rail-ui...HEAD`; and the screenshots folder. Ask it to verify:
  1. Every one of the 33 mapped render tests (table at the top of this plan) is either twinned in `cbam-render.test.mjs` or unchanged-and-green, and no existing line of that file changed (`git diff feat/cbam-rail-ui...HEAD -- tests/unit/cbam-render.test.mjs | grep '^-[^-]'` prints nothing).
  2. Every tile renders every state its model returns: idle, refused with the reason verbatim, no price published, verified-only route, mixed tier, residual basis, threshold card or none, thrown, zero embedded, and the floor.
  3. Every spec §6.4 id exists exactly once, and `#cbOut .cb-n`, `.cb-cost` and `.cb-fig` are single elements.
  4. The §7.1 banner is byte-identical to `feat/cbam-rail-ui`'s (`git diff feat/cbam-rail-ui...HEAD -- src/pages/cbam/cbam-calculator.astro | grep -n 'cb-banner' -A12`), and `cb-grid` is still the first token after it.
  5. No file in `UPSTREAM.json` changed (`npm run test:unit` runs the sync check).
  6. The ten decisions at the top of this plan, especially 1 (hidden-but-actionable selects), 3 (threshold card first), 5 (the bar is never widened) and 7 (the one new sentence).
  7. Colour law: bronze only on default-tier marks, cyan only on verified, and the mixed tier in ink.

  Fix what it confirms, re-run Steps 1–2, and commit the fixes with named paths.

- [ ] **Step 5: Push and open the PR, only on the user's word.** The base is the integration branch `feat/cbam-rail-ui`. When this plan was written it existed **only locally** (phase 1 had not been pushed). If `git ls-remote --heads origin feat/cbam-rail-ui` prints nothing, it must be pushed first, and that also needs the user's word.

```bash
git log --oneline feat/cbam-rail-ui..HEAD
git push -u origin feat/cbam-rail-ui-p2
gh pr create --base feat/cbam-rail-ui --head feat/cbam-rail-ui-p2 \
  --title "CBAM rail redesign, phase 2 of 5: Estimate (inputs column, good sheet, four tiles)" \
  --body-file /Volumes/OBOSLab/tmp/cbam-p2-pr.md
```

The PR body lists:
- the 33 mapped tests and their treatment;
- the 58 new unit tests and 10 e2e tests;
- the ten decisions, with the founder items flagged (decision 7's sentence, decision 9's option copy, D1 still pending);
- the screenshot deviations.

It ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Self-review against the spec

| Spec | Task |
|---|---|
| §5.1 "Your line." column, steps 1–5, numbered plates | 11 (markup), 9 (style) |
| §5.1 step 1 Good: field + Change pill, sheet with search, five chips, list from `pack.classifications`, no Electricity chip | 8, 11, 12 |
| §5.1 step 2 Origin select + route segments mirrored to `#cbRoute`; "verified figures only" marking | 7, 11, 12 |
| §5.1 step 3 native date + price-period caption | 7, 11, 12 |
| §5.1 step 4 text mass field, `t` suffix, hint, 0–50 t ruler | 7, 11, 12 |
| §5.1 step 5 two option cards mirrored to `#cbTier`; verified panel; scope row as today | 7, 11, 12 |
| §5.1 `#cbAdd` below step 5; `#cbStatus` stays in the shell | 11 |
| §5.1 Certificates (hero, inverted): count, € when priced, price and quarter, tier chip, what-if label | 4, 9 |
| §5.1 Chargeable: the card is the bar, chargeable and embedded tCO₂e, free-allocation share and factor | 4, 9 |
| §5.1 Three years: stacked deck, "+x% by 2028", no-price note, ↗ to the view | 5, 9, 12 |
| §5.1 Provenance: 64-bit dot fingerprint, data tier, rule pack, folded notes | 3, 4, 9 |
| §5.1 banner: full banner kept on Estimate until D1 | 11 (untouched bytes, pinned) |
| §5.1 sheets from the left; Esc and scrim close; focus trapped and returned | 8, 9, 10 |
| §6.1 every tile renders every state; every assertion ported, none loosened | 4, 5, 6 (the 33-test table) |
| §6.2 banner once, verbatim, before `cb-grid`; eyebrow kept | 11 |
| §6.3 the draft always previews (phase 1), unchanged | 12 (only `#cbOut`'s contents change) |
| §6.4 every id, and the e2e class hooks beside the `b-` classes | 4, 11 (Step 5), 13 (review) |
| §6.5 real radio groups (arrows, `aria-checked`), selects as source of truth, labelled modal dialog, illustrations n/a, AA in both themes | 7, 8, 9 (contrast test), 10 (axe both themes) |
| §7 renderer modules of pure functions; `cbam-app.ts` keeps wiring; old renderers deleted only once ported | 2–8, 12. `renderResult` is **kept**: the List card still uses it until phase 4 |
| §8 illustrations and motion | **Not in phase 2**: phase 5. No placeholders left |
| §11 D5: full CN description, clamped to two lines, `title` | 8 (`goodCaption`), 9 (`b-clamp2`), 11 |

## Open questions and risks (for the Opus review and the founder)

1. **Decision 7** adds one sentence of copy (the free-allocation floor). The founder must approve it, or say how the 8-in-4,564 floor case should read.
2. **Decision 3** puts the legacy de minimis card above the hero, in its old dark `cb-card` look, until phase 4. On a light theme it is a dark plate on a light page. The axe test in Task 10 will flag any contrast failure inside it, and the fix is to restyle it under `.b-legacy`, not to suppress the rule.
3. **Decision 8** folds the engine's notes, including the residual-basis note, behind "Notes · N" (per spec §5.1). The "Origin basis: Residual bucket" row stays visible. Opus should confirm the fold is acceptable for NON-NEGOTIABLE 5 ("residual-basis note travels"): it is rendered, but not shown until opened.
4. **The integration branch is local only.** `feat/cbam-rail-ui` has no `origin` counterpart, so the phase-2 PR needs it pushed first, which needs the user's word.
5. **`#cbOutWrap` is `aria-live="polite"`**, so each re-render now reads the hero, Chargeable and Provenance aloud (the deck is `aria-live="off"`). That is more speech than the old single card. The 250 ms mass debounce still applies. If review finds it too verbose, the fix is `aria-live="off"` on Provenance, with Provenance stated in the commit.
6. **The Firefox focus model** (a click does not focus a button on macOS) is handled in the spec with explicit `.focus()`. WebKit is CI-only, and the first CI run is the first WebKit evidence.
7. **The spec's §6.1 says "138 tests"**; measured today it is 145. The table above is built from the measured file, not the spec's number.
