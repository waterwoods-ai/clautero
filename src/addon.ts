export class Addon {
  readonly id = "clautero@zotero-plugin";
  readonly rootURI: string;

  constructor(rootURI: string) {
    this.rootURI = rootURI;
  }

  get dataDir(): string {
    // Try custom workspace first, then Zotero data dir, then temp fallback
    try {
      const custom = Zotero.Prefs.get(
        "extensions.clautero.workspaceDir", true
      ) as string;
      if (custom && custom.trim().length > 0) {
        return custom.trim();
      }
    } catch { /* ignore */ }

    try {
      return PathUtils.join(Zotero.DataDirectory.dir, "clautero");
    } catch {
      // Fallback for paths with special characters
      return PathUtils.join(PathUtils.tempDir, "clautero");
    }
  }

  get workspaceDir(): string {
    return PathUtils.join(this.dataDir, "workspace");
  }

  get sessionsDir(): string {
    return PathUtils.join(this.dataDir, "sessions");
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
    return PathUtils.join(this.dataDir, "commands");
  }

  async ensureDirectories(): Promise<void> {
    const dirs = [this.dataDir, this.workspaceDir, this.sessionsDir, this.commandsDir];
    for (const dir of dirs) {
      try {
        await IOUtils.makeDirectory(dir, { ignoreExisting: true });
      } catch (e) {
        Zotero.log(`[Clautero] Could not create directory ${dir}: ${e}`, "warning");
        // Non-fatal — continue startup even if directories fail
      }
    }
  }
}
