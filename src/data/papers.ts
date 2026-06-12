// White-papers catalogue — single source of truth for the home feed
// (WhitePapers.astro) and the /white-papers/[slug] pages. When a paper is
// actually published, flip `published` to true and give the slug page real
// content; until then the slug route renders the branded "in preparation"
// instrument page.
export interface Paper {
  id: string;
  slug: string;
  date: string;
  cat: string;
  title: string;
  excerpt: string;
  published: boolean;
}

export const papers: Paper[] = [
  {
    id: '01',
    slug: 'soc-accounting-vm0033',
    date: '2026.05',
    cat: 'Blue carbon',
    title: 'Soil organic carbon accounting under VM0033',
    excerpt:
      'Belowground biomass and sediment-core MRV for tidal-wetland restoration — why SOC defensibility separates premium credits.',
    published: false,
  },
  {
    id: '02',
    slug: 'ecostress-heat-vulnerability',
    date: '2026.04',
    cat: 'Urban heat',
    title: 'Street-scale heat vulnerability from ECOSTRESS',
    excerpt:
      'Downscaling 70 m land-surface temperature into a sub-block Heat Vulnerability Index for dense Indian wards.',
    published: false,
  },
  {
    id: '03',
    slug: 'embodied-carbon-cbam',
    date: '2026.03',
    cat: 'Materials · CBAM',
    title: 'Embodied-carbon dossiers for the India–UAE corridor',
    excerpt:
      'EPD generation under ISO 14025 and CBAM emissions data for cement, steel and aluminium exporters.',
    published: false,
  },
];

export const paperHref = (p: Paper) => `/white-papers/${p.slug}`;
