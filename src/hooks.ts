import { Addon } from "./addon";
import { initSidebarManager } from "./modules/sidebar/SidebarManager";
import type { SidebarElements } from "./modules/sidebar/SidebarManager";
import { createInputController } from "./modules/chat/InputController";
import { createChatState, addMessage, type ChatStateData } from "./modules/chat/ChatState";
import { createMessageRenderer } from "./modules/chat/MessageRenderer";
import { createStreamController } from "./modules/chat/StreamController";
import { createClauteroService } from "./core/agent/ClauteroService";
import { resolveCLIPath, clearCLIPathCache } from "./core/agent/CLIPathResolver";
import type { StreamChunk } from "./core/agent/types";
import { createContextChipsView } from "./modules/context/ContextChipsView";

export interface Hooks {
  onStartup(): Promise<void>;
  onShutdown(): void;
  onMainWindowLoad(window: Window): void;
  onMainWindowUnload(window: Window): void;
}

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const MAX_SESSIONS = 5;

async function resolveCliPath(): Promise<string> {
  return resolveCLIPath();
}

function showSetupPrompt(session: Session, doc: Document): void {
  const container = session.messageContainer;

  // Don't show duplicate setup prompts
  if (container.querySelector(".clautero-setup")) return;

  const setup = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  setup.className = "clautero-setup";
  setup.style.cssText = `
    padding:16px;margin:8px;border:1px solid #e0e0e0;border-radius:10px;
    background:#fafafa;
  `;

  const title = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  title.style.cssText = "font-weight:600;font-size:14px;margin-bottom:8px;";
  title.textContent = "Configure Claude CLI Path";

  const desc = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  desc.style.cssText = "font-size:12px;color:#666;margin-bottom:12px;line-height:1.4;";
  desc.textContent = 'Enter the full path to your Claude CLI binary. Find it by running "which claude" in your terminal.';

  const inputRow = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  inputRow.style.cssText = "display:flex;gap:6px;";

  const input = doc.createElementNS(XHTML_NS, "input") as HTMLInputElement;
  input.type = "text";
  input.placeholder = "/Users/you/.local/bin/claude";
  input.style.cssText = `
    flex:1;border:1px solid #ccc;border-radius:6px;padding:6px 10px;
    font-size:13px;font-family:monospace;outline:none;
  `;

  const saveBtn = doc.createElementNS(XHTML_NS, "button") as HTMLElement;
  saveBtn.style.cssText = `
    padding:6px 14px;border:none;border-radius:6px;cursor:pointer;
    background:#3584e4;color:white;font-size:13px;font-weight:500;
  `;
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    const path = (input as HTMLInputElement).value.trim();
    if (!path) return;

    try {
      Zotero.Prefs.set("extensions.clautero.claudeCliPath", path, true);
      // Clear cached path so it picks up the new one
      clearCLIPathCache();
      // Remove setup prompt
      setup.remove();
      // Show confirmation
      session.renderer.appendTextChunk("Claude CLI path saved. Send a message to start chatting!");
      session.renderer.finishAssistantMessage();
      Zotero.log(`[Clautero] CLI path configured: ${path}`, "info");
    } catch (e) {
      Zotero.log(`[Clautero] Failed to save CLI path: ${e}`, "error");
    }
  });

  inputRow.appendChild(input);
  inputRow.appendChild(saveBtn);
  setup.appendChild(title);
  setup.appendChild(desc);
  setup.appendChild(inputRow);

  // Remove welcome if present
  const welcome = container.querySelector(".clautero-welcome");
  if (welcome) welcome.remove();

  container.appendChild(setup);
}

function isAutoAttachEnabled(): boolean {
  try { return Zotero.Prefs.get("extensions.clautero.autoAttachContext", true) !== false; }
  catch { return true; }
}

function getSelectedItem(): Zotero.Item | null {
  try {
    const pane = Zotero.getActiveZoteroPane();
    if (!pane) return null;
    const items = pane.getSelectedItems();
    if (!items || items.length === 0) return null;
    return items.find((item: Zotero.Item) =>
      item.itemType !== "attachment" && item.itemType !== "note"
    ) || null;
  } catch { return null; }
}

function getSelectedCollection(): Zotero.Collection | null {
  try {
    const pane = Zotero.getActiveZoteroPane();
    if (!pane) return null;
    // getSelectedCollection returns the selected collection in the library tree
    const collection = (pane as any).getSelectedCollection?.();
    return collection || null;
  } catch { return null; }
}

// ── Session type ──
interface Session {
  id: number;
  chatState: ChatStateData;
  service: ReturnType<typeof createClauteroService> | null;
  renderer: ReturnType<typeof createMessageRenderer>;
  streamController: ReturnType<typeof createStreamController>;
  messageContainer: HTMLElement;
}

function doInitChat(
  win: Window,
  addon: Addon,
  elements: SidebarElements,
  cleanupList: Array<() => void>
): void {
  const { messageArea, textarea, sendButton, contextBar, statusBar, sessionBar } = elements;
  const doc = win.document;

  const inputController = createInputController(textarea, sendButton);
  cleanupList.push(() => inputController.cleanup());

  // ── Context ──
  let currentContext = "";
  const chipsView = createContextChipsView(contextBar, doc);
  chipsView.setOnChange((ctx: string) => { currentContext = ctx; });
  cleanupList.push(() => chipsView.cleanup());

  if (isAutoAttachEnabled()) {
    // Initial context: check if item or collection is selected
    const initialItem = getSelectedItem();
    if (initialItem) {
      chipsView.update(initialItem);
    } else {
      const initialCollection = getSelectedCollection();
      if (initialCollection) chipsView.updateCollection(initialCollection);
    }

    // Listen for item selection changes
    const itemNotifierID = Zotero.Notifier.registerObserver({
      notify: (event: string, type: string) => {
        if (type === "item" && (event === "select" || event === "modify")) {
          if (!isAutoAttachEnabled()) return;
          const item = getSelectedItem();
          if (item) {
            chipsView.update(item);
          }
          // If no item selected, check if a collection is active
          if (!item) {
            const col = getSelectedCollection();
            if (col) chipsView.updateCollection(col);
          }
        }
      },
    }, ["item"], "clautero");
    cleanupList.push(() => {
      try { Zotero.Notifier.unregisterObserver(itemNotifierID); } catch { /* ignore */ }
    });

    // Poll for collection changes (Zotero doesn't fire notifier events
    // when the user clicks a different collection in the library tree)
    let lastCollectionId: number | null = null;
    let lastItemId: number | null = null;
    const contextPoll = (win as any).setInterval(() => {
      if (!isAutoAttachEnabled()) return;

      // Check if selected item changed
      const item = getSelectedItem();
      const itemId = item?.id ?? null;
      if (itemId !== lastItemId) {
        lastItemId = itemId;
        if (item) {
          chipsView.update(item);
          return;
        }
      }

      // Check if selected collection changed
      const col = getSelectedCollection();
      const colId = col?.id ?? null;
      if (colId !== lastCollectionId) {
        lastCollectionId = colId;
        if (col) {
          chipsView.updateCollection(col);
        } else if (!item) {
          chipsView.update(null);
        }
      }
    }, 1000);
    cleanupList.push(() => (win as any).clearInterval(contextPoll));
  }

  // ── Sessions (max 5) ──
  const sessions: Session[] = [];
  let activeSessionId = 0;

  function createSession(): Session {
    const id = sessions.length + 1;
    const msgContainer = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    msgContainer.style.cssText = "display:none;flex:1;overflow-y:auto;padding:16px;";

    // Add welcome for new sessions
    const welcome = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    welcome.className = "clautero-welcome";
    welcome.style.cssText = "display:flex;align-items:center;justify-content:center;height:100%;";
    const greet = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    greet.style.cssText = "font-size:22px;font-weight:400;color:#1a1a1a;font-family:Georgia,serif;text-align:center;";
    greet.textContent = "Ask Claude about\nyour research";
    welcome.appendChild(greet);
    msgContainer.appendChild(welcome);

    messageArea.parentElement?.insertBefore(msgContainer, messageArea);

    const renderer = createMessageRenderer(msgContainer);
    let chatState = createChatState();
    const streamController = createStreamController(
      renderer,
      () => chatState,
      (next: ChatStateData) => { chatState = next; }
    );

    const session: Session = {
      id,
      chatState,
      service: null,
      renderer,
      streamController,
      messageContainer: msgContainer,
    };
    // Use getter for chatState since it mutates
    Object.defineProperty(session, "chatState", {
      get: () => chatState,
      set: (v: ChatStateData) => { chatState = v; },
    });

    sessions.push(session);
    return session;
  }

  function switchSession(id: number): void {
    // Hide all message containers
    for (const s of sessions) {
      s.messageContainer.style.display = "none";
    }
    // Hide the original messageArea (has welcome)
    messageArea.style.display = "none";

    const session = sessions.find(s => s.id === id);
    if (session) {
      session.messageContainer.style.display = "";
      session.messageContainer.style.cssText = "flex:1;overflow-y:auto;padding:16px;";
      activeSessionId = id;
    }

    updateSessionBar();
  }

  function getActiveSession(): Session | undefined {
    return sessions.find(s => s.id === activeSessionId);
  }

  function closeSession(id: number): void {
    if (sessions.length <= 1) return; // Don't close the last one

    const idx = sessions.findIndex(s => s.id === id);
    if (idx === -1) return;

    const session = sessions[idx];
    // Cleanup service
    session.service?.cleanup();
    session.renderer.cleanup();
    session.streamController.cleanup();
    session.messageContainer.remove();

    sessions.splice(idx, 1);

    // If closing active, switch to first remaining
    if (activeSessionId === id) {
      switchSession(sessions[0].id);
    } else {
      updateSessionBar();
    }
  }

  // ── Session tab bar ──
  function updateSessionBar(): void {
    while (sessionBar.firstChild) sessionBar.removeChild(sessionBar.firstChild);

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const displayNum = i + 1; // Always show 1-based position
      const tabWrap = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
      const isActive = s.id === activeSessionId;
      tabWrap.style.cssText = `
        display:inline-flex;align-items:center;gap:2px;
        border-radius:4px;cursor:pointer;
        border:1px solid ${isActive ? "#333" : "#ddd"};
        background:${isActive ? "#fff" : "transparent"};
        padding:0 2px 0 6px;height:24px;
      `;

      const label = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
      label.style.cssText = `font-size:12px;font-weight:500;color:${isActive ? "#333" : "#888"};`;
      label.textContent = String(displayNum);
      label.addEventListener("click", () => switchSession(s.id));
      tabWrap.appendChild(label);

      // Close button (only if more than 1 session)
      if (sessions.length > 1) {
        const closeBtn = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
        closeBtn.style.cssText = `
          font-size:11px;color:#aaa;cursor:pointer;padding:0 2px;line-height:1;
        `;
        closeBtn.textContent = "\u00D7";
        closeBtn.addEventListener("click", (e: Event) => {
          e.stopPropagation();
          closeSession(s.id);
        });
        tabWrap.appendChild(closeBtn);
      }

      sessionBar.appendChild(tabWrap);
    }

    // Spacer
    const spacer = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    spacer.style.cssText = "flex:1;";
    sessionBar.appendChild(spacer);

    // [+] button
    if (sessions.length < MAX_SESSIONS) {
      const addBtn = doc.createElementNS(XHTML_NS, "button") as HTMLElement;
      addBtn.style.cssText = `
        width:24px;height:24px;border-radius:4px;cursor:pointer;
        font-size:14px;border:1px solid #ddd;background:transparent;color:#888;
      `;
      addBtn.textContent = "+";
      addBtn.addEventListener("click", () => {
        const newSession = createSession();
        switchSession(newSession.id);
      });
      sessionBar.appendChild(addBtn);
    }
  }

  // Create first session and switch to it
  const firstSession = createSession();
  switchSession(firstSession.id);
  // Hide original messageArea (we use per-session containers)
  messageArea.style.display = "none";

  // ── Status bar update ──
  function updateStatus(model?: string): void {
    while (statusBar.firstChild) statusBar.removeChild(statusBar.firstChild);
    const modelEl = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    modelEl.style.cssText = "font-weight:500;";
    modelEl.textContent = model || "Opus";
    statusBar.appendChild(modelEl);
  }
  updateStatus();

  // ── Send handler ──
  inputController.setOnSend(async (text: string) => {
    const session = getActiveSession();
    if (!session) return;

    // Remove welcome
    const welcome = session.messageContainer.querySelector(".clautero-welcome");
    if (welcome) welcome.remove();

    // Add user message
    session.chatState = addMessage(session.chatState, {
      role: "user", content: text, chunks: [], timestamp: Date.now(),
    });
    session.renderer.renderUserMessage(text);

    // Create service if needed
    if (!session.service) {
      // Resolve CLI path (may throw if not configured)
      let cliPath: string;
      try {
        cliPath = await resolveCliPath();
      } catch (pathError) {
        // Show inline setup prompt
        showSetupPrompt(session, doc);
        inputController.setDisabled(false);
        return;
      }

      session.service = createClauteroService({
        cwd: addon.workspaceDir,
        cliPath,
        onChunk: (chunk: StreamChunk) => {
          session.streamController.handleChunk(chunk);

          // Update model name from system messages
          if (chunk.type === "system" || chunk.type === "result") {
            const meta = chunk.metadata ?? {};
            if (typeof meta.model === "string") {
              updateStatus(meta.model);
            }
          }

          if (chunk.type === "result" || chunk.type === "error") {
            inputController.setDisabled(false);
            inputController.focus();
          }
        },
        onError: (error: Error) => {
          session.renderer.appendTextChunk(`\nError: ${error.message}`);
          session.renderer.finishAssistantMessage();
          inputController.setDisabled(false);
        },
      });
      cleanupList.push(() => session.service?.cleanup());
    }

    // Start session if needed
    try {
      if (session.service.getState() !== "active") {
        await session.service.startSession();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      session.renderer.appendTextChunk(`Error: Could not start Claude. ${msg}`);
      session.renderer.finishAssistantMessage();
      inputController.setDisabled(false);
      return;
    }

    // Send
    inputController.setDisabled(true);
    session.streamController.startStream();
    try {
      const full = currentContext ? `${currentContext}\n\n${text}` : text;
      session.service.sendMessage(full);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      session.renderer.appendTextChunk(`Error: ${msg}`);
      session.renderer.finishAssistantMessage();
      inputController.setDisabled(false);
    }
  });

  Zotero.log("[Clautero] Chat system initialized (Claudian-style, max 5 sessions)", "info");
}

export function createHooks(addon: Addon): Hooks {
  const windowStates = new Map<Window, { cleanup: Array<() => void> }>();

  return {
    async onStartup() {
      await addon.ensureDirectories();
      Zotero.log("[Clautero] Plugin started", "info");
    },

    onShutdown() {
      for (const [, state] of windowStates) {
        for (const cleanup of state.cleanup) cleanup();
      }
      windowStates.clear();
    },

    onMainWindowLoad(window: Window) {
      const state = { cleanup: [] as Array<() => void> };
      windowStates.set(window, state);

      try {
        state.cleanup.push(initSidebarManager(window, addon.rootURI));
      } catch (e) {
        Zotero.log(`[Clautero] Sidebar init error: ${e}`, "error");
      }

      // Poll for elements then init chat
      let done = false;
      const poll = (window as any).setInterval(() => {
        if (done) return;
        const sidebar = (window as any).__clauteroSidebar;
        const elements = sidebar?.getElements();
        if (!elements) return;
        done = true;
        (window as any).clearInterval(poll);
        try {
          doInitChat(window, addon, elements, state.cleanup);
        } catch (e) {
          Zotero.log(`[Clautero] Chat init error: ${e}`, "error");
        }
      }, 500);
      state.cleanup.push(() => (window as any).clearInterval(poll));
    },

    onMainWindowUnload(window: Window) {
      const state = windowStates.get(window);
      if (state) {
        for (const cleanup of state.cleanup) {
          try { cleanup(); } catch { /* ignore */ }
        }
        windowStates.delete(window);
      }
    },
  };
}
