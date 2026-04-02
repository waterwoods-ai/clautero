import { Addon } from "./addon";
import { initSidebarManager } from "./modules/sidebar/SidebarManager";
import { createChatState, addMessage } from "./modules/chat/ChatState";
import type { ChatStateData } from "./modules/chat/ChatState";
import { createInputController } from "./modules/chat/InputController";
import { createStreamController } from "./modules/chat/StreamController";
import { createMessageRenderer } from "./modules/chat/MessageRenderer";
import { createClauteroService } from "./core/agent/ClauteroService";
import type { StreamChunk } from "./core/agent/types";
import { createContextChipsView } from "./modules/context/ContextChipsView";

export interface Hooks {
  onStartup(): Promise<void>;
  onShutdown(): void;
  onMainWindowLoad(window: Window): void;
  onMainWindowUnload(window: Window): void;
}

function resolveCliPath(): string {
  const pref = Zotero.Prefs.get("extensions.clautero.cliPath", true) as string;
  return pref || "claude";
}

function isAutoAttachEnabled(): boolean {
  try {
    const pref = Zotero.Prefs.get(
      "extensions.clautero.autoAttachContext",
      true
    );
    return pref !== false;
  } catch {
    return true;
  }
}

function getSelectedItem(): Zotero.Item | null {
  try {
    const pane = Zotero.getActiveZoteroPane();
    if (!pane) {
      return null;
    }
    const items = pane.getSelectedItems();
    if (!items || items.length === 0) {
      return null;
    }
    // Use first selected regular item (not attachments/notes)
    const regularItem = items.find(
      (item: Zotero.Item) =>
        item.itemType !== "attachment" && item.itemType !== "note"
    );
    return regularItem || null;
  } catch {
    return null;
  }
}

function initContextIntegration(
  win: Window,
  contextBar: HTMLElement,
  onContextChange: (context: string) => void,
  cleanupList: Array<() => void>
): void {
  const chipsView = createContextChipsView(contextBar, win.document);
  chipsView.setOnChange(onContextChange);
  cleanupList.push(() => chipsView.cleanup());

  if (!isAutoAttachEnabled()) {
    Zotero.log("[Clautero] Auto-attach context disabled", "info");
    return;
  }

  // Attach context for initially selected item
  const initialItem = getSelectedItem();
  if (initialItem) {
    chipsView.update(initialItem);
  }

  // Register notifier for selection changes
  const notifierID = Zotero.Notifier.registerObserver(
    {
      notify: (
        event: string,
        type: string,
        _ids: number[],
        _extraData: Record<string, unknown>
      ) => {
        if (type === "item" && (event === "select" || event === "modify")) {
          if (!isAutoAttachEnabled()) {
            return;
          }
          const selected = getSelectedItem();
          chipsView.update(selected);
        }
      },
    },
    ["item"],
    "clautero"
  );

  cleanupList.push(() => {
    try {
      Zotero.Notifier.unregisterObserver(notifierID);
    } catch (error) {
      Zotero.log(
        `[Clautero] Failed to unregister notifier: ${error}`,
        "warning"
      );
    }
  });

  Zotero.log("[Clautero] Context integration initialized", "info");
}

function initChatSystem(
  win: Window,
  addon: Addon,
  cleanupList: Array<() => void>
): void {
  const sidebar = (win as any).__clauteroSidebar;
  if (!sidebar) {
    Zotero.log("[Clautero] Sidebar not available for chat init", "warning");
    return;
  }

  const elements = sidebar.getElements();
  if (!elements) {
    Zotero.log("[Clautero] Sidebar elements not ready for chat init", "warning");
    return;
  }

  const { messageArea, textarea, sendButton, contextBar } = elements;

  // Mutable holder for immutable state
  let chatState = createChatState();
  const getState = (): ChatStateData => chatState;
  const setChatState = (next: ChatStateData): void => {
    chatState = next;
  };

  const renderer = createMessageRenderer(messageArea);
  cleanupList.push(() => renderer.cleanup());

  const inputController = createInputController(textarea, sendButton);
  cleanupList.push(() => inputController.cleanup());

  // Initialize context integration
  let currentContext = "";
  initContextIntegration(
    win,
    contextBar,
    (context: string) => {
      currentContext = context;
      inputController.hooks.onContextChange(context);
    },
    cleanupList
  );

  const streamController = createStreamController(renderer, getState, setChatState);
  cleanupList.push(() => streamController.cleanup());

  const service = createClauteroService({
    cwd: addon.workspaceDir,
    cliPath: resolveCliPath(),
    onChunk: (chunk: StreamChunk) => {
      streamController.handleChunk(chunk);
      // Re-enable input when assistant turn completes
      if (chunk.type === "result" || chunk.type === "error") {
        inputController.setDisabled(false);
        inputController.focus();
      }
    },
    onError: (error: Error) => {
      Zotero.log(`[Clautero] Service error: ${error.message}`, "error");
      inputController.setDisabled(false);
    },
  });
  cleanupList.push(() => service.cleanup());

  inputController.setOnSend(async (text: string) => {
    try {
      chatState = addMessage(chatState, {
        role: "user",
        content: text,
        chunks: [],
        timestamp: Date.now(),
      });
      renderer.renderUserMessage(text);

      if (service.getState() !== "active") {
        await service.startSession();
      }

      inputController.setDisabled(true);
      streamController.startStream();

      const messageWithContext = currentContext
        ? `${currentContext}\n\n${text}`
        : text;
      service.sendMessage(messageWithContext);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Zotero.log(`[Clautero] Send error: ${msg}`, "error");
      inputController.setDisabled(false);
    }
  });

  Zotero.log("[Clautero] Chat system initialized", "info");
}

export function createHooks(addon: Addon): Hooks {
  // Track per-window state for cleanup
  const windowStates = new Map<Window, WindowState>();

  interface WindowState {
    // Cleanup functions for sidebar, services, etc.
    cleanup: Array<() => void>;
  }

  return {
    async onStartup() {
      await addon.ensureDirectories();
      Zotero.log("[Clautero] Plugin started", "info");
    },

    onShutdown() {
      // Clean up all windows
      for (const [_window, state] of windowStates) {
        for (const cleanup of state.cleanup) {
          cleanup();
        }
      }
      windowStates.clear();
      Zotero.log("[Clautero] Plugin shut down", "info");
    },

    onMainWindowLoad(window: Window) {
      const state: WindowState = { cleanup: [] };
      windowStates.set(window, state);

      // Initialize sidebar panel
      try {
        const sidebarCleanup = initSidebarManager(window, addon.rootURI);
        state.cleanup.push(sidebarCleanup);
        Zotero.log("[Clautero] Sidebar manager initialized", "info");
      } catch (error) {
        Zotero.log(`[Clautero] Failed to initialize sidebar: ${error}`, "error");
      }

      // Initialize chat system (after sidebar is ready)
      try {
        initChatSystem(window, addon, state.cleanup);
      } catch (error) {
        Zotero.log(`[Clautero] Failed to initialize chat system: ${error}`, "error");
      }

      Zotero.log("[Clautero] Main window loaded", "info");
    },

    onMainWindowUnload(window: Window) {
      const state = windowStates.get(window);
      if (state) {
        for (const cleanup of state.cleanup) {
          try {
            cleanup();
          } catch (error) {
            Zotero.log(`[Clautero] Cleanup error: ${error}`, "warning");
          }
        }
        windowStates.delete(window);
      }
      Zotero.log("[Clautero] Main window unloaded", "info");
    },
  };
}
