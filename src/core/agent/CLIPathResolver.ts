/**
 * CLIPathResolver — locates a provider's CLI executable.
 *
 * Resolution order (per provider):
 *   1. User preference `extensions.clautero.cliPath.<provider>` (for Claude,
 *      the legacy `extensions.clautero.claudeCliPath` is honored too).
 *   2. Auto-detection: provider well-known install paths, then common binary
 *      dirs, then PATH (see CLIPathCandidates). GUI-launched Zotero has a
 *      minimal PATH, so probing absolute locations is what makes setup work.
 *   3. Error → the UI shows the manual-path setup prompt.
 */

import {
  buildAugmentedPath,
  buildBinaryCandidates,
  type CandidateContext,
} from "./CLIPathCandidates";
import type { ProviderModule } from "../providers/types";
import { claudeProvider } from "../providers/claude";

const cachedPaths = new Map<string, string>();

function getEnvSafe(name: string): string | undefined {
  try {
    const { Services: GeckoServices } = ChromeUtils.importESModule(
      "resource://gre/modules/Services.sys.mjs"
    ) as { Services: { env: { get: (n: string) => string } } };
    const value = GeckoServices.env.get(name);
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function getHomeDir(isWindows: boolean): string {
  // Gecko's directory service is the authoritative source and does not
  // depend on the (minimal) environment a GUI-launched Zotero inherits.
  try {
    const { Services: GeckoServices } = ChromeUtils.importESModule(
      "resource://gre/modules/Services.sys.mjs"
    ) as { Services: { dirsvc: { get: (key: string, iface: unknown) => { path: string } } } };
    const home = GeckoServices.dirsvc.get("Home", Components.interfaces.nsIFile).path;
    if (home && home.length > 0) return home;
  } catch { /* fall through to env */ }
  return (isWindows ? getEnvSafe("USERPROFILE") : getEnvSafe("HOME")) ?? "";
}

function runtimeContext(): CandidateContext {
  const isWindows = typeof Zotero !== "undefined" && (Zotero as { isWin?: boolean }).isWin === true;
  return { isWindows, home: getHomeDir(isWindows), getEnv: getEnvSafe };
}

async function isExistingFile(path: string): Promise<boolean> {
  try {
    return await IOUtils.exists(path);
  } catch {
    return false;
  }
}

function prefKeysFor(provider: ProviderModule): readonly string[] {
  const keys = [`extensions.clautero.cliPath.${provider.id}`];
  if (provider.id === "claude") keys.push("extensions.clautero.claudeCliPath");
  return keys;
}

function getConfiguredPath(provider: ProviderModule): string | null {
  for (const key of prefKeysFor(provider)) {
    try {
      const value = Zotero.Prefs.get(key, true) as string | undefined;
      if (value && value.trim().length > 0) return value.trim();
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Last-resort detection: ask the user's own login shell, which sees the
 * same PATH as their terminal — the ground truth for "but it IS installed".
 */
async function shellResolve(binary: string): Promise<string | null> {
  try {
    const { Subprocess: Sub } = ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs"
    ) as { Subprocess: typeof Subprocess };
    const { setTimeout: geckoSetTimeout } = ChromeUtils.importESModule(
      "resource://gre/modules/Timer.sys.mjs"
    ) as { setTimeout: (fn: () => void, ms: number) => number };

    const shell = getEnvSafe("SHELL") ?? "/bin/zsh";
    const proc = await Sub.call({
      command: shell,
      arguments: ["-l", "-i", "-c", `command -v ${binary}`],
      stderr: "pipe",
    });

    const readAll = (async () => {
      let out = "";
      for (;;) {
        const data = await proc.stdout.readString();
        if (!data || data.length === 0) break;
        out += data;
      }
      await proc.wait();
      return out;
    })();
    // A broken shell rc must not hang the probe.
    const timedOut = new Promise<null>((resolve) => {
      geckoSetTimeout(() => { try { proc.kill(); } catch { /* gone */ } resolve(null); }, 4000);
    });

    const output = await Promise.race([readAll, timedOut]);
    if (typeof output !== "string") return null;
    const line = output.trim().split("\n").pop()?.trim() ?? "";
    if (line.startsWith("/") && (await isExistingFile(line))) {
      return line;
    }
  } catch (e) {
    Zotero.log(`[Clautero] Shell resolution for ${binary} failed: ${e}`, "warning");
  }
  return null;
}

/**
 * Environment for spawned provider CLIs: augmented PATH so shebang scripts
 * (npm-installed CLIs) can find their interpreter. Merged into the inherited
 * environment via environmentAppend.
 */
export function getSpawnEnvironment(): Record<string, string> {
  const ctx = runtimeContext();
  return { PATH: buildAugmentedPath(ctx, ctx.getEnv("PATH")) };
}

async function autoDetect(provider: ProviderModule): Promise<string | null> {
  const ctx = runtimeContext();
  const binary = ctx.isWindows ? provider.binaryName.windows : provider.binaryName.unix;
  const candidates = buildBinaryCandidates(ctx, binary, provider.wellKnownPaths(ctx));
  for (const candidate of candidates) {
    if (await isExistingFile(candidate)) {
      return candidate;
    }
  }
  if (!ctx.isWindows) {
    const binaryName = provider.binaryName.unix;
    const viaShell = await shellResolve(binaryName);
    if (viaShell) {
      Zotero.log(`[Clautero] ${provider.label} CLI resolved via login shell: ${viaShell}`, "info");
      return viaShell;
    }
  }
  Zotero.log(
    `[Clautero] ${provider.label} CLI not detected ` +
    `(home="${ctx.home}", probed ${candidates.length} paths + login shell)`,
    "info"
  );
  return null;
}

export async function resolveProviderCLIPath(provider: ProviderModule): Promise<string> {
  const cached = cachedPaths.get(provider.id);
  if (cached) return cached;

  const configured = getConfiguredPath(provider);
  if (configured) {
    cachedPaths.set(provider.id, configured);
    Zotero.log(`[Clautero] Using configured ${provider.label} CLI path: ${configured}`, "info");
    return configured;
  }

  const detected = await autoDetect(provider);
  if (detected) {
    cachedPaths.set(provider.id, detected);
    Zotero.log(`[Clautero] Auto-detected ${provider.label} CLI: ${detected}`, "info");
    return detected;
  }

  throw new Error(
    `${provider.label} CLI not found. Install it, or set the ` +
    `"extensions.clautero.cliPath.${provider.id}" preference to the full binary path.`
  );
}

/** True when the provider's binary can be resolved (configured or detected). */
export async function isProviderAvailable(provider: ProviderModule): Promise<boolean> {
  try {
    await resolveProviderCLIPath(provider);
    return true;
  } catch {
    return false;
  }
}

/** Legacy Claude-only entry point. */
export async function resolveCLIPath(): Promise<string> {
  return resolveProviderCLIPath(claudeProvider);
}

export function clearCLIPathCache(): void {
  cachedPaths.clear();
}
