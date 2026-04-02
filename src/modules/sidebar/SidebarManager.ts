/**
 * SidebarManager — Registers Clautero as a section in Zotero's item pane.
 */

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SECTION_ID = "clautero-chat";
const PLUGIN_ID = "clautero@zotero-plugin";

interface SidebarElements {
  readonly messageArea: HTMLElement;
  readonly contextBar: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  readonly sendButton: HTMLElement;
}

let registeredElements: SidebarElements | null = null;

function findOrBuild(body: HTMLElement, win: Window): SidebarElements {
  const doc = body.ownerDocument;

  // Check if already built (body persists between renders for same item)
  const existing = body.querySelector(".clautero-wrapper");
  if (existing && registeredElements) {
    return registeredElements;
  }

  // Clear body
  while (body.firstChild) {
    body.removeChild(body.firstChild);
  }

  // Build all UI elements using DOM APIs (never innerHTML)
  const wrapper = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  wrapper.className = "clautero-wrapper";
  wrapper.style.cssText = "display:flex;flex-direction:column;width:100%;min-height:400px;" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;";

  // Message area
  const messageArea = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  messageArea.className = "clautero-messages";
  messageArea.style.cssText = "flex:1;overflow-y:auto;padding:8px 10px;min-height:200px;";

  // Welcome text
  const welcome = doc.createElementNS(XHTML_NS, "p") as HTMLElement;
  welcome.style.cssText = "color:#888;font-style:italic;margin:20px 0;text-align:center;";
  welcome.textContent = "Ask Claude about your research...";
  messageArea.appendChild(welcome);

  // Context bar
  const contextBar = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  contextBar.className = "clautero-context-bar";
  contextBar.style.cssText = "padding:0 8px;";

  // Input area
  const inputArea = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  inputArea.style.cssText = "display:flex;gap:6px;padding:8px;border-top:1px solid #ddd;";

  const textarea = doc.createElementNS(XHTML_NS, "textarea") as HTMLTextAreaElement;
  textarea.placeholder = "Type a message...";
  textarea.rows = 3;
  textarea.style.cssText = "flex:1;resize:none;border:1px solid #ccc;border-radius:6px;padding:8px;" +
    "font-size:13px;font-family:inherit;outline:none;";

  const sendButton = doc.createElementNS(XHTML_NS, "button") as HTMLElement;
  sendButton.style.cssText = "padding:8px 16px;border:none;border-radius:6px;cursor:pointer;" +
    "background:#3584e4;color:white;font-size:13px;font-weight:600;align-self:flex-end;";
  sendButton.textContent = "Send";

  inputArea.appendChild(textarea);
  inputArea.appendChild(sendButton);

  wrapper.appendChild(messageArea);
  wrapper.appendChild(contextBar);
  wrapper.appendChild(inputArea);
  body.appendChild(wrapper);

  registeredElements = Object.freeze({
    messageArea,
    contextBar,
    textarea,
    sendButton,
  });

  Zotero.log("[Clautero] Chat UI built", "info");

  // Expose for hooks.ts
  (win as any).__clauteroSidebar = Object.freeze({
    toggle: () => {},
    show: () => {},
    hide: () => {},
    isVisible: () => true,
    getElements: () => registeredElements,
  });

  return registeredElements;
}

export function initSidebarManager(
  _window: Window,
  _rootURI: string
): () => void {
  try {
    // Load FTL before registration
    try {
      _window.MozXULElement.insertFTLIfNeeded("addon.ftl");
    } catch {
      // ignore
    }

    const chatIcon = "chrome://clautero/content/icons/chat.svg";

    (Zotero as any).ItemPaneManager.registerSection({
      paneID: SECTION_ID,
      pluginID: PLUGIN_ID,
      header: {
        l10nID: "clautero-sidebar-title",
        icon: chatIcon,
      },
      sidenav: {
        l10nID: "clautero-sidebar-title",
        icon: chatIcon,
      },
      onRender: ({
        body,
        item,
        setEnabled,
      }: {
        body: HTMLElement;
        item: any;
        setEnabled?: (v: boolean) => void;
      }) => {
        Zotero.log(`[Clautero] onRender called, body.childElementCount=${body.childElementCount}`, "info");

        // Style the body container
        body.style.display = "flex";
        body.style.flexDirection = "column";
        body.style.overflow = "hidden";
        body.style.padding = "0";

        findOrBuild(body, _window);
      },
      onItemChange: ({
        setEnabled,
      }: {
        item: any;
        setEnabled: (v: boolean) => void;
        tabType: string;
      }) => {
        setEnabled(true);
        return true;
      },
    });
    Zotero.log("[Clautero] Registered item pane section", "info");
  } catch (error) {
    Zotero.log(`[Clautero] Failed to register section: ${error}`, "error");
  }

  return () => {
    try {
      (Zotero as any).ItemPaneManager.unregisterSection(SECTION_ID);
    } catch {
      // ignore
    }
    registeredElements = null;
    delete (_window as any).__clauteroSidebar;
  };
}
