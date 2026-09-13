import type { PvFile } from './types';

type Validated = NonNullable<PvFile['tiers']['validated']>;

/** `1 real rooftop`, `31 real rooftops` — the plural the reader's own sample size
    happens to need, never hardcoded to the many case. */
const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** THE WARD BLOCK'S ONE-LINE LADDER SUMMARY (spec 2026-09-07-solar-guide §5): the
    same limits the card's five rungs name, condensed to a sentence for the pane
    that opens before any building is selected. Pure string building only — no
    currency lives here, so a future consumer (the installer brief, Task 5) can
    import it without pulling in `fmtMoney`. */
export function wardSummary(pv: Pick<PvFile, 'tiers'>): string {
  const v = pv.tiers.validated;
  return v === null
    ? 'Screened from satellites and open data. What limits it: roof obstacles, canopy over roofs, '
      + 'sunlight from a coarse cell, unverified heights, and no comparison with real rooftops yet. '
      + 'Open any roof for what would narrow each.'
    : `Checked against ${plural(v.n, 'real rooftop')} over ${plural(v.months, 'month')} `
      + `(median ratio ${v.median_ratio.toFixed(2)}). Still limited by roof obstacles, canopy over roofs, `
      + 'sunlight from a coarse cell and unverified heights; open any roof for what would narrow each.';
}

/** The card's fifth rung once a validation result exists (`#bcSureValid`, spec §2.3). */
export function validatedSentence(v: Validated): string {
  return `Compared with ${plural(v.n, 'real rooftop')} over ${plural(v.months, 'month')}: `
    + `median ratio ${v.median_ratio.toFixed(2)}, ${Math.round(v.within_15pct_share * 100)}% within 15%.`;
}

/** A SHARE OF A WHOLE, FLOORED AT "under 1%". `Math.round` turns anything under
    half a percent into `0%`, which reads as "none" when it means "a rounding away
    from none" — and the card and the brief print the same tree share side by side,
    so they cannot each own a copy of the rule. */
export function sharePct(f: number): string {
  return f < 0.005 ? 'under 1%' : `${Math.round(f * 100)}%`;
}

/** `#bcSolNote`'s tier-aware line. The static default names the tier in its own
    prose ("Screening estimate · …"), so once a roof is checked that prefix is
    stripped rather than left standing beside a note that now says otherwise. */
export function noteFor(pv: Pick<PvFile, 'tiers'>, defaultNote: string): string {
  const v = pv.tiers.validated;
  if (v === null) return defaultNote;
  return `Checked against ${plural(v.n, 'real rooftop')} · still a screening estimate · `
    + `${defaultNote.replace(/^Screening estimate · /, '')}`;
}
