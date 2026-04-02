/**
 * CLIPathResolver — Resolves the absolute path to the Claude CLI binary.
 * Gecko's Subprocess.call requires a real executable path (not a name on PATH).
 */

const { Subprocess } = ChromeUtils.importESModule(
  "resource://gre/modules/Subprocess.sys.mjs"
);

export async function resolveCLIPath(): Promise<string> {
  // 1. Check user preference
  try {
    const configured = Zotero.Prefs.get(
      "extensions.clautero.claudeCliPath",
      true
    ) as string | undefined;
    if (configured) {
      Zotero.log(`[Clautero] Using configured CLI path: ${configured}`, "info");
      return configured;
    }
  } catch {
    // ignore pref errors
  }

  // 2. Use Subprocess.pathSearch — this properly resolves PATH and symlinks
  try {
    const found = await Subprocess.pathSearch("claude");
    if (found) {
      Zotero.log(`[Clautero] Found Claude via pathSearch: ${found}`, "info");
      return found;
    }
  } catch (error) {
    Zotero.log(`[Clautero] pathSearch failed: ${error}`, "warning");
  }

  // 3. Try known absolute paths
  const knownPaths = [
    "/Users/tom/.local/bin/claude",
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];

  for (const p of knownPaths) {
    try {
      const exists = await IOUtils.exists(p);
      if (exists) {
        Zotero.log(`[Clautero] Found Claude at known path: ${p}`, "info");
        return p;
      }
    } catch {
      // continue
    }
  }

  throw new Error(
    "Claude CLI not found. Set the path in Clautero preferences."
  );
}

export function clearCLIPathCache(): void {
  // no-op
}
