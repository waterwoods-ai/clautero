import { describe, it, expect } from "vitest";
import { createWarmPool, normalizeWarmLimit, WarmCapacityError, type WarmOwner } from "./WarmPool";

function makeOwner(id: string, coolable = true): WarmOwner & { cooled: boolean } {
  const owner = {
    id,
    cooled: false,
    canCool: () => coolable,
    cool: async () => { owner.cooled = true; },
  };
  return owner;
}

describe("normalizeWarmLimit", () => {
  it("clamps to [1, 10] and defaults to 5", () => {
    expect(normalizeWarmLimit(undefined)).toBe(5);
    expect(normalizeWarmLimit(0)).toBe(1);
    expect(normalizeWarmLimit(99)).toBe(10);
    expect(normalizeWarmLimit(3.9)).toBe(3);
  });
});

describe("WarmPool", () => {
  it("cools the least-recently-used owner when full", async () => {
    const pool = createWarmPool(() => 2);
    const a = makeOwner("a");
    const b = makeOwner("b");
    await pool.acquire(a);
    await pool.acquire(b);
    await pool.acquire(a); // touch a → b becomes LRU
    const c = makeOwner("c");
    await pool.acquire(c);
    expect(b.cooled).toBe(true);
    expect(a.cooled).toBe(false);
    expect(pool.has("b")).toBe(false);
    expect(pool.getWarmCount()).toBe(2);
  });

  it("never cools an owner that is mid-turn", async () => {
    const pool = createWarmPool(() => 1);
    const busy = makeOwner("busy", false);
    await pool.acquire(busy);
    await expect(pool.acquire(makeOwner("next"))).rejects.toBeInstanceOf(WarmCapacityError);
    expect(busy.cooled).toBe(false);
  });

  it("re-acquiring an existing owner does not cool anyone", async () => {
    const pool = createWarmPool(() => 2);
    const a = makeOwner("a");
    const b = makeOwner("b");
    await pool.acquire(a);
    await pool.acquire(b);
    await pool.acquire(b);
    expect(a.cooled).toBe(false);
    expect(pool.getWarmCount()).toBe(2);
  });

  it("released owners free a slot without cooling", async () => {
    const pool = createWarmPool(() => 1);
    const a = makeOwner("a");
    await pool.acquire(a);
    pool.release("a");
    await pool.acquire(makeOwner("b"));
    expect(a.cooled).toBe(false);
    expect(pool.getWarmCount()).toBe(1);
  });

  it("serializes concurrent acquires", async () => {
    const pool = createWarmPool(() => 1);
    const slow = makeOwner("slow");
    let resolveCool!: () => void;
    const coolGate = new Promise<void>((r) => { resolveCool = r; });
    slow.cool = async () => { await coolGate; slow.cooled = true; };
    await pool.acquire(slow);
    const p1 = pool.acquire(makeOwner("x"));
    const p2 = pool.acquire(makeOwner("y"));
    resolveCool();
    await p1;
    // y must wait for x's acquire to settle, then cool x (LRU) if coolable
    await p2;
    expect(pool.getWarmCount()).toBe(1);
    expect(pool.has("y")).toBe(true);
  });
});
