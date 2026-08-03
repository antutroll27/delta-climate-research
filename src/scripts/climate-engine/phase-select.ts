/**
 * phase-select.ts — which scenario a diurnal-phase button selects.
 *
 * WHY THIS IS A MODULE AND NOT THREE LINES IN A CLICK HANDLER. The "Now" option
 * that came before it moves ONE flag (`sunNow`) and derives everything else, and
 * its own comment argues for exactly that: one flag, no fan-out. Heatwave cannot
 * follow suit, because it must move THREE fields together — `phase`, `sunNow`
 * and `heatTairC`. Three assignments in sequence are three chances to leave a
 * stale one behind: pick Heatwave then Night and a forgotten `heatTairC` keeps
 * forcing 38.4 C at 22:00 with nothing on screen admitting it.
 *
 * So the selection is computed as one value, in one pure function, that a node
 * test can call. That is also what replaces the blind `p as 'peak' | 'night'`
 * cast the handler used to perform on a raw `dataset.p` string.
 *
 * THE PHASE UNION STAYS BINARY. Every branch returns 'peak' or 'night' by
 * construction. Heatwave is a FORCING OVERRIDE riding on peak, not a third
 * phase — widening the union would mean edits at the ACCURACY lookup, bandLabel,
 * the DC-URS day/night split, the Compare deep-link and the phase label, to say
 * one thing.
 */

export interface PhaseSelection {
  /** stays binary — every consumer downstream is written against these two */
  readonly phase: 'peak' | 'night';
  /** non-null puts the map in live "Now" mode; 0 is the sentinel the app refreshes */
  readonly sunNow: number | null;
  /** non-null substitutes this air temperature for the observed one */
  readonly heatTairC: number | null;
}

/** The live-mode sentinel. `refreshNowSun()` overwrites it before the first draw. */
const NOW_SENTINEL = 0;

/**
 * Resolve a `data-p` value to a scenario, or null meaning "change nothing".
 *
 * `heatTairC` is the p99 from the heatwave artefact, or null when that fetch
 * failed. A null makes the Heatwave button inert rather than pushing `undefined`
 * into the physics — the same swallow-to-empty posture the water and roads
 * loaders take.
 */
export function selectPhase(id: string, heatTairC: number | null): PhaseSelection | null {
  switch (id) {
    case 'now':
      return { phase: 'peak', sunNow: NOW_SENTINEL, heatTairC: null };
    case 'peak':
      return { phase: 'peak', sunNow: null, heatTairC: null };
    case 'night':
      return { phase: 'night', sunNow: null, heatTairC: null };
    case 'heatwave':
      return heatTairC == null
        ? null
        : { phase: 'peak', sunNow: null, heatTairC };
    default:
      /* An unknown id must not move the highlight, let alone the physics. This
         is the case a cast could never express. */
      return null;
  }
}

/** ponytail: one runnable check — the invariants the UI depends on. */
export function assertPhaseSelectLogic(): void {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(`phase-select: ${m}`); };
  const P99 = 38.4;

  for (const id of ['now', 'peak', 'night', 'heatwave']) {
    const sel = selectPhase(id, P99);
    ok(sel !== null, `${id} should select something`);
    ok(sel!.phase === 'peak' || sel!.phase === 'night', `${id} widened the phase union`);
    /* Live mode and a forced air temperature are different questions; answering
       both at once would show "now" over a temperature that is not now. */
    ok(!(sel!.sunNow !== null && sel!.heatTairC !== null), `${id} set both sunNow and heatTairC`);
  }
  ok(selectPhase('heatwave', P99)!.phase === 'peak', 'heatwave must ride peak physics');
  ok(selectPhase('heatwave', null) === null, 'heatwave without data must be inert');
  for (const bad of ['retained', '', 'Peak', 'undefined']) {
    ok(selectPhase(bad, P99) === null, `unknown id ${bad!} should change nothing`);
  }
}
