/**
 * CLIPathResolver — Returns the claude command name or path.
 * Since we spawn via /bin/sh -c, PATH resolution is handled by the shell.
 */

export async function resolveCLIPath(): Promise<string> {
  try {
    const configured = Zotero.Prefs.get(
      "extensions.clautero.claudeCliPath",
      true
    ) as string | undefined;
    if (configured) {
      return configured;
    }
  } catch {
    // ignore
  }
  return "claude";
}

export function clearCLIPathCache(): void {
  // no-op
}
