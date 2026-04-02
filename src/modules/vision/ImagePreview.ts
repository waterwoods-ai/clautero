/**
 * ImagePreview — Shows thumbnail preview chips for attached images.
 *
 * Renders removable chips in a container element, each displaying a
 * filename and an X button. Deletes temp files on removal.
 */

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const MAX_IMAGES = 5;

interface ImagePreviewApi {
  addImage(path: string): void;
  removeImage(path: string): void;
  getImagePaths(): string[];
  clear(): void;
  cleanup(): void;
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

function extractFilename(path: string): string {
  const parts = path.split("/");
  const name = parts.pop() || path.split("\\").pop() || "image";
  // Strip the timestamp prefix (digits followed by dash)
  return name.replace(/^\d+-/, "");
}

function clearContainer(container: HTMLElement): void {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

function buildChipElement(
  doc: Document,
  filename: string,
  onRemove: () => void
): HTMLElement {
  const chip = createHtmlEl(doc, "span", {
    class: "clautero-image-chip",
  });

  const label = createHtmlEl(doc, "span");
  label.textContent = filename;
  chip.appendChild(label);

  const removeBtn = createHtmlEl(doc, "button", {
    class: "clautero-image-chip-remove",
    "aria-label": `Remove ${filename}`,
  });
  removeBtn.textContent = "\u00D7";
  removeBtn.addEventListener("click", onRemove);
  chip.appendChild(removeBtn);

  return chip;
}

async function deleteFile(path: string): Promise<void> {
  try {
    await IOUtils.remove(path, { ignoreAbsent: true });
  } catch (err) {
    Zotero.log(`[Clautero] Failed to delete image: ${err}`, "warning");
  }
}

export function createImagePreview(
  container: HTMLElement,
  doc: Document
): ImagePreviewApi {
  let imagePaths: readonly string[] = Object.freeze([]);

  const chipsContainer = createHtmlEl(doc, "div", {
    class: "clautero-image-chips",
  });
  container.parentNode?.insertBefore(chipsContainer, container);

  function render(): void {
    clearContainer(chipsContainer);
    if (imagePaths.length === 0) {
      chipsContainer.setAttribute("hidden", "true");
      return;
    }
    chipsContainer.removeAttribute("hidden");
    for (const path of imagePaths) {
      const filename = extractFilename(path);
      const chip = buildChipElement(doc, filename, () => removeImage(path));
      chipsContainer.appendChild(chip);
    }
  }

  function addImage(path: string): void {
    if (imagePaths.includes(path)) {
      return;
    }
    if (imagePaths.length >= MAX_IMAGES) {
      Zotero.log("[Clautero] Max images reached (5)", "warning");
      return;
    }
    imagePaths = Object.freeze([...imagePaths, path]);
    render();
  }

  function removeImage(path: string): void {
    if (!imagePaths.includes(path)) {
      return;
    }
    imagePaths = Object.freeze(imagePaths.filter((p) => p !== path));
    render();
    deleteFile(path);
  }

  function getImagePaths(): string[] {
    return [...imagePaths];
  }

  function clear(): void {
    const toDelete = [...imagePaths];
    imagePaths = Object.freeze([]);
    render();
    for (const path of toDelete) {
      deleteFile(path);
    }
  }

  function cleanup(): void {
    clear();
    chipsContainer.parentNode?.removeChild(chipsContainer);
  }

  // Initial state
  chipsContainer.setAttribute("hidden", "true");

  return { addImage, removeImage, getImagePaths, clear, cleanup };
}
