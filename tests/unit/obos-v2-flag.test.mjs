// tests/unit/obos-v2-flag.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveUiFlag, resolvePrefs, effectiveMenu, UI_FLAG_KEY, V2_KEYS, UI_PREPAINT_JS, UI_SWAP_JS, V2_PREFS_JS, V2_ROOT_DEFAULTS, V2_SWAP_ID, V2_GUARD_ID, V2_CSS_URL, v2TreeUrl,
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
function runPrepaint(search, stored, { throwOnStore = false, hasTemplate = true } = {}) {
  const attrs = new Map();
  const store = new Map(stored == null ? [] : [[UI_FLAG_KEY, stored]]);
  const listeners = [];
  const guards = [];
  const ls = {
    getItem: (k) => { if (throwOnStore) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (throwOnStore) throw new Error('blocked'); store.set(k, v); },
    removeItem: (k) => { if (throwOnStore) throw new Error('blocked'); store.delete(k); },
  };
  const document = {
    documentElement: { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) },
    addEventListener: (ev, fn) => listeners.push([ev, fn]),
    /* the page's UiSwap script element marks a page that has a v2 tree; the guard style is added once under the flag */
    getElementById: (id) => (id === V2_SWAP_ID && hasTemplate ? {} : id === V2_GUARD_ID && guards.length ? guards[0] : null),
    createElement: () => { const el = { id: '', textContent: '' }; return el; },
    head: { appendChild: (el) => guards.push(el) },
  };
  const window = {};
  new Function('document', 'window', 'location', 'localStorage', 'URLSearchParams', UI_PREPAINT_JS)(
    document, window, { search }, ls, URLSearchParams);
  return {
    get ui() { return attrs.get('data-ui') ?? 'v1'; },
    stored: store.get(UI_FLAG_KEY) ?? null,
    listeners,
    guards,
    /* the soft-navigation hook: set what the NEW page has, then fire astro:after-swap */
    swapTo: (nextHasTemplate) => { hasTemplate = nextHasTemplate; for (const [, fn] of listeners) fn(); },
  };
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

test('a soft navigation to a page with no v2 tree drops data-ui (S0 audit F4)', () => {
  const r = runPrepaint('?ui=v2', null);
  assert.equal(r.ui, 'v2');
  r.swapTo(false); /* e.g. /heat-map/compare or /team after a ClientRouter navigation */
  assert.equal(r.ui, 'v1', 'data-ui="v2" leaked onto a page that has no v2 tree');
  r.swapTo(true); /* back to an area page: the flag, still in storage, applies again */
  assert.equal(r.ui, 'v2');
});

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

test('under the flag the prepaint writes ONE guard style (the v1 frame must not paint; tokens.css, which used to carry the rule, is no longer on a flag-off page); under v1 it writes none', () => {
  const on = runPrepaint('?ui=v2', null);
  assert.equal(on.guards.length, 1);
  assert.equal(on.guards[0].id, V2_GUARD_ID);
  assert.match(on.guards[0].textContent, /html\[data-ui="v2"\] main#main:not\(\.obos-v2\)\{visibility:hidden\}/);
  assert.match(on.guards[0].textContent, /html\[data-ui="v2"\] body\{overflow:hidden\}/);
  on.swapTo(true);   /* a soft navigation back onto a v2 page does not stack a second guard */
  assert.equal(on.guards.length, 1);
  assert.equal(runPrepaint('', null).guards.length, 0);
});

test('the tree URL is the page\'s own file under /obos-v2/ (FINAL audit F5)', () => {
  assert.equal(v2TreeUrl({ areaKey: 'in/kolkata/ballygunge' }), '/obos-v2/area/in/kolkata/ballygunge.html');
  assert.equal(v2TreeUrl('compare'), '/obos-v2/compare.html');
  assert.equal(v2TreeUrl('brief'), '/obos-v2/brief.html');
  assert.equal(V2_CSS_URL, '/obos-v2/obos-v2.css');
});

/* Run the swap script against a fake document and a fake XMLHttpRequest: it must apply exactly resolvePrefs and effectiveMenu to the fetched tree's root, add the stylesheet once, and
   replace v1. Flag off it does nothing at all (no request: a v1 reader pays nothing). */
function runSwap({ ui, stored = {}, coarse = false, width = 1440, hasV1 = true, status = { tree: 200, css: 200 }, hasStyle = false, treeHasRoot = true }) {
  const rootAttrs = new Map();
  const events = [];
  const requests = [];
  const root = { setAttribute: (k, v) => rootAttrs.set(k, v) };
  const frag = { querySelector: (sel) => (sel === 'main.obos-v2' && treeHasRoot ? root : null) };
  const v1 = { replaceWith: (f) => events.push(f === frag ? 'replaced' : 'replaced-wrong') };
  const html = new Map(ui === 'v2' ? [['data-ui', 'v2']] : []);
  const guard = { remove: () => events.push('guard-removed') };
  const swapEl = { getAttribute: (k) => (k === 'data-tree' ? v2TreeUrl({ areaKey: 'in/kolkata/ballygunge' }) : k === 'data-css' ? V2_CSS_URL : null) };
  const styles = [];
  const document = {
    getElementById: (id) => (id === V2_SWAP_ID ? swapEl : id === V2_GUARD_ID ? guard : id === 'main' && hasV1 ? v1 : null),
    querySelector: (sel) => (sel === 'style[data-v2-css]' && hasStyle ? {} : null),
    createElement: (tag) => (tag === 'template' ? { set innerHTML(t) { this.content = frag; this.text = t; } } : { setAttribute: () => {}, set textContent(t) { this.text = t; } }),
    head: { appendChild: (el) => { styles.push(el); events.push('style-added'); } },
    documentElement: { getAttribute: (k) => html.get(k) ?? null, removeAttribute: (k) => html.delete(k) },
  };
  function XMLHttpRequest() {
    this.open = (m, u, async) => { assert.equal(async, false, 'synchronous, so the first paint is the finished page'); this.url = u; requests.push(u); };
    this.send = () => { this.status = this.url === V2_CSS_URL ? status.css : status.tree; this.responseText = this.status === 200 ? `body of ${this.url}` : ''; };
  }
  const localStorage = { getItem: (k) => stored[k] ?? null };
  new Function('document', 'window', 'localStorage', 'XMLHttpRequest', UI_SWAP_JS)(document, { innerWidth: width }, localStorage, XMLHttpRequest);
  return { rootAttrs: Object.fromEntries(rootAttrs), events, requests, styles, ui: html.get('data-ui') ?? 'v1' };
}

test('flag off: nothing happens and nothing is fetched (a v1 reader pays nothing)', () => {
  const r = runSwap({ ui: 'v1' });
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.requests, []);
  assert.deepEqual(r.rootAttrs, {});
});

test('flag on: the tree then the stylesheet are fetched once, prefs and derived layout attributes applied, the stylesheet added, v1 replaced', () => {
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
      assert.deepEqual(r.requests, ['/obos-v2/area/in/kolkata/ballygunge.html', V2_CSS_URL]);
      assert.deepEqual(r.events, ['style-added', 'replaced']);
    }
  }
});

test('flag on, stylesheet already in the head (a soft navigation inside v2): it is not fetched or added twice', () => {
  const r = runSwap({ ui: 'v2', hasStyle: true });
  assert.deepEqual(r.requests, ['/obos-v2/area/in/kolkata/ballygunge.html']);
  assert.deepEqual(r.events, ['replaced']);
});

test('flag on but no v1 main: fall back to v1 rather than half-swap (and fetch nothing)', () => {
  const r = runSwap({ ui: 'v2', hasV1: false });
  assert.equal(r.ui, 'v1');
  assert.deepEqual(r.requests, []);
  assert.deepEqual(r.events, ['guard-removed']);
});

test('flag on, the tree cannot be fetched (404 / offline): v1 is kept, the flag and the guard are dropped', () => {
  const r = runSwap({ ui: 'v2', status: { tree: 404, css: 200 } });
  assert.equal(r.ui, 'v1');
  assert.deepEqual(r.events, ['guard-removed']);
  assert.deepEqual(r.styles, []);
});

test('flag on, the stylesheet cannot be fetched: v1 is kept (never an unstyled v2)', () => {
  const r = runSwap({ ui: 'v2', status: { tree: 200, css: 500 } });
  assert.equal(r.ui, 'v1');
  assert.deepEqual(r.events, ['guard-removed']);
});

test('flag on, the file has no v2 root: v1 is kept', () => {
  const r = runSwap({ ui: 'v2', treeHasRoot: false });
  assert.equal(r.ui, 'v1');
  assert.ok(!r.events.includes('replaced'));
  /* rc1 R3: and the v2 stylesheet is not left behind on a v1 page (it was injected before the root was checked) */
  assert.deepEqual(r.styles, [], 'no v2 <style> is added to a page that kept v1');
  assert.ok(!r.events.includes('style-added'));
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
