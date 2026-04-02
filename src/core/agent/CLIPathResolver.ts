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
  // Gecko subprocess doesn't inherit user shell PATH, even with login shell.
  // Use the known absolute path directly.
  return "/Users/tom/.local/bin/claude";
}

export function clearCLIPathCache(): void {
  // no-op
}
