/**
 * The data-and-credits lines of the area page, PER CITY.
 *
 * WHY THIS IS DATA. `v2/Overlays.astro` typed one list of seven lines for every
 * city: "Footprints © Overture", "Heights Google Open Buildings 2.5D", "Ground SRTM
 * via AWS terrain tiles". That is the truth for Kolkata and Bengaluru and a false
 * statement for Amsterdam, whose footprints and heights are 3D BAG and whose ground
 * is AHN. 3D BAG's licence also REQUIRES its credit, a link to its copyright page,
 * a statement of changes, and (on a browsable map) a place in the bottom-right
 * corner. A credit that has to differ by city is a fact about the city.
 *
 * KOLKATA AND BENGALURU REPRODUCE TODAY'S LINES CHARACTER FOR CHARACTER. They share
 * one list, `INDIA_STACK`, because the page printed one list for both. The rendered
 * HTML is held byte-identical to the Overlays.astro they came from by
 * tests/unit/city-credits.test.mjs against tests/fixtures/credits/.
 *
 * SHAPE. A line is an ordered list of parts (plain text, a link, or a slot the app
 * fills after load) plus an optional licence and an optional statement of changes.
 * The plan sketched `{ lead, holder, licence, licenceUrl, modified }`; the basemap
 * line has three linked holders and the ground line has a live slot, so a flat record
 * could not reproduce them character for character. `rendered by credit-html.ts`.
 *
 * PURE: no fs, no DOM. The Sentinel-2 line takes its years from a data file at build
 * time (v2/credits.ts), so it is a marker here and the renderer is handed the
 * credit.
 */
/** Every city OBOS knows; tests/unit/city-credits.test.mjs holds this equal to the CITIES keys. */
export type CityId = 'kolkata' | 'bengaluru' | 'amsterdam';

export type CreditPart =
  | string
  | { readonly text: string; readonly href: string }
  /** an element the app fills after load (`#terrLab`): the text is its initial content */
  | { readonly slotId: string; readonly text: string };

export interface CreditLicence { readonly text: string; readonly href: string | null }

export interface CreditLine {
  readonly kind: 'line';
  readonly parts: readonly CreditPart[];
  readonly licence: CreditLicence | null;
  /** a statement of what was changed (CC BY requires one); rendered as its own <small> */
  readonly modified: string | null;
}
/** The Sentinel-2 line: years and licence come from build-time provenance, not from here. */
export interface SentinelMarker { readonly kind: 'sentinel' }
export type CreditEntry = CreditLine | SentinelMarker;

const NEW_TAB = 'target="_blank" rel="noopener noreferrer"';
export { NEW_TAB as CREDIT_LINK_ATTRS };

const line = (parts: readonly CreditPart[], licence: CreditLicence | null = null, modified: string | null = null): CreditLine =>
  Object.freeze({ kind: 'line', parts: Object.freeze([...parts]), licence, modified });
const link = (text: string, href: string) => ({ text, href });
const SENTINEL: SentinelMarker = Object.freeze({ kind: 'sentinel' });

const CC_BY_4 = Object.freeze({ text: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' });
const ODBL = Object.freeze({ text: 'ODbL', href: null });

const BASEMAP = line([
  'Basemap © ', link('OpenStreetMap', 'https://www.openstreetmap.org/copyright'),
  ' · ', link('OpenFreeMap', 'https://openfreemap.org'),
  ' · ', link('© OpenMapTiles', 'https://www.openmaptiles.org/'),
], ODBL);
const WEATHER = line(['Live weather © Met Norway'], CC_BY_4);

/** Kolkata's and Bengaluru's list: exactly the seven lines Overlays.astro printed for both. */
const INDIA_STACK: readonly CreditEntry[] = Object.freeze([
  BASEMAP,
  line(['Footprints © ', link('Overture Maps Foundation', 'https://overturemaps.org')], ODBL),
  line(['Heights Google Open Buildings 2.5D'], CC_BY_4),
  line(['Water © OpenStreetMap'], ODBL),
  SENTINEL,
  line(['Ground SRTM via AWS terrain tiles, ', { slotId: 'terrLab', text: 'indicative' }]),
  WEATHER,
]);

/**
 * AHN5 HEIGHT CREDIT. About 79 % of Amsterdam's building heights come from AHN5
 * (2023-25), CC BY 4.0, Het Waterschapshuis: it asks for the source on derived
 * products and 3D BAG's credit does not cover it. AHN4 (the PDOK terrain we serve)
 * is CC0, credited here as a courtesy. Wording per
 * /Volumes/OBOSLab/research/new-cities/AHN5-LICENCE.md (settled 2026-11-06).
 */
const AHN_URL = 'https://www.ahn.nl/';
const CC0 = Object.freeze({ text: 'CC0', href: 'https://creativecommons.org/publicdomain/zero/1.0/' });

const AMSTERDAM_STACK: readonly CreditEntry[] = Object.freeze([
  BASEMAP,
  line(
    [link('© 3DBAG by tudelft3d and 3DGI', 'https://docs.3dbag.nl/en/copyright/'), ' · footprints and building heights'],
    CC_BY_4,
    'footprints of 3DBAG v2025.09.03 simplified to 0.5 m; height = 70th-percentile roof minus ground level',
  ),
  line(['Heights: ', link('AHN5', AHN_URL), ', Het Waterschapshuis'], CC_BY_4,
    'roof-height percentile taken per building, clipped to the study area'),
  line(['Water, green and roads © OpenStreetMap contributors via ', link('Overture Maps', 'https://overturemaps.org')], ODBL),
  line(['Canopy © Meta / WRI'], CC_BY_4),
  SENTINEL,
  line(['Ground ', link('AHN4', AHN_URL), ' via PDOK, ', { slotId: 'terrLab', text: 'indicative' }], CC0),
  line(['Air-temperature normals, Schiphol 1991–2020: bron: KNMI. KNMI is not involved in this derived product']),
  WEATHER,
]);

export const CITY_CREDITS: Readonly<Record<CityId, readonly CreditEntry[]>> = Object.freeze({
  kolkata: INDIA_STACK,
  bengaluru: INDIA_STACK,
  amsterdam: AMSTERDAM_STACK,
});

/**
 * The credit a city's data licence REQUIRES on the map itself (MapLibre's
 * attribution control, bottom-right). 3D BAG: "If you integrate the 3DBAG data in a
 * browsable electronic map, the credit should appear in the bottom right corner."
 * Null for cities whose licences ask for nothing there; they keep today's control.
 */
export const CITY_MAP_CREDIT: Readonly<Record<CityId, string | null>> = Object.freeze({
  kolkata: null,
  bengaluru: null,
  amsterdam: [
    `<a href="https://docs.3dbag.nl/en/copyright/" ${NEW_TAB}>© 3DBAG by tudelft3d and 3DGI</a>`,
    `Heights: <a href="${AHN_URL}" ${NEW_TAB}>AHN5</a>, Het Waterschapshuis (<a href="https://creativecommons.org/licenses/by/4.0/" ${NEW_TAB}>CC BY 4.0</a>)`,
    `Terrain: <a href="${AHN_URL}" ${NEW_TAB}>AHN4</a> (CC0) via PDOK`,
    'modified by Delta Climate',
  ].join(' · '),
});

/**
 * A closing paragraph for the credits panel: the long-form provenance and the
 * no-endorsement statement CC BY 4.0 s.2(a)(6) asks for. Null for cities whose list
 * above is the whole of it (Kolkata, Bengaluru: nothing is added to their panel).
 */
export const CITY_CREDIT_NOTE: Readonly<Record<CityId, string | null>> = Object.freeze({
  kolkata: null,
  bengaluru: null,
  amsterdam: 'Building heights: © 3DBAG by tudelft3d and 3DGI (3D geoinformation research group, TU Delft, and 3DGI), '
    + 'release v2025.09.03, CC BY 4.0. The heights derive from Actueel Hoogtebestand Nederland: AHN5 (2023-2025), '
    + '© Het Waterschapshuis, CC BY 4.0, plus AHN3 and AHN4 (CC0). Terrain: AHN4 DTM/DSM 0.5 m (Het Waterschapshuis, CC0 1.0), '
    + 'served by PDOK. Delta Climate selected roof-height percentiles, clipped the data to the study area and converted it to a '
    + '3D mesh. Neither 3DBAG, TU Delft, 3DGI nor Het Waterschapshuis endorses this product.',
});

/** The map control's text: the city's required credit and the ward boundary's, either may be absent; null when both are. */
export function joinMapCredits(cityCredit: string | null, wardCredit: string | null): string | null {
  const parts = [cityCredit, wardCredit].filter((c): c is string => c !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}
