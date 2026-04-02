// Import Gecko's subprocess module for pathSearch
const { Subprocess } = ChromeUtils.importESModule(
  "resource://gre/modules/Subprocess.sys.mjs"
);

const KNOWN_PATHS = [
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
] as const;

let cachedPath: string | null = null;

function getHomeBinPath(): string {
  const home = PathUtils.join(PathUtils.profileDir, "..");
  return PathUtils.join(home, ".claude", "local", "claude");
}

async function tryPath(candidate: string): Promise<string | null> {
  try {
    const exists = await IOUtils.exists(candidate);
    return exists ? candidate : null;
  } catch {
    return null;
  }
}

async function resolveFromPreference(): Promise<string | null> {
  const configured = Zotero.Prefs.get(
    "extensions.clautero.claudeCliPath",
    true
  ) as string | undefined;

  if (!configured) {
    return null;
  }

  const valid = await tryPath(configured);
  if (!valid) {
    Zotero.log(
      `[Clautero] Configured CLI path does not exist: ${configured}`,
      "warning"
    );
  }
  return valid;
}

async function resolveFromPathSearch(): Promise<string | null> {
  try {
    const found = await Subprocess.pathSearch("claude");
    return found ?? null;
  } catch {
    return null;
  }
}

async function resolveFromKnownPaths(): Promise<string | null> {
  const candidates = [...KNOWN_PATHS, getHomeBinPath()];

  for (const candidate of candidates) {
    const valid = await tryPath(candidate);
    if (valid) {
      return valid;
    }
  }
  return null;
}

export async function resolveCLIPath(): Promise<string> {
  if (cachedPath) {
    return cachedPath;
  }

  const resolvers = [
    resolveFromPreference,
    resolveFromPathSearch,
    resolveFromKnownPaths,
  ];

  for (const resolver of resolvers) {
    const result = await resolver();
    if (result) {
      cachedPath = result;
      Zotero.log(`[Clautero] Resolved CLI path: ${result}`, "info");
      return result;
    }
  }

  throw new Error(
    "Claude CLI not found. Install it or set the path in Clautero preferences."
  );
}

export function clearCLIPathCache(): void {
  cachedPath = null;
}
