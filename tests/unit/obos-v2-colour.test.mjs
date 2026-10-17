// tests/unit/obos-v2-colour.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/* THE v2 COLOUR CENSUS (spec §2, H24). Stricter than obos-layers.test.mjs:109 on
   purpose: a v2 file that disappears FAILS (no `catch { continue; }`), and a hex may
   live only in tokens.css (stylesheets) or symbols.ts (marks), each at most once. */
const STYLES = 'src/styles/obos-v2';
const SHEETS = ['tokens.css', 'atoms.css', 'shell.css', 'screens.css', 'phone.css', 'print.css'];
const COMPONENTS = 'src/components/ClimateEngine/v2';
const SCRIPTS = 'src/scripts/climate-engine/v2';
/* hex AND functional colours (S1 audit F5): rgb(a), hsl(a), oklch, oklab, lch, lab, color(). color-mix(... var() ...) does not match. */
const HEX = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lch|lab|color)\([^()]*\)/g;
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

test('every v2 sheet exists', () => { for (const f of SHEETS) assert.ok(existsSync(join(STYLES, f)), f); });

test('colour literals only in tokens.css (sheets) and symbols.ts (marks), each spelled once', () => {
  const offences = [];
  for (const f of SHEETS.filter((x) => x !== 'tokens.css')) {
    const h = strip(readFileSync(join(STYLES, f), 'utf8')).match(HEX) ?? [];
    if (h.length) offences.push(`${f}: ${h.join(' ')}`);
  }
  for (const f of readdirSync(COMPONENTS).filter((x) => x.endsWith('.astro'))) {
    const src = strip(readFileSync(join(COMPONENTS, f), 'utf8')).replace(/href="[^"]*"/g, '');
    const h = src.match(HEX) ?? [];
    if (h.length) offences.push(`${f}: ${h.join(' ')}`);
  }
  for (const f of readdirSync(SCRIPTS).filter((x) => x.endsWith('.ts') && x !== 'symbols.ts')) {
    const h = strip(readFileSync(join(SCRIPTS, f), 'utf8')).match(HEX) ?? [];
    if (h.length) offences.push(`${f}: ${h.join(' ')}`);
  }
  for (const f of [join(STYLES, 'tokens.css'), join(SCRIPTS, 'symbols.ts')]) {
    const h = (strip(readFileSync(f, 'utf8')).match(HEX) ?? []).map((x) => x.toLowerCase().replace(/\s+/g, ''));
    const twice = [...new Set(h.filter((x, i) => h.indexOf(x) !== i))];
    if (twice.length) offences.push(`${f} spells ${twice.join(' ')} more than once`);
  }
  assert.deepEqual(offences, []);
});

/* S1 audit F8: the AA token values are pinned now, not at S8. Light-Glass grey units and labels must stay #5C5B58 (4.67:1 on the worst ground). */
test('Light --ink-3 and --unit are #5C5B58 (AA, spec §7.1)', () => {
  const css = strip(readFileSync(join(STYLES, 'tokens.css'), 'utf8'));
  assert.match(css, /--hx-quiet-light: #5C5B58;/i);
  const light = css.slice(css.indexOf('[data-theme="light"] {'), css.indexOf('[data-theme="dark"] {'));
  assert.match(light, /--ink-3: var\(--hx-quiet-light\); --unit: var\(--hx-quiet-light\);/);
});

const hsl = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0, l };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(2 * l - 1)), l };
};

test('warm reds and oranges belong only to the heat ramp, the AQI bands and the compass conventions; no violet in tokens', () => {
  const css = strip(readFileSync(join(STYLES, 'tokens.css'), 'utf8'));
  const decl = [...css.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)];
  const ALLOWED_WARM = new Set(['--heat-3', '--heat-4', '--heat-5', '--compass-red', '--compass-sun']);
  const bad = [];
  for (const [, name, hex] of decl) {
    const { h, s, l } = hsl(hex);
    const warm = (h <= 45 || h >= 330) && s > 0.35 && l > 0.2 && l < 0.85;
    const violet = h >= 260 && h <= 320 && s > 0.25;
    if (warm && !ALLOWED_WARM.has(name)) bad.push(`${name} ${hex} is warm`);
    if (violet) bad.push(`${name} ${hex} is violet`);
  }
  assert.deepEqual(bad, []);
});

/* Turned back into test() by S3.1, which lands E3 (lstColor reads var(--orange)). */
test.todo('the app no longer writes #d46b4a (E3)', () => {
  const app = readFileSync('src/scripts/climate-engine/heat-map-app.ts', 'utf8');
  assert.ok(!/#d46b4a/i.test(app), 'lstColor still spells the Severe hex by hand');
});
