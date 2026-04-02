import { Addon } from "./addon";
import { initSidebarManager } from "./modules/sidebar/SidebarManager";

export interface Hooks {
  onStartup(): Promise<void>;
  onShutdown(): void;
  onMainWindowLoad(window: Window): void;
  onMainWindowUnload(window: Window): void;
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

      // Unit 3 will add: ClauteroService initialization

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
