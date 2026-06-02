# Light mode — "Warm Field" soft-maximalism (LOCKED 2026-06-01)

The committed light-mode palette (Direction 02 from `previews/soft-maximalism.html`).
Earthy, soft-maximalist: bone base + layered clay/sage/teal/bronze.

## Proposed light-mode token mapping
```css
/* light theme */
--color-base: #ece5d8;        /* bone — page background */
--color-surface: #e4dac9;     /* deeper bone — cards */
--color-surface-2: #dccfb9;   /* elevated */
--color-hairline: rgb(36 31 26 / 0.12);
--color-paper: #241f1a;       /* warm near-black — primary text */
--color-ink-muted: #4a4038;   /* body */
--color-ink-faint: #6b5f54;   /* meta */
/* accent + soft-max supporting palette */
--color-cyan: #2a5a5a;        /* brand/action = deep teal (cool anchor) */
--color-clay: #b4654a;        /* warm accent */
--color-sage: #7e8c6b;        /* secondary */
--color-bronze: #c7a06a;      /* tertiary / numerals */
```
Soft-max background = blurred clay/sage/teal/bronze blobs + multiply-grain (see preview V2).

## Notes
- Dual-mode: **dark = Onyx Aurora** (default, in progress — `previews/soft-max-onyx.html`), **light = Warm Field** (this).
- Implementation deferred: needs a theme system (`data-theme` or `prefers-color-scheme`) + per-mode token sets + component audit. Not yet wired.
- Accent maps: dark-mode cyan → light-mode deep teal `#2a5a5a` as the brand/action color; clay/sage/bronze carry the soft-max richness.
