/**
 * PopupMenu — a small anchored selection menu for the status-bar controls
 * (provider / model / thinking effort), replacing click-to-cycle labels.
 *
 * Opens above its anchor (the status bar sits at the panel bottom), closes
 * on selection, click-away, or Escape. Only one popup exists at a time;
 * clicking the same anchor again toggles it closed.
 */

const XHTML_NS = "http://www.w3.org/1999/xhtml";

export interface PopupMenuItem {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly selected?: boolean;
  readonly disabled?: boolean;
}

let activeCleanup: (() => void) | null = null;
let activeAnchor: HTMLElement | null = null;

export function closeActivePopup(): void {
  activeCleanup?.();
}

export function showPopupMenu(
  doc: Document,
  anchor: HTMLElement,
  items: readonly PopupMenuItem[],
  onSelect: (value: string) => void
): void {
  const reopeningSameAnchor = activeAnchor === anchor;
  closeActivePopup();
  if (reopeningSameAnchor) return; // toggle off

  const win = doc.defaultView as Window;
  const menu = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  menu.className = "clautero-popup-menu";
  const rect = anchor.getBoundingClientRect();
  menu.style.cssText = `
    position:fixed;left:${Math.max(4, rect.left)}px;
    bottom:${Math.max(4, win.innerHeight - rect.top + 6)}px;
    background:#fff;border:1px solid #e0e0e0;border-radius:8px;
    box-shadow:0 4px 16px rgba(0,0,0,0.12);padding:4px;
    min-width:170px;max-height:260px;overflow-y:auto;z-index:10000;
    font-size:13px;color:#333;
  `;

  for (const item of items) {
    const row = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    row.className = "clautero-popup-item";
    row.style.cssText = `
      display:flex;flex-direction:column;gap:1px;
      padding:6px 10px;border-radius:5px;
      ${item.disabled ? "color:#bbb;cursor:default;" : "cursor:pointer;"}
    `;

    const labelRow = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    labelRow.style.cssText = "display:flex;align-items:center;gap:6px;";
    const check = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    check.style.cssText = "width:14px;color:#c47a4a;flex-shrink:0;";
    check.appendChild(doc.createTextNode(item.selected ? "✓" : ""));
    const label = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    label.style.cssText = `font-weight:${item.selected ? "600" : "400"};`;
    label.appendChild(doc.createTextNode(item.label));
    labelRow.appendChild(check);
    labelRow.appendChild(label);
    row.appendChild(labelRow);

    if (item.description) {
      const desc = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
      desc.style.cssText = "font-size:11px;color:#999;padding-left:20px;";
      desc.appendChild(doc.createTextNode(item.description));
      row.appendChild(desc);
    }

    if (!item.disabled) {
      row.addEventListener("mouseenter", () => { row.style.background = "#f4f4f4"; });
      row.addEventListener("mouseleave", () => { row.style.background = ""; });
      row.addEventListener("click", (e: Event) => {
        e.stopPropagation();
        cleanup();
        onSelect(item.value);
      });
    }

    menu.appendChild(row);
  }

  (anchor.parentElement ?? doc.documentElement).appendChild(menu);

  function onDocClick(e: Event): void {
    const target = e.target as Node;
    // The opening click is still mid-dispatch when this listener attaches —
    // ignore anything inside the menu or on the anchor itself.
    if (menu.contains(target) || anchor.contains(target)) return;
    cleanup();
  }

  function onKeydown(e: Event): void {
    if ((e as KeyboardEvent).key === "Escape") {
      e.stopPropagation();
      cleanup();
    }
  }

  function cleanup(): void {
    doc.removeEventListener("click", onDocClick, true);
    doc.removeEventListener("keydown", onKeydown, true);
    menu.remove();
    if (activeCleanup === cleanup) {
      activeCleanup = null;
      activeAnchor = null;
    }
  }

  doc.addEventListener("click", onDocClick, true);
  doc.addEventListener("keydown", onKeydown, true);
  activeCleanup = cleanup;
  activeAnchor = anchor;
}
