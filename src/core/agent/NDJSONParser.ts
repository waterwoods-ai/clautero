import type { StreamChunk, StreamChunkType } from "./types";

const VALID_CHUNK_TYPES: ReadonlySet<string> = new Set([
  "system_init",
  "text",
  "thinking",
  "tool_use",
  "tool_result",
  "error",
  "control_request",
  "result",
]);

function isValidChunkType(type: unknown): type is StreamChunkType {
  return typeof type === "string" && VALID_CHUNK_TYPES.has(type);
}

function parseRawMessage(raw: Record<string, unknown>): StreamChunk | null {
  const { type, content, metadata, ...rest } = raw;

  if (!isValidChunkType(type)) {
    return null;
  }

  const chunk: StreamChunk = {
    type,
    content: typeof content === "string" ? content : JSON.stringify(content ?? ""),
    ...(metadata !== undefined
      ? { metadata: metadata as Readonly<Record<string, unknown>> }
      : {}),
    ...(Object.keys(rest).length > 0 ? { metadata: { ...metadata as object, ...rest } } : {}),
  };

  return chunk;
}

export interface NDJSONParserOptions {
  readonly onMessage: (chunk: StreamChunk) => void;
  readonly onParseError?: (line: string, error: Error) => void;
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
      const chunk = parseRawMessage(parsed);

      if (chunk) {
        options.onMessage(chunk);
      } else {
        options.onParseError?.(
          trimmed,
          new Error(`Unknown or missing chunk type in: ${trimmed}`)
        );
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
