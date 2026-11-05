/**
 * Whether a city may print a heat-accuracy figure. THE ONE GATE.
 *
 * Every ± in accuracy.ts was measured against NASA ECOSTRESS over three KOLKATA
 * wards. A band is therefore a claim about a city, and the city's registry tier
 * (`validated` | `zone` | `geometry`, scope/registry.ts) is where that claim is
 * made. Only `validated` may show one.
 *
 * WHY THIS EXISTS. The readout gated the band on weather alone
 * (`M.outsideValidation`: rain, station cloud), so a dry Bengaluru morning — a
 * `geometry` city, "buildings and terrain only; the physics has not been
 * evidenced here" — printed Kolkata's "Calibrated · ±3.0 °C · n=50", the same
 * number under the same word. Weather says whether a SCENE is inside the
 * validation; the tier says whether the CITY is. They are different questions and
 * the second was never asked.
 *
 * Every renderer asks `heatAccuracyClaim(tier)` and branches on `kind`; a unit
 * test (accuracy-tier-gate.test.mjs) fails any src file that prints an accuracy
 * figure without it. FAIL CLOSED: an unknown tier is `none`.
 */
import type { CityTier } from './resolve.ts';

/** The single replacement line, shown wherever a band would have been. */
export const NOT_VALIDATED_LINE = 'Heat accuracy not yet validated for this city';

export type HeatAccuracyClaim =
  | { readonly kind: 'band' }
  | { readonly kind: 'none'; readonly line: string; readonly detail: string };

const NONE: HeatAccuracyClaim = Object.freeze({
  kind: 'none',
  line: NOT_VALIDATED_LINE,
  detail: `${NOT_VALIDATED_LINE}. OBOS publishes accuracy bands only where the model has been scored `
    + 'against satellite surface temperature, and that was done over three Kolkata wards. '
    + 'The map here is buildings, terrain and a physical model with no local measurement behind it.',
});
const BAND: HeatAccuracyClaim = Object.freeze({ kind: 'band' });

export function heatAccuracyClaim(tier: CityTier): HeatAccuracyClaim {
  return tier === 'validated' ? BAND : NONE;
}
