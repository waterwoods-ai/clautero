/**
 * StreamController — Routes StreamChunk objects from ClauteroService
 * to the MessageRenderer and ChatState.
 *
 * Handles chunk coalescence, thinking block detection, and tool use tracking.
 */

import type { StreamChunk } from "../../core/agent/types";
import type { ChatStateData } from "./ChatState";
import {
  addMessage,
  updateLastMessage,
  setStreaming,
  updateUsage,
} from "./ChatState";
import type { createMessageRenderer } from "./MessageRenderer";

type Renderer = ReturnType<typeof createMessageRenderer>;

type StreamPhase = "idle" | "text" | "thinking" | "tool_use";

interface ControllerState {
  readonly phase: StreamPhase;
  readonly currentToolName: string;
}

function createControllerState(): ControllerState {
  return Object.freeze({
    phase: "idle" as StreamPhase,
    currentToolName: "",
  });
}

export function createStreamController(
  renderer: Renderer,
  getState: () => ChatStateData,
  setState: (next: ChatStateData) => void
) {
  let controllerState = createControllerState();

  function transitionPhase(next: StreamPhase): void {
    controllerState = Object.freeze({
      ...controllerState,
      phase: next,
    });
  }

  function handleTextChunk(chunk: StreamChunk): void {
    if (controllerState.phase !== "text") {
      transitionPhase("text");
    }
    setState(updateLastMessage(getState(), chunk));
    renderer.appendTextChunk(chunk.content);
  }

  function handleThinkingChunk(chunk: StreamChunk): void {
    const isStart = controllerState.phase !== "thinking";
    if (isStart) {
      transitionPhase("thinking");
      renderer.renderThinkingStart();
    }
    setState(updateLastMessage(getState(), chunk));
    renderer.appendThinkingChunk(chunk.content);
  }

  function handleToolUseChunk(chunk: StreamChunk): void {
    const metadata = chunk.metadata ?? {};
    const toolName = typeof metadata.tool_name === "string"
      ? metadata.tool_name
      : typeof metadata.toolName === "string"
        ? metadata.toolName
        : "unknown";

    if (controllerState.phase === "thinking") {
      renderer.renderThinkingEnd();
    }

    transitionPhase("tool_use");
    controllerState = Object.freeze({
      ...controllerState,
      currentToolName: toolName,
    });

    const argsStr = chunk.content || JSON.stringify(metadata.args ?? {}, null, 2);
    renderer.renderToolUseStart(toolName, argsStr);
    setState(updateLastMessage(getState(), chunk));
  }

  function handleToolResultChunk(chunk: StreamChunk): void {
    renderer.renderToolResult(chunk.content);
    setState(updateLastMessage(getState(), chunk));
    transitionPhase("idle");
  }

  function handleResultChunk(chunk: StreamChunk): void {
    // End of assistant turn
    if (controllerState.phase === "thinking") {
      renderer.renderThinkingEnd();
    }

    const metadata = chunk.metadata ?? {};
    const inputTokens = typeof metadata.input_tokens === "number"
      ? metadata.input_tokens
      : 0;
    const outputTokens = typeof metadata.output_tokens === "number"
      ? metadata.output_tokens
      : 0;

    if (inputTokens > 0 || outputTokens > 0) {
      setState(updateUsage(getState(), inputTokens, outputTokens));
    }

    finishStream();
  }

  function handleErrorChunk(chunk: StreamChunk): void {
    renderer.appendTextChunk(`Error: ${chunk.content}`);
    setState(updateLastMessage(getState(), chunk));
    finishStream();
  }

  function finishStream(): void {
    renderer.finishAssistantMessage();
    setState(setStreaming(getState(), false));
    controllerState = createControllerState();
  }

  function startStream(): void {
    setState(setStreaming(getState(), true));
    setState(
      addMessage(getState(), {
        role: "assistant",
        content: "",
        chunks: [],
        timestamp: Date.now(),
      })
    );
    renderer.showLoading();
    transitionPhase("idle");
  }

  function handleChunk(chunk: StreamChunk): void {
    // Remove loading indicator on first content chunk
    if (controllerState.phase === "idle" && chunk.type !== "system_init") {
      renderer.removeLoading();
    }

    switch (chunk.type) {
      case "text":
        handleTextChunk(chunk);
        break;
      case "thinking":
        handleThinkingChunk(chunk);
        break;
      case "tool_use":
        handleToolUseChunk(chunk);
        break;
      case "tool_result":
        handleToolResultChunk(chunk);
        break;
      case "result":
        handleResultChunk(chunk);
        break;
      case "error":
        handleErrorChunk(chunk);
        break;
      case "system_init":
      case "control_request":
        // Handled by ClauteroService directly
        setState(updateLastMessage(getState(), chunk));
        break;
    }
  }

  function cleanup(): void {
    controllerState = createControllerState();
  }

  return {
    handleChunk,
    startStream,
    finishStream,
    cleanup,
  };
}
