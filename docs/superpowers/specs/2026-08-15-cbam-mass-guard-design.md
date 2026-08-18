# Fail-closed net mass — design

**Date:** 2026-08-15
**Status:** approved, ready for planning
**Scope:** the `massT` input only. The half-verified / mixed-tier fallback is a separate spec.

## The defect

`massT` reaches `new Decimal()` in the engine with no gate. Measured against the shipped pack,
cement clinker / DZ / route (A) / 2026-03-15:

| `massT` | today |
|---|---|
| `"-100"` | `cscf_pending`, **−4.4 certificates, −€331.58** |
| `"abc"`, `""` | raw `[DecimalError] Invalid argument: abc` reaches the user as the refusal text |
| `"0x10"` | prices **16 t** → €914.75 |
| `"0b101"` / `"0o17"` / `"1_000"` | 5 t / 15 t / 1000 t (€57,171.86) |
| `"Infinity"`, `"NaN"` | `cscf_pending` with **`certificates=NaN`, `EUR=NaN`** rendered |
| `"  100  "` | throws |

The negative case is the same structural hole already fixed once for verified emissions: the floor
clamp covers the DIRECT side (`max(0, E − FAA)`) and then ADDS indirect, so −100 t yields −4.4
certificates rather than −75.865. Fixing the verified inputs did not fix mass.

### The threshold path is worse than the estimate path

`resolveThreshold` consumes the same raw string and makes an Art 2(3) de-minimis determination
from it:

```
massT="100"    state=above_threshold
massT="0x64"   state=above_threshold     <- identical, off a hex string
massT="1_000"  state=above_threshold
massT=""       THREW
```

`0x64` is not degrading safely — it parses as 100 and answers exactly as if the user typed 100. An
earlier `indeterminate` on `0x10` was only because 16 < 50, not because anything detected garbage.
"You are above the de-minimis threshold" is a statement about whether CBAM applies **at all**, so
this is a stronger claim than the price, made on weaker input.

By deliberate design the threshold statement survives a refused estimate — `cbam-app.ts` renders it
above the exposure because "you may owe nothing at all" outranks "here is what you would owe". That
is right, and it means the threshold needs its own gate rather than inheriting the estimate's.

## Why the existing guards do not cover it

There **is** a guard, at `cbam-app.ts:1317`, and its comment names the −500 t case precisely. It is
not missing; it is speaking a different language from the thing it guards.

The gate validates with `Number()`. The consumer parses with `Decimal()`. They disagree:

| input | `Number()` (the gate) | `Decimal()` (the consumer) | result |
|---|---|---|---|
| `""` | `0` → **passes** | throws | blank clears the gate, dies at the consumer |
| `"0x10"` | `16` → **passes** | `16` | **both read hex**, so a confident bill for 16 t |
| `"  100  "` | `100` → **passes** | throws | passes the gate, dies at the consumer |
| `"1_000"` | `NaN` → refused | *would be* `1000` | gate and consumer disagree in the other direction |

Two further facts decide the design:

- **The other consumer has no guard at all.** The SaaS Vue store (`CBM/src/stores/estimator.ts`)
  calls the same engine; `massT` appears there only in a threshold helper signature.
- **The engine is the only layer both products share.** Its own `verifiedPerT` docblock already
  states the principle for the verified fields: *"There is no guard upstream and none downstream,
  so this is the only one."* Mass has partial upstream guards that contradict each other, which is
  arguably worse than none — it looks defended.

## Design

### 1. One predicate, in the engine

Generalise the existing `verifiedPerT` into an exported `nonNegativeDecimal(value: string): Decimal | null`.
It already encodes every rule needed, each learned from a real defect:

```
1. shape gate FIRST   /^-?\d*\.?\d+(e[+-]?\d+)?$/i
2. new Decimal(...)   in try/catch
3. isFinite()         rejects NaN and ±Infinity
4. lt(0)              rejects negatives; '0' and '-0' pass
```

**The order is load-bearing.** Decimal honours JS radix prefixes and numeric separators — `0x10`
→ 16, `0b101` → 5, `0o17` → 15, `1_000` → 1000 — so a gate placed *after* parsing has already
lost. This is why the existing shape gate runs first, and the same reasoning transfers to mass
unchanged.

This is a **rename, not a wrapper**: `verifiedPerT` becomes `nonNegativeDecimal` and its call sites
move with it. A wrapper that adds nothing would be noise, and two names for one predicate is how
they drift apart later. Its docblock is rewritten to be field-agnostic while keeping every specific
it already records — the `0x10` bill, the `-394.58` certificate case, why the shape gate precedes
`Decimal`. The return contract stays `Decimal | null`; nothing about it widens.

### 2. Mass takes the identical rule

Finite, non-negative, no radix prefixes or separators. **Zero stays legal**: 0 t → €0.00 is
arithmetically true rather than fabricated, and refusing it would be a behaviour change with no
correctness gain. This makes mass and verified the same predicate, not two similar ones.

There is no maximum. `1e9` t prices €57 billion, which is what 1e9 t costs; refusing large-but-valid
numbers would be inventing policy the regulation does not contain.

### 3. Three application sites

| site | change |
|---|---|
| `estimateFromPack` | gate `massT` **once, before the verified/defaults branch** → `unavailableEstimate(stamp, tables, BAD_MASS_REASON, 'mass')` |
| `resolveThreshold` | gate `massT` → **return `null`** rather than throwing or answering off a mis-parse |
| `cbam-app.ts:1317` | replace `Number(mass.value)` with `nonNegativeDecimal(mass.value)` |

Two details an implementer would otherwise have to guess:

- **The estimate gate runs once, above the branch.** Mass is used by both the verified and the
  defaults path, so gating inside either would leave the other open — and the stamp is already
  built once for both, so there is a natural place for it.
- **`resolveThreshold` returns `null`, not `state: 'indeterminate'`.** An `indeterminate` view still
  renders a card carrying the sector, the threshold value and a source locator — a partial legal
  claim assembled around a mass nobody can read. `null` renders nothing, which is the fail-closed
  answer. It does overload `null`, which already means "no threshold rule for this year", but the
  two are indistinguishable *in effect*: the caller does `t ? renderThreshold(t) : ''`, and the
  estimate's own refusal is what tells the user the mass is the problem.

The SaaS store inherits the engine's refusal with no change of its own.

The `cbam-app.ts` change is what makes the drift structurally impossible rather than merely fixed:
gate and consumer become the same function. `cbam-app.ts` is the documented hand-editable exception
to the vendoring rule, so this is legitimate; every other file under `src/scripts/cbam-algos/`
arrives only by `cp` from upstream.

### 4. What the user sees

A refusal naming the field, never a raw `[DecimalError]`. In the house style, describing the class
rather than echoing the value:

```ts
const BAD_MASS_REASON =
  'Net mass must be a readable number of tonnes and cannot be negative, so no estimate is ' +
  'shown. Reading a missing, unreadable, infinite or negative mass as anything at all would ' +
  'scale a real tariff by a quantity nobody entered, and would decide the de minimis ' +
  'threshold the same way.'
```

Requirements on this string:

- **Distinct** from `BAD_VERIFIED_REASON`, `NO_DEFAULT_REASON` and `NO_INDIRECT_ROUTE_REASON`.
  Swapping a reason constant survived mutation testing twice this week, so the text is pinned by a
  hand-typed test constant, not imported from production.
- **Does not echo the rejected value** into the reason or the selector. The reason describes the
  rule; the selector is `mass`, carrying no user input. This matches `BAD_VERIFIED_REASON`, which
  names the class and never quotes the input.

`cbam-app.ts` keeps its friendly inline prompt for the field (an idle-prompt shape, not a refusal
card) — it simply decides with the engine's predicate instead of its own.

### 5. Behaviour changes to measure, not assume

Under the strict shape gate, two inputs move from **priced** to **refused**:

- `"+100"` — a leading `+` is refused
- `"5."` — a trailing bare point is refused

Both are unreachable from the site's `<input type="number">`, because HTML value sanitisation
returns `""` for a string that is not a valid floating-point number, and neither `+100` nor `5.`
qualifies. A programmatic caller or the Vue app could still send them.

This is accepted deliberately: under a fail-closed stance an odd shape is a question, not a value —
the same reasoning `verifiedPerT` already applies to the verified fields.

A blast-radius sweep must confirm, against the shipped pack and whole serialised result objects:

1. No probe changes from `priced` to `priced` with a **different figure** — the guard must refuse or
   do nothing, never silently re-price.
2. Every probe that changes does so `priced → refused`, and only for inputs the gate names.
3. Ordinary masses (integers, decimals, exponent form) are untouched.
4. The threshold sweep separately: no `above_threshold` / `below_threshold` verdict survives on an
   input the gate refuses.

## Testing

Each rule is pinned by a test that is verified to fail when that rule is removed:

| mutation | must be caught by |
|---|---|
| drop the shape gate | `0x10` prices 16 t |
| drop `isFinite()` | `NaN`/`Infinity` render as figures |
| drop `lt(0)` | `-100` yields a negative bill |
| swap `BAD_MASS_REASON` for another reason constant | the pinned-text test |
| revert `resolveThreshold`'s gate | `0x64` reads as 100 t → `above_threshold` |
| revert `cbam-app.ts` to `Number()` | `""` clears the gate |

The last one cannot be caught by the unit suite — `cbam-app.ts` logic lives in a closure inside
`initCbam()` using `document.getElementById`, and the suite is `node:test` + `tsx` with no DOM
library. It needs a Playwright e2e assertion, following the precedent set for `#cbScopeRow`.

## Out of scope

- **The half-verified / mixed tier.** A verified DIRECT figure with no indirect one currently prices
  the indirect half at zero (`estimate-from-pack.ts:420-421` defaults `indirectTco2e = '0'` and only
  validates when the key is present, so an omitted key is *laxer* than an empty string, which
  already refuses). The decision taken is to fall back to the Commission default and mark the line
  as a mixed tier — which touches the stamp, the attestation, the CSV `data_tier` column and the
  print export, and so gets its own spec.
- The 2027/2028 certificate-price wall, and its refusal naming the wrong table.
- The banner's "Commission default values only" claim.
- Any change to the de-minimis rule itself; this spec only stops it being decided on unreadable input.
