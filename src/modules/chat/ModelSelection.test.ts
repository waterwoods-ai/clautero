import { describe, it, expect } from "vitest";
import {
  nextModel,
  resolveNewSessionModel,
  resolveSessionModel,
  createModelSelectionCoordinator,
} from "./ModelSelection";

describe("model resolution", () => {
  it("cycles through the model list", () => {
    expect(nextModel("sonnet")).toBe("opus");
    expect(nextModel("haiku")).toBe("fable");
    expect(nextModel("fable")).toBe("sonnet");
    expect(nextModel("bogus")).toBe("sonnet");
  });

  it("seeds new sessions from the last explicit pick", () => {
    expect(resolveNewSessionModel("opus")).toBe("opus");
    expect(resolveNewSessionModel(null)).toBe("sonnet");
    expect(resolveNewSessionModel("not-a-model")).toBe("sonnet");
  });

  it("prefers a session's own binding over the seed", () => {
    expect(resolveSessionModel("haiku", "opus")).toBe("haiku");
    expect(resolveSessionModel(null, "opus")).toBe("opus");
  });

  it("returns auto ('') for providers with no fixed model list", () => {
    expect(nextModel("anything", [])).toBe("");
    expect(resolveNewSessionModel("opus", [])).toBe("");
  });

  it("cycles within a custom provider list and ignores foreign seeds", () => {
    const models = ["m1", "m2"];
    expect(nextModel("m1", models)).toBe("m2");
    expect(resolveNewSessionModel("opus", models)).toBe("m1");
    expect(resolveNewSessionModel("m2", models)).toBe("m2");
  });
});

describe("createModelSelectionCoordinator", () => {
  it("applies commits in intent order and drops stale ones", async () => {
    const coordinator = createModelSelectionCoordinator();
    const applied: string[] = [];

    const first = coordinator.beginIntent();
    const second = coordinator.beginIntent();

    // Newer intent commits first
    expect(await coordinator.commitIntent(second, () => { applied.push("second"); })).toBe(true);
    // Older intent must be refused
    expect(await coordinator.commitIntent(first, () => { applied.push("first"); })).toBe(false);
    expect(applied).toEqual(["second"]);
  });

  it("re-checks validity at commit time", async () => {
    const coordinator = createModelSelectionCoordinator();
    let valid = true;
    const intent = coordinator.beginIntent();
    valid = false;
    expect(await coordinator.commitIntent(intent, () => {}, () => valid)).toBe(false);
  });

  it("serializes async applies", async () => {
    const coordinator = createModelSelectionCoordinator();
    const order: number[] = [];
    const i1 = coordinator.beginIntent();
    const i2 = coordinator.beginIntent();
    const p1 = coordinator.commitIntent(i1, async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(1);
    });
    const p2 = coordinator.commitIntent(i2, () => { order.push(2); });
    expect(await p1).toBe(true);
    expect(await p2).toBe(true);
    expect(order).toEqual([1, 2]);
  });
});
