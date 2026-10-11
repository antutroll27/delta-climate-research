# Air card: a PM2.5 line and "why do other apps differ?"

**Date:** 2026-10-11
**Status:** design approved by the founder from a preview on 2026-10-11, including the two changes a prototype forced (section 9). Not yet built on this branch.

## 1. Problem

The Air card shows India's official AQI as CPCB publishes it, with a US-scale equivalent beneath.
People who have just looked at another air-quality app see a different, usually higher, number
and conclude OBOS is wrong.

Measured for Ballygunge at 05:31 IST on 2026-10-11:

| Source | Figure | Scale |
|---|---|---|
| OBOS headline | 100 | India's National AQI, CPCB's published figure |
| OBOS US line | 137 | US EPA, NowCast |
| Two widely used apps | 171 and 186 | US scale |

OBOS's headline equals CPCB's feed exactly. Part of the gap to the other apps is scale and
averaging time. The rest is explained by neither, and its cause is not established.

## 2. Decision

Two additions to the card. Nothing else on it moves.

1. **A PM2.5 concentration line** under the headline. Concentration in µg/m³ is the one figure
   every app can be checked against.
2. **One question at the bottom**, "Why do other apps show a different number?", which opens a
   short plain-language answer.

Considered and rejected:

- **Showing other platforms' figures on the card.** No major platform permits it freely, and it
  would put a number OBOS cannot explain beside one it can.
- **An India/US toggle.** It hides one of the two numbers a confused reader needs to see together.
- **Rewording the US line** to "≈ 137 on the US scale". In the preview it wrapped and left
  "NowCast" on a line of its own. The current wording stays.

## 3. What the reader sees

```
Air quality · Ballygunge                                   LIVE
100  Satisfactory
Fine particles (PM2.5) · about 52 µg/m³ in the latest hour (i)
≈ US AQI 137 · Unhealthy for Sensitive Groups · NowCast (i)
Kolkata (entire city) · 110 Moderate · 7 stations (i)
Led by PM10 · CPCB published AQI · 24-hour average
Ballygunge, Kolkata · nearest official WBPCB monitor · 1.7 km …
Published by CPCB at 11 Oct 05:00 IST
────────────────────────────────────────────────────────────
Why do other apps show a different number? +
```

The answer, exactly:

> Apps such as IQAir and aqi.in show the American scale, which gives a higher number for the same
> air. The US figure above is on that scale. Apps also differ in timing: India's official index
> looks back over many hours, the US figure here weights the most recent ones, and some apps use
> only the last hour. Apps can also differ in which readings they use. Every number here is
> calculated from what the pollution board's own monitor published, and the PM2.5 figure above is
> the one to compare.

The PM2.5 line's own note, opened like the US line's:

> Worked back from CPCB's latest hourly PM2.5 sub-index (86) on CPCB's own scale. CPCB publishes
> the index, not the concentration, so this is good to about 1 µg/m³.

### Wording rules

- **Never say another app is wrong.** The cause of the PM2.5 gap is unproven. The answer says
  apps "can differ in which readings they use" and stops there.
- **"about"** before the concentration. It is recovered from CPCB's published sub-index, which is
  a whole number, so it is good to roughly 1 µg/m³.
- **The figure says it is derived.** CPCB's feed carries sub-indices and no concentrations, and
  the Air pane already tells the reader so. A bare µg/m³ would read as a published measurement.
- **"looks back over many hours"**, not "averages the last 24 hours". An AQI led by ozone or
  carbon monoxide rests on an 8-hour window, and the answer is printed under those too.
- **"in the latest hour"**, not "this hour". The preview said "this hour". CPCB's hourly figure
  may describe air up to an hour older than its stamp, and "latest" claims less.
- Units are set in the sans face. The mono face is capitals-only and has no µ.

## 4. Behaviour

### 4.1 The PM2.5 line

- **Source.** `current.result.subindices`, the entry for `pm25`, field `hourly`. Converted with
  the existing `naqiToConcentration('pm25', hourly)` in `src/lib/aqi/us-aqi.ts`, then rounded to a
  whole number. No new data, no new request.
- **Shown** only when the card is live, the figure's origin is CPCB, and `hourly` is a finite
  number. These are the conditions under which the NowCast line is shown.
- **Not shown** when the card is stale, when the figure was calculated by OBOS from OpenAQ, or
  when CPCB published no hourly PM2.5 sub-index. The card then reads as it does today. It never
  shows a guessed or substituted concentration.

### 4.2 The explainer

- A native `<details>`, closed by default, last in the block, under a hairline.
- **Shown** whenever the US line is shown, in either of its forms (NowCast or 24-hour).
- **Not shown** in the no-station, unavailable and insufficient-data states, which carry no
  figure to explain.
- The same text in Kolkata and Bengaluru.
- When the PM2.5 line is absent, the answer's last clause, "and the PM2.5 figure above is the one
  to compare", is dropped, so the text never points at a line that is not there.

### 4.3 The Air pane

The pane reuses the card's block, so both additions appear there too, above the pollutant table.

The table's note ends "CPCB's feed carries no concentrations." It gains a clause: "CPCB's feed
carries no concentrations; a µg/m³ figure above is worked back from these." The table itself
still shows sub-indices only.

### 4.4 The existing 24-hour notes

The two fallback notes under the US line say "US EPA scale (used by IQAir, aqi.in)". With the
explainer carrying that comparison, the parenthesis is removed from both. Naming those apps in
the note beside a figure 30 to 50 points below theirs reads as a promise of agreement.

## 5. Where it lives

| File | Change |
|---|---|
| `src/scripts/climate-engine/air/air-panel.ts` | `pmLine` and `why`; `hero` takes the two lines as arguments; the live/stale branch of `block`; the two `US_NOTE` strings; the table note |
| `src/components/ClimateEngine/HeatMapStage.astro` | style rules for `.aq-pm` and `.aq-why`, beside the existing `.aq-us` rules |
| `tests/unit/aqi-explainer.test.mjs` (new) | 11 cases for the two additions |
| `tests/unit/aqi-panel.test.mjs` | two existing pins of the table note, changed on purpose (section 9) |
| `tests/e2e/aqi-explainer.spec.ts` (new) | the line's place, both notes opening by click and keyboard, no sideways scroll, at 1440 and 1000 px |

No API, schema, relay or storage change.

## 6. Testing

- **Unit.** The PM2.5 line's exact text for a known sub-index; its absence when stale, when the
  origin is OBOS, and when `hourly` is missing or not finite. The explainer's presence with each
  form of the US line and its absence in the three no-figure states. The answer's text is pinned
  against a hand-typed copy in the test, as the card's other fixed prose is.
- **Mutation proofs**, run on copies outside the repo: remove each condition in 4.1 and 4.2 in
  turn; a named test must fail each time.
- **e2e.** The line and the question are visible on the Ballygunge card; each note is hidden
  until activated, one by click and one by keyboard; no horizontal overflow at 1440 and 1000 px,
  the widths the existing card test uses. The card is not shown at every width, so other widths
  would test nothing.
- **Contrast.** The existing console-contrast sweep covers every word on the card in both
  basemap themes. The new text must pass it unchanged.
- **Gates.** `npm run check`, `npm run test:unit`, and CI's browser stage.

## 7. Risks

- **The PM2.5 line makes the gap visible.** It will show about 52 where another app shows about
  105 for the same station. That is the purpose of the line and was accepted by the founder.
- **The answer is a general statement about other apps.** It is true as worded on 2026-10-11:
  both named apps showed a US-scale figure by default. If either changes its default scale, the
  sentence needs revisiting.
- **The card is taller** by one line, plus the question. The right panel scrolls; the e2e
  overflow check covers the layout.

## 8. Out of scope

- Any third-party figure, widget or link on the card.
- Finding out why other platforms' PM2.5 differs.
- The Air card's visibility below 981 px, a known separate item.
- A concentration line when the figure comes from OpenAQ.

## 9. What the prototype changed, 2026-10-11

The change was built in a scratch copy before this spec was finalised. Existing tests caught two
problems with the first design, and both fixes were approved by the founder.

- **A bare concentration contradicted an existing rule.** A test asserted that the CPCB pane
  shows no µg/m³ anywhere, and the pane's own note says CPCB's feed carries none. The PM2.5
  line now carries a note saying it is worked back from the index, and the pane's note says the
  same. The test now asserts that the pollutant table shows no concentration.
- **"Averages the last 24 hours" was false on some days.** A test that guards the headline's
  window statement failed on an ozone-led card. The sentence became "looks back over many
  hours".

Measured on the prototype: 295 of 295 AQI unit tests (284 before, 11 new); both new browser
tests, the four existing US-line browser tests and the Air-card contrast sweep pass; nine of
ten deliberate breakages are caught. The tenth removes a check that only narrows a type and
cannot be reached at run time.

## What the independent review changed

A read-only review rendered every state of the card and found sentences that were true on the day
they were written and false on others. The printed wording in the sections above is superseded by
the renderer and its tests where they differ.

- **"Gives a higher number for the same air" was false on bad-air days.** Above about 80 µg/m³ of
  PM2.5, and on PM10-led days, the US figure is the lower one. The answer now says the American
  scale "scores the same air differently from India's".
- **"The US figure here weights the most recent ones" was false under a 24-hour US line** (a stale
  card, a card with no NowCast, an OBOS-calculated figure). The answer no longer describes this
  card's own timing; the US line's note already does.
- **"Every number here is calculated from what the pollution board's own monitor published" is
  gone.** It was untrue of an OBOS-calculated figure, and beside "apps can differ in which readings
  they use" it read as a claim to be the more official. The closing sentence now says only that
  µg/m³ means the same on every scale.
- **The PM2.5 line is withheld at a sub-index of 0 and above 400.** CPCB's calculator treats 0 as
  a missing reading, and its top band is open-ended, so the inverse there would be an
  extrapolation. Its note says "to within about 2 µg/m³": one index point spans 1.3 µg/m³ in the
  121-250 band.
- **The pane's table note** says "where a PM2.5 figure in µg/m³ appears above", because on a stale
  pane none does.
