// src/scripts/climate-engine/v2/weather-v2.ts — OBOS v2 spec §4.5. Owner: Track B (plan S7.2 Step 6; A1 moves bindWeather here from shell-v2.ts).
/**
 * THE WEATHER SCREEN'S BINDER. The app (heat-map-app.ts paintWeatherLine, E5) publishes the observation it just painted on `obos:observed`;
 * this writes the card's [data-wx] nodes from it and mirrors the app's own readouts. It computes no weather: the words come from the parsed
 * report (weather-panel.ts), the numbers from the app's nodes.
 * THE SOURCE RULE: the chip and the solid/outlined mark come from `weatherSource()`, i.e. from whether the app is holding a fresh airport report.
 */
import { decodeRows, rainMemory, wardTime, weatherSource } from './weather-panel.ts';
import { describeWeather, METAR_STALE_MIN, type ObservedNow } from '../../../lib/weather/observed.ts';
import type { Metar } from '../../../lib/weather/metar.ts';
import { METAR_STATIONS } from '../../../data/metar-stations.ts';
import { resolve as resolveScope } from '../scope/resolve.ts';
import { isAreaKey, splitKey } from '../scope/registry.ts';
import { $, $$, observe, on } from './dom.ts';
import type { ShellCtx } from './shell-ctx.ts';

const textOf = (id: string): string => document.getElementById(id)?.textContent?.trim() ?? '';

/**
 * THE SELECTED ROOF'S ROW (B-S6 audit F6). The app selects a building from a ranked row but marks no row; the preview inverts the selected one.
 * This watches the card's own id (#bcId, "#3736") and its hidden state and sets aria-selected on the matching #solList row (and false on the rest).
 * v2-only and read-only on the app's nodes: no app edit. It lives here because weather-v2.ts is Track B's one binder module (A1 §2.1: shell-v2.ts is frozen);
 * bindWeather calls it, and S8 may re-home it.
 */
export function bindSolarRows(ctx: ShellCtx): void {
  const { cleanup } = ctx;
  const sync = (): void => {
    const card = document.getElementById('bcard');
    const id = card && !card.hasAttribute('hidden') ? /^#(\d+)$/.exec(textOf('bcId'))?.[1] ?? null : null;
    for (const tr of document.querySelectorAll<HTMLElement>('#solList tr[data-idx]')) tr.setAttribute('aria-selected', String(id !== null && tr.dataset.idx === id));
  };
  observe(cleanup, document.getElementById('bcId'), { childList: true, characterData: true, subtree: true }, sync);
  observe(cleanup, document.getElementById('bcard'), { attributes: true, attributeFilter: ['hidden'] }, sync);
  observe(cleanup, document.getElementById('solList'), { childList: true }, sync);
  sync();
  /* THE SHEET OPENS AT ITS TOP (B-S6 audit F1). The app focuses #spClose, the last control, the moment it un-hides the sheet, and the browser scrolls a tall sheet
     to it. Focus stays on Close (reachable in the sticky button row, keyboard behaviour unchanged); only the scroll offset is put back, after the app's own call has run. */
  const sheet = document.getElementById('solPay');
  observe(cleanup, sheet, { attributes: true, attributeFilter: ['hidden'] }, () => { if (sheet && !sheet.hasAttribute('hidden')) sheet.scrollTop = 0; });
}

/**
 * THE WARD BRIEF LINK (B-S7 audit F1). A bare /heat-map/brief/ opens the default Kolkata pair. The app already writes the right query (the ward, the toolbox
 * and the phase) on the rail's Compare link and updates it on every switch and slider change, so this mirrors that href with /brief/ for /compare/.
 */
export function bindBriefLink(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  const cmp = document.querySelector<HTMLAnchorElement>('a[data-rail="analysis"]');
  const sync = (): void => {
    const b = $<HTMLAnchorElement>(root, '[data-v2-brief]');
    if (b && cmp?.getAttribute('href')) b.href = cmp.href.replace('/heat-map/compare/', '/heat-map/brief/');
  };
  observe(cleanup, cmp, { attributes: true, attributeFilter: ['href'] }, sync);
  sync();
}

export function bindWeather(ctx: ShellCtx): void {
  const { root, cleanup } = ctx;
  /* TODO(request b-01): bindSolarRows and bindBriefLink belong in a Track-B-owned solar-v2.ts called from mountShellV2; until the integrator wires it, bindWeather carries them. */
  bindSolarRows(ctx);
  bindBriefLink(ctx);
  const set = (k: string, v: string): void => { for (const e of $$<HTMLElement>(root, `[data-wx="${k}"]`)) e.textContent = v; };
  const setKind = (e: HTMLElement | null, kind: 'measured' | 'modelled', text: string): void => {
    if (!e) return;
    e.className = `kind ${kind}`;
    e.textContent = text;
  };
  /** the app's own nodes, copied: the readings are the app's, v2 only places them */
  const mirror = (): void => {
    for (const e of $$<HTMLElement>(root, '[data-wx-mirror]')) e.textContent = textOf(e.dataset.wxMirror ?? '') || '—';
    for (const e of $$<HTMLElement>(root, '[data-wx-mirror-html]')) {
      const src = document.getElementById(e.dataset.wxMirrorHtml ?? '');
      e.innerHTML = src && !src.hidden ? src.innerHTML : '';
      e.hidden = e.innerHTML.trim() === '';
    }
    /* the surface readout, minus its ± band (v2 hides #lst .band: the one ± lives on the temperature card) */
    const lst = document.getElementById('lst');
    if (lst) {
      const c = lst.cloneNode(true) as HTMLElement;
      c.querySelectorAll('.band').forEach((b) => b.remove());
      for (const e of $$<HTMLElement>(root, '[data-wx-mirror-lst]')) e.textContent = c.textContent?.trim() || '—';
    }
  };
  const setSource = (src: ReturnType<typeof weatherSource>): void => {
    setKind($(root, '[data-wx="chip"]'), src.solid ? 'measured' : 'modelled', src.chip);
    for (const e of $$<HTMLElement>(root, '[data-wx-src]')) e.hidden = (e.dataset.wxSrc === 'observed') !== src.solid;
    const rc = $(root, '[data-wx="rain-chip"]');
    if (rc) { setKind(rc, 'measured', src.solid ? 'observed' : ''); rc.hidden = !src.solid; }
  };

  on(cleanup, document, 'obos:observed', (ev) => {
    const { observed, reports } = (ev as CustomEvent<{ observed: ObservedNow | null; reports: readonly Metar[] }>).detail;
    const area = root.dataset.area ?? '';
    const tz = isAreaKey(area) ? resolveScope(area).city.tz : 'UTC';
    /* the app sets #liveT before it paints this line, so a held reading is already readable here */
    const hasReading = !['', '—'].includes(textOf('liveT'));
    const src = weatherSource(observed !== null, hasReading);
    setSource(src);
    queueMicrotask(mirror);
    set('t', hasReading ? textOf('liveT') : '—');
    const filed = $<HTMLDetailsElement>(root, '[data-wx="filed"]');
    if (!observed) {
      const has = isAreaKey(area) && (METAR_STATIONS[splitKey(area).city]?.length ?? 0) > 0;
      const why = has ? `No airport report in the last ${METAR_STALE_MIN} minutes.` : 'No airport reports held for this city.';
      set('where', src.kind === 'forecast' ? 'Met Norway forecast' : 'No reading');
      set('when', why);
      set('tfoot', '');
      for (const k of ['dew', 'wdir', 'qnh', 'raw']) set(k, '');
      for (const k of ['sky', 'vis']) set(k, '—');
      if (filed) { filed.hidden = true; filed.open = false; }
      $(root, '[data-wx="decode"]')?.replaceChildren();
      $(root, '[data-wx="rain-cells"]')?.replaceChildren();
      set('rain-h', 'Rain memory');
      set('rain-sum', why);
      return;
    }
    const m = observed.latest;
    set('where', `${observed.station.name}, ${Math.round(observed.km)} km from the ward`);
    set('when', `Report of ${wardTime(m.time, tz)}`);
    set('tfoot', 'Whole degrees, as the report carries them.');
    /* the app fills a missing dew point or wind from Met Norway (humidity, wind m/s): say so rather than leave them under the OBSERVED chip unmarked */
    set('dew', m.dewC === null ? 'from the Met Norway forecast' : `from a ${m.dewC} °C dew point`);
    set('wdir', !m.wind ? 'from the Met Norway forecast' : m.wind.dirDeg === null ? '' : `from ${String(m.wind.dirDeg).padStart(3, '0')}°`);
    set('sky', describeWeather(observed).text);
    set('vis', m.cavok ? '10 km or more' : m.visibilityM === null ? '—' : `${m.visibilityM.toLocaleString('en-GB')} m`);
    set('qnh', m.qnhHpa === null ? '' : `pressure ${m.qnhHpa} hPa`);
    set('raw', m.raw);
    if (filed) filed.hidden = false;
    $(root, '[data-wx="decode"]')?.replaceChildren(...decodeRows(m, tz).map((r) => {
      const li = document.createElement('li'); const c = document.createElement('code'); c.textContent = r.code;
      const s = document.createElement('span'); s.textContent = r.text; li.append(c, s); return li;
    }));
    const rm = rainMemory(reports, tz);
    set('rain-h', rm.since ? `Rain memory · reports since ${rm.since}` : 'Rain memory');
    set('rain-sum', rm.cells.length === 0 ? 'No reports held.' : rm.wetCount === 0 ? `No rain in any report since ${rm.since}` : `Rain in ${rm.wetCount} of ${rm.cells.length} reports`);
    $(root, '[data-wx="rain-cells"]')?.replaceChildren(...rm.cells.map((c) => {
      const li = document.createElement('li'); li.className = c.wet ? 'wet' : 'dry';
      const t = document.createElement('span'); t.className = 't'; t.textContent = c.tempC === null ? '—' : String(c.tempC);
      const sup = document.createElement('sup'); sup.textContent = '°'; t.append(sup);
      const ring = document.createElement('span'); ring.className = 'ring'; ring.setAttribute('aria-hidden', 'true');
      const h = document.createElement('span'); h.className = 'h'; h.textContent = c.time.replace(' IST', '');
      li.append(t, ring, h);
      li.setAttribute('aria-label', `${c.time}: ${c.tempC ?? 'no'} °C, ${c.wet ? 'rain or drizzle' : 'no rain'}`);
      return li;
    }));
  });
  for (const id of ['liveT', 'liveFeel', 'liveRH', 'liveWind', 'wxLine', 'lst', 'lstPhase']) {
    observe(cleanup, document.getElementById(id), { childList: true, characterData: true, subtree: true }, mirror);
  }
  mirror();
}
