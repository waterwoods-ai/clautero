/**
 * NDJSONParser — splits a JSONL stdout stream into JSON events and delegates
 * event→chunk mapping to the active provider's parser (see core/providers).
 */

import type { StreamChunk } from "./types";

export interface NDJSONParserOptions {
  /** Provider-specific event mapper (ProviderEventParser.parse). */
  readonly parseEvent: (raw: Record<string, unknown>) => StreamChunk[];
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
      const chunks = options.parseEvent(parsed);

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
