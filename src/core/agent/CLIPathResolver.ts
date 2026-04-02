/**
 * CLIPathResolver — Returns the Claude CLI command.
 * Assumes `claude` is already on PATH.
 */

export async function resolveCLIPath(): Promise<string> {
  // Check user preference first
  try {
    const configured = Zotero.Prefs.get(
      "extensions.clautero.claudeCliPath",
      true
    ) as string | undefined;
    if (configured) {
      return configured;
    }
  } catch {
    // ignore pref errors
  }

  return "claude";
}

export function clearCLIPathCache(): void {
  // no-op, kept for API compat
}
