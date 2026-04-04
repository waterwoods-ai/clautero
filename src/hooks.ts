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
import { BUILT_IN_COMMANDS } from "./modules/commands/builtInCommands";

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
  const {
    messageArea, textarea, sendButton, contextBar, statusBar, sessionBar,
    modelLabel, effortLabel, contextPct, yoloLabel,
  } = elements;
  const doc = win.document;

  // ── Model cycling ──
  const MODELS = ["sonnet", "opus", "haiku"] as const;
  modelLabel.addEventListener("click", () => {
    const current = Zotero.Prefs.get("extensions.clautero.model", true) as string || "sonnet";
    const idx = MODELS.indexOf(current as typeof MODELS[number]);
    const next = MODELS[(idx + 1) % MODELS.length];
    Zotero.Prefs.set("extensions.clautero.model", next, true);
    modelLabel.textContent = next;
    Zotero.log(`[Clautero] Model changed to: ${next}`, "info");
  });
  // Init from pref
  const initModel = Zotero.Prefs.get("extensions.clautero.model", true) as string || "sonnet";
  modelLabel.textContent = initModel;

  // ── Effort/Thinking cycling ──
  const EFFORTS: Array<{ value: string; label: string }> = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "max", label: "Ultra" },
  ];
  effortLabel.addEventListener("click", () => {
    const current = Zotero.Prefs.get("extensions.clautero.effort", true) as string || "low";
    const idx = EFFORTS.findIndex(e => e.value === current);
    const next = EFFORTS[(idx + 1) % EFFORTS.length];
    Zotero.Prefs.set("extensions.clautero.effort", next.value, true);
    effortLabel.textContent = `Thinking: ${next.label}`;
    Zotero.log(`[Clautero] Effort changed to: ${next.value}`, "info");
  });
  // Init from pref
  const initEffort = Zotero.Prefs.get("extensions.clautero.effort", true) as string || "low";
  const initEffortObj = EFFORTS.find(e => e.value === initEffort) || EFFORTS[0];
  effortLabel.textContent = `Thinking: ${initEffortObj.label}`;

  // ── YOLO toggle ──
  let yoloOn = (Zotero.Prefs.get("extensions.clautero.permissionMode", true) as string) === "bypassPermissions";
  function updateYoloDisplay(): void {
    yoloLabel.textContent = yoloOn ? "YOLO \u25CF" : "YOLO \u25CB";
    yoloLabel.style.color = yoloOn ? "#e74c3c" : "#888";
  }
  updateYoloDisplay();
  yoloLabel.addEventListener("click", () => {
    yoloOn = !yoloOn;
    Zotero.Prefs.set(
      "extensions.clautero.permissionMode",
      yoloOn ? "bypassPermissions" : "acceptEdits",
      true
    );
    updateYoloDisplay();
    Zotero.log(`[Clautero] YOLO mode: ${yoloOn ? "ON" : "OFF"}`, "info");
  });

  // ── Context usage update ──
  const CONTEXT_WINDOW = 200000; // default fallback
  function updateContextUsage(usedTokens: number, ctxWindow?: number): void {
    const window = ctxWindow || CONTEXT_WINDOW;
    const pct = Math.min(100, Math.round((usedTokens / window) * 100));
    contextPct.textContent = `\u25D1 ${pct}%`;
  }

  // ── Chat history save/load ──
  async function getHistoryDir(): Promise<string> {
    const dir = PathUtils.join(addon.workspaceDir, "chat-history");
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });
    return dir;
  }

  async function saveSessionToHistory(session: Session): Promise<void> {
    try {
      const messages = session.chatState.messages;
      if (messages.length === 0) return;

      const title = messages[0]?.content.slice(0, 40) || "Untitled";
      // Use stable ID based on session id so we can overwrite on auto-save
      const fileId = `session-${session.id}`;
      const historyDir = await getHistoryDir();
      const filePath = PathUtils.join(historyDir, `${fileId}.json`);

      const data = {
        id: fileId,
        title,
        created: Date.now(),
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        })),
      };

      await IOUtils.writeUTF8(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
      Zotero.log(`[Clautero] Failed to save history: ${e}`, "warning");
    }
  }

  async function saveAllSessions(): Promise<void> {
    try {
      for (const s of sessions) {
        if (s.chatState.messages.length > 0) {
          await saveSessionToHistory(s);
        }
      }
      // Write _active.json to track last active session
      const historyDir = await getHistoryDir();
      const activeSession = getActiveSession();
      if (activeSession) {
        const activeData = { sessionId: `session-${activeSession.id}` };
        await IOUtils.writeUTF8(
          PathUtils.join(historyDir, "_active.json"),
          JSON.stringify(activeData)
        );
      }
      Zotero.log("[Clautero] All sessions saved", "info");
    } catch (e) {
      Zotero.log(`[Clautero] Failed to save all sessions: ${e}`, "warning");
    }
  }

  async function restoreLastSession(): Promise<void> {
    try {
      const historyDir = await getHistoryDir();

      // Read _active.json to find last active session
      const activePath = PathUtils.join(historyDir, "_active.json");
      const activeExists = await IOUtils.exists(activePath);
      if (!activeExists) return;

      const activeContent = await IOUtils.readUTF8(activePath);
      const activeData = JSON.parse(activeContent);
      const sessionId = activeData.sessionId as string;
      if (!sessionId) return;

      // Load the session file
      const sessionPath = PathUtils.join(historyDir, `${sessionId}.json`);
      const sessionExists = await IOUtils.exists(sessionPath);
      if (!sessionExists) return;

      const sessionContent = await IOUtils.readUTF8(sessionPath);
      const data = JSON.parse(sessionContent);
      if (!data.messages || !Array.isArray(data.messages) || data.messages.length === 0) return;

      // Restore into first session
      const firstSession = sessions[0];
      if (!firstSession) return;

      // Remove welcome screen
      const welcome = firstSession.messageContainer.querySelector(".clautero-welcome");
      if (welcome) welcome.remove();

      // Render messages
      for (const msg of data.messages) {
        firstSession.chatState = addMessage(firstSession.chatState, {
          role: msg.role, content: msg.content, chunks: [], timestamp: msg.timestamp,
        });
        if (msg.role === "user") {
          firstSession.renderer.renderUserMessage(msg.content);
        } else {
          firstSession.renderer.appendTextChunk(msg.content);
          firstSession.renderer.finishAssistantMessage();
        }
      }

      Zotero.log(`[Clautero] Restored last session: ${sessionId} (${data.messages.length} messages)`, "info");
    } catch (e) {
      Zotero.log(`[Clautero] Failed to restore session: ${e}`, "warning");
    }
  }

  async function loadHistoryList(): Promise<Array<{ id: string; title: string; created: number; path: string }>> {
    try {
      const historyDir = await getHistoryDir();
      const files = await IOUtils.getChildren(historyDir);
      const items: Array<{ id: string; title: string; created: number; path: string }> = [];

      for (const filePath of files) {
        if (!filePath.endsWith(".json")) continue;
        try {
          const content = await IOUtils.readUTF8(filePath);
          const data = JSON.parse(content);
          items.push({
            id: data.id || "",
            title: data.title || "Untitled",
            created: data.created || 0,
            path: filePath,
          });
        } catch { /* skip bad files */ }
      }

      return items.sort((a, b) => b.created - a.created);
    } catch { return []; }
  }

  function showHistoryPanel(): void {
    const session = getActiveSession();
    if (!session) return;
    const container = session.messageContainer;

    // Toggle off if already showing
    const existing = container.querySelector(".clautero-history-panel");
    if (existing) { existing.remove(); return; }

    const panel = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    panel.className = "clautero-history-panel";
    panel.style.cssText = `
      position:absolute;top:0;left:0;right:0;bottom:0;background:#fff;
      z-index:50;overflow-y:auto;padding:16px;
    `;

    const title = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    title.style.cssText = "font-weight:600;font-size:14px;margin-bottom:12px;";
    title.textContent = "Chat History";
    panel.appendChild(title);

    const loading = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    loading.style.cssText = "color:#888;font-style:italic;";
    loading.textContent = "Loading...";
    panel.appendChild(loading);

    container.style.position = "relative";
    container.appendChild(panel);

    // Load history async
    loadHistoryList().then(items => {
      loading.remove();
      if (items.length === 0) {
        const empty = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
        empty.style.cssText = "color:#888;text-align:center;margin:40px 0;";
        empty.textContent = "No chat history yet";
        panel.appendChild(empty);
        return;
      }

      for (const item of items) {
        const row = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
        row.style.cssText = `
          display:flex;justify-content:space-between;align-items:center;
          padding:8px 10px;margin:2px 0;border-radius:6px;cursor:pointer;
          border:1px solid #eee;
        `;
        row.addEventListener("mouseenter", () => { row.style.background = "#f5f5f5"; });
        row.addEventListener("mouseleave", () => { row.style.background = ""; });

        const info = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
        const titleSpan = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
        titleSpan.style.cssText = "font-weight:500;font-size:13px;";
        titleSpan.textContent = item.title;
        const dateSpan = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
        dateSpan.style.cssText = "font-size:11px;color:#888;margin-top:2px;";
        dateSpan.textContent = new Date(item.created).toLocaleString();
        info.appendChild(titleSpan);
        info.appendChild(dateSpan);

        row.appendChild(info);
        row.addEventListener("click", () => {
          panel.remove();
          loadHistoryItem(item.path);
        });
        panel.appendChild(row);
      }
    });

    // Close button
    const closeBtn = doc.createElementNS(XHTML_NS, "button") as HTMLElement;
    closeBtn.style.cssText = `
      position:absolute;top:12px;right:12px;background:none;border:none;
      font-size:18px;cursor:pointer;color:#666;
    `;
    closeBtn.textContent = "\u00D7";
    closeBtn.addEventListener("click", () => panel.remove());
    panel.appendChild(closeBtn);
  }

  async function loadHistoryItem(filePath: string): Promise<void> {
    try {
      const content = await IOUtils.readUTF8(filePath);
      const data = JSON.parse(content);
      if (!data.messages || !Array.isArray(data.messages)) return;

      // Create a new session and render the messages
      const newSession = createSession();
      switchSession(newSession.id);

      // Remove welcome
      const welcome = newSession.messageContainer.querySelector(".clautero-welcome");
      if (welcome) welcome.remove();

      // Render loaded messages
      for (const msg of data.messages) {
        newSession.chatState = addMessage(newSession.chatState, {
          role: msg.role, content: msg.content, chunks: [], timestamp: msg.timestamp,
        });
        if (msg.role === "user") {
          newSession.renderer.renderUserMessage(msg.content);
        } else {
          newSession.renderer.appendTextChunk(msg.content);
          newSession.renderer.finishAssistantMessage();
        }
      }

      Zotero.log(`[Clautero] Loaded history: ${filePath}`, "info");
    } catch (e) {
      Zotero.log(`[Clautero] Failed to load history: ${e}`, "warning");
    }
  }

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
        display:inline-flex;align-items:center;gap:1px;
        border-radius:3px;cursor:pointer;
        border:1px solid ${isActive ? "#333" : "#ccc"};
        background:${isActive ? "#fff" : "transparent"};
        padding:1px 4px;height:22px;min-width:20px;justify-content:center;
      `;

      const label = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
      label.style.cssText = `font-size:13px;font-weight:${isActive ? "600" : "400"};color:${isActive ? "#333" : "#999"};`;
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

    // Helper: create icon button with Unicode character (Claudian style)
    function iconBtn(title: string, icon: string): HTMLElement {
      const btn = doc.createElementNS(XHTML_NS, "button") as HTMLElement;
      btn.style.cssText = `
        width:24px;height:24px;border-radius:4px;cursor:pointer;
        border:none;background:transparent;padding:0;
        display:flex;align-items:center;justify-content:center;
        font-size:16px;color:#888;
      `;
      btn.setAttribute("title", title);
      btn.textContent = icon;
      return btn;
    }

    // [⊞] add tab button
    if (sessions.length < MAX_SESSIONS) {
      const addBtn = iconBtn("New tab", "\u229E");
      addBtn.addEventListener("click", () => {
        // Save current session to history before creating new
        const current = getActiveSession();
        if (current && current.chatState.messages.length > 0) {
          saveSessionToHistory(current);
        }
        const newSession = createSession();
        switchSession(newSession.id);
      });
      sessionBar.appendChild(addBtn);
    }

    // [✎] new conversation button
    const newConvBtn = iconBtn("New conversation", "\u270E");
    newConvBtn.addEventListener("click", () => {
      const current = getActiveSession();
      if (!current) return;

      // Save current to history if it has messages
      if (current.chatState.messages.length > 0) {
        saveSessionToHistory(current);
      }

      // Stop current service
      current.service?.cleanup();
      current.service = null;

      // Reset chat state
      current.chatState = createChatState();

      // Clear and rebuild message container
      while (current.messageContainer.firstChild) {
        current.messageContainer.removeChild(current.messageContainer.firstChild);
      }

      // Add welcome back
      const welcome = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
      welcome.className = "clautero-welcome";
      welcome.style.cssText = "display:flex;align-items:center;justify-content:center;height:100%;";
      const greet = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
      greet.style.cssText = "font-size:22px;font-weight:400;color:#1a1a1a;font-family:Georgia,serif;text-align:center;";
      greet.textContent = "Ask Claude about\nyour research";
      welcome.appendChild(greet);
      current.messageContainer.appendChild(welcome);

      // Reset renderer
      current.renderer.cleanup();
      current.renderer = createMessageRenderer(current.messageContainer);
      current.streamController.cleanup();
      current.streamController = createStreamController(
        current.renderer,
        () => current.chatState,
        (next: ChatStateData) => { current.chatState = next; }
      );

      // Reset context usage
      updateContextUsage(0);

      Zotero.log("[Clautero] New conversation started", "info");
    });
    sessionBar.appendChild(newConvBtn);

    // [⏱] history button
    const histBtn = iconBtn("Chat history", "\u29D7");
    histBtn.addEventListener("click", () => showHistoryPanel());
    sessionBar.appendChild(histBtn);
  }

  // Create first session and switch to it
  const firstSession = createSession();
  switchSession(firstSession.id);
  // Hide original messageArea (we use per-session containers)
  messageArea.style.display = "none";

  // Restore last session from disk
  restoreLastSession().catch(e => {
    Zotero.log(`[Clautero] Session restore failed: ${e}`, "warning");
  });

  // Save all sessions on shutdown
  cleanupList.push(() => {
    saveAllSessions().catch(e => {
      Zotero.log(`[Clautero] Shutdown save failed: ${e}`, "warning");
    });
  });

  // ── Slash command dropdown ──
  const cmdDropdown = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  cmdDropdown.style.cssText = `
    display:none;position:absolute;bottom:100%;left:0;right:0;
    background:#fff;border:1px solid #e0e0e0;border-radius:8px;
    box-shadow:0 -4px 16px rgba(0,0,0,0.1);max-height:240px;overflow-y:auto;
    z-index:200;margin-bottom:4px;
  `;
  // Insert dropdown relative to input area
  const inputParent = textarea.parentElement as HTMLElement;
  if (inputParent) {
    inputParent.style.position = "relative";
    inputParent.appendChild(cmdDropdown);
  }

  let cmdSelectedIdx = 0;
  let cmdFiltered: typeof BUILT_IN_COMMANDS extends readonly (infer T)[] ? T[] : never = [];

  function renderCmdDropdown(filter: string): void {
    const query = filter.toLowerCase();
    cmdFiltered = BUILT_IN_COMMANDS.filter(c =>
      c.name.toLowerCase().includes(query)
    ) as typeof cmdFiltered;

    while (cmdDropdown.firstChild) cmdDropdown.removeChild(cmdDropdown.firstChild);

    if (cmdFiltered.length === 0) {
      cmdDropdown.style.display = "none";
      return;
    }

    cmdSelectedIdx = 0;
    cmdDropdown.style.display = "block";

    for (let i = 0; i < cmdFiltered.length; i++) {
      const cmd = cmdFiltered[i];
      const row = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
      row.style.cssText = `
        padding:8px 12px;cursor:pointer;
        ${i === cmdSelectedIdx ? "background:#f0f0f0;" : ""}
      `;

      const nameEl = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
      nameEl.style.cssText = "font-weight:500;font-size:13px;color:#333;";
      nameEl.textContent = `/${cmd.name}`;

      const descEl = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
      descEl.style.cssText = "font-size:11px;color:#888;margin-top:2px;";
      descEl.textContent = cmd.description;

      row.appendChild(nameEl);
      row.appendChild(descEl);

      row.addEventListener("mouseenter", () => {
        cmdSelectedIdx = i;
        highlightCmdRow();
      });
      row.addEventListener("click", () => selectCmd(cmd));

      cmdDropdown.appendChild(row);
    }
  }

  function highlightCmdRow(): void {
    const rows = cmdDropdown.children;
    for (let i = 0; i < rows.length; i++) {
      (rows[i] as HTMLElement).style.background = i === cmdSelectedIdx ? "#f0f0f0" : "";
    }
  }

  function selectCmd(cmd: typeof BUILT_IN_COMMANDS[number]): void {
    textarea.value = `/${cmd.name} `;
    cmdDropdown.style.display = "none";
    textarea.focus();
  }

  function hideCmdDropdown(): void {
    cmdDropdown.style.display = "none";
  }

  // Listen for input to show/hide slash command dropdown
  textarea.addEventListener("input", () => {
    const val = textarea.value;
    if (val.startsWith("/") && !val.includes("\n")) {
      const query = val.slice(1).split(" ")[0] || "";
      renderCmdDropdown(query);
    } else {
      hideCmdDropdown();
    }
  });

  // Arrow keys + Enter for dropdown navigation
  textarea.addEventListener("keydown", (e: Event) => {
    const ke = e as KeyboardEvent;
    if (cmdDropdown.style.display === "none") return;

    if (ke.key === "ArrowUp") {
      ke.preventDefault();
      cmdSelectedIdx = Math.max(0, cmdSelectedIdx - 1);
      highlightCmdRow();
    } else if (ke.key === "ArrowDown") {
      ke.preventDefault();
      cmdSelectedIdx = Math.min(cmdFiltered.length - 1, cmdSelectedIdx + 1);
      highlightCmdRow();
    } else if (ke.key === "Enter" && !ke.shiftKey && cmdFiltered.length > 0) {
      ke.preventDefault();
      ke.stopPropagation();
      selectCmd(cmdFiltered[cmdSelectedIdx]);
    } else if (ke.key === "Escape") {
      hideCmdDropdown();
    }
  }, true); // capture phase to intercept before InputController

  // ── Send handler (with slash command expansion) ──
  inputController.setOnSend(async (text: string) => {
    // Check for slash command
    if (text.startsWith("/")) {
      const parts = text.match(/^\/(\w+)\s*(.*)/);
      if (parts) {
        const cmdName = parts[1];
        const cmdArgs = parts[2] || "";
        const cmd = BUILT_IN_COMMANDS.find(c => c.name === cmdName);
        if (cmd) {
          hideCmdDropdown();
          const session = getActiveSession();
          if (!session) return;

          if (cmd.type === "action") {
            cmd.execute(cmdArgs, {
              currentContext,
              clearConversation: () => {
                // Trigger new conversation
                const newConvBtns = sessionBar.querySelectorAll("button");
                for (const b of Array.from(newConvBtns)) {
                  if (b.getAttribute("title") === "New conversation") {
                    (b as HTMLElement).click();
                    break;
                  }
                }
              },
            });
            return;
          }

          // Prompt type — expand and send
          const expanded = cmd.execute(cmdArgs, { currentContext, clearConversation: () => {} });
          if (expanded) {
            text = expanded;
          }
        }
      }
    }
    hideCmdDropdown();
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

          // Update model name and context usage from response metadata
          if (chunk.type === "system" || chunk.type === "result") {
            const meta = chunk.metadata ?? {};
            if (typeof meta.model === "string") {
              modelLabel.textContent = meta.model.replace(/^claude-/, "").split("-")[0] || meta.model;
            }
          }

          // Update context usage from result metadata
          if (chunk.type === "result") {
            const meta = chunk.metadata ?? {};

            // Token counts are nested under usage.input_tokens / usage.output_tokens
            const usage = meta.usage as Record<string, unknown> | undefined;
            if (usage) {
              const inputT = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
              const outputT = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
              const cacheT = typeof usage.cache_creation_input_tokens === "number"
                ? usage.cache_creation_input_tokens : 0;
              const cacheReadT = typeof usage.cache_read_input_tokens === "number"
                ? usage.cache_read_input_tokens : 0;
              const total = inputT + outputT + cacheT + cacheReadT;
              if (total > 0) {
                // Get actual context window from modelUsage if available
                let contextWindow = CONTEXT_WINDOW;
                const modelUsage = meta.modelUsage as Record<string, any> | undefined;
                if (modelUsage) {
                  const firstModel = Object.values(modelUsage)[0];
                  if (firstModel && typeof firstModel.contextWindow === "number") {
                    contextWindow = firstModel.contextWindow;
                  }
                }
                updateContextUsage(total, contextWindow);
              }
            }
          }

          if (chunk.type === "result" || chunk.type === "error") {
            inputController.setDisabled(false);
            inputController.focus();
            // Auto-save session after each response
            saveSessionToHistory(session);
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
