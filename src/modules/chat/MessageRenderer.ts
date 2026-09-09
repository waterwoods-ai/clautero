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
import { transformMarkdownSegments } from "./MarkdownSegments";
import temml from "temml";

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Markdown transforms for prose only — code segments never pass through here. */
function proseToHtml(text: string): string {
  return text
    // Headers
    .replace(/^### (.+)$/gm, '<strong style="font-size:14px;display:block;margin:8px 0 4px;">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong style="font-size:15px;display:block;margin:10px 0 4px;">$1</strong>')
    .replace(/^# (.+)$/gm, '<strong style="font-size:16px;display:block;margin:12px 0 4px;">$1</strong>')
    // Bold (allow spanning across newlines)
    .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
    // Italic (single line only to avoid false matches)
    .replace(/(?<!\*)\*([^\*\n]+?)\*(?!\*)/g, '<em>$1</em>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li style="margin-left:16px;list-style:disc;">$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li style="margin-left:16px;list-style:decimal;">$1</li>')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid #e0e0e0;margin:12px 0;"/>')
    // Line breaks (double newline = paragraph)
    .replace(/\n\n/g, '<br/><br/>')
    // Single newlines
    .replace(/\n/g, '<br/>');
}

/**
 * LaTeX → MathML via Temml; Gecko renders MathML natively (no font payload).
 * The MathML namespace is stamped on so the XHTML parse path keeps the
 * subtree in the MathML namespace; the html parser ignores it harmlessly.
 */
function mathToHtml(tex: string, raw: string, display: boolean): string {
  try {
    const mathml = temml.renderToString(tex, { displayMode: display, throwOnError: false });
    const namespaced = mathml.replace("<math", '<math xmlns="http://www.w3.org/1998/Math/MathML"');
    return display
      ? '<div style="margin:8px 0;overflow-x:auto;">' + namespaced + "</div>"
      : namespaced;
  } catch {
    return '<code style="background:#f0f0f0;border-radius:3px;padding:1px 4px;font-size:12px;">'
      + escapeHtml(raw) + "</code>";
  }
}

function inlineCodeToHtml(code: string): string {
  return '<code style="background:#f0f0f0;border-radius:3px;padding:1px 4px;font-size:12px;box-decoration-break:clone;">'
    + escapeHtml(code) + '</code>';
}

function fenceToHtml(code: string): string {
  return '<pre style="background:#f5f5f5;border-radius:6px;padding:8px 10px;overflow-x:auto;font-size:12px;margin:6px 0;"><code>'
    + escapeHtml(code) + '</code></pre>';
}

/** Cell content gets the inline transforms (bold, code, math) but no blocks. */
function cellToHtml(text: string): string {
  return transformMarkdownSegments(text, {
    text: proseToHtml,
    inlineCode: inlineCodeToHtml,
    fence: fenceToHtml,
    inlineMath: (tex, raw) => mathToHtml(tex, raw, false),
    displayMath: (tex, raw) => mathToHtml(tex, raw, true),
  });
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

const CELL_STYLE = "border:1px solid #e0e0e0;padding:4px 8px;vertical-align:top;";

function tableToHtml(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return proseToHtml(content);

  const headers = splitTableRow(lines[0]);
  const aligns = splitTableRow(lines[1]).map((sep) => {
    const left = sep.startsWith(":");
    const right = sep.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
  const alignFor = (i: number) => aligns[i] ?? "left";

  let html = '<div style="overflow-x:auto;margin:8px 0;">'
    + '<table style="border-collapse:collapse;font-size:12px;line-height:1.4;">';
  html += "<thead><tr>";
  headers.forEach((h, i) => {
    html += '<th style="' + CELL_STYLE + 'background:#f7f7f7;font-weight:600;text-align:' + alignFor(i) + ';">'
      + cellToHtml(h) + "</th>";
  });
  html += "</tr></thead><tbody>";
  for (const rowLine of lines.slice(2)) {
    html += "<tr>";
    splitTableRow(rowLine).forEach((cell, i) => {
      html += '<td style="' + CELL_STYLE + 'text-align:' + alignFor(i) + ';">' + cellToHtml(cell) + "</td>";
    });
    html += "</tr>";
  }
  html += "</tbody></table></div>";
  return html;
}

/**
 * Markdown-to-HTML via code-aware segmentation: prose transforms run only on
 * text segments, and code content is HTML-escaped so it renders literally.
 */
function markdownToHtml(md: string): string {
  return transformMarkdownSegments(md, {
    text: proseToHtml,
    inlineMath: (tex, raw) => mathToHtml(tex, raw, false),
    displayMath: (tex, raw) => mathToHtml(tex, raw, true),
    inlineCode: inlineCodeToHtml,
    fence: fenceToHtml,
    table: tableToHtml,
  });
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

const SELECTION_STYLE_ID = "clautero-selection-style";

/**
 * Gecko's XUL UA stylesheet sets `:root { user-select: none }` on the whole
 * Zotero window, so transcripts must opt back in. A stylesheet rule keyed to
 * a class is used (not inline styles) because session containers have their
 * style.cssText reassigned on every tab switch, which wipes inline props.
 */
function ensureSelectionStylesheet(doc: Document): void {
  if (doc.getElementById(SELECTION_STYLE_ID)) return;
  const style = doc.createElementNS(XHTML_NS, "style") as HTMLElement;
  style.id = SELECTION_STYLE_ID;
  style.textContent =
    ".clautero-selectable, .clautero-selectable * {" +
    " -moz-user-select: text !important; user-select: text !important; }" +
    " .clautero-selectable .clautero-copy-btn," +
    " .clautero-selectable .clautero-copy-btn * {" +
    " -moz-user-select: none !important; user-select: none !important; }";
  doc.documentElement.appendChild(style);
}

export function copyTextToClipboard(doc: Document, text: string): boolean {
  try {
    const utils = (Zotero as unknown as {
      Utilities?: { Internal?: { copyTextToClipboard?: (t: string) => void } };
    }).Utilities;
    if (utils?.Internal?.copyTextToClipboard) {
      utils.Internal.copyTextToClipboard(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const nav = doc.defaultView?.navigator;
    if (nav?.clipboard?.writeText) {
      void nav.clipboard.writeText(text);
      return true;
    }
  } catch { /* ignore */ }
  return false;
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

  // Zotero's XUL chrome disables text selection by default; opt the
  // transcript back in so replies can be selected and copied. This must
  // be class + stylesheet based — see ensureSelectionStylesheet.
  ensureSelectionStylesheet(doc);
  messageArea.classList.add("clautero-selectable");
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
      rawTextBuffer = ""; // Reset buffer for new assistant message
      bubbleCopyText = "";
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

  // Accumulate raw text so markdown renders correctly across chunk boundaries
  let rawTextBuffer = "";
  // Full plain text of the current assistant message (across thinking/tool
  // interleavings) — what the copy button puts on the clipboard.
  let bubbleCopyText = "";

  function appendTextChunk(content: string): void {
    const container = ensureTextContainer();
    rawTextBuffer += content;
    bubbleCopyText += content;

    // Re-render the full accumulated text as markdown
    // This ensures **bold** spanning across chunks renders correctly
    while (container.firstChild) container.removeChild(container.firstChild);
    const html = markdownToHtml(rawTextBuffer);
    sanitizeAndAppendHtml(container, html);
    autoScroll();
  }

  let thinkingStartTime = 0;
  let thinkingSummaryEl: HTMLElement | null = null;

  function renderThinkingStart(): void {
    const bubble = ensureAssistantBubble();
    thinkingStartTime = Date.now();

    const details = createEl(doc, "details", "clautero-thinking");
    details.style.cssText = "margin:4px 0 8px;";

    const summary = createEl(doc, "summary", "clautero-thinking-summary");
    summary.style.cssText = "font-size:13px;color:#c47a4a;cursor:pointer;font-style:italic;";
    appendTextNode(summary, "Thinking\u2026");
    thinkingSummaryEl = summary;
    details.appendChild(summary);

    const body = createEl(doc, "div", "clautero-thinking-body");
    body.style.cssText = "font-size:12px;color:#888;padding:4px 0;line-height:1.4;";
    details.appendChild(body);
    bubble.appendChild(details);

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
    // Update summary to show duration: "Thought for Xs"
    if (thinkingSummaryEl && thinkingStartTime > 0) {
      const elapsed = Math.round((Date.now() - thinkingStartTime) / 1000);
      while (thinkingSummaryEl.firstChild) thinkingSummaryEl.removeChild(thinkingSummaryEl.firstChild);
      appendTextNode(thinkingSummaryEl, `Thought for ${elapsed}s`);
      thinkingStartTime = 0;
      thinkingSummaryEl = null;
    }
    currentTextContainer = null;
    rawTextBuffer = ""; // Reset so post-thinking text starts fresh
  }

  function renderToolUseStart(toolName: string, args: string): void {
    const bubble = ensureAssistantBubble();
    const details = createEl(doc, "details", "clautero-tool-use");
    details.style.cssText = "background:#f8f8f8;border-radius:8px;padding:6px 10px;margin:4px 0;";
    const summary = createEl(doc, "summary", "clautero-tool-summary");
    summary.style.cssText = "font-size:13px;color:#666;cursor:pointer;display:flex;align-items:center;gap:4px;";

    // Tool icon + name + checkmark (like Claudian)
    const iconSpan = createEl(doc, "span");
    iconSpan.style.cssText = "font-size:14px;";
    appendTextNode(iconSpan, "\uD83D\uDD27"); // wrench icon
    summary.appendChild(iconSpan);

    const nameSpan = createEl(doc, "span");
    nameSpan.style.cssText = "font-family:monospace;font-size:12px;";
    appendTextNode(nameSpan, toolName);
    summary.appendChild(nameSpan);
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
    const toolDetails = bubble.querySelector(
      ".clautero-tool-use:last-of-type"
    );
    if (toolDetails) {
      // Add checkmark to summary (like Claudian)
      const summary = toolDetails.querySelector("summary");
      if (summary) {
        const check = createEl(doc, "span");
        check.style.cssText = "color:#27ae60;margin-left:4px;";
        appendTextNode(check, "\u2713");
        summary.appendChild(check);
      }

      const resultBlock = createEl(doc, "pre", "clautero-tool-result");
      resultBlock.style.cssText = "font-size:11px;color:#888;overflow-x:auto;margin:4px 0;white-space:pre-wrap;";
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
    const hint = createEl(doc, "span", "clautero-esc-hint");
    hint.style.cssText = "font-size:11px;color:#bbb;margin-left:8px;";
    appendTextNode(hint, "esc to interrupt");
    indicator.appendChild(hint);
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

  function attachCopyButton(): void {
    const bubble = currentAssistantBubble;
    if (!bubble || !bubbleCopyText.trim()) return;
    if (bubble.querySelector(".clautero-copy-btn")) return;

    const text = bubbleCopyText;
    const btn = createEl(doc, "button", "clautero-copy-btn");
    btn.style.cssText =
      "border:none;background:transparent;color:#aaa;font-size:11px;" +
      "cursor:pointer;padding:2px 0;margin-top:4px;display:block;" +
      "-moz-user-select:none;user-select:none;";
    btn.setAttribute("title", "Copy message");
    appendTextNode(btn, "⧉ Copy");
    btn.addEventListener("mouseenter", () => { btn.style.color = "#666"; });
    btn.addEventListener("mouseleave", () => { btn.style.color = "#aaa"; });
    btn.addEventListener("click", () => {
      const ok = copyTextToClipboard(doc, text);
      while (btn.firstChild) btn.removeChild(btn.firstChild);
      appendTextNode(btn, ok ? "✓ Copied" : "✗ Copy failed");
      (doc.defaultView as Window).setTimeout(() => {
        while (btn.firstChild) btn.removeChild(btn.firstChild);
        appendTextNode(btn, "⧉ Copy");
      }, 1500);
    });
    bubble.appendChild(btn);
  }

  function renderTurnFooter(text: string): void {
    if (!currentAssistantBubble) return;
    const footer = createEl(doc, "div", "clautero-turn-footer");
    footer.style.cssText = "font-size:11px;color:#aaa;font-style:italic;margin-top:4px;";
    appendTextNode(footer, text);
    currentAssistantBubble.appendChild(footer);
    autoScroll();
  }

  function renderInterruptedMarker(): void {
    const marker = createEl(doc, "div", "clautero-interrupted");
    marker.style.cssText =
      "font-size:12px;color:#e67e22;border-left:2px solid #e67e22;" +
      "padding:2px 8px;margin:6px 0;";
    appendTextNode(marker, "Interrupted · send a new message to continue");
    messageArea.appendChild(marker);
    autoScroll();
  }

  function finishAssistantMessage(): void {
    removeLoading();
    attachCopyButton();
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
    renderTurnFooter,
    renderInterruptedMarker,
    showLoading,
    removeLoading,
    finishAssistantMessage,
    clear,
    cleanup,
  };
}
