/**
 * SidebarManager — Registers Clautero as a section in Zotero's item pane
 * using Zotero.ItemPaneManager.registerSection().
 *
 * Reference: https://gist.github.com/EwoutH/04c8df5a97963b5b46cec9f392ceb103
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
let registeredSectionID: string | null = null;

function buildChatUI(body: HTMLElement, doc: Document): SidebarElements {
  // Clear body
  while (body.firstChild) {
    body.removeChild(body.firstChild);
  }

  const wrapper = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  wrapper.className = "clautero-wrapper";
  wrapper.style.cssText =
    "display:flex;flex-direction:column;width:100%;min-height:400px;" +
    "font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;";

  // Message area
  const messageArea = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  messageArea.className = "clautero-messages";
  messageArea.style.cssText = "flex:1;overflow-y:auto;padding:8px 10px;min-height:200px;";

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
  wrapper.appendChild(messageArea);
  wrapper.appendChild(contextBar);
  wrapper.appendChild(inputArea);
  body.appendChild(wrapper);

  return Object.freeze({ messageArea, contextBar, textarea, sendButton });
}

export function initSidebarManager(
  win: Window,
  rootURI: string
): () => void {
  // Step 1: Load FTL into the window BEFORE registerSection
  try {
    (win as any).MozXULElement.insertFTLIfNeeded("addon.ftl");
    Zotero.log("[Clautero] FTL loaded via insertFTLIfNeeded", "info");
  } catch (e) {
    Zotero.log(`[Clautero] insertFTLIfNeeded failed: ${e}`, "warning");
  }

  // Force the section to be open (preference may have been set to false)
  try {
    const prefKey = `panes.${PLUGIN_ID}-${SECTION_ID}.open`;
    Zotero.Prefs.set(prefKey, true);
    Zotero.log(`[Clautero] Set ${prefKey} = true`, "info");
  } catch (e) {
    Zotero.log(`[Clautero] Could not set open pref: ${e}`, "warning");
  }

  // Step 2: Register item pane section
  // Per Zotero 8 guide: icon should use rootURI + path
  const iconPath = rootURI + "content/icons/chat.svg";

  try {
    registeredSectionID = (Zotero as any).ItemPaneManager.registerSection({
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
      onRender: ({
        body,
        item,
        editable,
        tabType,
      }: {
        body: HTMLElement;
        item: any;
        editable: boolean;
        tabType: string;
      }) => {
        Zotero.log(
          `[Clautero] onRender: children=${body.childElementCount}, tabType=${tabType}`,
          "info"
        );

        // Build UI if body is empty
        if (!body.querySelector(".clautero-wrapper")) {
          const doc = body.ownerDocument;
          registeredElements = buildChatUI(body, doc);

          // Expose elements for hooks.ts chat wiring
          (win as any).__clauteroSidebar = Object.freeze({
            toggle: () => {},
            show: () => {},
            hide: () => {},
            isVisible: () => true,
            getElements: () => registeredElements,
          });

          Zotero.log("[Clautero] Chat UI built in onRender", "info");
        }
      },
      onItemChange: ({
        setEnabled,
      }: {
        item: any;
        setEnabled: (v: boolean) => void;
        tabType: string;
      }) => {
        // Always show the Clautero section
        setEnabled(true);
        return true;
      },
    });

    if (registeredSectionID) {
      Zotero.log(`[Clautero] Section registered: ${registeredSectionID}`, "info");
    } else {
      Zotero.log("[Clautero] registerSection returned falsy", "warning");
    }
  } catch (error) {
    Zotero.log(`[Clautero] registerSection FAILED: ${error}`, "error");

    // Log available API for debugging
    try {
      const mgr = (Zotero as any).ItemPaneManager;
      const keys = mgr ? Object.keys(mgr).join(", ") : "null";
      Zotero.log(`[Clautero] ItemPaneManager keys: ${keys}`, "info");
    } catch {
      // ignore
    }
  }

  // Cleanup
  return () => {
    try {
      if (registeredSectionID) {
        (Zotero as any).ItemPaneManager.unregisterSection(registeredSectionID);
      }
    } catch {
      // ignore
    }
    registeredElements = null;
    registeredSectionID = null;
    delete (win as any).__clauteroSidebar;
  };
}
