// tests/unit/cbam-updates.test.mjs — the Updates tile (spec 2026-11-04-cbam-legislation-updates).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { UPDATES } from '../../src/scripts/cbam-ui/updates.ts';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const pack = JSON.parse(read('../../public/cbam/estimator-pack.json'));

test('updates.json: every entry is dated, kinded, one sentence, and links only over https', () => {
  assert.ok(UPDATES.length > 0);
  for (const e of UPDATES) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, e.text);
    assert.equal(new Date(`${e.date}T00:00:00Z`).toISOString().slice(0, 10), e.date, `real date: ${e.date}`);
    assert.ok(['law', 'data', 'correction'].includes(e.kind), e.kind);
    assert.match(e.text, /\.$/, `ends with a full stop: ${e.text}`);
    // The approved text says "not a world average" (correcting the old claim), so only an affirmative use is wrong.
    assert.doesNotMatch(e.text, /(?<!not an? )world[- ]average/i);
    if (e.source !== undefined) assert.match(e.source, /^https:\/\//, e.source);
  }
});

test('updates.json: certificate prices are never hand-kept (they come from the pack)', () => {
  for (const e of UPDATES) assert.doesNotMatch(e.text, /€\s?\d/, e.text);
});

import { renderUpdates } from '../../src/scripts/cbam-ui/tiles-rules.ts';

const published = pack.prices.filter((p) => p.status === 'published');

test('renderUpdates: every published pack price becomes exactly one Data row, dated by its publication', () => {
  const html = renderUpdates([], pack.prices, pack.sources);
  for (const p of published) {
    const line = `Certificate price for ${p.quarter} published: €${p.priceEur}.`;
    assert.equal(html.split(line).length - 1, 1, line);
  }
  assert.equal((html.match(/<li/g) ?? []).length, published.length);
});

test('renderUpdates: newest first; same date keeps file order, hand-kept before derived', () => {
  const entries = [
    { date: '2026-10-05', kind: 'law', text: 'A.' },
    { date: '2026-12-01', kind: 'correction', text: 'B.' },
    { date: '2026-10-05', kind: 'correction', text: 'C.' },
  ];
  const html = renderUpdates(entries, published.filter((p) => p.quarter === '2026-Q3'), pack.sources);
  const order = ['B.', 'A.', 'C.', 'Certificate price for 2026-Q3'].map((s) => html.indexOf(s));
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('renderUpdates: kind chips are Law / Data / Correction; text and links escaped; only https linked', () => {
  const html = renderUpdates([
    { date: '2026-01-01', kind: 'law', text: 'x <b>y</b>.', source: 'https://example.org/a?b=1&c=2' },
    { date: '2026-01-02', kind: 'correction', text: 'z.', source: 'javascript:alert(1)' },
  ], [], pack.sources);
  assert.match(html, />Law</); assert.match(html, />Correction</);
  assert.ok(html.includes('x &lt;b&gt;y&lt;/b&gt;.'));
  assert.ok(html.includes('href="https://example.org/a?b=1&amp;c=2"'));
  assert.ok(!html.includes('javascript:'));
});

test('renderUpdates: before the pack loads, the hand-kept entries still show', () => {
  const html = renderUpdates(UPDATES, [], []);
  for (const e of UPDATES) assert.ok(html.includes(e.text.replace(/&/g, '&amp;')), e.text);
});

const page = read('../../src/pages/cbam/cbam-calculator.astro').replace(/\s+/g, ' ');

test('the view is named "Legislation & updates" in rail, phone menu and heading; the old name is gone', () => {
  assert.ok(!page.includes('Rules &amp; sources'), 'old visible name');
  assert.equal(page.split('Legislation &amp; updates').length - 1, 3, 'rail + phone menu + h1');
  assert.ok(page.includes('Legislation &amp; updates. <span>What this rests on, and what changed.</span>'));
  assert.ok(page.includes('data-goto="rules"'), 'hash and internal key unchanged');
});

test('the Updates tile sits directly after Framing and has its own container', () => {
  const framing = page.indexOf('id="cbRulesFramingH"');
  const upd = page.indexOf('id="cbRulesUpdH"');
  const notYet = page.indexOf('id="cbRulesNotYetH"');
  assert.ok(framing > 0 && upd > framing && notYet > upd, `${framing} ${upd} ${notYet}`);
  assert.ok(page.includes('id="cbUpdates"'));
});
