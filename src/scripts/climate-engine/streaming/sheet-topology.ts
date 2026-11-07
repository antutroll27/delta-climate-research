/**
 * sheet-topology.ts — the lattice as the sheet manager and the halo solve see it: which cell is which sheet, who
 * touches whom, and where a lon/lat sits. A thin, injectable layer over the generated sheet table; pure, no DOM, no GL.
 *
 * CONVENTIONS (they match scope/sheets.ts and scripts/_sheets.py, and the tests pin them):
 *   · (i, j) is the lattice cell; i grows EAST, j grows NORTH. Column A is i = -4, row 1 is j = 3.
 *   · Sheet (i, j) is the half-open box [lon_edge(i), lon_edge(i+1)) x [lat_edge(j), lat_edge(j+1)) with
 *     lon_edge(k) = LON0 + (k - 1/2) dLon and lat_edge(k) = LAT0 + (k - 1/2) dLat, (LON0, LAT0) = E4's centre.
 *   · A SHIPPING sheet has data. A SKIPPED cell touches the municipality but fails the ship rule; an OUTSIDE cell does not
 *     touch it. Neither is ever requested from the network: `codeAt` answers null for both.
 */
import { AMSTERDAM_SHEET_LATTICE as L } from '../../../data/sheets/amsterdam.ts';
import { SHEETS, SKIPPED_SHEETS, type SheetCode, type SheetRow, type SkippedSheet } from '../scope/sheets.ts';

export type Direction = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

/** North-west first, reading order: the order `neighbours()` in scope/sheets.ts uses. */
export const DIRECTIONS: readonly Direction[] = Object.freeze(['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as const);
/** The four neighbours that share an edge, not just a corner. */
export const EDGE_DIRECTIONS: readonly Direction[] = Object.freeze(['n', 'e', 's', 'w'] as const);

/** [di, dj] of the neighbour in each direction (east and north are positive). */
export const DIRECTION_STEP: Readonly<Record<Direction, readonly [number, number]>> = Object.freeze({
  nw: [-1, 1], n: [0, 1], ne: [1, 1], w: [-1, 0], e: [1, 0], sw: [-1, -1], s: [0, -1], se: [1, -1],
});

const DIRECTION_OF_STEP = new Map<string, Direction>(DIRECTIONS.map((d) => [DIRECTION_STEP[d].join(','), d]));

/** The direction of a unit step, or null for (0, 0) and anything that is not one cell away. */
export function directionOfStep(di: number, dj: number): Direction | null {
  return DIRECTION_OF_STEP.get(`${di},${dj}`) ?? null;
}

export function isEdgeDirection(d: Direction): boolean {
  return d === 'n' || d === 'e' || d === 's' || d === 'w';
}

/** The eight compass sectors of 45 degrees, centred on north = 0, east = 90 (clockwise, as a map bearing). */
const SECTORS: readonly Direction[] = Object.freeze(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const);

/** The compass direction a bearing points at. NaN and non-finite bearings have none. */
export function directionOfHeading(headingDeg: number): Direction | null {
  if (!Number.isFinite(headingDeg)) return null;
  const wrapped = ((headingDeg % 360) + 360) % 360;
  return SECTORS[Math.floor((wrapped + 22.5) / 45) % 8]!;
}

/** The direction and its two flanking sectors, nearest first: the order a heading prefetch tries them. */
export function headingFan(d: Direction): readonly Direction[] {
  const k = SECTORS.indexOf(d);
  return [SECTORS[k]!, SECTORS[(k + 1) % 8]!, SECTORS[(k + 7) % 8]!];
}

export type CellKind = 'ships' | 'skipped' | 'outside';

export interface LatticeCell {
  readonly i: number;
  readonly j: number;
}

export interface SheetTopology {
  /** Shipping sheets, reading order. */
  readonly codes: readonly SheetCode[];
  has(code: string): code is SheetCode;
  cell(code: SheetCode): LatticeCell;
  /** The shipping sheet at a cell, or null for a skipped or outside cell. */
  codeAt(i: number, j: number): SheetCode | null;
  cellKind(i: number, j: number): CellKind;
  /** The shipping sheet next to `code` in `dir`, or null where that cell does not ship. */
  neighbour(code: SheetCode, dir: Direction): SheetCode | null;
  /** Exact count of 3D BAG buildings in the sheet (what the mesh cost scales with). */
  buildings(code: SheetCode): number;
  /** The lattice cell containing the point (half-open boxes: a point on a seam belongs to the east/north cell). */
  locate(lon: number, lat: number): LatticeCell;
  /** Metres from the point to the nearest edge of cell (i, j), in the frame's metres; negative outside the cell. */
  depthInto(i: number, j: number, lon: number, lat: number): number;
}

const LON0 = L.anchor.centre.lon;
const LAT0 = L.anchor.centre.lat;

/** Build a topology over a sheet table. Tests pass a subset to make a cell skipped. */
export function createTopology(
  sheets: readonly SheetRow[] = SHEETS,
  skipped: readonly SkippedSheet[] = SKIPPED_SHEETS,
): SheetTopology {
  const byCode = new Map<string, SheetRow>(sheets.map((s) => [s.code, s]));
  const byCell = new Map<string, SheetRow>(sheets.map((s) => [`${s.i},${s.j}`, s]));
  const skippedCells = new Set<string>(skipped.map((s) => `${s.i},${s.j}`));
  const codes = Object.freeze(sheets.map((s) => s.code));
  return Object.freeze({
    codes,
    has: (code: string): code is SheetCode => byCode.has(code),
    cell: (code: SheetCode): LatticeCell => {
      const row = byCode.get(code);
      if (row === undefined) throw new RangeError(`Not a shipping sheet: ${code}`);
      return { i: row.i, j: row.j };
    },
    codeAt: (i: number, j: number): SheetCode | null => byCell.get(`${i},${j}`)?.code ?? null,
    cellKind: (i: number, j: number): CellKind =>
      byCell.has(`${i},${j}`) ? 'ships' : skippedCells.has(`${i},${j}`) ? 'skipped' : 'outside',
    neighbour: (code: SheetCode, dir: Direction): SheetCode | null => {
      const row = byCode.get(code);
      if (row === undefined) return null;
      const [di, dj] = DIRECTION_STEP[dir];
      return byCell.get(`${row.i + di},${row.j + dj}`)?.code ?? null;
    },
    buildings: (code: SheetCode): number => byCode.get(code)?.buildings ?? 0,
    locate: (lon: number, lat: number): LatticeCell => ({
      i: Math.floor((lon - LON0) / L.dLon + 0.5),
      j: Math.floor((lat - LAT0) / L.dLat + 0.5),
    }),
    depthInto: (i: number, j: number, lon: number, lat: number): number => {
      const west = LON0 + (i - 0.5) * L.dLon, east = LON0 + (i + 0.5) * L.dLon;
      const south = LAT0 + (j - 0.5) * L.dLat, north = LAT0 + (j + 0.5) * L.dLat;
      return Math.min((lon - west) * L.mPerDegLon, (east - lon) * L.mPerDegLon, (lat - south) * L.mPerDegLat, (north - lat) * L.mPerDegLat);
    },
  });
}

export const AMSTERDAM_TOPOLOGY: SheetTopology = createTopology();
