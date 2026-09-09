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

  it("opts the transcript into selection via class + stylesheet", () => {
    const area = makeArea();
    createMessageRenderer(area);
    // Inline styles get wiped by cssText reassignment on tab switch, so
    // the opt-in must be a class backed by an injected stylesheet rule.
    expect(area.classList.contains("clautero-selectable")).toBe(true);
    const style = document.getElementById("clautero-selection-style");
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain("user-select: text !important");
    // A second renderer must not inject a duplicate stylesheet
    const area2 = document.createElement("div");
    document.body.appendChild(area2);
    createMessageRenderer(area2);
    expect(document.querySelectorAll("#clautero-selection-style")).toHaveLength(1);
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

describe("MessageRenderer math", () => {
  beforeEach(() => {
    (globalThis as any).Zotero = { log: () => {}, Utilities: { Internal: { copyTextToClipboard: vi.fn() } } };
  });
  afterEach(() => { delete (globalThis as any).Zotero; });

  it("renders inline TeX as namespaced MathML", () => {
    const area = makeArea();
    const renderer = createMessageRenderer(area);
    renderer.appendTextChunk("Einstein: $E = mc^2$");
    renderer.finishAssistantMessage();
    const math = area.querySelector("math");
    expect(math).not.toBeNull();
    expect(area.textContent).not.toContain("$E");
  });

  it("renders display math in a scrollable block", () => {
    const area = makeArea();
    const renderer = createMessageRenderer(area);
    renderer.appendTextChunk("$$\\frac{a}{b}$$");
    renderer.finishAssistantMessage();
    expect(area.querySelector("math[display='block']")).not.toBeNull();
  });

  it("keeps dollar amounts as plain text", () => {
    const area = makeArea();
    const renderer = createMessageRenderer(area);
    renderer.appendTextChunk("that costs $5 and $10 today");
    renderer.finishAssistantMessage();
    expect(area.querySelector("math")).toBeNull();
    expect(area.textContent).toContain("$5 and $10");
  });
});
