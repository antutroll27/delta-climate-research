/**
 * THE SELECT FIELD — our own dropdown, drawn over a real <select>.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DECISION THIS FILE IS
 *
 * There are two ways to stop a control looking like the operating system. You can
 * keep the native <select> and style the closed state — which changes nothing,
 * because the part that looks like the OS is the POPUP, and no stylesheet reaches
 * it. Or you draw the popup yourself, and then every keyboard and screen-reader
 * behaviour the platform was giving away has to be written by hand.
 *
 * So the popup is ours. What is NOT ours is the VALUE: the <select> stays in the
 * document, keeps every <option>, keeps `disabled` on the ones that cannot be
 * chosen, and remains the thing that holds the answer and raises `change`. It is
 * not decoration and it is not a fallback — it is the model, and the list below is
 * a rendering of it.
 *
 * WHY THAT SPLIT RATHER THAN A CLEAN LISTBOX WITH NO SELECT. Three reasons, and
 * the first is the one that decided it:
 *
 *   · THE ROWS CANNOT DRIFT FROM THE OPTIONS, because they are BUILT FROM THEM,
 *     on every open. There is no second list to keep in step — the classic way a
 *     control like this starts showing a row that no longer exists, or hiding one
 *     that does. This repo has thirteen guards that turned out to be comparing a
 *     value against a copy of itself; the way not to write the fourteenth is not
 *     to make the copy.
 *   · THE SEAM DOES NOT MOVE. shell/console-shell.ts reads `select.value` off
 *     `select[data-scope]` and heat-map-app.ts's `updateScopeSwitcher` writes back
 *     into it. Both keep working, because the element they hold is still a
 *     <select> and still raises `change`.
 *   · `disabled` ON AN <option> STAYS THE SOURCE OF "cannot be chosen". Dubai's
 *     areas are listed and refused on purpose — the gap between its tier and
 *     Kolkata's is the thing we are asking to be funded to close — and that fact
 *     lives in the registry, reaches the markup as one attribute, and is read back
 *     here rather than restated.
 *
 * THE SELECT IS aria-hidden AND OUT OF THE TAB ORDER, so there is exactly ONE
 * control in the accessibility tree rather than two over one fact. The trigger
 * carries `role="combobox"` and is named by the SAME <label> the select is, so the
 * two spellings of the field's name cannot drift either.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE KEYBOARD DOES, AND WHERE IT DEPARTS FROM NATIVE ON PURPOSE
 *
 * Closed: ArrowDown/ArrowUp/Enter/Space/Home/End open the list, and so does
 * typing. NOTHING COMMITS WHILE CLOSED — a native <select> moves its value on a
 * bare arrow press, and here a value change is a NAVIGATION: it swaps the map or
 * loads a page. A keystroke that moves the map before the reader has seen the list
 * is the "did something nobody asked for" half of the defect this console keeps
 * paying for, so the first press opens and shows.
 *
 * Open: Arrow keys, Home/End and PageUp/PageDown move the ACTIVE row;
 * `aria-activedescendant` is what announces it, so focus never leaves the trigger
 * and "focus returns to the trigger on close" is true by construction rather than
 * by a restore that can be forgotten. Enter commits. Space commits unless a
 * type-ahead is in flight, in which case it is a character. Escape closes and
 * changes nothing. Tab closes and changes nothing and lets focus move on — again
 * because committing here is a navigation, and tabbing PAST a control must not
 * take the reader off the page.
 *
 * TYPE-AHEAD IS NOT OPTIONAL. It is how anyone reaches the eleventh of thirty rows
 * without pressing Down eleven times, and it is the first thing a hand-rolled
 * listbox drops. Repeating one character cycles the rows starting with it, exactly
 * as the platform control does; anything longer is a prefix match.
 *
 * A DISABLED ROW IS ARROWED ONTO AND ANNOUNCED, AND REFUSES TO COMMIT. That is a
 * deliberate departure from the native control, which skips disabled options in
 * silence. On a page where every area is disabled — which is every page of a city
 * at the geometry tier — skipping them leaves a list nobody can move through and a
 * reason nobody ever hears. Being told "Al Quoz, no data yet, dimmed" is the whole
 * point of listing it.
 */

/**
 * TOLD, NOT POLLED: the event that says a <select> was rewritten in script.
 *
 * Assigning `select.value` raises nothing — that is the DOM's rule, not an
 * oversight — so a writer that moves the value has to say so, or the trigger goes
 * on showing the row the page was opened at while the map shows another. That is
 * the wrong-record failure this console has already shipped twice, one control
 * over, and it is invisible until someone reads the two labels side by side.
 *
 * NOT `change`, and this is the point of having a second name: `change` is the
 * READER's event, and console-shell.ts answers it by navigating. A projection that
 * re-announced the ward as a change would ask the shell to travel to where it
 * already is.
 */
export const SELECT_SYNC_EVENT = 'obos:select-sync';

/**
 * One row, as the caller states it.
 *
 * DECLARED HERE RATHER THAN IN THE COMPONENT, so the thing that renders the rows
 * and the thing that authors them are typed by ONE declaration. `note` is a
 * separate field rather than words folded into `text` for the same reason: the
 * reason and the name are two facts, the list shows them differently, and a
 * caller that concatenated them would have written a string this file could never
 * take apart again.
 */
export interface SelectFieldOption {
  readonly value: string;
  readonly text: string;
  /** true when the option exists but cannot be chosen */
  readonly disabled?: boolean;
  /** why it cannot be chosen — shown on the row AND on the collapsed control */
  readonly note?: string;
}

/** How long a type-ahead buffer survives a pause, in ms — the platform's own. */
const TYPEAHEAD_MS = 600;

/** How far PageUp/PageDown jump. APG's suggestion, and the platform's habit. */
const PAGE_ROWS = 10;

interface Field {
  readonly root: HTMLElement;
  readonly trigger: HTMLElement;
  readonly list: HTMLElement;
  readonly store: HTMLSelectElement;
  readonly valueText: HTMLElement;
  readonly valueNote: HTMLElement;
  /** the rows currently rendered — rebuilt from `store` on every open */
  rows: HTMLElement[];
  /** index into `rows` of the active row, or -1 while the list is closed */
  active: number;
  buffer: string;
  bufferAt: number;
}

const isOpen = (f: Field): boolean => f.trigger.getAttribute('aria-expanded') === 'true';

/** The text a row shows and type-ahead matches on — the option's own, trimmed. */
const optionText = (o: HTMLOptionElement): string => (o.textContent ?? '').trim();

/**
 * Put the selected option's words on the trigger.
 *
 * READ OFF THE SELECT EVERY TIME, never remembered. The trigger holds no copy of
 * the value between paints, so there is nothing here that can be right at mount
 * and wrong afterwards.
 */
function paintValue(f: Field): void {
  const option = f.store.selectedOptions[0] ?? null;
  f.valueText.textContent = option ? optionText(option) : '';
  const note = option?.dataset.note ?? '';
  f.valueNote.textContent = note;
  f.valueNote.hidden = note === '';
}

/**
 * Render the list from the <select>, discarding whatever was there.
 *
 * ON EVERY OPEN, not once at mount, and that is not an oversight — it is the
 * reason there is no second list to keep in step. `updateScopeSwitcher` rewrites
 * the SELECTED OPTION'S VALUE on every ward change (see its header for why), so a
 * list built once at mount would hand back the key the page was opened at for the
 * rest of the session. Rebuilding means the rows state what the options say at the
 * moment they are shown, which is the only moment anybody reads them.
 */
function buildRows(f: Field): void {
  const listId = f.list.id;
  const rows: HTMLElement[] = [];
  f.list.replaceChildren();
  for (const option of [...f.store.options]) {
    const row = document.createElement('li');
    row.id = `${listId}-o${rows.length}`;
    row.className = 'field-option';
    row.setAttribute('role', 'option');
    row.dataset.value = option.value;
    row.setAttribute('aria-selected', String(option.selected));
    /* `aria-disabled`, NOT `disabled` — there is no such attribute on a listbox
       row, and a row that vanished from the keyboard's reach would take its
       reason with it. It is refused at commit instead; see `commit`. */
    if (option.disabled) row.setAttribute('aria-disabled', 'true');
    if (option.selected) row.classList.add('is-selected');

    const text = document.createElement('span');
    text.className = 'field-option-text';
    text.textContent = optionText(option);
    row.append(text);

    /* THE REASON TRAVELS WITH THE ROW, inside it rather than beside it, so a
       screen reader reads the two as one thing: "Al Quoz, no data yet, dimmed". */
    const note = option.dataset.note ?? '';
    if (note !== '') {
      const el = document.createElement('span');
      el.className = 'field-option-note';
      el.textContent = note;
      row.append(el);
    }

    f.list.append(row);
    rows.push(row);
  }
  f.rows = rows;
}

/** Move the active row, announce it, and keep it in view. -1 clears the marker. */
function setActive(f: Field, index: number): void {
  const clamped = f.rows.length === 0 ? -1 : Math.max(0, Math.min(index, f.rows.length - 1));
  f.active = clamped;
  f.rows.forEach((row, i) => row.classList.toggle('is-active', i === clamped));
  const row = clamped === -1 ? undefined : f.rows[clamped];
  if (row) {
    f.trigger.setAttribute('aria-activedescendant', row.id);
    /* `nearest`, so a list already showing the row does not jolt under the reader
       on every arrow press. */
    row.scrollIntoView({ block: 'nearest' });
  } else {
    f.trigger.removeAttribute('aria-activedescendant');
  }
}

function openList(f: Field, start: 'selected' | 'first' | 'last'): void {
  if (isOpen(f)) return;
  buildRows(f);
  f.list.hidden = false;
  f.trigger.setAttribute('aria-expanded', 'true');
  const selected = f.store.selectedIndex;
  setActive(f, start === 'first' ? 0
    : start === 'last' ? f.rows.length - 1
      : selected >= 0 ? selected : 0);
}

/**
 * Close, optionally taking focus back.
 *
 * `refocus` is false for the outside click, because a click elsewhere is a
 * statement about where the reader wants to be and stealing focus back would
 * fight it. Every keyboard path passes true — and focus was never off the trigger
 * to begin with, so that is a contract being stated rather than a restore that
 * could be missed.
 */
function closeList(f: Field, refocus: boolean): void {
  if (!isOpen(f)) return;
  f.list.hidden = true;
  f.trigger.setAttribute('aria-expanded', 'false');
  f.trigger.removeAttribute('aria-activedescendant');
  f.active = -1;
  f.buffer = '';
  if (refocus) f.trigger.focus();
}

/**
 * Take a row's value, or refuse it.
 *
 * REFUSAL LEAVES THE LIST OPEN. A disabled row that closed the list on Enter would
 * look exactly like one that had been accepted, which is the accepted-then-quietly
 * -ignored failure this console exists not to repeat.
 *
 * THE EVENTS FIRE ONLY ON A REAL MOVE, which is what the platform does: a <select>
 * re-picking its own value raises nothing. `input` then `change`, in that order,
 * because that is the order a user-driven select raises them, and console-shell.ts
 * binds the second.
 */
function commit(f: Field, index: number): boolean {
  const row = f.rows[index];
  if (!row || row.getAttribute('aria-disabled') === 'true') return false;
  const value = row.dataset.value ?? '';
  const moved = value !== f.store.value;
  if (moved) {
    f.store.value = value;
    paintValue(f);
    f.store.dispatchEvent(new Event('input', { bubbles: true }));
    f.store.dispatchEvent(new Event('change', { bubbles: true }));
  }
  closeList(f, true);
  return true;
}

/**
 * Type-ahead, both halves of it.
 *
 * One character repeated cycles the rows beginning with it — the platform's
 * behaviour, and the one people use without knowing they know it. Anything longer
 * is a prefix, matched from the active row onward and wrapping, so typing "ba" in
 * a list of three Ba- wards walks them rather than sticking on the first.
 */
function typeAhead(f: Field, char: string): void {
  const now = Date.now();
  f.buffer = now - f.bufferAt > TYPEAHEAD_MS ? char : f.buffer + char;
  f.bufferAt = now;

  const repeated = f.buffer.length > 1 && [...f.buffer].every((c) => c === f.buffer[0]);
  const needle = (repeated ? f.buffer.slice(0, 1) : f.buffer).toLowerCase();
  /* A FRESH BUFFER SEARCHES FROM THE NEXT ROW, a growing one from the row it is
     already standing on — otherwise a second character could never confirm the
     match the first one just made. */
  const stay = f.buffer.length > 1 && !repeated;
  const from = f.active < 0 ? 0 : f.active + (stay ? 0 : 1);

  for (let i = 0; i < f.rows.length; i += 1) {
    const at = (from + i) % f.rows.length;
    const row = f.rows[at];
    if (!row) continue;
    const text = (row.querySelector('.field-option-text')?.textContent ?? '').toLowerCase();
    if (text.startsWith(needle)) { setActive(f, at); return; }
  }
}

/** Whether a keydown is a plain character the reader meant to type. */
const isTypedChar = (e: KeyboardEvent): boolean =>
  e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ';

/**
 * Wire every `[data-select-field]` under `root`. Returns a disposer.
 *
 * The disposer is not housekeeping: the site runs Astro's ClientRouter, so a
 * console can be swapped out from under these listeners, and one left on a removed
 * element fires against the wrong document.
 */
export function mountSelectFields(root: ParentNode): () => void {
  const cleanup: Array<() => void> = [];
  const on = (
    node: EventTarget, ev: string, fn: EventListener, opts?: AddEventListenerOptions,
  ): void => {
    node.addEventListener(ev, fn, opts);
    cleanup.push(() => node.removeEventListener(ev, fn, opts));
  };
  const dispose = (): void => { for (const off of cleanup.splice(0)) off(); };

  const fields: Field[] = [];

  for (const el of root.querySelectorAll<HTMLElement>('[data-select-field]')) {
    const trigger = el.querySelector<HTMLElement>('[data-select-trigger]');
    const list = el.querySelector<HTMLElement>('[data-select-list]');
    const store = el.querySelector<HTMLSelectElement>('select[data-select-store]');
    const valueText = el.querySelector<HTMLElement>('[data-select-value]');
    const valueNote = el.querySelector<HTMLElement>('[data-select-note]');
    /* A field missing any of its parts is an AUTHORING fault, and the honest
       answer is to leave that markup alone rather than half-wire it: a trigger
       with no list behind it is a control that does nothing, which is the one
       thing this component may never be. */
    if (!trigger || !list || !store || !valueText || !valueNote) continue;

    const f: Field = {
      root: el, trigger, list, store, valueText, valueNote,
      rows: [], active: -1, buffer: '', bufferAt: 0,
    };
    fields.push(f);
    paintValue(f);

    /* THE STORE'S OWN EVENT, so a value set from outside this module — a test
       driving the <select>, or any other writer — repaints the words the reader
       sees. Without it the two would say different things and neither would look
       broken. */
    on(store, 'change', () => paintValue(f));

    on(trigger, 'click', () => {
      if (isOpen(f)) closeList(f, true);
      else openList(f, 'selected');
    });

    on(trigger, 'keydown', (ev) => {
      const e = ev as KeyboardEvent;
      if (!isOpen(f)) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openList(f, 'selected');
          return;
        }
        if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          openList(f, e.key === 'Home' ? 'first' : 'last');
          return;
        }
        if (isTypedChar(e)) {
          e.preventDefault();
          openList(f, 'selected');
          typeAhead(f, e.key);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); setActive(f, f.active + 1); return;
        case 'ArrowUp': e.preventDefault(); setActive(f, f.active - 1); return;
        case 'PageDown': e.preventDefault(); setActive(f, f.active + PAGE_ROWS); return;
        case 'PageUp': e.preventDefault(); setActive(f, f.active - PAGE_ROWS); return;
        case 'Home': e.preventDefault(); setActive(f, 0); return;
        case 'End': e.preventDefault(); setActive(f, f.rows.length - 1); return;
        case 'Enter': e.preventDefault(); commit(f, f.active); return;
        case ' ':
          e.preventDefault();
          /* A space inside a type-ahead is a space, not a commit — otherwise no
             two-word row past the first could ever be typed to. */
          if (f.buffer !== '' && Date.now() - f.bufferAt <= TYPEAHEAD_MS) typeAhead(f, ' ');
          else commit(f, f.active);
          return;
        case 'Escape':
          e.preventDefault();
          /* STOPPED HERE. The stage binds Escape of its own — the sources panel
             and the street-view viewer both close on it — and one press should
             dismiss one thing. */
          e.stopPropagation();
          closeList(f, true);
          return;
        case 'Tab':
          /* NOT prevented: Tab must still move. It closes without committing,
             because committing here is a navigation and tabbing PAST a control
             must never take the reader off the page. */
          closeList(f, false);
          return;
        default:
          if (isTypedChar(e)) { e.preventDefault(); typeAhead(f, e.key); }
      }
    });

    /* `mousedown` PREVENTED ON THE LIST, so the click that follows lands with
       focus still on the trigger. Without it the browser blurs the trigger the
       moment the pointer goes down, `focusout` closes the list, and the click
       arrives at whatever the list was covering. */
    on(list, 'mousedown', (ev) => ev.preventDefault());

    on(list, 'click', (ev) => {
      const row = (ev.target as Element | null)?.closest<HTMLElement>('.field-option');
      if (!row) return;
      commit(f, f.rows.indexOf(row));
    });

    /* POINTER, NOT MOUSE, so a finger dragging down the list does not leave an
       active row behind it: touch is filtered out here, by what the device
       actually sent, rather than by a media query that can disagree with it. */
    on(list, 'pointermove', (ev) => {
      const e = ev as PointerEvent;
      if (e.pointerType === 'touch') return;
      const row = (e.target as Element | null)?.closest<HTMLElement>('.field-option');
      if (row) setActive(f, f.rows.indexOf(row));
    });

    /* FOCUS LEAVING THE FIELD ENTIRELY. `relatedTarget` is where focus went, and
       a null one — a click on the page chrome, a window blur — counts too. */
    on(el, 'focusout', (ev) => {
      const to = (ev as FocusEvent).relatedTarget;
      if (to instanceof Node && el.contains(to)) return;
      closeList(f, false);
    });
  }

  if (fields.length === 0) return dispose;

  /* ONE DOCUMENT LISTENER FOR ALL THE FIELDS rather than one each: a pointer down
     anywhere closes every list it did not land inside, which is also what makes
     two of these beside each other behave like one control. */
  on(document, 'pointerdown', (ev) => {
    const target = ev.target;
    for (const f of fields) {
      if (target instanceof Node && f.root.contains(target)) continue;
      closeList(f, false);
    }
  });

  /* A RESIZE MOVES THE CARD OUT FROM UNDER THE LIST. The list is anchored in CSS
     rather than measured, so it follows — but the sidebar itself disappears below
     820px, and a list left open across that boundary would be a popup with no
     control behind it. */
  on(window, 'resize', () => { for (const f of fields) closeList(f, false); });

  /* THE PROJECTION EVENT. See SELECT_SYNC_EVENT: a script that moved a value has
     to say so, and this is the only way the words on the trigger can follow a
     write that raised nothing. */
  on(document, SELECT_SYNC_EVENT, () => { for (const f of fields) paintValue(f); });

  return dispose;
}
