// Single source of truth for the leadership roster rendered on /team.
export interface Member {
  id: string; // ordinal, '01'..
  first: string;
  last: string;
  tier: string; // role tier, e.g. 'Principal Consultant'
  discipline: string; // focus area
  mono: string; // initials for the cursor card
  cover: 1 | 2 | 3 | 4; // which card gradient
}

export const team: Member[] = [
  { id: '01', first: 'Angad', last: 'Burman', tier: 'Principal Consultant', discipline: 'Climate Risk Analytics', mono: 'AB', cover: 1 },
  { id: '02', first: 'Shirsha', last: 'Sen', tier: 'Principal Consultant', discipline: 'Climate Policy & Regulation', mono: 'SS', cover: 2 },
  { id: '03', first: 'Dhruv', last: 'Maniktala', tier: 'Lead', discipline: 'Operations Research', mono: 'DM', cover: 3 },
  { id: '04', first: 'Antariksha', last: 'Kumar', tier: 'Lead', discipline: 'Technology Implementation', mono: 'AK', cover: 4 },
];
