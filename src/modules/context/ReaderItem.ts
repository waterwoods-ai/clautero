/**
 * ReaderItem — resolves the paper behind the PDF open in the active reader tab.
 *
 * When a reader tab is selected, `ZoteroPane.getSelectedItems()` still reports
 * whatever is highlighted in the library tree, which may not be the paper the
 * user is reading. The reader instance knows its attachment item; we walk up
 * to the parent so context chips describe the open paper.
 */

/** Minimal view of the Zotero APIs used here (zotero-types omits the reader). */
interface ReaderLookupItem {
  isAttachment(): boolean;
  readonly parentItem?: Zotero.Item;
}

interface ReaderLookupApi {
  Reader: { getByTabID(tabID: string): { itemID?: number } | null | undefined };
  Items: { get(id: number): ReaderLookupItem | null | undefined };
}

function tabsOf(win: Window): { selectedType?: string; selectedID?: string } | undefined {
  return (win as any).Zotero_Tabs;
}

function zoteroApi(): ReaderLookupApi {
  return Zotero as unknown as ReaderLookupApi;
}

/** True when the selected tab in `win` is a PDF/EPUB/snapshot reader. */
export function isReaderTab(win: Window): boolean {
  return tabsOf(win)?.selectedType === "reader";
}

/**
 * The regular (non-attachment) item for the active reader tab, or null when
 * no reader tab is active, the attachment is standalone, or lookup fails.
 */
export function getActiveReaderItem(win: Window): Zotero.Item | null {
  const tabs = tabsOf(win);
  if (!tabs || tabs.selectedType !== "reader" || !tabs.selectedID) return null;

  try {
    const api = zoteroApi();
    const reader = api.Reader.getByTabID(tabs.selectedID);
    const itemID = reader?.itemID;
    if (typeof itemID !== "number") return null;

    const item = api.Items.get(itemID);
    if (!item) return null;
    if (!item.isAttachment()) return item as unknown as Zotero.Item;
    return item.parentItem ?? null;
  } catch (e) {
    Zotero.log(`[Clautero] Could not resolve reader item: ${e}`, "warning");
    return null;
  }
}
