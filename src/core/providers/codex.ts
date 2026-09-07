/**
 * Codex provider — OpenAI Codex CLI via `codex exec --json` (per-turn).
 *
 * Event stream (verified against codex-cli 0.153.4):
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
 *   {"type":"turn.completed","usage":{"input_tokens":...,"output_tokens":...}}
 * Resume: `codex exec … resume <thread_id>`. The prompt travels on stdin
 * ("-") to avoid argv quoting/length issues.
 */

import type { StreamChunk } from "../agent/types";
import type { CandidateContext } from "../agent/CLIPathCandidates";
import type { ProviderEventParser, ProviderModule, SpawnPlan } from "./types";

function meta(raw: Record<string, unknown>, extra?: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return { ...raw, ...extra } as Readonly<Record<string, unknown>>;
}

function createCodexParser(): ProviderEventParser {
  // Items that already produced a tool_use chunk (item.started before completed)
  const startedItems = new Set<string>();

  function parseItem(raw: Record<string, unknown>, phase: "started" | "completed"): StreamChunk[] {
    const item = raw.item as Record<string, unknown> | undefined;
    if (!item) return [];
    const itemType = item.type as string;
    const itemId = typeof item.id === "string" ? item.id : "";

    if (itemType === "agent_message") {
      if (phase !== "completed") return [];
      const text = typeof item.text === "string" ? item.text : "";
      return text ? [{ type: "text", content: text, metadata: meta(raw) }] : [];
    }

    if (itemType === "reasoning") {
      if (phase !== "completed") return [];
      const text = typeof item.text === "string" ? item.text : "";
      return text ? [{ type: "thinking", content: text, metadata: meta(raw) }] : [];
    }

    if (itemType === "command_execution") {
      const chunks: StreamChunk[] = [];
      const command = typeof item.command === "string" ? item.command : "";
      if (phase === "started" || !startedItems.has(itemId)) {
        startedItems.add(itemId);
        chunks.push({
          type: "tool_use",
          content: JSON.stringify({ name: "shell", input: { command } }),
          metadata: meta(raw, { tool_name: "shell" }),
        });
      }
      if (phase === "completed") {
        const output = typeof item.aggregated_output === "string" ? item.aggregated_output : "";
        chunks.push({ type: "tool_result", content: output, metadata: meta(raw) });
      }
      return chunks;
    }

    if (itemType === "file_change" || itemType === "mcp_tool_call" || itemType === "web_search") {
      if (phase !== "completed") return [];
      return [{
        type: "tool_use",
        content: JSON.stringify(item),
        metadata: meta(raw, { tool_name: itemType }),
      }];
    }

    // "error" items are advisories (e.g. skills-budget warnings); real turn
    // failures arrive as turn.failed. Log-only.
    return [];
  }

  return {
    parse(raw: Record<string, unknown>): StreamChunk[] {
      const type = raw.type as string;

      if (type === "thread.started") {
        const threadId = typeof raw.thread_id === "string" ? raw.thread_id : "";
        if (!threadId) return [];
        return [{ type: "system", content: "init", metadata: meta(raw, { session_id: threadId }) }];
      }

      if (type === "item.started") return parseItem(raw, "started");
      if (type === "item.completed") return parseItem(raw, "completed");

      if (type === "turn.completed") {
        const usage = raw.usage as Record<string, unknown> | undefined;
        return [{
          type: "result",
          content: "",
          metadata: meta(raw, {
            subtype: "success",
            usage: {
              input_tokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : 0,
              output_tokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : 0,
            },
          }),
        }];
      }

      if (type === "turn.failed") {
        const error = raw.error as Record<string, unknown> | undefined;
        const message = typeof error?.message === "string" ? error.message : JSON.stringify(raw);
        return [{ type: "error", content: message, metadata: meta(raw) }];
      }

      return [];
    },
  };
}

export const codexProvider: ProviderModule = {
  id: "codex",
  label: "Codex",
  turnMode: "per-turn",
  binaryName: { unix: "codex", windows: "codex.exe" },
  // Model names drift quickly; empty list = use the user's codex default.
  models: [],

  wellKnownPaths(ctx: CandidateContext): readonly string[] {
    if (ctx.isWindows) return [];
    const paths = ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"];
    if (ctx.home) paths.push(`${ctx.home}/.local/bin/codex`);
    return paths;
  },

  buildSpawnPlan({ settings, resumeSessionId, prompt }): SpawnPlan {
    const args = ["exec", "--json", "--skip-git-repo-check"];
    if (settings.model) args.push("-m", settings.model);
    if (settings.permissionMode === "bypassPermissions") {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    }
    if (resumeSessionId) args.push("resume", resumeSessionId);
    args.push("-");
    return { args, stdinPayload: prompt ?? "" };
  },

  createParser: createCodexParser,
};
