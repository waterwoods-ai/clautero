import { describe, it, expect } from "vitest";
import { buildClaudeCandidates, buildExtraBinaryDirs, buildAugmentedPath, type CandidateContext } from "./CLIPathCandidates";

function ctx(overrides: Partial<CandidateContext> & { env?: Record<string, string> } = {}): CandidateContext {
  const env = overrides.env ?? {};
  return {
    isWindows: overrides.isWindows ?? false,
    home: overrides.home ?? "/Users/alice",
    getEnv: (name) => env[name],
  };
}

describe("CLIPathCandidates", () => {
  it("puts well-known Unix install locations before PATH entries", () => {
    const c = buildClaudeCandidates(ctx({ env: { PATH: "/somewhere/bin" } }));
    expect(c[0]).toBe("/Users/alice/.claude/local/claude");
    expect(c[1]).toBe("/Users/alice/.local/bin/claude");
    expect(c).toContain("/opt/homebrew/bin/claude");
    expect(c.indexOf("/opt/homebrew/bin/claude")).toBeLessThan(c.indexOf("/somewhere/bin/claude"));
  });

  it("expands version-manager env vars on Unix", () => {
    const c = buildClaudeCandidates(ctx({
      env: { VOLTA_HOME: "/opt/volta", NVM_BIN: "/nvm/v22/bin", npm_config_prefix: "/npm-prefix" },
    }));
    expect(c).toContain("/opt/volta/bin/claude");
    expect(c).toContain("/nvm/v22/bin/claude");
    expect(c).toContain("/npm-prefix/bin/claude");
  });

  it("emits only claude.exe on Windows (no .cmd or bare shims)", () => {
    const c = buildClaudeCandidates(ctx({
      isWindows: true,
      home: "C:\\Users\\Alice",
      env: { PATH: "C:\\Users\\Alice\\AppData\\Roaming\\npm", APPDATA: "C:\\Users\\Alice\\AppData\\Roaming" },
    }));
    expect(c.length).toBeGreaterThan(0);
    for (const p of c) expect(p.endsWith("claude.exe")).toBe(true);
    expect(c[0]).toBe("C:\\Users\\Alice\\.claude\\local\\claude.exe");
  });

  it("splits PATH with the platform separator", () => {
    const unix = buildClaudeCandidates(ctx({ env: { PATH: "/a:/b" } }));
    expect(unix).toContain("/a/claude");
    expect(unix).toContain("/b/claude");
    const win = buildClaudeCandidates(ctx({
      isWindows: true, home: "C:\\U", env: { PATH: "C:\\a;C:\\b" },
    }));
    expect(win).toContain("C:\\a\\claude.exe");
    expect(win).toContain("C:\\b\\claude.exe");
  });

  it("dedupes case-insensitively on Windows only", () => {
    const win = buildClaudeCandidates(ctx({
      isWindows: true, home: "C:\\U", env: { PATH: "C:\\Dir;c:\\dir" },
    }));
    expect(win.filter((p) => p.toLowerCase() === "c:\\dir\\claude.exe")).toHaveLength(1);
  });

  it("omits home-relative paths when home is unknown", () => {
    const c = buildClaudeCandidates(ctx({ home: "", env: {} }));
    expect(c.every((p) => p.startsWith("/"))).toBe(true);
    expect(c).toContain("/usr/local/bin/claude");
  });

  it("builds extra dirs without duplicates", () => {
    const dirs = buildExtraBinaryDirs(ctx({ env: { VOLTA_HOME: "/Users/alice/.volta" } }));
    expect(dirs.filter((d) => d === "/Users/alice/.volta/bin")).toHaveLength(1);
  });
});

describe("buildAugmentedPath", () => {
  it("prepends common binary dirs to the inherited PATH, deduped", () => {
    const augmented = buildAugmentedPath(
      { isWindows: false, home: "/Users/alice", getEnv: (n) => (n === "X" ? "y" : undefined) },
      "/usr/bin:/opt/homebrew/bin"
    );
    const parts = augmented.split(":");
    expect(parts).toContain("/opt/homebrew/bin");
    expect(parts).toContain("/Users/alice/.opencode/bin");
    expect(parts.indexOf("/opt/homebrew/bin")).toBeLessThan(parts.indexOf("/usr/bin") + 1);
    expect(parts.filter((p) => p === "/opt/homebrew/bin")).toHaveLength(1);
  });
});
