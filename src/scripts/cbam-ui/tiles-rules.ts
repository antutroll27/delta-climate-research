// src/scripts/cbam-ui/tiles-rules.ts
// The pack-dependent half of Rules & sources (spec §5.6, §7): the rule pack's identity, what the
// law still owes, and the sources. Everything here is READ from the pack — a date or a count typed
// into markup goes stale the day the pack is regenerated.
import type { EstimatorPack } from '../cbam-algos/estimator/estimate-from-pack.ts';
import { formatPackDate } from '../cbam-outlook.ts';
import { esc } from './format.ts';
import { renderFingerprint } from './fingerprint.ts';

const kv = (k: string, v: string) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`;

/** The Rule pack tile: id, version, supersedes, valid-from, the as-published date, the basis. */
export function renderRulePack(pack: Pick<EstimatorPack, 'identity' | 'generatedAt'>, snapshot: string): string {
  const id = pack.identity;
  const hasSnap = /^[0-9a-f]{16,}$/i.test(snapshot);
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

const span = (xs: readonly string[]) => (xs.length > 1 ? `${xs[0]} to ${xs[xs.length - 1]}` : (xs[0] ?? ''));

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
    items.push(item(`Cross-sectoral correction factor, ${span(cscf.map((r) => String(r.year)))}.`,
      '<p>Every figure assumes the largest factor the law allows. The real factor can only reduce the free allocation deducted, so each figure is a floor.</p>'
      + `<ul class="foot">${cscf.map((r) => `<li>${esc(r.sourceLocator)}</li>`).join('')}</ul>`));
  }
  const groups = new Map<string, string[]>();
  for (const r of pack.prices.filter((p) => p.status === 'pending')) {
    groups.set(r.sourceLocator, [...(groups.get(r.sourceLocator) ?? []), r.quarter]);
  }
  for (const [locator, quarters] of groups) items.push(item(`Certificate price, ${span(quarters)}.`, `<p>${esc(locator)}</p>`));
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
