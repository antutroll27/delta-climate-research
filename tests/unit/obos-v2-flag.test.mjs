// tests/unit/obos-v2-flag.test.mjs — the stored-preference logic (the flag itself is gone: v2 is the default, flip plan A.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePrefs, effectiveMenu, V2_KEYS, V2_PREFS_JS, V2_ROOT_DEFAULTS } from '../../src/scripts/climate-engine/v2/ui-flag.ts';

test('prefs: stored choice wins, defaults follow pointer and width (spec §1.5)', () => {
  /* D2 revised (17 Oct): an empty store is Plates everywhere; Glass only when it was chosen */
  assert.deepEqual(resolvePrefs({}, { coarse: false, width: 1440 }),
    { theme: 'dark', cards: 'plates', menu: 'labels', side: 'open' });
  assert.deepEqual(resolvePrefs({}, { coarse: true, width: 390 }),
    { theme: 'dark', cards: 'plates', menu: 'icons', side: 'open' });
  assert.deepEqual(resolvePrefs({ [V2_KEYS.theme]: 'light', [V2_KEYS.cards]: 'glass', [V2_KEYS.menu]: 'icons', [V2_KEYS.side]: 'closed' },
    { coarse: true, width: 390 }), { theme: 'light', cards: 'glass', menu: 'icons', side: 'closed' });
  assert.deepEqual(resolvePrefs({ [V2_KEYS.theme]: 'neon' }, { coarse: false, width: 1300 }),
    { theme: 'dark', cards: 'plates', menu: 'icons', side: 'open' });
});

test('effective menu: icons at laptop width while a side panel shows (twin rule, spec §3.1)', () => {
  assert.equal(effectiveMenu('labels', 1440, true), 'labels');
  assert.equal(effectiveMenu('labels', 1280, true), 'icons');
  assert.equal(effectiveMenu('labels', 1280, false), 'labels');
  assert.equal(effectiveMenu('icons', 1440, false), 'icons');
});

/* ── flip plan T2: V2_PREFS_JS runs as the first child of a v2 root; same rules as the swap's prefs half ── */
function runPrefs({ stored = {}, width = 1440, throwOnStore = false, hasRoot = true }) {
  const rootAttrs = new Map();
  const root = { setAttribute: (k, v) => rootAttrs.set(k, v) };
  const currentScript = hasRoot ? { parentElement: root } : null;
  const localStorage = { getItem: (k) => { if (throwOnStore) throw new Error('blocked'); return stored[k] ?? null; } };
  new Function('document', 'window', 'localStorage', V2_PREFS_JS)({ currentScript }, { innerWidth: width }, localStorage);
  return Object.fromEntries(rootAttrs);
}

test('V2_PREFS_JS: stored wins, derived attributes follow resolvePrefs and effectiveMenu', () => {
  for (const env of [{ coarse: false, width: 1440 }, { coarse: true, width: 390 }, { coarse: false, width: 1280 }]) {
    for (const stored of [{}, { [V2_KEYS.side]: 'closed', [V2_KEYS.theme]: 'light' }, { [V2_KEYS.menu]: 'labels', [V2_KEYS.cards]: 'glass' }]) {
      const want = resolvePrefs(stored, env);
      const sideShown = want.side === 'open';
      assert.deepEqual(runPrefs({ stored, width: env.width }), {
        'data-theme': want.theme, 'data-cards': want.cards, 'data-menu': want.menu, 'data-side': want.side,
        'data-side-current': 'explore', 'data-side-shown': sideShown ? '1' : '0',
        'data-menu-eff': effectiveMenu(want.menu, env.width, sideShown),
        'data-glass': 'flat', 'data-section': 'overview',
      }, JSON.stringify({ env, stored }));
    }
  }
});

test('V2_PREFS_JS: blocked storage means the defaults, and the server defaults are exactly the desktop empty-store result', () => {
  const blocked = runPrefs({ throwOnStore: true });
  assert.equal(blocked['data-theme'], 'dark');
  assert.equal(blocked['data-cards'], 'plates');
  assert.deepEqual(blocked, { ...V2_ROOT_DEFAULTS, 'data-menu-eff': 'labels' });
  assert.deepEqual(runPrefs({}), { ...V2_ROOT_DEFAULTS });
});

test('V2_PREFS_JS: with no current script (not run inline) it does nothing', () => {
  assert.deepEqual(runPrefs({ hasRoot: false }), {});
});

test('the flag machinery is gone from ui-flag.ts (no UI_PREPAINT_JS, UI_SWAP_JS, resolveUiFlag, tree URL, XMLHttpRequest)', () => {
  const src = readFileSync('src/scripts/climate-engine/v2/ui-flag.ts', 'utf8');
  for (const gone of ['UI_PREPAINT_JS', 'UI_SWAP_JS', 'resolveUiFlag', 'UI_FLAG_KEY', 'V2_SWAP_ID', 'V2_GUARD_ID', 'V2_CSS_URL', 'v2TreeUrl', 'XMLHttpRequest']) assert.ok(!src.includes(gone), gone);
});
