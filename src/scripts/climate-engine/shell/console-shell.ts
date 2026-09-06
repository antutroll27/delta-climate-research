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
 * WHAT IT OWNS, AND THE TWO HALVES ARE NOT THE SAME SHAPE
 *
 *   · the sidebar's pane, including collapse — on EVERY page with a console,
 *     found by `[data-console]`. Explore and Compare both have one.
 *   · the rail's own collapse — likewise on every page with a console, and
 *     likewise portable: shell/layout-state.ts holds both flags and this only moves
 *     it between the button, the document element and localStorage.
 *   · the three scope selects — only on a page scoped to ONE area, which is a
 *     page with a `.stage` carrying a valid `data-area`. Compare is scoped to a
 *     PAIR, renders no scope switcher, and skips this half entirely.
 *
 * Splitting them is what let Compare have working panes. Keyed on
 * `.stage[data-area]`, the whole function returned null there — so the rail's
 * Layers, Reports and Scenarios were buttons with no handler and nothing behind
 * them, which is this project's most-deleted defect on its only navigation.
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
import {
  COLLAPSED,
  EXPANDED,
  PANEL_STATE_ATTR,
  RAIL_STATE_ATTR,
  readPanelCollapsed,
  readRailCollapsed,
  writePanelCollapsed,
  writeRailCollapsed,
} from './layout-state.ts';
import { resolve } from '../scope/resolve.ts';
import { mountSelectFields } from './select-field.ts';

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
  /* THE CONSOLE, NOT THE STAGE. Two routes render a rail and a sidebar now — the
     Explore stage and the paired bench — and only one of them is a page scoped to
     a single area. Keyed on `.stage[data-area]` the pane half simply did not run
     on Compare, which left Layers, Reports and Scenarios as buttons with nothing
     behind them. `[data-console]` is the mark a page puts on itself to say it has
     a rail and panes; it is the only thing the portable half needs to know. */
  const consoleRoot = document.querySelector<HTMLElement>('[data-console]');
  if (!consoleRoot) return null;

  /* THE SCOPE HALF'S PAGE, RESOLVED AND VALIDATED BEFORE A SINGLE LISTENER IS
     BOUND. The refusal below throws, and a throw halfway through wiring would
     leave the panes listening with no disposer ever returned to unwire them.

     GATED ON `.stage`, NOT ON `.stage[data-area]`, and that is stricter than what
     it replaces rather than looser. The old selector treated a stage that had LOST
     its data-area as "no console here" and returned null in silence; now such a
     stage is found and refused out loud. Compare has no stage at all, so it skips
     the scope half entirely — it is not scoped to one area, and there is nothing
     here to make optional. */
  const stage = document.querySelector<HTMLElement>('.stage');
  /* THE SAME REFUSAL heat-map-app.ts's `bootArea` makes, and for the same reason:
     an unrecognised area is an authoring fault, and falling back to a default
     would open one place while the page names another — silently. */
  let pageArea: AreaKey | null = null;
  if (stage) {
    const declared = stage.getAttribute('data-area');
    if (!isAreaKey(declared)) {
      throw new Error(`console-shell: the stage declares data-area="${declared}", which is not a registered area`);
    }
    pageArea = declared;
  }

  const cleanup: Array<() => void> = [];
  const on = (node: EventTarget | null, ev: string, fn: EventListener): void => {
    if (!node) return;
    node.addEventListener(ev, fn);
    cleanup.push(() => node.removeEventListener(ev, fn));
  };

  /* ── the sidebar's panes ─────────────────────────────────────────────────── */

  /* SCOPED TO THE CONSOLE, not to the document. Two routes carry these class
     names now, and a query over the whole document would be one page swap away
     from painting the other route's panes. */
  const sidebar = consoleRoot.querySelector<HTMLElement>('.sidebar');
  const panes = [...consoleRoot.querySelectorAll<HTMLElement>('.pane[data-pane]')];
  const railButtons = [...consoleRoot.querySelectorAll<HTMLButtonElement>('button[data-rail]')];
  /* THE PANEL'S OWN CHEVRON. Declared with the rest of the console's furniture
     rather than beside its handler, because `paint` below reads it. */
  const panelToggle = consoleRoot.querySelector<HTMLButtonElement>('button[data-panel-toggle]');

  /* THE SERVER'S RENDER IS THE INITIAL STATE, read back rather than restated. A
     literal 'map' here would be a second copy of the pane HeatMapStage.astro
     renders open, free to disagree with it the first time either moves. */
  const opened = panes.find((p) => p.classList.contains('is-on'))?.dataset.pane;

  /* THE PANE THE SERVER OPENED, AND WHETHER THE READER WANTS THE COLUMN AT ALL.
     Two facts with two different lifetimes, and layout-state.ts writes down why:
     WHICH pane is deliberately forgotten on reload, because it is not part of the
     reading a URL identifies; WHETHER the column is there is a standing
     preference like the rail's width. So `id` comes off the server's render and
     `open` comes off the store — a reader who put the panel away gets it away,
     and gets the DEFAULT pane back when they bring it out with a rail click. */
  const state: PaneState = {
    open: opened !== undefined && !readPanelCollapsed(),
    id: opened ?? '',
  };

  /**
   * THE ONE PLACE THE PANEL IS OPENED OR CLOSED. Two controls reach it — the
   * chevron on the panel's own heading row, and a click on the rail section whose
   * pane is already showing — and neither has any state of its own. That is the
   * difference between two doors to one room and the duplicated control this
   * project keeps deleting: nothing here can diverge, because there is only one
   * `state.open` and only one function that paints it.
   */
  function paint(): void {
    for (const pane of panes) {
      pane.classList.toggle('is-on', state.open && pane.dataset.pane === state.id);
    }
    /* BOTH SPELLINGS OF THE SAME FACT, WRITTEN TOGETHER SO THEY CANNOT DISAGREE.
       The class is the element's own state and is what both stylesheets and the
       browser guards read. The attribute on <html> exists for ONE reason: the
       pre-paint script has to apply this preference before the sidebar has been
       parsed, so there is no element to put a class on yet. Splitting them across
       two functions is how the column would end up hidden by one and shown by the
       other. */
    sidebar?.classList.toggle('is-collapsed', !state.open);
    document.documentElement.setAttribute(
      PANEL_STATE_ATTR, state.open ? EXPANDED : COLLAPSED);
    /* WHICH pane, for the map's legend: its solar block sits above the colour key
       on the Solar screen and below it elsewhere (2026-09-06). Read by
       heat-map-app.ts through a MutationObserver; written nowhere else. NOT
       `data-pane`: that is the panes' own attribute, and a root carrying it made
       every `[data-pane="analysis"]` selector resolve to two elements. */
    document.documentElement.setAttribute('data-open-pane', state.open ? state.id : '');
    if (panelToggle) {
      panelToggle.setAttribute('aria-expanded', String(state.open));
      const name = state.open
        ? panelToggle.dataset.labelExpanded
        : panelToggle.dataset.labelCollapsed;
      if (name !== undefined) panelToggle.setAttribute('aria-label', name);
    }
    /* REMEMBERED HERE, for the same reason it is painted here: one writer. The
       call at mount rewrites the value it just read, which is idempotent, and is
       cheaper than a second code path whose only job is to know whether this call
       was the first one. */
    writePanelCollapsed(!state.open);
    for (const button of railButtons) {
      /* Only the sections that OWN a pane carry the attribute; the server decided
         which those are, and re-deciding it here would be a second copy of the
         rail's own table. `hasAttribute` reads that decision back. */
      if (!button.hasAttribute('aria-pressed')) continue;
      button.setAttribute('aria-pressed', String(state.open && button.dataset.rail === state.id));
    }
  }

  /* THE SECOND DOOR. It only ever closes: the way back is a rail click, which
     already reopens the panel with that section's body in it. A re-open control
     here would be a second affordance for something the navigation beside it
     already does, and it could not be reached anyway — a collapsed panel is
     `display:none`, and this button is inside it. */
  on(panelToggle, 'click', () => {
    state.open = false;
    paint();
  });

  for (const button of railButtons) {
    const id = button.dataset.rail;
    /* A rail button with no pane behind it on THIS route: Map on the compare page
       renders as a link, but a future section could be a button with its body
       elsewhere. Binding a pane swap to it would open a body that is not in the
       document. The rail already decided this — `aria-pressed` is written only
       where its body is rendered here — and the `panes` check reads that decision
       back off the DOM rather than restating the rail's table. */
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

  /* ── the rail's collapse ─────────────────────────────────────────────────── */

  /* PORTABLE, LIKE THE PANES. Both routes render the rail, and the fact this
     moves — whether the navigation is showing its labels — is a fact about the
     document rather than about the area anything is scoped to.

     THE ATTRIBUTE GOES ON <html>, NOT ON THE RAIL, and layout-state.ts says why:
     the paired bench clears the rail with `calc(var(--rail) + …)` from ABOVE it
     in the tree, and custom properties only inherit downwards. The stylesheet
     reads that attribute; nothing here measures or sets a width.

     ALREADY APPLIED BY THE TIME WE GET HERE, by the pre-paint script the rail
     embeds — this is a module script, so it runs long after first paint. Doing it
     AGAIN rather than trusting that is deliberate: an Astro ClientRouter swap
     copies the incoming document's <html> attributes over the current ones, and
     this attribute is in no document the server wrote. */
  const railToggle = consoleRoot.querySelector<HTMLButtonElement>('button[data-rail-toggle]');
  if (railToggle) {
    /* THE NAMES COME OFF THE BUTTON. IconRail.astro renders both; spelling them
       here as well would be the same two sentences in two files, and the one that
       drifted would be the one nobody can see. */
    const applyRail = (collapsed: boolean): void => {
      document.documentElement.setAttribute(
        RAIL_STATE_ATTR, collapsed ? COLLAPSED : EXPANDED);
      railToggle.setAttribute('aria-expanded', String(!collapsed));
      const name = collapsed
        ? railToggle.dataset.labelCollapsed
        : railToggle.dataset.labelExpanded;
      if (name !== undefined) railToggle.setAttribute('aria-label', name);
    };

    /* THE DOCUMENT IS THE STATE; THE STORE IS ONLY THE MEMORY OF IT. The click
       handler asks the attribute what the rail is doing, not localStorage — and
       the difference is a one-way chevron. Where storage is unavailable every
       read comes back "expanded", so a handler that toggled the STORED value
       would collapse the rail on the first press and then collapse it again on
       every press after, with nothing on screen able to say otherwise. */
    const collapsedNow = (): boolean =>
      document.documentElement.getAttribute(RAIL_STATE_ATTR) === COLLAPSED;

    applyRail(readRailCollapsed());
    on(railToggle, 'click', () => {
      const next = !collapsedNow();
      writeRailCollapsed(next);
      applyRail(next);
    });
  }

  /* ── the dropdowns ───────────────────────────────────────────────────────── */

  /* PORTABLE, LIKE THE PANES ABOVE AND UNLIKE THE SCOPE HALF BELOW. A select
     field is a control, not a scope: it knows how to open, how to be driven by a
     keyboard and how to refuse a row that cannot be chosen, and none of that is a
     question about which area this page is. Compare renders no scope switcher and
     so has no fields today — `mountSelectFields` finds none and returns a
     disposer that undoes nothing, which is the correct answer rather than a
     special case to write.

     BEFORE THE SCOPE HALF, so the trigger is showing the right words even on a
     page the scope half refuses to wire. */
  cleanup.push(mountSelectFields(consoleRoot));

  /* ── the three scope selects ─────────────────────────────────────────────── */

  /**
   * ONLY ON A PAGE THAT IS SCOPED TO ONE AREA. Every line below reads `here` — the
   * country and city it belongs to, whether it ships data, the sibling it would
   * switch to in place. Compare is scoped to a PAIR and renders no scope switcher,
   * so there is nothing here to run and nothing to make optional; its A/B selects
   * are its scope control and paired-controller.ts owns them.
   *
   * One handler for all three levels, because Task 4 made every option's value an
   * AREA KEY at every level — Country, City and Area alike. There is nothing left
   * for a per-level branch to decide: the value read off any of the three is
   * already the thing `areaPath` and `loadWard` take.
   */
  if (pageArea !== null) {
    /**
     * WHERE THE INSTRUMENT IS STANDING **NOW**, re-read on every change.
     *
     * THIS WAS A CONSTANT AND THE CONSTANT WAS A BUG. It captured the area at
     * mount, and an in-place switch does not remount anything — so after moving
     * away from the area the page loaded with, `value === here` matched THAT area
     * for the rest of the session and refused to go back to it. Silently: the
     * dropdown took the new value, the map stayed put, and nothing said why.
     * Measured over six hops, the boot area was refused every single time and
     * every other area switched fine.
     *
     * `resolve(here).area.hasData` two branches down was stale for the same
     * reason, and that one does not announce itself at all in Kolkata, where all
     * three areas ship data. On a city with mixed coverage it would have routed
     * an in-place-versus-navigate decision from a fact about a ward the reader
     * left several clicks ago.
     *
     * THE ATTRIBUTE IS THE SEAM, and heat-map-app.ts's `updateStageArea` keeps it
     * current for exactly this reader. Re-reading is what makes this handler
     * correct across a switch; the mount-time validation above still stands, and
     * is what guarantees this cannot start from a bad value.
     */
    const currentArea = (): AreaKey | null => {
      const declared = document.querySelector('.stage')?.getAttribute('data-area');
      return isAreaKey(declared) ? declared : null;
    };

    for (const select of consoleRoot.querySelectorAll<HTMLSelectElement>('select[data-scope]')) {
      on(select, 'change', () => {
        const value = select.value;
        /* NULL MEANS "WE NO LONGER KNOW WHERE WE ARE", which is a different case
           from any this handler used to have. Only our own `updateStageArea`
           writes this attribute, so a value that fails `isAreaKey` means something
           outside this module rewrote it. Every in-place decision below is
           relative to `here`, so without one there is no honest way to make them --
           and the answer is NOT to refuse, which would be one more control that
           does nothing. A navigation always lands correctly and resynchronises the
           whole page, so an unknown origin degrades to the slower path rather than
           to no path. */
        const here = currentArea();
        if (here === null) {
          if (isAreaKey(value)) window.location.assign(areaPath(value));
          return;
        }
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
  }

  return () => { for (const off of cleanup.splice(0)) off(); };
}
