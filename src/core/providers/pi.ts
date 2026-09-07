/**
 * Pi provider — `pi --mode json -p` (per-turn, true token streaming).
 *
 * Event stream (verified against pi 0.84.4):
 *   {"type":"session","id":"…"}
 *   {"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"…"}}
 *   {"type":"agent_end","messages":[…, {role:"assistant", usage:{input,output}}]}
 * Resume: `pi --session-id <id>` (creates or continues that session).
 * Models/providers are pi-managed (empty list → pi's configured default).
 */

import type { StreamChunk } from "../agent/types";
import type { CandidateContext } from "../agent/CLIPathCandidates";
import type { ProviderEventParser, ProviderModule, SpawnPlan } from "./types";

function createPiParser(): ProviderEventParser {
  return {
    parse(raw: Record<string, unknown>): StreamChunk[] {
      const type = raw.type as string;

      if (type === "session") {
        const id = typeof raw.id === "string" ? raw.id : "";
        if (!id) return [];
        return [{
          type: "system",
          content: "init",
          metadata: { ...raw, session_id: id } as Readonly<Record<string, unknown>>,
        }];
      }

      if (type === "message_update") {
        const event = raw.assistantMessageEvent as Record<string, unknown> | undefined;
        if (!event) return [];
        const eventType = event.type as string;
        if (eventType === "text_delta") {
          const delta = typeof event.delta === "string" ? event.delta : "";
          if (delta) {
            return [{ type: "text", content: delta, metadata: raw as Readonly<Record<string, unknown>> }];
          }
        }
        if (eventType === "thinking_delta") {
          const delta = typeof event.delta === "string" ? event.delta : "";
          if (delta) {
            return [{ type: "thinking", content: delta, metadata: raw as Readonly<Record<string, unknown>> }];
          }
        }
        if (eventType === "toolcall_end" || eventType === "toolcall") {
          return [{
            type: "tool_use",
            content: JSON.stringify(event),
            metadata: { ...raw, tool_name: "tool" } as Readonly<Record<string, unknown>>,
          }];
        }
        return [];
      }

      if (type === "agent_end") {
        const messages = raw.messages as Array<Record<string, unknown>> | undefined;
        const last = Array.isArray(messages) ? messages[messages.length - 1] : undefined;
        const usage = last?.usage as Record<string, unknown> | undefined;
        return [{
          type: "result",
          content: "",
          metadata: {
            ...raw,
            subtype: "success",
            usage: {
              input_tokens: typeof usage?.input === "number" ? usage.input : 0,
              output_tokens: typeof usage?.output === "number" ? usage.output : 0,
            },
          } as Readonly<Record<string, unknown>>,
        }];
      }

      if (type === "error") {
        return [{
          type: "error",
          content: JSON.stringify(raw),
          metadata: raw as Readonly<Record<string, unknown>>,
        }];
      }

      return [];
    },
  };
}

export const piProvider: ProviderModule = {
  id: "pi",
  label: "Pi",
  turnMode: "per-turn",
  binaryName: { unix: "pi", windows: "pi.exe" },
  models: [],

  wellKnownPaths(ctx: CandidateContext): readonly string[] {
    if (ctx.isWindows) return [];
    const paths = ["/opt/homebrew/bin/pi", "/usr/local/bin/pi"];
    if (ctx.home) paths.push(`${ctx.home}/.local/bin/pi`);
    return paths;
  },

  buildSpawnPlan({ settings, resumeSessionId, prompt }): SpawnPlan {
    const args = ["--mode", "json", "-p"];
    if (settings.model) args.push("--model", settings.model);
    if (settings.effort) args.push("--thinking", settings.effort);
    if (resumeSessionId) args.push("--session-id", resumeSessionId);
    args.push(prompt ?? "");
    return { args };
  },

  createParser: createPiParser,
};
