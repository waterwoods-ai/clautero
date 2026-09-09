import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Addon } from "./addon";

const files = new Map<string, string>();

beforeEach(() => {
  files.clear();
  (globalThis as any).Zotero = {
    log: () => {},
    Prefs: { get: (key: string) => (key === "extensions.clautero.workspaceDir" ? "" : undefined) },
  };
  (globalThis as any).PathUtils = {
    join: (...parts: string[]) => parts.join("/"),
    profileDir: "/profile",
    tempDir: "/tmp",
  };
  (globalThis as any).IOUtils = {
    exists: async (p: string) => files.has(p),
    writeUTF8: async (p: string, content: string) => { files.set(p, content); },
    makeDirectory: async () => {},
  };
});
afterEach(() => {
  delete (globalThis as any).Zotero;
  delete (globalThis as any).PathUtils;
  delete (globalThis as any).IOUtils;
});

describe("ensureWorkspaceGuide", () => {
  it("seeds CLAUDE.md and AGENTS.md with LaTeX + table guidance", async () => {
    const addon = new Addon("root://");
    await addon.ensureWorkspaceGuide();
    const claude = files.get(addon.workspaceDir + "/CLAUDE.md");
    const agents = files.get(addon.workspaceDir + "/AGENTS.md");
    expect(claude).toBeTruthy();
    expect(agents).toBe(claude);
    expect(claude).toContain("$...$");
    expect(claude).toContain("\\Theta_A");
    expect(claude).toContain("|---|");
  });

  it("never overwrites an existing guide", async () => {
    const addon = new Addon("root://");
    files.set(addon.workspaceDir + "/CLAUDE.md", "my customized guide");
    await addon.ensureWorkspaceGuide();
    expect(files.get(addon.workspaceDir + "/CLAUDE.md")).toBe("my customized guide");
    expect(files.get(addon.workspaceDir + "/AGENTS.md")).toContain("Workspace Guide");
  });
});
