/**
 * SidebarDOM — Creates and injects sidebar DOM elements into Zotero's main window.
 *
 * All elements are created via createElementNS for XHTML/XUL compatibility.
 * Never uses innerHTML (chrome-privileged XHTML security requirement).
 */

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

interface SidebarElements {
  readonly splitter: Element;
  readonly container: Element;
  readonly messageArea: HTMLElement;
  readonly contextBar: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  readonly sendButton: HTMLElement;
}

function createXulElement(doc: Document, tag: string, attrs: Record<string, string> = {}): Element {
  const el = doc.createElementNS(XUL_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

function createHtmlElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string> = {}
): HTMLElementTagNameMap[K] {
  const el = doc.createElementNS(XHTML_NS, tag) as HTMLElementTagNameMap[K];
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

function buildHeader(doc: Document, onClose: () => void): HTMLElement {
  const header = createHtmlElement(doc, "div", { class: "clautero-header" });

  const title = createHtmlElement(doc, "span", { class: "clautero-header-title" });
  title.textContent = "Clautero";
  header.appendChild(title);

  const closeBtn = createHtmlElement(doc, "button", {
    class: "clautero-header-close",
    "aria-label": "Close sidebar",
  });
  closeBtn.textContent = "\u00D7";
  closeBtn.addEventListener("click", onClose);
  header.appendChild(closeBtn);

  return header;
}

function buildMessageArea(doc: Document): HTMLElement {
  return createHtmlElement(doc, "div", {
    class: "clautero-messages",
    role: "log",
    "aria-live": "polite",
  });
}

function buildContextBar(doc: Document): HTMLElement {
  return createHtmlElement(doc, "div", { class: "clautero-context-bar" });
}

function buildInputArea(doc: Document): {
  wrapper: HTMLElement;
  textarea: HTMLTextAreaElement;
  sendButton: HTMLElement;
} {
  const wrapper = createHtmlElement(doc, "div", { class: "clautero-input-area" });

  const textarea = createHtmlElement(doc, "textarea", {
    class: "clautero-input-textarea",
    placeholder: "Ask Claude about your research\u2026",
    rows: "3",
  });
  wrapper.appendChild(textarea);

  const sendButton = createHtmlElement(doc, "button", {
    class: "clautero-input-send",
    "aria-label": "Send message",
  });
  sendButton.textContent = "Send";
  wrapper.appendChild(sendButton);

  return { wrapper, textarea, sendButton };
}

function injectStylesheet(doc: Document, rootURI: string): HTMLElement {
  const link = createHtmlElement(doc, "link", {
    rel: "stylesheet",
    href: `${rootURI}content/sidebar.css`,
    type: "text/css",
  });
  doc.head.appendChild(link);
  return link;
}

/**
 * Injects the sidebar DOM structure into the Zotero main window.
 * Returns the sidebar elements and a cleanup function.
 */
export function createSidebarDOM(
  window: Window,
  rootURI: string,
  options: { width: number; onClose: () => void }
): { elements: SidebarElements; cleanup: () => void } {
  const doc = window.document;

  // Inject CSS
  const styleLink = injectStylesheet(doc, rootURI);

  // Create XUL splitter for resizing
  const splitter = createXulElement(doc, "splitter", {
    id: "clautero-splitter",
    resizebefore: "closest",
    resizeafter: "closest",
    class: "clautero-splitter",
  });
  const grippy = createXulElement(doc, "grippy");
  splitter.appendChild(grippy);

  // Create XUL vbox as the outer container (for XUL splitter compat)
  const container = createXulElement(doc, "vbox", {
    id: "clautero-sidebar",
    width: String(options.width),
    persist: "width",
  });

  // Wrap all XHTML content in an XHTML div — mixing XUL parent with XHTML
  // children directly causes gray/unstyled rendering in Gecko
  const htmlWrapper = createHtmlElement(doc, "div", {
    class: "clautero-sidebar-inner",
  });

  // Build internal XHTML structure
  const header = buildHeader(doc, options.onClose);
  const messageArea = buildMessageArea(doc);
  const contextBar = buildContextBar(doc);
  const { wrapper: inputArea, textarea, sendButton } = buildInputArea(doc);

  htmlWrapper.appendChild(header);
  htmlWrapper.appendChild(messageArea);
  htmlWrapper.appendChild(contextBar);
  htmlWrapper.appendChild(inputArea);
  container.appendChild(htmlWrapper);

  // Find injection point: the main horizontal layout
  const mainHbox = doc.getElementById("browser-border-start")?.parentElement
    ?? doc.querySelector("hbox.zotero-main")
    ?? doc.querySelector("#main-window > hbox")
    ?? doc.querySelector("#main-window hbox");

  if (!mainHbox) {
    throw new Error("[Clautero] Could not find main window layout for sidebar injection");
  }

  mainHbox.appendChild(splitter);
  mainHbox.appendChild(container);

  const elements: SidebarElements = Object.freeze({
    splitter,
    container,
    messageArea: messageArea as HTMLElement,
    contextBar: contextBar as HTMLElement,
    textarea,
    sendButton,
  });

  const cleanup = () => {
    try {
      splitter.remove();
      container.remove();
      styleLink.remove();
    } catch (error) {
      Zotero.log(`[Clautero] Error cleaning up sidebar DOM: ${error}`, "warning");
    }
  };

  return { elements, cleanup };
}
