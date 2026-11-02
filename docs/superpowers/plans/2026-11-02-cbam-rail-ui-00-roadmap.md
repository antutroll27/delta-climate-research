# CBAM Calculator rail and bento redesign — roadmap

> **For agentic workers:** this is the index. Execute ONE phase plan at a time with superpowers:subagent-driven-development or superpowers:executing-plans. Each later phase plan is written only after the phase before it has merged into the integration branch, against the code as it then stands. Do not write phase 2–5 code from this file.

**Spec:** `docs/superpowers/specs/2026-11-02-cbam-rail-ui-design.md`
**Visual reference:** `docs/superpowers/specs/2026-11-02-cbam-rail-ui/`. Start with `screens/`; `preview/` is the working page and `generator/build_bento.py` regenerates it. Read its README for the known differences from the spec.
**Integration branch:** `feat/cbam-rail-ui`, created from `main` after phase 0 merges.
**Worktree:** `/Volumes/OBOSLab/worktrees/cbam-rail-ui`. Every worktree, cache and scratch file goes on OBOSLab or the SSD, never `~/` or `/tmp`.

## Phases

| Phase | Plan file | Ships | Gate to start |
|---|---|---|---|
| 0 | `2026-11-02-cbam-audit-fixes.md` (to be written) | Audit fixes H1, C2, H2, M2, M3 on **today's** UI, straight to `main` | The founder's go |
| 1 | `2026-11-02-cbam-rail-ui-01-shell.md` | App shell, rail, six views, hash routing, title card, phone bars; today's cards re-homed; `#cbList` split (spec §6.3) | Phase 0 merged |
| 2 | `…-02-estimate.md` | Inputs column (steps 1–5), good sheet, the four Estimate tiles, `fingerprint.ts` | Phase 1 merged into `feat/cbam-rail-ui` |
| 3 | `…-03-years-why.md` | Three years tiles; Why tiles (decision D2 applied) | Phase 2 merged |
| 4 | `…-04-list-export-rules.md` | List, Export and Rules tiles; final title card; D4 re-measured footnote | Phase 3 merged |
| 5 | `…-05-motion-release.md` | Illustrations, entry animation, phone polish, a11y/contrast/perf pass, independent audit, release | Phase 4 merged |

Phase 1 is committed straight onto `feat/cbam-rail-ui`, and its draft PR to `main` opens then. Phases 2–5 each branch from it (`feat/cbam-rail-ui-p2`, …) and are PR'd back into it. Production receives **one** merge, `feat/cbam-rail-ui` → `main`, after phase 5, and only on the founder's word.

## Rules for every phase

1. **The engine stays verbatim.** No edit to any file listed in `src/scripts/cbam-algos/UPSTREAM.json`; `npm run test:unit` runs `cbam-sync-check.mjs` first and fails on one.
2. **No assertion is loosened.** A renderer port carries every honesty assertion from `tests/unit/cbam-render.test.mjs` across. If a test blocks you, the code is wrong, not the test. The two exceptions need the CEO's word (spec §11, D1).
3. **Grep, never count from memory.** Before claiming "N callers" or "N tests", run the grep and list every hit. This has gone wrong seven times out of seven in this codebase.
4. **Confirm a mutation landed** in the file before trusting a green run.
5. **Concurrent sessions share the main checkout.** Work only in the worktree. Stage named paths only, never `git add -A`.
6. **Local gate:** `npm run check`, `npm run test:unit`, and the targeted Playwright spec, run in the foreground with a timeout. The full Playwright matrix runs in CI.
7. **No browser windows in front of the user.** All screenshots are headless.
8. **Model routing:** Sonnet 5.5 (high) builds each task; Opus 5.5 reviews each phase before its PR.
9. **Time-box:** each task has a budget of about 45 minutes of agent time. Report hourly.

## Decisions that block a phase

| Decision (spec §11) | Blocks |
|---|---|
| D1: banner fold and eyebrow | Phase 2 (the Estimate summary line) and phase 4 (where the eyebrow sits) |
| D2: cut cascade and step chart | Phase 3 |
| D3: palette and verified colour | Nothing. OG tokens until decided; a palette swap is a token-only change at any phase |
| D5: short good names | Phase 2 (default: clamped CN description) |
