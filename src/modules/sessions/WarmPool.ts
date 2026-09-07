/**
 * WarmPool — LRU ownership pool for warm Claude CLI subprocesses.
 *
 * Ported from Claudian's WarmExecutionPool: session tabs are unlimited; only
 * the number of *live subprocesses* is bounded. When the pool is full, the
 * least-recently-used coolable owner is cooled (its process stopped, its
 * Claude session id kept so the next message resumes it transparently).
 */

export const DEFAULT_MAX_WARM_PROCESSES = 5;
export const MIN_WARM_PROCESSES = 1;
export const MAX_WARM_PROCESSES = 10;

export function normalizeWarmLimit(configured: unknown): number {
  const finite = typeof configured === "number" && Number.isFinite(configured)
    ? Math.trunc(configured)
    : DEFAULT_MAX_WARM_PROCESSES;
  return Math.max(MIN_WARM_PROCESSES, Math.min(MAX_WARM_PROCESSES, finite));
}

export interface WarmOwner {
  readonly id: string;
  /** False while the owner is mid-turn and must not be cooled. */
  canCool(): boolean;
  /** Stop the owner's subprocess, preserving resumable state. */
  cool(): Promise<void>;
}

interface WarmEntry {
  owner: WarmOwner;
  lastUsed: number;
}

export class WarmCapacityError extends Error {
  constructor(readonly limit: number) {
    super(
      `All ${limit} concurrent Claude processes are busy. ` +
      "Wait for a session to finish or stop one before starting another."
    );
    this.name = "WarmCapacityError";
  }
}

export function createWarmPool(getConfiguredLimit: () => number) {
  const entries = new Map<string, WarmEntry>();
  let operationTail: Promise<unknown> = Promise.resolve();
  let usageSequence = 0;

  function getLimit(): number {
    return normalizeWarmLimit(getConfiguredLimit());
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = operationTail.catch(() => undefined).then(operation);
    operationTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  function findCoolingCandidate(): WarmEntry | null {
    let candidate: WarmEntry | null = null;
    for (const entry of entries.values()) {
      if (!entry.owner.canCool()) continue;
      if (!candidate || entry.lastUsed < candidate.lastUsed) candidate = entry;
    }
    return candidate;
  }

  async function coolExcess(limit: number): Promise<boolean> {
    while (entries.size > limit) {
      const victim = findCoolingCandidate();
      if (!victim) return false;
      await victim.owner.cool();
      entries.delete(victim.owner.id);
    }
    return true;
  }

  /** Make room for (or refresh) an owner before its process starts a turn. */
  function acquire(owner: WarmOwner): Promise<void> {
    return enqueue(async () => {
      const existing = entries.get(owner.id);
      if (existing) {
        existing.owner = owner;
        existing.lastUsed = ++usageSequence;
        await coolExcess(getLimit());
        return;
      }

      const limit = getLimit();
      while (entries.size >= limit) {
        const victim = findCoolingCandidate();
        if (!victim) throw new WarmCapacityError(limit);
        await victim.owner.cool();
        entries.delete(victim.owner.id);
      }

      entries.set(owner.id, { owner, lastUsed: ++usageSequence });
    });
  }

  /** Drop an owner whose process is already gone (closed tab, manual stop). */
  function release(ownerId: string): void {
    entries.delete(ownerId);
  }

  function has(ownerId: string): boolean {
    return entries.has(ownerId);
  }

  function getWarmCount(): number {
    return entries.size;
  }

  return { acquire, release, has, getWarmCount };
}
