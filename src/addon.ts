export class Addon {
  readonly id = "clautero@zotero-plugin";
  readonly rootURI: string;

  constructor(rootURI: string) {
    this.rootURI = rootURI;
  }

  get dataDir(): string {
    return PathUtils.join(Zotero.DataDirectory.dir, "clautero");
  }

  get workspaceDir(): string {
    return PathUtils.join(this.dataDir, "workspace");
  }

  get sessionsDir(): string {
    return PathUtils.join(this.dataDir, "sessions");
  }

  get commandsDir(): string {
    const customDir = Zotero.Prefs.get(
      "extensions.clautero.commandsDir",
      true
    ) as string;
    if (customDir) {
      return customDir;
    }
    return PathUtils.join(this.dataDir, "commands");
  }

  async ensureDirectories(): Promise<void> {
    await IOUtils.makeDirectory(this.dataDir, { ignoreExisting: true });
    await IOUtils.makeDirectory(this.workspaceDir, { ignoreExisting: true });
    await IOUtils.makeDirectory(this.sessionsDir, { ignoreExisting: true });
    await IOUtils.makeDirectory(this.commandsDir, { ignoreExisting: true });
  }
}
