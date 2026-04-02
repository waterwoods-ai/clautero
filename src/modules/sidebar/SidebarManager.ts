/**
 * SidebarManager — Registers Clautero as a section in Zotero's item pane
 * using the official Zotero.ItemPaneManager.registerSection() API.
 *
 * This makes Clautero appear as a panel in the right sidebar alongside
 * Info, Notes, Tags, etc.
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
let sectionBody: HTMLElement | null = null;

function buildChatUI(body: HTMLElement, doc: Document): SidebarElements {
  // Clear existing content
  while (body.firstChild) {
    body.removeChild(body.firstChild);
  }

  const wrapper = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  wrapper.setAttribute("class", "clautero-sidebar-inner");
  wrapper.setAttribute("style",
    "display:flex;flex-direction:column;height:100%;width:100%;" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;" +
    "flex-grow:1;overflow:hidden;"
  );

  // Message area — takes all remaining space
  const messageArea = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  messageArea.setAttribute("class", "clautero-messages");
  messageArea.setAttribute("style",
    "flex-grow:1;overflow-y:auto;padding:8px 10px;min-height:100px;"
  );

  // Context bar
  const contextBar = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  contextBar.setAttribute("class", "clautero-context-bar");

  // Input area
  const inputArea = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  inputArea.setAttribute("class", "clautero-input-area");
  inputArea.setAttribute("style",
    "display:flex;gap:4px;padding:8px;border-top:1px solid #ccc;"
  );

  const textarea = doc.createElementNS(XHTML_NS, "textarea") as HTMLTextAreaElement;
  textarea.setAttribute("class", "clautero-input-textarea");
  textarea.setAttribute("placeholder", "Ask Claude about your research\u2026");
  textarea.setAttribute("rows", "3");
  textarea.setAttribute("style",
    "flex:1;resize:none;border:1px solid #ccc;border-radius:4px;padding:6px;font-size:13px;" +
    "font-family:inherit;background:var(--material-background,#fff);color:var(--fill-primary,#1a1a1a);"
  );

  const sendButton = doc.createElementNS(XHTML_NS, "button") as HTMLElement;
  sendButton.setAttribute("class", "clautero-input-send");
  sendButton.setAttribute("style",
    "padding:6px 12px;border:none;border-radius:4px;cursor:pointer;" +
    "background:#3584e4;color:white;font-size:13px;font-weight:600;align-self:flex-end;"
  );
  sendButton.textContent = "Send";

  inputArea.appendChild(textarea);
  inputArea.appendChild(sendButton);

  wrapper.appendChild(messageArea);
  wrapper.appendChild(contextBar);
  wrapper.appendChild(inputArea);
  body.appendChild(wrapper);

  return Object.freeze({
    messageArea,
    contextBar,
    textarea: textarea as HTMLTextAreaElement,
    sendButton,
  });
}

export function initSidebarManager(
  _window: Window,
  _rootURI: string
): () => void {
  // Register as a section in Zotero's item pane
  try {
    (Zotero as any).ItemPaneManager.registerSection({
      paneID: SECTION_ID,
      pluginID: PLUGIN_ID,
      header: {
        l10nID: "clautero-sidebar-title",
        icon: "chrome://zotero/skin/16/universal/chat.svg",
      },
      sidenav: {
        l10nID: "clautero-sidebar-title",
        icon: "chrome://zotero/skin/16/universal/chat.svg",
      },
      onRender: ({ body, item }: { body: HTMLElement; item: any }) => {
        if (!registeredElements) {
          const doc = body.ownerDocument;
          sectionBody = body;

          // Make the section body fill the entire available height
          // (same approach as zotero-ai-tab)
          body.style.display = "flex";
          body.style.flexDirection = "column";
          body.style.height = "100%";
          body.style.overflow = "hidden";
          body.style.padding = "0";

          registeredElements = buildChatUI(body, doc);
          Zotero.log("[Clautero] Chat UI rendered in item pane section", "info");

          // Expose for hooks.ts to wire up
          (_window as any).__clauteroSidebar = Object.freeze({
            toggle: () => {},
            show: () => {},
            hide: () => {},
            isVisible: () => true,
            getElements: () => registeredElements,
          });
        }
      },

      onItemChange: ({ item, setEnabled }: { item: any; setEnabled: (v: boolean) => void }) => {
        // Always show the section regardless of selected item
        setEnabled(true);
        return true;
      },
    });
    Zotero.log("[Clautero] Registered item pane section", "info");
  } catch (error) {
    Zotero.log(`[Clautero] Failed to register item pane section: ${error}`, "error");

    // Fallback: try older API or log the error
    try {
      Zotero.log(`[Clautero] ItemPaneManager available: ${!!(Zotero as any).ItemPaneManager}`, "info");
      const methods = Object.keys((Zotero as any).ItemPaneManager || {}).join(", ");
      Zotero.log(`[Clautero] ItemPaneManager methods: ${methods}`, "info");
    } catch {
      // ignore
    }
  }

  // Cleanup
  return () => {
    try {
      (Zotero as any).ItemPaneManager.unregisterSection(SECTION_ID);
      registeredElements = null;
      sectionBody = null;
      delete (_window as any).__clauteroSidebar;
    } catch (error) {
      Zotero.log(`[Clautero] Cleanup error: ${error}`, "warning");
    }
  };
}
