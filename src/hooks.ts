import { Addon } from "./addon";
import { initSidebarManager } from "./modules/sidebar/SidebarManager";
import { createChatState, addMessage } from "./modules/chat/ChatState";
import type { ChatStateData } from "./modules/chat/ChatState";
import { createInputController } from "./modules/chat/InputController";
import { createStreamController } from "./modules/chat/StreamController";
import { createMessageRenderer } from "./modules/chat/MessageRenderer";
import { createClauteroService } from "./core/agent/ClauteroService";
import type { StreamChunk } from "./core/agent/types";

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

  const { messageArea, textarea, sendButton } = elements;

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
      service.sendMessage(text);
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
