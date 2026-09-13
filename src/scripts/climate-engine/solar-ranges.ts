import type { PvFile } from './types';

export interface RoofRanges {
  readonly kwpLow: number;
  readonly kwpHigh: number;
  readonly kwhLow: number;
  readonly kwhHigh: number;
}

/** Products of PUBLISHED numbers only (spec 2026-09-07-solar-guide §3): the packing
    interval scales capacity, the yield bracket scales generation, and the shading band
    runs from the A1 headline (low) to the strict floor (high). Nothing is re-derived
    here, which is what lets the ward figures stay the laboratory's (A5). The artefact
    guard has already refused any file whose ranges are not two numbers each.

    `packing_factor` is not read: the low end of `tiers.packing_range` IS the factor the
    artefact used to produce `kwp`, so `kwpLow` is just `pv.kwp[i]` and the packing
    interval only ever scales it upward. */
export function pvRanges(pv: Pick<PvFile, 'kwp' | 'loss' | 'loss_strict' | 'tiers'>, i: number): RoofRanges {
  const [pLo, pHi] = pv.tiers.packing_range;
  const [yLo, yHi] = pv.tiers.yield_bracket_kwh_per_kwp;
  const kwpLow = pv.kwp[i];
  const kwpHigh = +(kwpLow * pHi / pLo).toFixed(2);
  return {
    kwpLow,
    kwpHigh,
    kwhLow: Math.round(kwpLow * yLo * (1 - pv.loss[i])),
    kwhHigh: Math.round(kwpHigh * yHi * (1 - pv.loss_strict[i])),
  };
}

/** ONE PLACE THAT READS `tiers.validated`'s null-ness. The card, the ward block and
    the CSV each name the tier from the same artefact field; three separate
    `=== null ? 'screened' : 'checked'` expressions is three places to drift the
    day a third tier is added. */
/** `checked`, not `validated`: a comparison with real rooftops is a check on the
    screen, not a stamp on the roof — and "validated" is the word a reader hears as
    bankable (audit 2026-09-07). The artefact field keeps its name. */
export function tierOf(pv: Pick<PvFile, 'tiers'>): 'screened' | 'checked' {
  return pv.tiers.validated === null ? 'screened' : 'checked';
}
