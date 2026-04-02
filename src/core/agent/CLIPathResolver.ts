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
  // Gecko Subprocess.call needs a real executable path (may not follow symlinks).
  // ~/.local/bin/claude is a symlink. Use the resolved target.
  return "/Users/tom/.local/share/claude/versions/2.1.90";
}

export function clearCLIPathCache(): void {
  // no-op
}
