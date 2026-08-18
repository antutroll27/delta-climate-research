/**
 * NGSI-LD entity representation for the study wards.
 *
 * WHAT THIS DOES AND DOES NOT CLAIM. NGSI-LD (ETSI GS CIM 009) defines two
 * things: an information model, and a broker API. This implements the
 * information model only — entities with a URN `id`, a `type`, an `@context`,
 * and attributes as `Property` / `Relationship` / `GeoProperty`. There is no
 * context broker, so there are no subscriptions, no temporal queries and no
 * federation, and /standards says exactly that. Under the ladder we publish,
 * implementing the data model IS alignment; the broker would be the next rung.
 *
 * WHY NOT THE SMART DATA MODELS `Building` TYPE. It was the obvious candidate
 * and it is the wrong one: its properties are occupancy and management fields —
 * peopleCapacity, occupier, floorsAboveGround, openingHours — and we hold none
 * of them. Emitting Building entities with those absent, or worse invented,
 * would repeat precisely the fabrication (`population_exposed_high_heat`) that
 * this whole standards pass exists to remove. So the entity is modelled on what
 * we actually measure: a ward's modelled thermal state, with every attribute
 * traceable to accuracy.ts or a calibration artefact.
 *
 * Units are UN/CEFACT Recommendation 20 codes, which is what NGSI-LD's
 * `unitCode` expects: KEL kelvin, MTR metre.
 */
import type { Ward } from '../../data/wards.ts';
import { wardFeature } from './geojson.ts';
import { LICENCE_BLOCK } from './odbl.ts';
import { wardRecord } from './ward-record.ts';

export const CORE_CONTEXT = 'https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context-v1.7.jsonld';
export const LOCAL_CONTEXT = '/api/ngsi-ld/context.jsonld';
export const NGSI_TYPE = 'application/ld+json';
const VOCAB = 'https://deltaclimate.earth/ns/climate#';

/** The domain terms our entities use, so `type` and every attribute resolve. */
export const CONTEXT_DOCUMENT = {
  '@context': [
    {
      dcr: VOCAB,
      UrbanClimateWard: `${VOCAB}UrbanClimateWard`,
      surfaceTemperatureBand: `${VOCAB}surfaceTemperatureBand`,
      surfaceTemperatureTier: `${VOCAB}surfaceTemperatureTier`,
      validationSampleSize: `${VOCAB}validationSampleSize`,
      measuredQuantity: `${VOCAB}measuredQuantity`,
      notMeasured: `${VOCAB}notMeasured`,
      buildingCount: `${VOCAB}buildingCount`,
      analysisCrs: `${VOCAB}analysisCrs`,
      dataStatus: `${VOCAB}dataStatus`,
      withinAreaOfInterest: `${VOCAB}withinAreaOfInterest`,
      dataLicence: `${VOCAB}dataLicence`,
    },
    CORE_CONTEXT,
  ],
};

const prop = (value: unknown, unitCode?: string, observedAt?: string) => ({
  type: 'Property' as const,
  value,
  ...(unitCode ? { unitCode } : {}),
  ...(observedAt ? { observedAt } : {}),
});

export function wardEntity(w: Ward, opts: { readonly inline?: boolean } = {}) {
  const r = wardRecord(w);
  const f = wardFeature(w);
  return {
    // Req: `id` is a URI. The URN form is the NGSI-LD convention.
    id: `urn:ngsi-ld:UrbanClimateWard:${w.id}`,
    type: 'UrbanClimateWard',
    name: prop(r.name),
    dataStatus: prop(r.status),
    // GeoProperty is how NGSI-LD carries geometry — GeoJSON as the value.
    location: { type: 'GeoProperty' as const, value: f.geometry },
    analysisCrs: prop(r.analysisCrs),
    buildingCount: prop(r.provenance.footprints.count),
    // What is measured, and what it is NOT — the same separation the REST
    // payloads carry, because a broker consumer is even more likely to read a
    // bare temperature as air temperature.
    measuredQuantity: prop(r.quantity.measured),
    notMeasured: prop(r.quantity.isNot),
    // the geometry in `location` is ODbL-derived, so the licence travels with it
    dataLicence: prop(LICENCE_BLOCK.notice),
    surfaceTemperatureBand: prop(r.confidence.night.bandK, 'KEL'),
    surfaceTemperatureTier: prop(r.confidence.night.tier),
    validationSampleSize: prop(r.confidence.night.n),
    '@context': opts.inline ? CONTEXT_DOCUMENT['@context'] : LOCAL_CONTEXT,
  };
}
