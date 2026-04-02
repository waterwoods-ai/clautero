import { createNDJSONParser } from "./NDJSONParser";
import type { StreamChunk } from "./types";

// Import Gecko's subprocess module at runtime
const { Subprocess } = ChromeUtils.importESModule(
  "resource://gre/modules/Subprocess.sys.mjs"
);

const PID_FILENAME = "clautero-claude.pid";

export interface SubprocessManagerOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly workdir: string;
  readonly dataDir: string;
  readonly onChunk: (chunk: StreamChunk) => void;
  readonly onExit: (exitCode: number) => void;
  readonly onError: (error: Error) => void;
}

function getPidFilePath(dataDir: string): string {
  return PathUtils.join(dataDir, PID_FILENAME);
}

async function writePidFile(
  dataDir: string,
  pid: number
): Promise<void> {
  try {
    const pidPath = getPidFilePath(dataDir);
    await IOUtils.writeUTF8(pidPath, String(pid));
  } catch (error) {
    Zotero.log(
      `[Clautero] Failed to write PID file: ${error}`,
      "warning"
    );
  }
}

async function removePidFile(dataDir: string): Promise<void> {
  try {
    const pidPath = getPidFilePath(dataDir);
    const exists = await IOUtils.exists(pidPath);
    if (exists) {
      await IOUtils.remove(pidPath);
    }
  } catch (error) {
    Zotero.log(
      `[Clautero] Failed to remove PID file: ${error}`,
      "warning"
    );
  }
}

export async function cleanupOrphanedProcess(
  dataDir: string
): Promise<void> {
  try {
    const pidPath = getPidFilePath(dataDir);
    const exists = await IOUtils.exists(pidPath);
    if (!exists) {
      return;
    }

    const content = await IOUtils.readUTF8(pidPath);
    const pid = parseInt(content.trim(), 10);

    if (isNaN(pid)) {
      await IOUtils.remove(pidPath);
      return;
    }

    Zotero.log(
      `[Clautero] Found orphaned PID file (pid=${pid}), cleaning up`,
      "warning"
    );

    // Attempt to kill the orphaned process via a short-lived subprocess
    try {
      const killProc = await Subprocess.call({
        command: "/bin/kill",
        arguments: ["-TERM", String(pid)],
      });
      await killProc.wait();
    } catch {
      // Process may already be dead; that is fine
    }

    await IOUtils.remove(pidPath);
  } catch (error) {
    Zotero.log(
      `[Clautero] Error during orphan cleanup: ${error}`,
      "warning"
    );
  }
}

export function createSubprocessManager(options: SubprocessManagerOptions) {
  let process: SubprocessInstance | null = null;
  let running = false;

  const parser = createNDJSONParser({
    onMessage: options.onChunk,
    onParseError: (line, error) => {
      Zotero.log(
        `[Clautero] NDJSON parse error: ${error.message} | line: ${line}`,
        "warning"
      );
    },
  });

  async function readStdoutLoop(proc: SubprocessInstance): Promise<void> {
    try {
      while (running) {
        const data = await proc.stdout.readString();
        if (data.length === 0) {
          break;
        }
        parser.feed(data);
      }
      parser.flush();
    } catch (error) {
      if (running) {
        options.onError(
          error instanceof Error
            ? error
            : new Error(`Stdout read error: ${error}`)
        );
      }
    }
  }

  async function readStderrLoop(proc: SubprocessInstance): Promise<void> {
    if (!proc.stderr) {
      return;
    }

    try {
      while (running) {
        const data = await proc.stderr.readString();
        if (data.length === 0) {
          break;
        }
        Zotero.log(`[Clautero] stderr: ${data.trim()}`, "warning");
      }
    } catch {
      // Stderr read failure is non-critical
    }
  }

  async function start(): Promise<void> {
    if (running) {
      throw new Error("Subprocess is already running");
    }

    await cleanupOrphanedProcess(options.dataDir);

    // Gecko's Subprocess.call requires an absolute path to an executable.
    // It cannot resolve $PATH or follow symlinks. Use /bin/sh -c to let
    // the shell handle PATH resolution — same approach works everywhere.
    const shellCmd = [options.command, ...options.args].join(" ");
    Zotero.log(`[Clautero] Spawning: /bin/sh -c "${shellCmd}"`, "info");

    const proc = await Subprocess.call({
      command: "/bin/sh",
      arguments: ["-c", shellCmd],
      workdir: options.workdir,
      stderr: "pipe",
    });

    process = proc;
    running = true;

    // PID tracking: extract PID from the process if available
    // Gecko Subprocess does not expose PID directly, so we write a marker
    await writePidFile(options.dataDir, Date.now());

    // Start async read loops (non-blocking)
    readStdoutLoop(proc).catch((error) => {
      options.onError(
        error instanceof Error ? error : new Error(String(error))
      );
    });

    readStderrLoop(proc).catch(() => {
      // Stderr errors are non-critical
    });

    // Wait for process exit in the background
    proc
      .wait()
      .then(async (result: { exitCode: number }) => {
        running = false;
        await removePidFile(options.dataDir);
        options.onExit(result.exitCode);
      })
      .catch(async (error: unknown) => {
        running = false;
        await removePidFile(options.dataDir);
        options.onError(
          error instanceof Error ? error : new Error(String(error))
        );
      });
  }

  async function sendMessage(ndjson: string): Promise<void> {
    if (!process || !running) {
      throw new Error("Subprocess is not running");
    }

    await process.stdin.write(ndjson);
  }

  async function kill(): Promise<void> {
    if (!process) {
      return;
    }

    running = false;

    try {
      process.kill();
      await process.wait();
    } catch {
      // Process may already be dead
    }

    await removePidFile(options.dataDir);
    process = null;
  }

  function isRunning(): boolean {
    return running;
  }

  return { start, sendMessage, kill, isRunning };
}
