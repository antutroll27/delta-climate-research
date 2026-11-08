/**
 * The sheet index: the data model behind whole-city streaming's "which part of the city am I in".
 *
 * A SHEET is Canal Ring's own lon/lat box (2.8 km in the shared frame), repeated across the city on one graticule
 * lattice. Canal Ring is sheet E4 and keeps its id `canal-ring`; E4's box IS Canal Ring's, bit for bit, and every
 * sheet's frame uses E4's latitude as its standard parallel, so seams are shared meridians and parallels. RD New is
 * the ingest CRS only (`rdQuad` is informational). The table is generated (scripts/_sheets.py -> data/cities/amsterdam/sheets.json and
 * src/data/sheets/amsterdam.ts); this module is the pure reader. NO THREE.JS, no DOM, no registry mutation, so
 * node can test all of it.
 *
 * PHASE P1 DRAWS NOTHING. The sheets are registered as non-drawable areas (registry.ts), and the per-city area
 * lists (`areaKeysInCity`) leave them out, so TitleCard, MethodsCards, MapStack, the switcher, prefetch and the
 * paired comparison all see exactly what they saw before. `sheetIndex()` below is the model the later index
 * plate and bottom sheet (phase P5) will draw from; nothing imports it yet.
 *
 * THE BUILDING COUNTS ARE EXACT (phase P2a): `buildings` = every 3D BAG building whose centroid is in the sheet's half-open
 * box; `municipalBuildings` = those also inside the municipality, the number the ship rule reads. They count the buildings
 * of the source, not the rows a sheet will emit after the ingest's own sliver drop.
 */
import { AMSTERDAM_SHEETS, AMSTERDAM_SKIPPED_SHEETS, AMSTERDAM_SHEET_LATTICE } from '../../../data/sheets/amsterdam.ts';
import { AREA_KEYS, splitKey, type AreaKey } from './registry.ts';

export type SheetRow = (typeof AMSTERDAM_SHEETS)[number];
export type SheetCode = SheetRow['code'];
export type SheetKind = SheetRow['kind'];
/** The area id a sheet answers to: `ams-f4`, or `canal-ring` for E4. */
export type SheetAreaId = SheetRow['id'];
export type SkippedSheet = (typeof AMSTERDAM_SKIPPED_SHEETS)[number];

/** What a cell of the index map is. `outside` = the lattice cell does not touch the municipality at all. */
export type SheetCellState = SheetKind | 'skipped' | 'outside';

const L = AMSTERDAM_SHEET_LATTICE;

/** Cities that are tiled, by city slug. One entry today. Not a flag that turns streaming on: that is phase P4. */
const TILED_CITY = 'amsterdam';
const COUNTRY = 'nl';

export const SHEETS: readonly SheetRow[] = Object.freeze([...AMSTERDAM_SHEETS]);
export const SKIPPED_SHEETS: readonly SkippedSheet[] = Object.freeze([...AMSTERDAM_SKIPPED_SHEETS]);

const BY_CODE = new Map<string, SheetRow>(SHEETS.map((s) => [s.code, s]));
const BY_CELL = new Map<string, SheetRow>(SHEETS.map((s) => [`${s.i},${s.j}`, s]));
const BY_AREA_ID = new Map<string, SheetRow>(SHEETS.map((s) => [s.id, s]));
const SKIPPED_BY_CELL = new Map<string, SkippedSheet>(SKIPPED_SHEETS.map((s) => [`${s.i},${s.j}`, s]));

/** (i, j) -> "F4", or null outside the A-J x 1-7 index. The twin of `code_of` in scripts/_sheets.py. */
export function codeOf(i: number, j: number): string | null {
  const col = i - L.iOfColumnA;
  const row = L.jOfRow1 - j + 1;
  if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
  if (col < 0 || col >= L.columns.length || row < 1 || row > L.rows) return null;
  return `${L.columns[col]}${row}`;
}

/** "F4" -> [i, j], or null when it is not a sheet code. The exact inverse of `codeOf`. */
export function cellOf(code: string): readonly [number, number] | null {
  if (!/^[A-J][1-7]$/.test(code)) return null;
  return [L.columns.indexOf(code[0]!) + L.iOfColumnA, L.jOfRow1 - (Number(code[1]) - 1)];
}

export function sheetByCode(code: string): SheetRow | undefined {
  return BY_CODE.get(code);
}

export function sheetByAreaId(areaId: string): SheetRow | undefined {
  return BY_AREA_ID.get(areaId);
}

/** The registry key of a shipping sheet: `nl/amsterdam/ams-f4`, or `nl/amsterdam/canal-ring` for E4. */
export function sheetKey(sheet: SheetRow): AreaKey {
  return `${COUNTRY}/${TILED_CITY}/${sheet.id}` as AreaKey;
}

/** The sheet an area key is, or null for any area that is not part of a tiling (Kolkata, Bengaluru, Dubai...). */
export function sheetOf(key: AreaKey): SheetRow | null {
  const { country, city, area } = splitKey(key);
  if (country !== COUNTRY || city !== TILED_CITY) return null;
  return BY_AREA_ID.get(area) ?? null;
}

/** Does this key's city have a sheet table? The question "should a list render the index map instead of rows". */
export function isTiledCity(key: AreaKey): boolean {
  const { country, city } = splitKey(key);
  return country === COUNTRY && city === TILED_CITY;
}

/** Every shipping sheet of the key's city, as registry keys, in reading order (E4 included). Empty when not tiled. */
export function sheetKeysInCity(key: AreaKey): readonly AreaKey[] {
  return isTiledCity(key) ? SHEETS.map(sheetKey) : [];
}

/** The up-to-eight neighbouring SHIPPING sheets, north-west first, reading order. Absent where a cell does not ship. */
export function neighbours(code: string): readonly SheetRow[] {
  const cell = cellOf(code);
  if (cell === null) return [];
  const [i, j] = cell;
  const out: SheetRow[] = [];
  for (let dj = 1; dj >= -1; dj--) {
    for (let di = -1; di <= 1; di++) {
      if (di === 0 && dj === 0) continue;
      const sheet = BY_CELL.get(`${i + di},${j + dj}`);
      if (sheet !== undefined) out.push(sheet);
    }
  }
  return out;
}

/**
 * A sheet's frame origin, in the shape `wardLatLon`, `wardBbox` and `wardMercatorScale` read: its centre, and the ONE
 * standard parallel every sheet shares (E4's latitude). Two sheets' frames differ by an exact translation of
 * (2800 di, 2800 dj) metres; `tests/unit/frame-lat-default.test.mjs` proves it at the seams.
 */
export function sheetFrameOrigin(sheet: SheetRow): { readonly lat: number; readonly lon: number; readonly frameLat: number } {
  return { lat: sheet.centre.lat, lon: sheet.centre.lon, frameLat: L.frameLat };
}

export interface SheetIndexCell {
  /** "F4" */
  readonly code: string;
  readonly i: number;
  readonly j: number;
  /** 0-based position on the printed index: column A = 0, row 1 = 0 */
  readonly col: number;
  readonly row: number;
  readonly state: SheetCellState;
  /** null unless the cell ships */
  readonly areaId: SheetAreaId | null;
  readonly key: AreaKey | null;
  /** "F4 · Oost"; null unless the cell ships */
  readonly label: string | null;
  readonly kind: SheetKind | null;
  /** exact: 3D BAG buildings with their centroid in the sheet's box */
  readonly buildings: number;
  /** exact: the same, also inside the municipality (what the ship rule reads) */
  readonly municipalBuildings: number;
  readonly municipalShare: number;
  readonly current: boolean;
  /** one of the eight shipping neighbours of the current sheet */
  readonly neighbour: boolean;
}

export interface SheetIndex {
  readonly columns: string;
  readonly rows: number;
  /** all 70 lattice cells, in reading order: row 1 first, column A to J */
  readonly cells: readonly SheetIndexCell[];
  readonly current: SheetRow | null;
  readonly counts: { readonly core: number; readonly edge: number; readonly skipped: number; readonly shipping: number };
}

/**
 * The model of the index map for the city `from` belongs to, with `from`'s sheet marked current.
 * Null for a city with no sheets, so a caller needs no city test of its own.
 */
export function sheetIndex(from: AreaKey): SheetIndex | null {
  if (!isTiledCity(from)) return null;
  const current = sheetOf(from);
  const near = new Set<string>(current === null ? [] : neighbours(current.code).map((s) => s.code));
  const cells: SheetIndexCell[] = [];
  for (let row = 0; row < L.rows; row++) {
    for (let col = 0; col < L.columns.length; col++) {
      const i = col + L.iOfColumnA;
      const j = L.jOfRow1 - row;
      const code = codeOf(i, j)!;
      const sheet = BY_CELL.get(`${i},${j}`);
      const skipped = SKIPPED_BY_CELL.get(`${i},${j}`);
      cells.push(Object.freeze({
        code, i, j, col, row,
        state: sheet?.kind ?? (skipped !== undefined ? 'skipped' : 'outside'),
        areaId: sheet?.id ?? null,
        key: sheet === undefined ? null : sheetKey(sheet),
        label: sheet?.label ?? null,
        kind: sheet?.kind ?? null,
        buildings: sheet?.buildings ?? skipped?.buildings ?? 0,
        municipalBuildings: sheet?.municipalBuildings ?? skipped?.municipalBuildings ?? 0,
        municipalShare: sheet?.municipalShare ?? skipped?.municipalShare ?? 0,
        current: current !== null && current.code === code,
        neighbour: near.has(code),
      }) as SheetIndexCell);
    }
  }
  const core = SHEETS.filter((s) => s.kind === 'core').length;
  return Object.freeze({
    columns: L.columns, rows: L.rows, cells: Object.freeze(cells), current,
    counts: Object.freeze({ core, edge: SHEETS.length - core, skipped: SKIPPED_SHEETS.length, shipping: SHEETS.length }),
  });
}

/** Every registered sheet-flagged key, from the registry itself (not from this table): what the drift test compares. */
export function registeredSheetKeys(): readonly AreaKey[] {
  return AREA_KEYS.filter((k) => splitKey(k).city === TILED_CITY && BY_AREA_ID.has(splitKey(k).area));
}
