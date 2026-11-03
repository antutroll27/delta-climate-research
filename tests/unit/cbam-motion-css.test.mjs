// tests/unit/cbam-motion-css.test.mjs
// The 60 fps rule (spec §8.3; founder rule): the calculator animates transform and opacity only.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const STYLES = new URL('../../src/styles/', import.meta.url);
const PAGE = new URL('../../src/pages/cbam/cbam-calculator.astro', import.meta.url);
const UI = new URL('../../src/scripts/cbam-ui/', import.meta.url);
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function sources() {
  const css = readdirSync(STYLES).filter((f) => /^cbam-.*\.css$/.test(f))
    .map((f) => [f, noComments(readFileSync(new URL(f, STYLES), 'utf8'))]);
  const page = [...readFileSync(PAGE, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m, i) => [`cbam-calculator.astro <style> #${i + 1}`, noComments(m[1])]);
  return [...css, ...page];
}
function blockAfter(css, from) {
  let depth = 1; let i = from;
  while (depth > 0 && i < css.length) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
  return css.slice(from, i - 1);
}
/** Splits on `sep` outside parentheses (cubic-bezier(.16, 1, .3, 1) holds commas and spaces). */
function splitTop(s, sep) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
const TIMING = /^(?:-?[\d.]+m?s|ease(?:-in|-out|-in-out)?|linear|step-start|step-end|normal|allow-discrete|initial|inherit|(?:cubic-bezier|steps|linear|var)\(.*\))$/;
/** Composited (transform, opacity) or paint-only. Anything else moves layout, or is unreviewed. */
const ALLOWED = new Set(['opacity', 'transform', 'color', 'background', 'background-color', 'box-shadow', 'border-color', 'outline-color', 'fill', 'stroke']);

test('every @keyframes in the calculator animates transform and opacity only', () => {
  let seen = 0;
  for (const [file, css] of sources()) {
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
      seen++;
      const props = new Set([...blockAfter(css, m.index + m[0].length).matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]));
      for (const p of props) assert.ok(p === 'transform' || p === 'opacity', `${file} @keyframes ${m[1]} animates ${p}`);
    }
  }
  assert.ok(seen >= 7, `the seven entry keyframes at least; found ${seen}`);
});

test('no transition in the calculator moves layout', () => {
  for (const [file, css] of sources()) {
    for (const m of css.matchAll(/(?:^|[;{\s])transition(-property)?\s*:\s*([^;}]+)/g)) {
      const val = m[2].replace(/!important/, '').trim();
      if (val === 'none') continue;
      const props = m[1]
        ? splitTop(val, ',')
        : splitTop(val, ',').map((part) => splitTop(part, ' ').find((t) => !TIMING.test(t)) ?? 'all');
      for (const p of props) assert.ok(ALLOWED.has(p), `${file}: transition on "${p}" (${val})`);
    }
  }
});

test('the entry motion uses the approved easing and switches off under reduced motion', () => {
  const css = noComments(readFileSync(new URL('cbam-ill.css', STYLES), 'utf8'));
  assert.match(css, /--b-io:cubic-bezier\(\.65,0,\.35,1\)/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.cbx \.b-anim \*\{animation:none!important\}\}/);
});

test('motion lives in CSS: no calculator module animates by script or inline style', () => {
  for (const f of readdirSync(UI).filter((n) => n.endsWith('.ts'))) {
    assert.doesNotMatch(readFileSync(new URL(f, UI), 'utf8'), /\.animate\(|(?:transition|animation)(?:-[a-z]+)?\s*:/, f);
  }
});
