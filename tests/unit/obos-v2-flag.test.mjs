// tests/unit/obos-v2-flag.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveUiFlag, resolvePrefs, effectiveMenu, UI_FLAG_KEY, V2_KEYS, UI_PREPAINT_JS, UI_SWAP_JS, V2_TREE_ID,
} from '../../src/scripts/climate-engine/v2/ui-flag.ts';

test('the query wins, storage only answers when there is none', () => {
  assert.deepEqual(resolveUiFlag('?ui=v2', null), { ui: 'v2', store: 'set' });
  assert.deepEqual(resolveUiFlag('?ui=v1', 'v2'), { ui: 'v1', store: 'clear' });
  assert.deepEqual(resolveUiFlag('', 'v2'), { ui: 'v2', store: 'keep' });
  assert.deepEqual(resolveUiFlag('?a=1', null), { ui: 'v1', store: 'keep' });
  assert.deepEqual(resolveUiFlag('?ui=v3', 'junk'), { ui: 'v1', store: 'keep' });
  assert.equal(UI_FLAG_KEY, 'obos:ui');
});

/* The inline script is a string; run it against a fake document and store and
   check it agrees with resolveUiFlag on every case (one rule, two spellings). */
function runPrepaint(search, stored, { throwOnStore = false } = {}) {
  const attrs = new Map();
  const store = new Map(stored == null ? [] : [[UI_FLAG_KEY, stored]]);
  const listeners = [];
  const ls = {
    getItem: (k) => { if (throwOnStore) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (throwOnStore) throw new Error('blocked'); store.set(k, v); },
    removeItem: (k) => { if (throwOnStore) throw new Error('blocked'); store.delete(k); },
  };
  const document = {
    documentElement: { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) },
    addEventListener: (ev, fn) => listeners.push([ev, fn]),
  };
  const window = {};
  new Function('document', 'window', 'location', 'localStorage', 'URLSearchParams', UI_PREPAINT_JS)(
    document, window, { search }, ls, URLSearchParams);
  return { ui: attrs.get('data-ui') ?? 'v1', stored: store.get(UI_FLAG_KEY) ?? null, listeners };
}

test('the prepaint script implements resolveUiFlag exactly', () => {
  for (const [search, stored] of [['?ui=v2', null], ['?ui=v1', 'v2'], ['', 'v2'], ['', null], ['?ui=x', 'v2']]) {
    const want = resolveUiFlag(search, stored);
    const got = runPrepaint(search, stored);
    assert.equal(got.ui, want.ui, `${search} / ${stored}`);
    if (want.store === 'set') assert.equal(got.stored, 'v2');
    if (want.store === 'clear') assert.equal(got.stored, null);
  }
});

test('a blocked store still honours an explicit query and otherwise means v1', () => {
  assert.equal(runPrepaint('?ui=v2', null, { throwOnStore: true }).ui, 'v2');
  assert.equal(runPrepaint('', 'v2', { throwOnStore: true }).ui, 'v1');
});

test('the prepaint re-applies on astro:after-swap, bound once per window', () => {
  const { listeners } = runPrepaint('', null);
  assert.deepEqual(listeners.map(([ev]) => ev), ['astro:after-swap']);
});

test('prefs: stored choice wins, defaults follow pointer and width (spec §1.5)', () => {
  assert.deepEqual(resolvePrefs({}, { coarse: false, width: 1440 }),
    { theme: 'dark', cards: 'glass', menu: 'labels', side: 'open' });
  assert.deepEqual(resolvePrefs({}, { coarse: true, width: 390 }),
    { theme: 'dark', cards: 'plates', menu: 'icons', side: 'open' });
  assert.deepEqual(resolvePrefs({ [V2_KEYS.theme]: 'light', [V2_KEYS.cards]: 'glass', [V2_KEYS.menu]: 'icons', [V2_KEYS.side]: 'closed' },
    { coarse: true, width: 390 }), { theme: 'light', cards: 'glass', menu: 'icons', side: 'closed' });
  assert.deepEqual(resolvePrefs({ [V2_KEYS.theme]: 'neon' }, { coarse: false, width: 1300 }),
    { theme: 'dark', cards: 'glass', menu: 'icons', side: 'open' });
});

test('effective menu: icons at laptop width while a side panel shows (twin rule, spec §3.1)', () => {
  assert.equal(effectiveMenu('labels', 1440, true), 'labels');
  assert.equal(effectiveMenu('labels', 1280, true), 'icons');
  assert.equal(effectiveMenu('labels', 1280, false), 'labels');
  assert.equal(effectiveMenu('icons', 1440, false), 'icons');
});

/* Run the swap script against a fake document: it must apply exactly resolvePrefs
   and effectiveMenu to the clone's root, replace v1, and drop the template. */
function runSwap({ ui, stored = {}, coarse = false, width = 1440, hasV1 = true }) {
  const rootAttrs = new Map();
  const events = [];
  const root = { setAttribute: (k, v) => rootAttrs.set(k, v) };
  const frag = { querySelector: (sel) => (sel === 'main.obos-v2' ? root : null) };
  const tpl = { content: { cloneNode: () => frag }, remove: () => events.push('template-removed') };
  const v1 = { replaceWith: (f) => events.push(f === frag ? 'replaced' : 'replaced-wrong') };
  const html = new Map(ui === 'v2' ? [['data-ui', 'v2']] : []);
  const document = {
    getElementById: (id) => (id === V2_TREE_ID ? tpl : id === 'main' && hasV1 ? v1 : null),
    documentElement: { getAttribute: (k) => html.get(k) ?? null, removeAttribute: (k) => html.delete(k) },
  };
  const localStorage = { getItem: (k) => stored[k] ?? null };
  const matchMedia = () => ({ matches: coarse });
  new Function('document', 'window', 'localStorage', 'matchMedia', UI_SWAP_JS)(document, { innerWidth: width }, localStorage, matchMedia);
  return { rootAttrs: Object.fromEntries(rootAttrs), events, ui: html.get('data-ui') ?? 'v1' };
}

test('flag off: the template is dropped and v1 stays', () => {
  const r = runSwap({ ui: 'v1' });
  assert.deepEqual(r.events, ['template-removed']);
  assert.deepEqual(r.rootAttrs, {});
});

test('flag on: prefs, derived layout attributes, replace, then drop the template', () => {
  for (const env of [{ coarse: false, width: 1440 }, { coarse: true, width: 390 }, { coarse: false, width: 1280 }]) {
    for (const stored of [{}, { [V2_KEYS.side]: 'closed', [V2_KEYS.theme]: 'light' }, { [V2_KEYS.menu]: 'labels' }]) {
      const want = resolvePrefs(stored, env);
      const sideShown = want.side === 'open';
      const r = runSwap({ ui: 'v2', stored, ...env });
      assert.deepEqual(r.rootAttrs, {
        'data-theme': want.theme, 'data-cards': want.cards, 'data-menu': want.menu, 'data-side': want.side,
        'data-side-current': 'explore', 'data-side-shown': sideShown ? '1' : '0',
        'data-menu-eff': effectiveMenu(want.menu, env.width, sideShown),
        'data-glass': 'flat', 'data-section': 'overview',
      }, JSON.stringify({ env, stored }));
      assert.deepEqual(r.events, ['replaced', 'template-removed']);
    }
  }
});

test('flag on but no v1 main: fall back to v1 rather than half-swap', () => {
  const r = runSwap({ ui: 'v2', hasV1: false });
  assert.equal(r.ui, 'v1');
  assert.deepEqual(r.events, ['template-removed']);
});
