// Single source of truth for the case-study catalogue. The home section
// (Projects.astro) renders the pinned set piece from this; /projects and
// /projects/[slug] render the drafting-table coming-soon pages until a
// project flips `published: true` and gets real content.
export interface Project {
  id: string;
  slug: string;
  title: string;
  sub: string;
  tags: string;
  /** survey-sheet readout for the coming-soon page */
  coords: string;
  window: string;
  rev: string;
  /** rough position on the field→published meter, 0..1 */
  progress: number;
  blurb: string;
  published: boolean;
}

export const projects: Project[] = [
  {
    id: '01',
    slug: 'kolkata',
    title: 'Project Kolkata',
    sub: 'Urban heat mitigation',
    tags: 'ECOSTRESS · HVI — street-scale heat diagnostics to ward-level spec',
    coords: 'LAT 22.5726° N — LON 88.3639° E',
    window: '2026 · Q3',
    rev: '0.4',
    progress: 0.42,
    blurb:
      'Street-scale heat vulnerability for Kolkata — ECOSTRESS land-surface temperature fused with ward-level census indicators, written to a spec a municipal engineer can act on.',
    published: false,
  },
  {
    id: '02',
    slug: 'mangrove-blue-carbon',
    title: 'Mangrove Blue Carbon',
    sub: 'Biochar sequestration',
    tags: 'VERRA VM0033 · MRV — soil-carbon-rigorous restoration accounting',
    coords: 'LAT 21.9497° N — LON 88.9201° E',
    window: '2026 · Q4',
    rev: '0.2',
    progress: 0.28,
    blurb:
      'Restoration accounting for the Sundarbans that survives audit — soil organic carbon measured to VM0033, not estimated to a press release.',
    published: false,
  },
  {
    id: '03',
    slug: 'materials-trading',
    title: 'Sustainable Materials Trading',
    sub: 'UAE–India corridor',
    tags: 'EPD · CBAM — embodied-carbon dossiers for exporters',
    coords: '22.47° N 69.07° E → 25.20° N 55.27° E',
    window: '2027 · Q1',
    rev: '0.1',
    progress: 0.15,
    blurb:
      'Embodied-carbon dossiers for exporters on the India–UAE corridor — EPD-grade material passports built for CBAM scrutiny at the border.',
    published: false,
  },
];

export const projectHref = (p: Project) => `/projects/${p.slug}`;
