/**
 * CLIPathCandidates — ordered filesystem candidates for the Claude CLI binary.
 *
 * GUI-launched apps (like Zotero) inherit a minimal PATH, so a bare `claude`
 * lookup fails even when the CLI is installed. This mirrors Claudian's
 * discovery list (utils/env.ts + findClaudeCLIPath.ts) with one Zotero-specific
 * constraint: Gecko's Subprocess spawns executables directly, so npm package
 * entrypoints (cli.js, requires `node`) and Windows .cmd / extension-less
 * shims are excluded — only real executables are candidates.
 */

export interface CandidateContext {
  /** True on Windows (candidates become claude.exe). */
  readonly isWindows: boolean;
  /** User home directory, or "" when unknown. */
  readonly home: string;
  /** Environment variable lookup (undefined when unset). */
  readonly getEnv: (name: string) => string | undefined;
}

function joiner(isWindows: boolean): (...parts: string[]) => string {
  const sep = isWindows ? "\\" : "/";
  return (...parts) =>
    parts
      .filter((p) => p.length > 0)
      .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
      .join(sep);
}

function parsePathEntries(value: string | undefined, isWindows: boolean): readonly string[] {
  if (!value) return [];
  return value
    .split(isWindows ? ";" : ":")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function dedupe(entries: readonly string[], isWindows: boolean): readonly string[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = isWindows ? entry.toLowerCase() : entry;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Directories worth searching beyond PATH, mirroring Claudian's list. */
export function buildExtraBinaryDirs(ctx: CandidateContext): readonly string[] {
  const { isWindows, home, getEnv } = ctx;
  const join = joiner(isWindows);
  const dirs: string[] = [];

  if (isWindows) {
    const appData = getEnv("APPDATA");
    const localAppData = getEnv("LOCALAPPDATA");
    const programFiles = getEnv("ProgramFiles") ?? "C:\\Program Files";
    if (appData) dirs.push(join(appData, "npm"));
    const nvmSymlink = getEnv("NVM_SYMLINK");
    if (nvmSymlink) dirs.push(nvmSymlink);
    const voltaHome = getEnv("VOLTA_HOME");
    if (voltaHome) dirs.push(join(voltaHome, "bin"));
    else if (home) dirs.push(join(home, ".volta", "bin"));
    const scoop = getEnv("SCOOP");
    if (scoop) dirs.push(join(scoop, "shims"));
    else if (home) dirs.push(join(home, "scoop", "shims"));
    if (localAppData) dirs.push(join(localAppData, "Programs", "nodejs"));
    dirs.push(join(programFiles, "nodejs"));
    if (home) {
      dirs.push(join(home, "bin"));
      dirs.push(join(home, ".local", "bin"));
      dirs.push(join(home, ".bun", "bin"));
      dirs.push(join(home, ".opencode", "bin"));
    }
    return dedupe(dirs, isWindows);
  }

  dirs.push("/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin");
  const voltaHome = getEnv("VOLTA_HOME");
  if (voltaHome) dirs.push(join(voltaHome, "bin"));
  const asdfRoot = getEnv("ASDF_DATA_DIR") ?? getEnv("ASDF_DIR");
  if (asdfRoot) {
    dirs.push(join(asdfRoot, "shims"));
    dirs.push(join(asdfRoot, "bin"));
  }
  const fnmMultishell = getEnv("FNM_MULTISHELL_PATH");
  if (fnmMultishell) dirs.push(join(fnmMultishell, "bin"));
  if (home) {
    dirs.push(join(home, "bin"));
    dirs.push(join(home, ".local", "bin"));
    dirs.push(join(home, ".bun", "bin"));
    dirs.push(join(home, ".opencode", "bin"));
    dirs.push(join(home, ".volta", "bin"));
    dirs.push(join(home, ".asdf", "shims"));
    dirs.push(join(home, ".asdf", "bin"));
  }
  const nvmBin = getEnv("NVM_BIN");
  if (nvmBin) dirs.push(nvmBin);
  return dedupe(dirs, isWindows);
}

/**
 * PATH value for spawned CLI processes: common binary dirs prepended to the
 * inherited PATH. GUI-launched Zotero's PATH lacks e.g. /opt/homebrew/bin,
 * which breaks shebang scripts (an npm-installed codex.js needs `node`).
 */
export function buildAugmentedPath(
  ctx: CandidateContext,
  currentPath: string | undefined
): string {
  const sep = ctx.isWindows ? ";" : ":";
  return dedupe(
    [...buildExtraBinaryDirs(ctx), ...parsePathEntries(currentPath, ctx.isWindows)],
    ctx.isWindows
  ).join(sep);
}

/**
 * Generic candidate builder: provider-specific well-known file paths first,
 * then `<extra binary dir>/<binary>`, then `<PATH entry>/<binary>`.
 */
export function buildBinaryCandidates(
  ctx: CandidateContext,
  binary: string,
  wellKnownFiles: readonly string[]
): readonly string[] {
  const join = joiner(ctx.isWindows);
  const candidates: string[] = [...wellKnownFiles];
  for (const dir of buildExtraBinaryDirs(ctx)) {
    candidates.push(join(dir, binary));
  }
  for (const dir of parsePathEntries(ctx.getEnv("PATH"), ctx.isWindows)) {
    candidates.push(join(dir, binary));
  }
  return dedupe(candidates, ctx.isWindows);
}

/**
 * Ordered absolute file paths to probe for the Claude CLI.
 * Well-known install locations first, then extra binary dirs, then PATH.
 */
export function buildClaudeCandidates(ctx: CandidateContext): readonly string[] {
  const { isWindows, home, getEnv } = ctx;
  const join = joiner(isWindows);
  const binary = isWindows ? "claude.exe" : "claude";
  const candidates: string[] = [];

  if (isWindows) {
    const localAppData = getEnv("LOCALAPPDATA");
    const programFiles = getEnv("ProgramFiles") ?? "C:\\Program Files";
    if (home) {
      candidates.push(join(home, ".claude", "local", binary));
      candidates.push(join(home, ".local", "bin", binary));
    }
    if (localAppData) candidates.push(join(localAppData, "Claude", binary));
    candidates.push(join(programFiles, "Claude", binary));
  } else if (home) {
    candidates.push(join(home, ".claude", "local", binary));
    candidates.push(join(home, ".local", "bin", binary));
    candidates.push(join(home, ".npm-global", "bin", binary));
    const npmPrefix = getEnv("npm_config_prefix");
    if (npmPrefix) candidates.push(join(npmPrefix, "bin", binary));
  }

  for (const dir of buildExtraBinaryDirs(ctx)) {
    candidates.push(join(dir, binary));
  }
  for (const dir of parsePathEntries(getEnv("PATH"), isWindows)) {
    candidates.push(join(dir, binary));
  }

  return dedupe(candidates, isWindows);
}
