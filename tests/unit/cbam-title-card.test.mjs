import assert from 'node:assert/strict';
import test from 'node:test';

import { renderTitleCard, titleSummary } from '../../src/scripts/cbam-ui/title-card.ts';

const LINE = {
  cn: '73063077', name: 'Other tubes, pipes and hollow profiles, welded',
  origin: 'India', originCode: 'IN', route: '(C)', massT: '100', date: '2026-03-15',
};

test('no line: says so, and points at Estimate', () => {
  const html = renderTitleCard(null);
  assert.match(html, />Line being priced</);
  assert.match(html, />No line yet</);
  assert.equal(titleSummary(null), 'No line yet');
});

test('a line: code, name, origin (code) · route, mass · formatted date', () => {
  const html = renderTitleCard(LINE);
  assert.match(html, /class="cbx-tc-code">73063077</);
  assert.match(html, /title="Other tubes, pipes and hollow profiles, welded"/);
  assert.match(html, />India \(IN\) · route \(C\)</);
  assert.match(html, />100 t · 15 Mar 2026</);
  assert.equal(titleSummary(LINE), '73063077 · IN · (C) · 100 t · 15 Mar 2026');
});

test('the residual origin carries no code, and the default route reads as words', () => {
  const html = renderTitleCard({ ...LINE, origin: 'Other countries and territories (residual)', originCode: 'OTHER', route: 'default' });
  assert.match(html, />Other countries and territories \(residual\) · default route</);
  assert.equal(titleSummary({ ...LINE, originCode: 'OTHER', route: 'default' }), '73063077 · OTHER · default · 100 t · 15 Mar 2026');
});

test('an unreadable date is shown as typed, never as an invented one', () => {
  assert.match(renderTitleCard({ ...LINE, date: '2026-13-40' }), />100 t · 2026-13-40</);
  // A date the Date constructor would roll over (30 Feb → 2 Mar) is not a real day either.
  assert.match(renderTitleCard({ ...LINE, date: '2026-02-30' }), />100 t · 2026-02-30</);
});

test('every field is escaped', () => {
  const html = renderTitleCard({ ...LINE, name: '<img src=x onerror=alert(1)>"', massT: '1<b>', originCode: '<x>' });
  assert.ok(!html.includes('<img'), 'name escaped');
  assert.ok(!html.includes('<b>'), 'mass escaped');
  assert.ok(!html.includes('<x>'), 'code escaped');
  assert.ok(!/title="[^"]*"[^ >]/.test(html), 'the quote cannot close the title attribute');
});
