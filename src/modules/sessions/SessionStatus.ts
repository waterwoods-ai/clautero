/**
 * SessionStatus — per-session status kinds with explicit display precedence.
 *
 * Ported from Claudian's session status indicators (#1217): a session waiting
 * on the user outranks "running", which outranks a past error. A session
 * blocked on input must never present as merely "running".
 */

export type SessionStatusKind = "idle" | "error" | "streaming" | "action-required";

/** Display precedence, most severe first. */
const PRECEDENCE: readonly SessionStatusKind[] = [
  "action-required",
  "streaming",
  "error",
  "idle",
];

export interface StatusIndicator {
  readonly kind: SessionStatusKind;
  /** Dot color, empty when no dot should be shown. */
  readonly color: string;
  /** Accessible label describing the state. */
  readonly label: string;
}

const INDICATORS: Readonly<Record<SessionStatusKind, StatusIndicator>> = Object.freeze({
  "action-required": Object.freeze({ kind: "action-required" as const, color: "#e67e22", label: "Needs your input" }),
  streaming: Object.freeze({ kind: "streaming" as const, color: "#3584e4", label: "Running" }),
  error: Object.freeze({ kind: "error" as const, color: "#e74c3c", label: "Stopped with an error" }),
  idle: Object.freeze({ kind: "idle" as const, color: "", label: "" }),
});

export function resolveIndicator(kind: SessionStatusKind): StatusIndicator {
  return INDICATORS[kind];
}

/** Most severe of several kinds (e.g. rolled up over all sessions). */
export function mostSevere(kinds: readonly SessionStatusKind[]): SessionStatusKind {
  for (const kind of PRECEDENCE) {
    if (kinds.includes(kind)) return kind;
  }
  return "idle";
}
