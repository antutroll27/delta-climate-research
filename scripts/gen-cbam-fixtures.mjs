/**
 * Freeze the TS engine's output as the parity contract for the Go port.
 *
 * WHY THIS EXISTS. A rewrite of regulatory arithmetic is only safe if "same
 * answer" is machine-checkable. These fixtures are generated from the CURRENT
 * audited TS engine and committed; the Go implementation must reproduce every
 * field of every case byte-for-byte. Without them a port is a hope.
 *
 * Coverage is chosen so every BRANCH is represented, not just the happy path:
 * priced, cscf_pending, zero_by_fiat, unavailable — plus the states that carry
 * the honesty obligations (residual origin basis, indirect emissions, the
 * de minimis threshold above/indeterminate).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { estimateFromPack, resolveThreshold, routesFor, selectIndirectFactorFromPack }
  from '../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';

const pack = JSON.parse(readFileSync('public/cbam/estimator-pack.json', 'utf8'));

const COUNTRIES = ['DZ', 'IN', 'TR', 'CN', 'BR', 'UA', 'EG', 'OTHER'];
const MASSES = ['0', '1', '10', '49.999', '50', '50.001', '100', '1650', '999999.999'];
const DATES = ['2026-01-15', '2026-03-15', '2026-09-01', '2027-06-01'];
const SCOPES = ['direct', 'direct_and_indirect'];

const cases = [];
const seenStatus = new Map();

// Walk the whole corpus so rare branches are actually hit, but keep the file
// reviewable: take every good, one representative combination each, then add
// exhaustive sweeps for the goods that carry indirect defaults or refuse.
for (const c of pack.classifications) {
  for (const country of COUNTRIES) {
    const routes = routesFor(pack, c.code, country, 2026);
    if (!routes.length) continue;
    for (const route of [routes[0], routes[routes.length - 1]]) {
      for (const scope of SCOPES) {
        const input = { cn: c.code, country, route, massT: '100', date: '2026-03-15', emissionsScope: scope };
        let out;
        try { out = estimateFromPack(pack, input); }
        catch (err) { out = { threw: String(err instanceof Error ? err.message : err) }; }
        const key = `${out.status ?? 'threw'}|${scope}|${!!selectIndirectFactorFromPack(pack, input)}`;
        const n = seenStatus.get(key) ?? 0;
        // cap per shape so the corpus stays a fixture file, not a database
        if (n >= 12) continue;
        seenStatus.set(key, n + 1);
        cases.push({ input, estimate: out,
          threshold: resolveThreshold(pack, { cn: c.code, massT: '100', date: '2026-03-15' }) });
      }
    }
  }
}

// Boundary sweep: the threshold's exact edges and the mass guards, on one good
// per sector so the numbers are traceable by hand.
for (const cn of ['25231000', '72241010', '72083800', '31021010', '76011000', '28041000', '27160000']) {
  for (const massT of MASSES) {
    cases.push({ input: { cn, massT, date: '2026-03-15' },
      threshold: resolveThreshold(pack, { cn, massT, date: '2026-03-15' }), thresholdOnly: true });
  }
  for (const date of DATES) {
    const routes = routesFor(pack, cn, 'IN', Number(date.slice(0, 4)));
    if (!routes.length) continue;
    const input = { cn, country: 'IN', route: routes[0], massT: '100', date, emissionsScope: 'direct_and_indirect' };
    let out; try { out = estimateFromPack(pack, input); }
    catch (err) { out = { threw: String(err instanceof Error ? err.message : err) }; }
    cases.push({ input, estimate: out, threshold: resolveThreshold(pack, { cn, massT: '100', date }) });
  }
}

const fixture = {
  note: 'GENERATED from the audited TypeScript engine — the parity contract for the Go port. '
      + 'Regenerate with `node --import tsx scripts/gen-cbam-fixtures.mjs` ONLY when a rule '
      + 'package legitimately changes, and review the diff as a regulatory change.',
  packGeneratedAt: pack.generatedAt,
  packRules: pack.generatedFrom.map((s) => `${s.id}@${s.version}`),
  caseCount: cases.length,
  cases,
};
writeFileSync('tests/fixtures/cbam-golden.json', JSON.stringify(fixture, null, 1) + '\n');

const byStatus = {};
for (const c of cases) { const k = c.thresholdOnly ? 'thresholdOnly' : (c.estimate.status ?? 'threw'); byStatus[k] = (byStatus[k] ?? 0) + 1; }
console.log(`  cases: ${cases.length}`);
console.log('  by branch:', JSON.stringify(byStatus));
const th = {}; for (const c of cases) { const s = c.threshold?.state ?? 'null'; th[s] = (th[s] ?? 0) + 1; }
console.log('  threshold states:', JSON.stringify(th));
