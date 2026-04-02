/**
 * SidebarManager — Registers Clautero in Zotero's item pane.
 *
 * Uses ItemPaneManager.registerSection() for the sidenav icon,
 * then polls the DOM to force the section open and inject the chat UI.
 */

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SECTION_ID = "clautero-chat";
const PLUGIN_ID = "clautero@zotero-plugin";
const FULL_PANE_ID = `${PLUGIN_ID}-${SECTION_ID}`;

interface SidebarElements {
  readonly messageArea: HTMLElement;
  readonly contextBar: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  readonly sendButton: HTMLElement;
}

let registeredElements: SidebarElements | null = null;

export function initSidebarManager(
  win: Window,
  rootURI: string
): () => void {
  const doc = win.document;

  // Load FTL
  try {
    (win as any).MozXULElement.insertFTLIfNeeded("addon.ftl");
  } catch { /* ignore */ }

  // Force the section open preference BEFORE registration
  // Zotero stores as: extensions.zotero.panes.{pluginID}-{paneID}.open
  try {
    Zotero.Prefs.set(`panes.${FULL_PANE_ID}.open`, true);
    Zotero.log(`[Clautero] Set panes.${FULL_PANE_ID}.open = true`, "info");
  } catch (e) {
    Zotero.log(`[Clautero] Could not set open pref: ${e}`, "warning");
  }

  // Register section
  const iconPath = rootURI + "content/icons/chat.svg";
  let registered = false;

  try {
    (Zotero as any).ItemPaneManager.registerSection({
      paneID: SECTION_ID,
      pluginID: PLUGIN_ID,
      header: {
        l10nID: "clautero-sidebar-title",
        icon: iconPath,
      },
      sidenav: {
        l10nID: "clautero-sidebar-title",
        icon: iconPath,
      },
      onRender: ({ body }: { body: HTMLElement }) => {
        // If body is empty, build UI
        if (!body.querySelector(".clautero-chat-root")) {
          buildUI(body, doc, win);
        }
      },
      onItemChange: ({ setEnabled }: { setEnabled: (v: boolean) => void }) => {
        setEnabled(true);
        return true;
      },
    });
    registered = true;
    Zotero.log("[Clautero] Section registered", "info");
  } catch (e) {
    Zotero.log(`[Clautero] registerSection failed: ${e}`, "error");
  }

  // Force the section open and visible via DOM polling
  let pollCount = 0;
  const poll = (win as any).setInterval(() => {
    pollCount++;
    if (pollCount > 120) {
      (win as any).clearInterval(poll);
      return;
    }

    // Find the custom section element
    const section = doc.querySelector(
      `[data-pane="${FULL_PANE_ID}"]`
    ) as HTMLElement | null;

    if (!section) {
      if (pollCount % 10 === 0) {
        Zotero.log(`[Clautero] Poll ${pollCount}: section not found yet`, "info");
      }
      return;
    }

    // Found it - stop polling
    (win as any).clearInterval(poll);
    Zotero.log(`[Clautero] Section element found after ${pollCount} polls`, "info");

    // Force section visible (not hidden)
    const sectionParent = section.closest("item-pane-custom-section") as HTMLElement;
    if (sectionParent) {
      sectionParent.hidden = false;
      sectionParent.style.display = "";
      Zotero.log("[Clautero] Section parent unhidden", "info");
    }

    // Force collapsible section open
    try {
      if ("open" in section) {
        (section as any).open = true;
      }
      section.setAttribute("open", "");
      section.toggleAttribute("open", true);
    } catch (e) {
      Zotero.log(`[Clautero] Could not set open: ${e}`, "warning");
    }

    // Find the body and inject UI
    const body = section.querySelector('[data-type="body"]') as HTMLElement
      ?? section.querySelector(".body") as HTMLElement
      ?? section.lastElementChild as HTMLElement;

    if (body && !body.querySelector(".clautero-chat-root")) {
      body.style.minHeight = "400px";
      body.style.overflow = "visible";
      buildUI(body, doc, win);

      // Force recalc --open-height
      const head = section.querySelector(".head");
      if (head && head.nextElementSibling) {
        const h = (head.nextElementSibling as HTMLElement).scrollHeight;
        section.style.setProperty("--open-height", h > 0 ? `${h}px` : "auto");
        Zotero.log(`[Clautero] Set --open-height: ${h}px`, "info");
      }
    }
  }, 500);

  return () => {
    (win as any).clearInterval(poll);
    if (registered) {
      try {
        (Zotero as any).ItemPaneManager.unregisterSection(SECTION_ID);
      } catch { /* ignore */ }
    }
    registeredElements = null;
    delete (win as any).__clauteroSidebar;
  };
}

function buildUI(body: HTMLElement, doc: Document, win: Window): void {
  const root = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  root.className = "clautero-chat-root";
  root.style.cssText =
    "display:flex;flex-direction:column;width:100%;min-height:400px;" +
    "font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;";

  const messageArea = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  messageArea.className = "clautero-messages";
  messageArea.style.cssText = "flex:1;overflow-y:auto;padding:8px;min-height:200px;";

  const welcome = doc.createElementNS(XHTML_NS, "p") as HTMLElement;
  welcome.style.cssText = "color:#888;font-style:italic;text-align:center;margin:20px 0;";
  welcome.textContent = "Ask Claude about your research...";
  messageArea.appendChild(welcome);

  const contextBar = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  contextBar.className = "clautero-context-bar";

  const inputArea = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  inputArea.style.cssText = "display:flex;gap:6px;padding:8px;border-top:1px solid #ddd;";

  const textarea = doc.createElementNS(XHTML_NS, "textarea") as HTMLTextAreaElement;
  textarea.placeholder = "Type a message...";
  textarea.rows = 3;
  textarea.style.cssText =
    "flex:1;resize:none;border:1px solid #ccc;border-radius:6px;padding:8px;" +
    "font-size:13px;font-family:inherit;outline:none;";

  const sendButton = doc.createElementNS(XHTML_NS, "button") as HTMLElement;
  sendButton.style.cssText =
    "padding:8px 16px;border:none;border-radius:6px;cursor:pointer;" +
    "background:#3584e4;color:white;font-size:13px;font-weight:600;align-self:flex-end;";
  sendButton.textContent = "Send";

  inputArea.appendChild(textarea);
  inputArea.appendChild(sendButton);
  root.appendChild(messageArea);
  root.appendChild(contextBar);
  root.appendChild(inputArea);
  body.appendChild(root);

  registeredElements = Object.freeze({ messageArea, contextBar, textarea, sendButton });

  (win as any).__clauteroSidebar = Object.freeze({
    toggle: () => {}, show: () => {}, hide: () => {},
    isVisible: () => true,
    getElements: () => registeredElements,
  });

  Zotero.log("[Clautero] Chat UI built and injected", "info");
}
