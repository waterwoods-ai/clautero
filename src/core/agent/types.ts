/**
 * Types for Claude CLI stream-json protocol.
 *
 * Actual message types from `claude -p --output-format stream-json --verbose`:
 * - "system" (subtypes: hook_started, hook_response, init)
 * - "assistant" (contains message.content[] with text/thinking/tool_use blocks)
 * - "result" (final response with full text)
 * - "rate_limit_event"
 */

export type StreamChunkType =
  | "system"
  | "assistant"
  | "result"
  | "error"
  | "rate_limit_event"
  | "text"           // derived from assistant message content blocks
  | "thinking"       // derived from assistant thinking blocks
  | "tool_use"       // derived from assistant tool_use blocks
  | "tool_result";   // derived from tool result messages

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
