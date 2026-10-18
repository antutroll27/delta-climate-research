// tests/e2e/fixtures/v2-split.ts — OBOS v2 S8: the @v2 suite is TWO Playwright projects, so each finishes inside one e2e tool run (a 9-minute global timeout).
/**
 * chromium-v2 grew past one run (95 specs, 8.8 minutes against a 9-minute global timeout), so the spec files are split in two. The split is by FILE (a file's tests share its
 * helpers and, where it matters, its page loads) and is balanced by the measured wall time of each file, recorded in playwright.config.ts beside the projects.
 * tests/unit/obos-v2-ci-split.test.mjs asserts that every obos-v2-*.spec.ts file is claimed by exactly ONE part (or is declared local-only), so a new spec can never silently
 * fall out of CI, and that the old `chromium-v2-split` project is gone.
 */
/* wall minutes per file on the dev machine (1 worker), from the S8 gate run: shell 2.4, building 2.2, honesty 0.9, a11y 0.7 = 6.2 | compare 0.8, solar 0.7, phone 0.7, air-weather 0.6, states 0.4, methods 0.2,
   contrast 1.4 (compact set), boot 0.6, merged 0.5, keyboard 0.4 = 6.2 */
export const V2_PART_A = ['obos-v2-shell', 'obos-v2-building', 'obos-v2-honesty', 'obos-v2-a11y'] as const;
export const V2_PART_B = ['obos-v2-compare', 'obos-v2-solar', 'obos-v2-air-weather', 'obos-v2-methods', 'obos-v2-phone', 'obos-v2-states', 'obos-v2-contrast', 'obos-v2-boot', 'obos-v2-merged', 'obos-v2-keyboard'] as const;
/** Specs that run only locally, in chromium-v2-relief (a real GPU, or an opt-in output directory). Never in CI. */
export const V2_LOCAL_ONLY = ['obos-v2-glass', 'obos-v2-shots'] as const;
export const v2Match = (names: readonly string[]): string[] => names.map((n) => `**/${n}.spec.ts`);
