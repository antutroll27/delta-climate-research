/**
 * THE DUTCH AIR-QUALITY INDEX (LKI, Luchtkwaliteitsindex), as Luchtmeetnet publishes it.
 *
 * OBOS NEVER COMPUTES THIS. The API serves the LKI per station per hour, already worked
 * out from NO2, PM10, PM2.5 and O3 (`/open_api/lki`); the card prints that value. This
 * file only says which of Luchtmeetnet's five classes a published value falls in, so the
 * card can print the class word beside it. The standard follows the regulator: the words
 * and the class edges below are Luchtmeetnet's own, not a scale OBOS chose.
 *
 * SOURCES (read 2026-11-06; quoted in full in docs/evidence/2026-11-06-lki-and-soramame.md):
 *  1. luchtmeetnet.nl, page "Luchtkwaliteitsindex (LKI)" (CMS record luchtkwaliteit/luchtkwaliteitsindex-(lki),
 *     https://api.luchtmeetnet.nl/cms/pages): "Zowel de gemeten als berekende luchtkwaliteit wordt ingedeeld in
 *     vijf klassen van goed tot zeer slecht. Per stof wordt een concentratie omgezet tot een getal van 1
 *     (weinig luchtverontreiniging) tot 11 (veel luchtverontreiniging). De stof met het hoogste indexgetal
 *     bepaalt de totale luchtkwaliteitsindex." (Five classes, from good to very bad; a number 1 to 11.)
 *  2. luchtmeetnet.nl, page "Handelingsadvies": names the five classes GOED, MATIG, ONVOLDOENDE, SLECHT, ZEER SLECHT.
 *  3. THE EDGES come from the site's own code, because no prose page states them. In the site's script
 *     chunk e45e244f…js (sha256 9d748442c77790ea…), the function that colours a published LKI value reads:
 *       e===0 → no data;  0<e<4 → good;  4<=e<7 → moderate;  7<=e<9 → insufficient;  9<=e<11 → bad;  else → very bad
 *     and the legend table (chunk 590aabf6…) lists the five strings good, moderate, insufficient, bad, verybad,
 *     whose Dutch/English labels are Goed/Good, Matig/Moderate, Onvoldoende/Insufficient, Slecht/Bad,
 *     Zeer slecht/Very bad. So: 1-3 good, 4-6 moderate, 7-8 insufficient, 9-10 bad, 11 very bad.
 *  The RIVM report 2014-0050 (the origin of the index) proposed ten classes and four groups; the live site
 *  uses eleven numbers and five classes, and the live site is what the API's value belongs to.
 *
 * A published value that is not a whole number from 1 to 11 has no class here (null): the card then prints
 * no class word rather than guess. (The page: "Decimale LKI-waarden worden naar bovenafgerond"; the API
 * serves integers, so a fraction would be a format change worth noticing, not rounding.)
 *
 * THE ONE DECIMAL LKI is the MODELLED one (`/open_api/concentrations?formula=lki`, a float such as 3.5499999523), and for it the
 * rounding rule is Luchtmeetnet's, not OBOS's, found in two places (read 2026-11-09):
 *  a. the same page: "Decimale LKI-waarden worden naar bovenafgerond. Zo valt bijvoorbeeld een LKI van 0,9 in klasse 1 en een LKI van
 *     3,1 in klasse 4." (Decimal LKI values are rounded UP: 0.9 is number 1, 3.1 is number 4.)
 *  b. the site's own "Mijn locatie" script (chunk mijn-locatie-110b313d0e348113cdf2.js), which turns this very endpoint's row into the
 *     headline number with `Math.ceil(n.value)`, and shows no number for 0.
 * `lkiClass` is that rule: ceil, for a value above 0 and not above 11; anything else (0, a negative, 11.2, NaN) has no class.
 * A float32 artefact above an integer (4.0000002) therefore rounds up exactly as the site's does; it is not second-guessed.
 */
import type { LkiBand } from './local-types.ts';

export const LKI_MIN = 1;
export const LKI_MAX = 11;

/** The class of a published LKI value, or null for anything that is not a whole number 1-11. */
export function lkiBand(value: unknown): LkiBand | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < LKI_MIN || value > LKI_MAX) return null;
  if (value < 4) return 'good';
  if (value < 7) return 'moderate';
  if (value < 9) return 'insufficient';
  if (value < 11) return 'bad';
  return 'very_bad';
}

/** The credit line of the MODELLED line, printed beside the source credit whenever the card shows it: the model is RIVM's, via Luchtmeetnet, and its value is not shown as published (rounded up). */
export const LKI_MODEL_CREDIT = 'Modelled line: RIVM model calculation (a forecast, not a measurement), via www.luchtmeetnet.nl. Indicative; the model value is rounded up to a whole number by the rule Luchtmeetnet publishes, so it is not shown exactly as published.';

/** The span a modelled LKI row is current for, from its stamp (the hour's start): one clock hour. Client-safe, so the judge and the validator share it with the reader. */
export const LKI_MODEL_HOUR_MS = 3_600_000;

/** The whole-number LKI (1-11) of a DECIMAL modelled value, by Luchtmeetnet's rule (rounded up, see the header); null when it has none. */
export function lkiClass(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0) || value > LKI_MAX) return null;
  return Math.ceil(value);
}

/** Luchtmeetnet's own class labels, Dutch first (the regulator's word) with its English string. */
export const LKI_LABEL: Readonly<Record<LkiBand, { nl: string; en: string }>> = {
  good: { nl: 'Goed', en: 'Good' },
  moderate: { nl: 'Matig', en: 'Moderate' },
  insufficient: { nl: 'Onvoldoende', en: 'Insufficient' },
  bad: { nl: 'Slecht', en: 'Bad' },
  very_bad: { nl: 'Zeer slecht', en: 'Very bad' },
};

/** The classes in order with the index numbers each covers, for the card's key. */
export const LKI_KEY: readonly { band: LkiBand; from: number; to: number }[] = [
  { band: 'good', from: 1, to: 3 },
  { band: 'moderate', from: 4, to: 6 },
  { band: 'insufficient', from: 7, to: 8 },
  { band: 'bad', from: 9, to: 10 },
  { band: 'very_bad', from: 11, to: 11 },
];

/**
 * The legend colours of luchtmeetnet.nl itself (its theme's `legend` object: blue #3077CE, yellow #dfb300,
 * red #D84000, darkRed #9F1D35, purple #7d27cd), in class order. They are NOT India's palette and do not
 * reuse its green-to-maroon ramp, so an LKI class is never mistaken for a CPCB category.
 */
export const LKI_COLOUR: Readonly<Record<LkiBand, string>> = {
  good: '#3077CE', moderate: '#dfb300', insufficient: '#D84000', bad: '#9F1D35', very_bad: '#7d27cd',
};
