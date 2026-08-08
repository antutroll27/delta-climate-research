export interface WardRequestToken {
  ward: string;
  generation: number;
  signal: AbortSignal;
}

/** Owns last-request-wins semantics independently of fetch/render details. */
export interface WardSession {
  /** Aborts any in-flight load. null when the ward is already pending or committed,
   *  or once disposed — a superseded or late token can then never write. */
  begin(ward: string): WardRequestToken | null;
  isCurrent(token: WardRequestToken): boolean;
  commit(token: WardRequestToken): boolean;
  /** Records a failure LEAVING the committed ward in place. */
  fail(token: WardRequestToken): boolean;
  readonly committedWard: string | null;
  readonly pendingWard: string | null;
  dispose(): void;
}

export function createWardSession(): WardSession {
  let generation = 0;
  let active: { token: WardRequestToken; controller: AbortController } | null = null;
  let committed: string | null = null;
  let disposed = false;

  function isCurrent(token: WardRequestToken): boolean {
    return !disposed && active?.token === token && !token.signal.aborted;
  }

  return {
    begin(ward) {
      if (disposed) return null;
      if (active?.token.ward === ward || (!active && committed === ward)) return null;
      active?.controller.abort();
      const controller = new AbortController();
      const token = { ward, generation: ++generation, signal: controller.signal };
      active = { token, controller };
      return token;
    },

    isCurrent,

    commit(token) {
      if (!isCurrent(token)) return false;
      committed = token.ward;
      active = null;
      return true;
    },

    fail(token) {
      if (!isCurrent(token)) return false;
      active = null;
      return true;
    },

    get committedWard() { return committed; },
    get pendingWard() { return active?.token.ward ?? null; },

    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      active?.controller.abort();
      active = null;
    },
  };
}
