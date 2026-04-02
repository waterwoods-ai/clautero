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

function createXUL(doc: Document, tag: string): Element {
  if ("createXULElement" in doc) {
    return (doc as any).createXULElement(tag);
  }
  return doc.createElementNS(
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    tag
  );
}

function addToolsMenuItem(doc: Document, onToggle: () => void): Element {
  const menuItem = createXUL(doc, "menuitem");
  menuItem.setAttribute("id", "clautero-tools-menu-item");
  menuItem.setAttribute("label", "Clautero Sidebar");
  menuItem.setAttribute("accesskey", "L");
  menuItem.addEventListener("command", onToggle);

  // Try multiple known menu popup IDs across Zotero versions
  const menuPopup = doc.getElementById("menu_ToolsPopup")
    ?? doc.getElementById("menu_toolsPopup")
    ?? doc.querySelector("#menu_Tools menupopup")
    ?? doc.querySelector("#menu_tools menupopup")
    ?? doc.querySelector("menupopup[id*='ools']");

  if (menuPopup) {
    menuPopup.appendChild(menuItem);
    Zotero.log(`[Clautero] Tools menu item added to: ${menuPopup.id || "menupopup"}`, "info");
  } else {
    // Fallback: log all menu IDs for debugging
    const allMenus = doc.querySelectorAll("menupopup");
    const ids = Array.from(allMenus).map(m => m.id || "(no id)").join(", ");
    Zotero.log(`[Clautero] Could not find Tools menu. Available menupopups: ${ids}`, "warning");
  }

  return menuItem;
}

function createToolbarButton(doc: Document, onToggle: () => void): Element {
  const button = createXUL(doc, "toolbarbutton");
  button.setAttribute("id", "clautero-toolbar-button");
  button.setAttribute("class", "zotero-tb-button");
  button.setAttribute("tooltiptext", "Toggle Clautero sidebar (Ctrl+Shift+C)");
  button.setAttribute("label", "C");
  button.setAttribute("type", "button");
  button.addEventListener("command", onToggle);

  // Try multiple toolbar locations for Zotero 7 compatibility
  const toolbar = doc.getElementById("zotero-tb-advanced")?.parentElement
    ?? doc.getElementById("zotero-items-toolbar")
    ?? doc.getElementById("zotero-toolbar")
    ?? doc.querySelector("#navigator-toolbox toolbar")
    ?? doc.querySelector("toolbar");

  if (toolbar) {
    toolbar.appendChild(button);
    Zotero.log(`[Clautero] Toolbar button added to: ${toolbar.id || toolbar.tagName}`, "info");
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

  // Register Tools menu item (most reliable entry point)
  const menuItem = addToolsMenuItem(window.document, toggle);

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

  // Auto-show sidebar on initialization so user can see it immediately
  try {
    show();
    Zotero.log("[Clautero] Sidebar auto-shown", "info");
  } catch (error) {
    Zotero.log(`[Clautero] Failed to auto-show sidebar: ${error}`, "error");
  }

  // Return cleanup function
  return () => {
    try {
      hide();
      removeShortcut();
      toolbarButton.remove();
      menuItem.remove();
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
