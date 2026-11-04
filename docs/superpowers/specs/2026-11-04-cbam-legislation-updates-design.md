# CBAM calculator: "Legislation & updates" — design

Status: approved by the founder 2026-11-04 (design). Entry wording needs founder sign-off before release.

## Why

A colleague asked to rename the "Rules & sources" view to "legislations and updates". The view already
holds the law (Framing banner, rule pack, sources) and part of "updates" (Not yet published, retrieval
dates), but no record of what changed and when. The rename is honest only if the page also shows that.

## Decisions

1. **Name.** "Legislation & updates" — singular; "legislation" is uncountable in English. Applies to
   the rail label, the phone "More" menu and the view heading:
   `Legislation & updates. <span>What this rests on, and what changed.</span>`
   The hash stays `#rules`, and internal names (`data-view="rules"`, `tiles-rules.ts`, `cbxH-rules`) stay,
   so existing links, bookmarks and tests keep working. "Read the full framing" on Estimate is unchanged.
2. **Updates tile.** New tile, placed directly after Framing. Title "Updates.", sub "Newest first. The
   law, the data, and our own corrections." A list: date (numerals), a kind chip (Law / Data /
   Correction, ink-only; bronze and cyan stay reserved for figures), one sentence, an optional source link
   (http(s) only, same treatment as the Sources tile).
3. **Sources of entries.**
   - **Data — certificate prices — derived from the pack**: every `pack.prices` row with
     `status === 'published'` becomes "Certificate price for 2026-Q3 published: €82.32." dated by its
     `publicationDate`, linked to its source's `url`. It cannot drift from the price the calculator uses.
   - **Law and corrections — one typed, hand-kept file** `src/scripts/cbam-ui/updates.json`.
     Each entry: `date` (YYYY-MM-DD), `kind` (`law` | `data` | `correction`), `text` (one sentence,
     ends with "."), optional `source` (https URL). Adding an entry is one line; no code change.
4. **Order.** Newest first by date; ties keep file order, with derived price rows after hand-kept rows
   of the same date.
5. **Honesty.** No entry without a checked date. Law dates are the Official Journal publication date.

## Seed entries (verified 2026-11-04)

| Date | Kind | Text | Evidence |
|---|---|---|---|
| 2026-11-03 | correction | The 50 t exemption is now described as it is in law: all CBAM goods an importer brings in during a calendar year count towards one 50 t, not each good separately. | Reg (EU) 2023/956 Art 2a(1); PR #72 |
| 2026-11-03 | correction | Imports dated 2027 and 2028 are now tested against the 50 t exemption. The calculator had treated it as a 2026-only rule; the law sets no end date. | CBM 56a9ed7 (C1); Art 2a(1), Annex VII |
| 2026-11-03 | correction | The fallback default value for origins without their own figure is now described correctly: it is set from the ten exporting countries with the highest emission intensities, not a world average. | CBM 56a9ed7 (C3); Annex IV point 4.1 of IR 2025/2621 |
| 2026-11-03 | correction | The certificate price is now described as quarterly for 2026 and weekly from 2027. | CBM 56a9ed7; IR (EU) 2025/2548 Arts 5 and 8 |
| 2026-10-14 | data | Imports dated 2027 and 2028 now count certificates. No price is published for those years yet, so no euro figure is shown. | PR #57 (merged 13 Oct UTC, live 14 Oct IST) |
| 2026-07-31 | law | Implementing Regulation (EU) 2026/1740 corrects the default values in Implementing Regulation (EU) 2025/2621, applying from 1 January 2026. | OJ 31.7.2026 (cbamguide; in force 3.8.2026 per IACBAM). One secondary source says 30 July. |
| 2025-12-31 | law | Implementing Regulation (EU) 2025/2621 sets the default emission values for the definitive period. | OJ L 2025/2621, 31.12.2025 (local OJ PDF) |
| 2025-12-22 | law | Implementing Regulation (EU) 2025/2620 sets the benchmarks used to deduct free allocation from certificates. | OJ L 2025/2620, 22.12.2025 (local OJ PDF) |
| 2025-10-17 | law | Regulation (EU) 2025/2083 simplifies CBAM: an annual 50 t exemption per importer, and certificate sales from 1 February 2027. | OJ 17.10.2025, in force 20.10.2025 (KPMG, EY, Mayer Brown, Reed Smith) |

Derived from the pack today: 2026-Q1 €75.36 (7 Apr 2026), 2026-Q2 €75.28 (6 Jul 2026), 2026-Q3 €82.32
(5 Oct 2026).

Law `source` links use the pack's own ELI URLs (`http://data.europa.eu/eli/...` → write as https).

## Testing

- Unit: entry file schema (date valid, kind in set, sentence ends with ".", source https if present);
  merge + order (ties, derived rows); every published pack price yields exactly one Data row; HTML escaped.
- E2E: rail, phone menu and heading show the new name; no "Rules & sources" text remains on the page;
  `#rules` still opens the view and focuses `#cbxH-rules`; the Updates tile renders ≥ 1 row per kind
  present; contrast spec (light + dark) covers the view.
