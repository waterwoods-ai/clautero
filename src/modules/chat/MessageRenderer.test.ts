import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMessageRenderer } from "./MessageRenderer";

const copySpy = vi.fn();

function makeArea(): HTMLElement {
  document.body.innerHTML = '<div id="area"></div>';
  return document.getElementById("area") as HTMLElement;
}

describe("MessageRenderer copy & selection", () => {
  beforeEach(() => {
    copySpy.mockClear();
    (globalThis as any).Zotero = {
      log: () => {},
      Utilities: { Internal: { copyTextToClipboard: copySpy } },
    };
  });
  afterEach(() => {
    delete (globalThis as any).Zotero;
    vi.useRealTimers();
  });

  it("opts the transcript back into text selection", () => {
    const area = makeArea();
    createMessageRenderer(area);
    // jsdom drops the -moz- prefixed twin; Gecko accepts both.
    expect(area.style.getPropertyValue("user-select")).toBe("text");
  });

  it("attaches a copy button carrying the full reply text", () => {
    const area = makeArea();
    const renderer = createMessageRenderer(area);
    renderer.appendTextChunk("Hello ");
    renderer.appendTextChunk("world");
    renderer.finishAssistantMessage();

    const btn = area.querySelector(".clautero-copy-btn") as HTMLElement;
    expect(btn).not.toBeNull();
    btn.click();
    expect(copySpy).toHaveBeenCalledWith("Hello world");
    expect(btn.textContent).toContain("Copied");
  });

  it("reverts the button label after the feedback interval", () => {
    vi.useFakeTimers();
    const area = makeArea();
    const renderer = createMessageRenderer(area);
    renderer.appendTextChunk("hi");
    renderer.finishAssistantMessage();
    const btn = area.querySelector(".clautero-copy-btn") as HTMLElement;
    btn.click();
    vi.advanceTimersByTime(1500);
    expect(btn.textContent).toContain("Copy");
    expect(btn.textContent).not.toContain("Copied");
  });

  it("copies reply text across a thinking interleaving, excluding the thinking", () => {
    const area = makeArea();
    const renderer = createMessageRenderer(area);
    renderer.appendTextChunk("before ");
    renderer.renderThinkingStart();
    renderer.appendThinkingChunk("private reasoning");
    renderer.renderThinkingEnd();
    renderer.appendTextChunk("after");
    renderer.finishAssistantMessage();

    (area.querySelector(".clautero-copy-btn") as HTMLElement).click();
    expect(copySpy).toHaveBeenCalledWith("before after");
  });

  it("adds no copy button to an empty assistant message", () => {
    const area = makeArea();
    const renderer = createMessageRenderer(area);
    renderer.showLoading();
    renderer.finishAssistantMessage();
    expect(area.querySelector(".clautero-copy-btn")).toBeNull();
  });

  it("attaches one button per message, not per finish call", () => {
    const area = makeArea();
    const renderer = createMessageRenderer(area);
    renderer.appendTextChunk("a");
    renderer.finishAssistantMessage();
    renderer.appendTextChunk("b");
    renderer.finishAssistantMessage();
    const buttons = area.querySelectorAll(".clautero-copy-btn");
    expect(buttons).toHaveLength(2);
    (buttons[1] as HTMLElement).click();
    expect(copySpy).toHaveBeenCalledWith("b");
  });
});
