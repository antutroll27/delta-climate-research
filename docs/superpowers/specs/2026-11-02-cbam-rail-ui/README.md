# CBAM Calculator redesign: visual reference

This folder holds the approved look for `../2026-11-02-cbam-rail-ui-design.md`. It is a frozen copy, taken on 2 November 2026, of the preview the founder approved piece by piece.

| Folder | What it holds |
|---|---|
| `screens/` | 28 headless screenshots (JPEG). Every view in light and dark, on desktop (1440 px wide) and phone; the good sheet; the empty state. **Start here.** |
| `preview/` | The working preview: static HTML, CSS and JS, with no build step. `bento.html` is the approved design. `index.html` is the earlier rail-only version, which the generator reads, so it is kept here. |
| `generator/` | `build_bento.py` regenerates `preview/bento.html` from `bento.before-all.html`. Running it reproduces the committed file byte for byte (checked when the folder was copied). |

## Opening the preview

```bash
python3 -m http.server 4521 --bind 127.0.0.1 --directory docs/superpowers/specs/2026-11-02-cbam-rail-ui/preview
# then open http://127.0.0.1:4521/bento.html
```

Query parameters:
- `view=estimate|three-years|why|list|export|rules|empty`
- `theme=light|dark`
- `device=phone`
- `modal=good|origin|date|mass|data`
- `price=80`, which fills the own-price box
- `palette=cotton|pearl`, which loads the palette trials (not the default)

## How to read it

- **The look wins, and so does the copy where the spec has no ruling.** Spacing, type sizes, radii, tile order, illustration placement and motion come from here.
- **Behaviour and honesty come from the spec.** The preview is hand-written HTML with fixed example figures (73063077 · India · (C) · 100 t · 15 March 2026). The real tiles render whatever the engine returns, including every refusal state, which the preview does not show (spec §6.1).

**Known differences between the preview and the spec. The spec is right in each case:**
- **Editors.** The preview still has sheets for Origin, Date, Mass and Data. In the build, only Good opens a sheet; the others are inline controls (spec §5.1).
- **The framing banner.** The preview folds the §7.1 banner on Estimate and drops the "Provisional" eyebrow. Both wait on decision D1 (spec §11).
- **The de minimis citation** on the List view reads "Regulation (EU) 2025/2083 … as amended by Reg (EU) 2025/2083". That is the audit's known wrong citation; the real build uses whatever the fixed engine emits.
- **On phone, the de minimis gauge's needle crosses the "50 t threshold" label.** Fix it in phase 5; don't copy it.
- **Figures and dates** in the preview are examples. Never paste them into code or tests.
