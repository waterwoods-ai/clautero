/**
 * CLIPathResolver — Finds the Claude CLI binary.
 *
 * Gecko's Subprocess.call() needs an absolute path to a real executable
 * (no PATH resolution, no symlink following). We check known locations
 * and resolve symlinks by reading the link target.
 */

const { Subprocess } = ChromeUtils.importESModule(
  "resource://gre/modules/Subprocess.sys.mjs"
);

const KNOWN_PATHS = [
  // Common Claude CLI install locations
  "${HOME}/.local/bin/claude",
  "${HOME}/.claude/local/claude",
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
] as const;

function expandHome(p: string): string {
  // Use Zotero's data directory parent as a proxy for $HOME
  // PathUtils.profileDir is like /Users/tom/Library/Application Support/Zotero/Profiles/xxx
  // We need /Users/tom
  try {
    const profile = PathUtils.profileDir;
    // Walk up to find the home directory (macOS: /Users/xxx)
    const parts = profile.split("/");
    const homeIdx = parts.indexOf("Users");
    if (homeIdx >= 0 && parts.length > homeIdx + 1) {
      const home = parts.slice(0, homeIdx + 2).join("/");
      return p.replace("${HOME}", home);
    }
    // Linux fallback
    const libIdx = parts.indexOf(".local") || parts.indexOf("Library");
    if (libIdx >= 2) {
      const home = parts.slice(0, libIdx).join("/");
      return p.replace("${HOME}", home);
    }
  } catch { /* ignore */ }
  return p.replace("${HOME}", "/Users/unknown");
}

/**
 * Check if a path exists. If it's a symlink, try to resolve it
 * by reading the file at the symlink target directory.
 */
async function resolveRealPath(candidate: string): Promise<string | null> {
  try {
    const exists = await IOUtils.exists(candidate);
    if (!exists) return null;

    // Try to use Subprocess.pathSearch to get the real path
    // This handles symlinks better than IOUtils.exists
    try {
      const stat = await IOUtils.stat(candidate);
      if (stat.size > 0) {
        // It's a real file (or symlink that IOUtils can stat)
        return candidate;
      }
    } catch { /* ignore */ }

    return candidate;
  } catch {
    return null;
  }
}

/**
 * For symlinks like ~/.local/bin/claude -> ~/.local/share/claude/versions/X.Y.Z,
 * find the actual binary by looking in the versions directory.
 */
async function findVersionedBinary(home: string): Promise<string | null> {
  const versionsDir = `${home}/.local/share/claude/versions`;
  try {
    const exists = await IOUtils.exists(versionsDir);
    if (!exists) return null;

    const children = await IOUtils.getChildren(versionsDir);
    // Sort to get the latest version
    const sorted = children.sort().reverse();
    for (const child of sorted) {
      try {
        const stat = await IOUtils.stat(child);
        if (stat.size > 0) {
          Zotero.log(`[Clautero] Found versioned Claude binary: ${child}`, "info");
          return child;
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return null;
}

let cachedPath: string | null = null;

export async function resolveCLIPath(): Promise<string> {
  if (cachedPath) return cachedPath;

  // 1. User preference
  try {
    const configured = Zotero.Prefs.get(
      "extensions.clautero.claudeCliPath", true
    ) as string | undefined;
    if (configured) {
      cachedPath = configured;
      Zotero.log(`[Clautero] Using configured CLI path: ${configured}`, "info");
      return configured;
    }
  } catch { /* ignore */ }

  // 2. Try known paths
  for (const tmpl of KNOWN_PATHS) {
    const p = expandHome(tmpl);
    const resolved = await resolveRealPath(p);
    if (resolved) {
      cachedPath = resolved;
      Zotero.log(`[Clautero] Found Claude CLI at: ${resolved}`, "info");
      return resolved;
    }
  }

  // 3. Try versioned binary directory (resolves symlink issue)
  const home = expandHome("${HOME}");
  const versioned = await findVersionedBinary(home);
  if (versioned) {
    cachedPath = versioned;
    return versioned;
  }

  // 4. Try Subprocess.pathSearch
  try {
    const found = await Subprocess.pathSearch("claude");
    if (found) {
      cachedPath = found;
      Zotero.log(`[Clautero] Found Claude via pathSearch: ${found}`, "info");
      return found;
    }
  } catch { /* ignore */ }

  throw new Error(
    "Claude CLI not found. Set the path in Zotero Preferences → Clautero."
  );
}

export function clearCLIPathCache(): void {
  cachedPath = null;
}
