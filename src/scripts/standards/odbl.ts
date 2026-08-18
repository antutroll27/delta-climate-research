/**
 * ODbL compliance for the geometry exports.
 *
 * THE QUESTION WE ARE NOT TRYING TO ANSWER. ODbL §4.5 exempts a "Produced Work"
 * from share-alike; §4.4 binds a "Derivative Database" to it. Which one a
 * CityJSON file, a 3D Tiles tileset or a GeoJSON FeatureCollection of
 * Overture-derived buildings amounts to is genuinely arguable — a rendered map
 * image is clearly a Produced Work, and a re-servable table of building
 * geometry looks a great deal like a database.
 *
 * So we do not argue it. We comply with the STRICTER reading and the question
 * stops mattering: every export is declared a Derivative Database and offered
 * under ODbL. If the permissive reading is right we have given away nothing we
 * wanted to keep — the data is open by design. If the strict reading is right we
 * were already compliant. An ambiguity you can engineer around is not a risk
 * worth carrying to a trade show.
 *
 * The four obligations, and where each is discharged:
 *
 *   §4.2 Notices — every export carries the licence URI and preserves the
 *        upstream copyright notices. See `LICENCE_BLOCK`.
 *   §4.3 Notice for Produced Works — the exact sentence the licence prescribes
 *        is emitted verbatim by `odblNotice()`, including on the pages, which
 *        ARE Produced Works even on the permissive reading.
 *   §4.4 Share Alike — the exports are offered under ODbL-1.0. This is the
 *        clause the whole ambiguity turns on, and declaring it settles it.
 *   §4.6 Access — the entire Derivative Database is downloadable, free, in
 *        machine-readable form, at a stable URL. No alteration file is needed
 *        because we publish the whole thing.
 *   §4.7 Technological measures — none. Static files, no auth, no DRM, no
 *        rate limit. `restrictions: 'none'` says so rather than leaving it
 *        to be inferred.
 *
 * NOT LEGAL ADVICE, and the artefacts say so. It is a posture implemented in
 * code: doing the stricter thing so a lawyer's eventual answer cannot make us
 * retroactively non-compliant.
 */
export const ODBL_URI = 'https://opendatacommons.org/licenses/odbl/1-0/';
export const ODBL_ID = 'ODbL-1.0';

/**
 * The §4.3 notice, verbatim from the licence text. The wording is prescribed —
 * "Contains information from DATABASE NAME, which is made available here under
 * the Open Database License (ODbL)." — so it is generated, never retyped, and a
 * unit test pins the shape.
 */
export function odblNotice(databaseName: string): string {
  return `Contains information from ${databaseName}, which is made available here under the Open Database License (ODbL).`;
}

/** The upstream database our building geometry derives from. */
export const SOURCE_DATABASE = 'Overture Maps Foundation';

export const ODBL_NOTICE = odblNotice(SOURCE_DATABASE);

/**
 * Upstream notices preserved per §4.2. Overture's buildings theme is ODbL as a
 * whole, and it merges sources under their own terms — so the ODbL obligation
 * travels with the theme while each contributor keeps its own credit.
 *
 * Note the Microsoft subtlety: taken DIRECT from Microsoft the footprints are
 * CDLA-Permissive-2.0, but the same footprints reaching us INSIDE Overture are
 * redistributed under ODbL. For the Kolkata wards, which come via Overture,
 * ODbL is the licence that actually governs.
 */
export const UPSTREAM_NOTICES: readonly string[] = [
  '© OpenStreetMap contributors, available under the Open Database License (ODbL).',
  'Microsoft Global ML Building Footprints — CDLA-Permissive-2.0 at source, redistributed under ODbL within the Overture buildings theme.',
  'Google Open Buildings — CC BY 4.0.',
  'Building heights: Google Open Buildings 2.5D Temporal (2023) — CC BY 4.0.',
];

export interface LicenceBlock {
  readonly licence: string;
  readonly licenceUri: string;
  readonly treatedAs: string;
  readonly notice: string;
  readonly upstream: readonly string[];
  readonly shareAlike: string;
  readonly access: string;
  readonly restrictions: string;
  readonly disclaimer: string;
}

/**
 * Attached to every export that carries building geometry. One object, so a new
 * export format cannot ship with a subtly different licence statement.
 */
export const LICENCE_BLOCK: LicenceBlock = {
  licence: ODBL_ID,
  licenceUri: ODBL_URI,
  treatedAs: 'Derivative Database (ODbL §4.4). Whether an export like this is a Derivative Database or a '
    + 'Produced Work under §4.5 is arguable; we adopt the stricter reading so the question does not need '
    + 'settling before the data can be used.',
  notice: ODBL_NOTICE,
  upstream: UPSTREAM_NOTICES,
  shareAlike: 'This export and any Derivative Database made from it must be offered under ODbL-1.0, a later '
    + 'version, or a compatible licence (§4.4).',
  access: 'The entire Derivative Database is available free, online, in machine-readable form at the URL it '
    + 'is served from — so §4.6 is satisfied by the export itself; no separate alteration file exists or is '
    + 'needed.',
  restrictions: 'none — static files, no authentication, no rate limiting, no technological restriction (§4.7).',
  disclaimer: 'A compliance posture implemented in code, not legal advice. Formal review precedes any '
    + 'production or commercial deployment.',
};
