/**
 * NDJSONParser — Parses newline-delimited JSON from Claude CLI stdout.
 *
 * Actual Claude CLI stream-json message format:
 *   {"type":"system","subtype":"...","session_id":"..."}
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
 *   {"type":"result","subtype":"success","result":"full text","session_id":"..."}
 *   {"type":"rate_limit_event","rate_limit_info":{...}}
 */

import type { StreamChunk } from "./types";

export interface NDJSONParserOptions {
  readonly onMessage: (chunk: StreamChunk) => void;
  readonly onParseError?: (line: string, error: Error) => void;
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
}

function extractTextFromAssistant(raw: Record<string, unknown>): StreamChunk[] {
  const message = raw.message as Record<string, unknown> | undefined;
  if (!message) {
    return [];
  }

  const content = message.content as ContentBlock[] | undefined;
  if (!Array.isArray(content)) {
    return [];
  }

  const chunks: StreamChunk[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      chunks.push({
        type: "text",
        content: block.text,
        metadata: raw as Readonly<Record<string, unknown>>,
      });
    } else if (block.type === "thinking" && typeof block.text === "string") {
      chunks.push({
        type: "thinking",
        content: block.text,
        metadata: raw as Readonly<Record<string, unknown>>,
      });
    } else if (block.type === "tool_use") {
      chunks.push({
        type: "tool_use",
        content: JSON.stringify({ name: block.name, input: block.input }),
        metadata: {
          ...raw,
          tool_name: block.name,
          tool_id: block.id,
          args: block.input,
        } as Readonly<Record<string, unknown>>,
      });
    } else if (block.type === "tool_result") {
      chunks.push({
        type: "tool_result",
        content: typeof block.text === "string" ? block.text : JSON.stringify(block),
        metadata: raw as Readonly<Record<string, unknown>>,
      });
    }
  }

  return chunks;
}

function parseRawMessage(raw: Record<string, unknown>): StreamChunk[] {
  const type = raw.type as string;

  if (type === "assistant") {
    return extractTextFromAssistant(raw);
  }

  if (type === "result") {
    const result = typeof raw.result === "string" ? raw.result : "";
    // Pass full raw metadata — includes usage, modelUsage, session_id, cost, etc.
    return [
      {
        type: "result",
        content: result,
        metadata: raw as Readonly<Record<string, unknown>>,
      },
    ];
  }

  if (type === "system") {
    const subtype = raw.subtype as string | undefined;
    // Emit system_init-like chunk for session tracking
    if (raw.session_id) {
      return [
        {
          type: "system",
          content: subtype ?? "",
          metadata: raw as Readonly<Record<string, unknown>>,
        },
      ];
    }
    // Skip noisy hook messages unless they carry a session_id
    return [];
  }

  if (type === "error") {
    return [
      {
        type: "error",
        content: typeof raw.error === "string"
          ? raw.error
          : JSON.stringify(raw),
        metadata: raw as Readonly<Record<string, unknown>>,
      },
    ];
  }

  // rate_limit_event, other types — skip silently
  return [];
}

export function createNDJSONParser(options: NDJSONParserOptions) {
  let buffer = "";

  function processLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const chunks = parseRawMessage(parsed);

      for (const chunk of chunks) {
        options.onMessage(chunk);
      }
    } catch (error) {
      options.onParseError?.(
        trimmed,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  function feed(data: string): void {
    buffer = buffer + data;

    const newlineIndex = buffer.lastIndexOf("\n");
    if (newlineIndex === -1) {
      return;
    }

    const complete = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);

    const lines = complete.split("\n");
    for (const line of lines) {
      processLine(line);
    }
  }

  function flush(): void {
    if (buffer.trim().length > 0) {
      processLine(buffer);
    }
    buffer = "";
  }

  return { feed, flush };
}
