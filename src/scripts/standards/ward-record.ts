/**
 * The ONE place a ward becomes a standards-facing record.
 *
 * `/api/wards/{id}/metadata.json`, the OGC-Features items, `/attribution` and
 * the unit tests all read from here, so they cannot disagree with each other —
 * and none of them can disagree with the engine, because everything below is
 * imported from the modules that already drive the heat map:
 *
 *   src/data/wards.ts                 ward identity, centre, footprint  (the ONLY ward list)
 *   src/scripts/climate-engine/accuracy.ts   the measured confidence — bandK, n, verdicts
 *   public/heat-map/data/{id}-provenance.json   what the footprints actually came from
 *
 * NOTHING in a record is typed here by hand except the licence table, and that
 * table is keyed by the dataset names the provenance files already use — a
 * dataset with no licence entry throws at build time, so a new source cannot
 * ship un-attributed (docs/Ideas_and_Prototypes/3d_digititalTwin_standards.MD
 * §12.2, retired in favour of this).
 *
 * The bbox is derived exactly as scripts/_types.py:ward_bounds() derives it,
 * because that function is what the calibration pipeline scores against, and a
 * bbox published on the wire that differs from the one the science ran on would
 * be the quiet kind of wrong. The unit test pins the two together.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WARDS, type Ward } from '../../data/wards.ts';
import { ACCURACY, HEIGHTS, SPATIAL } from '../climate-engine/accuracy.ts';

/** Mirrors scripts/_types.py:m_per_deg — spherical WGS-84, good to <0.1 % over km. */
const M_PER_DEG_LON_EQUATOR = 111_320;
const M_PER_DEG_LAT = 110_540;

/** [west, south, east, north] in EPSG:4326 — rasterio's from_bounds order,
 *  and the order every OGC / GeoJSON bbox uses. */
export type Bbox = readonly [number, number, number, number];

export function wardBbox(w: Pick<Ward, 'lat' | 'lon' | 'footprintM'>): Bbox {
  const mx = M_PER_DEG_LON_EQUATOR * Math.cos((w.lat * Math.PI) / 180);
  const my = M_PER_DEG_LAT;
  const half = w.footprintM / 2;
  return [w.lon - half / mx, w.lat - half / my, w.lon + half / mx, w.lat + half / my];
}

/** UTM zone from longitude — mirrors scripts/_ecostress.py:utm_zone / target_crs. */
export function utmEpsg(lon: number, lat: number): string {
  const zone = ((Math.floor((lon + 180) / 6) % 60) + 1).toString().padStart(2, '0');
  return `EPSG:${lat >= 0 ? 326 : 327}${zone}`;
}

/* ---------------------------------------------------------------- licences */

/**
 * Keyed by the EXACT `datasets[]` strings the provenance files carry, plus the
 * non-footprint layers. Verified from primary sources — see the WETEX spec §8a
 * and docs/research/2026-08-11-open-source-physics-libraries.md. Adding a
 * dataset anywhere upstream without an entry here is a build failure, on purpose.
 */
export const LICENCES: Readonly<Record<string, { readonly licence: string; readonly holder: string; readonly url: string; readonly note?: string }>> = {
  'OpenStreetMap': {
    licence: 'ODbL-1.0', holder: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright',
    note: 'via Overture Maps. Attribution + share-alike. The Produced-Work vs Derivative-Database question is SETTLED for our exports: we adopt the stricter reading and license them as Derivative Databases — see /api/licence.json.',
  },
  'Google Open Buildings': {
    licence: 'CC-BY-4.0 OR ODbL-1.0', holder: 'Google Research', url: 'https://sites.research.google/gr/open-buildings/',
    note: 'DUAL-LICENSED at source — Google offers CC BY 4.0 or ODbL v1.0 and lets the user elect. We elect ODbL for the footprints, which is what makes declaring the exports as ODbL Derivative Databases lawful rather than an unlawful downstream restriction on CC-BY material. Footprints reach us via Overture, so ODbL governs those as we redistribute them; heights are taken DIRECT from the 2.5D Temporal product (zonal p65) via Earth Engine and remain CC-BY-4.0. No coverage of the Gulf.',
  },
  'Microsoft ML Buildings': {
    licence: 'CDLA-Permissive-2.0', holder: 'Microsoft', url: 'https://github.com/microsoft/GlobalMLBuildingFootprints',
    note: 'CDLA-Permissive-2.0 AT SOURCE. Kolkata footprints reach us inside the Overture buildings theme, which is ODbL as a whole, so ODbL governs what we redistribute. Dubai is taken direct from Microsoft, never via Overture, so CDLA governs there and no share-alike is inherited.',
  },
  'Overture Maps': {
    licence: 'ODbL-1.0', holder: 'Overture Maps Foundation', url: 'https://overturemaps.org/',
    note: 'the buildings theme is ODbL as a whole. Kolkata footprints only.',
  },
  'Sentinel-2 L2A': {
    licence: 'Copernicus Sentinel data terms', holder: 'European Union / ESA', url: 'https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice',
    note: 'surface reflectance via Earth Search STAC → vegetation fraction and Liang (2001) broadband albedo.',
  },
  'Meta / WRI Canopy Height Map': {
    licence: 'CC-BY-4.0', holder: 'Meta AI / World Resources Institute', url: 'https://registry.opendata.aws/dataforgood-fb-forests/',
    note: '1 m canopy height → tree instances.',
  },
  'NASA POWER': {
    licence: 'NASA data policy (open, attribution recommended)', holder: 'NASA LaRC', url: 'https://power.larc.nasa.gov/',
    note: 'meteorological forcing, ~50 km.',
  },
  'ECOSTRESS L2T LSTE v002': {
    licence: 'NASA data policy (open)', holder: 'NASA JPL / LP DAAC', url: 'https://lpdaac.usgs.gov/products/eco_l2t_lstev002/',
    note: 'thermal validation only — never a model input.',
  },
  'ICESat-2': {
    licence: 'NASA data policy (open)', holder: 'NASA / NSIDC', url: 'https://nsidc.org/data/icesat-2',
    note: 'height validation transects. Verdict: underpowered (see HEIGHTS).',
  },
  'Met Norway': {
    licence: 'NLOD-2.0 / CC-BY-4.0', holder: 'Norwegian Meteorological Institute', url: 'https://api.met.no/doc/License',
    note: 'live ambient readout only.',
  },
  'WSF3D': {
    licence: 'CC-BY-4.0', holder: 'DLR — World Settlement Footprint 3D (WSF3D) © DLR', url: 'https://geoservice.dlr.de/web/datasets/wsf_3d',
    note: 'Dubai building heights (TanDEM-X). Not yet shipped in a ward record.',
  },
};

/* --------------------------------------------------------------- provenance */

/** Shape verified against public/heat-map/data/ballygunge-provenance.json.
 *  `datasets` maps DISPLAY name → { key, traced }; `counts` is keyed by that
 *  short `key`. `traced: true` means a human drew it against imagery — the rest
 *  is model output — and that distinction is worth carrying to the wire. */
interface ProvenanceFile {
  readonly ward: string;
  readonly count: number;
  readonly unknown: number;
  readonly source: string;
  readonly note: string;
  readonly datasets: Readonly<Record<string, { readonly key: string; readonly traced: boolean }>>;
  readonly counts: Readonly<Record<string, number>>;
}

function readProvenance(id: string): ProvenanceFile {
  const raw = readFileSync(resolve(`public/heat-map/data/${id}-provenance.json`), 'utf8');
  return JSON.parse(raw) as ProvenanceFile;
}

/**
 * Building footprints for the Kolkata wards are delivered inside the OVERTURE
 * BUILDINGS THEME, which Overture publishes as ODbL as a whole. That means the
 * licence a downstream reuser must honour is ODbL — regardless of what any
 * individual contributor's upstream licence says.
 *
 * The distinction is not academic and the table used to get it wrong. Microsoft's
 * footprints are CDLA-Permissive-2.0 at source, which carries NO share-alike; a
 * reader of the old table would reasonably have concluded they could reuse those
 * buildings without share-alike obligations. Arriving via Overture, they cannot.
 * Licence attaches to the DELIVERY PATH, not to the dataset in the abstract —
 * which is why every layer below now carries both.
 */
const VIA_OVERTURE = { via: 'Overture Maps buildings theme', governing: 'ODbL-1.0' } as const;

/** The non-footprint layers every Kolkata ward carries. Footprint datasets come
 *  from the provenance file; these are the same for all three and are stated once. */
const KOLKATA_LAYERS: readonly { readonly layer: string; readonly dataset: string; readonly governing?: string }[] = [
  // dual-licensed at source; taken DIRECT (not via Overture), and we elect CC BY 4.0
  { layer: 'building heights',            dataset: 'Google Open Buildings', governing: 'CC-BY-4.0' },
  { layer: 'surface: vegetation + albedo', dataset: 'Sentinel-2 L2A' },
  { layer: 'canopy / trees',              dataset: 'Meta / WRI Canopy Height Map' },
  { layer: 'meteorological forcing',      dataset: 'NASA POWER' },
  { layer: 'live ambient readout',        dataset: 'Met Norway' },
  { layer: 'thermal validation',          dataset: 'ECOSTRESS L2T LSTE v002' },
  { layer: 'height validation',           dataset: 'ICESat-2' },
];

/* -------------------------------------------------------------------- record */

export interface WardRecord {
  readonly status: 'prototype';
  readonly id: string;
  readonly name: string;
  readonly zone: string;
  readonly body: string;
  readonly centre: { readonly lat: number; readonly lon: number };
  readonly footprintM: number;
  readonly bbox: Bbox;
  readonly crs: string;
  readonly analysisCrs: string;
  /** What the numbers below are MEASUREMENTS OF. Without this, a consumer reading
   *  `confidence.night.bandK = 3` has no way to know it is land surface temperature
   *  and not air temperature or a comfort index — the exact conflation §13.1 of the
   *  standards doc requires be ruled out "in all API field descriptions". It was
   *  absent until an audit of that checklist item caught it. */
  readonly quantity: {
    readonly measured: string;
    readonly units: string;
    readonly isNot: readonly string[];
    readonly note: string;
  };
  readonly confidence: {
    readonly night: { readonly tier: 'quantitative' | 'indicative'; readonly bandK: number; readonly n: number; readonly modelRmseK: number; readonly ceilingRmseK: number };
    readonly peak:  { readonly tier: 'quantitative' | 'indicative'; readonly bandK: number; readonly n: number; readonly modelRmseK: number; readonly ceilingRmseK: number };
    readonly spatial: { readonly n: number; readonly rModel: number; readonly rVegOnly: number; readonly note: string };
    readonly heights: { readonly verdict: string; readonly nBuildings: number; readonly minBuildings: number };
  };
  readonly provenance: {
    readonly footprints: {
      readonly source: string;
      readonly count: number;
      readonly byDataset: readonly { readonly dataset: string; readonly count: number; readonly traced: boolean }[];
    };
    readonly layers: readonly {
      readonly layer: string;
      readonly dataset: string;
      /** the upstream licence the dataset is published under */
      readonly sourceLicence: string;
      /** the licence that governs OUR redistribution — what a reuser must honour */
      readonly governingLicence: string;
      /** set when the two differ because of how the data reaches us */
      readonly via?: string;
      /**
       * Set when the two differ because the source offers a CHOICE and we made
       * one. Google Open Buildings is dual-licensed CC BY 4.0 or ODbL v1.0; the
       * footprints we take under ODbL (via Overture), the heights under CC BY 4.0
       * (taken direct). A divergence with neither `via` nor `elected` is
       * unexplained, and a test rejects it.
       */
      readonly elected?: string;
      readonly holder: string;
      readonly url: string;
    }[];
  };
}

function licenceFor(dataset: string) {
  const l = LICENCES[dataset];
  if (!l) throw new Error(`ward-record: dataset "${dataset}" has no licence entry — add it to LICENCES before it can ship`);
  return l;
}

export function wardRecord(w: Ward): WardRecord {
  const prov = readProvenance(w.id);
  const datasetNames = Object.keys(prov.datasets);
  // every footprint dataset the provenance names must be licensable, or we fail here
  for (const d of datasetNames) licenceFor(d);
  const byDataset = datasetNames.map((name) => ({
    dataset: name,
    count: prov.counts[prov.datasets[name]!.key] ?? 0,
    traced: prov.datasets[name]!.traced,
  }));
  const bbox = wardBbox(w);
  return {
    status: 'prototype',
    id: w.id,
    name: w.name.replace(/<\/?em>/g, ''),
    zone: w.zone,
    body: w.body,
    centre: { lat: w.lat, lon: w.lon },
    footprintM: w.footprintM,
    bbox,
    crs: 'EPSG:4326',
    analysisCrs: utmEpsg(w.lon, w.lat),
    quantity: {
      measured: 'land surface temperature (LST) — the radiometric temperature of the ground and roof surfaces, as an infrared satellite sees it',
      units: 'K (error bands) / °C (displayed values)',
      isNot: ['air temperature', 'human thermal comfort', 'UTCI or any comfort index', 'indoor temperature'],
      // the nuance is real and measured, so it is stated rather than flattened:
      // accuracy.ts records that NIGHT surface temperature tracks air temperature
      // closely, while the daytime divergence is large. Saying only "not air
      // temperature" would be as misleading as saying they are the same.
      note: 'Surface temperature can diverge from air temperature by many degrees in daytime sun; at night the two track closely. Comfort additionally depends on humidity, wind and radiant exchange, none of which this model resolves. Do not read these values as what a person feels.',
    },
    confidence: {
      night: { tier: ACCURACY.night.confidence, bandK: ACCURACY.night.bandK, n: ACCURACY.night.n, modelRmseK: ACCURACY.night.modelRmseK, ceilingRmseK: ACCURACY.night.ceilingRmseK },
      peak:  { tier: ACCURACY.peak.confidence,  bandK: ACCURACY.peak.bandK,  n: ACCURACY.peak.n,  modelRmseK: ACCURACY.peak.modelRmseK,  ceilingRmseK: ACCURACY.peak.ceilingRmseK },
      spatial: { n: SPATIAL.n, rModel: SPATIAL.rModel, rVegOnly: SPATIAL.rVegOnly, note: SPATIAL.note },
      heights: { verdict: HEIGHTS.verdict, nBuildings: HEIGHTS.nBuildings, minBuildings: HEIGHTS.minBuildings },
    },
    provenance: {
      footprints: { source: prov.source, count: prov.count, byDataset },
      layers: [
        // footprints arrive via Overture, so ODbL governs whatever the source says
        ...datasetNames.map((d) => ({
          layer: 'building footprints', dataset: d, ...pick(licenceFor(d)),
          governingLicence: VIA_OVERTURE.governing, via: VIA_OVERTURE.via,
        })),
        // everything else is taken direct, so source and governing are the same
        ...KOLKATA_LAYERS.map(({ governing, ...x }) => {
          const l = pick(licenceFor(x.dataset));
          // where a source offers a choice, `governing` records the one we elect
          return {
            ...x, ...l,
            governingLicence: governing ?? l.sourceLicence,
            ...(governing && governing !== l.sourceLicence
              ? { elected: `source offers a choice (${l.sourceLicence}); we use it under ${governing}` }
              : {}),
          };
        }),
      ],
    },
  };
}

function pick(l: { licence: string; holder: string; url: string }) {
  // renamed on the way out: `licence` upstream is the SOURCE licence, never
  // automatically the one governing our redistribution
  return { sourceLicence: l.licence, holder: l.holder, url: l.url };
}

export function allWardRecords(): WardRecord[] {
  return WARDS.map(wardRecord);
}
