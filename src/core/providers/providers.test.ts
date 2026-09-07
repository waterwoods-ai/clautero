import { describe, it, expect } from "vitest";
import { claudeProvider } from "./claude";
import { codexProvider } from "./codex";
import { opencodeProvider } from "./opencode";
import { piProvider } from "./pi";
import { getProvider, nextProvider, PROVIDERS } from "./registry";

// Fixtures below are real events captured from the local CLIs
// (codex-cli 0.153.4, opencode 1.18.29, pi 0.84.4, claude 2.1.x).

describe("registry", () => {
  it("resolves ids and falls back to claude", () => {
    expect(getProvider("codex").label).toBe("Codex");
    expect(getProvider("nope").id).toBe("claude");
    expect(getProvider(null).id).toBe("claude");
    expect(PROVIDERS.map((p) => p.id)).toEqual(["claude", "codex", "opencode", "pi"]);
  });

  it("cycles only through available providers", () => {
    expect(nextProvider("claude", ["claude", "pi"]).id).toBe("pi");
    expect(nextProvider("pi", ["claude", "pi"]).id).toBe("claude");
    expect(nextProvider("claude", ["claude"]).id).toBe("claude");
  });
});

describe("claude provider", () => {
  it("emits text deltas from stream_event and result with raw metadata", () => {
    const parser = claudeProvider.createParser();
    const delta = parser.parse({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
    });
    expect(delta).toEqual([expect.objectContaining({ type: "text", content: "Hi" })]);

    const result = parser.parse({ type: "result", result: "Hi", session_id: "abc", subtype: "success" });
    expect(result[0].type).toBe("result");
    expect(result[0].metadata?.session_id).toBe("abc");
  });

  it("builds persistent stream-json args with resume", () => {
    const plan = claudeProvider.buildSpawnPlan({
      settings: { model: "opus", effort: "high", permissionMode: "acceptEdits" },
      resumeSessionId: "sid-1",
    });
    expect(plan.args).toContain("--model");
    expect(plan.args).toContain("opus");
    expect(plan.args.slice(-2)).toEqual(["--resume", "sid-1"]);
  });
});

describe("codex provider", () => {
  const parser = codexProvider.createParser();

  it("normalizes the captured event stream", () => {
    const started = parser.parse({ type: "thread.started", thread_id: "01a07b1b-6420" });
    expect(started[0]).toMatchObject({ type: "system" });
    expect(started[0].metadata?.session_id).toBe("01a07b1b-6420");

    expect(parser.parse({ type: "turn.started" })).toEqual([]);
    expect(parser.parse({
      type: "item.completed",
      item: { id: "item_0", type: "error", message: "Skill descriptions were shortened…" },
    })).toEqual([]);

    const text = parser.parse({
      type: "item.completed",
      item: { id: "item_1", type: "agent_message", text: "OK" },
    });
    expect(text).toEqual([expect.objectContaining({ type: "text", content: "OK" })]);

    const done = parser.parse({
      type: "turn.completed",
      usage: { input_tokens: 25829, cached_input_tokens: 7040, output_tokens: 5 },
    });
    expect(done[0].type).toBe("result");
    expect(done[0].metadata?.usage).toEqual({ input_tokens: 25829, output_tokens: 5 });
    expect(done[0].metadata?.subtype).toBe("success");
  });

  it("does not duplicate tool_use for started+completed command items", () => {
    const p = codexProvider.createParser();
    const started = p.parse({ type: "item.started", item: { id: "c1", type: "command_execution", command: "ls" } });
    expect(started).toHaveLength(1);
    expect(started[0].type).toBe("tool_use");
    const completed = p.parse({
      type: "item.completed",
      item: { id: "c1", type: "command_execution", command: "ls", aggregated_output: "a b" },
    });
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ type: "tool_result", content: "a b" });
  });

  it("puts the prompt on stdin and resume before it", () => {
    const plan = codexProvider.buildSpawnPlan({
      settings: { permissionMode: "bypassPermissions" },
      resumeSessionId: "t-1",
      prompt: "hello",
    });
    expect(plan.args[0]).toBe("exec");
    expect(plan.args).toContain("--json");
    expect(plan.args).toContain("--skip-git-repo-check");
    expect(plan.args).toContain("--dangerously-bypass-approvals-and-sandbox");
    const r = plan.args.indexOf("resume");
    expect(plan.args[r + 1]).toBe("t-1");
    expect(plan.args[plan.args.length - 1]).toBe("-");
    expect(plan.stdinPayload).toBe("hello");
  });
});

describe("opencode provider", () => {
  it("normalizes the captured event stream and announces the session once", () => {
    const parser = opencodeProvider.createParser();
    const first = parser.parse({
      type: "step_start", sessionID: "ses_f84e", part: { type: "step-start" },
    });
    expect(first).toEqual([expect.objectContaining({ type: "system" })]);
    expect(first[0].metadata?.session_id).toBe("ses_f84e");

    const text = parser.parse({
      type: "text", sessionID: "ses_f84e", part: { type: "text", text: "OK" },
    });
    // Session already announced — only the text chunk now
    expect(text).toEqual([expect.objectContaining({ type: "text", content: "OK" })]);

    const finish = parser.parse({
      type: "step_finish", sessionID: "ses_f84e",
      part: { reason: "stop", type: "step-finish", tokens: { total: 267338, input: 266671, output: 4 } },
    });
    expect(finish[0].type).toBe("result");
    expect(finish[0].metadata?.usage).toEqual({ input_tokens: 266671, output_tokens: 4 });
  });

  it("ignores non-terminal step_finish reasons", () => {
    const parser = opencodeProvider.createParser();
    parser.parse({ type: "step_start", sessionID: "s", part: {} });
    expect(parser.parse({ type: "step_finish", sessionID: "s", part: { reason: "tool-calls" } })).toEqual([]);
  });

  it("passes the prompt as a positional and resume via -s", () => {
    const plan = opencodeProvider.buildSpawnPlan({
      settings: { permissionMode: "bypassPermissions" },
      resumeSessionId: "ses_1",
      prompt: "hi there",
    });
    expect(plan.args.slice(0, 3)).toEqual(["run", "--format", "json"]);
    expect(plan.args).toContain("--auto");
    const s = plan.args.indexOf("-s");
    expect(plan.args[s + 1]).toBe("ses_1");
    expect(plan.args[plan.args.length - 1]).toBe("hi there");
  });
});

describe("pi provider", () => {
  it("normalizes the captured event stream with streaming deltas", () => {
    const parser = piProvider.createParser();
    const session = parser.parse({ type: "session", version: 3, id: "01a07b1c-29ef" });
    expect(session[0].metadata?.session_id).toBe("01a07b1c-29ef");

    expect(parser.parse({ type: "agent_start" })).toEqual([]);
    expect(parser.parse({
      type: "message_update",
      assistantMessageEvent: { type: "text_start", contentIndex: 0 },
    })).toEqual([]);

    const delta = parser.parse({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "OK" },
    });
    expect(delta).toEqual([expect.objectContaining({ type: "text", content: "OK" })]);

    // text_end carries the full content again — must NOT duplicate
    expect(parser.parse({
      type: "message_update",
      assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "OK" },
    })).toEqual([]);

    const end = parser.parse({
      type: "agent_end",
      messages: [
        { role: "user" },
        { role: "assistant", usage: { input: 21265, output: 3 } },
      ],
    });
    expect(end[0].type).toBe("result");
    expect(end[0].metadata?.usage).toEqual({ input_tokens: 21265, output_tokens: 3 });
  });

  it("maps effort to --thinking and resume to --session-id", () => {
    const plan = piProvider.buildSpawnPlan({
      settings: { effort: "medium" },
      resumeSessionId: "01a0-sess",
      prompt: "go",
    });
    expect(plan.args.slice(0, 3)).toEqual(["--mode", "json", "-p"]);
    const t = plan.args.indexOf("--thinking");
    expect(plan.args[t + 1]).toBe("medium");
    const sid = plan.args.indexOf("--session-id");
    expect(plan.args[sid + 1]).toBe("01a0-sess");
    expect(plan.args[plan.args.length - 1]).toBe("go");
  });
});
