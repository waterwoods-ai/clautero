export class Addon {
  readonly id = "clautero@zotero-plugin";
  readonly rootURI: string;
  private _dataDir: string | null = null;

  constructor(rootURI: string) {
    this.rootURI = rootURI;
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

    // Try Zotero data dir
    try {
      const dir = PathUtils.join(Zotero.DataDirectory.dir, "clautero");
      this._dataDir = dir;
      return dir;
    } catch { /* PathUtils.join may fail on Windows with special chars */ }

    // Try profile dir (usually simpler path)
    try {
      const dir = PathUtils.join(PathUtils.profileDir, "clautero");
      this._dataDir = dir;
      return dir;
    } catch { /* ignore */ }

    // Last resort: temp dir
    try {
      const dir = PathUtils.join(PathUtils.tempDir, "clautero");
      this._dataDir = dir;
      return dir;
    } catch {
      // Absolute last resort — hardcode a simple path
      this._dataDir = "C:\\Temp\\clautero";
      return this._dataDir;
    }
  }

  get workspaceDir(): string {
    try {
      return PathUtils.join(this.dataDir, "workspace");
    } catch {
      return this.dataDir;
    }
  }

  get sessionsDir(): string {
    try {
      return PathUtils.join(this.dataDir, "sessions");
    } catch {
      return this.dataDir;
    }
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
    try {
      return PathUtils.join(this.dataDir, "commands");
    } catch {
      return this.dataDir;
    }
  }

  async ensureDirectories(): Promise<void> {
    const dirs = [this.dataDir, this.workspaceDir, this.sessionsDir, this.commandsDir];
    for (const dir of dirs) {
      try {
        await IOUtils.makeDirectory(dir, { ignoreExisting: true });
      } catch (e) {
        Zotero.log(`[Clautero] Could not create directory ${dir}: ${e}`, "warning");
      }
    }
  }
}
