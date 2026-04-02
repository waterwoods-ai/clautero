/**
 * ChatState — Immutable state management for the chat conversation.
 *
 * All state transitions produce new frozen objects; nothing is mutated.
 */

import type { StreamChunk } from "../../core/agent/types";

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly chunks: readonly StreamChunk[];
  readonly timestamp: number;
}

export interface UsageStats {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ChatStateData {
  readonly messages: readonly ChatMessage[];
  readonly isStreaming: boolean;
  readonly usage: UsageStats;
}

function createEmptyState(): ChatStateData {
  return Object.freeze({
    messages: Object.freeze([]),
    isStreaming: false,
    usage: Object.freeze({ inputTokens: 0, outputTokens: 0 }),
  });
}

function freezeMessage(msg: ChatMessage): ChatMessage {
  return Object.freeze({
    ...msg,
    chunks: Object.freeze([...msg.chunks]),
  });
}

export function createChatState(): ChatStateData {
  return createEmptyState();
}

export function addMessage(
  state: ChatStateData,
  message: ChatMessage
): ChatStateData {
  const frozen = freezeMessage(message);
  return Object.freeze({
    ...state,
    messages: Object.freeze([...state.messages, frozen]),
  });
}

export function updateLastMessage(
  state: ChatStateData,
  chunk: StreamChunk
): ChatStateData {
  const { messages } = state;
  if (messages.length === 0) {
    return state;
  }

  const last = messages[messages.length - 1];
  const updatedContent = chunk.type === "text"
    ? last.content + chunk.content
    : last.content;

  const updated = freezeMessage({
    ...last,
    content: updatedContent,
    chunks: [...last.chunks, chunk],
  });

  return Object.freeze({
    ...state,
    messages: Object.freeze([
      ...messages.slice(0, -1),
      updated,
    ]),
  });
}

export function setStreaming(
  state: ChatStateData,
  isStreaming: boolean
): ChatStateData {
  return Object.freeze({ ...state, isStreaming });
}

export function updateUsage(
  state: ChatStateData,
  inputTokens: number,
  outputTokens: number
): ChatStateData {
  return Object.freeze({
    ...state,
    usage: Object.freeze({
      inputTokens: state.usage.inputTokens + inputTokens,
      outputTokens: state.usage.outputTokens + outputTokens,
    }),
  });
}

export function clearMessages(state: ChatStateData): ChatStateData {
  return Object.freeze({
    ...state,
    messages: Object.freeze([]),
    usage: Object.freeze({ inputTokens: 0, outputTokens: 0 }),
  });
}
