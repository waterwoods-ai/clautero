import { Addon } from "./addon";

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
    // Will be populated by Unit 2 (SidebarManager) and Unit 3 (ClauteroService)
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

      // Unit 2 will add: SidebarManager initialization
      // Unit 3 will add: ClauteroService initialization

      Zotero.log("[Clautero] Main window loaded", "info");
    },

    onMainWindowUnload(window: Window) {
      const state = windowStates.get(window);
      if (state) {
        for (const cleanup of state.cleanup) {
          cleanup();
        }
        windowStates.delete(window);
      }
      Zotero.log("[Clautero] Main window unloaded", "info");
    },
  };
}
