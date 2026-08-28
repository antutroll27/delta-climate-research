/**
 * THE CONSOLE SHELL — the rail's panes and the scope selects.
 *
 * WHY THIS IS NOT IN heat-map-app.ts. The instrument mounts only where `#mlmap`
 * exists, which is only where artefacts ship. The shell has to work on the pages
 * where it does NOT: `/heat-map/ae/dubai/al-quoz/` renders the rail, the scope
 * switcher and the layer tree around a statement that nothing ships there, and a
 * scope select on that page that could not take you anywhere would be a control
 * that does nothing — the defect this project has already paid for three times.
 * So the navigation shell boots on every area page and the instrument boots on
 * the ones that have something to instrument.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT OWNS
 *
 *   · the sidebar's pane, including collapse
 *   · the three scope selects
 *
 * WHAT IT DOES NOT OWN. The layer checkboxes. Every one of them ends in a call
 * on the renderer, which lives inside `mountHeatMap`'s closure — so they are
 * wired there, beside the thing they move. On a page with no instrument every
 * layer row is disabled (no artefact resolves), so there is nothing there to
 * click either.
 */
import { areaPath } from '../scope/paths.ts';
import { tabKind } from '../scope/reachability.ts';
import { isAreaKey, splitKey, type AreaKey } from '../scope/registry.ts';
import { resolve } from '../scope/resolve.ts';

/**
 * THE EVENT THE SELECT RAISES WHEN THE INSTRUMENT SHOULD SWITCH IN PLACE.
 *
 * The shell decides WHETHER an area can be opened without a page load — that is a
 * scope question, and `tabKind` already answers it — but it cannot DO it: loading
 * a ward means touching the map, the caches and the simulation host, all of which
 * live inside `mountHeatMap`'s closure and none of which should be exported for
 * one caller. So the shell states the intention and the instrument, when there is
 * one, answers it.
 *
 * Dispatched on `document` rather than on the stage element, because the listener
 * is registered by a module that already owns `document`-level listeners and
 * cleans them up on dispose.
 */
export const OPEN_AREA_EVENT = 'obos:open-area';

/** The payload of {@link OPEN_AREA_EVENT}: an area key already through `isAreaKey`. */
export interface OpenAreaDetail {
  readonly key: AreaKey;
}

/**
 * Where the sidebar's pane state lives: HERE, in memory, for as long as the page
 * is open. NOT in the URL, and this is a decision rather than an oversight.
 *
 * A URL identifies a READING — this area, this ward, these interventions — and it
 * is the thing someone sends to a colleague or cites in a deck. Which sidebar tab
 * the sender happened to have open is not part of that reading, and putting it in
 * the address bar would make two links to the same evidence look like two
 * different links. It would also mean a `history` entry per pane click, so Back
 * would walk the sidebar instead of leaving the page.
 *
 * The cost is that a reload reopens the default pane. That is the right trade for
 * a control whose whole job is a keystroke away.
 */
type PaneState = { open: boolean; id: string };

/**
 * Mount the shell over server-rendered markup. Returns a disposer, or null when
 * this page has no console on it.
 *
 * The disposer matters because the site runs Astro's ClientRouter: an area page
 * can be swapped in and out without a full load, and a listener left on a removed
 * element is a leak that also fires against the wrong document.
 */
export function mountConsoleShell(): (() => void) | null {
  const stage = document.querySelector<HTMLElement>('.stage[data-area]');
  if (!stage) return null;

  const declared = stage.getAttribute('data-area');
  /* THE SAME REFUSAL heat-map-app.ts's `bootArea` makes, and for the same reason:
     an unrecognised area is an authoring fault, and falling back to a default
     would open one place while the page names another — silently. */
  if (!isAreaKey(declared)) {
    throw new Error(`console-shell: the stage declares data-area="${declared}", which is not a registered area`);
  }
  const here: AreaKey = declared;

  const cleanup: Array<() => void> = [];
  const on = (node: EventTarget | null, ev: string, fn: EventListener): void => {
    if (!node) return;
    node.addEventListener(ev, fn);
    cleanup.push(() => node.removeEventListener(ev, fn));
  };

  /* ── the sidebar's panes ─────────────────────────────────────────────────── */

  const sidebar = document.querySelector<HTMLElement>('.sidebar');
  const panes = [...document.querySelectorAll<HTMLElement>('.pane[data-pane]')];
  const railButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-rail]')];

  /* THE SERVER'S RENDER IS THE INITIAL STATE, read back rather than restated. A
     literal 'map' here would be a second copy of the pane HeatMapStage.astro
     renders open, free to disagree with it the first time either moves. */
  const opened = panes.find((p) => p.classList.contains('is-on'))?.dataset.pane;
  const state: PaneState = { open: opened !== undefined, id: opened ?? '' };

  function paint(): void {
    for (const pane of panes) {
      pane.classList.toggle('is-on', state.open && pane.dataset.pane === state.id);
    }
    sidebar?.classList.toggle('is-collapsed', !state.open);
    for (const button of railButtons) {
      /* Only the sections that OWN a pane carry the attribute; the server decided
         which those are, and re-deciding it here would be a second copy of the
         rail's own table. `hasAttribute` reads that decision back. */
      if (!button.hasAttribute('aria-pressed')) continue;
      button.setAttribute('aria-pressed', String(state.open && button.dataset.rail === state.id));
    }
  }

  for (const button of railButtons) {
    const id = button.dataset.rail;
    /* A rail button with no pane behind it is the CURRENT ROUTE rendered as a
       button because there is nowhere to navigate — Analysis on the compare page.
       Binding a pane swap to it would open a body that does not exist. */
    if (id === undefined || !panes.some((p) => p.dataset.pane === id)) continue;
    on(button, 'click', () => {
      /* CLICKING THE OPEN PANE COLLAPSES THE SIDEBAR — the behaviour every reader
         already has from VS Code, and the only way to give the map the whole
         width without a second control that would have to say "hide sidebar". */
      if (state.open && state.id === id) state.open = false;
      else { state.open = true; state.id = id; }
      paint();
    });
  }

  paint();

  /* ── the three scope selects ─────────────────────────────────────────────── */

  /**
   * One handler for all three levels, because Task 4 made every option's value an
   * AREA KEY at every level — Country, City and Area alike. There is nothing left
   * for a per-level branch to decide: the value read off any of the three is
   * already the thing `areaPath` and `loadWard` take.
   */
  for (const select of document.querySelectorAll<HTMLSelectElement>('select[data-scope]')) {
    on(select, 'change', () => {
      const value = select.value;
      /* `isAreaKey`, never a cast. The value is a string off the DOM — an option
         list the registry built today, an autofilled value, a devtools poke — and
         a key that resolves to nothing must be refused here rather than become a
         fetch for a file that does not exist. */
      if (!isAreaKey(value) || value === here) return;

      /* SWITCH IN PLACE ONLY WITHIN ONE CITY, and only when both ends ship data.
         The second half is `tabKind`'s rule, unchanged and not restated: something
         here has to be listening and something there has to be loadable. The first
         half is the instrument's own assumption made explicit — its ward table,
         its climate constants and its currency are city and country facts, and it
         rebuilds sibling keys from THIS page's country/city prefix. Crossing
         either is a different page, so it is a navigation.

         TWO FLAGS OFF TWO DIFFERENT KEYS, spelled out rather than shortened. This
         decision moved here from the stage's tab strip, and the defect it carries
         a scar from is a call that passed ONE flag twice: branch on the page's and
         a non-shipping target becomes an in-place switch that `loadWard` refuses
         in silence; branch on the target's and a shipping target becomes an
         in-place switch on a page with no instrument mounted at all. `here` and
         `value` are visibly different arguments, which is the property the
         tripwire in tests/unit/obos-scope.test.mjs reads. */
      const from = splitKey(here);
      const to = splitKey(value);
      const sameCity = from.country === to.country && from.city === to.city;
      const inPlace = sameCity && tabKind({
        pageShipsData: resolve(here).area.hasData,
        tabShipsData: resolve(value).area.hasData,
      }) === 'switch';

      if (inPlace) {
        document.dispatchEvent(new CustomEvent<OpenAreaDetail>(OPEN_AREA_EVENT, {
          detail: { key: value },
        }));
        return;
      }
      /* `areaPath`, not a string built here. It is the one place a per-area URL is
         spelled, and a second spelling is how a link starts pointing at a
         directory the build never prerendered. */
      window.location.assign(areaPath(value));
    });
  }

  return () => { for (const off of cleanup.splice(0)) off(); };
}
