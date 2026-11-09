/**
 * area-page.ts — what the page does when an area opens, and how the loader and the picker are fed (city-streaming integration).
 *
 * PURE: no DOM, no window, no bundler imports, so node tests drive it with fakes (tests/unit/city-stream-page.test.mjs). The DOM side
 * (streaming-host/page-wiring.ts) supplies an `AreaWriter` that writes the real header, breadcrumb, Area select and address bar, and the
 * two finished views; this module is the decision of WHAT they are told, and in which order.
 *
 * THE USER'S WORD IS "AREA". "Sheet" is the code's name for a lattice square and never reaches a screen.
 * THE URL. A streamed area has no page of its own while TILED_CITY_READY is false, so the address stays on Canal Ring's page and the
 * area is the query parameter `area=F4`, written with replaceState (never a navigation). A refresh reads it back with `areaFromUrl`.
 */
import type { ManagerCommand, ManagerState } from './sheet-manager.ts';
import { isVisible, type AreaNames, type LoaderState, type SheetFacts, type TileStage } from './loader-model.ts';
import { indexStateOf, type IndexViewState } from './sheet-index.ts';
import { sheetByCode, type SheetCode } from '../scope/sheets.ts';

/** "F4" from `?area=F4` (any case), when it names an area that ships; otherwise null and the page opens Canal Ring (E4). */
export function areaFromUrl(search: string): SheetCode | null {
  const raw = new URLSearchParams(search).get('area');
  const row = raw === null ? undefined : sheetByCode(raw.toUpperCase());
  return row === undefined ? null : row.code;
}

/** `search` with `area=<code>` set; every other parameter (stream=1, streamtier, look) and its order are kept. */
export function searchWithArea(search: string, code: SheetCode): string {
  const params = new URLSearchParams(search);
  params.set('area', code);
  return `?${params.toString()}`;
}

export interface AreaHeader {
  readonly code: SheetCode;
  /** the area's name (area-names.json; else the area table's label without its code) */
  readonly name: string;
  /** the line under it: "Oost · Area F4" */
  readonly zone: string;
}

export function headerOf(code: SheetCode, names: AreaNames): AreaHeader {
  const n = names[code];
  const row = sheetByCode(code);
  const name = n?.name ?? (row === undefined ? code : row.label.slice(row.label.indexOf(' · ') + 3));
  const stadsdeel = n?.stadsdeel ?? row?.stadsdeel ?? '';
  return { code, name, zone: stadsdeel === '' ? `Area ${code}` : `${stadsdeel} · Area ${code}` };
}

/** Where the open area is written. The page supplies the DOM; a test supplies a recorder. */
export interface AreaWriter {
  header(header: AreaHeader): void;
  /** the Area select (and its visible label) names this area's key */
  areaSelect(code: SheetCode): void;
  /** replaceState target, path + query + hash */
  address(url: string): void;
  /** The cards written for the page's own area (Canal Ring) restate it for the open one (optional: a recorder without it ignores this). */
  surfaces?(code: SheetCode): void;
}

export interface LoaderLike {
  command(command: ManagerCommand): void;
  stage(code: SheetCode, stage: TileStage): void;
  setFacts(code: SheetCode, facts: SheetFacts): void;
  /** The first-entry sweep's points (optional: a loader without it simply draws no survey). */
  setSurvey?(code: SheetCode, points: SurveyPoints): void;
  /** The loader's own state, so the page can ask what is really on screen (optional: without it nothing is known to be visible). */
  state?(): LoaderState;
}

/** Building centroids across the area's box, 0..1 east and north, and each height 0..1 of the tallest: what the first-entry sweep draws. */
export interface SurveyPoints { readonly x: Float32Array; readonly y: Float32Array; readonly h: Float32Array }

/** The ward file's rows are `[height, x0, y0, x1, y1, ...]` in metres east and north of the centre, over a square of side `sizeM`. */
export function surveyOf(ward: { readonly sizeM: number; readonly b: readonly (readonly number[])[] }): SurveyPoints {
  const n = ward.b.length;
  const x = new Float32Array(n), y = new Float32Array(n), h = new Float32Array(n);
  let tallest = 0;
  for (let i = 0; i < n; i++) {
    const row = ward.b[i]!;
    let sx = 0, sy = 0, count = 0;
    for (let k = 1; k + 1 < row.length; k += 2) { sx += row[k]!; sy += row[k + 1]!; count++; }
    x[i] = count === 0 ? 0.5 : Math.min(1, Math.max(0, sx / count / ward.sizeM + 0.5));
    y[i] = count === 0 ? 0.5 : Math.min(1, Math.max(0, sy / count / ward.sizeM + 0.5));
    h[i] = row[0] ?? 0;
    if (h[i]! > tallest) tallest = h[i]!;
  }
  if (tallest > 0) for (let i = 0; i < n; i++) h[i] = h[i]! / tallest;
  return { x, y, h };
}
export interface PickerLike {
  update(state: IndexViewState): void;
  setDrawnCount(code: string, count: number): void;
}

export interface PageFurniture {
  command(command: ManagerCommand): void;
  stage(code: SheetCode, stage: TileStage): void;
  facts(code: SheetCode, facts: { readonly buildings: number; readonly trees?: number; readonly ward?: { readonly sizeM: number; readonly b: readonly (readonly number[])[] } }): void;
  dispatched(state: ManagerState): void;
  /** `code` is now the open area, with `drawn` buildings on screen. */
  areaShown(code: SheetCode, drawn: number): void;
  /** Is the loader for `code` ON SCREEN right now? The view's own answer (a rise is drawn REVEAL_DELAY_MS after the manager's command), not the manager's phase
   *  (INT re-audit R3). False when the loader view cannot say. */
  loaderVisible(code: SheetCode): boolean;
}

export function createPageFurniture(parts: {
  readonly loader: LoaderLike;
  readonly picker: PickerLike;
  readonly writer: AreaWriter;
  readonly names: AreaNames;
  readonly location: () => { readonly pathname: string; readonly search: string; readonly hash: string };
  /** The loader view's clock (default `performance.now`). */
  readonly now?: () => number;
}): PageFurniture {
  const { loader, picker, writer, names } = parts;
  let lastPicker = '';
  /** The area on screen: what the header, the address and the Area select say. */
  let shown: SheetCode | null = null;
  const now = parts.now ?? ((): number => performance.now());
  return {
    loaderVisible(code) {
      const state = loader.state?.();
      return state !== undefined && state.sheet === code && isVisible(state, now());
    },
    command(c) {
      loader.command(c);
      /* A pick that did not open leaves the native Area select naming it. The header, crumb and address were never moved (they are written at a
         commit); the select is put back so all of them agree again (INT audit F7). */
      if (c.type === 'failure' && shown !== null) writer.areaSelect(shown);
    },
    stage: (code, s) => loader.stage(code, s),
    facts(code, f) {
      loader.setFacts(code, { buildings: f.buildings, ...(f.trees === undefined ? {} : { trees: f.trees }) });
      picker.setDrawnCount(code, f.buildings);
      if (f.ward !== undefined) loader.setSurvey?.(code, surveyOf(f.ward));
    },
    dispatched(state) {
      /* The manager's state moves on every camera event (about ten a second); the picker shows three things of it. */
      const key = `${state.current}|${state.displayed}|${state.loader?.sheet ?? ''}|${state.loader?.phase ?? ''}`;
      if (key === lastPicker) return;
      lastPicker = key;
      picker.update(indexStateOf(state));
    },
    areaShown(code, drawn) {
      shown = code;
      writer.header(headerOf(code, names));
      picker.setDrawnCount(code, drawn);
      writer.areaSelect(code);
      writer.surfaces?.(code);
      const loc = parts.location();
      writer.address(`${loc.pathname}${searchWithArea(loc.search, code)}${loc.hash}`);
    },
  };
}
