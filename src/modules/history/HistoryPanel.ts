/**
 * HistoryPanel — chat-history overlay with search, pin, and inline rename.
 *
 * Search and ordering semantics live in HistoryQuery (pure, tested);
 * this file is DOM only. Extracted from hooks.ts.
 */

import { filterHistory, sortHistory, type HistoryEntry } from "./HistoryQuery";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

export interface HistoryPanelCallbacks {
  readonly loadEntries: () => Promise<readonly HistoryEntry[]>;
  readonly onOpen: (entry: HistoryEntry) => void;
  readonly onTogglePin: (entry: HistoryEntry) => Promise<void>;
  readonly onRename: (entry: HistoryEntry, title: string) => Promise<void>;
}

function el(doc: Document, tag: string, style: string, cls?: string): HTMLElement {
  const node = doc.createElementNS(XHTML_NS, tag) as HTMLElement;
  node.style.cssText = style;
  if (cls) node.className = cls;
  return node;
}

function text(doc: Document, parent: HTMLElement, value: string): void {
  parent.appendChild(doc.createTextNode(value));
}

export function showHistoryPanel(
  doc: Document,
  host: HTMLElement,
  callbacks: HistoryPanelCallbacks
): void {
  // Toggle off if already showing
  const existing = host.querySelector(".clautero-history-panel");
  if (existing) { existing.remove(); return; }

  const panel = el(doc, "div", `
    position:absolute;top:0;left:0;right:0;bottom:0;background:#fff;
    z-index:50;overflow-y:auto;padding:16px;
  `, "clautero-history-panel");
  host.style.position = "relative";
  host.appendChild(panel);

  const title = el(doc, "div", "font-weight:600;font-size:14px;margin-bottom:8px;");
  text(doc, title, "Chat History");
  panel.appendChild(title);

  const closeBtn = el(doc, "button", `
    position:absolute;top:12px;right:12px;background:none;border:none;
    font-size:18px;cursor:pointer;color:#666;
  `);
  text(doc, closeBtn, "×");
  closeBtn.addEventListener("click", () => panel.remove());
  panel.appendChild(closeBtn);

  const search = doc.createElementNS(XHTML_NS, "input") as HTMLInputElement;
  search.type = "text";
  search.placeholder = "Search sessions…";
  search.style.cssText = `
    width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:6px;
    padding:6px 10px;font-size:13px;outline:none;margin-bottom:10px;
  `;
  panel.appendChild(search);

  const list = el(doc, "div", "");
  panel.appendChild(list);

  let allEntries: readonly HistoryEntry[] = [];

  function renderList(): void {
    while (list.firstChild) list.removeChild(list.firstChild);
    const visible = sortHistory(filterHistory(allEntries, search.value));

    if (visible.length === 0) {
      const empty = el(doc, "div", "color:#888;text-align:center;margin:40px 0;");
      text(doc, empty, allEntries.length === 0 ? "No chat history yet" : "No matching sessions");
      list.appendChild(empty);
      return;
    }

    for (const entry of visible) {
      list.appendChild(renderRow(entry));
    }
  }

  function renderRow(entry: HistoryEntry): HTMLElement {
    const row = el(doc, "div", `
      display:flex;justify-content:space-between;align-items:center;gap:6px;
      padding:8px 10px;margin:2px 0;border-radius:6px;cursor:pointer;
      border:1px solid #eee;
    `);
    row.addEventListener("mouseenter", () => { row.style.background = "#f5f5f5"; });
    row.addEventListener("mouseleave", () => { row.style.background = ""; });

    const info = el(doc, "div", "flex:1;min-width:0;");
    const titleRow = el(doc, "div", "font-weight:500;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;");
    text(doc, titleRow, entry.title);
    const dateRow = el(doc, "div", "font-size:11px;color:#888;margin-top:2px;");
    text(doc, dateRow, new Date(entry.created).toLocaleString());
    info.appendChild(titleRow);
    info.appendChild(dateRow);
    info.addEventListener("click", () => {
      panel.remove();
      callbacks.onOpen(entry);
    });
    row.appendChild(info);

    function iconBtn(label: string, symbol: string): HTMLElement {
      const btn = el(doc, "button", `
        border:none;background:transparent;cursor:pointer;font-size:13px;
        color:#999;padding:2px 4px;flex-shrink:0;
      `);
      btn.setAttribute("title", label);
      text(doc, btn, symbol);
      return btn;
    }

    const pinBtn = iconBtn(entry.pinned ? "Unpin" : "Pin", entry.pinned ? "★" : "☆");
    if (entry.pinned) pinBtn.style.color = "#c47a4a";
    pinBtn.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      void callbacks.onTogglePin(entry).then(refresh);
    });
    row.appendChild(pinBtn);

    const renameBtn = iconBtn("Rename", "✎");
    renameBtn.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      startInlineRename(entry, titleRow);
    });
    row.appendChild(renameBtn);

    return row;
  }

  function startInlineRename(entry: HistoryEntry, titleRow: HTMLElement): void {
    const input = doc.createElementNS(XHTML_NS, "input") as HTMLInputElement;
    input.type = "text";
    input.value = entry.title;
    input.style.cssText = `
      width:100%;box-sizing:border-box;border:1px solid #3584e4;border-radius:4px;
      padding:2px 6px;font-size:13px;outline:none;
    `;
    while (titleRow.firstChild) titleRow.removeChild(titleRow.firstChild);
    titleRow.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    function commit(): void {
      if (done) return;
      done = true;
      const next = input.value.trim();
      if (next && next !== entry.title) {
        void callbacks.onRename(entry, next).then(refresh);
      } else {
        refresh();
      }
    }
    function cancel(): void {
      if (done) return;
      done = true;
      refresh();
    }

    input.addEventListener("keydown", (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Enter") { ke.preventDefault(); ke.stopPropagation(); commit(); }
      if (ke.key === "Escape") { ke.preventDefault(); ke.stopPropagation(); cancel(); }
    });
    input.addEventListener("blur", commit);
    input.addEventListener("click", (e: Event) => e.stopPropagation());
  }

  function refresh(): void {
    void callbacks.loadEntries().then((entries) => {
      allEntries = entries;
      renderList();
    });
  }

  search.addEventListener("input", renderList);

  const loading = el(doc, "div", "color:#888;font-style:italic;");
  text(doc, loading, "Loading…");
  list.appendChild(loading);
  refresh();
}
