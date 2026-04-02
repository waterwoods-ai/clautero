import type {
  ClauteroServiceOptions,
  SessionInfo,
  SessionState,
  StreamChunk,
  ToolRequest,
} from "./types";
import { createSubprocessManager, cleanupOrphanedProcess } from "./SubprocessManager";
import { createMessageChannel } from "./MessageChannel";
import { resolveCLIPath } from "./CLIPathResolver";

const BASE_CLI_ARGS = [
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
] as const;

function buildCliArgs(sessionId?: string): readonly string[] {
  if (sessionId) {
    return [...BASE_CLI_ARGS, "--resume", sessionId];
  }
  return [...BASE_CLI_ARGS];
}

function extractSessionInfo(chunk: StreamChunk): SessionInfo | null {
  if (chunk.type !== "system_init") {
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
  if (chunk.type !== "control_request") {
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
  let state: SessionState = "idle";
  let sessionInfo: SessionInfo | null = null;
  let subprocess: ReturnType<typeof createSubprocessManager> | null = null;
  let channel: ReturnType<typeof createMessageChannel> | null = null;

  function setState(next: SessionState): void {
    state = next;
  }

  function handleChunk(chunk: StreamChunk): void {
    // Extract session info from system_init
    const info = extractSessionInfo(chunk);
    if (info) {
      sessionInfo = info;
    }

    // Check for tool requests requiring approval
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

    // Check for result/error to mark turn complete
    if (chunk.type === "result" || chunk.type === "error") {
      channel?.markTurnComplete();
    }

    options.onChunk(chunk);
  }

  function handleExit(exitCode: number): void {
    setState("idle");
    if (exitCode !== 0) {
      options.onError(
        new Error(`Claude CLI exited with code ${exitCode}`)
      );
    }
  }

  function handleProcessError(error: Error): void {
    setState("error");
    options.onError(error);
  }

  async function spawnSubprocess(resumeSessionId?: string): Promise<void> {
    const cliPath = options.cliPath || (await resolveCLIPath());
    const args = buildCliArgs(resumeSessionId);
    const dataDir = PathUtils.parent(options.cwd) ?? options.cwd;

    subprocess = createSubprocessManager({
      command: cliPath,
      args,
      workdir: options.cwd,
      dataDir,
      onChunk: handleChunk,
      onExit: handleExit,
      onError: handleProcessError,
    });

    channel = createMessageChannel({
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

  async function startSession(): Promise<void> {
    if (state === "active") {
      throw new Error("Session already active. Stop it first.");
    }

    await spawnSubprocess();
  }

  async function resumeSession(sessionId: string): Promise<void> {
    if (state === "active") {
      throw new Error("Session already active. Stop it first.");
    }

    await spawnSubprocess(sessionId);
  }

  async function stopSession(): Promise<void> {
    if (subprocess) {
      await subprocess.kill();
      subprocess = null;
    }
    channel = null;
    setState("idle");
  }

  function sendMessage(text: string, context?: string): void {
    if (state !== "active" || !channel) {
      throw new Error("No active session. Start a session first.");
    }

    const fullMessage = context
      ? `${text}\n\n<context>\n${context}\n</context>`
      : text;

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
    sendMessage,
    getState,
    getSessionInfo,
    cleanup,
  };
}

export { cleanupOrphanedProcess };
