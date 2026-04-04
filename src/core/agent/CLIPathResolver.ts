/**
 * CLIPathResolver — Returns the Claude CLI path from plugin preferences.
 *
 * Users must set the path in Zotero Preferences → Clautero.
 * This works on all platforms (macOS, Linux, Windows).
 */

let cachedPath: string | null = null;

export async function resolveCLIPath(): Promise<string> {
  if (cachedPath) return cachedPath;

  try {
    const configured = Zotero.Prefs.get(
      "extensions.clautero.claudeCliPath", true
    ) as string | undefined;

    if (configured && configured.trim().length > 0) {
      cachedPath = configured.trim();
      Zotero.log(`[Clautero] Using Claude CLI path: ${cachedPath}`, "info");
      return cachedPath;
    }
  } catch { /* ignore */ }

  throw new Error(
    "Claude CLI path not configured. Go to Zotero Preferences → Clautero and set the path to your claude binary."
  );
}

export function clearCLIPathCache(): void {
  cachedPath = null;
}
