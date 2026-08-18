/**
 * The OGC API — Features discovery documents, in one place.
 *
 * WHY THE .json EXTENSIONS DO NOT BREAK DISCOVERY. The spec's paths are
 * /conformance, /collections and so on, with no extension. Static hosting cannot
 * serve those with a correct content type, so ours carry `.json`. That is a
 * deviation — and it costs nothing, because Features discovery is driven by LINK
 * RELATIONS, not by hardcoded paths: a client fetches the landing page and
 * follows `rel: "conformance"` and `rel: "data"` to whatever URL we advertise.
 * QGIS and ogr2ogr work this way. The paths differ; the navigation does not.
 *
 * WHY conformsTo IS EMPTY. Requirements 21 and 23 and §7.15.4 make `limit`,
 * `bbox` and `datetime` MANDATORY on the items endpoint. A static file cannot
 * vary its response by query parameter, so we do not meet Core — and every other
 * class in Part 1, GeoJSON included, declares a dependency on Core. Listing a
 * class we fail would be exactly the overclaim §2.4 exists to prevent, so the
 * array is empty and the reason ships beside it. Declaring zero conformance
 * while publishing correct discovery documents is a more precise statement about
 * this API than any subset claim would be.
 */
export const OGC_BASE = '/api';

export const LANDING = `${OGC_BASE}/index.json`;
export const CONFORMANCE = `${OGC_BASE}/conformance.json`;
export const COLLECTIONS = `${OGC_BASE}/collections.json`;
export const OPENAPI = `${OGC_BASE}/openapi.json`;

export const JSON_TYPE = 'application/json';
export const GEOJSON_TYPE = 'application/geo+json';

export interface Link {
  readonly href: string;
  readonly rel: string;
  readonly type?: string;
  readonly title?: string;
}

/** The three links Requirement 2 (/req/core/root-success) makes mandatory, plus self. */
export const landingLinks: readonly Link[] = [
  { href: LANDING, rel: 'self', type: JSON_TYPE, title: 'This document' },
  { href: OPENAPI, rel: 'service-desc', type: 'application/vnd.oai.openapi+json;version=3.1', title: 'API definition' },
  { href: CONFORMANCE, rel: 'conformance', type: JSON_TYPE, title: 'Conformance declaration' },
  { href: COLLECTIONS, rel: 'data', type: JSON_TYPE, title: 'Collections' },
];

export const NOT_CONFORMANT_REASON =
  'This API declares conformance to no class of OGC API — Features Part 1. Requirements 21 and 23 and §7.15.4 '
  + 'make the limit, bbox and datetime query parameters mandatory on the items endpoint, and this is a static '
  + 'build: files are written once and served as bytes, so a response cannot vary by query parameter. Every '
  + 'other conformance class in Part 1 depends on Core, so none can be claimed either. What is published here '
  + 'is the discovery structure — landing page, conformance declaration, collections, items and individual '
  + 'features, with correct link relations and media types — which is enough for a client to navigate the API, '
  + 'and not enough to call it conformant.';
