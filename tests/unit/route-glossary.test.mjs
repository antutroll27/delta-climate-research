import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ROUTE_GLOSSARY } from '../../src/scripts/cbam-route-glossary.ts';

const pack = JSON.parse(readFileSync(
  new URL('../../public/cbam/estimator-pack.json', import.meta.url), 'utf8'));

// Every expectation here is HAND-TYPED from the regulation, never imported from the module under
// test. That is the point of this file: it is the only thing standing between the shipped text and
// the Commission's, and a test that imports its expected value proves nothing.
const QUOTES = {
  '(A)': 'grey clinker / cement',
  '(B)': 'white clinker / cement',
  '(C)': 'Carbon Steel based on BF/BOF',
  '(D)': 'Carbon Steel based on DRI/EAF',
  '(E)': 'Carbon Steel based on Scrap/EAF',
  '(F)': 'Low alloy Steel based on BF/BOF',
  '(G)': 'Low alloy Steel based on DRI/EAF',
  '(H)': 'Low alloy Steel based on scrap/EAF',
  '(J)': 'High alloy Steel (based on EAF)',
  '(K)': 'primary Aluminium',
  '(L)': 'secondary Aluminium',
};

test('every quote matches IR (EU) 2025/2620 Annex 5.3 character for character', () => {
  // The Commission's capitalisation is inconsistent — "Carbon Steel" but "Low alloy Steel",
  // "Scrap/EAF" in (E) but "scrap/EAF" in (H). Copied exactly, because these are quotes.
  for (const [indicator, quote] of Object.entries(QUOTES)) {
    assert.equal(ROUTE_GLOSSARY[indicator].quote, quote);
  }
  assert.equal(Object.keys(ROUTE_GLOSSARY).length, 11);
});

test('the label is ours and is never the same string as the quote', () => {
  // The two layers must stay distinguishable. If a future edit collapses them, our plain-English
  // gloss would start being presented as the Commission's wording — the one thing this design
  // exists to avoid. BOF in particular is expanded nowhere in the regulation.
  for (const [indicator, entry] of Object.entries(ROUTE_GLOSSARY)) {
    assert.notEqual(entry.label, entry.quote, `${indicator}: label must not be the quote`);
    assert.ok(entry.label.length > 0);
  }
});

test('every entry cites its source', () => {
  for (const entry of Object.values(ROUTE_GLOSSARY)) {
    assert.match(entry.cite, /2025\/2620/);
  }
});

test('the glossary covers the shipped corpus exactly, both directions', () => {
  // Complete AND minimal. One direction alone would let the glossary drift from the pack: a
  // missing entry leaves a bare letter in the dropdown, a stray entry is dead text nobody can
  // reach. This is also what makes the render-time fallback unreachable — see the module docblock.
  const inPack = [...new Set(pack.benchmarks.map((b) => b.routeIndicator).filter(Boolean))].sort();
  const inGlossary = Object.keys(ROUTE_GLOSSARY).sort();
  assert.deepEqual(inGlossary, inPack);
});

test("'default' is not in the glossary — it is not one of the eleven", () => {
  // routesFor can return 'default', which cbam-app renders as "single route". It is not an Annex
  // indicator, and measured across the corpus it is ALWAYS alone in its list (53,070 of 53,070
  // over goods x origins x covered years), which is exactly why that label is accurate. The
  // glossary must not claim it.
  assert.equal(ROUTE_GLOSSARY['default'], undefined);
});
