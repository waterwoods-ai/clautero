import { describe, it, expect, vi } from "vitest";
import {
  encodeLayout,
  decodeLayout,
  resolveRestorePlan,
  createLayoutPersistence,
  LAYOUT_VERSION,
  type SessionLayoutState,
} from "./SessionLayout";

const sample: SessionLayoutState = {
  shells: [
    { historyId: "session-1", claudeSessionId: "abc", model: "opus", provider: "claude" },
    { historyId: "session-2", provider: "codex" },
  ],
  activeHistoryId: "session-2",
};

describe("layout codec", () => {
  it("round-trips encode → decode", () => {
    expect(decodeLayout(encodeLayout(sample))).toEqual(sample);
  });

  it("rejects the whole snapshot on any malformed shell (fail-closed)", () => {
    const good = encodeLayout(sample) as any;
    expect(decodeLayout({ ...good, version: 99 })).toBeNull();
    expect(decodeLayout({ ...good, shells: [...good.shells, { historyId: "" }] })).toBeNull();
    expect(decodeLayout({ ...good, shells: [...good.shells, good.shells[0]] })).toBeNull();
    expect(decodeLayout({ ...good, activeHistoryId: "missing" })).toBeNull();
    expect(decodeLayout({ ...good, shells: [{ historyId: "x", provider: " " }] })).toBeNull();
    expect(decodeLayout({ ...good, activeHistoryId: null })).toBeNull();
    expect(decodeLayout("junk")).toBeNull();
  });

  it("accepts legacy shells without a provider field", () => {
    const decoded = decodeLayout({
      version: LAYOUT_VERSION,
      shells: [{ historyId: "old-1" }],
      activeHistoryId: "old-1",
    });
    expect(decoded?.shells[0]).toEqual({ historyId: "old-1" });
  });

  it("accepts an empty layout with null active id", () => {
    expect(decodeLayout({ version: LAYOUT_VERSION, shells: [], activeHistoryId: null }))
      .toEqual({ shells: [], activeHistoryId: null });
  });
});

describe("resolveRestorePlan", () => {
  it("restores everything when enabled", () => {
    const plan = resolveRestorePlan(sample, { restoreOnStartup: true });
    expect(plan.shells).toHaveLength(2);
    expect(plan.activeHistoryId).toBe("session-2");
  });

  it("starts fresh when disabled or empty", () => {
    expect(resolveRestorePlan(sample, { restoreOnStartup: false }).shells).toHaveLength(0);
    expect(resolveRestorePlan(null, { restoreOnStartup: true }).shells).toHaveLength(0);
  });

  it("falls back to the first shell when the active id is stale", () => {
    const plan = resolveRestorePlan(
      { ...sample, activeHistoryId: "session-2" },
      { restoreOnStartup: true }
    );
    expect(plan.activeHistoryId).toBe("session-2");
  });
});

describe("createLayoutPersistence", () => {
  function makeTimerHost() {
    let nextId = 1;
    const pending = new Map<number, () => void>();
    return {
      setTimeout: (fn: () => void, _ms: number) => { pending.set(nextId, fn); return nextId++; },
      clearTimeout: (id: number) => { pending.delete(id); },
      fire: () => { for (const [id, fn] of [...pending]) { pending.delete(id); fn(); } },
      pendingCount: () => pending.size,
    };
  }

  it("debounces writes and dedupes identical snapshots", async () => {
    const persist = vi.fn(async () => {});
    const timers = makeTimerHost();
    const coordinator = createLayoutPersistence(persist, timers, 300);

    coordinator.update(sample);
    coordinator.update(sample);
    expect(persist).not.toHaveBeenCalled();
    timers.fire();
    await coordinator.flush();
    expect(persist).toHaveBeenCalledTimes(1);

    // Same snapshot again → no new write scheduled
    coordinator.update(sample);
    expect(timers.pendingCount()).toBe(0);
  });

  it("flush writes the latest pending state immediately", async () => {
    const written: SessionLayoutState[] = [];
    const timers = makeTimerHost();
    const coordinator = createLayoutPersistence(async (s) => { written.push(s); }, timers, 300);
    coordinator.update(sample);
    coordinator.update({ shells: [], activeHistoryId: null });
    await coordinator.flush();
    expect(written).toHaveLength(1);
    expect(written[0].shells).toHaveLength(0);
  });

  it("ignores updates after dispose", async () => {
    const persist = vi.fn(async () => {});
    const timers = makeTimerHost();
    const coordinator = createLayoutPersistence(persist, timers, 300);
    coordinator.dispose();
    coordinator.update(sample);
    timers.fire();
    await coordinator.flush();
    expect(persist).not.toHaveBeenCalled();
  });
});
