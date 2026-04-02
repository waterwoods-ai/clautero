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
let sectionBody: HTMLElement | null = null;

function buildChatUI(body: HTMLElement, doc: Document): SidebarElements {
  while (body.firstChild) {
    body.removeChild(body.firstChild);
  }

  const wrapper = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  wrapper.setAttribute("style",
    "display:flex;flex-direction:column;height:100%;width:100%;" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;" +
    "flex-grow:1;overflow:hidden;"
  );

  const messageArea = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  messageArea.setAttribute("class", "clautero-messages");
  messageArea.setAttribute("style",
    "flex-grow:1;overflow-y:auto;padding:8px 10px;min-height:100px;"
  );

  const contextBar = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  contextBar.setAttribute("class", "clautero-context-bar");

  const inputArea = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  inputArea.setAttribute("style",
    "display:flex;gap:4px;padding:8px;border-top:1px solid #ccc;"
  );

  const textarea = doc.createElementNS(XHTML_NS, "textarea") as HTMLTextAreaElement;
  textarea.setAttribute("placeholder", "Ask Claude about your research\u2026");
  textarea.setAttribute("rows", "3");
  textarea.setAttribute("style",
    "flex:1;resize:none;border:1px solid #ccc;border-radius:4px;padding:6px;font-size:13px;" +
    "font-family:inherit;background:var(--material-background,#fff);color:var(--fill-primary,#1a1a1a);"
  );

  const sendButton = doc.createElementNS(XHTML_NS, "button") as HTMLElement;
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

function renderUI(body: HTMLElement, win: Window): void {
  const doc = body.ownerDocument;
  sectionBody = body;

  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.height = "100%";
  body.style.overflow = "hidden";
  body.style.padding = "0";

  registeredElements = buildChatUI(body, doc);
  Zotero.log("[Clautero] Chat UI built", "info");

  (win as any).__clauteroSidebar = Object.freeze({
    toggle: () => {},
    show: () => {},
    hide: () => {},
    isVisible: () => true,
    getElements: () => registeredElements,
  });
}

export function initSidebarManager(
  _window: Window,
  _rootURI: string
): () => void {
  try {
    // Inject a Fluent FTL string directly into the document so l10nID resolves
    const ftlContent = "clautero-sidebar-title = Clautero";
    const ftlUri = "data:text/plain," + encodeURIComponent(ftlContent);

    // Try to add to L10nRegistry if available
    try {
      const { L10nRegistry, FileSource } = ChromeUtils.importESModule(
        "resource://gre/modules/L10nRegistry.sys.mjs"
      );
      const source = new FileSource(
        "clautero",
        ["en-US"],
        "data:text/plain,",
      );
      // Override generateMessages to return our string
      L10nRegistry.getInstance().registerSources([source]);
    } catch (e) {
      Zotero.log(`[Clautero] L10nRegistry not available: ${e}`, "warning");
    }

    // Also try insertFTLIfNeeded on main windows
    try {
      const wins = Zotero.getMainWindows();
      for (const w of wins) {
        if (w && !w.closed && (w as any).MozXULElement) {
          (w as any).MozXULElement.insertFTLIfNeeded("addon.ftl");
        }
      }
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
      onInit: ({ body }: { body: HTMLElement }) => {
        Zotero.log("[Clautero] onInit called", "info");
        renderUI(body, _window);
      },
      onRender: ({ body }: { body: HTMLElement }) => {
        Zotero.log("[Clautero] onRender called", "info");
        if (body.children.length === 0) {
          renderUI(body, _window);
        }
      },
      onItemChange: ({ setEnabled }: { setEnabled: (v: boolean) => void }) => {
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
    sectionBody = null;
    delete (_window as any).__clauteroSidebar;
  };
}
