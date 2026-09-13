/**
 * Money, written the way the money is written.
 *
 * WHAT THIS EXISTS FOR. `fmtCr` used to live in `heat-map-model.ts` — the pure
 * physics module — and it hardcoded three separate Indian facts at once:
 *
 *   ₹        the symbol, pasted at all three call sites rather than here
 *   cr / L   crore and lakh, the Indian myriad-based numbering convention
 *   en-IN    the 2,2,3 digit grouping that goes with it (1,10,96,667)
 *
 * Meanwhile `Costs.currency` was declared "carried for the readouts that must name
 * it" and NO PRODUCTION CODE READ IT. So the country half of the scope migration
 * was complete on paper — the registry knew India used rupees — and every readout
 * on the page still said ₹ because the string was typed into the template. A DEWA
 * audience would have been quoted Dubai's roof area at Kolkata's prices in
 * Kolkata's currency, in crore, and nothing would have flagged it.
 *
 * CRORE IS NOT A SYMBOL SWAP. Replacing ₹ with AED and leaving "cr" would produce
 * "AED 1.11 cr", which is not wrong-looking so much as meaningless: crore is a unit
 * of the Indian numbering system, not of the rupee, and the Gulf counts in
 * millions. Symbol, scale-word and grouping have to move together or they do not
 * move at all.
 *
 * SO THERE IS ONE CALL AND NO TABLE. `Intl.NumberFormat` already holds all three
 * facts and already agrees with itself about them: at `en-IN` compact notation IS
 * lakh and crore (₹1.11Cr, ₹9.5L), and everywhere else it is K/M/B (AED 11.1M).
 * A hand-written `{ INR: ['cr','L'], AED: ['M','K'] }` table would be a second
 * opinion about the same fact, free to disagree with the symbol it is printed
 * beside — which is the shape of every defect this migration was written against.
 *
 * The locale is DERIVED, not tabulated: ISO 4217 builds a currency code out of the
 * ISO 3166 country code plus a letter for the unit, so `INR` → `IN`, `AED` → `AE`,
 * `USD` → `US`. That is a rule rather than a list, so adding a country to the
 * registry cannot leave a currency behind in a lookup nobody remembered to extend.
 * A code whose first two letters are not a real region (the X-prefixed ones, and
 * `EUR`) is well-formed BCP-47 all the same and Intl falls back to plain `en` —
 * verified, not assumed: `en-EU`, `en-XT` and `en-XA` all format rather than throw.
 */
import type { Costs } from './types.ts';

/**
 * `INR` → `en-IN`. See the header: a rule, not a table.
 *
 * English rather than the local language on purpose — the instrument's whole UI is
 * English, and `hi-IN` would put Devanagari digits beside an English label. The
 * REGION is what carries the numbering convention, and that is the half being
 * derived here.
 */
const localeFor = (currency: string): string => `en-${currency.slice(0, 2)}`;

/* Built once per currency and kept. `paintScore` runs on every slider frame, and
   constructing an Intl.NumberFormat is the expensive part of formatting — ICU has
   to resolve the locale and load its number symbols. Keyed by currency because the
   locale is a function of it, so the two can never key differently. */
const FORMATTERS = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string): Intl.NumberFormat {
  const cached = FORMATTERS.get(currency);
  if (cached !== undefined) return cached;
  /* `maximumFractionDigits: 2` is what makes this read like the figures it
     replaces — ₹1.11Cr where the default compact notation would round to ₹1Cr and
     throw away the precision the old "1.11 cr" carried. `notation: 'compact'` is
     the whole point: it is the one switch that turns 11,096,667 into the scale
     word the READER'S convention uses, rather than the one ours does. */
  const made = new Intl.NumberFormat(localeFor(currency), {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 2,
  });
  FORMATTERS.set(currency, made);
  return made;
}

/**
 * A capital figure, in the currency that produced it.
 *
 * TAKES THE WHOLE `Costs`, not a bare currency string, and that is the guard: the
 * unit prices and the symbol printed beside the total then come from ONE object,
 * so a readout cannot be labelled in a currency other than the one `computeCost`
 * multiplied. Passing a string would let a call site hold the right prices and the
 * wrong label, which is exactly the state this whole seam was found in.
 *
 * NON-NULL, deliberately, for the same reason `computeCost` is: a country that has
 * adopted no cost basis has no figure to format. That absence is refused once, at
 * `requireCosts` in `scope/resolve.ts`, so it can never arrive here as a zero
 * wearing somebody else's symbol.
 */
export function fmtMoney(amount: number, costs: Costs): string {
  return formatterFor(costs.currency).format(amount);
}

/**
 * The currency's own mark, for PROSE that names a currency without quoting a
 * figure — "cost in X" rather than "X 1.11Cr".
 *
 * WHY THIS EXISTS AT ALL. The area pages' meta description ends "see cooling in
 * degrees and cost in <mark> on a live 3D map", and that mark was typed into the
 * template. It is the same defect the header describes one layer up and the
 * currency tripwire in tests/unit/obos-scope.test.mjs is written against — the
 * country half of the scope knew the currency perfectly well — but it had been
 * sitting in an .astro page, outside the tree that guard scans, so nothing saw it.
 * The day Dubai ships artefacts its page would have advertised Kolkata's rupee to
 * a Gulf reader, in the one sentence a search engine quotes.
 *
 * FROM `formatToParts`, NEVER FROM A TABLE. It is the SAME formatter `fmtMoney`
 * prints with, so the mark in this sentence and the mark on the figure beside it
 * cannot disagree — which a `{ INR: 'x', AED: 'y' }` lookup would eventually let
 * them do. What it yields is what that convention actually writes: a symbol where
 * one exists, and the bare code where one does not.
 */
export function currencyMark(costs: Costs): string {
  return formatterFor(costs.currency)
    .formatToParts(0)
    .filter((part) => part.type === 'currency')
    .map((part) => part.value)
    .join('');
}

/* The unit-price shape of the same formatter, cached in its own map because the
   OPTIONS differ and the currency alone would key the two together. The locale
   still comes from `localeFor`, so the region — and with it the grouping — is
   derived in exactly one place for both shapes. */
const RATE_FORMATTERS = new Map<string, Intl.NumberFormat>();

function rateFormatterFor(currency: string): Intl.NumberFormat {
  const cached = RATE_FORMATTERS.get(currency);
  if (cached !== undefined) return cached;
  const made = new Intl.NumberFormat(localeFor(currency), {
    style: 'currency',
    currency,
    notation: 'standard',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  RATE_FORMATTERS.set(currency, made);
  return made;
}

/**
 * A UNIT PRICE — a tariff per kWh, a rate per tonne — with two fixed decimals and
 * no compact scale. `fmtMoney` compacts (11.1M) and drops decimals, which is right
 * for a figure and wrong for a rate; concatenating `currencyMark` with a number
 * puts "AED" flush against the digits while the figure beside it prints "AED 8".
 * Same locale, same currency, same formatter family, so the two can never disagree.
 */
export function fmtRate(amount: number, costs: Costs): string {
  return rateFormatterFor(costs.currency).format(amount);
}
