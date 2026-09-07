/**
 * SessionLayout — persistence of the session-tab workspace across restarts.
 *
 * Ported from Claudian's tab-restore machinery (#1123): the layout is an
 * ordered list of lightweight shells plus the active id, versioned and
 * decoded fail-closed (any malformed entry rejects the whole snapshot —
 * a partially restored workspace is worse than a fresh one). Writes go
 * through a debounced, deduped, serialized coordinator.
 */

export const LAYOUT_VERSION = 1;

export interface SessionShell {
  /** Stable id used to name the session's history file. */
  readonly historyId: string;
  /**
   * Provider conversation id (--resume / -s / --session-id target).
   * Field name kept as "claudeSessionId" for layout-file compatibility.
   */
  readonly claudeSessionId?: string;
  /** Model bound to this session, when explicitly chosen. */
  readonly model?: string;
  /** Provider id ("claude", "codex", …); absent = claude (legacy files). */
  readonly provider?: string;
}

export interface SessionLayoutState {
  readonly shells: readonly SessionShell[];
  readonly activeHistoryId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function encodeLayout(state: SessionLayoutState): Record<string, unknown> {
  return {
    version: LAYOUT_VERSION,
    shells: state.shells.map((s) => ({
      historyId: s.historyId,
      ...(s.claudeSessionId ? { claudeSessionId: s.claudeSessionId } : {}),
      ...(s.model ? { model: s.model } : {}),
      ...(s.provider ? { provider: s.provider } : {}),
    })),
    activeHistoryId: state.activeHistoryId,
  };
}

/** Fail-closed decode: null on any structural problem. */
export function decodeLayout(data: unknown): SessionLayoutState | null {
  if (
    !isRecord(data)
    || data.version !== LAYOUT_VERSION
    || !Array.isArray(data.shells)
    || (data.activeHistoryId !== null && !isNonBlankString(data.activeHistoryId))
  ) {
    return null;
  }

  const shells: SessionShell[] = [];
  const seen = new Set<string>();
  for (const raw of data.shells) {
    if (
      !isRecord(raw)
      || !isNonBlankString(raw.historyId)
      || seen.has(raw.historyId)
      || ("claudeSessionId" in raw && !isNonBlankString(raw.claudeSessionId))
      || ("model" in raw && !isNonBlankString(raw.model))
      || ("provider" in raw && !isNonBlankString(raw.provider))
    ) {
      return null;
    }
    seen.add(raw.historyId);
    shells.push(Object.freeze({
      historyId: raw.historyId,
      ...(typeof raw.claudeSessionId === "string" ? { claudeSessionId: raw.claudeSessionId } : {}),
      ...(typeof raw.model === "string" ? { model: raw.model } : {}),
      ...(typeof raw.provider === "string" ? { provider: raw.provider } : {}),
    }));
  }

  if (data.activeHistoryId !== null && !seen.has(data.activeHistoryId)) return null;
  if (shells.length > 0 && data.activeHistoryId === null) return null;

  return Object.freeze({ shells: Object.freeze(shells), activeHistoryId: data.activeHistoryId });
}

/** What to restore on startup. */
export function resolveRestorePlan(
  state: SessionLayoutState | null,
  options: { restoreOnStartup: boolean }
): SessionLayoutState {
  if (!state || !options.restoreOnStartup || state.shells.length === 0) {
    return { shells: [], activeHistoryId: null };
  }
  const active = state.shells.some((s) => s.historyId === state.activeHistoryId)
    ? state.activeHistoryId
    : state.shells[0].historyId;
  return { shells: [...state.shells], activeHistoryId: active };
}

interface TimerHost {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/**
 * Debounced, deduped, serialized layout writer (port of Claudian's
 * TabStatePersistenceCoordinator).
 */
export function createLayoutPersistence(
  persist: (state: SessionLayoutState) => Promise<void>,
  timerHost: TimerHost,
  debounceMs = 300
) {
  let timer: number | null = null;
  let latestState: SessionLayoutState | null = null;
  let latestSerialized: string | null = null;
  let acknowledgedSerialized: string | null = null;
  let writePromise: Promise<void> | null = null;
  let disposed = false;

  function cancelTimer(): void {
    if (timer === null) return;
    timerHost.clearTimeout(timer);
    timer = null;
  }

  async function writeLatestUntilCurrent(): Promise<void> {
    while (latestState && latestSerialized && latestSerialized !== acknowledgedSerialized) {
      const state = latestState;
      const serialized = latestSerialized;
      await persist(state);
      acknowledgedSerialized = serialized;
    }
  }

  function startWriteLoop(): Promise<void> {
    const run = writeLatestUntilCurrent();
    writePromise = run;
    void run.then(
      () => { if (writePromise === run) writePromise = null; },
      () => { if (writePromise === run) writePromise = null; }
    );
    return run;
  }

  function update(state: SessionLayoutState): void {
    if (disposed) return;
    const serialized = JSON.stringify(encodeLayout(state));
    latestSerialized = serialized;
    latestState = state;
    cancelTimer();
    if (serialized === acknowledgedSerialized) return;
    timer = timerHost.setTimeout(() => {
      timer = null;
      void flush().catch(() => {
        // Snapshot stays pending for a later update or the close flush.
      });
    }, debounceMs);
  }

  async function flush(): Promise<void> {
    cancelTimer();
    while (latestState && latestSerialized && latestSerialized !== acknowledgedSerialized) {
      await (writePromise ?? startWriteLoop());
    }
  }

  function dispose(): void {
    disposed = true;
    cancelTimer();
  }

  return { update, flush, dispose };
}
