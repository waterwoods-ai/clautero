/**
 * ContextChipsView — Renders context chips above the input area.
 * Supports both single items and collections (folders).
 */

import { buildContext, buildCollectionContext } from "./ContextBuilder";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

interface ChipsViewState {
  readonly item: Zotero.Item | null;
  readonly collection: Zotero.Collection | null;
  readonly context: string;
}

function createHtmlEl<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Readonly<Record<string, string>> = {}
): HTMLElementTagNameMap[K] {
  const el = doc.createElementNS(XHTML_NS, tag) as HTMLElementTagNameMap[K];
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

function getPdfFilename(item: Zotero.Item): string {
  try {
    const attachmentIds = item.getAttachments();
    for (const id of attachmentIds) {
      const attachment = Zotero.Items.get(id);
      if (attachment?.attachmentContentType === "application/pdf") {
        const path = attachment.getFilePath?.();
        if (typeof path === "string" && path.length > 0) {
          return path.split("/").pop() || "file.pdf";
        }
        return attachment.getField?.("title") as string || "file.pdf";
      }
    }
  } catch { /* ignore */ }
  return "";
}

function countAnnotations(item: Zotero.Item): number {
  try {
    const attachmentIds = item.getAttachments();
    let count = 0;
    for (const id of attachmentIds) {
      const attachment = Zotero.Items.get(id);
      if (attachment?.attachmentContentType === "application/pdf") {
        const annotations = attachment.getAnnotations?.();
        if (annotations) count += annotations.length;
      }
    }
    return count;
  } catch { return 0; }
}

function buildChipElement(
  doc: Document,
  label: string,
  icon: string,
  onRemove: () => void
): HTMLElement {
  const chip = createHtmlEl(doc, "span", { class: "clautero-context-chip" });
  chip.style.cssText = `
    display:inline-flex;align-items:center;gap:4px;
    background:#f0f0f0;border-radius:12px;padding:3px 6px 3px 10px;
    font-size:12px;color:#555;margin:2px 4px 2px 0;
  `;

  const labelSpan = createHtmlEl(doc, "span", {});
  labelSpan.textContent = `${icon} ${label}`;
  chip.appendChild(labelSpan);

  const removeBtn = createHtmlEl(doc, "button", { "aria-label": `Remove ${label}` });
  removeBtn.style.cssText = `
    background:none;border:none;font-size:14px;cursor:pointer;
    color:#999;padding:0 2px;line-height:1;
  `;
  removeBtn.textContent = "\u00D7";
  removeBtn.addEventListener("click", onRemove);
  chip.appendChild(removeBtn);

  return chip;
}

function clearContainer(container: HTMLElement): void {
  while (container.firstChild) container.removeChild(container.firstChild);
}

export function createContextChipsView(
  contextBar: HTMLElement,
  document: Document
) {
  let state: ChipsViewState = Object.freeze({
    item: null, collection: null, context: "",
  });
  let onChangeCallback: ((context: string) => void) | null = null;

  function setOnChange(cb: (context: string) => void): void {
    onChangeCallback = cb;
  }

  function renderChips(): void {
    clearContainer(contextBar);
    const { item, collection } = state;

    if (!item && !collection) {
      contextBar.setAttribute("hidden", "true");
      return;
    }

    contextBar.removeAttribute("hidden");

    if (collection) {
      // Collection chip
      const itemCount = collection.getChildItems().filter(
        (i: Zotero.Item) => i.isRegularItem()
      ).length;
      const label = `${collection.name} (${itemCount} papers)`;
      const chip = buildChipElement(document, label, "\uD83D\uDCC1", handleRemove);
      contextBar.appendChild(chip);
      return;
    }

    if (item) {
      const pdfName = getPdfFilename(item);
      if (pdfName) {
        const chip = buildChipElement(document, pdfName, "\uD83D\uDCC4", handleRemove);
        contextBar.appendChild(chip);
      }

      const annotationCount = countAnnotations(item);
      if (annotationCount > 0) {
        const label = `${annotationCount} annotation${annotationCount === 1 ? "" : "s"}`;
        const chip = buildChipElement(document, label, "\uD83D\uDCDD", handleRemove);
        contextBar.appendChild(chip);
      }

      if (!pdfName && annotationCount === 0) {
        const title = (item.getField?.("title") as string) || "Item";
        const chip = buildChipElement(document, title, "\uD83D\uDCC4", handleRemove);
        contextBar.appendChild(chip);
      }
    }
  }

  function handleRemove(): void {
    state = Object.freeze({ item: null, collection: null, context: "" });
    renderChips();
    onChangeCallback?.("");
  }

  async function update(item: Zotero.Item | null): Promise<void> {
    if (!item) {
      state = Object.freeze({ item: null, collection: null, context: "" });
      renderChips();
      onChangeCallback?.("");
      return;
    }

    try {
      const context = await buildContext(item);
      state = Object.freeze({ item, collection: null, context });
      renderChips();
      onChangeCallback?.(context);
    } catch (error) {
      Zotero.log(`[Clautero] Failed to update item context: ${error}`, "warning");
    }
  }

  async function updateCollection(collection: Zotero.Collection | null): Promise<void> {
    if (!collection) {
      state = Object.freeze({ item: null, collection: null, context: "" });
      renderChips();
      onChangeCallback?.("");
      return;
    }

    try {
      const context = await buildCollectionContext(collection);
      state = Object.freeze({ item: null, collection, context });
      renderChips();
      onChangeCallback?.(context);
    } catch (error) {
      Zotero.log(`[Clautero] Failed to update collection context: ${error}`, "warning");
    }
  }

  function getContext(): string {
    return state.context;
  }

  function cleanup(): void {
    clearContainer(contextBar);
    state = Object.freeze({ item: null, collection: null, context: "" });
    onChangeCallback = null;
  }

  contextBar.setAttribute("hidden", "true");

  return Object.freeze({ update, updateCollection, getContext, cleanup, setOnChange });
}
