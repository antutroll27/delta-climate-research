/**
 * sheet-index.ts: the model behind the sheet index UI (phase P5). Pure: no DOM, no clock, no three.js, so node tests all of it.
 *
 * WHAT IT IS. The index plate (desktop) and the bottom sheet (phone) draw the same thing: the whole A-J x 1-7 lattice as a
 * grid, every cell either a SHIPPING sheet (core or edge: selectable), a SKIPPED cell (touches the municipality, fails the
 * ship rule: shown, dimmed, never selectable) or OUTSIDE (does not touch it: empty). Everything here is DERIVED from the
 * generated sheet table (`SHEETS`, `SKIPPED_SHEETS`, the lattice), so a change in how many sheets ship needs no code change.
 *
 * WHERE THE NAMES COME FROM. An area's visible name is, in order: (1) `data/cities/amsterdam/area-names.json`, the wijk
 * (neighbourhood) the area is mostly in, written by scripts/build-area-names.py from the City of Amsterdam's Kernregistratie
 * gebieden (CC0 1.0); (2) the text after "CODE · " in the sheet table's own `label` (the stadsdeel, or "Canal Ring" for E4);
 * (3) the row's `stadsdeel`; (4) the code. A skipped cell carries no name and is named by its code. Grouping (phone list,
 * ScopeSwitcher) is by the table row's `stadsdeel`, never by the display name, so E4 groups under Centrum.
 *
 * THE MANAGER CONTRACT. The UI emits the manager's `select` event: `{ type: 'select', atMs, sheet: <code> }` (see
 * `selectEventOf`), and reads the manager's state through `indexStateOf` (current sheet and the sheet being loaded). It never
 * talks to the renderer. Skipped and outside cells are never emitted; `activate` and `keyAction` are the only paths from input
 * to a `select`, and both refuse anything that is not `available` (tests/unit/sheet-index.test.mjs holds that for every cell).
 *
 * KEYBOARD (the rules `keyAction` implements):
 *   Shift + arrow   move to the adjacent SHIPPING sheet in that direction, passing over skipped and outside cells; if there is
 *                   none the answer is `miss` and nothing moves. Selects.
 *   Arrow           roving focus to the next cell that touches the municipality (shipping or skipped; skipped cells are
 *                   focusable so a screen reader can find them, and say "not available"). Focus only.
 *   Home / End      the first / last such cell of the row.
 *   Enter / Space   activate the focused cell: select if shipping, refuse if skipped.
 */
import { AMSTERDAM_SHEET_LATTICE } from '../../../data/sheets/amsterdam.ts';
import { SHEETS, SKIPPED_SHEETS } from '../scope/sheets.ts';
import type { ManagerEvent, ManagerState } from './sheet-manager.ts';

// ── the table, structurally: only the columns this UI reads, so a wider generated row still fits ─────────────

export interface IndexLattice {
  readonly columns: string;
  readonly rows: number;
  readonly iOfColumnA: number;
  readonly jOfRow1: number;
}
export interface ShippingRowInput {
  readonly id: string;
  readonly code: string;
  readonly i: number;
  readonly j: number;
  readonly kind: 'core' | 'edge';
  readonly stadsdeel: string;
  readonly label: string;
}
export interface SkippedRowInput {
  readonly code: string;
  readonly i: number;
  readonly j: number;
  readonly reason: string;
}
/** One entry of area-names.json: only what the UI reads. */
export interface AreaNameEntry {
  readonly name: string;
  readonly stadsdeel: string;
}
/** Optional inputs the table does not carry. Absent = the table's own labels. */
export interface IndexExtras {
  readonly names?: ReadonlyMap<string, AreaNameEntry> | null;
  /** drawn building counts by area code (`parseDrawnCounts`). Absent = no count is shown. */
  readonly drawn?: ReadonlyMap<string, number> | null;
}

/** area-names.json, read defensively: an entry without a non-empty string name is skipped, anything else yields an empty map. */
export function parseAreaNames(doc: unknown): ReadonlyMap<string, AreaNameEntry> {
  const out = new Map<string, AreaNameEntry>();
  if (typeof doc !== 'object' || doc === null) return out;
  const areas = (doc as { areas?: unknown }).areas;
  if (typeof areas !== 'object' || areas === null) return out;
  for (const [code, e] of Object.entries(areas)) {
    if (typeof e !== 'object' || e === null) continue;
    const { name, stadsdeel } = e as { name?: unknown; stadsdeel?: unknown };
    if (typeof name === 'string' && name.trim() !== '') out.set(code, { name: name.trim(), stadsdeel: typeof stadsdeel === 'string' ? stadsdeel : '' });
  }
  return out;
}

/**
 * The DRAWN building count per area from the build record (`data/cities/amsterdam/sheets-build.json`), read by field name:
 * `sheets[].code` and `sheets[].buildings`. An entry whose count is not a non-negative integer is skipped, and anything that is
 * not that shape yields an empty map, so a missing or malformed file shows no counts rather than the wrong ones.
 */
export function parseDrawnCounts(doc: unknown): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  if (typeof doc !== 'object' || doc === null) return out;
  const sheets = (doc as { sheets?: unknown }).sheets;
  if (!Array.isArray(sheets)) return out;
  for (const e of sheets) {
    if (typeof e !== 'object' || e === null) continue;
    const { code, buildings } = e as { code?: unknown; buildings?: unknown };
    if (typeof code === 'string' && typeof buildings === 'number' && Number.isInteger(buildings) && buildings >= 0) out.set(code, buildings);
  }
  return out;
}

export interface IndexTables {
  readonly lattice: IndexLattice;
  readonly sheets: readonly ShippingRowInput[];
  readonly skipped: readonly SkippedRowInput[];
}

/** The committed table. A test (or a harness) can pass its own `IndexTables` to `buildIndexModel`. */
export const AMSTERDAM_INDEX_TABLES: IndexTables = Object.freeze({
  lattice: AMSTERDAM_SHEET_LATTICE,
  sheets: SHEETS,
  skipped: SKIPPED_SHEETS,
});

// ── the model ─────────────────────────────────────────────────────────────────────────────────────────────────

export type CellState = 'core' | 'edge' | 'skipped' | 'outside';

export interface IndexCell {
  /** "F4" */
  readonly code: string;
  readonly i: number;
  readonly j: number;
  /** 0-based position on the printed index: column A = 0, row 1 = 0 (north) */
  readonly col: number;
  readonly row: number;
  readonly state: CellState;
  /** shipping = selectable. Skipped and outside cells are never available. */
  readonly available: boolean;
  /** the area id a `select` lands on (`ams-f4`, `canal-ring`); null unless shipping */
  readonly areaId: string | null;
  /** the visible name: see the header. Equals `code` for a cell with no name. */
  readonly name: string;
  readonly stadsdeel: string | null;
  /** the buildings DRAWN for this area: the build record's count (`drawnCounts`), or null when it is not known. Never the lattice
   *  count, which includes slivers the loader drops (E4: 21,348 in the lattice, 21,342 drawn). */
  readonly buildings: number | null;
  /** why a skipped cell does not ship, in words; null otherwise */
  readonly reason: string | null;
}

export interface SheetGroup {
  readonly stadsdeel: string;
  /** shipping cells only, reading order */
  readonly cells: readonly IndexCell[];
}

export interface IndexModel {
  readonly columns: string;
  readonly rowCount: number;
  /** every lattice cell, reading order: row 1 first, column A to J */
  readonly cells: readonly IndexCell[];
  readonly byCode: ReadonlyMap<string, IndexCell>;
  /** the shipping cells, reading order */
  readonly shipping: readonly IndexCell[];
  readonly groups: readonly SheetGroup[];
  readonly counts: { readonly core: number; readonly edge: number; readonly skipped: number; readonly shipping: number };
}

const NUMBER = new Intl.NumberFormat('en-GB');
export const formatCount = (n: number): string => NUMBER.format(n);

/** "under-500-buildings" -> "under 500 municipal buildings"; any other reason is de-dashed, so a new rule still reads. */
export function reasonText(reason: string): string {
  const m = /^under-(\d+)-buildings$/.exec(reason);
  if (m !== null) return `under ${formatCount(Number(m[1]))} municipal buildings`;
  const p = /^under-(\d+)-percent-municipal$/.exec(reason);
  if (p !== null) return `under ${p[1]}% municipal land`;
  return reason.replace(/-/g, ' ');
}

/** The text after "CODE · " in a table label, or null when the label has none. */
function labelName(code: string, label: string): string | null {
  const prefix = `${code} · `;
  if (!label.startsWith(prefix)) return null;
  const rest = label.slice(prefix.length).trim();
  return rest === '' ? null : rest;
}

export function buildIndexModel(tables: IndexTables = AMSTERDAM_INDEX_TABLES, extras: IndexExtras = {}): IndexModel {
  const names = extras.names ?? null;
  const drawn = extras.drawn ?? null;
  const { lattice: L } = tables;
  const ships = new Map(tables.sheets.map((s) => [`${s.i},${s.j}`, s]));
  const skips = new Map(tables.skipped.map((s) => [`${s.i},${s.j}`, s]));
  const cells: IndexCell[] = [];
  for (let row = 0; row < L.rows; row++) {
    for (let col = 0; col < L.columns.length; col++) {
      const i = col + L.iOfColumnA;
      const j = L.jOfRow1 - row;
      const code = `${L.columns[col]}${row + 1}`;
      const ship = ships.get(`${i},${j}`);
      const skip = skips.get(`${i},${j}`);
      if (ship !== undefined) {
        cells.push(Object.freeze({
          code, i, j, col, row, state: ship.kind, available: true, areaId: ship.id,
          name: names?.get(ship.code)?.name ?? labelName(ship.code, ship.label) ?? (ship.stadsdeel !== '' ? ship.stadsdeel : code),
          stadsdeel: ship.stadsdeel, buildings: drawn?.get(ship.code) ?? null, reason: null,
        }));
      } else if (skip !== undefined) {
        cells.push(Object.freeze({
          code, i, j, col, row, state: 'skipped', available: false, areaId: null, name: code,
          stadsdeel: null, buildings: null, reason: reasonText(skip.reason),
        }));
      } else {
        cells.push(Object.freeze({
          code, i, j, col, row, state: 'outside', available: false, areaId: null, name: code,
          stadsdeel: null, buildings: null, reason: null,
        }));
      }
    }
  }
  const shipping = cells.filter((c) => c.available);
  const core = shipping.filter((c) => c.state === 'core').length;
  return Object.freeze({
    columns: L.columns, rowCount: L.rows,
    cells: Object.freeze(cells),
    byCode: new Map(cells.map((c) => [c.code, c])),
    shipping: Object.freeze(shipping),
    groups: groupByStadsdeel(shipping),
    counts: Object.freeze({ core, edge: shipping.length - core, skipped: cells.filter((c) => c.state === 'skipped').length, shipping: shipping.length }),
  });
}

/** The same model with these drawn counts laid over its own (a loaded bundle knows what it drew; E4 is not in the build record). */
export function withDrawnCounts(model: IndexModel, counts: ReadonlyMap<string, number>): IndexModel {
  const cells = model.cells.map((c) => {
    const n = counts.get(c.code);
    return c.available && n !== undefined && n !== c.buildings ? Object.freeze({ ...c, buildings: n }) : c;
  });
  const shipping = cells.filter((c) => c.available);
  return Object.freeze({
    ...model,
    cells: Object.freeze(cells),
    byCode: new Map(cells.map((c) => [c.code, c])),
    shipping: Object.freeze(shipping),
    groups: groupByStadsdeel(shipping),
  });
}

/** Shipping cells grouped by stadsdeel: groups alphabetical (Dutch collation), cells in reading order inside each. */
export function groupByStadsdeel(shipping: readonly IndexCell[]): readonly SheetGroup[] {
  const by = new Map<string, IndexCell[]>();
  for (const c of shipping) {
    if (!c.available) continue;
    const key = c.stadsdeel !== null && c.stadsdeel !== '' ? c.stadsdeel : c.name;
    const list = by.get(key);
    if (list === undefined) by.set(key, [c]); else list.push(c);
  }
  return Object.freeze([...by.keys()].sort((a, b) => a.localeCompare(b, 'nl')).map((stadsdeel) => {
    const cells = by.get(stadsdeel)!;
    return Object.freeze({ stadsdeel, cells: Object.freeze(cells) });
  }));
}

/** The one gate between input and a `select`: the cell if it ships, else null. */
export function selectable(model: IndexModel, code: string | null): IndexCell | null {
  if (code === null) return null;
  const cell = model.byCode.get(code);
  return cell !== undefined && cell.available ? cell : null;
}

// ── navigation ────────────────────────────────────────────────────────────────────────────────────────────────

export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
/** [dCol, dRow]: row 1 is NORTH, so Up is row - 1. */
const ARROW_STEP: Readonly<Record<Arrow, readonly [number, number]>> = Object.freeze({
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
});
export const isArrow = (key: string): key is Arrow => key in ARROW_STEP;

const shipsPred = (c: IndexCell): boolean => c.available;
const touchesPred = (c: IndexCell): boolean => c.state !== 'outside';

/**
 * The first cell in the arrow's direction, along the SAME row or column, that satisfies `accept`; null when the lattice edge
 * comes first. Cells that do not satisfy it (skipped, outside) are passed over, which is what "jump to the next shipping one"
 * means. A diagonal is never searched.
 */
export function stepFrom(model: IndexModel, code: string, arrow: Arrow, accept: (c: IndexCell) => boolean = shipsPred): IndexCell | null {
  const from = model.byCode.get(code);
  if (from === undefined) return null;
  const [dc, dr] = ARROW_STEP[arrow];
  for (let col = from.col + dc, row = from.row + dr; col >= 0 && col < model.columns.length && row >= 0 && row < model.rowCount; col += dc, row += dr) {
    const c = model.cells[row * model.columns.length + col]!;
    if (accept(c)) return c;
  }
  return null;
}

/** Home / End: the first or last cell of the row that touches the municipality. */
export function rowEnd(model: IndexModel, code: string, end: 'start' | 'end'): IndexCell | null {
  const from = model.byCode.get(code);
  if (from === undefined) return null;
  const n = model.columns.length;
  const row = model.cells.slice(from.row * n, (from.row + 1) * n).filter(touchesPred);
  return (end === 'start' ? row[0] : row[row.length - 1]) ?? null;
}

export interface KeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}
export type KeyAction =
  | { readonly type: 'none' }
  /** roving focus only */
  | { readonly type: 'focus'; readonly code: string }
  /** emit `select` for this (shipping) sheet */
  | { readonly type: 'select'; readonly code: string }
  /** Shift + arrow with no shipping sheet that way: nothing moves */
  | { readonly type: 'miss'; readonly from: string; readonly arrow: Arrow }
  /** Enter on a cell that does not ship */
  | { readonly type: 'refuse'; readonly code: string };

const NONE: KeyAction = Object.freeze({ type: 'none' });

/** Enter / click on a cell. `select` only for a shipping cell. */
export function activate(model: IndexModel, code: string): KeyAction {
  const cell = selectable(model, code);
  if (cell !== null) return { type: 'select', code: cell.code };
  return model.byCode.has(code) ? { type: 'refuse', code } : NONE;
}

/**
 * What one key press means. `from` is where the press starts: the focused cell when focus is inside the plate, otherwise the
 * current sheet (the global Shift + arrow case). Pure, so the whole table of cases is unit-tested.
 */
export function keyAction(model: IndexModel, from: string | null, e: KeyInput): KeyAction {
  if (e.ctrlKey || e.altKey || e.metaKey || from === null || !model.byCode.has(from)) return NONE;
  if (isArrow(e.key)) {
    if (e.shiftKey) {
      const to = stepFrom(model, from, e.key, shipsPred);
      return to === null ? { type: 'miss', from, arrow: e.key } : { type: 'select', code: to.code };
    }
    const to = stepFrom(model, from, e.key, touchesPred);
    return to === null ? NONE : { type: 'focus', code: to.code };
  }
  if (e.shiftKey) return NONE;
  if (e.key === 'Home' || e.key === 'End') {
    const to = rowEnd(model, from, e.key === 'Home' ? 'start' : 'end');
    return to === null ? NONE : { type: 'focus', code: to.code };
  }
  if (e.key === 'Enter' || e.key === ' ') return activate(model, from);
  return NONE;
}

// ── words ─────────────────────────────────────────────────────────────────────────────────────────────────────

const DIRECTION_WORD: Readonly<Record<Arrow, string>> = Object.freeze({ ArrowLeft: 'west', ArrowRight: 'east', ArrowUp: 'north', ArrowDown: 'south' });

/** ", 21,342 buildings", or nothing when the drawn count is not known: a count we cannot vouch for is left out, never guessed. */
export function countPhrase(c: IndexCell): string {
  return c.buildings === null ? '' : `, ${formatCount(c.buildings)} buildings`;
}

/** The accessible name of a cell: carries the DRAWN building count when it is known. */
export function cellLabel(c: IndexCell, current: string | null = null): string {
  if (c.state === 'outside') return `${c.code}, outside the city`;
  if (c.state === 'skipped') return `${c.code}, not available, ${c.reason ?? 'no data'}`;
  const kind = c.state === 'core' ? 'core area' : 'edge area';
  const here = current === c.code ? ', current area' : '';
  const name = c.name === c.code ? '' : `, ${c.name}`;
  return `${c.code}${name}, ${kind}${countPhrase(c)}${here}`;
}

/** The two lines the plate prints on hover and focus. */
export function cellReadout(c: IndexCell): { readonly title: string; readonly detail: string } {
  if (c.state === 'outside') return { title: c.code, detail: 'Outside the city' };
  if (c.state === 'skipped') return { title: `${c.code} · not available`, detail: c.reason ?? 'no data' };
  const kind = c.state === 'core' ? 'Core area' : 'Edge area';
  return { title: c.name === c.code ? c.code : `${c.code} · ${c.name}`, detail: c.buildings === null ? kind : `${formatCount(c.buildings)} buildings · ${kind}` };
}

/** The live-region text for a sheet becoming current. */
export function announceCurrent(c: IndexCell): string {
  return `Current area ${c.code}${c.name === c.code ? '' : `, ${c.name}`}.${c.buildings === null ? '' : ` ${formatCount(c.buildings)} buildings.`}`;
}
export function announceLoading(c: IndexCell): string {
  return `Loading area ${c.code}${c.name === c.code ? '' : `, ${c.name}`}.`;
}
export function announceMiss(from: string, arrow: Arrow): string {
  return `No area to the ${DIRECTION_WORD[arrow]} of ${from}.`;
}
export function announceRefusal(c: IndexCell): string {
  return `${c.code} is not available: ${c.reason ?? 'no data'}.`;
}

// ── the manager seam ──────────────────────────────────────────────────────────────────────────────────────────

/** The event the UI hands to `manager.dispatch`. */
export function selectEventOf(code: string, atMs: number): Extract<ManagerEvent, { type: 'select' }> {
  return { type: 'select', atMs, sheet: code };
}

export interface IndexViewState {
  /** the sheet the user is on (the manager's `current`), or null before `start` */
  readonly current: string | null;
  /** a sheet whose loader is up and that is not yet the displayed one, or null */
  readonly pending: string | null;
}

/** What the UI reads from the manager after every dispatch. */
export function indexStateOf(s: Pick<ManagerState, 'current' | 'displayed' | 'loader'>): IndexViewState {
  const loading = s.loader !== null && s.loader.sheet !== s.displayed ? s.loader.sheet : null;
  return { current: s.current, pending: loading };
}
