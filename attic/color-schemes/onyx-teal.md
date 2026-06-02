# Colour scheme — Onyx + Swiss Teal (archived 2026-06-01)

The original locked scheme, saved in case we revert from the plum trial.

## Tokens (paste back into `src/styles/global.css` @theme)
```css
  /* neutrals / teal ramp */
  --color-base: #050606;       /* near-pure black — page background */
  --color-surface: #0b2c2e;    /* cards, feed rows */
  --color-surface-2: #093a3e;  /* elevated: drawer, hover, active */
  --color-hairline: rgb(111 202 214 / 0.14);
  /* text */
  --color-paper: #ecedf0;      /* primary text (off-white) */
  --color-ink-muted: #8fa3a5;  /* body / excerpts */
  --color-ink-faint: #5c7173;  /* meta / captions */
  /* accents — Swiss hybrid */
  --color-cyan: #6fcad6;       /* brand / action */
  --color-cyan-muted: #92c2cb; /* meta / quiet info */
  --color-cyan-dim: #4fb0bc;   /* pressed / :active */
  --color-bronze: #b08d57;     /* warm secondary accent */
```

## Component hardcodes that belonged to this scheme
When reverting, also restore these (they were tokenised for the plum trial):
- `Nav.astro` `.nav-links a` color: `#f4f6f8` (lighter off-white)
- `Nav.astro` `.databank:hover`: background `#f4f6f8`, color `#000`, glow `rgb(244 246 248 / 0.5)`

Documented in spec §3. Previews `palette.html` / `type.html` reflect this scheme.
