// Single source of truth for the leadership roster rendered on /team.
// Bio / focus / background / work are placeholder (lorem) until real copy lands.
const LOREM = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia.',
];

export interface Member {
  id: string; // ordinal, '01'..
  first: string;
  last: string;
  tier: string; // role tier, e.g. 'Principal Consultant'
  discipline: string; // focus area
  mono: string; // initials for the cursor card + sheet portrait
  cover: 1 | 2 | 3 | 4; // which gradient
  bio: string[]; // detail-panel paragraphs (placeholder)
  focus: string[];
  background: string[];
  work: string[];
  email: string;
}

export const team: Member[] = [
  {
    id: '01', first: 'Angad', last: 'Burman', tier: 'Principal Consultant', discipline: 'Climate Risk Analytics', mono: 'AB', cover: 1,
    bio: LOREM, focus: ['Hazard modelling', 'Exposure & vulnerability', 'ECOSTRESS / LST'],
    background: ['Lorem ipsum, University of Lorem', 'MSc Climatology, 20XX'], work: ['Lorem heat-risk atlas', 'Ipsum coastal exposure'],
    email: 'angad@delta-climate.example',
  },
  {
    id: '02', first: 'Shirsha', last: 'Sen', tier: 'Principal Consultant', discipline: 'Climate Policy & Regulation', mono: 'SS', cover: 2,
    bio: LOREM, focus: ['CBAM', 'Carbon markets', 'Regulatory strategy'],
    background: ['Lorem School of Policy', 'LLM Lorem, 20XX'], work: ['Ipsum policy brief', 'Dolor compliance dossier'],
    email: 'shirsha@delta-climate.example',
  },
  {
    id: '03', first: 'Dhruv', last: 'Maniktala', tier: 'Lead', discipline: 'Operations Research', mono: 'DM', cover: 3,
    bio: LOREM, focus: ['Optimization', 'Field logistics', 'Data pipelines'],
    background: ['Lorem Institute of Technology', 'BSc Lorem, 20XX'], work: ['Sit amet survey ops', 'Consectetur routing model'],
    email: 'dhruv@delta-climate.example',
  },
  {
    id: '04', first: 'Antariksha', last: 'Kumar', tier: 'Lead', discipline: 'Technology Implementation', mono: 'AK', cover: 4,
    bio: LOREM, focus: ['Platform engineering', 'Geospatial tooling', 'Automation'],
    background: ['Lorem University', 'BTech Lorem, 20XX'], work: ['Adipiscing data platform', 'Elit geospatial toolkit'],
    email: 'antariksha@delta-climate.example',
  },
];
