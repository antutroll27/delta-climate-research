# Validity-window boundary: the first day of every rule window is unreachable

2026-08-14 · found by the post-ship adversarial audit · **approved design, awaiting plan**

## The defect

On the first day of any benchmark validity window, every goods lookup refuses — and refuses
with a statement that is false about the regulation:

> "The published rules do not give a free-allocation benchmark for this good, production route,
> year or quarter, so no figure is shown. Missing rule: `benchmark/25231000/column-B/(A)/2026-01-01`"

The rule exists and is in force that day. Measured against the shipped pack:

```
72241010 (F)   2025-12-31 → REFUSED   (correct — before the regime)
               2026-01-01 → REFUSED   ← should be bm 1.807
               2026-01-02 → OK  bm 1.807   window 2026-01-01..2027-12-31
               2027-12-31 → OK  bm 1.807   ← the validTo edge is already correct
               2028-01-01 → REFUSED   ← should be bm 1.64
               2028-01-02 → OK  bm 1.64    window 2028-01-01..2030-12-31
```

1 January 2026 is the first day of the CBAM definitive regime. It is the single most likely
date an importer types when sizing their exposure for the year.

## Root cause

`active()` compares validity bounds to the import date **lexicographically**:

```ts
function active(from: string, to: string | null, date: string): boolean {
  return from <= date && (to === null || date <= to)
}
```

String comparison is only sound when both operands have the same shape. They do not:

| side | shape | count in the shipped pack |
| --- | --- | --- |
| `benchmark.validFrom` | `2026-01-01T00:00:00.000Z` (UTC timestamp) | 2,465 of 2,465 |
| `benchmark.validTo` | `2027-12-31T23:59:59.999Z` | 794 non-null |
| `selector.date` | `2026-01-01` (calendar day) | always — it comes from `<input type="date">` |

So every benchmark lookup already compares a calendar day against a timestamp. It *usually*
works by accident:

- `'2026-01-01T00:00:00.000Z' <= '2026-06-15'` → differs at position 6 (`1` vs `6`) → **true**, correct
- `'2027-12-31' <= '2027-12-31T23:59:59.999Z'` → prefix equal, shorter sorts first → **true**, correct
- `'2026-01-01T00:00:00.000Z' <= '2026-01-01'` → prefix equal, **longer sorts LAST** → **false**, WRONG

The `validTo` edge is saved by the same rule that breaks the `validFrom` edge: a shorter string
sorts before a longer one with the same prefix. That is why only the window's opening day fails.

**Why the shapes were allowed to diverge.** The rule-package contract's date validator is
unanchored:

```ts
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'must start with an ISO date (YYYY-MM-DD)')
```

No `$`. Both `'2026-01-01'` and `'2026-01-01T00:00:00.000Z'` are contract-valid. The contract
permits two shapes; the comparison assumes one.

**There are two copies of `active()`**, byte-identical:
- `lib/cbam/resolve-fa.ts:19` — benchmark resolution. **Confirmed live**: measured above.
- `lib/regulatory/resolve.ts:10` — `resolveClassification` and rule-package validity.
  **Exposure unverified.** Whether it misfires depends on the shape of the SaaS's stored rule
  packages, which I could not determine from the test tree — the fixtures there declare
  `validFrom: string` rather than carrying representative data. It is fixed regardless, because
  the same latent hazard should not be left behind in a copy of the same function; but this
  spec does not claim a live defect there, and no test in this change asserts one beyond the
  boundary behaviour itself.

## Decision: compare calendar days

```ts
const day = (s: string) => s.slice(0, 10)

function active(from: string, to: string | null, date: string): boolean {
  const d = day(date)
  return day(from) <= d && (to === null || d <= day(to))
}
```

This is **not** a workaround for awkward data. Reg (EU) 2023/956 applies to goods imported
"on or after 1 January 2026" — a calendar day, not an instant. Comparing calendar days is what
the domain means, and it makes the function immune to whichever shape the data carries, which
is the protection that matters given both shapes stay legal.

Rejected alternatives:

- **Parse to timestamps** (`new Date(x).getTime()`, as `lib/eudr/resolve-risk.ts:50` does).
  Works, but imports a timezone question the regulation does not ask — an import on
  1 January in Mumbai is not a different day from one in Lisbon for this purpose.
- **Normalise rows at table-build time.** Fixes it per load rather than per comparison, but
  `active()` has two callers with different table sources, so that is more surface, not less —
  and it would not protect a caller passing a timestamp as `selector.date`.
- **Anchor the contract and regenerate.** Correct long-term, but it makes 2,465 existing rows
  contract-invalid until the pack is rebuilt — a hard cutover across two repos. Deferred by
  explicit decision (see Out of scope).

## Blast radius — measured, not estimated

All 109,440 benchmark selectors (570 CN × 12 routes × 2 columns × 8 dates spanning
2025-12-31…2031-01-01), swept before and after the change:

```
11,265 probes changed, ALL in one direction:
    9,581 × 2026-01-01   REFUSED → priced
    1,684 × 2028-01-01   REFUSED → priced
        0   priced → REFUSED
        0   priced value changed
        0   change on any other date
```

Strictly a correction. Nothing that prices today changes by a cent.

The upstream suite passes unchanged with both copies patched: **416/416**.

No test anywhere pins the current behaviour. Every `2026-01-01` occurrence in the CBM test
tree is in EUDR/evidence suites that use plain dates on *both* sides, so they compare
same-shape and are unaffected.

## Tests

1. **The two live boundaries.** `2026-01-01` resolves bm `1.807`; `2028-01-01` resolves
   bm `1.64` (72241010 / (F) / Column B). Both currently refuse.
2. **The `validTo` edge does not move.** `2027-12-31` still resolves the 2026 window and
   `2028-01-02` still resolves the 2028 one — proving the fix does not widen a window at its
   far end while opening it at the near end.
3. **The sweep — the one that matters.** For every distinct `validFrom` in the shipped pack,
   that calendar day must resolve. Derived from the pack at test time, not hardcoded, so the
   IR 2026/1740 re-keying cannot introduce a new dead day without failing. Today that is two
   values; after the rebuild it may be more.
4. **Shape-agnosticism.** The same lookup with `date` passed as a full timestamp
   (`2026-06-15T12:00:00.000Z`) returns the same benchmark as the plain calendar day.
5. **Fail-closed is unchanged.** `date: ''` still refuses (slicing `''` yields `''`, which
   fails both edges); `2025-12-31` still refuses as before the regime.
6. **The second copy.** An equivalent boundary test against `regulatory/resolve.ts`'s
   `resolveClassification`, so the fix is pinned in both places rather than one.

## Out of scope, by decision

- **Anchoring `isoDate`** and **deduplicating the two `active()` copies**. Deferred to the
  IR 2026/1740 pack rebuild, where regenerating with plain calendar days costs almost nothing
  extra. Recorded here so it is a scheduled follow-up rather than a loose end.
- Everything else the audit found (the blank-indirect zero, the out-of-sector threshold
  verdict, the §4 pin, the banner). Separate fixes, tracked separately.

## Landing

Upstream in CBM first (both files), then re-vendor `resolve-fa.ts` byte-for-byte into
`src/scripts/cbam-algos/` with `node scripts/cbam-sync-check.mjs --update`. `regulatory/resolve.ts`
is **not** among the 11 vendored files (only `regulatory/iso-3166.ts` and `regulatory/types.ts`
are), so only the CBAM copy comes down. The classification gate's fix lives upstream only, which
is correct: `resolveClassification` appears in the browser bundle exactly once, inside a comment
in `estimate-from-pack.ts:140`, and is never called.
