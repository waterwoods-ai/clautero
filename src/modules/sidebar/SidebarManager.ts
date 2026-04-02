/**
 * SidebarManager — Creates a floating chat panel (like zotero-gpt).
 *
 * Instead of fighting with ItemPaneManager's collapsible sections,
 * we create a fixed-position panel appended to document.documentElement.
 * Toggled via keyboard shortcut (Cmd+Shift+C) and toolbar button.
 */

const XHTML_NS = "http://www.w3.org/1999/xhtml";

interface SidebarElements {
  readonly messageArea: HTMLElement;
  readonly contextBar: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  readonly sendButton: HTMLElement;
}

let registeredElements: SidebarElements | null = null;

function el(doc: Document, tag: string, style: string, cls?: string): HTMLElement {
  const e = doc.createElementNS(XHTML_NS, tag) as HTMLElement;
  e.style.cssText = style;
  if (cls) e.className = cls;
  return e;
}

export function initSidebarManager(
  win: Window,
  _rootURI: string
): () => void {
  const doc = win.document;
  let visible = false;

  // ── Build floating panel ──
  const panel = el(doc, "div", `
    display: none;
    position: fixed;
    top: 60px;
    right: 20px;
    width: 420px;
    height: 70vh;
    max-height: 800px;
    min-height: 300px;
    background: #ffffff;
    border: 1px solid #d0d0d0;
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.15);
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    overflow: hidden;
    flex-direction: column;
  `, "clautero-panel");

  // Header
  const header = el(doc, "div", `
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; border-bottom: 1px solid #e0e0e0;
    background: #f8f8f8; border-radius: 10px 10px 0 0;
    cursor: move; user-select: none;
  `);
  const title = el(doc, "span", "font-weight:600;font-size:14px;color:#333;");
  title.textContent = "Clautero";
  const closeBtn = el(doc, "button", `
    background:none; border:none; font-size:18px; cursor:pointer;
    color:#666; padding:2px 6px; border-radius:4px; line-height:1;
  `);
  closeBtn.textContent = "\u00D7";
  closeBtn.addEventListener("click", () => toggle());
  header.appendChild(title);
  header.appendChild(closeBtn);

  // Message area
  const messageArea = el(doc, "div",
    "flex:1;overflow-y:auto;padding:10px 12px;min-height:100px;",
    "clautero-messages"
  );
  const welcome = el(doc, "p",
    "color:#999;font-style:italic;text-align:center;margin:40px 0;"
  );
  welcome.textContent = "Ask Claude about your research...";
  messageArea.appendChild(welcome);

  // Context bar
  const contextBar = el(doc, "div", "padding:0 10px;", "clautero-context-bar");

  // Input area
  const inputArea = el(doc, "div",
    "display:flex;gap:6px;padding:10px 12px;border-top:1px solid #e0e0e0;"
  );
  const textarea = doc.createElementNS(XHTML_NS, "textarea") as HTMLTextAreaElement;
  textarea.placeholder = "Type a message...";
  textarea.rows = 3;
  textarea.style.cssText = `
    flex:1;resize:none;border:1px solid #d0d0d0;border-radius:8px;padding:8px 10px;
    font-size:13px;font-family:inherit;outline:none;background:#fff;color:#333;
  `;
  const sendButton = el(doc, "button", `
    padding:8px 16px;border:none;border-radius:8px;cursor:pointer;
    background:#3584e4;color:white;font-size:13px;font-weight:600;align-self:flex-end;
  `);
  sendButton.textContent = "Send";
  inputArea.appendChild(textarea);
  inputArea.appendChild(sendButton);

  // Assemble panel
  panel.appendChild(header);
  panel.appendChild(messageArea);
  panel.appendChild(contextBar);
  panel.appendChild(inputArea);

  // Make panel draggable via header
  let dragX = 0, dragY = 0;
  header.addEventListener("mousedown", (e: Event) => {
    const me = e as MouseEvent;
    dragX = me.clientX - panel.offsetLeft;
    dragY = me.clientY - panel.offsetTop;
    const onMove = (ev: Event) => {
      const mv = ev as MouseEvent;
      panel.style.left = (mv.clientX - dragX) + "px";
      panel.style.top = (mv.clientY - dragY) + "px";
      panel.style.right = "auto";
    };
    const onUp = () => {
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("mouseup", onUp);
    };
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseup", onUp);
  });

  // Inject into document
  doc.documentElement.appendChild(panel);

  // ── Toggle logic ──
  function toggle() {
    visible = !visible;
    panel.style.display = visible ? "flex" : "none";
    if (visible) {
      textarea.focus();
    }
  }

  function show() {
    if (!visible) toggle();
  }

  function hide() {
    if (visible) toggle();
  }

  // ── Keyboard shortcut: Cmd+Shift+C ──
  const keyHandler = (e: Event) => {
    const ke = e as KeyboardEvent;
    const isMac = navigator.platform.includes("Mac");
    const mod = isMac ? ke.metaKey : ke.ctrlKey;
    if (mod && ke.shiftKey && ke.key === "C") {
      ke.preventDefault();
      ke.stopPropagation();
      toggle();
    }
  };
  win.addEventListener("keydown", keyHandler, true);

  // ── Tools menu item ──
  let menuItem: Element | null = null;
  try {
    const createXUL = "createXULElement" in doc
      ? (t: string) => (doc as any).createXULElement(t)
      : (t: string) => doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", t);

    const mi = createXUL("menuitem");
    mi.setAttribute("id", "clautero-menu-item");
    mi.setAttribute("label", "Clautero Chat (Cmd+Shift+C)");
    mi.addEventListener("command", () => toggle());
    menuItem = mi;

    const toolsMenu = doc.getElementById("menu_ToolsPopup");
    if (toolsMenu) {
      toolsMenu.appendChild(mi);
    }
  } catch { /* ignore */ }

  // Expose API
  registeredElements = Object.freeze({ messageArea, contextBar, textarea, sendButton });

  (win as any).__clauteroSidebar = Object.freeze({
    toggle, show, hide,
    isVisible: () => visible,
    getElements: () => registeredElements,
  });

  Zotero.log("[Clautero] Floating panel created. Toggle: Cmd+Shift+C", "info");

  // Auto-show on first install
  show();

  // ── Cleanup ──
  return () => {
    win.removeEventListener("keydown", keyHandler, true);
    panel.remove();
    if (menuItem) menuItem.remove();
    registeredElements = null;
    delete (win as any).__clauteroSidebar;
  };
}
