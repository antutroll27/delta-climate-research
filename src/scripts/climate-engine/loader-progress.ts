/**
 * loader-progress.ts — stage events in, one monotonic 0–1 out.
 *
 * NOTHING IMPORTS THIS YET, AND THAT IS DELIBERATE. The boot loader it was written
 * for (spec: docs/superpowers/specs/2026-08-04-heat-map-loader-design.md) had its v1
 * built, audited and REJECTED on the rendering — a second camera over the map drifts
 * up to 60° against the idle orbit. The v2 the spec then designed was never started.
 * This module is the one piece that audit blessed unchanged: pure arithmetic, no DOM,
 * no worker, six tests in node. It is kept because the case for a loader has since got
 * stronger, not weaker — /heat-map's cold-boot payload went from ~403 KB to ~996 KB
 * once the three-ward tree instances landed, and they are not deferred.
 *
 * So: an orphan on purpose, not an oversight. If a loader is never built, delete it
 * rather than leaving it to rot.
 *
 * WHY THIS IS ITS OWN MODULE. The boot loader's wave radius is drawn from this
 * number, and the number must never go backwards: a dip would suck the risen
 * city back into the ground mid-animation, which reads as a bug even when
 * loading is perfectly healthy. Keeping the arithmetic here — pure, no DOM, no
 * worker — is what makes that guarantee testable in node.
 *
 * WHY WEIGHTS AND NOT A COUNT. The five stages do not take similar time. On a
 * cold mobile connection the ward JSON and the surface PNG dominate; counting
 * stages equally would park the wave at 20 % through the longest wait and then
 * jump. The weights are rough by necessity — they are a shape for the animation,
 * never a claim about the data, which is why nothing here is ever displayed as
 * a percentage.
 */

/** The stages, in the order `loadWard` actually completes them. */
export const STAGE_ORDER = ['shell', 'ward', 'surface', 'vector', 'sim'] as const;
export type Stage = (typeof STAGE_ORDER)[number];

/**
 * Sum EXACTLY 1. A drifting sum silently rescales the wave, so the unit test
 * pins it rather than trusting arithmetic done by eye.
 *
 *   shell   app bundle parsed + MapLibre style load
 *   ward    /heat-map/data/{ward}.json — the biggest single fetch
 *   surface the measured Sentinel-2 PNG
 *   vector  roads + water + terrain artefacts
 *   sim     first equilibrium burst
 */
export const STAGE_WEIGHTS: Readonly<Record<Stage, number>> = Object.freeze({
  shell: 0.25, ward: 0.20, surface: 0.20, vector: 0.15, sim: 0.20,
});

/**
 * Below this, the overlay never mounts.
 *
 * NOT tuned to the warm-cache case, which was measured at ~1.1 s on this page —
 * bundle parse, MapLibre style load, two JSON fetches and a 253 KB ward file.
 * The loader plays on a warm cache and should: a ~1 s rise is a beat, not a
 * glitch. This threshold exists for the genuinely instant boot (a bfcache
 * restore, a repeat mount), where an animation that flashes for a fifth of a
 * second reads as a rendering fault.
 */
export const SKIP_FAST_MS = 400;

/**
 * True when a boot finished fast enough that showing a loader would be worse
 * than showing nothing. Free-standing because it reads no progress state — it
 * is a judgement about elapsed time alone.
 */
export function shouldSkipLoader(elapsedMs: number): boolean {
  return elapsedMs < SKIP_FAST_MS;
}

export interface Progress {
  /** Record a completed stage. Unknown names and repeats are no-ops. */
  complete(stage: string): void;
  /** Current progress, 0–1, monotonic. */
  value(): number;
}

export function createProgress(): Progress {
  const done = new Set<Stage>();
  let shown = 0;
  return {
    complete(stage: string): void {
      if ((STAGE_ORDER as readonly string[]).includes(stage)) done.add(stage as Stage);
    },
    value(): number {
      let target = 0;
      for (const s of done) target += STAGE_WEIGHTS[s];
      /* The ratchet is redundant TODAY -- `done` only grows and the weights are
         frozen -- and it stays anyway. Monotonicity is this module's whole
         contract, and one line that enforces it directly is cheaper than a
         future edit quietly breaking one of the two invariants it rests on. */
      shown = Math.max(shown, Math.min(1, target));
      return shown;
    },
  };
}

/** ponytail: one runnable check — the guarantees the worker leans on. */
export function assertLoaderProgressLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`loader-progress: ${m}`); };
  const sum = STAGE_ORDER.reduce((t, s) => t + STAGE_WEIGHTS[s], 0);
  ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}, not 1`);

  const p = createProgress();
  ok(p.value() === 0, 'a fresh progress must start at 0');
  p.complete('ward');
  const a = p.value();
  ok(a > 0 && a < 1, `one stage should be partial, got ${a}`);
  p.complete('ward');
  ok(p.value() === a, 'a repeated stage must change nothing');
  p.complete('not-a-stage');
  ok(p.value() === a, 'an unknown stage must change nothing');
  for (const s of STAGE_ORDER) p.complete(s);
  ok(p.value() === 1, 'all stages must reach exactly 1');
  ok(shouldSkipLoader(SKIP_FAST_MS - 1) && !shouldSkipLoader(SKIP_FAST_MS + 1), 'skip threshold is wrong');
  ok(!shouldSkipLoader(SKIP_FAST_MS), 'the threshold itself must NOT skip -- the doc says "below this"');
}
