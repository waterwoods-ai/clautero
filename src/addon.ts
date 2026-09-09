const WORKSPACE_GUIDE = [
  "# Clautero Workspace Guide",
  "",
  "<!-- Seeded by Clautero on first run. Edit freely - Clautero never overwrites this file. -->",
  "",
  "## Response formatting",
  "",
  "- When writing math, ALWAYS use LaTeX delimiters: `$...$` for inline math, `$$...$$` for display math.",
  "- Never write formulas as plain Unicode or pseudo-notation (Θ_A, x_i, ∂L/∂θ) —",
  "  write `$\\Theta_A$`, `$x_i$`, `$\\partial L/\\partial \\theta$` instead.",
  "- Use GFM tables (pipe syntax with a `|---|` separator row) for tabular content.",
  "- Put code in fenced code blocks with a language tag.",
  "",
].join("\n");

export class Addon {
  readonly id = "clautero@zotero-plugin";
  readonly rootURI: string;
  private _dataDir: string | null = null;

  constructor(rootURI: string) {
    this.rootURI = rootURI;
  }

  /**
   * Join path segments. PathUtils.join fails on Windows with OneDrive paths
   * containing special characters. Fall back to string concatenation.
   */
  private safePath(...parts: string[]): string {
    try {
      return PathUtils.join(...parts);
    } catch {
      // Fallback: detect separator and join manually
      const sep = parts[0]?.includes("\\") ? "\\" : "/";
      return parts.join(sep);
    }
  }

  get dataDir(): string {
    if (this._dataDir) return this._dataDir;

    // Try custom workspace first
    try {
      const custom = Zotero.Prefs.get(
        "extensions.clautero.workspaceDir", true
      ) as string;
      if (custom && custom.trim().length > 0) {
        this._dataDir = custom.trim();
        return this._dataDir;
      }
    } catch { /* ignore */ }

    // Try Zotero profile dir (usually simple path without OneDrive)
    try {
      const dir = this.safePath(PathUtils.profileDir, "clautero");
      this._dataDir = dir;
      return dir;
    } catch { /* ignore */ }

    // Try temp dir
    try {
      const dir = this.safePath(PathUtils.tempDir, "clautero");
      this._dataDir = dir;
      return dir;
    } catch {
      this._dataDir = "C:\\Temp\\clautero";
      return this._dataDir;
    }
  }

  get workspaceDir(): string {
    return this.safePath(this.dataDir, "workspace");
  }

  get sessionsDir(): string {
    return this.safePath(this.dataDir, "sessions");
  }

  get commandsDir(): string {
    try {
      const customDir = Zotero.Prefs.get(
        "extensions.clautero.commandsDir", true
      ) as string;
      if (customDir && customDir.trim()) {
        return customDir.trim();
      }
    } catch { /* ignore */ }
    return this.safePath(this.dataDir, "commands");
  }

  /**
   * Seed formatting guidance into the workspace so every provider CLI
   * (CLAUDE.md for Claude Code, AGENTS.md for Codex/OpenCode/Pi) produces
   * renderable output. Existing files are never touched.
   */
  async ensureWorkspaceGuide(): Promise<void> {
    for (const name of ["CLAUDE.md", "AGENTS.md"]) {
      try {
        const path = this.safePath(this.workspaceDir, name);
        if (await IOUtils.exists(path)) continue;
        await IOUtils.writeUTF8(path, WORKSPACE_GUIDE);
        Zotero.log(`[Clautero] Seeded workspace guide: ${path}`, "info");
      } catch (e) {
        Zotero.log(`[Clautero] Could not seed workspace guide ${name}: ${e}`, "warning");
      }
    }
  }

  async ensureDirectories(): Promise<void> {
    const dirs = [this.dataDir, this.workspaceDir, this.sessionsDir, this.commandsDir];
    for (const dir of dirs) {
      try {
        await IOUtils.makeDirectory(dir, { ignoreExisting: true });
      } catch (e) {
        Zotero.log(`[Clautero] Could not create ${dir}: ${e}`, "warning");
      }
    }
  }
}
