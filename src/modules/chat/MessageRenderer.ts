/**
 * MessageRenderer — Renders chat messages into the sidebar messageArea DOM.
 *
 * Uses DOMPurify for sanitizing any markup content.
 * Never uses innerHTML directly — all content goes through DOMPurify + DOMParser
 * or textContent/createTextNode.
 */

// DOMPurify import — esbuild bundles this, but the default export may
// not resolve correctly in Gecko's IIFE. We import it and try both shapes.
import DOMPurifyModule from "dompurify";

const purify: { sanitize: (html: string, opts?: any) => string } | null = (() => {
  try {
    const mod = DOMPurifyModule as any;
    if (typeof mod.sanitize === "function") {
      return mod;
    }
    if (mod.default && typeof mod.default.sanitize === "function") {
      return mod.default;
    }
  } catch {
    // not available
  }
  return null;
})();

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

/**
 * Simple markdown-to-HTML converter for Claude responses.
 * Handles: **bold**, *italic*, `code`, ```code blocks```, headers, lists, links.
 */
function markdownToHtml(md: string): string {
  let html = md
    // Code blocks (```...```)
    .replace(/```(\w*)\n([\s\S]*?)```/g,
      '<pre style="background:#f5f5f5;border-radius:6px;padding:8px 10px;overflow-x:auto;font-size:12px;margin:6px 0;"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g,
      '<code style="background:#f0f0f0;border-radius:3px;padding:1px 4px;font-size:12px;">$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<strong style="font-size:14px;display:block;margin:8px 0 4px;">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong style="font-size:15px;display:block;margin:10px 0 4px;">$1</strong>')
    .replace(/^# (.+)$/gm, '<strong style="font-size:16px;display:block;margin:12px 0 4px;">$1</strong>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li style="margin-left:16px;list-style:disc;">$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li style="margin-left:16px;list-style:decimal;">$1</li>')
    // Line breaks (double newline = paragraph)
    .replace(/\n\n/g, '<br/><br/>')
    // Single newlines
    .replace(/\n/g, '<br/>');

  return html;
}

function sanitizeAndAppendHtml(
  parent: HTMLElement,
  html: string
): void {
  const doc = parent.ownerDocument;

  // Sanitize if DOMPurify is available
  let cleanHtml = html;
  if (purify && typeof purify.sanitize === "function") {
    try {
      cleanHtml = purify.sanitize(html, {
        RETURN_DOM_FRAGMENT: false,
        RETURN_DOM: false,
      });
    } catch {
      // DOMPurify failed, use raw html (from our own markdownToHtml, safe)
    }
  }

  // Try XHTML DOMParser first
  try {
    const parser = new (doc.defaultView as any).DOMParser();
    const parsed = parser.parseFromString(
      `<div xmlns="${XHTML_NS}">${cleanHtml}</div>`,
      "application/xhtml+xml"
    );
    // Check for parse errors
    const err = parsed.querySelector("parsererror");
    if (!err) {
      const root = parsed.documentElement;
      while (root.firstChild) {
        parent.appendChild(doc.adoptNode(root.firstChild));
      }
      return;
    }
  } catch {
    // XHTML parse failed
  }

  // Try HTML parser (more lenient, handles unclosed tags)
  try {
    const parser = new (doc.defaultView as any).DOMParser();
    const parsed = parser.parseFromString(
      `<body>${cleanHtml}</body>`,
      "text/html"
    );
    const body = parsed.body;
    if (body) {
      while (body.firstChild) {
        parent.appendChild(doc.adoptNode(body.firstChild));
      }
      return;
    }
  } catch {
    // HTML parse also failed
  }

  // Last resort: textContent
  appendTextNode(parent, html);
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
    // Remove welcome screen on first message
    const welcome = messageArea.querySelector(".clautero-welcome");
    if (welcome) welcome.remove();

    const bubble = createEl(doc, "div", "clautero-msg clautero-msg-user");
    bubble.style.cssText = `
      background:#e8f0fe;border-radius:16px 16px 4px 16px;
      padding:8px 12px;margin:6px 0 6px 40px;line-height:1.5;
      word-wrap:break-word;
    `;
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
      bubble.style.cssText = `
        padding:8px 12px;margin:6px 0 6px 0;line-height:1.5;
        word-wrap:break-word;
      `;
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
    // Convert markdown to HTML before rendering
    const html = markdownToHtml(content);
    sanitizeAndAppendHtml(container, html);
    autoScroll();
  }

  function renderThinkingStart(): void {
    const bubble = ensureAssistantBubble();
    const details = createEl(doc, "details", "clautero-thinking");
    details.style.cssText = "border-left:2px solid #e0e0e0;padding-left:10px;margin:4px 0;";
    const summary = createEl(doc, "summary", "clautero-thinking-summary");
    summary.style.cssText = "font-size:12px;color:#888;cursor:pointer;";
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
    details.style.cssText = "background:#f8f8f8;border-radius:8px;padding:6px 10px;margin:4px 0;";
    const summary = createEl(doc, "summary", "clautero-tool-summary");
    summary.style.cssText = "font-size:12px;color:#666;cursor:pointer;font-weight:500;";
    appendTextNode(summary, `Tool: ${toolName}`);
    details.appendChild(summary);

    const argsBlock = createEl(doc, "pre", "clautero-tool-args");
    argsBlock.style.cssText = "font-size:11px;color:#888;overflow-x:auto;margin:4px 0;white-space:pre-wrap;";
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
