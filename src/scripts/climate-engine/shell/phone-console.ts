// src/scripts/climate-engine/shell/phone-console.ts
// The two behaviours the phone console needs that CSS cannot express.
//
//  1. THE ROTATE NUDGE. Shown once per session on a portrait phone, dismissible.
//     It is a nudge and not a gate on purpose: screen.orientation.lock() requires
//     fullscreen and iOS Safari does not implement it at all, so a real lock is
//     unavailable on the platform most of this traffic arrives on. A gate would
//     strand every visitor with rotation locked — a common setting — for a reveal
//     they cannot reach.
//
//  2. THE SHEET SCRIM. In landscape the sidebar is a bottom sheet, driven purely by
//     `data-panel` on <html>, which console-shell.ts already writes. The scrim adds
//     tap-outside-to-close, and it does that by CLICKING THE PANEL'S OWN CHEVRON
//     rather than writing the attribute itself — so console-shell stays the single
//     writer of that state and the two cannot disagree.
//
// Everything here no-ops off the console, and the layout work is all in CSS: this
// file adds no styles and measures no boxes.

const SESSION_KEY = 'obos:rotate-nudge-dismissed';
const SHEET_KEY = 'obos:phone-sheet-settled';
const ENTRY_KEY = 'obos:entry-note-seen';

let cleanup: (() => void) | undefined;

/** Coarse pointer AND a phone-shaped short side — a tablet in portrait is not a phone. */
function isPhone(): boolean {
  return matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) <= 560;
}

function dismissed(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false; // private mode / storage disabled — show it, do not crash
  }
}

export function initPhoneConsole(): void {
  destroyPhoneConsole();
  const root = document.querySelector<HTMLElement>('[data-console]');
  if (!root) return;

  const ac = new AbortController();
  const { signal } = ac;

  /* ── the entry note ──
     Once per session, on touch screens only. A desktop never sees it, and neither
     does anyone who has already dismissed it — the console is what they came for,
     and a modal on every visit would be an obstacle rather than a courtesy. */
  const entry = document.getElementById('entryNote');
  if (entry && matchMedia('(pointer: coarse)').matches) {
    let seen = false;
    try { seen = sessionStorage.getItem(ENTRY_KEY) === '1'; } catch { /* storage off — show it */ }
    if (!seen) {
      entry.hidden = false;
      const close = () => {
        entry.hidden = true;
        try { sessionStorage.setItem(ENTRY_KEY, '1'); } catch { /* not fatal */ }
      };
      entry.querySelector('[data-entry-close]')?.addEventListener('click', close, { signal });
      // the backdrop, but not the card: a tap that lands on the text should not dismiss
      entry.addEventListener('click', (e) => { if (e.target === entry) close(); }, { signal });
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, { signal });
      // Focus the one control, so the dialog is reachable without a pointer.
      entry.querySelector<HTMLButtonElement>('[data-entry-close]')?.focus();
    }
  }

  /* ── the nudge ── */
  const nudge = document.getElementById('rotateNudge');
  const sync = () => {
    if (!nudge) return;
    const show = isPhone()
      && matchMedia('(orientation: portrait)').matches
      && !dismissed();
    nudge.hidden = !show;
  };
  nudge?.querySelector('[data-rn-dismiss]')?.addEventListener('click', () => {
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* not fatal */ }
    if (nudge) nudge.hidden = true;
  }, { signal });

  // Rotating IS the success case, so hide it the moment they do — and remember,
  // so coming back to portrait later does not nag someone who already complied.
  const onOrient = () => {
    if (matchMedia('(orientation: landscape)').matches) {
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* not fatal */ }
    }
    sync();
  };
  addEventListener('orientationchange', onOrient, { signal });
  addEventListener('resize', onOrient, { signal });
  sync();

  /* ── the sheet starts CLOSED on a phone ──
     `data-panel` is a remembered DESKTOP preference, and its default is expanded.
     On a desktop that is right: the sidebar is a column beside the map. In
     landscape on a phone the same state is a sheet, so the console would open with
     its own controls covering the instrument the visitor came to see.

     Closing it here rather than defaulting the attribute differently keeps
     console-shell.ts the single writer of panel state — this drives the panel's own
     chevron, exactly as the scrim does. Once per session, so it never fights
     someone who has deliberately opened a pane and rotated. */
  // The HUD applies to phones in EITHER orientation, so the sheet must settle in
  // both — in portrait the sidebar is the same bottom sheet, and it would otherwise
  // open over the map on arrival exactly as it did in landscape.
  const settleSheet = () => {
    if (!isPhone()) return;
    try {
      if (sessionStorage.getItem(SHEET_KEY) === '1') return;
      sessionStorage.setItem(SHEET_KEY, '1');
    } catch { /* storage disabled — settle once per page load instead */ }
    if (document.documentElement.getAttribute('data-panel') !== 'collapsed') {
      root.querySelector<HTMLButtonElement>('button[data-panel-toggle]')?.click();
    }
  };
  settleSheet();
  addEventListener('orientationchange', settleSheet, { signal });

  /* ── the sheet scrim ── */
  const scrim = root.querySelector<HTMLButtonElement>('[data-sheet-scrim]');
  scrim?.addEventListener('click', () => {
    root.querySelector<HTMLButtonElement>('button[data-panel-toggle]')?.click();
  }, { signal });

  cleanup = () => ac.abort();
}

export function destroyPhoneConsole(): void {
  cleanup?.();
  cleanup = undefined;
}
