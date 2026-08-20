# Making the pricing ceiling explicit in the UI

**Status:** design approved 2026-08-20.
**Origin:** the calculator is correct and live, but a user cannot tell from the interface how far forward it can actually price. Asked: make that ceiling explicit.

## What the engine actually does — measured, not assumed

Grey clinker, Algeria, 100 t, route `(A)`, against the shipped pack:

| import date | certificates | euro cost | what the user sees |
|---|---|---|---|
| 2026 Q1–Q2 | 71.465 | €5,385.60 | `cscf_pending` — a labelled CSCF what-if |
| 2026 Q3–Q4 | 71.465 | **none** | `cscf_pending`, plus a note: *"The Commission has not published the 2026-Q3 certificate price, so no …"* |
| 2027, 2028 | none | none | `unavailable` · `NO_CERTIFICATE_PRICE` · `certificate-price/2027-Q1` |
| 2029+ | — | — | route control disabled up front: *"no rules published for 2029"* |

**Tiers 1, 2 and 4 are already honest.** Tier 2 degrades gracefully — it gives the certificate count, withholds the euro figure, and says why in a note on the same card. Tier 4 fails early, before any work.

**Tier 3 is the defect, and it is a funnel problem rather than a disclosure problem.** At a 2027 or 2028 date every control works: the good is offered, routes populate, mass and date accept input. The user fills in the whole line, clicks Add, and only then learns no figure can ever be produced for that year. The refusal itself is accurate and well-worded. It just arrives after the work.

The page banner compounds it slightly by saying *"For a 2026 import no final figure exists…"*, which reads as though other years behave differently.

## The fix

**Warn at the point the fact becomes knowable — the moment the date is entered — and block nothing.**

### Placement

`#cbStatus`, the existing element under the form that already carries *"Complete the line first: good, origin, route, a non-negative mass and a valid import date."* It has `role="status"` and `aria-live="polite"`, so a screen reader announces the warning with no new markup, and it is where the user is already told about problems with the line.

No new furniture. The route control is **not** touched — routes are genuinely published for 2027/28 and disabling them would assert something false.

### Wording

> No certificate price is published for 2027 Q1, so no figure can be produced for this date. The goods, routes and benchmarks are published — only the price is missing.

**The second sentence is not decoration.** The Commission has published the goods, the production routes and the free-allocation benchmarks for 2027 and 2028. A message saying "2027 is not covered" would be false, and false claims in refusals are the defect class this calculator has spent weeks removing.

### The predicate — and two wrong guesses that measurement caught

The test is: **does the pack contain a certificate-price row for the quarter this date falls in?**

`resolveCertificatePrice` (`resolve-fa.ts:188`) throws `REGULATION_NOT_FOUND` **only when no row exists**. A row with `status: 'pending'` returns `{ status: 'pending' }` and the engine continues — which is exactly why tier 2 still produces certificates.

Two predicates were drafted and both were wrong:

1. **"Is the price published?"** — wrong. Measured: 2026 Q3 and Q4 rows are `status: 'pending'`, yet those dates price. This predicate would have shown a false warning on ordinary near-future dates.
2. **"Is the year ≥ 2027?"** — wrong in principle. It hardcodes today's corpus, so it would keep warning after the Commission publishes 2027 prices, silently becoming a false claim.

Row existence is the only test that matches the consumer. This is the [[input-gate-vs-consumer]] rule: **the gate must ask the same question the consumer asks.** When 2027 prices are published, the warning disappears with no code change — which also means it cannot rot into a stale claim.

### The malformed-date case

`quarterOf` **throws** `REGULATION_NOT_FOUND` with selector `quarter/<date>` for anything it cannot parse — `''`, `not-a-date`, and `2027-1-15` (rejected on length; a single-digit month once produced the string `2027-QNaN` and that bug is fixed and documented in the file).

The warning must not fire for an unreadable date. That is a different problem with its own existing handling, and claiming "no certificate price is published" for a date nobody can read would state something the tool does not know. The predicate catches the throw and stays silent.

`quarterOf` also accepts a full UTC timestamp (`2026-03-15T00:00:00.000Z` → `2026-Q1`), so the predicate must not assume a bare day string.

### The banner

Change *"For a 2026 import no final figure exists — the cross-sectoral correction factor is unpublished — so any number below is a labelled what-if"* so it states what the tool covers, rather than implying 2026 is merely an example. It must keep the CSCF sentence, which is true and load-bearing.

## Deliberately not in scope

- **Pricing 2027/28 at an assumed certificate price.** The tool already does this for CSCF, but that assumption has a legal ceiling — CSCF only ever reduces free allocation, so the shown figure is a defensible floor. A future certificate price has no such bound and could be wrong in either direction. Rejected on that asymmetry, not on effort.
- **Blocking 2027/28 the way 2029 is blocked.** 2029 has no published rules at all; 2027 has everything except a price. Treating them alike would hide a real difference.
- **Changing tier 2's behaviour.** Certificates without a euro figure, plus a note naming the quarter, is already the honest answer.
- **The CSCF ceiling itself.** Already explicit per-line (*"What-if · CSCF for 2026 unpublished"*, "Not a final figure", and the floor argument) and in the banner. Nothing to add.

## Testing

- **The predicate, measured at boundaries**: `2026-12-31` → priced tier; `2027-01-01` → warned; a malformed date → silent; a timestamp form → treated as its day. Hand-typed expectations, asserted against the real `quarterOf` and the shipped pack, never against a reimplementation.
- **The warning must not fire on any date the engine can price.** Sweep every quarter the pack carries and assert silence, then sweep 2027–2028 and assert the warning. A guard that cries wolf on a working date is worse than none.
- **It must not replace the completeness message when both apply** — decide and pin which wins, because a user with an empty good field and a 2027 date needs the more actionable of the two.
- **e2e**: entering a 2027 date surfaces the warning before any other field is touched, and the line can still be added and still refuses as before.
