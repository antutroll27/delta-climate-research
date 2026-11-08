/**
 * page-wiring.ts — the DOM side of whole-city streaming's page furniture (city-streaming integration; DEV FLAG ONLY, reached by
 * dynamic import() from heat-map-app.ts `startStream`, so no other build contains it).
 *
 *   manager commands --> city-stream hooks --> createPageFurniture (streaming/area-page.ts, the decisions) --> the loader view, the picker
 *   the picker, the Area select ----------> stream.select --> the manager
 *   a committed area --> header, breadcrumb, Area select, "Explore the area", the address
 *
 * It owns no loading and no geometry. The loader and the picker are the two finished views (loader-view.ts, sheet-index-view.ts); this
 * file mounts them, supplies the DOM writer, and carries the one rule that is about the page rather than the views: a choice made in the
 * Area select is a pick on the index, never a navigation to a page the area does not have.
 */
import { createLoaderView, type LoaderView, type RetryRequest } from './loader-view.ts';
import { mountSheetIndex, type SheetIndexHandle } from './sheet-index-view.ts';
import { createPageFurniture, headerOf, type AreaWriter, type PageFurniture } from '../streaming/area-page.ts';
import { parseAreaNames, type AreaNames } from '../streaming/loader-model.ts';
import { SELECT_SYNC_EVENT } from '../shell/select-field.ts';
import { SHEETS, sheetByCode, sheetKey, sheetOf, type SheetCode } from '../scope/sheets.ts';
import type { CityStream } from './city-stream.ts';
import indexCss from '../../../styles/obos-v2/screens/sheet-index.css?inline';
import wiringCss from './page-wiring.css?inline';

const NAMES_FILE = import.meta.glob('../../../../data/cities/amsterdam/area-names.json', { eager: true, import: 'default' });

/** The area names (area-names.json), parsed once. Without the file every label falls back to the area table's own. */
export const AREA_NAMES: AreaNames = parseAreaNames(Object.values(NAMES_FILE)[0] ?? null);

export interface PageWiring extends PageFurniture {
  /** The building rise now, 0..1 (the renderer's `grow`). */
  riseValue(nowMs: number): number;
  readonly pickerHost: HTMLElement;
  readonly loader: LoaderView;
  readonly picker: SheetIndexHandle;
  dispose(): void;
}

function ensureStyle(doc: Document, id: string, css: string): void {
  if (doc.getElementById(id) !== null) return;
  const el = doc.createElement('style');
  el.id = id;
  el.textContent = css;
  doc.head.appendChild(el);
}

const keyOf = (code: SheetCode): string => sheetKey(sheetByCode(code)!);

/**
 * @param stageEl `.stage`: inside the v2 root, so the plate's and the picker's tokens resolve.
 * @param stream late-bound: the wiring exists before the controller, because the controller's hooks call it.
 */
export function wirePage(stageEl: HTMLElement, stream: () => CityStream): PageWiring {
  const doc = stageEl.ownerDocument;
  ensureStyle(doc, 'si-style', indexCss);
  ensureStyle(doc, 'pw-style', wiringCss);

  const loader = createLoaderView({ host: stageEl, firstEntry: true, onRetry: (r: RetryRequest) => stream().retry(r.sheet, r.level) });
  loader.setAreaNames(AREA_NAMES);

  const pickerHost = doc.createElement('div');
  pickerHost.className = 'si-host';
  pickerHost.setAttribute('data-sheet-index', '');
  (stageEl.querySelector('.st-title') ?? stageEl).appendChild(pickerHost);     // the title card's own column: it flows with the card on a desktop and a phone
  const picker = mountSheetIndex(pickerHost, {
    onSelect: (code) => stream().select(code),
    shiftArrows: pickerHost,       // NOT the document: MapLibre's own Shift + arrow (rotate, pitch) must keep working on the map
    cityName: 'Amsterdam',
  });

  /* The Area select lists every area; a choice there is a pick on the index (the console shell would navigate to a page that does not exist). */
  const areaSelects = [...doc.querySelectorAll<HTMLSelectElement>('select[data-scope="area"]')];
  const optionFor = (select: HTMLSelectElement, key: string): HTMLOptionElement | null => [...select.options].find((o) => o.value === key) ?? null;
  for (const select of areaSelects) {
    for (const row of SHEETS) {
      const key = keyOf(row.code);
      if (optionFor(select, key) !== null) continue;
      const option = doc.createElement('option');
      option.value = key;
      const h = headerOf(row.code, AREA_NAMES);
      option.textContent = `${h.name} · ${h.code}`;
      select.appendChild(option);
    }
  }
  const onAreaSelect = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.dataset.scope !== 'area') return;
    const row = sheetOf(target.value as never);
    if (row === null) return;
    event.stopImmediatePropagation();
    stream().select(row.code);
  };
  doc.addEventListener('change', onAreaSelect, true);

  const writer: AreaWriter = {
    header(h) {
      const pname = doc.getElementById('pname');
      if (pname !== null) {
        pname.textContent = h.name;
        const small = doc.createElement('small');
        small.className = 'obos-area-code';
        small.textContent = h.code;
        pname.appendChild(small);
      }
      const pzone = doc.getElementById('pzone');
      if (pzone !== null) pzone.textContent = h.zone;
      const crumb = doc.getElementById('crumbArea');
      if (crumb !== null) crumb.textContent = h.name;
      const title = doc.querySelector('[data-side-pane="explore"] .sp-head h2');
      if (title !== null) title.textContent = 'Explore the area';
    },
    areaSelect(code) {
      const key = keyOf(code);
      for (const select of areaSelects) if (optionFor(select, key) !== null) select.value = key;
      doc.dispatchEvent(new Event(SELECT_SYNC_EVENT));
    },
    address: (url) => window.history.replaceState(null, '', url),
  };
  const furniture = createPageFurniture({ loader, picker, writer, names: AREA_NAMES, location: () => window.location });

  return {
    ...furniture,
    riseValue: (nowMs) => loader.riseValue(nowMs),
    pickerHost, loader, picker,
    dispose() {
      doc.removeEventListener('change', onAreaSelect, true);
      picker.destroy();
      loader.dispose();
      pickerHost.remove();
    },
  };
}
