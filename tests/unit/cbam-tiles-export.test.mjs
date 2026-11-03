// tests/unit/cbam-tiles-export.test.mjs — the Export view's tile bodies (spec §5.5).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { estimateFromPack } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';
import { csvRows, toCsv } from '../../src/scripts/cbam-lines.ts';
import { PREVIEW_COLUMNS, csvTileBody, docTileBody, fingerprintsBody } from '../../src/scripts/cbam-ui/tiles-export.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));
const mk = (i) => ({ id: `L${i}`, cn: '2523100090', country: 'DZ', route: '(A)', scope: 'direct',
  massT: String(10 * i), date: '2026-03-15', tier: 'default+markup' });
const realRows = (n) => {
  const lines = Array.from({ length: n }, (_, i) => mk(i + 1));
  const results = lines.map((l) => estimateFromPack(pack, { cn: l.cn, country: l.country, route: l.route, massT: l.massT, date: l.date }));
  return csvRows(lines, results, new Map(lines.map((l) => [l.id, 'a'.repeat(64)])), 'f'.repeat(64), pack);
};

test('the preview columns all exist in the real CSV header', () => {
  const header = toCsv(realRows(1)).split('\n')[0].split(',');
  for (const c of PREVIEW_COLUMNS) assert.ok(header.includes(c), c);
});

test('csvTileBody: the real column and line counts, and the first six rows, cell for cell', () => {
  const rows = realRows(8);
  const html = csvTileBody({ rows });
  const cols = Object.keys(rows[0]).length;
  assert.match(html, new RegExp(`<p class="b-t-sub">${cols} columns · 8 lines · full precision</p>`));
  assert.equal((html.match(/<tr>/g) ?? []).length, 1 + 6, 'a header row and six data rows');
  for (const r of rows.slice(0, 6)) for (const c of PREVIEW_COLUMNS) assert.ok(html.includes(`<td>${r[c]}</td>`), `${c}=${r[c]}`);
  // The caption counts the columns the table really draws (it said a hard-coded 6 until status joined them).
  assert.equal(PREVIEW_COLUMNS.length, 8);
  assert.match(html, new RegExp(`${PREVIEW_COLUMNS.length} of ${cols} columns and the first 6 of 8 lines shown`));
});

test('csvTileBody: a CSCF-pending row carries its what-if marker, a refused row its status', () => {
  const pending = { id: 'P', cn: '2523100090', country: 'DZ', route: '(A)', scope: 'direct', massT: '30', date: '2027-03-15', tier: 'default+markup' };
  const refused = { id: 'R', cn: '72061000', country: 'IN', route: '(D)', scope: 'direct', massT: '100', date: '2026-03-15', tier: 'default+markup' };
  const lines = [pending, refused];
  const results = lines.map((l) => estimateFromPack(pack, { cn: l.cn, country: l.country, route: l.route, massT: l.massT, date: l.date }));
  assert.equal(results[0].status, 'cscf_pending');
  assert.equal(results[1].status, 'unavailable');
  const rows = csvRows(lines, results, new Map(lines.map((l) => [l.id, 'a'.repeat(64)])), 'f'.repeat(64), pack);
  const html = csvTileBody({ rows });
  const bodyRows = html.split('<tbody>')[1].split('</tr>').filter((r) => r.includes('<td>'));
  assert.equal(bodyRows.length, 2);
  assert.ok(bodyRows[0].includes('<td>pending (what-if)</td>'), 'the pending row says what-if beside its certificates and cost');
  assert.ok(bodyRows[0].includes(`<td>${rows[0].certificates}</td>`) && rows[0].certificates !== '');
  assert.ok(bodyRows[1].includes('<td>unavailable</td>'), 'the refused row says why its figure cells are blank');
  assert.ok(bodyRows[1].includes('<td></td><td></td>'), 'and its certificates and cost are blank, not zero');
  assert.match(html, /<th scope="col">cscf_status<\/th><th scope="col">status<\/th><th scope="col">certificates<\/th>/);
});

test('csvTileBody: one line is singular and says nothing about rows it did not cut', () => {
  const html = csvTileBody({ rows: realRows(1) });
  assert.match(html, / · 1 line · full precision/);
  assert.doesNotMatch(html, /first \d+ of/);
});

test('csvTileBody: cells are escaped, and a CSV that cannot be built says why', () => {
  const rows = realRows(1).map((r) => ({ ...r, cn_code: '<b>"x"' }));
  assert.ok(csvTileBody({ rows }).includes('<td>&lt;b&gt;&quot;x&quot;</td>'));
  assert.match(csvTileBody({ error: 'mismatch <here>' }), /The CSV cannot be built: mismatch &lt;here&gt;/);
  assert.match(csvTileBody({ rows: [] }), /No line has a priced estimate; nothing to export\./);
});

test('docTileBody: what the document really contains, and the date it will carry', () => {
  const html = docTileBody(3, '2026-11-02');
  assert.match(html, /Printable · dated 2 Nov 2026/);
  assert.match(html, /every line as entered/);
  assert.doesNotMatch(html, /framing/i, 'the document does not reprint the §7.1 banner, so the tile must not say it does');
});

test('fingerprintsBody: the rule pack first, then one figure per line, captioned', () => {
  const html = fingerprintsBody('f6af39ae'.padEnd(64, '0'), [{ n: 1, hex: '4a7196c8'.padEnd(64, '0') }, { n: 2, hex: null }]);
  assert.equal((html.match(/<figure>/g) ?? []).length, 3);
  assert.match(html, /<b>Rule pack<\/b><span class="num">f6af39ae…<\/span>/);
  assert.match(html, /<b>Line 1<\/b><span class="num">4a7196c8…<\/span>/);
  assert.match(html, /<b>Line 2<\/b><span class="num">no fingerprint<\/span>/);
  // (class="b-fp" closed: the wrapper's own class="b-fps" would otherwise count.)
  assert.equal((html.match(/class="b-fp"/g) ?? []).length, 2, 'no dots for a missing fingerprint');
});

test('fingerprintsBody: the all-zero placeholder digest is never drawn as though it were a real one', () => {
  // The same rule the printable document applies (cbam-render.test.mjs: "never prints the pack's
  // all-zero placeholder as though it were a real digest"): an all-off grid would read as a hash.
  const html = fingerprintsBody('0'.repeat(64), [{ n: 1, hex: '0'.repeat(64) }]);
  assert.doesNotMatch(html, /class="b-fp"/);
  assert.doesNotMatch(html, /00000000/);
  assert.equal((html.match(/no fingerprint/g) ?? []).length, 2);
});
