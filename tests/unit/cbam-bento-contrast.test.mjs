// tests/unit/cbam-bento-contrast.test.mjs
// Every text/background and mark/track pair the Estimate tiles draw, held to WCAG 2.2 AA in BOTH
// themes (spec §6.5). Reads the token blocks of cbam-app.css and cbam-bento.css, so a token edit
// that breaks contrast fails here rather than in an axe run nobody looked at.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
const app = read('src/styles/cbam-app.css');
const bento = read('src/styles/cbam-bento.css');

const block = (css, selector) => {
  const at = css.indexOf(`${selector}{`);
  assert.ok(at >= 0, `${selector}{ … } must exist`);
  return css.slice(at + selector.length + 1, css.indexOf('}', at));
};
const tokens = (body) => Object.fromEntries(
  [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)].map((m) => [m[1], m[2].trim()]));

const LIGHT = { ...tokens(block(app, '.cbx')), ...tokens(block(bento, '.cbx')) };
const DARK = { ...LIGHT, ...tokens(block(app, '.cbx[data-theme="dark"]')), ...tokens(block(bento, '.cbx[data-theme="dark"]')) };

const parse = (v) => {
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (m) { const p = m[1].split(',').map((s) => parseFloat(s)); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error(`cannot evaluate colour "${v}": tile colours must be hex or rgba`);
};
const over = (top, base) => [0, 1, 2].map((i) => top[i] * top[3] + base[i] * (1 - top[3]));
const colour = (theme, ref) => {
  if (Array.isArray(ref)) return over(parse(theme[ref[0]] ?? ref[0]), colour(theme, ref[1]));
  const c = parse(theme[ref] ?? ref);
  assert.equal(c[3], 1, `${ref} is translucent: name the surface it sits on, as [token, base]`);
  return c.slice(0, 3);
};
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const CARD_WELL = ['--well', '--card'];
const PAIRS = [
  // plates and inputs
  ['--ink', '--card', 4.5], ['--ink-2', '--card', 4.5], ['--ink-3', '--card', 4.5],
  ['--ink', CARD_WELL, 4.5], ['--ink-2', CARD_WELL, 4.5], ['--ink-3', CARD_WELL, 4.5],
  ['--ink', ['--well-2', '--card'], 4.5],
  ['--bronze-t', ['--bronze-bg', '--card'], 4.5], ['--cyan-t', ['--cyan-bg', '--card'], 4.5],
  ['--cyan-t', CARD_WELL, 4.5], ['--ink-3', ['--cyan-bg', '--card'], 4.5],
  ['--on-ink', '--ink', 4.5],
  // on the ground: the §7.1 banner, the eyebrow, the rules line
  ['--bronze-t', ['--bronze-bg', '--ground'], 4.5], ['--ink-3', '--ground', 4.5],
  // the inverted hero
  ['--hero-muted', '--ink', 4.5], ['--hero-bronze', '--ink', 4.5], ['--hero-cyan', '--ink', 4.5],
  ['--on-ink', '--hero-well', 4.5], ['--hero-bronze', '--hero-well', 4.5], ['--hero-cyan', '--hero-well', 4.5],
  // the chargeable fills (text on them, and the bar against its track: 3:1, WCAG 1.4.11)
  ['--fill-bz-ink', '--fill-bz', 4.5], ['--fill-cy-ink', '--fill-cy', 4.5],
  ['--fill-bz', CARD_WELL, 3], ['--fill-cy', CARD_WELL, 3], ['--ink', CARD_WELL, 3],
  // the three-years deck
  ['--deck-ink-1', '--deck-1', 4.5], ['--deck-ink-2', '--deck-2', 4.5],
];

for (const [name, theme] of [['light', LIGHT], ['dark', DARK]]) {
  test(`every Estimate text and mark clears WCAG AA in the ${name} theme`, () => {
    const fails = [];
    for (const [fg, bg, min] of PAIRS) {
      const r = ratio(colour(theme, fg), colour(theme, bg));
      if (r < min) fails.push(`${fg} on ${JSON.stringify(bg)}: ${r.toFixed(2)} < ${min}`);
    }
    assert.deepEqual(fails, []);
  });
}

test('the OS-dark block and [data-theme="dark"] carry the same tile tokens', () => {
  assert.deepEqual(tokens(block(bento, '.cbx:not([data-theme="light"])')), tokens(block(bento, '.cbx[data-theme="dark"]')));
});
