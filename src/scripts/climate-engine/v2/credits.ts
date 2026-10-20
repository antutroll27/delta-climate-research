// src/scripts/climate-engine/v2/credits.ts — the v2 credit lines that more than one page writes, spelled once (C audit F2).
// Imported by Astro frontmatter only (build time): it reads a data file, so it must never reach a client bundle.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SourceCredit {
  /** the attribution sentence */
  readonly lead: string;
  /** the licence label shown beside it */
  readonly licence: string;
  /** the licence's own page, where one is published (else null) */
  readonly url: string | null;
}

/** The Sentinel-2 composite's years come from the pipeline's own provenance (data/dc-urs/sentinel.json `years_requested`, the file
 *  src/scripts/standards/stac.ts cites), never from a typed number. The data are a median composite: "modified" in Copernicus's sense. */
function sentinelYears(): string {
  const raw = JSON.parse(readFileSync(resolve('data/dc-urs/sentinel.json'), 'utf8')) as { years_requested: number[] };
  const ys = raw.years_requested;
  const [first, last] = [ys[0], ys[ys.length - 1]];
  if (first === undefined || last === undefined) throw new Error('data/dc-urs/sentinel.json has no years_requested');
  return first === last ? String(first) : `${first}–${last}`;
}

/** Same words and link as /attribution (ward-record LICENCES['Sentinel-2 L2A']); the unit test holds them equal. */
export const SENTINEL_CREDIT: SourceCredit = {
  lead: `Contains modified Copernicus Sentinel data ${sentinelYears()}`,
  licence: 'Copernicus Sentinel data terms',
  url: 'https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice',
};

/** v1's attribution line: "Water © OpenStreetMap (ODbL)". */
export const WATER_CREDIT: SourceCredit = { lead: 'Water © OpenStreetMap', licence: 'ODbL', url: null };
