import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  'Google Open Buildings — DUAL-LICENSED CC BY 4.0 or ODbL v1.0, at the user\'s election; we elect ODbL.',
  'Building heights: Google Open Buildings 2.5D Temporal (2023) — same dual licence; taken direct, and used under CC BY 4.0.',
];

/**
 * WHY DECLARING THESE EXPORTS ODbL IS LAWFUL, which is the question an auditor
 * asks second and we could not previously answer from anything in this repo.
 *
 * A CC BY 4.0 work cannot simply be swept into an ODbL database: §2(a)(5)(C)
 * forbids imposing "additional or different terms" that restrict a downstream
 * recipient, and ODbL share-alike is exactly such a restriction. That is why
 * OpenStreetMap refuses CC-BY sources without a waiver, and it would have made
 * our own posture incoherent — Google-derived geometry inside an export we
 * declare ODbL.
 *
 * It is lawful because Google Open Buildings is DUAL-licensed. Verbatim from
 * sites.research.google/gr/open-buildings/, verified 2026-08-19:
 *
 *   "The data is shared under the Creative Commons Attribution (CC BY-4.0)
 *    license and the Open Data Commons Open Database License (ODbL) v1.0
 *    license. As the user, you can pick which of the two licenses you prefer
 *    and use the data under the terms of that license."
 *
 * So for the footprints we ELECT the ODbL option and there is no conflict. The
 * repo stated CC-BY-4.0 alone in five places and this sentence nowhere, which
 * left the whole compliance argument resting on a fact it never recorded.
 * Heights are taken direct rather than through Overture, so they stay CC BY 4.0.
 */
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
/**
 * THE licence block — read from data/licence/odbl-block.json so that TypeScript
 * and Python cannot disagree.
 *
 * This used to be a TS literal that scripts/build-3d-tiles.py RETYPED by hand,
 * under a comment claiming "one object, so a new export format cannot ship with a
 * subtly different licence statement". They had already diverged: the tileset's
 * copy was missing `shareAlike` and `access` entirely — the ODbL §4.4 and §4.6
 * statements — and the anti-drift test compared only `notice`, `licenceUri` and
 * `upstream.length`, so it passed on a block that had lost half its obligations.
 * An audit found it. One file now, and the test compares the whole object.
 */
export const LICENCE_BLOCK: LicenceBlock =
  JSON.parse(readFileSync(resolve('data/licence/odbl-block.json'), 'utf8')) as LicenceBlock;
