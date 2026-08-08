export interface WardRequestToken<T extends string> {
  ward: T;
  generation: number;
  signal: AbortSignal;
}

/** Owns last-request-wins semantics independently of fetch/render details. */
export class WardSession<T extends string> {
  private generation = 0;
  private active: { token: WardRequestToken<T>; controller: AbortController } | null = null;
  private committed: T | null = null;
  private disposed = false;

  begin(ward: T): WardRequestToken<T> | null {
    if (this.disposed) return null;
    if (this.active?.token.ward === ward || (!this.active && this.committed === ward)) return null;
    this.active?.controller.abort();
    const controller = new AbortController();
    const token = { ward, generation: ++this.generation, signal: controller.signal };
    this.active = { token, controller };
    return token;
  }

  isCurrent(token: WardRequestToken<T>): boolean {
    return !this.disposed && this.active?.token === token && !token.signal.aborted;
  }

  commit(token: WardRequestToken<T>): boolean {
    if (!this.isCurrent(token)) return false;
    this.committed = token.ward;
    this.active = null;
    return true;
  }

  fail(token: WardRequestToken<T>): boolean {
    if (!this.isCurrent(token)) return false;
    this.active = null;
    return true;
  }

  get committedWard(): T | null { return this.committed; }
  get pendingWard(): T | null { return this.active?.token.ward ?? null; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.active?.controller.abort();
    this.active = null;
  }
}
