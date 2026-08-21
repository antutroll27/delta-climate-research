# PRE-REGISTRATION — does inter-building shading matter for Kolkata rooftop PV?

**Written 2026-08-21, BEFORE the test was run or the data looked at.**
Committed before `scripts/measure-pv-shading.py` produced any output.

## Why this gate exists

Rooftop PV without shading is `area x irradiance x efficiency` — a spreadsheet any
consultant can produce. **Shading-awareness is the only thing that would make our version
ours**, and IEA-PVPS T13 reports that most real projects assume 0% shading loss, so it is a
genuine gap in practice rather than a solved problem.

If shading turns out negligible in these low-rise wards, Path A is a commodity calculation
built on unvalidated heights at ~6% forcing accuracy, and we should stop rather than ship a
me-too number. This test decides that, and it is cheap: shapely plus a sun loop, no PV chain,
no packing factor, no module model.

The evidence genuinely points both ways, which is why it is worth measuring:
- **Against:** ward SVF is 0.82–0.92 (sd 0.04–0.07) — open sky, the canyon mechanism is
  near-absent here, and that is exactly why SVF died as a thermal predictor.
- **For:** 23% of Ballygunge footprints stand 3 m or more above the median roof, and a median
  7 m building throws 12.1 m of shadow at a 30° sun — which in these lane widths lands on a
  neighbour.

## Hypothesis

> Inter-building shading materially reduces annual plane-of-array insolation on Kolkata
> rooftops, and does so **unevenly enough between buildings** that a per-building estimate
> carries information a ward-average cannot.

## The statistic, fixed now

For each building, annual **shading loss** = 1 − (shaded POA insolation ÷ unshaded POA
insolation), where POA is accumulated over sampled sun positions weighted by the measured
NASA POWER GHI for that hour (`data/calibration/solar-forcing.json`, LST-labelled).

## Decision rule — BOTH clauses, declared before seeing any number

**PASS (build Path A) if EITHER:**
- **(a) mean annual shading loss ≥ 3.0%** across all buildings in the ward, **OR**
- **(b) ≥ 10% of buildings lose ≥ 5.0%** each.

**FAIL (stop Path A) if neither holds.**

**Why these numbers.** 3.0% is set at the scale of the uncertainty we already carry — POWER's
own published GHI bias is −5.8% and our interannual spread is 7.5%, so a mean effect below
~3% is indistinguishable from forcing noise and cannot justify the build. Clause (b) is the
one that matters more for the *product*: the value of a per-building map is
**discrimination**, not the average. If a real minority of roofs are badly shaded, telling an
owner *which* roof is useful even when the ward mean is unremarkable. IEA-PVPS reports
0.6–3.6% where shading is modelled at all, so 3% sits at the top of observed practice rather
than being a soft target.

## Sanity checks that must pass, or the result is void

1. **Shadows point away from the sun**, never toward it (already validated for the geometry:
   a 30 m tower at 30° threw 10 cells against 10.4 predicted).
2. **An isolated building** — no neighbour within its maximum shadow length — must show
   ~0% loss.
3. **Loss must rise as sun elevation falls.** If it does not, the geometry is wrong.
4. **A caster no taller than the target roof contributes nothing.** Shadow length on a roof at
   height `h_t` from a caster at `h_c` is `(h_c − h_t)/tan(alt)`, zero when `h_c ≤ h_t`.

## Known bias, and its direction

Building heights are **unvalidated with a suspected LOW bias** (ICESat-2 returned
`underpowered`, n=28 against a pre-registered bar of 30; the terrain DSM sits ~6 m above real
ground). Low heights mean **shadows are too short**, so this test **understates** shading.

**That is the safe direction for this gate:** a PASS on understated shading is still a PASS.
A FAIL is the ambiguous outcome, and must be reported as "not detected with heights that are
probably too low" rather than "shading does not matter".

## What will NOT be done

No swapping the statistic after seeing results. No dropping clause (a) to lean on (b), or the
reverse. No re-running on a different ward to find a pass — Ballygunge is chosen **in advance**
as the densest and tallest of the three, i.e. the ward most likely to show an effect. If the
most favourable ward fails, the others are not a rescue.

---

## Addendum, 2026-08-21 — post-hoc: the gate passes, but not on the roofs the scheme addresses

**The pre-registered result stands as pre-registered.** Applied to all footprints, as
written before the data was seen, all three wards pass. Nothing below changes that, and
the rule is not being rewritten after the fact.

What follows is explicitly **post-hoc** and is recorded because it is decision-relevant
and because it weakens our claim rather than strengthening it.

The pre-registration counted every footprint. Many footprints are not roofs anyone will
put a PV system on: Ballygunge's worst-shaded building, at 66.6% loss, is **16 m² and
2.5 m tall** — a shed supporting 0.43 kWp. Small, low buildings are systematically the
most overshadowed, because being short and surrounded is the same condition. Counting
them inflates every statistic we would quote.

Restricting to roofs supporting **≥ 3 kWp**, roughly the smallest system PM Surya Ghar is
promoted for:

| ward | all roofs (pre-registered) | ≥3 kWp roofs (post-hoc) |
|---|---|---|
| ballygunge | mean 5.12% / 28.5% ≥5% — **PASS** | mean 3.32% / 20.3% ≥5% — **PASS** |
| barrackpore | mean 1.66% / 10.4% ≥5% — **PASS** | mean 1.22% / 6.8% ≥5% — **FAIL** |
| baruipur | mean 1.79% / 11.7% ≥5% — **PASS** | mean 1.12% / 7.1% ≥5% — **FAIL** |

**Two of three wards would not have passed their own gate on the population that can
actually host a system.** Barrackpore and Baruipur cleared the pre-registered rule on the
second clause only (10.4% and 11.7%, against a 10% threshold), and that margin was
carried by sheds.

### What this means for the product

The shading differentiator is **real in dense Ballygunge and marginal in the lower-density
wards** — which is the correct and expected physics, not a defect: shading is a function
of built density, and Barrackpore and Baruipur have median heights of 4.9 m and 4.5 m
against Ballygunge's 7.0 m. A screening product that flagged the same fraction everywhere
would be reporting noise.

But it does constrain the pitch. "A quarter of roofs are materially shaded" is a
**Ballygunge** claim, not a Kolkata one, and on installable roofs it is a fifth rather
than a quarter. Extending it to peri-urban wards would be unsupported by our own numbers.

### Not doing

Re-running the gate with ≥3 kWp as the pre-registered population. Choosing a subset after
seeing the outcome is the exact failure pre-registration exists to prevent, and the fact
that this particular subset happens to be conservative does not make the move sound. The
≥3 kWp figures are reported alongside the pre-registered ones, never instead of them.
