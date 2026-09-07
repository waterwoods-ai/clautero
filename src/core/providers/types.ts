/**
 * Provider contract — the seam that lets Clautero drive different agent CLIs.
 *
 * Modeled on Claudian's ProviderModule shape (not its full registry
 * framework). Every provider normalizes its CLI's JSONL events into the
 * shared StreamChunk model so the renderer, session status machinery,
 * warm pool, and persistence work identically for all providers:
 *
 *   - the provider's conversation/session id is surfaced as
 *     `metadata.session_id` on a "system" or "result" chunk;
 *   - a terminal "result" chunk carries `metadata.usage`
 *     ({input_tokens, output_tokens}) and optional `metadata.subtype`
 *     ("success" or an error subtype);
 *   - text/thinking deltas stream as "text"/"thinking" chunks.
 */

import type { StreamChunk } from "../agent/types";
import type { CandidateContext } from "../agent/CLIPathCandidates";

/**
 * persistent — one long-lived process per session; messages are framed
 *   onto its stdin (Claude's stream-json mode).
 * per-turn — one process per message, resumed by session id
 *   (codex exec / opencode run / pi -p).
 */
export type TurnMode = "persistent" | "per-turn";

export interface ProviderSettings {
  readonly model?: string;
  readonly effort?: string;
  readonly permissionMode?: string;
}

export interface SpawnPlan {
  readonly args: readonly string[];
  /** Written to stdin right after spawn; per-turn providers then close stdin. */
  readonly stdinPayload?: string;
}

export interface ProviderEventParser {
  /** Map one parsed JSONL event to zero or more normalized chunks. */
  parse(raw: Record<string, unknown>): StreamChunk[];
}

export interface ProviderModule {
  readonly id: string;
  readonly label: string;
  readonly turnMode: TurnMode;
  readonly binaryName: { readonly unix: string; readonly windows: string };
  /** Models offered in the cycle UI; empty → provider-managed default ("auto"). */
  readonly models: readonly string[];
  /** Provider-specific well-known install file paths, probed before PATH. */
  wellKnownPaths(ctx: CandidateContext): readonly string[];
  buildSpawnPlan(opts: {
    readonly settings: ProviderSettings;
    readonly resumeSessionId?: string;
    /** The message, for per-turn providers. */
    readonly prompt?: string;
  }): SpawnPlan;
  /** A parser instance per process — parsers may hold per-stream state. */
  createParser(): ProviderEventParser;
  /** Persistent providers frame a user message for the process stdin. */
  formatUserMessage?(text: string): string;
}
