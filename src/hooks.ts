import { Addon } from "./addon";
import { initSidebarManager } from "./modules/sidebar/SidebarManager";
import type { SidebarElements } from "./modules/sidebar/SidebarManager";
import { createInputController } from "./modules/chat/InputController";
import { createChatState, addMessage, type ChatStateData } from "./modules/chat/ChatState";
import { createMessageRenderer } from "./modules/chat/MessageRenderer";
import { createStreamController } from "./modules/chat/StreamController";
import { createClauteroService } from "./core/agent/ClauteroService";
import {
  resolveProviderCLIPath,
  isProviderAvailable,
  clearCLIPathCache,
} from "./core/agent/CLIPathResolver";
import {
  PROVIDERS,
  DEFAULT_PROVIDER_ID,
  getProvider,
} from "./core/providers/registry";
import type { ProviderModule } from "./core/providers/types";
import type { StreamChunk } from "./core/agent/types";
import { createContextChipsView } from "./modules/context/ContextChipsView";
import { getActiveReaderItem } from "./modules/context/ReaderItem";
import { BUILT_IN_COMMANDS, type SlashCommand } from "./modules/commands/builtInCommands";
import {
  resolveNewSessionModel,
  createModelSelectionCoordinator,
} from "./modules/chat/ModelSelection";
import { showPopupMenu, closeActivePopup } from "./modules/sidebar/PopupMenu";
import { createWarmPool, WarmCapacityError } from "./modules/sessions/WarmPool";
import { resolveIndicator, type SessionStatusKind } from "./modules/sessions/SessionStatus";
import {
  createLayoutPersistence,
  decodeLayout,
  encodeLayout,
  resolveRestorePlan,
  type SessionLayoutState,
} from "./modules/sessions/SessionLayout";
import { showHistoryPanel } from "./modules/history/HistoryPanel";
import type { HistoryEntry } from "./modules/history/HistoryQuery";

export interface Hooks {
  onStartup(): Promise<void>;
  onShutdown(): void;
  onMainWindowLoad(window: Window): void;
  onMainWindowUnload(window: Window): void;
}

const XHTML_NS = "http://www.w3.org/1999/xhtml";

function showSetupPrompt(session: Session, doc: Document, provider: ProviderModule): void {
  const prefKey = provider.id === "claude"
    ? "extensions.clautero.claudeCliPath"
    : `extensions.clautero.cliPath.${provider.id}`;
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
  title.textContent = `Configure ${provider.label} CLI Path`;

  const desc = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  desc.style.cssText = "font-size:12px;color:#666;margin-bottom:12px;line-height:1.4;";
  const bin = provider.binaryName.unix;
  desc.textContent = `Enter the full path to your ${provider.label} CLI executable. ` +
    `Mac/Linux: run "which ${bin}". Windows: run "where ${bin}". ` +
    `Must include the filename (e.g., /usr/local/bin/${bin}).`;

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
      Zotero.Prefs.set(prefKey, path, true);
      // Clear cached path so it picks up the new one
      clearCLIPathCache();
      // Remove setup prompt
      setup.remove();
      // Show confirmation
      session.renderer.appendTextChunk(`${provider.label} CLI path saved. Send a message to start chatting!`);
      session.renderer.finishAssistantMessage();
      Zotero.log(`[Clautero] ${provider.label} CLI path configured: ${path}`, "info");
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

function getSelectedItem(win: Window): Zotero.Item | null {
  // In a PDF reader tab, the open paper wins over the library selection
  const readerItem = getActiveReaderItem(win);
  if (readerItem) return readerItem;

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
  /** Stable id naming this session's history file; survives restarts. */
  historyId: string;
  /** Provider conversation id (--resume / -s / --session-id target). */
  claudeSessionId: string | null;
  /** Agent CLI backing this session ("claude", "codex", "opencode", "pi"). */
  providerId: string;
  model: string;
  status: SessionStatusKind;
  /** Model changed while a turn was streaming; cool the process at turn end. */
  pendingModelChange: boolean;
  pinned: boolean;
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
    providerLabel, modelLabel, effortLabel, contextPct, yoloLabel,
  } = elements;
  const doc = win.document;

  // ── Provider roster (availability probed at startup, re-probed on demand) ──
  let availableProviderIds: string[] = [DEFAULT_PROVIDER_ID];
  let providerProbeRunning = false;

  function probeProviders(): void {
    if (providerProbeRunning) return;
    providerProbeRunning = true;
    void (async () => {
      try {
        const ids: string[] = [];
        for (const candidate of PROVIDERS) {
          if (await isProviderAvailable(candidate)) ids.push(candidate.id);
        }
        if (ids.length > 0) availableProviderIds = ids;
        Zotero.log(`[Clautero] Available providers: ${availableProviderIds.join(", ")}`, "info");
      } finally {
        providerProbeRunning = false;
      }
    })();
  }
  probeProviders();

  function getProviderSeed(): string {
    try {
      const seed = Zotero.Prefs.get("extensions.clautero.lastSelectedProvider", true) as string;
      if (seed && seed.trim()) return seed.trim();
    } catch { /* ignore */ }
    return DEFAULT_PROVIDER_ID;
  }

  function applyProviderChange(session: Session, providerId: string): void {
    if (providerId === session.providerId) return;
    const next = getProvider(providerId);
    Zotero.Prefs.set("extensions.clautero.lastSelectedProvider", next.id, true);

    const isFresh = session.chatState.messages.length === 0 && !session.claudeSessionId;
    if (isFresh) {
      session.providerId = next.id;
      session.model = resolveNewSessionModel(getModelSeed(), next.models);
      refreshStatusLabels();
      scheduleLayoutSave();
      Zotero.log(`[Clautero] Session ${session.id} provider → ${next.label}`, "info");
    } else {
      // A bound conversation keeps its provider — open a fresh tab instead.
      const newSession = createSession(undefined, undefined, undefined, next.id);
      switchSession(newSession.id);
      Zotero.log(`[Clautero] Opened new ${next.label} tab (bound sessions keep their provider)`, "info");
    }
  }

  providerLabel.addEventListener("click", () => {
    const session = getActiveSession();
    if (!session) return;
    // A CLI installed after startup (or a probe that raced this click)
    // shows up the next time the menu opens.
    if (availableProviderIds.length < PROVIDERS.length) probeProviders();
    showPopupMenu(doc, providerLabel, PROVIDERS.map((p) => {
      const available = availableProviderIds.includes(p.id);
      return {
        value: p.id,
        label: p.label,
        selected: p.id === session.providerId,
        disabled: !available,
        description: available ? undefined : "Not installed",
      };
    }), (value) => applyProviderChange(session, value));
  });

  // ── Model selection (per-session, seeded from the last explicit pick) ──
  const modelCoordinator = createModelSelectionCoordinator();

  function getModelSeed(): string | null {
    try {
      const seed = Zotero.Prefs.get("extensions.clautero.lastSelectedModel", true) as string;
      if (seed && seed.trim()) return seed.trim();
    } catch { /* ignore */ }
    try {
      // Legacy global pref, used as seed once
      return (Zotero.Prefs.get("extensions.clautero.model", true) as string) || null;
    } catch { return null; }
  }

  function applyModelChange(session: Session, next: string): void {
    if (next === session.model) return;
    const intent = modelCoordinator.beginIntent();
    session.model = next;
    refreshStatusLabels();
    scheduleLayoutSave();
    void modelCoordinator.commitIntent(intent, async () => {
      Zotero.Prefs.set("extensions.clautero.lastSelectedModel", next, true);
      // A live process is bound to the old model; cool it so the next
      // message respawns (and resumes) with the new one. Mid-turn, defer
      // the cool to turn completion instead of dropping it.
      if (session.service && session.service.getState() === "active") {
        if (session.status !== "streaming") {
          await session.service.interrupt();
        } else {
          session.pendingModelChange = true;
        }
      }
    }, () => session.model === next);
    Zotero.log(`[Clautero] Model for session ${session.id}: ${next}`, "info");
  }

  modelLabel.addEventListener("click", () => {
    const session = getActiveSession();
    if (!session) return;
    const provider = getProvider(session.providerId);
    if (provider.models.length === 0) {
      showPopupMenu(doc, modelLabel, [{
        value: "",
        label: "Auto",
        description: `${provider.label} uses its own configured default model`,
        selected: true,
      }], () => {});
      return;
    }
    showPopupMenu(doc, modelLabel, provider.models.map((m) => ({
      value: m,
      label: m,
      selected: m === session.model,
    })), (value) => applyModelChange(session, value));
  });

  // ── Effort/Thinking cycling ──
  const EFFORTS: Array<{ value: string; label: string }> = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "max", label: "Ultra" },
  ];
  effortLabel.addEventListener("click", () => {
    const current = Zotero.Prefs.get("extensions.clautero.effort", true) as string || "low";
    showPopupMenu(doc, effortLabel, EFFORTS.map((e) => ({
      value: e.value,
      label: e.label,
      selected: e.value === current,
    })), (value) => {
      const chosen = EFFORTS.find(e => e.value === value) ?? EFFORTS[0];
      Zotero.Prefs.set("extensions.clautero.effort", chosen.value, true);
      effortLabel.textContent = `Thinking: ${chosen.label}`;
      Zotero.log(`[Clautero] Effort changed to: ${chosen.value}`, "info");
    });
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
  function safePath(...parts: string[]): string {
    try {
      return PathUtils.join(...parts);
    } catch {
      const sep = parts[0]?.includes("\\") ? "\\" : "/";
      return parts.join(sep);
    }
  }

  async function getHistoryDir(): Promise<string> {
    const dir = safePath(addon.workspaceDir, "chat-history");
    try {
      await IOUtils.makeDirectory(dir, { ignoreExisting: true });
    } catch (e) {
      Zotero.log(`[Clautero] History dir warning: ${e}`, "warning");
    }
    return dir;
  }

  async function saveSessionToHistory(session: Session): Promise<void> {
    try {
      const messages = session.chatState.messages;
      if (messages.length === 0) return;

      const fileId = session.historyId;
      const historyDir = await getHistoryDir();
      const filePath = PathUtils.join(historyDir, `${fileId}.json`);

      // Preserve fields the user controls (rename, pin) and the original
      // creation time across auto-saves.
      let title = messages[0]?.content.slice(0, 40) || "Untitled";
      let titleEdited = false;
      let created = Date.now();
      let pinned = session.pinned;
      try {
        const existing = JSON.parse(await IOUtils.readUTF8(filePath));
        if (existing.titleEdited === true && typeof existing.title === "string") {
          title = existing.title;
          titleEdited = true;
        }
        if (typeof existing.created === "number") created = existing.created;
        if (typeof existing.pinned === "boolean") pinned = existing.pinned;
      } catch { /* first save of this session */ }

      const data = {
        id: fileId,
        title,
        titleEdited,
        created,
        pinned,
        provider: session.providerId,
        model: session.model,
        ...(session.claudeSessionId ? { claudeSessionId: session.claudeSessionId } : {}),
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
      await layoutPersistence.flush();
      Zotero.log("[Clautero] All sessions saved", "info");
    } catch (e) {
      Zotero.log(`[Clautero] Failed to save all sessions: ${e}`, "warning");
    }
  }

  function isRestoreEnabled(): boolean {
    try {
      return Zotero.Prefs.get("extensions.clautero.restoreTabs", true) !== false;
    } catch { return true; }
  }

  async function loadLayoutState(): Promise<SessionLayoutState | null> {
    try {
      const historyDir = await getHistoryDir();
      const layoutPath = PathUtils.join(historyDir, "_layout.json");
      if (!(await IOUtils.exists(layoutPath))) return null;
      return decodeLayout(JSON.parse(await IOUtils.readUTF8(layoutPath)));
    } catch (e) {
      Zotero.log(`[Clautero] Could not read session layout: ${e}`, "warning");
      return null;
    }
  }

  /** Restore the persisted tab workspace. Returns false when starting fresh. */
  async function restoreLayout(): Promise<boolean> {
    const plan = resolveRestorePlan(await loadLayoutState(), {
      restoreOnStartup: isRestoreEnabled(),
    });
    if (plan.shells.length === 0) return false;

    const historyDir = await getHistoryDir();
    for (const shell of plan.shells) {
      // Legacy shells (pre-provider) are Claude conversations by definition.
      const session = createSession(
        shell.historyId, shell.model, shell.claudeSessionId,
        shell.provider ?? DEFAULT_PROVIDER_ID
      );
      const filePath = PathUtils.join(historyDir, `${shell.historyId}.json`);
      try {
        if (await IOUtils.exists(filePath)) {
          await renderSessionFromFile(session, filePath);
        }
      } catch (e) {
        Zotero.log(`[Clautero] Could not restore ${shell.historyId}: ${e}`, "warning");
      }
    }

    const active = sessions.find((s) => s.historyId === plan.activeHistoryId) ?? sessions[0];
    if (active) switchSession(active.id);
    Zotero.log(`[Clautero] Restored ${plan.shells.length} session tab(s)`, "info");
    return sessions.length > 0;
  }

  async function loadHistoryList(): Promise<HistoryEntry[]> {
    try {
      const historyDir = await getHistoryDir();
      const files = await IOUtils.getChildren(historyDir);
      const items: HistoryEntry[] = [];

      for (const filePath of files) {
        if (!filePath.endsWith(".json")) continue;
        const base = filePath.split(/[\\/]/).pop() ?? "";
        if (base.startsWith("_")) continue; // _layout.json and other metadata
        try {
          const content = await IOUtils.readUTF8(filePath);
          const data = JSON.parse(content);
          items.push({
            id: data.id || "",
            title: data.title || "Untitled",
            created: data.created || 0,
            pinned: data.pinned === true,
            path: filePath,
          });
        } catch { /* skip bad files */ }
      }

      return items;
    } catch { return []; }
  }

  async function renderSessionFromFile(session: Session, filePath: string): Promise<void> {
    const content = await IOUtils.readUTF8(filePath);
    const data = JSON.parse(content);
    if (!data.messages || !Array.isArray(data.messages)) return;

    session.pinned = data.pinned === true;
    if (!session.claudeSessionId && typeof data.claudeSessionId === "string") {
      session.claudeSessionId = data.claudeSessionId;
    }
    if (typeof data.provider === "string" && data.provider) {
      session.providerId = data.provider;
    }
    if (typeof data.model === "string") {
      session.model = data.model;
    }

    const welcome = session.messageContainer.querySelector(".clautero-welcome");
    if (welcome) welcome.remove();

    for (const msg of data.messages) {
      session.chatState = addMessage(session.chatState, {
        role: msg.role, content: msg.content, chunks: [], timestamp: msg.timestamp,
      });
      if (msg.role === "user") {
        session.renderer.renderUserMessage(msg.content);
      } else {
        session.renderer.appendTextChunk(msg.content);
        session.renderer.finishAssistantMessage();
      }
    }
  }

  async function loadHistoryItem(entry: HistoryEntry): Promise<void> {
    try {
      // Already open in a tab → just focus it
      const existing = sessions.find((s) => s.historyId === entry.id);
      if (existing) {
        switchSession(existing.id);
        return;
      }

      // Legacy files can carry a blank id — never let it become a historyId.
      // Default to Claude: pre-provider history files are Claude conversations;
      // newer files override this from their own "provider" field on render.
      const newSession = createSession(entry.id || undefined, undefined, undefined, DEFAULT_PROVIDER_ID);
      switchSession(newSession.id);
      await renderSessionFromFile(newSession, entry.path);
      refreshStatusLabels();
      scheduleLayoutSave();
      Zotero.log(`[Clautero] Loaded history: ${entry.path}`, "info");
    } catch (e) {
      Zotero.log(`[Clautero] Failed to load history: ${e}`, "warning");
    }
  }

  async function updateHistoryFile(
    entry: HistoryEntry,
    transform: (data: Record<string, unknown>) => Record<string, unknown>
  ): Promise<void> {
    try {
      const data = JSON.parse(await IOUtils.readUTF8(entry.path)) as Record<string, unknown>;
      const next = transform(data);
      await IOUtils.writeUTF8(entry.path, JSON.stringify(next, null, 2));
      const open = sessions.find((s) => s.historyId === entry.id);
      if (open) open.pinned = next.pinned === true;
    } catch (e) {
      Zotero.log(`[Clautero] Failed to update history file: ${e}`, "warning");
    }
  }

  function openHistoryPanel(): void {
    const session = getActiveSession();
    if (!session) return;
    showHistoryPanel(doc, session.messageContainer, {
      loadEntries: loadHistoryList,
      onOpen: (entry) => { void loadHistoryItem(entry); },
      onTogglePin: (entry) =>
        updateHistoryFile(entry, (d) => ({ ...d, pinned: !(d.pinned === true) })),
      onRename: (entry, title) =>
        updateHistoryFile(entry, (d) => ({ ...d, title, titleEdited: true })),
    });
  }

  const inputController = createInputController(textarea, sendButton);
  cleanupList.push(() => inputController.cleanup());
  cleanupList.push(closeActivePopup);

  // The composer is shared by all tabs: its disabled state must always
  // reflect the ACTIVE session, not whichever session finished last.
  function syncInputToActiveSession(): void {
    inputController.setDisabled(getActiveSession()?.status === "streaming");
  }

  // ── Esc interrupts the running turn (message restored semantics: the
  //    turn is stopped; the session resumes with --resume on next send) ──
  async function interruptActiveSession(): Promise<void> {
    const session = getActiveSession();
    if (!session || session.status !== "streaming") return;
    session.status = "idle";
    updateSessionBar();
    try {
      await session.service?.interrupt();
    } catch (e) {
      Zotero.log(`[Clautero] Interrupt failed: ${e}`, "warning");
    }
    session.streamController.markInterrupted();
    inputController.setDisabled(false);
    inputController.focus();
    Zotero.log("[Clautero] Turn interrupted by user", "info");
  }

  const escHandler = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key !== "Escape") return;
    const session = getActiveSession();
    if (session && session.status === "streaming") {
      ke.preventDefault();
      ke.stopPropagation();
      void interruptActiveSession();
    }
  };
  doc.addEventListener("keydown", escHandler, true);
  cleanupList.push(() => doc.removeEventListener("keydown", escHandler, true));

  // ── Context ──
  let currentContext = "";
  const chipsView = createContextChipsView(contextBar, doc);
  chipsView.setOnChange((ctx: string) => { currentContext = ctx; });
  cleanupList.push(() => chipsView.cleanup());

  if (isAutoAttachEnabled()) {
    // Initial context: check if item or collection is selected
    const initialItem = getSelectedItem(win);
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
          const item = getSelectedItem(win);
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
      const item = getSelectedItem(win);
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

  // ── Sessions (tabs unlimited; warm subprocesses capped by the pool) ──
  const sessions: Session[] = [];
  let activeSessionId = 0;
  let nextSessionNumber = 0;

  const warmPool = createWarmPool(() => {
    try {
      return Zotero.Prefs.get("extensions.clautero.maxWarmProcesses", true) as number;
    } catch { return NaN; }
  });

  function warmOwnerFor(session: Session) {
    return {
      id: session.historyId,
      canCool: () => session.status !== "streaming",
      cool: async () => {
        await session.service?.interrupt();
        Zotero.log(
          `[Clautero] Cooled session ${session.id} (resumes on next message)`,
          "info"
        );
      },
    };
  }

  const layoutPersistence = createLayoutPersistence(
    async (state) => {
      const historyDir = await getHistoryDir();
      await IOUtils.writeUTF8(
        PathUtils.join(historyDir, "_layout.json"),
        JSON.stringify(encodeLayout(state), null, 2)
      );
    },
    {
      setTimeout: (fn, ms) => (win as any).setTimeout(fn, ms) as number,
      clearTimeout: (id) => (win as any).clearTimeout(id),
    }
  );
  cleanupList.push(() => {
    layoutPersistence.flush().catch(() => { /* best effort on shutdown */ });
    layoutPersistence.dispose();
  });

  function currentLayout(): SessionLayoutState {
    const active = getActiveSession();
    return {
      shells: sessions.map((s) => ({
        historyId: s.historyId,
        ...(s.claudeSessionId ? { claudeSessionId: s.claudeSessionId } : {}),
        ...(s.model ? { model: s.model } : {}),
        provider: s.providerId,
      })),
      activeHistoryId: active?.historyId ?? sessions[0]?.historyId ?? null,
    };
  }

  function scheduleLayoutSave(): void {
    layoutPersistence.update(currentLayout());
  }

  function createSession(
    historyId?: string,
    model?: string,
    claudeSessionId?: string,
    provider?: string
  ): Session {
    const providerId = provider ?? getProviderSeed();
    const id = ++nextSessionNumber;
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
      historyId: historyId ?? `session-${Date.now()}-${id}`,
      claudeSessionId: claudeSessionId ?? null,
      providerId,
      model: model ?? resolveNewSessionModel(getModelSeed(), getProvider(providerId).models),
      status: "idle",
      pendingModelChange: false,
      pinned: false,
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
    scheduleLayoutSave();
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
    refreshStatusLabels();

    syncInputToActiveSession();
    updateSessionBar();
    scheduleLayoutSave();
  }

  function getActiveSession(): Session | undefined {
    return sessions.find(s => s.id === activeSessionId);
  }

  function refreshStatusLabels(): void {
    const session = getActiveSession();
    if (!session) return;
    providerLabel.textContent = getProvider(session.providerId).label;
    modelLabel.textContent = session.model || "auto";
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

    warmPool.release(session.historyId);
    sessions.splice(idx, 1);

    // If closing active, switch to first remaining
    if (activeSessionId === id) {
      switchSession(sessions[0].id);
    } else {
      updateSessionBar();
      scheduleLayoutSave();
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

      const indicator = resolveIndicator(s.status);
      if (indicator.color) {
        const dot = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
        dot.style.cssText =
          `width:6px;height:6px;border-radius:50%;background:${indicator.color};` +
          "display:inline-block;flex-shrink:0;";
        tabWrap.appendChild(dot);
        tabWrap.setAttribute("title", indicator.label);
      }

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

    // [⊞] add tab button — tabs are unlimited; the warm pool caps processes
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

    // [✎] new conversation button
    const newConvBtn = iconBtn("New conversation", "\u270E");
    newConvBtn.addEventListener("click", () => {
      const current = getActiveSession();
      if (!current) return;
      if (current.status === "streaming") {
        // Resetting mid-turn would let late chunks from the dying process
        // land in (and re-bind the session id of) the fresh conversation.
        Zotero.log("[Clautero] Interrupt (Esc) before starting a new conversation", "warning");
        return;
      }

      // Save current to history if it has messages
      if (current.chatState.messages.length > 0) {
        saveSessionToHistory(current);
      }

      // Stop current service
      current.service?.cleanup();
      current.service = null;
      warmPool.release(current.historyId);

      // The old conversation stays in history under its old id;
      // this tab becomes a brand-new conversation with the same model.
      current.historyId = `session-${Date.now()}-${current.id}`;
      current.claudeSessionId = null;
      current.status = "idle";
      current.pinned = false;
      scheduleLayoutSave();

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
    histBtn.addEventListener("click", () => openHistoryPanel());
    sessionBar.appendChild(histBtn);
  }

  // Hide original messageArea (we use per-session containers)
  messageArea.style.display = "none";

  // Restore the persisted tab workspace; fall back to one fresh tab
  restoreLayout()
    .then((restored) => {
      if (!restored && sessions.length === 0) {
        switchSession(createSession().id);
      }
    })
    .catch((e) => {
      Zotero.log(`[Clautero] Session restore failed: ${e}`, "warning");
      if (sessions.length === 0) {
        switchSession(createSession().id);
      }
    });

  // Save all sessions on shutdown
  cleanupList.push(() => {
    saveAllSessions().catch(e => {
      Zotero.log(`[Clautero] Shutdown save failed: ${e}`, "warning");
    });
  });

  // ── Load Claude Code skills from filesystem ──
  interface SkillInfo { name: string; description: string; source: string }
  let allCommands: SkillInfo[] = [];

  async function loadClaudeCodeSkills(): Promise<SkillInfo[]> {
    const skills: SkillInfo[] = [];
    try {
      // Derive home directory from profile path (cross-platform)
      const profile = PathUtils.profileDir;
      // Split on both / and \ to handle macOS/Linux and Windows
      const parts = profile.split(/[/\\]/);
      const homeIdx = parts.indexOf("Users");
      let home = "";
      if (homeIdx >= 0 && parts.length > homeIdx + 1) {
        // Use PathUtils.join to reconstruct with correct separators
        // On Windows: C:\Users\Name, on Mac: /Users/Name
        const sep = profile.includes("\\") ? "\\" : "/";
        home = parts.slice(0, homeIdx + 2).join(sep);
        // Windows drive letter fix: if first part is empty (from leading /), skip it
        if (!parts[0] && sep === "/") {
          home = "/" + parts.slice(1, homeIdx + 2).join(sep);
        }
      }
      if (!home) return skills;

      let skillsDir: string;
      try {
        skillsDir = PathUtils.join(home, ".claude", "skills");
      } catch {
        // PathUtils.join failed — try manual join
        const sep = home.includes("\\") ? "\\" : "/";
        skillsDir = home + sep + ".claude" + sep + "skills";
      }
      const exists = await IOUtils.exists(skillsDir);
      if (!exists) return skills;

      const children = await IOUtils.getChildren(skillsDir);
      for (const childPath of children) {
        try {
          const skillFile = PathUtils.join(childPath, "SKILL.md");
          const fileExists = await IOUtils.exists(skillFile);
          if (!fileExists) continue;

          const content = await IOUtils.readUTF8(skillFile);
          // Parse YAML frontmatter
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (!fmMatch) continue;

          const fm = fmMatch[1];
          const nameMatch = fm.match(/^name:\s*(.+)$/m);
          const descMatch = fm.match(/^description:\s*(.+)$/m);

          if (nameMatch) {
            skills.push({
              name: nameMatch[1].trim(),
              description: (descMatch ? descMatch[1].trim() : "").slice(0, 80),
              source: "claude-code",
            });
          }
        } catch { /* skip bad skill files */ }
      }
    } catch (e) {
      Zotero.log(`[Clautero] Failed to load Claude Code skills: ${e}`, "warning");
    }
    return skills;
  }

  // Load skills on init
  loadClaudeCodeSkills().then(skills => {
    // Combine built-in + Claude Code skills
    const builtIn: SkillInfo[] = BUILT_IN_COMMANDS.map(c => ({
      name: c.name, description: c.description, source: "clautero",
    }));
    allCommands = [...builtIn, ...skills];
    Zotero.log(`[Clautero] Loaded ${skills.length} Claude Code skills, ${builtIn.length} built-in`, "info");
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
  let cmdFiltered: SkillInfo[] = [];

  function renderCmdDropdown(filter: string): void {
    const query = filter.toLowerCase();
    cmdFiltered = allCommands.filter(c =>
      c.name.toLowerCase().includes(query)
    );

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
      const sourceTag = cmd.source === "claude-code" ? `(${cmd.source}) ` : "";
      descEl.textContent = `${sourceTag}${cmd.description}`;

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

  function selectCmd(cmd: SkillInfo): void {
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

  // ── Send handler (with slash command support) ──
  inputController.setOnSend(async (text: string) => {
    hideCmdDropdown();

    // Check for slash command
    if (text.startsWith("/")) {
      const parts = text.match(/^\/(\S+)\s*(.*)/);
      if (parts) {
        const cmdName = parts[1];
        const cmdArgs = parts[2] || "";

        // Check built-in Clautero commands first
        const builtIn = BUILT_IN_COMMANDS.find(c => c.name === cmdName);
        if (builtIn) {
          if (builtIn.type === "action") {
            builtIn.execute(cmdArgs, {
              currentContext,
              clearConversation: () => {
                const btns = sessionBar.querySelectorAll("button");
                for (const b of Array.from(btns)) {
                  if (b.getAttribute("title") === "New conversation") {
                    (b as HTMLElement).click();
                    break;
                  }
                }
              },
            });
            return;
          }
          // Prompt type — expand to full prompt
          const expanded = builtIn.execute(cmdArgs, { currentContext, clearConversation: () => {} });
          if (expanded) {
            text = expanded;
          }
        }
        // For Claude Code skills (/skill-name), send as-is — Claude CLI handles it
      }
    }
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
      const provider = getProvider(session.providerId);
      // Resolve CLI path (may throw if not installed/configured)
      let cliPath: string;
      try {
        cliPath = await resolveProviderCLIPath(provider);
      } catch (pathError) {
        // Show inline setup prompt
        showSetupPrompt(session, doc, provider);
        inputController.setDisabled(false);
        return;
      }

      session.service = createClauteroService({
        cwd: addon.workspaceDir,
        cliPath,
        provider,
        getSettings: () => ({ model: session.model || undefined }),
        onChunk: (chunk: StreamChunk) => {
          session.streamController.handleChunk(chunk);

          // Track the Claude session id for --resume and layout persistence
          if (chunk.type === "system" || chunk.type === "result") {
            const meta = chunk.metadata ?? {};
            const sid = typeof meta.session_id === "string" ? meta.session_id : null;
            if (sid && sid !== session.claudeSessionId) {
              session.claudeSessionId = sid;
              scheduleLayoutSave();
            }
            if (typeof meta.model === "string" && session.id === activeSessionId) {
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
            session.status = chunk.type === "error" ? "error" : "idle";
            if (session.pendingModelChange) {
              // A model change arrived mid-turn: cool now so the next
              // message respawns with the new model.
              session.pendingModelChange = false;
              void session.service?.interrupt();
            }
            updateSessionBar();
            syncInputToActiveSession();
            if (session.id === activeSessionId) {
              inputController.focus();
            }
            // Auto-save session after each response
            saveSessionToHistory(session);
          }
        },
        onError: (error: Error) => {
          session.status = "error";
          updateSessionBar();
          session.renderer.appendTextChunk(`\nError: ${error.message}`);
          session.renderer.finishAssistantMessage();
          syncInputToActiveSession();
        },
      });
      cleanupList.push(() => session.service?.cleanup());
    }

    // Start session if needed
    try {
      await warmPool.acquire(warmOwnerFor(session));
      if (session.service.getState() !== "active") {
        if (session.claudeSessionId) {
          await session.service.resumeSession(session.claudeSessionId);
        } else {
          await session.service.startSession();
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const prefix = e instanceof WarmCapacityError ? "" : "Could not start Claude. ";
      session.renderer.appendTextChunk(`Error: ${prefix}${msg}`);
      session.renderer.finishAssistantMessage();
      syncInputToActiveSession();
      return;
    }

    // Send
    session.status = "streaming";
    updateSessionBar();
    inputController.setDisabled(true);
    session.streamController.startStream();
    try {
      const full = currentContext ? `${currentContext}\n\n${text}` : text;
      session.service.sendMessage(full);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      session.status = "error";
      updateSessionBar();
      session.renderer.appendTextChunk(`Error: ${msg}`);
      session.renderer.finishAssistantMessage();
      syncInputToActiveSession();
    }
  });

  Zotero.log("[Clautero] Chat system initialized (unlimited tabs, warm-pool subprocesses)", "info");
}

export function createHooks(addon: Addon): Hooks {
  const windowStates = new Map<Window, { cleanup: Array<() => void> }>();

  return {
    async onStartup() {
      try {
        await addon.ensureDirectories();
      } catch (e) {
        Zotero.log(`[Clautero] Directory setup warning: ${e}`, "warning");
        // Non-fatal — continue startup
      }
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
