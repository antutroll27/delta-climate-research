# Air Card Explainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Air card gains a PM2.5 concentration line that says how it was derived, and a closed "Why do other apps show a different number?" question with a fixed plain-language answer.

**Architecture:** Two small pure functions in the card's renderer, `pmLine` and `why`, called from the live/stale branch of `block`. `hero` takes the PM2.5 and US lines as arguments instead of building the US line itself. Because the Air pane reuses `block`, it gets both additions with no separate code. Styles sit beside the existing `.aq-us` rules. No API, schema or data change.

**Tech Stack:** TypeScript (vanilla, no framework), Astro page styles, `node:test` with `tsx`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-air-card-explainer-design.md`.

**Every patch and test below was run on 2026-10-11** in a scratch copy of `origin/main` `f0b19fe`. Expected outputs are the ones observed.

---

## Rules for whoever executes this

- Work only in the worktree `/Volumes/OBOSLab/worktrees/air-card-explainer`, branch `feat/air-card-explainer`. Never touch the shared main checkout.
- This repository is public. Stage named paths only. Never `git add -A`. `node_modules` and `dist/` must not be staged.
- Never amend, stash, or `reset --hard`.
- Never weaken a test in place to prove it bites. Mutation proofs run on copies outside the repo (task 6).
- **The answer never says another app is wrong.** If a test's wording ever needs changing, that rule holds.
- Apply the patches exactly. If `git apply --check` fails, stop and report; do not hand-merge.
- No push, PR or merge without the owner's explicit word. `git commit` and `rm` prompt the owner.

## File map

| File | Responsibility |
|---|---|
| Create `tests/unit/aqi-explainer.test.mjs` | 11 unit cases for the two additions |
| Modify `src/scripts/climate-engine/air/air-panel.ts` | `pmLine`, `why`, `hero`'s arguments, `block`'s live/stale branch, the `US_NOTE` strings, the table note |
| Modify `tests/unit/aqi-panel.test.mjs` | two existing pins of the table note |
| Modify `src/components/ClimateEngine/HeatMapStage.astro` | styles for `.aq-pm` and `.aq-why` |
| Create `tests/e2e/aqi-explainer.spec.ts` | the card in a browser at 1440 and 1000 px |

## How to take a patch out of this plan

Each patch below sits in a fenced `diff` block under a heading that names it. This command writes the block that follows a heading to a file:

```bash
plan_block() { python3 - "$1" "$2" <<'EOF'
import re, sys
text = open("/Volumes/OBOSLab/worktrees/air-card-explainer/docs/superpowers/plans/2026-10-11-air-card-explainer.md").read()
start = text.index("#### " + sys.argv[1] + "\n")
block = re.search(r"\n```[a-z]*\n(.*?)\n```\n", text[start:], re.S).group(1) + "\n"
open(sys.argv[2], "w").write(block)
print(len(block.splitlines()), "lines ->", sys.argv[2])
EOF
}
```

Define it once per shell command that uses it (shell state does not persist between commands).

---

### Task 1: Install, build, baseline

**Files:** none tracked.

- [ ] **Step 1: Install and build**

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && npm ci && npm run build > /tmp/air-explainer-build.log 2>&1; echo "build exit $?"
```

Expected: `build exit 0`.

- [ ] **Step 2: Baseline**

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && node --import tsx --test tests/unit/aqi-*.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 284`, `ℹ pass 284`, `ℹ fail 0`.

---

### Task 2: The failing unit tests

**Files:**
- Create: `tests/unit/aqi-explainer.test.mjs`

- [ ] **Step 1: Write the test file**

#### PATCH unit-test-file

```js
// tests/unit/aqi-explainer.test.mjs — the PM2.5 line and "Why do other apps show a different number?"
import assert from 'node:assert/strict';
import test from 'node:test';
import { cardHtml, paneHtml } from '../../src/scripts/climate-engine/air/air-panel.ts';
import { buildPayload } from '../../src/lib/aqi/build.ts';
import { stationFor } from '../../src/lib/aqi/stations.ts';

/**
 * HAND-TYPED, NOT IMPORTED. These are an independent transcript of the card's fixed prose, as
 * the other pinned sentences in this suite are. Shared constants would let a reword change the
 * expectation in the same keystroke. When the wording changes on purpose, change it here in the
 * same commit.
 *
 * THE RULE THE ANSWER KEEPS: it names other apps and never says one is wrong. The cause of the
 * gap between their PM2.5 and CPCB's is not established.
 */
const QUESTION = 'Why do other apps show a different number?';
const ANSWER = 'Apps such as IQAir and aqi.in show the American scale, which gives a higher number for the same air. '
  + 'The US figure above is on that scale. Apps also differ in timing: India\'s official index looks back over many hours, '
  + 'the US figure here weights the most recent ones, and some apps use only the last hour. '
  + 'Apps can also differ in which readings they use. '
  + 'Every number here is calculated from what the pollution board\'s own monitor published';
const WITH_PM = `${ANSWER}, and the PM2.5 figure above is the one to compare.`;
const WITHOUT_PM = `${ANSWER}.`;

const NOW = new Date('2026-10-11T00:00:00Z');
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** A live CPCB payload. `pm25` is the PM2.5 sub-index entry, or null for none at all. */
const cpcb = (pm25 = { avg: 79, hourly: 86 }, over = {}) => ({ history: null, current: {
  schema: 2, area_id: 'in/kolkata/ballygunge', served_at: '2026-10-10T23:40:00Z', state: 'live', observed_at: '2026-10-10T23:30:00Z',
  source: { owner: 'West Bengal Pollution Control Board', via: 'CPCB', standard: 'CPCB National AQI' },
  station: { id: 'openaq:10918', name: 'Ballygunge, Kolkata', lat: 22.5, lon: 88.4, distance_m: 1657, inside: 'outside_window', placement: 'in KMC Ward 69, outside Ward 68' },
  result: { origin: 'cpcb', aqi: 100, category: 'satisfactory', dominant: 'pm10', window_h: 24,
    subindices: [
      ...(pm25 ? [{ parameter: 'pm25', avg: pm25.avg, min: 63, max: 99, hourly: pm25.hourly }] : []),
      { parameter: 'pm10', avg: 100, min: 83, max: 113, hourly: 105 },
    ] },
  ...over } });

test('a live CPCB card prints the PM2.5 concentration under the headline and above the US line', () => {
  for (const html of [cardHtml(cpcb(), 'Ballygunge', NOW), paneHtml(cpcb(), 'Ballygunge', NOW)]) {
    // Sub-index 86 sits in CPCB's 30-60 µg/m³ band: 30 + (86 - 50) × 30 / 50 = 51.6, shown as 52.
    assert.ok(text(html).includes('Fine particles (PM2.5) · about 52 µg/m³ in the latest hour'), text(html));
    assert.ok(html.indexOf('class="num') < html.indexOf('aq-pm'), 'after the official number');
    assert.ok(html.indexOf('aq-pm') < html.indexOf('class="aq-us"'), 'before the US line');
  }
});

test('the PM2.5 figure says it is worked back from the index, because CPCB publishes no concentration', () => {
  const html = cardHtml(cpcb(), 'Ballygunge', NOW);
  const pm = html.match(/<details class="aq-pm">([\s\S]*?)<\/details>/);
  assert.ok(pm, 'closed by default: no open attribute');
  const note = "Worked back from CPCB's latest hourly PM2.5 sub-index (86) on CPCB's own scale. "
    + 'CPCB publishes the index, not the concentration, so this is good to about 1 µg/m³.';
  assert.equal(text(pm[1].match(/<p>([\s\S]*?)<\/p>/)[1]), note);
  // The same sentence on hover, as the US line does it.
  assert.ok(pm[1].includes(`title="${note.replace(/'/g, '&#39;')}"`));
});

test('the concentration is the inverse of the HOURLY sub-index, rounded to a whole number', () => {
  const at = (hourly) => text(cardHtml(cpcb({ avg: 79, hourly }), 'Ballygunge', NOW)).match(/about (\S+) µg\/m³/)?.[1];
  assert.equal(at(50), '30');
  assert.equal(at(100), '60');
  assert.equal(at(0), '0');
  assert.equal(at(86), '52');
  assert.equal(at(250), '105');
  // The 24-hour average is a different number and is not what the line shows.
  assert.equal(text(cardHtml(cpcb({ avg: 250, hourly: 86 }), 'Ballygunge', NOW)).match(/about (\S+) µg\/m³/)?.[1], '52');
});

test('no PM2.5 line without a live CPCB hourly figure: never a guess', () => {
  const none = (p, now = NOW) => assert.doesNotMatch(cardHtml(p, 'Ballygunge', now), /aq-pm|Fine particles/);
  none(cpcb({ avg: 79, hourly: null }));
  none(cpcb({ avg: 79, hourly: Number.NaN }));
  none(cpcb({ avg: 79, hourly: -1 }));
  none(cpcb({ avg: 79, hourly: '86' }));
  none(cpcb(null));
  // Stale: the same payload read three hours after it was observed.
  const later = new Date('2026-10-11T02:40:00Z');
  assert.match(cardHtml(cpcb(), 'Ballygunge', later), /Not Live/);
  none(cpcb(), later);
});

test('an OBOS-calculated figure gets no PM2.5 line, and its answer does not point at one', () => {
  const st = stationFor('in/kolkata/ballygunge');
  const end = Date.parse('2026-09-24T17:30:00Z'); const raw = {};
  for (const p of ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3']) { raw[p] = []; for (let t = end - 31 * 864e5; t <= end; t += 9e5) raw[p].push({ end_utc: new Date(t).toISOString(), value: 40 }); }
  const at = new Date('2026-09-24T18:00:00Z');
  const html = cardHtml(buildPayload('in/kolkata/ballygunge', st, raw, at), 'Ballygunge', at);
  assert.match(html, /US AQI/, 'sanity: the OBOS path still prints a US line');
  assert.doesNotMatch(html, /aq-pm/);
  assert.ok(text(html).includes(WITHOUT_PM));
  assert.ok(!text(html).includes('the PM2.5 figure above'));
});

test('the question is last in the block, closed, and carries the exact answer', () => {
  const html = cardHtml(cpcb(), 'Ballygunge', NOW);
  const why = html.match(/<details class="aq-why">([\s\S]*?)<\/details>/);
  assert.ok(why, 'closed by default: no open attribute');
  assert.ok(html.trimEnd().endsWith('</details>'), 'nothing follows it in the block');
  assert.ok(html.indexOf('Published by CPCB') < html.indexOf('aq-why'), 'after the publication line');
  assert.equal(text(why[1].match(/<summary>([\s\S]*?)<\/summary>/)[1]), QUESTION);
  assert.equal(text(why[1].match(/<p>([\s\S]*?)<\/p>/)[1]), WITH_PM);
});

test('the answer drops its last clause when there is no PM2.5 line to point at', () => {
  const html = cardHtml(cpcb({ avg: 79, hourly: null }), 'Ballygunge', NOW);
  assert.match(html, /US AQI/, 'sanity: the 24-hour US line is still there');
  assert.equal(text(html.match(/<details class="aq-why">[\s\S]*?<p>([\s\S]*?)<\/p>/)[1]), WITHOUT_PM);
});

test('the question rides with the US line: both forms have it, a card with no US line does not', () => {
  const nowcast = { ...cpcb(), us_nowcast: { aqi: 137, category: 'usg', dominant: 'pm25', hours_used: 12 } };
  assert.match(cardHtml(nowcast, 'Ballygunge', NOW), /NowCast[\s\S]*aq-why/);
  assert.match(cardHtml(cpcb(), 'Ballygunge', NOW), /24-h[\s\S]*aq-why/);
  // No PM sub-index at all: no US line, so nothing to explain.
  const gases = cpcb(); gases.current.result.subindices = [{ parameter: 'no2', avg: 65, min: 34, max: 130, hourly: 74 }];
  const html = cardHtml(gases, 'Ballygunge', NOW);
  assert.doesNotMatch(html, /US AQI/);
  assert.doesNotMatch(html, /aq-why/);
});

test('a stale card keeps the question with its 24-hour US line', () => {
  const html = cardHtml(cpcb(), 'Ballygunge', new Date('2026-10-11T02:40:00Z'));
  assert.match(html, /Not Live/);
  assert.match(html, /US AQI/);
  assert.match(html, /aq-why/);
  assert.ok(text(html).includes(WITHOUT_PM));
});

test('states with no figure carry no question', () => {
  const base = cpcb().current;
  const shell = { schema: 2, area_id: base.area_id, served_at: base.served_at, source: base.source, station: base.station };
  const states = [
    buildPayload('in/kolkata/baruipur', null, {}, NOW),
    { history: null, current: { ...shell, state: 'unavailable', reason: 'feed_quiet', last_observed_at: null } },
    { history: null, current: { ...shell, state: 'unavailable', reason: 'station_not_reporting', last_observed_at: null } },
    { history: null, current: { ...shell, state: 'insufficient_data', origin: 'cpcb', observed_at: base.observed_at, reasons: ['no AQI'], subindices: [] } },
  ];
  for (const p of states) {
    const html = cardHtml(p, 'Ballygunge', NOW);
    assert.doesNotMatch(html, /class="num/, `sanity: ${p.current.state} prints no number`);
    assert.doesNotMatch(html, /aq-why|aq-pm/, p.current.state);
  }
});

test('the 24-hour notes no longer name other apps beside a figure that differs from theirs', () => {
  const html = cardHtml(cpcb(), 'Ballygunge', NOW);
  const note = html.match(/<details class="aq-us">[\s\S]*?<p>([\s\S]*?)<\/p>/)[1];
  assert.match(note, /Same air, US EPA scale: converted from CPCB&#39;s 24-hour PM2.5\/PM10\./);
  assert.doesNotMatch(note, /IQAir|aqi\.in/);
});
```

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && plan_block "PATCH unit-test-file" tests/unit/aqi-explainer.test.mjs
```

Expected: `153 lines -> tests/unit/aqi-explainer.test.mjs`. Any other count means the block was not taken whole.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && node --import tsx --test tests/unit/aqi-explainer.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 11`, `ℹ pass 2`, `ℹ fail 9`. The two that pass assert an absence, which is trivially true before the feature exists.

---

### Task 3: The renderer

**Files:**
- Modify: `src/scripts/climate-engine/air/air-panel.ts`

- [ ] **Step 1: Apply the patch**

#### PATCH air-panel

```diff
diff --git a/src/scripts/climate-engine/air/air-panel.ts b/src/scripts/climate-engine/air/air-panel.ts
index f661f9e..1c0045f 100644
--- a/src/scripts/climate-engine/air/air-panel.ts
+++ b/src/scripts/climate-engine/air/air-panel.ts
@@ -18,7 +18,7 @@
 import { category } from '../../../lib/aqi/cpcb.ts';
 import { LIVE_H } from '../../../lib/aqi/build.ts';
 import { AIR_STATES, isAirPayload, isCity, isUsNowcast } from '../../../lib/aqi/valid.ts';
-import { US_WORD, usAqiOf } from '../../../lib/aqi/us-aqi.ts';
+import { US_WORD, naqiToConcentration, usAqiOf } from '../../../lib/aqi/us-aqi.ts';
 import type { AirQualityPayload, AqiResult, CityAqi, UsNowcast, AqiStation, CpcbCategory, CpcbSubIndex, HistoryDay, HistoryResponse, Pollutant, PollutantReading, Result } from '../../../lib/aqi/types.ts';
 
 type Current = AirQualityPayload['current'];
@@ -84,19 +84,19 @@ const windowOf = (r: AqiResult): string => (r.pollutants.find((q) => q.parameter
 
 /* The fallback names no cause: the feed may be down, the station missing from it (register AQI-R47), stale, moved,
    or its published figure rejected by `pick` (off-scale, ambiguous, or not the largest sub-index). */
-function hero(r: Result, muted: boolean, city = '', nc?: UsNowcast): string {
+function hero(r: Result, muted: boolean, pm: string, us: string, city = ''): string {
   const meta = r.origin === 'cpcb'
     ? `Led by <b>${pol(r.dominant)}</b> · CPCB published AQI · <span style="white-space:nowrap">${r.window_h === 8 ? '8-hour average' : '24-hour average'}</span>`
     : `Led by <b>${pol(r.dominant)}</b> · AQI computed by OBOS from OpenAQ (no usable current CPCB figure for this station) · <span style="white-space:nowrap">${windowOf(r)}</span>`;
   return `<div class="hero"><span class="num${muted ? ' muted' : ''}" style="color:${col(r.category)}">${num(r.aqi)}</span>
-    <span class="cat"><span class="dot" style="background:${col(r.category)}"></span>${word(r.category)}</span></div>${usLine(r, nc)}${city}
+    <span class="cat"><span class="dot" style="background:${col(r.category)}"></span>${word(r.category)}</span></div>${pm}${us}${city}
     <p class="meta">${meta}</p>`;
 }
 
 const NOWCAST_NOTE = "Same air on the US EPA scale (NowCast, recent hours weighted, as used by AirNow), converted from this CPCB station's hourly PM2.5/PM10. The official Indian AQI above is the legal standard.";
 const US_NOTE = {
-  cpcb: "Same air, US EPA scale (used by IQAir, aqi.in): converted from CPCB's 24-hour PM2.5/PM10. The official Indian AQI above is the legal standard.",
-  obos: 'Same air, US EPA scale (used by IQAir, aqi.in): computed from the same 24-hour PM2.5/PM10 means. The official Indian AQI above is the legal standard.',
+  cpcb: "Same air, US EPA scale: converted from CPCB's 24-hour PM2.5/PM10. The official Indian AQI above is the legal standard.",
+  obos: 'Same air, US EPA scale: computed from the same 24-hour PM2.5/PM10 means. The official Indian AQI above is the legal standard.',
 } as const;
 
 /* THE US EPA EQUIVALENT, one small muted line under the official number, so a reader
@@ -112,6 +112,39 @@ function usLine(r: Result, nc?: UsNowcast): string {
   return `<details class="aq-us"><summary title="${esc(note)}">≈ US AQI ${u.capped ? '500+' : num(u.aqi)} · ${US_WORD[u.category]} · <span style="white-space:nowrap">${nc ? 'NowCast' : '24-h'}<span class="aq-us-i" aria-hidden="true">i</span></span></summary><p>${esc(note)}</p></details>`;
 }
 
+/* THE PM2.5 CONCENTRATION, in the one unit every air-quality app can be checked against. It is
+   CPCB's latest HOURLY PM2.5 sub-index turned back into µg/m³ (the inverse the US line already
+   uses), so it exists only for a CPCB figure that carries one: never a guess, and never for a
+   stale card, whose hour is as old as the card.
+
+   IT IS DERIVED, AND SAYS SO. CPCB's feed carries sub-indices and no concentrations (the pane's
+   table says as much), so a bare µg/m³ here would read as a published measurement. "about",
+   because the sub-index is a whole number; and a note, opened like the US line's, that names the
+   index it was worked back from. In the sans voice: the mono face is capitals-only and has no µ. */
+function pmLine(r: Result): string {
+  /* A type guard, not a branch anyone reaches: `block` calls this for a live CPCB figure only. */
+  if (r.origin !== 'cpcb') return '';
+  const hourly = r.subindices.find((q) => q.parameter === 'pm25')?.hourly;
+  if (typeof hourly !== 'number' || !Number.isFinite(hourly) || hourly < 0) return '';
+  const note = `Worked back from CPCB's latest hourly PM2.5 sub-index (${num(hourly)}) on CPCB's own scale. CPCB publishes the index, not the concentration, so this is good to about 1 µg/m³.`;
+  return `<details class="aq-pm"><summary title="${esc(note)}">Fine particles (PM2.5) · <b>about ${num(Math.round(naqiToConcentration('pm25', hourly)))} µg/m³</b> <span style="white-space:nowrap">in the latest hour<span class="aq-us-i" aria-hidden="true">i</span></span></summary><p>${esc(note)}</p></details>`;
+}
+
+/* WHY ANOTHER APP'S NUMBER DIFFERS, for the reader who has just looked at one. It names other apps
+   and NEVER SAYS ONE IS WRONG: part of the gap is scale and timing, and the cause of the rest is
+   not established. The closing clause points at the PM2.5 line, so it is said only when that line
+   is on the card. A <details>, closed until asked, last in the block.
+
+   "LOOKS BACK OVER MANY HOURS", NOT "24 HOURS": an AQI led by ozone or carbon monoxide rests on
+   an 8-hour window, and this sentence is printed under those too. */
+const WHY_ANSWER = "Apps such as IQAir and aqi.in show the American scale, which gives a higher number for the same air. "
+  + "The US figure above is on that scale. Apps also differ in timing: India's official index looks back over many hours, "
+  + 'the US figure here weights the most recent ones, and some apps use only the last hour. '
+  + 'Apps can also differ in which readings they use. '
+  + "Every number here is calculated from what the pollution board's own monitor published";
+const why = (hasPm: boolean): string =>
+  `<details class="aq-why"><summary>Why do other apps show a different number?</summary><p>${esc(WHY_ANSWER)}${hasPm ? ', and the PM2.5 figure above is the one to compare.' : '.'}</p></details>`;
+
 /** CPCB's station name without its city and agency: "Ballygunge, Kolkata - WBPCB" → "Ballygunge". */
 const shortStation = (n: string): string => n.replace(/, [^,]+ - [A-Za-z]+$/, '');
 
@@ -183,7 +216,11 @@ function block(c: Current, title: string, place: string, city?: CityAqi, nc?: Us
       /* The city line is as live as the ward figure it rides with: a demoted (stale) card drops it. */
       const live = !stale && c.result.origin === 'cpcb';
       const cityHtml = live ? cityLine(city, c.station.fallback === true) : '';
-      return head(title, chip) + hero(c.result, stale, cityHtml, live ? nc : undefined) + stationLine(c.station, c.source.owner, place) + `<p class="meta">${when}</p>`;
+      const pm = live ? pmLine(c.result) : '';
+      const us = usLine(c.result, live ? nc : undefined);
+      /* The question rides with the US line: with no US figure on the card there is nothing to explain. */
+      return head(title, chip) + hero(c.result, stale, pm, us, cityHtml) + stationLine(c.station, c.source.owner, place) + `<p class="meta">${when}</p>`
+        + (us ? why(pm !== '') : '');
     }
     default:
       return noFigure(title, 'Not loaded', FAILED);
@@ -220,7 +257,7 @@ function subTable(subs: readonly CpcbSubIndex[], lead: Pollutant | null): string
     return `<tr${q.parameter === lead ? ' class="aq-top"' : ''}><td>${pol(q.parameter)}${q.parameter === 'co' || q.parameter === 'o3' ? EIGHT_H : ''}</td><td><span class="si"><i style="width:${w}%;background:${bar}"></i>${num(q.avg)}</span></td><td class="n">${range}</td><td class="n">${num(q.hourly)}</td></tr>`;
   }).join('');
   return `<p class="pane-h">Pollutants · CPCB sub-indices</p><table class="pol"><thead><tr><th>Pollutant</th><th>Sub-index</th><th>Range</th><th>Latest hour</th></tr></thead><tbody>${rows}</tbody></table>` +
-    `<p class="pane-note">Sub-indices on the AQI scale, as CPCB publishes them: 24-hour window; CO and O₃ over the last 8 hours. The largest is the AQI. CPCB's feed carries no concentrations.</p>`;
+    `<p class="pane-note">Sub-indices on the AQI scale, as CPCB publishes them: 24-hour window; CO and O₃ over the last 8 hours. The largest is the AQI. CPCB's feed carries no concentrations; a µg/m³ figure above is worked back from these.</p>`;
 }
 
 function polTable(c: Current): string {
```

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && plan_block "PATCH air-panel" /tmp/air-panel.patch && git apply --check /tmp/air-panel.patch && git apply /tmp/air-panel.patch && git diff --stat
```

Expected: one file changed, `src/scripts/climate-engine/air/air-panel.ts`.

What it does, for the reviewer:
- `pmLine(r)` turns CPCB's latest hourly PM2.5 sub-index back into µg/m³ with the existing `naqiToConcentration`, rounds it, and wraps it in a `<details>` whose note names the index it came from. It returns nothing unless the hourly figure is a finite, non-negative number.
- `why(hasPm)` is the closed question. Its last clause points at the PM2.5 line, so it is said only when that line is on the card.
- `block` builds both lines for the live/stale state, passes them to `hero`, and appends the question only when a US line exists.
- The two 24-hour `US_NOTE` strings lose "(used by IQAir, aqi.in)". The table note gains "a µg/m³ figure above is worked back from these".

- [ ] **Step 2: The new tests pass**

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && node --import tsx --test tests/unit/aqi-explainer.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 11`, `ℹ pass 11`, `ℹ fail 0`.

- [ ] **Step 3: Two existing tests now fail, and should**

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && node --import tsx --test tests/unit/aqi-*.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖" | sort -u
```

Expected: `ℹ fail 2`, naming `CPCB live: published line, 24-hour average, published time, no concentration anywhere` and `I1: the CPCB table marks CO and O₃ as 8-hour, …`. Both pin the table note's old ending. Any other failure: stop and report.

---

### Task 4: The two pins that change on purpose

**Files:**
- Modify: `tests/unit/aqi-panel.test.mjs`

The first test asserted that the whole CPCB pane contains no µg/m³. The pane now carries one, in the PM2.5 line, which says it is derived. The rule the test protects is that the pollutant TABLE shows no concentration, so the assertion narrows to the table. Both tests also take the note's new ending.

- [ ] **Step 1: Apply the patch**

#### PATCH pinned-tests

```diff
diff --git a/tests/unit/aqi-panel.test.mjs b/tests/unit/aqi-panel.test.mjs
index aed71b1..109e8d4 100644
--- a/tests/unit/aqi-panel.test.mjs
+++ b/tests/unit/aqi-panel.test.mjs
@@ -301,8 +301,12 @@ test('CPCB live: published line, 24-hour average, published time, no concentrati
   assert.match(card, /Published by CPCB at <span style="white-space:nowrap"><b>27 Sept 05:00 IST<\/b><\/span>/);
   assert.match(pane, /Pollutants · CPCB sub-indices/);
   assert.match(pane, /<th>Pollutant<\/th><th>Sub-index<\/th><th>Range<\/th><th>Latest hour<\/th>/);
-  assert.doesNotMatch(pane, /µg\/m³|mg\/m³/);
-  assert.match(pane, /The largest is the AQI/);
+  /* The TABLE carries no concentration: CPCB publishes none. The one µg/m³ figure in the pane is the PM2.5
+     line above it, which is worked back from the hourly sub-index and says so (aqi-explainer.test.mjs). */
+  const table = pane.match(/<table class="pol[\s\S]*?<\/table>/)?.[0] ?? '';
+  assert.ok(table, 'the sub-index table is drawn');
+  assert.doesNotMatch(table, /µg\/m³|mg\/m³/);
+  assert.match(pane, /The largest is the AQI\. CPCB's feed carries no concentrations; a µg\/m³ figure above is worked back from these\./);
 });
 
 test('CPCB table rows: PM10 38 with range 18–53 and latest 45; a null hourly is a dash', () => {
@@ -413,7 +417,7 @@ test('I1: the CPCB table marks CO and O₃ as 8-hour, as the OBOS table does, an
   assert.equal(pane.match(/>8-h</g)?.length, 2, 'exactly two 8-h marks');
   const table = /<table class="pol">[^]*?<\/table>/.exec(pane)[0];
   assert.doesNotMatch(table, /24-h/, 'the table itself never says 24-h');
-  assert.match(pane, /Sub-indices on the AQI scale, as CPCB publishes them: 24-hour window; CO and O₃ over the last 8 hours\. The largest is the AQI\. CPCB's feed carries no concentrations\./);
+  assert.match(pane, /Sub-indices on the AQI scale, as CPCB publishes them: 24-hour window; CO and O₃ over the last 8 hours\. The largest is the AQI\. CPCB's feed carries no concentrations; a µg\/m³ figure above is worked back from these\./);
 });
 
 /* ---- Re-audit I-2: the PM2.5 line is labelled by its own last hour, not by the card's state. ---- */
```

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && plan_block "PATCH pinned-tests" /tmp/air-pins.patch && git apply --check /tmp/air-pins.patch && git apply /tmp/air-pins.patch
```

- [ ] **Step 2: Every AQI unit test passes**

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && node --import tsx --test tests/unit/aqi-*.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 295`, `ℹ pass 295`, `ℹ fail 0`.

- [ ] **Step 3: Types**

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && npx tsc --noEmit -p . 2>&1 | grep -cE "air-panel|aqi-explainer"
```

Expected: `0`.

- [ ] **Step 4: Commit**

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && git add tests/unit/aqi-explainer.test.mjs tests/unit/aqi-panel.test.mjs src/scripts/climate-engine/air/air-panel.ts && git status --porcelain && git commit -m "feat(air): a PM2.5 line that says it is derived, and why other apps differ" && git log --oneline -1
```

---

### Task 5: Styles and the browser test

**Files:**
- Modify: `src/components/ClimateEngine/HeatMapStage.astro`
- Create: `tests/e2e/aqi-explainer.spec.ts`

- [ ] **Step 1: Apply the style patch**

#### PATCH styles

```diff
diff --git a/src/components/ClimateEngine/HeatMapStage.astro b/src/components/ClimateEngine/HeatMapStage.astro
index 976625e..bcc9f0b 100644
--- a/src/components/ClimateEngine/HeatMapStage.astro
+++ b/src/components/ClimateEngine/HeatMapStage.astro
@@ -2450,6 +2450,23 @@ const newCity = scope.area.hasData
   :is(.aqblock,[data-pane="air"]) :is(.aq-us,.aq-city) summary:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
   :is(.aqblock,[data-pane="air"]) .aq-us-i{display:inline-grid;place-items:center;width:1.3em;height:1.3em;margin-left:.5em;vertical-align:.05em;border:1px solid currentColor;border-radius:50%;font:500 .5rem/1 var(--sans);text-transform:none;letter-spacing:0}
   :is(.aqblock,[data-pane="air"]) :is(.aq-us,.aq-city) p{margin:4px 0 0;font-size:.62rem;line-height:1.45;color:var(--ink)}
+  /* The PM2.5 concentration (air-panel.ts pmLine): the .meta voice, so the unit is set in the sans face,
+     opening its own note like the US line because the figure is worked back, not published. */
+  :is(.aqblock,[data-pane="air"]) .aq-pm{margin:2px 0 0}
+  :is(.aqblock,[data-pane="air"]) .aq-pm summary{list-style:none;cursor:pointer;display:block;font:400 .68rem/1.5 var(--sans);color:var(--ink)}
+  :is(.aqblock,[data-pane="air"]) .aq-pm summary::-webkit-details-marker{display:none}
+  :is(.aqblock,[data-pane="air"]) .aq-pm summary b{font-weight:500;color:var(--paper)}
+  :is(.aqblock,[data-pane="air"]) .aq-pm summary:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
+  :is(.aqblock,[data-pane="air"]) .aq-pm p{margin:4px 0 5px;font-size:.62rem;line-height:1.45;color:var(--ink)}
+  /* "Why do other apps show a different number?" (air-panel.ts why): last in the block, under a hairline,
+     in sentence case so it reads as a question and not as another data label. */
+  :is(.aqblock,[data-pane="air"]) .aq-why{margin:8px 0 0;padding-top:7px;border-top:1px solid var(--line)}
+  :is(.aqblock,[data-pane="air"]) .aq-why summary{list-style:none;cursor:pointer;font:500 .68rem/1.4 var(--sans);color:var(--cyan)}
+  :is(.aqblock,[data-pane="air"]) .aq-why summary::-webkit-details-marker{display:none}
+  :is(.aqblock,[data-pane="air"]) .aq-why summary::after{content:' +'}
+  :is(.aqblock,[data-pane="air"]) .aq-why[open] summary::after{content:' \2013'}
+  :is(.aqblock,[data-pane="air"]) .aq-why summary:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
+  :is(.aqblock,[data-pane="air"]) .aq-why p{margin:6px 0 2px;font-size:.68rem;line-height:1.5;color:var(--ink)}
   /* The city-wide AQI (air-panel.ts cityLine): the US line's own voice and token, a step smaller, so it
      can never read as the ward's figure; its note lists the stations averaged. */
   :is(.aqblock,[data-pane="air"]) .aq-city{margin:0}
```

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && plan_block "PATCH styles" /tmp/air-css.patch && git apply --check /tmp/air-css.patch && git apply /tmp/air-css.patch
```

- [ ] **Step 2: Write the browser test**

#### PATCH e2e-test-file

```ts
import { expect, test } from '@playwright/test';
import { stubAir } from './aqi-cpcb-stub.ts';

/**
 * THE PM2.5 LINE AND "WHY DO OTHER APPS SHOW A DIFFERENT NUMBER?" (air-panel.ts pmLine, why),
 * on the built page with the stubbed CPCB answer: PM2.5 hourly sub-index 90, which is
 * 30 + (90 - 50) × 30 / 50 = 54 µg/m³ on CPCB's own scale.
 *
 * Both are closed until asked, by click and by keyboard, and neither pushes the card sideways.
 * The answer names other apps and never says one is wrong; the unit tests pin its exact words.
 */
const BALLYGUNGE = '/heat-map/in/kolkata/ballygunge/';

test.describe('Air card: PM2.5 and the other-apps question', () => {
  test.setTimeout(120_000);

  /* The widths aqi-us-equivalent.spec.ts uses: a desktop, and 1000 px, the narrowest that shows the card. */
  for (const width of [1440, 1000]) {
    test(`${width} px: the line sits between the headline and the US line; both notes open on demand`, async ({ page }, info) => {
      test.skip(info.project.name !== 'chromium-tier0', 'a DOM check: one tier is enough');
      await page.setViewportSize({ width, height: width === 1000 ? 800 : 900 });
      await stubAir(page);
      await page.goto(BALLYGUNGE);
      const card = page.locator('#aqiBlock');
      await expect(card).toBeVisible({ timeout: 60_000 });

      const pm = card.locator('.aq-pm summary');
      await expect(pm).toContainText('Fine particles (PM2.5) · about 54 µg/m³ in the latest hour');
      const [hero, line, us] = await Promise.all([card.locator('.hero').boundingBox(), pm.boundingBox(), card.locator('.aq-us summary').boundingBox()]);
      expect(line!.y).toBeGreaterThan(hero!.y + hero!.height - 1);
      expect(us!.y).toBeGreaterThan(line!.y + line!.height - 1);

      /* The derivation note: hidden, then opened by click. */
      await expect(card.locator('.aq-pm p')).toBeHidden();
      await pm.click();
      await expect(card.locator('.aq-pm p')).toContainText("Worked back from CPCB's latest hourly PM2.5 sub-index (90)");
      await pm.click();
      await expect(card.locator('.aq-pm p')).toBeHidden();

      /* The question: last in the block, hidden answer, opened from the keyboard. */
      const why = card.locator('.aq-why');
      const ask = why.locator('summary');
      await expect(ask).toHaveText('Why do other apps show a different number?');
      await expect(why.locator('p')).toBeHidden();
      await ask.focus();
      await page.keyboard.press('Enter');
      await expect(why.locator('p')).toContainText('Apps such as IQAir and aqi.in show the American scale');
      await expect(why.locator('p')).toContainText('the PM2.5 figure above is the one to compare');
      await expect(why.locator('p')).not.toContainText(/wrong|incorrect|inaccurate/i);
      const [c, w, last] = await Promise.all([card.boundingBox(), why.boundingBox(), card.locator('> :last-child').evaluate((el) => el.className)]);
      expect(last).toBe('aq-why');

      /* Open, it stays inside the card and the page does not scroll sideways. */
      expect(w!.x + w!.width).toBeLessThanOrEqual(c!.x + c!.width + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});
```

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && plan_block "PATCH e2e-test-file" tests/e2e/aqi-explainer.spec.ts
```

Expected: `58 lines -> tests/e2e/aqi-explainer.spec.ts`.

- [ ] **Step 3: Rebuild and run the card's browser tests**

Run in the foreground. The 3-D map shares the GPU: if another GPU-heavy app is open on the machine these time out for reasons unrelated to the change, and CI is then the check.

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && npm run build > /tmp/air-explainer-build.log 2>&1; echo "build exit $?"; npx playwright test tests/e2e/aqi-explainer.spec.ts tests/e2e/aqi-us-equivalent.spec.ts --project=chromium-tier0 --reporter=line 2>&1 | grep -E "[0-9]+ (passed|failed|skipped)"
```

Expected: `build exit 0`, then `6 passed`.

- [ ] **Step 4: The contrast sweep still passes with the new words on the card**

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && npx playwright test tests/e2e/console-contrast.spec.ts -g "Air card" --project=chromium-tier0 --reporter=line 2>&1 | grep -E "[0-9]+ (passed|failed)"
```

Expected: `1 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && git add src/components/ClimateEngine/HeatMapStage.astro tests/e2e/aqi-explainer.spec.ts && git status --porcelain && git commit -m "feat(air): styles and a browser test for the PM2.5 line and the question" && git log --oneline -1
```

---

### Task 6: Prove the unit tests are not vacuous

**Files:** none in the repo. Mutants are copies in `/tmp/air-proof`.

- [ ] **Step 1: A scratch copy that resolves the same imports**

```bash
S=/tmp/air-proof; W=/Volumes/OBOSLab/worktrees/air-card-explainer; mkdir -p $S/src/scripts/climate-engine/air $S/tests/unit \
 && ln -sfn $W/src/lib $S/src/lib && ln -sfn $W/node_modules $S/node_modules && ln -sfn $W/tests/fixtures $S/tests/fixtures \
 && cp $W/tests/unit/aqi-explainer.test.mjs $S/tests/unit/ && cp $W/src/scripts/climate-engine/air/air-panel.ts $S/original.ts \
 && cp $S/original.ts $S/src/scripts/climate-engine/air/air-panel.ts && cd $S \
 && node --import tsx --test tests/unit/aqi-explainer.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```

Expected: `ℹ pass 11`, `ℹ fail 0`.

- [ ] **Step 2: Ten mutants**

```bash
cd /tmp/air-proof && mut() { python3 - original.ts src/scripts/climate-engine/air/air-panel.ts "$2" "$3" <<'EOF'
import sys
src, dst, a, b = sys.argv[1:5]
s = open(src).read()
print(f"landed={s.count(a)}", end=" ")
open(dst, "w").write(s.replace(a, b, 1))
EOF
o=$(node --import tsx --test tests/unit/aqi-explainer.test.mjs 2>&1); echo "$1: $(echo "$o" | grep -E '^ℹ (pass|fail)' | tr '\n' ' ')"; }
mut finite "if (typeof hourly !== 'number' || !Number.isFinite(hourly) || hourly < 0) return '';" "if (hourly === null || hourly === undefined) return '';"
mut stale "const pm = live ? pmLine(c.result) : '';" "const pm = pmLine(c.result);"
mut hourly-vs-avg "?.hourly;" "?.avg;"
mut round "num(Math.round(naqiToConcentration('pm25', hourly)))" "num(naqiToConcentration('pm25', hourly))"
mut why-gate "+ (us ? why(pm !== '') : '');" "+ why(pm !== '');"
mut why-clause "hasPm ? ', and the PM2.5 figure above is the one to compare.' : '.'" "', and the PM2.5 figure above is the one to compare.'"
mut note-names "cpcb: \"Same air, US EPA scale: converted" "cpcb: \"Same air, US EPA scale (used by IQAir, aqi.in): converted"
mut pm-note "CPCB publishes the index, not the concentration, so this is good to about 1 µg/m³." "A measured concentration."
mut origin "  if (r.origin !== 'cpcb') return '';
  const hourly" "  const hourly"
```

Expected: every line starts `landed=1`. The first eight each report at least one failure (`ℹ fail` of 1 or more). `origin` reports `ℹ pass 11 ℹ fail 0`: that check only narrows a type, because `block` calls `pmLine` for a live CPCB figure and nothing else. It is the one known equivalent mutant.

- [ ] **Step 3: The repo's source was not touched**

```bash
cmp /Volumes/OBOSLab/worktrees/air-card-explainer/src/scripts/climate-engine/air/air-panel.ts /tmp/air-proof/original.ts && echo untouched
```

Expected: `untouched`.

---

### Task 7: Full gates and review

- [ ] **Step 1: The whole unit suite and the type check**

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && npm run check 2>&1 | tail -3; npm run test:unit 2>&1 | grep -E "^ℹ (tests|pass|fail)|vendored engine|in sync"
```

Expected: 0 errors from `check`; `ℹ fail 0`, with the total 11 above this branch's base (1379 on `origin/main` `f0b19fe`, so 1390).

- [ ] **Step 2: Scan everything this branch will publish**

A pull request publishes every commit on the branch and keeps them reachable after a squash-merge.

```bash
cd /Volumes/OBOSLab/worktrees/air-card-explainer && git log -p origin/main..HEAD > /tmp/air-explainer-publish.txt \
 && echo "name-list hits: $(grep -Eicf "$OBOS_EXCLUDE_PATTERNS" /tmp/air-explainer-publish.txt)" \
 && echo "commits: $(git rev-list --count origin/main..HEAD)"
```

`OBOS_EXCLUDE_PATTERNS` is the owner's file of regular expressions for names that must never appear in this repository. Expected: `0` hits. Report counts only.

- [ ] **Step 3: Independent review, read-only**

A fresh reviewer gets the spec, this plan and the commits. Ask it: is every sentence the card now prints true in every state, including an ozone-led day, a stale card, a Bengaluru fallback station and an OBOS-calculated figure; does any wording say or imply another app is wrong; can the PM2.5 line ever show for a figure that is not live CPCB; does the pane contradict itself anywhere; and is anything untested.

- [ ] **Step 4: Fix what is real, re-run steps 1 and 2, and stop**

Report to the owner with a refreshed preview. Push and PR only on their word.
