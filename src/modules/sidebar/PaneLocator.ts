/**
 * PaneLocator — resolves where the Clautero panel should live for the
 * currently selected Zotero tab.
 *
 * Zotero 7–10 have two independent right-hand panes, each with its own
 * `<item-pane-sidenav>` icon strip:
 *
 *   - Library tab → `<item-pane id="zotero-item-pane">` containing
 *     `#zotero-view-item-sidenav`
 *   - Reader / note tabs → `<box id="zotero-context-pane">` containing
 *     `#zotero-context-pane-sidenav`
 *
 * The panel is a single DOM node that is re-parented into whichever pane
 * is active, so chat state survives switching between library and PDF.
 */

export type PaneKind = "library" | "reader";

export interface PaneTarget {
  readonly kind: PaneKind;
  /** The sidenav icon strip the panel sits next to. */
  readonly sidenav: HTMLElement;
  /** The sidenav's parent — the element the panel is inserted into. */
  readonly host: HTMLElement;
}

const SIDENAV_TAG = "item-pane-sidenav";
const LIBRARY_SIDENAV_ID = "zotero-view-item-sidenav";
const LIBRARY_PANE_ID = "zotero-item-pane";
const CONTEXT_SIDENAV_ID = "zotero-context-pane-sidenav";
const CONTEXT_PANE_ID = "zotero-context-pane";

function tabsOf(win: Window): { selectedType?: string; selectedID?: string } | undefined {
  return (win as any).Zotero_Tabs;
}

/** Selected tab type ("library", "reader", "note", ...). Defaults to "library". */
export function getActiveTabType(win: Window): string {
  return tabsOf(win)?.selectedType ?? "library";
}

/** Every sidenav strip in the window, in document order. */
export function findAllSidenavs(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll(SIDENAV_TAG)) as HTMLElement[];
}

function findLibrarySidenav(doc: Document): HTMLElement | null {
  return (doc.getElementById(LIBRARY_SIDENAV_ID)
    ?? doc.querySelector(`#${LIBRARY_PANE_ID} ${SIDENAV_TAG}`)
    ?? findAllSidenavs(doc).find((s) => !s.closest(`#${CONTEXT_PANE_ID}`))
    ?? null) as HTMLElement | null;
}

function findContextSidenav(doc: Document): HTMLElement | null {
  return (doc.getElementById(CONTEXT_SIDENAV_ID)
    ?? doc.querySelector(`#${CONTEXT_PANE_ID} ${SIDENAV_TAG}`)
    ?? null) as HTMLElement | null;
}

/** Locate the pane of the requested kind, or null if Zotero hasn't built it. */
export function findPaneTarget(doc: Document, kind: PaneKind): PaneTarget | null {
  const sidenav = kind === "library" ? findLibrarySidenav(doc) : findContextSidenav(doc);
  const host = sidenav?.parentElement as HTMLElement | null | undefined;
  if (!sidenav || !host) return null;
  return Object.freeze({ kind, sidenav, host });
}

/**
 * Pane for the active tab. Any non-library tab (reader, note editor) uses the
 * context pane; if that isn't available we fall back to the library pane so
 * the panel always has somewhere to live.
 */
export function findActivePaneTarget(win: Window): PaneTarget | null {
  const doc = win.document;
  const kind: PaneKind = getActiveTabType(win) === "library" ? "library" : "reader";
  return findPaneTarget(doc, kind) ?? findPaneTarget(doc, "library");
}

/**
 * The reader's context pane can be collapsed by the user; when it is, the
 * chat would have zero width. Expand it before showing the panel.
 */
export function ensureContextPaneOpen(win: Window): void {
  if (getActiveTabType(win) === "library") return;
  try {
    const ctx = (win as any).ZoteroContextPane;
    if (ctx && ctx.collapsed) ctx.collapsed = false;
  } catch (e) {
    Zotero.log(`[Clautero] Could not expand context pane: ${e}`, "warning");
  }
}
