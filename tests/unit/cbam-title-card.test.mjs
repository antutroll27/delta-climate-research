import assert from 'node:assert/strict';
import test from 'node:test';

import { renderTitleCard, titleSummary } from '../../src/scripts/cbam-ui/title-card.ts';

const LINE = {
  cn: '73063077', name: 'Other tubes, pipes and hollow profiles, welded',
  origin: 'India', route: '(C)', massT: '100', date: '2026-03-15',
};

test('no line: says so, and points at Estimate', () => {
  const html = renderTitleCard(null);
  assert.match(html, />Line being priced</);
  assert.match(html, />No line yet</);
  assert.equal(titleSummary(null), 'No line yet');
});

test('a line: code, name, origin · route, mass · date', () => {
  const html = renderTitleCard(LINE);
  assert.match(html, /class="cbx-tc-code">73063077</);
  assert.match(html, /title="Other tubes, pipes and hollow profiles, welded"/);
  assert.match(html, />India · \(C\)</);
  assert.match(html, />100 t · 2026-03-15</);
  assert.equal(titleSummary(LINE), '73063077 · India · (C) · 100 t');
});

test('every field is escaped', () => {
  const html = renderTitleCard({ ...LINE, name: '<img src=x onerror=alert(1)>"', massT: '1<b>' });
  assert.ok(!html.includes('<img'), 'name escaped');
  assert.ok(!html.includes('<b>'), 'mass escaped');
  assert.ok(!/title="[^"]*"[^ >]/.test(html), 'the quote cannot close the title attribute');
});
