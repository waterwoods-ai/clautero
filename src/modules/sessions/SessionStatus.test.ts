import { describe, it, expect } from "vitest";
import { mostSevere, resolveIndicator } from "./SessionStatus";

describe("SessionStatus", () => {
  it("ranks action-required above streaming above error", () => {
    expect(mostSevere(["error", "streaming", "action-required"])).toBe("action-required");
    expect(mostSevere(["error", "streaming"])).toBe("streaming");
    expect(mostSevere(["idle", "error"])).toBe("error");
    expect(mostSevere(["idle"])).toBe("idle");
    expect(mostSevere([])).toBe("idle");
  });

  it("gives every non-idle state a colored dot and label", () => {
    for (const kind of ["action-required", "streaming", "error"] as const) {
      const ind = resolveIndicator(kind);
      expect(ind.color).not.toBe("");
      expect(ind.label.length).toBeGreaterThan(0);
    }
    expect(resolveIndicator("idle").color).toBe("");
  });

  it("a session waiting on the user never presents as running", () => {
    expect(resolveIndicator(mostSevere(["streaming", "action-required"])).label)
      .toBe("Needs your input");
  });
});
