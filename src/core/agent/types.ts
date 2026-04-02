export type StreamChunkType =
  | "system_init"
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "error"
  | "control_request"
  | "result";

export interface StreamChunk {
  readonly type: StreamChunkType;
  readonly content: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SessionInfo {
  readonly sessionId: string;
  readonly model?: string;
}

export interface ToolRequest {
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly requestId: string;
}

export type ToolApprovalResult = "approve" | "deny";

export interface ClauteroServiceOptions {
  readonly cwd: string;
  readonly cliPath: string;
  readonly onChunk: (chunk: StreamChunk) => void;
  readonly onError: (error: Error) => void;
  readonly onToolRequest?: (
    request: ToolRequest
  ) => Promise<ToolApprovalResult>;
}

export type SessionState = "idle" | "active" | "error";
