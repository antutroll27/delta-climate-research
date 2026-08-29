/**
 * HOW MUCH ROOM THE CONSOLE'S CHROME IS TAKING — two flags, one storage seam, and
 * the only file that spells either key, either attribute or the values they hold.
 *
 * THE TWO FLAGS ARE THE SAME KIND OF FACT. The rail can show its labels or shrink
 * to the icon strip; the panel beside it can be open or gone. Both are answers to
 * "how much of this screen is navigation and how much is map", both are set by a
 * chevron, and both are a standing preference rather than part of any reading.
 *
 * SEVERAL READERS, WHICH IS WHY THIS IS A MODULE AND NOT SIX STRING LITERALS.
 * shell/IconRail.astro embeds {@link LAYOUT_PREPAINT} in the document, two
 * stylesheets select on the attributes it sets, and shell/console-shell.ts writes
 * both the attributes and the stored values. A key spelled once in the inline
 * script and again in the module that writes it is two keys one edit apart, and
 * the failure is silent: the preference is written where nothing reads it and the
 * console simply forgets.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IN localStorage, AND THIS ONLY LOOKS LIKE IT CONTRADICTS console-shell.ts.
 *
 * That file's PaneState docblock says pane state lives in memory and a reload
 * reopens the default pane, because a URL identifies a READING and which tab the
 * sender happened to have open is not part of it. THAT STANDS, and it is about
 * WHICH pane is showing — Layers versus Reports versus the toolbox. It is a
 * statement about the content of the panel.
 *
 * WHETHER THE PANEL IS THERE AT ALL is a different question and belongs to a
 * different owner. It is not about this ward or this comparison; it is about how
 * this person wants the console laid out, exactly like the rail's width, and it
 * is answered the same way for the same reason: someone who put the panel away
 * wants it away tomorrow. So the identity of the open pane is still deliberately
 * forgotten on reload and the collapse is deliberately remembered — and a reader
 * who reopens the panel after a reload gets the DEFAULT pane back, which is both
 * rules doing exactly what each says.
 *
 * EVERY READ AND WRITE IS WRAPPED, and not defensively-for-the-sake-of-it:
 * `localStorage` is not merely empty in a private window or with site data
 * blocked, it THROWS on property access, before `getItem` is ever reached. So the
 * access itself is inside the try, and the answer to any failure is the default —
 * a console that renders correctly having stored and recalled nothing.
 */

/** Where each preference is kept. Namespaced, because the origin is shared. */
export const RAIL_STATE_KEY = 'obos:rail';
export const PANEL_STATE_KEY = 'obos:panel';

/**
 * The attributes the DOCUMENT ELEMENT carries, which is what the stylesheets read.
 *
 * ON <html>, NOT ON THE ELEMENTS THEMSELVES, and each has its own reason.
 *
 * The RAIL's is a width, and custom properties inherit DOWNWARDS: a width
 * published on the rail could never reach the padding that has to clear it — the
 * paired bench's rail is `position:fixed`, and the bench is padded past it by
 * `calc(var(--rail) + ...)`. Declared at the root, one property answers the rail's
 * own inline-size, the bench's padding and the mobile sheet's offset at once.
 *
 * The PANEL's is a matter of WHEN rather than where. {@link LAYOUT_PREPAINT} runs
 * where the rail is rendered, at the top of the console — the sidebar is not
 * parsed yet, so there is no element to put a class on. The root is the one node
 * that exists before everything the preference applies to.
 */
export const RAIL_STATE_ATTR = 'data-rail';
export const PANEL_STATE_ATTR = 'data-panel';

/** The two values either attribute holds. Absent reads as expanded. */
export const COLLAPSED = 'collapsed';
export const EXPANDED = 'expanded';

/** The chevrons' ids, so the pre-paint script can correct what it can reach. */
export const RAIL_TOGGLE_ID = 'rail-toggle';
export const PANEL_TOGGLE_ID = 'panel-toggle';

/** As much of `Storage` as this module touches. */
export interface LayoutStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The store, or null where there is none to be had.
 *
 * THE ACCESS IS THE THROW. Reading `localStorage` on a document with site data
 * blocked raises a SecurityError at the property itself, so a `typeof` guard
 * outside a try is not a guard at all.
 */
function defaultStore(): LayoutStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * TRUE when the reader has asked for this piece of chrome to be put away.
 * Anything else — nothing stored, an unreadable store, a value written by
 * something that is not this module — is the default, which is EXPANDED.
 *
 * ONE IMPLEMENTATION FOR BOTH FLAGS. The alternative is the same four lines of
 * try/catch twice, and the copy that gets a fix is never both of them.
 */
function readCollapsed(key: string, store: LayoutStore | null): boolean {
  try {
    return store?.getItem(key) === COLLAPSED;
  } catch {
    return false;
  }
}

/** Remember the choice, or fail to and carry on: the console is already painted. */
function writeCollapsed(key: string, collapsed: boolean, store: LayoutStore | null): void {
  try {
    store?.setItem(key, collapsed ? COLLAPSED : EXPANDED);
  } catch {
    /* the preference is a convenience; what is on screen is already correct */
  }
}

/** Whether the rail is showing icons only. */
export function readRailCollapsed(store: LayoutStore | null = defaultStore()): boolean {
  return readCollapsed(RAIL_STATE_KEY, store);
}

/** Whether the panel beside the rail has been put away. */
export function readPanelCollapsed(store: LayoutStore | null = defaultStore()): boolean {
  return readCollapsed(PANEL_STATE_KEY, store);
}

export function writeRailCollapsed(
  collapsed: boolean,
  store: LayoutStore | null = defaultStore(),
): void {
  writeCollapsed(RAIL_STATE_KEY, collapsed, store);
}

export function writePanelCollapsed(
  collapsed: boolean,
  store: LayoutStore | null = defaultStore(),
): void {
  writeCollapsed(PANEL_STATE_KEY, collapsed, store);
}

/**
 * THE SCRIPT THAT RUNS BEFORE THE CONSOLE IS PAINTED, built from the constants
 * above so it cannot spell any of them differently from the module that writes
 * them.
 *
 * WHY IT IS INLINE AND WHY IT IS NOT console-shell.ts. The shell mounts from a
 * module script, which is deferred: by the time it runs the rail has been laid
 * out expanded and the panel has been laid out open, so a reader who put either
 * away would watch it go away again on every single page load — and, because the
 * rail's width is transitioned, watch that one ANIMATE. Restoring a stored layout
 * preference before first paint is the one thing a blocking inline script is for.
 *
 * IT CORRECTS THE RAIL'S CHEVRON TOO. The server has to render one state into
 * `aria-expanded`, and it renders the default; left to the shell's mount, a
 * screen reader arriving at a collapsed rail would be told for that moment that
 * it was expanded. The two names come off the button's own data attributes rather
 * than being spelled here, so the words have one author.
 *
 * IT DOES NOT CORRECT THE PANEL'S. This script sits where the rail is, at the top
 * of the console, and the panel's chevron is inside a sidebar the parser has not
 * reached — and there is nothing to correct anyway: a collapsed panel is
 * `display:none`, so its chevron is not in the accessibility tree to be
 * misreported. The shell sets it on mount, which is before the panel can come
 * back, because the only way back is a rail click.
 */
export const LAYOUT_PREPAINT = `try{
var d=document.documentElement,s=localStorage;
var r=s.getItem(${JSON.stringify(RAIL_STATE_KEY)})===${JSON.stringify(COLLAPSED)};
d.setAttribute(${JSON.stringify(RAIL_STATE_ATTR)},r?${JSON.stringify(COLLAPSED)}:${JSON.stringify(EXPANDED)});
d.setAttribute(${JSON.stringify(PANEL_STATE_ATTR)},s.getItem(${JSON.stringify(PANEL_STATE_KEY)})===${JSON.stringify(COLLAPSED)}?${JSON.stringify(COLLAPSED)}:${JSON.stringify(EXPANDED)});
if(r){var b=document.getElementById(${JSON.stringify(RAIL_TOGGLE_ID)});
if(b){b.setAttribute('aria-expanded','false');
if(b.dataset.labelCollapsed)b.setAttribute('aria-label',b.dataset.labelCollapsed);}}
}catch(e){}`;
