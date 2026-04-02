/**
 * MessageRenderer — Renders chat messages into the sidebar messageArea DOM.
 *
 * Uses DOMPurify for sanitizing any markup content.
 * Never uses innerHTML directly — all content goes through DOMPurify + DOMParser
 * or textContent/createTextNode.
 */

import DOMPurify from "dompurify";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

function createEl<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string
): HTMLElementTagNameMap[K] {
  const el = doc.createElementNS(XHTML_NS, tag) as HTMLElementTagNameMap[K];
  if (className) {
    el.setAttribute("class", className);
  }
  return el;
}

function appendTextNode(parent: HTMLElement, text: string): void {
  parent.appendChild(parent.ownerDocument.createTextNode(text));
}

function sanitizeAndAppendHtml(
  parent: HTMLElement,
  html: string
): void {
  const doc = parent.ownerDocument;
  const clean = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: false,
    RETURN_DOM: false,
  });
  const parser = new DOMParser();
  const parsed = parser.parseFromString(
    `<div xmlns="${XHTML_NS}">${clean}</div>`,
    "application/xhtml+xml"
  );
  const root = parsed.documentElement;
  while (root.firstChild) {
    parent.appendChild(doc.adoptNode(root.firstChild));
  }
}

function isScrolledToBottom(el: HTMLElement): boolean {
  const threshold = 30;
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

function scrollToBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight;
}

export function createMessageRenderer(messageArea: HTMLElement) {
  const doc = messageArea.ownerDocument;
  let currentAssistantBubble: HTMLElement | null = null;
  let currentTextContainer: HTMLElement | null = null;
  let loadingIndicator: HTMLElement | null = null;
  let userScrolledUp = false;

  function trackScroll(): void {
    userScrolledUp = !isScrolledToBottom(messageArea);
  }

  messageArea.addEventListener("scroll", trackScroll);

  function autoScroll(): void {
    if (!userScrolledUp) {
      scrollToBottom(messageArea);
    }
  }

  function renderUserMessage(content: string): void {
    const bubble = createEl(doc, "div", "clautero-msg clautero-msg-user");
    appendTextNode(bubble, content);
    messageArea.appendChild(bubble);
    currentAssistantBubble = null;
    currentTextContainer = null;
    autoScroll();
  }

  function ensureAssistantBubble(): HTMLElement {
    if (!currentAssistantBubble) {
      const bubble = createEl(
        doc, "div", "clautero-msg clautero-msg-assistant"
      );
      messageArea.appendChild(bubble);
      currentAssistantBubble = bubble;
      currentTextContainer = null;
    }
    return currentAssistantBubble as HTMLElement;
  }

  function ensureTextContainer(): HTMLElement {
    const bubble = ensureAssistantBubble();
    if (!currentTextContainer) {
      const container = createEl(doc, "div", "clautero-msg-text");
      bubble.appendChild(container);
      currentTextContainer = container;
    }
    return currentTextContainer as HTMLElement;
  }

  function appendTextChunk(content: string): void {
    const container = ensureTextContainer();
    sanitizeAndAppendHtml(container, content);
    autoScroll();
  }

  function renderThinkingStart(): void {
    const bubble = ensureAssistantBubble();
    const details = createEl(doc, "details", "clautero-thinking");
    const summary = createEl(doc, "summary", "clautero-thinking-summary");
    appendTextNode(summary, "Thinking\u2026");
    details.appendChild(summary);

    const body = createEl(doc, "div", "clautero-thinking-body");
    details.appendChild(body);
    bubble.appendChild(details);

    // Reset text container so subsequent text goes into the thinking body
    currentTextContainer = body;
    autoScroll();
  }

  function appendThinkingChunk(content: string): void {
    // Thinking content goes into the current thinking body
    const container = currentTextContainer;
    if (container) {
      appendTextNode(container, content);
      autoScroll();
    }
  }

  function renderThinkingEnd(): void {
    // Close off thinking block; next text starts a fresh container
    currentTextContainer = null;
  }

  function renderToolUseStart(toolName: string, args: string): void {
    const bubble = ensureAssistantBubble();
    const details = createEl(doc, "details", "clautero-tool-use");
    const summary = createEl(doc, "summary", "clautero-tool-summary");
    appendTextNode(summary, `Tool: ${toolName}`);
    details.appendChild(summary);

    const argsBlock = createEl(doc, "pre", "clautero-tool-args");
    appendTextNode(argsBlock, args);
    details.appendChild(argsBlock);

    bubble.appendChild(details);
    currentTextContainer = null;
    autoScroll();
  }

  function renderToolResult(content: string): void {
    const bubble = ensureAssistantBubble();
    // Find the last tool-use details element
    const toolDetails = bubble.querySelector(
      ".clautero-tool-use:last-of-type"
    );
    if (toolDetails) {
      const resultBlock = createEl(doc, "pre", "clautero-tool-result");
      appendTextNode(resultBlock, content);
      toolDetails.appendChild(resultBlock);
    }
    currentTextContainer = null;
    autoScroll();
  }

  function showLoading(): void {
    removeLoading();
    const indicator = createEl(doc, "div", "clautero-loading");
    for (let i = 0; i < 3; i++) {
      const dot = createEl(doc, "span", "clautero-loading-dot");
      appendTextNode(dot, "\u2022");
      indicator.appendChild(dot);
    }
    loadingIndicator = indicator;
    messageArea.appendChild(indicator);
    autoScroll();
  }

  function removeLoading(): void {
    if (loadingIndicator) {
      loadingIndicator.remove();
      loadingIndicator = null;
    }
  }

  function finishAssistantMessage(): void {
    removeLoading();
    currentAssistantBubble = null;
    currentTextContainer = null;
  }

  function clear(): void {
    while (messageArea.firstChild) {
      messageArea.removeChild(messageArea.firstChild);
    }
    currentAssistantBubble = null;
    currentTextContainer = null;
    removeLoading();
  }

  function cleanup(): void {
    messageArea.removeEventListener("scroll", trackScroll);
    clear();
  }

  return {
    renderUserMessage,
    appendTextChunk,
    renderThinkingStart,
    appendThinkingChunk,
    renderThinkingEnd,
    renderToolUseStart,
    renderToolResult,
    showLoading,
    removeLoading,
    finishAssistantMessage,
    clear,
    cleanup,
  };
}
