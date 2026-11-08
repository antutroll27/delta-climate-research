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
 * THE FIGURES TRAVEL ON THE CLAIM. `heatAccuracyClaim(tier)` returns them ONLY on its
 * `band` variant (`claim.figures`), so a renderer that has not branched on `kind`
 * cannot read one: TypeScript refuses it. Every other route to a figure (a raw
 * import of accuracy.ts or method-copy.ts, an alias, a namespace, a re-export, a
 * raw `bandK` read, a hand-typed "Calibrated · ±3.0 °C") is banned across src by
 * accuracy-tier-gate.test.mjs. An earlier guard exempted a whole file once it
 * called the gate anywhere, and a second, ungated render in the same file passed.
 * FAIL CLOSED: an unknown tier is `none`.
 */
import {
  ACCURACY, SPATIAL, HEIGHTS, PEAK_CHIP_BASIS, PEAK_EVIDENCE_BASIS, HEIGHTS_EVIDENCE_BASIS,
  TRANSITION_RMSE_K, bandLabel, seasonalCaveat, seasonalCaveatLine, seasonalCaveatDetail,
} from '../accuracy.ts';
import { checkedRows, caveatRows, type Row } from '../v2/method-copy.ts';
import type { CityTier } from './resolve.ts';
import type { CityKey } from './registry.ts';

/** The single replacement line, shown wherever a band would have been. */
export const NOT_VALIDATED_LINE = 'Heat accuracy not yet validated for this city';

/**
 * What a satellite check HAS found in a city whose accuracy is still not validated,
 * keyed on the registry's city key and never on a string match. Only a measured
 * finding belongs here. Amsterdam: ECOSTRESS and Landsat, summers 2019-2026, the
 * model reads cooler than the measured surface by day (science audit
 * 2026-11-07, /Volumes/OBOSLab/research/amsterdam-validation/AUDIT.md section 3).
 * The statement above it does not change.
 */
const CITY_CAVEATS: Readonly<Partial<Record<CityKey, string>>> = Object.freeze({
  amsterdam: 'Satellite checks (ECOSTRESS and Landsat, summers 2019–2026) show this model reads '
    + 'cooler than the measured surface by day, by about 5–7 °C from late morning to afternoon, '
    + 'more on clear days.',
});

export type Phase = 'peak' | 'night';
export type Confidence = 'quantitative' | 'indicative';

export interface ChipView {
  /** innerHTML: figures are wrapped in <b>, every value a number put through toFixed */
  readonly html: string;
  readonly confidence: Confidence;
}

export interface SeasonView {
  /** the readout's one-line note */
  readonly line: string;
  /** the longer form, for the tooltip */
  readonly detail: string;
  /** the suffix the chip carries, e.g. " · dry-season warm" */
  readonly chip: string;
  /** the prefix the chip's tooltip carries */
  readonly tip: string;
}

/** The measured-confidence block of a ward record (/api/wards/{id}/metadata.json). */
export interface MeasuredConfidence {
  readonly night: { readonly tier: Confidence; readonly bandK: number; readonly n: number; readonly modelRmseK: number; readonly ceilingRmseK: number };
  /** `basis` says which evidence set the peak figures are: NOT the current one. */
  readonly peak: { readonly tier: Confidence; readonly bandK: number; readonly n: number; readonly modelRmseK: number; readonly ceilingRmseK: number; readonly basis: string };
  readonly spatial: { readonly n: number; readonly rModel: number; readonly rVegOnly: number; readonly note: string };
  /** `basis`: where the ICESat-2 sweep was run — the earlier 1.4 km box, not Ward 68. */
  readonly heights: { readonly verdict: string; readonly nBuildings: number; readonly minBuildings: number; readonly basis: string };
}

/** What a ward record carries where there is no measurement: the line, and where the bands WERE measured. */
export interface UnmeasuredConfidence {
  readonly line: string;
  readonly detail: string;
}

export type WardConfidence = MeasuredConfidence | UnmeasuredConfidence;

export function hasHeatBand(c: WardConfidence): c is MeasuredConfidence {
  return 'night' in c;
}

/** The three facts an NGSI-LD entity states about the night band, or null where there is none. */
export function surfaceBandFacts(c: WardConfidence): { readonly band: number; readonly tier: Confidence; readonly sampleSize: number } | null {
  return hasHeatBand(c) ? { band: c.night.bandK, tier: c.night.tier, sampleSize: c.night.n } : null;
}

/**
 * Every Kolkata-measured figure, as the readout, the methods ledger and the ward
 * record print them. Exists ONLY on the `band` claim.
 */
export interface HeatAccuracyFigures {
  /** the "± 3.0" beside the surface temperature */
  band(phase: Phase): string;
  /** the confidence chip's text and class, in the normal or the sunrise-transition window */
  chip(phase: Phase, transition: boolean, seasonChip: string): ChipView;
  /** the chip's (and the readout's) tooltip */
  tooltip(phase: Phase, transition: boolean, seasonTip: string): string;
  /** the seasonal caveat for this area and month, or null */
  season(area: string, month: number, phase: Phase, transition: boolean): SeasonView | null;
  /** the legend's pattern note */
  readonly pattern: { readonly text: string; readonly title: string };
  /** "How this was checked" rows */
  howChecked(): readonly Row[];
  /** "Caveats OBOS adds when they apply" rows; `area` is the bare area id */
  limits(area?: string): readonly Row[];
  /** the methods "How sure" ledger, one string per row (the markup keeps its own punctuation) */
  readonly ledger: {
    readonly night: string;
    readonly peak: string;
    readonly patternR: string;
    readonly patternVegR: string;
    readonly patternN: number;
    readonly patternNote: string;
    readonly heights: string;
  };
  /** the ward record's confidence block */
  record(): MeasuredConfidence;
}

export type HeatAccuracyClaim =
  | { readonly kind: 'band'; readonly footLine: string; readonly figures: HeatAccuracyFigures }
  | { readonly kind: 'none'; readonly footLine: string; readonly line: string; readonly detail: string;
      /** a measured finding for this city, shown beside `line`; null where there is none */
      readonly caveat: string | null };

const fig = (t: string): string => `<b>${t}</b>`;

const FIGURES: HeatAccuracyFigures = Object.freeze({
  band: (phase: Phase): string => bandLabel(phase),

  chip(phase: Phase, transition: boolean, seasonChip: string): ChipView {
    const a = ACCURACY[phase];
    if (transition) {
      return { html: `Outside validation · ${fig(`~±${TRANSITION_RMSE_K.toFixed(1)} °C`)} at this hour${seasonChip}`, confidence: 'indicative' };
    }
    return a.confidence === 'quantitative'
      /* The night band is a CITY-WIDE level, not ward detail (accuracy.ts NIGHT_AS_SHIPPED), and the chip says so. */
      ? { html: `Night level calibrated · ward detail unvalidated · ${fig(`±${a.bandK.toFixed(1)} °C`)} · ${fig(`n=${a.n}`)}${seasonChip}`, confidence: a.confidence }
      /* THE PEAK BAND IS THE EARLIER EVIDENCE SET (accuracy.ts PEAK_EVIDENCE_BASIS):
         measured before Ballygunge became KMC Ward 68, kept because it is the wider,
         safer band, and said so ON the chip — a tooltip nobody hovers was the only
         place it was said (pre-ship audit 2026-10-03). */
      : { html: `Indicative only · ${fig(`±${a.bandK.toFixed(1)} °C`)} · ${fig(`n=${a.n}`)}${phase === 'peak' ? ` · ${PEAK_CHIP_BASIS}` : ''}${seasonChip}`, confidence: a.confidence };
  },

  tooltip(phase: Phase, transition: boolean, seasonTip: string): string {
    if (transition) {
      return seasonTip
        + 'Sunrise to mid-morning is the one window neither published figure '
        + `covers. Scored out-of-sample it reaches ${TRANSITION_RMSE_K.toFixed(2)} K — the surface is `
        + 'still releasing stored heat while the sun is already loading it, and a '
        + 'steady-state model cannot represent a system that far from equilibrium.'
        + `\n\n${SPATIAL.note}`;
    }
    // Both figures on one tooltip. The phase note covers ward-LEVEL error; the
    // spatial note covers whether the pattern inside the ward means anything.
    // A reader who sees only the first will read the hot blocks as measured —
    // they are not (SPATIAL.rModel 0.22, below a plain vegetation map's 0.24,
    // and coarsening the comparison does not close that gap at any scale).
    return `${seasonTip}${ACCURACY[phase].note}\n\n${SPATIAL.note}`;
  },

  season(area: string, month: number, phase: Phase, transition: boolean): SeasonView | null {
    const c = seasonalCaveat(area, month, phase, transition);
    if (!c) return null;
    const detail = seasonalCaveatDetail(c);
    return { line: seasonalCaveatLine(c), detail, chip: ` · ${c.reader.toLowerCase()} warm`, tip: `${detail}\n\n` };
  },

  pattern: Object.freeze({ text: `Block pattern illustrative · r ${SPATIAL.rModel.toFixed(2)}`, title: SPATIAL.note }),

  howChecked: (): readonly Row[] => checkedRows(),
  limits: (area?: string): readonly Row[] => caveatRows(area),

  ledger: Object.freeze({
    night: `night level calibrated, ward detail unvalidated · ±${ACCURACY.night.bandK.toFixed(1)} °C · n = ${ACCURACY.night.n} · calibration-run error ${ACCURACY.night.modelRmseK} K · ceiling ${ACCURACY.night.ceilingRmseK} K`,
    peak: `indicative · ±${ACCURACY.peak.bandK.toFixed(1)} °C · n = ${ACCURACY.peak.n}. ${PEAK_EVIDENCE_BASIS}`,
    patternR: SPATIAL.rModel.toFixed(2),
    patternVegR: SPATIAL.rVegOnly.toFixed(2),
    patternN: SPATIAL.n,
    patternNote: SPATIAL.note,
    heights: `${HEIGHTS.nBuildings} of ${HEIGHTS.minBuildings} buildings needed · ${HEIGHTS.verdict}. ${HEIGHTS_EVIDENCE_BASIS}`,
  }),

  record: (): MeasuredConfidence => ({
    night: { tier: ACCURACY.night.confidence, bandK: ACCURACY.night.bandK, n: ACCURACY.night.n, modelRmseK: ACCURACY.night.modelRmseK, ceilingRmseK: ACCURACY.night.ceilingRmseK },
    peak: { tier: ACCURACY.peak.confidence, bandK: ACCURACY.peak.bandK, n: ACCURACY.peak.n, modelRmseK: ACCURACY.peak.modelRmseK, ceilingRmseK: ACCURACY.peak.ceilingRmseK, basis: PEAK_EVIDENCE_BASIS },
    spatial: { n: SPATIAL.n, rModel: SPATIAL.rModel, rVegOnly: SPATIAL.rVegOnly, note: SPATIAL.note },
    heights: { verdict: HEIGHTS.verdict, nBuildings: HEIGHTS.nBuildings, minBuildings: HEIGHTS.minBuildings, basis: HEIGHTS_EVIDENCE_BASIS },
  }),
});

const NONE_DETAIL = `${NOT_VALIDATED_LINE}. OBOS publishes accuracy bands only where the model has been scored `
  + 'against satellite surface temperature, and that was done over three Kolkata wards. '
  + 'The map here is buildings, terrain and a physical model with no local measurement behind it.';
const NONE: HeatAccuracyClaim = Object.freeze({
  kind: 'none',
  footLine: 'Modelled surface temperature, not air temperature.',
  line: NOT_VALIDATED_LINE,
  detail: NONE_DETAIL,
  caveat: null,
});
/** A city that has a satellite finding to state beside the same unvalidated line. */
function noneWithCaveat(caveat: string): HeatAccuracyClaim {
  return Object.freeze({ ...NONE, detail: `${NONE_DETAIL} ${caveat}`, caveat }) as HeatAccuracyClaim;
}
const NONE_BY_CITY: Readonly<Partial<Record<CityKey, HeatAccuracyClaim>>> = Object.freeze(
  Object.fromEntries(Object.entries(CITY_CAVEATS).map(([k, c]) => [k, noneWithCaveat(c)])),
);
const BAND: HeatAccuracyClaim = Object.freeze({
  kind: 'band',
  footLine: 'Satellite-checked surface temperature, not air temperature.',
  figures: FIGURES,
});

/**
 * `cityId` is optional and only ever ADDS a measured caveat to a `none` claim: it can
 * never turn one into a `band`. It is the registry's city key (`scope.city.id`).
 */
export function heatAccuracyClaim(tier: CityTier | undefined | null, cityId?: CityKey | null): HeatAccuracyClaim {
  if (tier === 'validated') return BAND;
  return (cityId != null ? NONE_BY_CITY[cityId] : undefined) ?? NONE;
}

/**
 * Cities whose building heights the ICESat-2 sweep actually checked. HEIGHTS.note is a
 * statement about laser transects flown over KOLKATA; printed on a Bengaluru building
 * it said a city had been checked that never was. A city joins this list by being
 * swept, not by being validated for heat, so it is a list of its own.
 */
const HEIGHTS_CHECKED_CITIES: readonly string[] = ['kolkata'];

/**
 * The building-height tooltip for a city, or null where nothing has been measured.
 * No other city carries its own height-source line in its data yet; when one does, it
 * belongs here, per city, and not behind the Kolkata sentence.
 */
export function heightsNote(cityId: string | undefined | null): string | null {
  return cityId != null && HEIGHTS_CHECKED_CITIES.includes(cityId) ? HEIGHTS.note : null;
}
