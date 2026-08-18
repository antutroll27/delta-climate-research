/**
 * The standards alignment matrix — ONE definition, read by /standards (HTML)
 * and /api/standards.json (machine). Statuses are what actually ships after
 * this pass, not what the source doc hoped for.
 *
 * Vocabulary is the doc's §2.1 ladder: aligned / compatible / compliant /
 * certified. Nothing here may say "compliant" or "certified" — the unit test
 * greps for it. See 3d_digititalTwin_standards.MD §2.4.
 */
export type Posture = 'aligned' | 'compatible' | 'roadmap' | 'not-applicable';

export interface MatrixRow {
  readonly standard: string;
  readonly region: string;
  readonly purpose: string;
  readonly posture: Posture;
  /** what a reader can actually go and fetch today */
  readonly ships: string;
  /** what would be needed to move up the ladder — never blank for a roadmap row */
  readonly gap: string;
}

export const MATRIX: readonly MatrixRow[] = [
  {
    standard: 'OGC CityJSON 2.0', region: 'Global', purpose: 'Semantic 3D city models',
    posture: 'aligned',
    ships: 'LoD1 Building objects per ward at /api/wards/{id}/cityjson.json — one Solid per shipped footprint, per-building height source and confidence attributes, and a lineage block under the +delta_lineage extension key. Validates against the official CityJSON 2.0 JSON Schema (scripts/check-cityjson-schema.py, run in the build gate).',
    gap: 'Schema-valid, not geometry-audited by the reference validator (cjval): planarity and orientation of the extruded solids are checked by our own tests, not by an external tool. LoD2 and non-building city objects are not produced.',
  },
  {
    standard: 'OGC API — Features (patterns)', region: 'Global', purpose: 'Geospatial collections and features',
    posture: 'aligned',
    ships: 'Static GeoJSON at /api/collections/wards, /items and /items/{id}, served as application/geo+json.',
    gap: 'No landing page, no conformance declaration, no paging or CRS negotiation. Static files at the standard paths, not a Features server.',
  },
  {
    standard: 'OGC 3D Tiles 1.1', region: 'Global', purpose: '3D streaming',
    posture: 'aligned',
    ships: 'A tileset per ward at /3d-tiles/{id}/tileset.json — 12,767 LoD1 buildings as glTF 2.0, radian region bounding volumes, and a geometric error measured from the ward\'s median building footprint diagonal. Validated with the official Cesium 3d-tiles-validator: 0 errors, 0 warnings on all three.',
    gap: 'Single-level tilesets: one root tile per ward, no hierarchy, so there is no progressive refinement to stream. Buildings sit at ellipsoid height 0 because no validated terrain model exists — viewers must clamp to terrain. LoD1 only; no roof shape.',
  },
  {
    standard: 'buildingSMART IFC / ISO 16739', region: 'Global', purpose: 'BIM exchange',
    posture: 'roadmap',
    ships: 'Nothing.',
    gap: 'IFC import for proposed-building scenarios. Not started.',
  },
  {
    standard: 'FIWARE NGSI-LD', region: 'EU / Global', purpose: 'Smart-city context data',
    posture: 'roadmap',
    ships: 'Nothing. A static file shaped like an entity is not an integration without a context broker.',
    gap: 'A broker, subscriptions, temporal queries. Revisit if a municipal partner runs FIWARE.',
  },
  {
    standard: 'ISO 37120 / 37122', region: 'Global', purpose: 'City sustainability indicators',
    posture: 'roadmap',
    ships: 'Nothing machine-readable yet.',
    gap: 'A KPI mapping page from the intervention outputs (cool-roof potential, canopy cover, ΔT). Planned.',
  },
  {
    standard: 'ISO 19650', region: 'Global', purpose: 'BIM information management',
    posture: 'roadmap',
    ships: 'Nothing.',
    gap: 'Versioning and information-exchange practice for a municipal deployment.',
  },
  {
    standard: 'Gemini Principles', region: 'UK / Western', purpose: 'Digital twin governance',
    posture: 'aligned',
    ships: 'Governance approach on /standards: open data, published error bars, published null results, no personal data.',
    gap: 'A statement of principle, not an assessed conformance.',
  },
  {
    standard: 'Dubai Pulse / Digital Dubai Authority', region: 'Dubai', purpose: 'City data ecosystem',
    posture: 'roadmap',
    ships: 'An integration pathway is documented. There is no integration.',
    gap: 'Official review and approval. As of 2026-08-11 the Dubai Pulse host refuses connections from outside the UAE, so nothing has been tested against it.',
  },
  {
    standard: 'Dubai Municipality GIS / BIM', region: 'Dubai', purpose: 'Municipal planning workflows',
    posture: 'roadmap',
    ships: 'Nothing. Ward heat maps and shadow reports could feed a planning workflow; none has been validated by the municipality.',
    gap: 'Municipal validation. Self-service geodatabase access is government-only; this is a relationship ask.',
  },
  {
    standard: 'UAE Data Governance (Law 26/2015; FDL 45/2021)', region: 'UAE', purpose: 'Privacy and data compliance',
    posture: 'aligned',
    ships: 'The prototype processes no personal data: aggregated, ward-level, open geospatial inputs only.',
    gap: 'Formal legal review before any production deployment.',
  },
];

export const APPROVED_STATEMENT =
  'Delta Climate Earth is a standards-aligned urban climate digital twin prototype. It demonstrates '
  + 'interoperability patterns using OGC geospatial formats and publishes its data lineage and measured '
  + 'error bars alongside every output. Formal certification, municipal approval, and production compliance '
  + 'are planned for later deployment phases.';

export const UNCERTAINTY_STATEMENT =
  'The platform provides planning-grade estimates based on open data and simplified physical models. '
  + 'Outputs are intended for scenario exploration and prioritisation, not certified engineering, legal, '
  + 'or medical decision-making.';

/** §2.4 of the source spec. The unit test asserts none of these appear on the wire or the page. */
export const PROHIBITED = Object.freeze([
  'certified', 'fully compliant', 'officially integrated', 'approved by dubai municipality',
  'iso certified', 'medically validated', 'engineering-grade', 'guaranteed heat reduction',
]);

/**
 * The path from aligned to certified — doc §14, made CHECKABLE.
 *
 * The matrix above already says what would move each individual standard up a
 * rung. What it does not say is the ORDER, or where we currently stand. That
 * sequencing is the whole "aligned for certification" claim: alignment only
 * means something if the route onward exists and the current position on it is
 * stated honestly.
 *
 * So every done item names the artefact that PROVES it. A roadmap whose
 * completed items cannot be checked is marketing; one where each tick has a URL
 * or a script behind it is evidence. `evidence` is required whenever
 * status is 'done' — a unit test enforces exactly that.
 */
export type PhaseStatus = 'done' | 'partial' | 'todo';

export interface PhaseItem {
  readonly item: string;
  readonly status: PhaseStatus;
  /** required for 'done' and 'partial': what a reader can go and check */
  readonly evidence?: string;
}

export interface Phase {
  readonly phase: string;
  readonly title: string;
  readonly objective: string;
  readonly items: readonly PhaseItem[];
}

export const PHASES: readonly Phase[] = [
  {
    phase: 'Phase 1', title: 'Prototype',
    objective: 'Sample endpoints live, alignment matrix published, uncertainty and attribution in place.',
    items: [
      { item: 'Sample endpoints live', status: 'done', evidence: '/api/standards.json and 12 further static JSON routes' },
      { item: 'Alignment matrix published', status: 'done', evidence: '/standards, and machine-readable at /api/standards.json' },
      { item: 'Uncertainty page in place', status: 'done', evidence: '/uncertainty — every figure read at build time from accuracy.ts' },
      { item: 'Attribution page in place', status: 'done', evidence: '/attribution — generated from the provenance files; an unlicensed dataset fails the build' },
    ],
  },
  {
    phase: 'Phase 2', title: 'Municipal pilot',
    objective: 'Schema validation against the specifications, access control, validation against local sensor data.',
    items: [
      { item: 'CityJSON validated against the OGC 2.0 schema', status: 'done', evidence: 'scripts/check-cityjson-schema.py, run in the build gate — brought forward from this phase and already passing' },
      { item: 'OGC API Features conformance (landing page, conformance declaration, paging, CRS negotiation)', status: 'todo' },
      { item: 'NGSI-LD entities resolving against a context broker', status: 'todo' },
      { item: 'Access control and API keys', status: 'todo', evidence: 'Not applicable while the surface is read-only static files; becomes real the moment anything is writable.' },
      { item: 'Validation against local sensor data', status: 'partial', evidence: 'Satellite validation is done (ECOSTRESS, leave-one-overpass-out). Ground sensors are not: only one of the three wards has an AQI station, and none has a thermal one.' },
    ],
  },
  {
    phase: 'Phase 3', title: 'Production integration',
    objective: 'Formal governance review, official integration discussions, 3D Tiles, IFC/BIM pathway, audit logs.',
    items: [
      { item: 'Formal governance and legal review', status: 'todo' },
      { item: 'Official integration discussions (Dubai Pulse, Dubai Municipality)', status: 'todo', evidence: 'Blocked on access, not on engineering: as of 2026-08-11 the Dubai Pulse host refuses connections from outside the UAE.' },
      { item: '3D Tiles tileset with real geometric error and radian bounding volumes', status: 'done', evidence: '/3d-tiles/{ward}/tileset.json — built by scripts/build-3d-tiles.py, 0 errors and 0 warnings from the official Cesium validator, which does open and check the glTF content.' },
      { item: 'IFC / BIM pathway', status: 'todo' },
      { item: 'Audit logs and data residency controls', status: 'todo' },
    ],
  },
  {
    phase: 'Phase 4', title: 'East Asia expansion',
    objective: 'Virtual Singapore alignment, Shenzhen CIM preparation, local cloud deployment.',
    items: [{ item: 'Not started; sequenced after a first municipal deployment', status: 'todo' }],
  },
];
