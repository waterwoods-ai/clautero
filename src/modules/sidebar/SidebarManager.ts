/**
 * SidebarManager — Manages sidebar lifecycle, visibility, toolbar button,
 * and keyboard shortcut registration for the Clautero sidebar panel.
 */

import { createSidebarDOM } from "./SidebarDOM";

const PREF_SIDEBAR_WIDTH = "extensions.clautero.sidebarWidth";
const DEFAULT_WIDTH = 400;

interface SidebarState {
  readonly visible: boolean;
  readonly width: number;
}

function readWidth(): number {
  try {
    const width = Zotero.Prefs.get(PREF_SIDEBAR_WIDTH, true) as number;
    return typeof width === "number" && width > 0 ? width : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function persistWidth(width: number): void {
  try {
    Zotero.Prefs.set(PREF_SIDEBAR_WIDTH, width, true);
  } catch (error) {
    Zotero.log(`[Clautero] Failed to persist sidebar width: ${error}`, "warning");
  }
}

function createToolbarButton(doc: Document, onToggle: () => void): Element {
  const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  const button = doc.createElementNS(XUL_NS, "toolbarbutton");
  button.setAttribute("id", "clautero-toolbar-button");
  button.setAttribute("class", "zotero-tb-button");
  button.setAttribute("tooltiptext", "Toggle Clautero sidebar (Ctrl+Shift+C)");
  button.setAttribute("label", "Clautero");
  button.addEventListener("command", onToggle);

  const toolbar = doc.getElementById("zotero-items-toolbar")
    ?? doc.querySelector("toolbar");
  if (toolbar) {
    toolbar.appendChild(button);
  } else {
    Zotero.log("[Clautero] Could not find toolbar for button injection", "warning");
  }

  return button;
}

function registerKeyboardShortcut(
  window: Window,
  onToggle: () => void
): () => void {
  const handler = (event: KeyboardEvent) => {
    const isMac = Zotero.isMac ?? navigator.platform.includes("Mac");
    const modifier = isMac ? event.metaKey : event.ctrlKey;
    if (modifier && event.shiftKey && event.key === "C") {
      event.preventDefault();
      event.stopPropagation();
      onToggle();
    }
  };
  window.addEventListener("keydown", handler, true);
  return () => window.removeEventListener("keydown", handler, true);
}

/**
 * Initializes the sidebar manager for a given window.
 * Returns a cleanup function to be called on window unload.
 */
export function initSidebarManager(
  window: Window,
  rootURI: string
): () => void {
  let state: SidebarState = Object.freeze({
    visible: false,
    width: readWidth(),
  });

  let domCleanup: (() => void) | null = null;
  let sidebarElements: ReturnType<typeof createSidebarDOM>["elements"] | null = null;

  const updateVisibility = () => {
    if (!sidebarElements) {
      return;
    }
    const { splitter, container } = sidebarElements;
    if (state.visible) {
      (splitter as HTMLElement).style.display = "";
      (container as HTMLElement).style.display = "";
    } else {
      // Persist current width before hiding
      const currentWidth = (container as Element).getAttribute("width");
      if (currentWidth) {
        persistWidth(parseInt(currentWidth, 10));
      }
      (splitter as HTMLElement).style.display = "none";
      (container as HTMLElement).style.display = "none";
    }
  };

  const show = () => {
    if (state.visible) {
      return;
    }
    if (!sidebarElements) {
      try {
        const result = createSidebarDOM(window, rootURI, {
          width: state.width,
          onClose: () => hide(),
        });
        sidebarElements = result.elements;
        domCleanup = result.cleanup;
      } catch (error) {
        Zotero.log(`[Clautero] Failed to create sidebar DOM: ${error}`, "error");
        return;
      }
    }
    state = Object.freeze({ ...state, visible: true });
    updateVisibility();
    Zotero.log("[Clautero] Sidebar shown", "info");
  };

  const hide = () => {
    if (!state.visible) {
      return;
    }
    state = Object.freeze({ ...state, visible: false });
    updateVisibility();
    Zotero.log("[Clautero] Sidebar hidden", "info");
  };

  const toggle = () => {
    if (state.visible) {
      hide();
    } else {
      show();
    }
  };

  const isVisible = (): boolean => state.visible;

  // Register toolbar button
  const toolbarButton = createToolbarButton(window.document, toggle);

  // Register keyboard shortcut
  const removeShortcut = registerKeyboardShortcut(window, toggle);

  // Expose public API on the window for other modules
  (window as any).__clauteroSidebar = Object.freeze({
    toggle,
    show,
    hide,
    isVisible,
    getElements: () => sidebarElements,
  });

  // Return cleanup function
  return () => {
    try {
      hide();
      removeShortcut();
      toolbarButton.remove();
      if (domCleanup) {
        domCleanup();
        domCleanup = null;
      }
      sidebarElements = null;
      delete (window as any).__clauteroSidebar;
    } catch (error) {
      Zotero.log(`[Clautero] Error during sidebar cleanup: ${error}`, "warning");
    }
  };
}
