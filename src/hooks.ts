import { Addon } from "./addon";
import { initSidebarManager } from "./modules/sidebar/SidebarManager";
import { createInputController } from "./modules/chat/InputController";
import { createTabManager } from "./modules/tabs/TabManager";
import { createTabBar } from "./modules/tabs/TabBar";
import { createContextChipsView } from "./modules/context/ContextChipsView";

export interface Hooks {
  onStartup(): Promise<void>;
  onShutdown(): void;
  onMainWindowLoad(window: Window): void;
  onMainWindowUnload(window: Window): void;
}

function resolveCliPath(): string {
  try {
    const pref = Zotero.Prefs.get("extensions.clautero.claudeCliPath", true) as string;
    return pref || "claude";
  } catch {
    return "claude";
  }
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
  // The item pane section renders lazily (when user selects an item).
  // Poll until the sidebar elements are available, then wire up chat.
  let chatInitialized = false;
  const pollInterval = (win as any).setInterval(() => {
    if (chatInitialized) {
      return;
    }
    const sidebar = (win as any).__clauteroSidebar;
    if (!sidebar) {
      return;
    }
    const elements = sidebar.getElements();
    if (!elements) {
      return;
    }
    chatInitialized = true;
    (win as any).clearInterval(pollInterval);
    doInitChat(win, addon, elements, cleanupList);
  }, 500);

  cleanupList.push(() => {
    (win as any).clearInterval(pollInterval);
  });
}

function doInitChat(
  win: Window,
  addon: Addon,
  elements: { messageArea: HTMLElement; textarea: HTMLTextAreaElement; sendButton: HTMLElement; contextBar: HTMLElement },
  cleanupList: Array<() => void>
): void {
  const { messageArea, textarea, sendButton, contextBar } = elements;
  const doc = win.document;

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

  // Create tab manager (handles per-tab state, services, renderers)
  const tabManager = createTabManager({
    doc,
    messageArea,
    cwd: addon.workspaceDir,
    cliPath: resolveCliPath(),
    onInputDisable: (disabled: boolean) => {
      inputController.setDisabled(disabled);
    },
    onInputFocus: () => {
      inputController.focus();
    },
    onError: (error: Error) => {
      Zotero.log(`[Clautero] Service error: ${error.message}`, "error");
    },
    onTabsChanged: () => {
      updateTabBar();
    },
  });
  cleanupList.push(() => tabManager.cleanup());

  // Create tab bar UI (inserted before the message area)
  const tabBarContainer = messageArea.parentElement as HTMLElement;
  const tabBar = createTabBar(tabBarContainer, doc, {
    onSwitch: (id: string) => tabManager.switchTab(id),
    onClose: (id: string) => tabManager.closeTab(id),
    onCreate: () => tabManager.createTab(),
  });
  cleanupList.push(() => tabBar.cleanup());

  // Move the tab bar before the message area
  const barEl = tabBarContainer.querySelector(".clautero-tab-bar");
  if (barEl && messageArea.parentNode) {
    messageArea.parentNode.insertBefore(barEl, messageArea);
  }

  function updateTabBar(): void {
    tabBar.update(tabManager.getTabs(), tabManager.getActiveTabId());
  }

  // Wire up input to active tab
  inputController.setOnSend(async (text: string) => {
    try {
      await tabManager.sendMessage(text, currentContext || undefined);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Zotero.log(`[Clautero] Send error: ${msg}`, "error");
      inputController.setDisabled(false);
    }
  });

  // Restore previous sessions or create initial tab
  tabManager.restoreTabs().catch((error) => {
    Zotero.log(`[Clautero] Tab restore failed: ${error}`, "warning");
  });

  Zotero.log("[Clautero] Chat system with tabs initialized", "info");
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
