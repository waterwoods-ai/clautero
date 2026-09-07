/**
 * ClauteroService — one agent session bound to a provider CLI.
 *
 * Two execution shapes, chosen by the provider's turnMode:
 *   persistent — one long-lived process per session (Claude stream-json);
 *     messages are framed onto stdin via MessageChannel.
 *   per-turn — one process per message (codex exec / opencode run / pi -p);
 *     the conversation continues across processes via the provider's
 *     resume-by-session-id mechanism.
 */

import type {
  ClauteroServiceOptions,
  SessionInfo,
  SessionSettings,
  SessionState,
  StreamChunk,
  ToolRequest,
} from "./types";
import { createSubprocessManager, cleanupOrphanedProcess } from "./SubprocessManager";
import { createMessageChannel } from "./MessageChannel";
import { resolveProviderCLIPath, getSpawnEnvironment } from "./CLIPathResolver";
import { getProvider } from "../providers/registry";
import type { ProviderSettings } from "../providers/types";

function getPref(key: string, fallback: string): string {
  try {
    const val = Zotero.Prefs.get(`extensions.clautero.${key}`, true) as string;
    return (val && val.trim()) ? val.trim() : fallback;
  } catch { return fallback; }
}

function extractSessionInfo(chunk: StreamChunk): SessionInfo | null {
  // Providers normalize their conversation id into metadata.session_id
  // on "system" and "result" chunks.
  if (chunk.type !== "system" && chunk.type !== "result") {
    return null;
  }

  const metadata = chunk.metadata ?? {};
  const sessionId =
    typeof metadata.session_id === "string"
      ? metadata.session_id
      : typeof metadata.sessionId === "string"
        ? metadata.sessionId
        : "";

  if (!sessionId) {
    return null;
  }

  const model =
    typeof metadata.model === "string" ? metadata.model : undefined;

  return { sessionId, model };
}

function isToolRequest(chunk: StreamChunk): ToolRequest | null {
  if (chunk.type !== "tool_use") {
    return null;
  }

  const metadata = chunk.metadata ?? {};
  const toolName = metadata.tool_name ?? metadata.toolName;
  const args = metadata.args ?? metadata.arguments;
  const requestId = metadata.request_id ?? metadata.requestId;

  if (
    typeof toolName !== "string" ||
    typeof requestId !== "string" ||
    typeof args !== "object" ||
    args === null
  ) {
    return null;
  }

  return {
    toolName,
    args: args as Readonly<Record<string, unknown>>,
    requestId,
  };
}

export function createClauteroService(options: ClauteroServiceOptions) {
  const provider = options.provider ?? getProvider(undefined);
  let state: SessionState = "idle";
  let sessionInfo: SessionInfo | null = null;
  let subprocess: ReturnType<typeof createSubprocessManager> | null = null;
  let channel: ReturnType<typeof createMessageChannel> | null = null;
  let intentionalStop = false;
  // per-turn bookkeeping: a token per spawned turn process so callbacks
  // from a superseded process can never touch the current turn's state.
  let turnInFlight = false;
  let turnSeq = 0;

  function buildSettings(): ProviderSettings {
    const given = options.getSettings?.() ?? ({} as SessionSettings);
    return {
      model: given.model,
      effort: given.effort ?? getPref("effort", "low"),
      permissionMode: given.permissionMode ?? getPref("permissionMode", "acceptEdits"),
    };
  }

  function setState(next: SessionState): void {
    state = next;
  }

  /** Shared chunk plumbing: session info, tool requests, delivery. */
  function processChunk(chunk: StreamChunk): void {
    const info = extractSessionInfo(chunk);
    if (info) {
      sessionInfo = info;
    }

    const toolReq = isToolRequest(chunk);
    if (toolReq && options.onToolRequest) {
      options.onToolRequest(toolReq).catch((error) => {
        options.onError(
          error instanceof Error
            ? error
            : new Error(`Tool approval error: ${error}`)
        );
      });
    }

    options.onChunk(chunk);
  }

  // ── Persistent-mode callbacks ──

  function handleChunk(chunk: StreamChunk): void {
    if (chunk.type === "result" || chunk.type === "error") {
      channel?.markTurnComplete();
    }
    processChunk(chunk);
  }

  function handleExit(exitCode: number): void {
    setState("idle");
    // A kill from interrupt/cool exits non-zero by design — not an error.
    if (exitCode !== 0 && !intentionalStop) {
      options.onError(
        new Error(`${provider.label} CLI exited with code ${exitCode}`)
      );
    }
    intentionalStop = false;
  }

  function handleProcessError(error: Error): void {
    setState("error");
    options.onError(error);
  }

  async function resolveCommand(): Promise<string> {
    return options.cliPath || (await resolveProviderCLIPath(provider));
  }

  async function spawnPersistent(resumeSessionId?: string): Promise<void> {
    intentionalStop = false;
    const cliPath = await resolveCommand();
    const plan = provider.buildSpawnPlan({
      settings: buildSettings(),
      resumeSessionId,
    });
    const parser = provider.createParser();
    const dataDir = PathUtils.parent(options.cwd) ?? options.cwd;

    subprocess = createSubprocessManager({
      command: cliPath,
      args: plan.args,
      parseEvent: parser.parse,
      environment: getSpawnEnvironment(),
      workdir: options.cwd,
      dataDir,
      onChunk: handleChunk,
      onExit: handleExit,
      onError: handleProcessError,
    });

    channel = createMessageChannel({
      formatMessage: provider.formatUserMessage,
      onSend: async (ndjson) => {
        if (!subprocess) {
          throw new Error("No active subprocess");
        }
        await subprocess.sendMessage(ndjson);
      },
      onDrained: () => {
        Zotero.log("[Clautero] Message queue drained", "info");
      },
    });

    await subprocess.start();
    setState("active");
  }

  async function runTurn(text: string): Promise<void> {
    if (turnInFlight) {
      throw new Error("A turn is already running in this session");
    }
    intentionalStop = false;
    turnInFlight = true;
    const token = ++turnSeq;
    let sawTerminal = false;

    try {
      const cliPath = await resolveCommand();
      const plan = provider.buildSpawnPlan({
        settings: buildSettings(),
        resumeSessionId: sessionInfo?.sessionId,
        prompt: text,
      });
      const parser = provider.createParser();
      const dataDir = PathUtils.parent(options.cwd) ?? options.cwd;

      subprocess = createSubprocessManager({
        command: cliPath,
        args: plan.args,
        parseEvent: parser.parse,
        environment: getSpawnEnvironment(),
        workdir: options.cwd,
        dataDir,
        onChunk: (chunk) => {
          if (token !== turnSeq) return; // superseded process
          if (chunk.type === "result" || chunk.type === "error") {
            sawTerminal = true;
            // The turn is over for the UI even while the process is still
            // tearing down — the next send must not be refused.
            turnInFlight = false;
          }
          processChunk(chunk);
        },
        onExit: (exitCode) => {
          if (token !== turnSeq) return;
          turnInFlight = false;
          // If the stream never carried a terminal event, synthesize one
          // so the UI always leaves "streaming".
          if (!sawTerminal && !intentionalStop) {
            if (exitCode === 0) {
              options.onChunk({ type: "result", content: "", metadata: { subtype: "success" } });
            } else {
              options.onError(new Error(`${provider.label} CLI exited with code ${exitCode}`));
            }
          }
          intentionalStop = false;
        },
        onError: (error) => {
          if (token !== turnSeq) return;
          turnInFlight = false;
          options.onError(error);
        },
      });

      await subprocess.start();
      if (plan.stdinPayload !== undefined) {
        await subprocess.sendMessage(plan.stdinPayload);
      }
      await subprocess.closeStdin();
    } catch (error) {
      if (token === turnSeq) turnInFlight = false;
      throw error;
    }
  }

  async function startSession(): Promise<void> {
    if (state === "active") {
      throw new Error("Session already active. Stop it first.");
    }

    if (provider.turnMode === "per-turn") {
      // Nothing to spawn until the first message; the session is ready.
      setState("active");
      return;
    }

    // A previously established session resumes transparently —
    // this is what makes interrupt/cool cheap: kill now, resume later.
    await spawnPersistent(sessionInfo?.sessionId);
  }

  async function resumeSession(sessionId: string): Promise<void> {
    if (state === "active") {
      throw new Error("Session already active. Stop it first.");
    }

    sessionInfo = { sessionId };
    if (provider.turnMode === "per-turn") {
      setState("active");
      return;
    }
    await spawnPersistent(sessionId);
  }

  async function stopSession(): Promise<void> {
    intentionalStop = true;
    // Detach any per-turn process callbacks still in flight.
    turnSeq++;
    if (subprocess) {
      await subprocess.kill();
      subprocess = null;
    }
    channel = null;
    turnInFlight = false;
    setState("idle");
  }

  /**
   * Stop the running turn/process but keep the provider session id so the
   * next message resumes the conversation. Used by Esc-to-interrupt and
   * by the warm pool when cooling an idle session.
   */
  async function interrupt(): Promise<void> {
    await stopSession();
  }

  function sendMessage(text: string, context?: string): void {
    if (state !== "active") {
      throw new Error("No active session. Start a session first.");
    }

    const fullMessage = context
      ? `${text}\n\n<context>\n${context}\n</context>`
      : text;

    if (provider.turnMode === "per-turn") {
      runTurn(fullMessage).catch((error) => {
        options.onError(
          error instanceof Error ? error : new Error(String(error))
        );
      });
      return;
    }

    if (!channel) {
      throw new Error("No active session. Start a session first.");
    }
    channel.enqueue(fullMessage);
  }

  function getState(): SessionState {
    return state;
  }

  function getSessionInfo(): SessionInfo | null {
    return sessionInfo;
  }

  function cleanup(): void {
    stopSession().catch((error) => {
      Zotero.log(
        `[Clautero] Error during cleanup: ${error}`,
        "warning"
      );
    });
  }

  return {
    startSession,
    resumeSession,
    stopSession,
    interrupt,
    sendMessage,
    getState,
    getSessionInfo,
    cleanup,
  };
}

export { cleanupOrphanedProcess };
