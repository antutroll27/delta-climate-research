// src/scripts/cbam-ui/tiles-rules.ts
// The pack-dependent half of Rules & sources (spec §5.6, §7): the rule pack's identity, what the
// law still owes, and the sources. Everything here is READ from the pack — a date or a count typed
// into markup goes stale the day the pack is regenerated.
import type { EstimatorPack } from '../cbam-algos/estimator/estimate-from-pack.ts';
import { formatPackDate } from '../cbam-outlook.ts';
import { esc } from './format.ts';
import { isRealDigest, renderFingerprint } from './fingerprint.ts';

const kv = (k: string, v: string) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`;

/** The Rule pack tile: id, version, supersedes, valid-from, the as-published date, the basis. */
export function renderRulePack(pack: Pick<EstimatorPack, 'identity' | 'generatedAt'>, snapshot: string): string {
  const id = pack.identity;
  const hasSnap = isRealDigest(snapshot);
  return `<p class="b-t-sub num">${esc(id.id)}</p>`
    + `<div class="b-mid num">${esc(id.version)}</div>`
    + '<dl class="kv">'
    + kv('Supersedes', id.supersedes)
    + kv('Valid from', formatPackDate(id.validFrom))
    + kv('Law as published', formatPackDate(pack.generatedAt))
    + kv('Basis', id.regulatoryBasis.join(' · '))
    + '</dl>'
    + (hasSnap ? `${renderFingerprint(snapshot, 'b-fp-sm')}<p class="foot num">Snapshot ${esc(snapshot.slice(0, 16))}…</p>` : '');
}

/** Sorted, de-duplicated integers split into runs of consecutive values: [1,2,4] is [[1,2],[4]]. */
function runsOf(ns: readonly number[]): number[][] {
  const runs: number[][] = [];
  for (const n of [...new Set(ns)].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && n === last[last.length - 1]! + 1) last.push(n); else runs.push([n]);
  }
  return runs;
}

/** "2026 to 2030" for consecutive years; a gap is listed ("2026, 2028 to 2029"), never bridged. */
export function spanYears(years: readonly number[]): string {
  return runsOf(years).map((r) => (r.length > 1 ? `${r[0]} to ${r[r.length - 1]}` : String(r[0]))).join(', ');
}

const QUARTER = /^(\d{4})-Q([1-4])$/;

/**
 * The quarters a pending price covers, as words. A run of quarters that starts at a Q1 and ends at a
 * Q4 fills whole calendar years and is titled by year ("2027 to 2028", the weekly regime); any other
 * run is titled by quarter ("2026-Q4", "2026-Q4 to 2027-Q2"). A gap is never bridged: separate runs
 * are listed side by side. A label that is not YYYY-Qn is listed as it came, never ranged.
 */
export function spanQuarters(quarters: readonly string[]): string {
  const index: number[] = [];
  const odd: string[] = [];
  for (const q of quarters) {
    const m = QUARTER.exec(q);
    if (m) index.push(Number(m[1]) * 4 + Number(m[2]) - 1); else odd.push(q);
  }
  const label = (i: number) => `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
  const parts = runsOf(index).map((r) => {
    const [a, z] = [r[0]!, r[r.length - 1]!];
    if (a % 4 === 0 && z % 4 === 3) {
      const [ya, yz] = [Math.floor(a / 4), Math.floor(z / 4)];
      return ya === yz ? String(ya) : `${ya} to ${yz}`;
    }
    return r.length > 1 ? `${label(a)} to ${label(z)}` : label(a);
  });
  return [...parts, ...odd].join(', ');
}

/**
 * Not yet published: every CSCF year and every certificate-price row the pack marks pending, each
 * with the pack's own locator. Price rows are grouped by locator, so the 2027–28 weekly regime
 * reads as one item and a quarter still to come (2026-Q4) as another.
 */
export function renderNotYetPublished(pack: Pick<EstimatorPack, 'cscf' | 'prices'>): string {
  const item = (title: string, body: string) =>
    `<div class="b-npi"><span class="b-dash" aria-hidden="true"></span><div><b>${esc(title)}</b>${body}</div></div>`;
  const items: string[] = [];
  const cscf = pack.cscf.filter((r) => r.status === 'pending');
  if (cscf.length) {
    items.push(item(`Cross-sectoral correction factor, ${spanYears(cscf.map((r) => r.year))}.`,
      '<p>Every figure assumes the largest factor the law allows. The real factor can only reduce the free allocation deducted, so each figure is a floor.</p>'
      + `<ul class="foot">${cscf.map((r) => `<li>${esc(r.sourceLocator)}</li>`).join('')}</ul>`));
  }
  const groups = new Map<string, string[]>();
  for (const r of pack.prices.filter((p) => p.status === 'pending')) {
    groups.set(r.sourceLocator, [...(groups.get(r.sourceLocator) ?? []), r.quarter]);
  }
  for (const [locator, quarters] of groups) items.push(item(`Certificate price, ${spanQuarters(quarters)}.`, `<p>${esc(locator)}</p>`));
  return items.length
    ? `<div class="b-np">${items.join('')}</div>`
    : '<p class="b-lead2">Nothing the rule pack depends on is unpublished.</p>';
}

/** The Sources tile: each source with its legal status and retrieval date. Only http(s) is linked. */
export function renderSources(sources: EstimatorPack['sources']): string {
  const link = (url: string) => (/^https?:\/\//i.test(url)
    ? ` · <a href="${esc(url)}" rel="noopener">${esc(url.replace(/^https?:\/\//i, '').slice(0, 52))}</a>` : '');
  return `<p class="b-t-sub">${sources.length}, with legal status and retrieval date.</p><ol class="src">`
    + sources.map((s) => `<li><div class="row"><b>${esc(s.title)}</b><span class="chip">${esc(s.legalStatus)}</span></div>`
      + `<p class="foot">${esc(s.locator)}</p><p class="foot">Retrieved ${esc(formatPackDate(s.retrievedAt))}${link(s.url)}</p></li>`).join('')
    + '</ol>';
}
