import { describe, it, expect, vi } from "vitest";
import { createStreamController } from "./StreamController";
import { createChatState, type ChatStateData } from "./ChatState";
import type { createMessageRenderer } from "./MessageRenderer";

type Renderer = ReturnType<typeof createMessageRenderer>;

function makeRenderer(): Renderer {
  return {
    renderUserMessage: vi.fn(),
    appendTextChunk: vi.fn(),
    renderThinkingStart: vi.fn(),
    appendThinkingChunk: vi.fn(),
    renderThinkingEnd: vi.fn(),
    renderToolUseStart: vi.fn(),
    renderToolResult: vi.fn(),
    renderTurnFooter: vi.fn(),
    renderInterruptedMarker: vi.fn(),
    showLoading: vi.fn(),
    removeLoading: vi.fn(),
    finishAssistantMessage: vi.fn(),
    clear: vi.fn(),
    cleanup: vi.fn(),
  } as unknown as Renderer;
}

function makeController() {
  const renderer = makeRenderer();
  let state: ChatStateData = createChatState();
  const controller = createStreamController(
    renderer,
    () => state,
    (next) => { state = next; }
  );
  return { renderer, controller, getState: () => state };
}

describe("StreamController", () => {
  it("stamps a duration footer on successful turns only", () => {
    const { renderer, controller } = makeController();
    controller.startStream();
    controller.handleChunk({ type: "text", content: "hi" });
    controller.handleChunk({ type: "result", content: "hi", metadata: { subtype: "success" } });
    expect(renderer.renderTurnFooter).toHaveBeenCalledTimes(1);
  });

  it("suppresses the footer when the turn errored", () => {
    const { renderer, controller } = makeController();
    controller.startStream();
    controller.handleChunk({ type: "error", content: "boom" });
    controller.handleChunk({ type: "result", content: "", metadata: { subtype: "success" } });
    expect(renderer.renderTurnFooter).not.toHaveBeenCalled();
  });

  it("suppresses the footer on non-success result subtypes", () => {
    const { renderer, controller } = makeController();
    controller.startStream();
    controller.handleChunk({ type: "result", content: "", metadata: { subtype: "error_during_execution" } });
    expect(renderer.renderTurnFooter).not.toHaveBeenCalled();
  });

  it("marks an active turn as interrupted, with no footer", () => {
    const { renderer, controller, getState } = makeController();
    controller.startStream();
    controller.handleChunk({ type: "text", content: "partial" });
    controller.markInterrupted();
    expect(renderer.renderInterruptedMarker).toHaveBeenCalledTimes(1);
    expect(renderer.renderTurnFooter).not.toHaveBeenCalled();
    expect(getState().isStreaming).toBe(false);
  });

  it("markInterrupted after the turn completed is a no-op (no double finish)", () => {
    const { renderer, controller } = makeController();
    controller.startStream();
    controller.handleChunk({ type: "result", content: "done", metadata: { subtype: "success" } });
    const finishCalls = (renderer.finishAssistantMessage as ReturnType<typeof vi.fn>).mock.calls.length;
    controller.markInterrupted();
    expect(renderer.renderInterruptedMarker).not.toHaveBeenCalled();
    expect((renderer.finishAssistantMessage as ReturnType<typeof vi.fn>).mock.calls.length).toBe(finishCalls);
  });
});
