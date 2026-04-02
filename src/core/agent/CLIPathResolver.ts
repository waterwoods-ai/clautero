/**
 * CLIPathResolver — Returns the absolute path to the Claude CLI binary.
 * Gecko's Subprocess.call requires an absolute path.
 */

const KNOWN_PATHS = [
  "/Users/tom/.local/bin/claude",
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
] as const;

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

  // Try known paths
  for (const p of KNOWN_PATHS) {
    try {
      const exists = await IOUtils.exists(p);
      if (exists) {
        Zotero.log(`[Clautero] Found Claude CLI at: ${p}`, "info");
        return p;
      }
    } catch {
      // continue
    }
  }

  // Try Subprocess.pathSearch as last resort
  try {
    const { Subprocess } = ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs"
    );
    const found = await Subprocess.pathSearch("claude");
    if (found) {
      Zotero.log(`[Clautero] Found Claude CLI via pathSearch: ${found}`, "info");
      return found;
    }
  } catch {
    // pathSearch may not be available
  }

  throw new Error(
    "Claude CLI not found. Set the path in Clautero preferences."
  );
}

export function clearCLIPathCache(): void {
  // no-op, kept for API compat
}
