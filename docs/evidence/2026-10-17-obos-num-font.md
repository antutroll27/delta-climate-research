# OBOS Num — digits-only Roboto subset (OBOS v2, spec §2.6)

- **Source:** https://github.com/googlefonts/roboto/releases/download/v2.138/roboto-unhinted.zip (fetched 2026-10-17 with a generic User-Agent)
- **Version:** Roboto 2.138 (the `name` table of each source TTF reads `Version 2.138`)
- **Licence:** Apache License, Version 2.0 (January 2004). Verified three ways at download time:
  1. `https://raw.githubusercontent.com/googlefonts/roboto/v2.138/LICENSE` is the Apache 2.0 text (contains "Apache License" and "Version 2.0");
  2. `LICENSE` inside the release zip is byte-identical to it (`cmp`);
  3. the source fonts' own `name` IDs 13/14 read "Licensed under the Apache License, Version 2.0" / `http://www.apache.org/licenses/LICENSE-2.0`.
  The licence text is shipped beside the fonts as `public/fonts/OBOS-NUM-LICENSE.txt`. The subsets keep the original `name` table (copyright and licence strings).
- **SHA-256**
  - `roboto-unhinted.zip`: `70f64c718510a601fbcf752aafe644314dacaeb85474dc689c89787c4a72a728`
  - `LICENSE`: `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`
- **Subset:** `U+0030-0039, U+002B-002E, U+0025, U+00B0, U+00B1, U+2212, U+2013, U+003A, U+002F` (digits, `+ , - .`, `%`, `°`, `±`, `−`, `–`, `:`, `/`); features `tnum, lnum, kern`; woff2. 21 glyphs per file.
- **Files:** `obos-num-300.woff2` (Roboto-Light), `obos-num-400.woff2` (Roboto-Regular), `obos-num-500.woff2` (Roboto-Medium); about 1.7 KB each.
- **Use:** only through `@font-face { font-family: "OBOS Num"; unicode-range: … }` in `src/styles/obos-v2/tokens.css`, second in the stack after `"Helvetica Neue"`. Where Helvetica Neue exists (macOS, iOS) it matches every digit first, so these files are never fetched there.
- **Ruled out:** Google Fonts' current Roboto (OFL 1.1, not the Apache-2.0 the founder named); embedding or downloading Helvetica Neue (licensed; never fetched).
