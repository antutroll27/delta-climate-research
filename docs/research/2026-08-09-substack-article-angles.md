# Substack runway — building a climate digital twin under constraints

**Date:** 2026-08-09
**Purpose:** a backlog of post angles for the series on how we built the `/heat-map` climate engine + twin
*despite* the constraints (no drone capture over Indian cities, no photoreal tiles, free/open data, no
first-world sensors/budget). Each angle names where the real material already lives, so drafting is fast.
Research backbone: [`2026-08-09-city-twin-credibility-research.md`](./2026-08-09-city-twin-credibility-research.md).

> Voice: honest, specific, receipts-first — the same posture as the product. Show the measurements and the
> dead ends, not just the wins. That candour *is* the brand.

---

## Tier 1 — the strongest, most differentiated stories

1. **"We can't fly drones over Indian cities — so we built a more honest twin instead."**
   The regulatory constraint that looked fatal, and why procedural-from-open-data beat photoreal. Peer
   critique says fidelity ≠ credibility; we leaned into that.
   *Material:* [`../heat-map-feature.md`](../heat-map-feature.md) (why-not-Google-photoreal), [`kolkata-3d-realism` memory], research §3.1.

2. **"How we validated an urban-heat model with 50 free Landsat overpasses and zero field equipment."**
   Leave-one-overpass-out (why scene/ward splits leak weather), bootstrap CIs, the daytime correction we
   *rejected* because it was worth 0.003 K. The rigor most demos skip.
   *Material:* `src/scripts/climate-engine/accuracy.ts`, heat-map-feature.md validation sections, research §1.2.

3. **"Honesty as a feature: what a trust study taught us about showing error bars."**
   Loud uncertainty *lowers* trust in the data but not in the maker; quiet-but-available uncertainty is
   free. How that reshaped the receipts UX.
   *Material:* research §0 ([arxiv 2602.00248](https://arxiv.org/abs/2602.00248)), the provenance/receipts design in heat-map-feature.md.

4. **"The receipts: making a climate model you can interrogate."**
   Click any number → source, date, method, validated accuracy. Copying GEE's Data Catalog + EO Browser +
   ECOSTRESS's own QC flags. Provenance as a first-class object.
   *Material:* research §2, the "legible rigor" spec (when written).

## Tier 2 — engineering stories that build credibility with builders

5. **"We built our prettiest feature, then shelved it."**
   The grounding/depth/material-richness look pass — A/B'd, the "fog toward black = gloom, fog toward light
   = depth" lesson — then parked for the flood sim because it wasn't the belief gap. Killing darlings.
   *Material:* [`../../attic/heat-fx/README.md`](../../attic/heat-fx/README.md), [`heat-fx-pass-parked` memory].

6. **"A GPU heat sim that also runs on a 2015 phone."**
   The swappable `HeatSim` ABI, tier detection, and the demotion ladder (GPU → worker → static). Why GPU
   compute is the *accelerator*, never the floor.
   *Material:* `caps.ts`, `sim-host.ts`, `types.ts`, `sim-gpu-webgl2.ts`.

7. **"'Digital twin' is a claim we don't make."**
   The term implies live bidirectional coupling; ours is an open-data urban-heat *observatory/model*.
   Precision as trust.
   *Material:* research §3.4 (Frontiers critique), heat-map-feature.md honesty framing.

8. **"The ward was drawn mirrored — and it took four attempts to see."**
   The northward/southward sign-convention trap, settled by a numerical fit not eyeballing. A proper
   debugging war story.
   *Material:* heat-map-feature.md "drawn MIRRORED" section, [`georef-mirror-finding` memory].

## Tier 3 — mission / market

9. **"Measured vs modelled: which pixels are actually real?"**
   Our biggest honesty exposure and how we draw the line — inputs measured, surface modelled + validated.
   *Material:* research §1.4, the Phase-2 provenance work.

10. **"Climate tech for the Global South, uncontested."**
    Why we build for Kolkata (and next cities) with free data instead of chasing Western competitors —
    and how the stack ports city-to-city on open standards.
    *Material:* [`global-south-uncontested-market` memory], research §1.7 (portability), heat-map-feature.md scaling notes.

---

## Cross-cutting hooks to reuse
- The WETEX Dubai 2026 invitation as a framing device (validation by an international stage).
- "Receipts, not renders" as a recurring tagline.
- Every post ends with a real number or a real dead end — never a vibe.
