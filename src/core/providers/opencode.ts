/**
 * OpenCode provider — `opencode run --format json` (per-turn).
 *
 * Event stream (verified against opencode 1.18.29):
 *   {"type":"step_start","sessionID":"ses_…","part":{…}}
 *   {"type":"text","sessionID":"…","part":{"type":"text","text":"…"}}
 *   {"type":"step_finish","part":{"reason":"stop","tokens":{input,output,…}}}
 * Resume: `opencode run -s <sessionID>`. Model format is "provider/model",
 * so models are user-configured (empty list → opencode's default).
 */

import type { StreamChunk } from "../agent/types";
import type { CandidateContext } from "../agent/CLIPathCandidates";
import type { ProviderEventParser, ProviderModule, SpawnPlan } from "./types";

function createOpencodeParser(): ProviderEventParser {
  let announcedSessionId: string | null = null;

  return {
    parse(raw: Record<string, unknown>): StreamChunk[] {
      const type = raw.type as string;
      const part = raw.part as Record<string, unknown> | undefined;
      const chunks: StreamChunk[] = [];

      // Surface the session id once, from whichever event carries it first.
      const sessionId = typeof raw.sessionID === "string" ? raw.sessionID : null;
      if (sessionId && sessionId !== announcedSessionId) {
        announcedSessionId = sessionId;
        chunks.push({
          type: "system",
          content: "init",
          metadata: { ...raw, session_id: sessionId } as Readonly<Record<string, unknown>>,
        });
      }

      if (type === "text") {
        const text = typeof part?.text === "string" ? part.text : "";
        if (text) {
          chunks.push({ type: "text", content: text, metadata: raw as Readonly<Record<string, unknown>> });
        }
      } else if (type === "reasoning") {
        const text = typeof part?.text === "string" ? part.text : "";
        if (text) {
          chunks.push({ type: "thinking", content: text, metadata: raw as Readonly<Record<string, unknown>> });
        }
      } else if (type === "tool") {
        const toolName = typeof part?.tool === "string" ? part.tool : "tool";
        chunks.push({
          type: "tool_use",
          content: JSON.stringify(part ?? {}),
          metadata: { ...raw, tool_name: toolName } as Readonly<Record<string, unknown>>,
        });
      } else if (type === "step_finish" && part?.reason === "stop") {
        const tokens = part.tokens as Record<string, unknown> | undefined;
        chunks.push({
          type: "result",
          content: "",
          metadata: {
            ...raw,
            subtype: "success",
            usage: {
              input_tokens: typeof tokens?.input === "number" ? tokens.input : 0,
              output_tokens: typeof tokens?.output === "number" ? tokens.output : 0,
            },
          } as Readonly<Record<string, unknown>>,
        });
      } else if (type === "error") {
        chunks.push({
          type: "error",
          content: JSON.stringify(raw),
          metadata: raw as Readonly<Record<string, unknown>>,
        });
      }

      return chunks;
    },
  };
}

export const opencodeProvider: ProviderModule = {
  id: "opencode",
  label: "OpenCode",
  turnMode: "per-turn",
  binaryName: { unix: "opencode", windows: "opencode.exe" },
  models: [],

  wellKnownPaths(ctx: CandidateContext): readonly string[] {
    if (ctx.isWindows) return [];
    const paths: string[] = [];
    if (ctx.home) paths.push(`${ctx.home}/.opencode/bin/opencode`);
    paths.push("/opt/homebrew/bin/opencode", "/usr/local/bin/opencode");
    return paths;
  },

  buildSpawnPlan({ settings, resumeSessionId, prompt }): SpawnPlan {
    const args = ["run", "--format", "json"];
    if (settings.model) args.push("-m", settings.model);
    if (settings.permissionMode === "bypassPermissions") args.push("--auto");
    if (resumeSessionId) args.push("-s", resumeSessionId);
    args.push(prompt ?? "");
    return { args };
  },

  createParser: createOpencodeParser,
};
