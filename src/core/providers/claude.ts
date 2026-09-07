/**
 * Claude provider — Claude Code CLI in persistent stream-json mode.
 *
 * One long-lived `claude -p --input-format stream-json` process per session;
 * messages are framed onto stdin by MessageChannel. Event parsing moved here
 * from NDJSONParser when the provider seam was introduced.
 */

import type { StreamChunk } from "../agent/types";
import type { CandidateContext } from "../agent/CLIPathCandidates";
import type { ProviderModule, SpawnPlan } from "./types";

function parseClaudeEvent(raw: Record<string, unknown>): StreamChunk[] {
  const type = raw.type as string;

  if (type === "assistant") {
    // With --include-partial-messages, "assistant" messages are intermediate
    // snapshots; real-time content arrives via stream_event deltas and the
    // final text via "result". Skip to avoid duplication.
    return [];
  }

  if (type === "stream_event") {
    const event = raw.event as Record<string, unknown> | undefined;
    if (!event) return [];
    const eventType = event.type as string;

    if (eventType === "content_block_start") {
      const block = event.content_block as Record<string, unknown> | undefined;
      if (block?.type === "thinking") {
        return [{ type: "thinking", content: "", metadata: raw as Readonly<Record<string, unknown>> }];
      }
      if (block?.type === "tool_use") {
        const name = block.name as string || "unknown";
        return [{
          type: "tool_use",
          content: JSON.stringify({ name, input: {} }),
          metadata: { ...raw, tool_name: name } as Readonly<Record<string, unknown>>,
        }];
      }
      return [];
    }

    if (eventType === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (!delta) return [];
      if (delta.type === "thinking_delta") {
        const text = typeof delta.thinking === "string" ? delta.thinking : "";
        if (text) {
          return [{ type: "thinking", content: text, metadata: raw as Readonly<Record<string, unknown>> }];
        }
      }
      if (delta.type === "text_delta") {
        const text = typeof delta.text === "string" ? delta.text : "";
        if (text) {
          return [{ type: "text", content: text, metadata: raw as Readonly<Record<string, unknown>> }];
        }
      }
      return [];
    }

    return [];
  }

  if (type === "result") {
    const result = typeof raw.result === "string" ? raw.result : "";
    // Pass full raw metadata — includes usage, modelUsage, session_id, cost, etc.
    return [{
      type: "result",
      content: result,
      metadata: raw as Readonly<Record<string, unknown>>,
    }];
  }

  if (type === "system") {
    if (raw.session_id) {
      return [{
        type: "system",
        content: (raw.subtype as string | undefined) ?? "",
        metadata: raw as Readonly<Record<string, unknown>>,
      }];
    }
    return [];
  }

  if (type === "error") {
    return [{
      type: "error",
      content: typeof raw.error === "string" ? raw.error : JSON.stringify(raw),
      metadata: raw as Readonly<Record<string, unknown>>,
    }];
  }

  return [];
}

export const claudeProvider: ProviderModule = {
  id: "claude",
  label: "Claude",
  turnMode: "persistent",
  binaryName: { unix: "claude", windows: "claude.exe" },
  models: ["sonnet", "opus", "haiku", "fable"],

  wellKnownPaths(ctx: CandidateContext): readonly string[] {
    const sep = ctx.isWindows ? "\\" : "/";
    const j = (...p: string[]) => p.join(sep);
    const bin = ctx.isWindows ? "claude.exe" : "claude";
    const paths: string[] = [];
    if (ctx.home) {
      paths.push(j(ctx.home, ".claude", "local", bin));
      paths.push(j(ctx.home, ".local", "bin", bin));
      if (!ctx.isWindows) paths.push(j(ctx.home, ".npm-global", "bin", bin));
    }
    if (ctx.isWindows) {
      const localAppData = ctx.getEnv("LOCALAPPDATA");
      if (localAppData) paths.push(j(localAppData, "Claude", bin));
      paths.push(j(ctx.getEnv("ProgramFiles") ?? "C:\\Program Files", "Claude", bin));
    }
    return paths;
  },

  buildSpawnPlan({ settings, resumeSessionId }): SpawnPlan {
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode", settings.permissionMode ?? "acceptEdits",
      "--model", settings.model ?? "sonnet",
      "--effort", settings.effort ?? "low",
    ];
    if (resumeSessionId) args.push("--resume", resumeSessionId);
    return { args };
  },

  createParser() {
    return { parse: parseClaudeEvent };
  },

  formatUserMessage(text: string): string {
    return JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n";
  },
};
