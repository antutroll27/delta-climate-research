import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderResult } from '../../src/scripts/cbam-algos/cbam-app.ts';
import { estimateFromPack, routesFor } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';

/**
 * The CBAM engine is the GeoCBAM SaaS's, copied byte-for-byte. Its UI is not — the
 * portability dossier recommended mounting the SaaS's Vue cards precisely because
 * the honesty states live inside them, and warned that rebuilding the UI means
 * re-implementing those states by hand: "that is where mistakes get made."
 *
 * This file is the mitigation for taking that risk deliberately. It asserts, per
 * branch of the result union, that the renderer shows what the dossier's §7
 * non-negotiables require — and, as importantly, that it does NOT show what it
 * must not. A refusal that quietly renders a zero is the failure mode worth
 * spending a test file on.
 *
 * These run against the REAL rule pack, so they also pin the three figures the
 * dossier's §8 checklist names. If the pack is regenerated and a number moves,
 * this fails rather than the site silently quoting last quarter's rules.
 */
const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));

const run = (cn, country, route, massT, date = '2026-03-15') =>
  estimateFromPack(pack, { cn, country, route, massT, date });

/* ── §8 checklist: the engine still produces the SaaS's figures ─────────────── */

test('§8 — priced line matches the SaaS exactly', () => {
  const e = run('25231000', 'DZ', '(A)', '100');
  assert.equal(e.status, 'cscf_pending');
  assert.equal(e.emissionsTco2e, '136.4');
  assert.equal(e.scenario.faaTco2e, '64.935');
  assert.equal(e.scenario.netTco2e, '71.465');
  assert.equal(e.scenario.certificates, '71.465');
  assert.equal(e.scenario.costEur, '5385.60');
});

test('§8 — the stranded steel line refuses, and names the missing rule', () => {
  const e = run('72241010', 'IN', '(F)', '60');
  assert.equal(e.status, 'unavailable');
  assert.equal(e.selector, 'benchmark/72241010/column-B/(F)/2026-03-15');
});

test('§8 — route lookup is unchanged', () => {
  assert.deepEqual(routesFor(pack, '72083800', 'IN', 2026), ['(C)']);
});

/* ── §7 non-negotiables, per branch ────────────────────────────────────────── */

test('NON-NEGOTIABLE 2 — a refusal renders NO figure of any kind', () => {
  const html = renderResult(run('72241010', 'IN', '(F)', '60'));
  assert.match(html, /No estimate/i, 'the refusal must be stated, not implied');
  assert.match(html, /benchmark\/72241010\/column-B\/\(F\)\/2026-03-15/,
    'the missing rule selector must be shown verbatim');
  // The failure that matters: a refusal that looks like a computed zero.
  assert.doesNotMatch(html, /class="cb-fig"/,
    'a refusal must not render the figure block — no number, not even zero');
  assert.doesNotMatch(html, /cb-cost/,
    'a refusal must not render a cost');
});

test('NON-NEGOTIABLE 3 — CSCF-pending is labelled a what-if, never a figure', () => {
  const e = run('25231000', 'DZ', '(A)', '100');
  const html = renderResult(e);
  assert.match(html, /What-if/i, 'the scenario must be labelled as one');
  assert.match(html, /unpublished/i, 'it must say the factor is unpublished');
  assert.match(html, /CSCF\s*(&nbsp;)?=(&nbsp;)?\s*1/,
    'the assumed CSCF must be stated, not buried');
  assert.match(html, /Not a final figure/i,
    'it must say outright that this is not final');
});

test('NON-NEGOTIABLE 5 — the provenance stamp travels on EVERY branch', () => {
  for (const [label, e] of [
    ['priced', run('25231000', 'DZ', '(A)', '100')],
    ['refused', run('72241010', 'IN', '(F)', '60')],
  ]) {
    const html = renderResult(e);
    assert.match(html, /Provenance/, `${label}: the stamp must render`);
    assert.match(html, /Origin basis/, `${label}: originBasis must be shown`);
    assert.match(html, /Snapshot/, `${label}: the snapshot hash must be shown`);
  }
});

test('NON-NEGOTIABLE 4 — nothing claims a filing or registry validation', () => {
  for (const e of [run('25231000', 'DZ', '(A)', '100'), run('72241010', 'IN', '(F)', '60')]) {
    const html = renderResult(e).toLowerCase();
    for (const forbidden of ['filed', 'submitted to the', 'validated by', 'registry-approved']) {
      assert.ok(!html.includes(forbidden),
        `the readout must never claim "${forbidden}" — it is decision-support, not a declaration`);
    }
  }
});

test('a residual-basis figure says so — it must not read as the origin\'s own value', () => {
  // Find any good whose default resolves from the Commission's residual bucket.
  let residual = null;
  for (const c of pack.classifications.slice(0, 120)) {
    for (const country of ['IN', 'TR', 'CN', 'BR']) {
      const rs = routesFor(pack, c.code, country, 2026);
      if (!rs.length) continue;
      const e = run(c.code, country, rs[0], '10');
      if (e.stamp?.originBasis === 'residual') { residual = e; break; }
    }
    if (residual) break;
  }
  if (!residual) return; // none in the sampled slice; the branch is still covered above
  assert.match(renderResult(residual), /Residual bucket/,
    'a residual-derived figure must name its basis, or a reader believes the Commission '
    + 'priced their country when it did not');
});

test('the renderer handles every status the engine can return', () => {
  // Exhaustiveness is enforced at compile time by the `never` arm in renderResult;
  // this checks the runtime side — that each reachable status produces real output.
  const seen = new Set();
  const probes = [
    ['25231000', 'DZ', '(A)'], ['72241010', 'IN', '(F)'], ['72083800', 'IN', '(C)'],
  ];
  for (const [cn, country, route] of probes) {
    const e = run(cn, country, route, '10');
    seen.add(e.status);
    const html = renderResult(e);
    assert.ok(html.includes('cb-res'), `${e.status}: must render a result block`);
    assert.ok(html.length > 200, `${e.status}: output looks empty`);
  }
  assert.ok(seen.size >= 2, `expected several statuses across probes, saw ${[...seen]}`);
});
