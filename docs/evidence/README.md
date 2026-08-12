# Evidence library

The tracked record of everything the Delta Climate / heat-map engine is built on: every dataset,
paper, scientist, precedent, and funding source we have used, evaluated, or ruled out. It exists so
that when we explain the engine to a climate scientist, an angel, a VC, or a Substack reader, the
receipts are one file away — not scattered across specs, briefings, and memory.

## Why this exists

The engine's whole thesis is **"receipts, not renders"** — credibility is the moat, not the imagery.
This folder is the paper trail behind that claim. It captures both what we *use* and, deliberately,
what we *rejected and why* — the ruled-out list is often the more persuasive artifact, because it
shows the diligence.

## Files

| File | What's in it |
|---|---|
| [data-sources.md](data-sources.md) | Every dataset — **in production**, in validation, or **ruled out with the reason**. Licence, resolution, role, status per entry. |
| [methods-and-papers.md](methods-and-papers.md) | Academic + methodological citations: thermal physics, UHI benchmarks, ICESat-2 height validation, vegetation/NDVI, cooling evidence, composite-index method, splatting/neural-surrogate survey. |
| [scientists-and-institutions.md](scientists-and-institutions.md) | Named researchers and teams, their contribution, and the engine component that relies on it. |
| [digital-twin-references.md](digital-twin-references.md) | City-twin precedents and provenance/standards frameworks — what to steal from each, and the anti-patterns to avoid. |
| [funding-landscape.md](funding-landscape.md) | Grants, credits, accelerators, climate/adaptation VC, dev-finance, commercial wedges — plus the verified dead-ends and the raise strategy. |
| [regulatory-and-licensing.md](regulatory-and-licensing.md) | Why we use the data we use — India's 1 m/3 m geospatial threshold, the licence traps that caught us, and the licences we rely on. Most "why don't you just buy sharper data" questions have a legal answer, not a budget one. |
| [known-limitations.md](known-limitations.md) | What is wrong with, or unproven about, this engine — written down by us before someone else finds it. Each entry states how we know, what it does and does not invalidate, and what would close it. |

## Rules for this library

- **No fabricated citations.** Everything here is traceable to a repo doc, a memory file, or a
  primary source we verified. Items we could not fully confirm are marked **(verify)**.
- **Corrections stay on the record.** Where we miscited something and fixed it (e.g. the park-cooling
  "Mitra et al." → Li et al. correction, the NICFI "no India coverage" retraction, the Czekajlo
  over-attribution), the correction is written down, not quietly erased.
- **Ruled-out is first-class.** A rejected dataset with its reason is as valuable as an adopted one.
- **Limitations are published, not buried.** `known-limitations.md` exists so a reviewer finds our problems
  described in our words, with measurements, rather than discovering them unaided. An engine that lists what
  it cannot yet prove is more trustworthy than one that lists only wins.

## Provenance of this compilation

Assembled 2026-08-11 from four parallel harvests over the repo's research docs
(`docs/research/`), briefings (`docs/briefings/`), specs (`docs/superpowers/specs/`), calibration
and methodology docs, and the project memory. Cheque sizes, licences, and eligibility were taken
as-found on primary/official pages; **application windows and licences rotate — reconfirm before
relying on any one line.**
