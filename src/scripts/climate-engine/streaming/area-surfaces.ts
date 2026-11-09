/**
 * area-surfaces.ts — what every surface that assumed ONE area says while a streamed area is open (stream-public).
 *
 * THE RULE: the page is Canal Ring's (`/heat-map/nl/amsterdam/canal-ring/`) and every other area is `?area=F4` on it, so a surface that was written for "the
 * area this page is" either works for the open area or says, in words, that it does not yet. It never prints Canal Ring's numbers, files or name for another
 * area. Canal Ring itself (E4) is untouched: every surface keeps exactly what the page already did for it.
 *
 * PURE: no DOM, no window, so node tests pin every sentence (tests/unit/stream-public-surfaces.test.mjs). The DOM side applies them (streaming-host/page-wiring.ts
 * for the static cards; heat-map-app.ts for the ones the app repaints, which must not be overwritten by its next repaint). Reached only through dynamic import()
 * from `startStream`, so a build without the streaming flags contains none of these sentences (scripts/check-stream-dist.mjs).
 */
import { headerOf, type AreaHeader } from './area-page.ts';
import type { AreaNames } from './loader-model.ts';
import type { SheetCode } from '../scope/sheets.ts';

/** The one area that is the page's own: the page's static HTML, its record, its meta and its links are Canal Ring's. */
export const PAGE_AREA: SheetCode = 'E4';

export interface AreaSurfaces {
  /** Is `code` an area other than the page's own, i.e. one whose surfaces must not read as Canal Ring's? */
  isForeign(code: SheetCode): boolean;
  header(code: SheetCode): AreaHeader;
  /** `<title>`, `og:title`, `twitter:title`. The URL tags (`og:url`, `link[rel=canonical]`) are NOT rewritten: the page's address is Canal Ring's, query-free, and `?area=F4` is the same page. */
  title(code: SheetCode): string;
  /** `meta[name=description]`, `og:description`, `twitter:description`. */
  description(code: SheetCode): string;
  /** The Compare rail link and both "ward brief" links: the sentence the disabled link carries. */
  compareUnavailable: string;
  /** The Data and methods "Ward record" card's body. */
  record(code: SheetCode): string;
  /** The Data receipts panel's body. */
  receipts(code: SheetCode): string;
  /** The Solar pane's summary line. */
  solar(code: SheetCode): string;
}

export function createAreaSurfaces(names: AreaNames, cityName: string): AreaSurfaces {
  const header = (code: SheetCode): AreaHeader => headerOf(code, names);
  const label = (code: SheetCode): string => `${header(code).name} (Area ${code})`;
  return {
    isForeign: (code) => code !== PAGE_AREA,
    header,
    title: (code) => `${label(code)} Urban Heat Explorer — ${cityName} — Delta Climate Research`,
    description: (code) => `Modelled surface heat for ${label(code)}, ${cityName}, on a live 3D map of its buildings, trees and water. `
      + 'Screening-grade, and heat accuracy is not yet validated for this city.',
    compareUnavailable: 'Not available for this area yet',
    record: (code) => `No record ships for ${header(code).name}. The ward record states what was measured, with what error, from which datasets — and no record has been written for this area yet.`,
    receipts: (code) => `Data receipts are not available for ${header(code).name} yet. They are written area by area, and none has been written for this one.`,
    solar: (code) => `No solar screen ships for ${header(code).name} yet. The screen is run area by area, and it has not been run for this one.`,
  };
}
