import { describe, it, expect } from "vitest";
import { filterHistory, sortHistory, type HistoryEntry } from "./HistoryQuery";

function entry(id: string, title: string, created: number, pinned = false): HistoryEntry {
  return { id, title, created, pinned, path: `/h/${id}.json` };
}

const entries = [
  entry("a", "CAN bus intrusion survey", 100),
  entry("b", "Adversarial CLIP defenses", 200, true),
  entry("c", "Survey of CAN attacks", 300),
];

describe("filterHistory", () => {
  it("matches all terms case-insensitively (AND)", () => {
    expect(filterHistory(entries, "can survey").map((e) => e.id)).toEqual(["a", "c"]);
    expect(filterHistory(entries, "CLIP")).toHaveLength(1);
    expect(filterHistory(entries, "can zebra")).toHaveLength(0);
  });

  it("returns everything for a blank query", () => {
    expect(filterHistory(entries, "  ")).toHaveLength(3);
  });
});

describe("sortHistory", () => {
  it("puts pinned first, then newest-first within each group", () => {
    expect(sortHistory(entries).map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate its input", () => {
    const before = [...entries];
    sortHistory(entries);
    expect(entries).toEqual(before);
  });
});
