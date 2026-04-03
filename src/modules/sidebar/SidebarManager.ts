/**
 * SidebarManager — Adds a persistent icon to Zotero's sidenav and
 * shows a right-side panel (like Claudian) when clicked.
 *
 * Approach:
 * 1. Inject a button into the item-pane-sidenav element (always visible)
 * 2. Create a side panel as a sibling to the existing item pane
 * 3. Toggle panel visibility on button click
 */

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

interface SidebarElements {
  readonly messageArea: HTMLElement;
  readonly contextBar: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  readonly sendButton: HTMLElement;
}

let registeredElements: SidebarElements | null = null;

function createXUL(doc: Document, tag: string): Element {
  if ("createXULElement" in doc) {
    return (doc as any).createXULElement(tag);
  }
  return doc.createElementNS(XUL_NS, tag);
}

function htmlEl(doc: Document, tag: string, style: string, cls?: string): HTMLElement {
  const e = doc.createElementNS(XHTML_NS, tag) as HTMLElement;
  e.style.cssText = style;
  if (cls) e.className = cls;
  return e;
}

export function initSidebarManager(
  win: Window,
  rootURI: string
): () => void {
  const doc = win.document;
  let panelVisible = false;
  let panel: Element | null = null;
  let sidenavBtn: HTMLElement | null = null;
  const cleanups: Array<() => void> = [];

  // ── Step 1: Create the panel (hidden initially) ──
  // This replaces the item pane content when the Clautero icon is clicked
  const container = createXUL(doc, "vbox");
  container.setAttribute("id", "clautero-sidebar");
  container.setAttribute("style", "display:none;");

  // XHTML wrapper for chat UI
  const wrapper = htmlEl(doc, "div", `
    display:flex;flex-direction:column;height:100%;width:100%;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;
    background:#fff;color:#1a1a1a;
  `);

  // Header
  const header = htmlEl(doc, "div", `
    display:flex;align-items:center;justify-content:space-between;
    padding:8px 12px;border-bottom:1px solid #e0e0e0;
    background:#f8f8f8;flex-shrink:0;
  `);
  const titleEl = htmlEl(doc, "span", "font-weight:600;font-size:14px;color:#333;");
  titleEl.textContent = "Clautero";
  const closeBtn = htmlEl(doc, "button", `
    background:none;border:none;font-size:18px;cursor:pointer;
    color:#666;padding:2px 6px;border-radius:4px;line-height:1;
  `);
  closeBtn.textContent = "\u00D7";
  closeBtn.addEventListener("click", () => togglePanel());
  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  // Message area
  const messageArea = htmlEl(doc, "div",
    "flex:1;overflow-y:auto;padding:10px 12px;",
    "clautero-messages"
  );
  const welcome = htmlEl(doc, "p", "color:#999;font-style:italic;text-align:center;margin:40px 0;");
  welcome.textContent = "Ask Claude about your research...";
  messageArea.appendChild(welcome);

  // Context bar
  const contextBar = htmlEl(doc, "div", "padding:0 10px;", "clautero-context-bar");

  // Input area
  const inputArea = htmlEl(doc, "div", "display:flex;gap:6px;padding:10px 12px;border-top:1px solid #e0e0e0;");
  const textarea = doc.createElementNS(XHTML_NS, "textarea") as HTMLTextAreaElement;
  textarea.placeholder = "Type a message...";
  textarea.rows = 3;
  textarea.style.cssText = `
    flex:1;resize:none;border:1px solid #d0d0d0;border-radius:8px;padding:8px 10px;
    font-size:13px;font-family:inherit;outline:none;background:#fff;color:#333;
  `;
  const sendButton = htmlEl(doc, "button", `
    padding:8px 16px;border:none;border-radius:8px;cursor:pointer;
    background:#3584e4;color:white;font-size:13px;font-weight:600;align-self:flex-end;
  `);
  sendButton.textContent = "Send";
  inputArea.appendChild(textarea);
  inputArea.appendChild(sendButton);

  wrapper.appendChild(header);
  wrapper.appendChild(messageArea);
  wrapper.appendChild(contextBar);
  wrapper.appendChild(inputArea);
  container.appendChild(wrapper);

  panel = container;
  registeredElements = Object.freeze({ messageArea, contextBar, textarea, sendButton });

  // ── Step 2: Inject panel into the item pane content area ──
  // The right pane has: [content area | sidenav icons]
  // We inject our panel into the content area's parent, alongside the
  // existing item details. When Clautero icon is clicked, we hide the
  // item pane content and show ours (and vice versa).
  let injected = false;
  let itemPaneContent: HTMLElement | null = null;

  function injectPanel(): boolean {
    // Find the sidenav
    const sidenav = doc.querySelector("item-pane-sidenav") as HTMLElement;
    if (!sidenav || !sidenav.parentElement) {
      return false;
    }

    const paneParent = sidenav.parentElement;

    // Log the structure for debugging
    const childTags = Array.from(paneParent.children)
      .map((c, i) => `${i}:${c.tagName}#${(c as HTMLElement).id || ""}`)
      .join(", ");
    Zotero.log(`[Clautero] Pane parent children: ${childTags}`, "info");

    // The item details content is everything in paneParent that is NOT
    // the sidenav. It could be a single element or multiple.
    // Find the main content element (usually the first non-sidenav child)
    for (const child of Array.from(paneParent.children)) {
      if (child !== sidenav
        && child.tagName.toLowerCase() !== "splitter"
        && child !== container) {
        itemPaneContent = child as HTMLElement;
        break;
      }
    }

    // Make pane parent position:relative so our absolute overlay works
    (paneParent as HTMLElement).style.position = "relative";

    if (itemPaneContent) {
      // Insert our panel into paneParent — it will overlay on top when shown
      paneParent.insertBefore(container, sidenav);
      Zotero.log(`[Clautero] Panel injected before sidenav, after content`, "info");
    } else {
      paneParent.insertBefore(container, sidenav);
      Zotero.log(`[Clautero] Panel injected before sidenav (no content found)`, "info");
    }

    return true;
  }

  // Poll until sidenav exists
  let injectPoll = 0;
  const injectTimer = (win as any).setInterval(() => {
    injectPoll++;
    if (injectPoll > 60) {
      (win as any).clearInterval(injectTimer);
      return;
    }
    if (!injected) {
      injected = injectPanel();
      if (injected) {
        (win as any).clearInterval(injectTimer);
      }
    }
  }, 500);
  cleanups.push(() => (win as any).clearInterval(injectTimer));

  // ── Step 3: Inject button into sidenav ──
  function injectSidenavButton(): void {
    // Find the sidenav element
    const sidenav = doc.querySelector("item-pane-sidenav") as HTMLElement
      ?? doc.querySelector("[class*='sidenav']") as HTMLElement;

    if (!sidenav) {
      Zotero.log("[Clautero] Sidenav not found, will retry", "info");
      return;
    }

    // Don't add duplicate
    if (doc.getElementById("clautero-sidenav-btn")) {
      return;
    }

    // Create a button matching sidenav style
    const btn = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    btn.id = "clautero-sidenav-btn";
    btn.className = "btn";
    btn.setAttribute("title", "Clautero Chat");
    btn.style.cssText = `
      width:28px;height:28px;display:flex;align-items:center;justify-content:center;
      cursor:pointer;border-radius:4px;margin:2px 0;
    `;

    // Chat icon SVG
    const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("width", "16");
    icon.setAttribute("height", "16");
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "#666");
    path.setAttribute("d", "M8 1C4.1 1 1 3.6 1 7c0 1.8 1 3.4 2.5 4.5L3 14l3-1.8c.6.2 1.3.3 2 .3 3.9 0 7-2.6 7-6S11.9 1 8 1z");
    icon.appendChild(path);
    btn.appendChild(icon);

    btn.addEventListener("click", () => togglePanel());

    // Find the button container inside sidenav
    const btnContainer = sidenav.querySelector(".inherit-flex")
      ?? sidenav.shadowRoot?.querySelector(".inherit-flex")
      ?? sidenav;

    btnContainer.appendChild(btn);
    sidenavBtn = btn;
    Zotero.log("[Clautero] Sidenav button injected", "info");

    // Watch for clicks on other sidenav buttons to restore item content
    watchOtherButtons();
  }

  // Poll for sidenav (it may not exist immediately)
  let pollCount = 0;
  const pollTimer = (win as any).setInterval(() => {
    pollCount++;
    if (pollCount > 60) {
      (win as any).clearInterval(pollTimer);
      return;
    }
    if (!doc.getElementById("clautero-sidenav-btn")) {
      injectSidenavButton();
    } else {
      (win as any).clearInterval(pollTimer);
    }
  }, 500);
  cleanups.push(() => (win as any).clearInterval(pollTimer));

  // ── Toggle logic ──
  // Use a stacking approach: both content and chat panel exist in the same
  // space. We toggle which one is visible using z-index/position overlay
  // instead of display:none, so Zotero's pane state is never disrupted.
  function showChat(): void {
    panelVisible = true;
    // Show our panel on top of item content (don't hide content)
    (container as HTMLElement).style.cssText =
      "position:absolute;top:0;left:0;right:0;bottom:0;display:flex;z-index:100;background:#fff;";
    textarea.focus();
    if (sidenavBtn) sidenavBtn.style.background = "rgba(0,0,0,0.08)";
  }

  function hideChat(): void {
    panelVisible = false;
    (container as HTMLElement).style.cssText = "display:none;";
    if (sidenavBtn) sidenavBtn.style.background = "";
  }

  function togglePanel(): void {
    if (panelVisible) {
      hideChat();
    } else {
      showChat();
    }
  }

  // When any OTHER sidenav button is clicked, hide our panel
  function watchOtherButtons(): void {
    const sidenav = doc.querySelector("item-pane-sidenav") as HTMLElement;
    if (!sidenav) return;

    sidenav.addEventListener("click", (e: Event) => {
      const target = e.target as HTMLElement;
      const btn = target.closest(".btn") as HTMLElement | null;
      if (btn && btn.id !== "clautero-sidenav-btn" && panelVisible) {
        hideChat();
      }
    }, true);
  }

  // ── Keyboard shortcut: Cmd+Shift+C ──
  const keyHandler = (e: Event) => {
    const ke = e as KeyboardEvent;
    const mod = navigator.platform.includes("Mac") ? ke.metaKey : ke.ctrlKey;
    if (mod && ke.shiftKey && ke.key === "C") {
      ke.preventDefault();
      togglePanel();
    }
  };
  win.addEventListener("keydown", keyHandler, true);
  cleanups.push(() => win.removeEventListener("keydown", keyHandler, true));

  // Expose API
  (win as any).__clauteroSidebar = Object.freeze({
    toggle: togglePanel,
    show: () => { if (!panelVisible) togglePanel(); },
    hide: () => { if (panelVisible) togglePanel(); },
    isVisible: () => panelVisible,
    getElements: () => registeredElements,
  });

  Zotero.log("[Clautero] Sidebar manager initialized", "info");

  // ── Cleanup ──
  return () => {
    for (const fn of cleanups) fn();
    hideChat();
    container.remove();
    if (sidenavBtn) sidenavBtn.remove();
    registeredElements = null;
    delete (win as any).__clauteroSidebar;
  };
}
