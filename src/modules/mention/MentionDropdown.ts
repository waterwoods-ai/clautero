/**
 * MentionDropdown — Floating dropdown UI for @-mention search results.
 *
 * Creates a positioned dropdown that displays matching Zotero items
 * and collections. Supports keyboard and mouse navigation.
 * All DOM is created via createElementNS (no innerHTML).
 */

import type { SearchResult } from "./ZoteroSearchProvider";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

export interface MentionDropdownApi {
  show(results: readonly SearchResult[], onSelect: (result: SearchResult) => void): void;
  hide(): void;
  isVisible(): boolean;
  navigateUp(): void;
  navigateDown(): void;
  selectCurrent(): void;
  cleanup(): void;
}

interface DropdownState {
  readonly selectedIndex: number;
  readonly results: readonly SearchResult[];
  readonly onSelect: ((result: SearchResult) => void) | null;
}

function createState(): DropdownState {
  return Object.freeze({
    selectedIndex: 0,
    results: Object.freeze([]),
    onSelect: null,
  });
}

function createEl(
  doc: Document,
  tag: string,
  className?: string
): HTMLElement {
  const el = doc.createElementNS(XHTML_NS, tag) as HTMLElement;
  if (className) {
    el.setAttribute("class", className);
  }
  return el;
}

function getTypeLabel(result: SearchResult): string {
  if (result.type === "collection") {
    return "[Collection]";
  }
  const sub = result.subtitle ?? "";
  const typePart = sub.split(" - ")[0];
  return typePart ? `[${typePart}]` : "[Item]";
}

function buildResultElement(
  doc: Document,
  result: SearchResult,
  index: number,
  isSelected: boolean,
  onClick: () => void
): HTMLElement {
  const row = createEl(doc, "div", "clautero-mention-item");
  if (isSelected) {
    row.classList.add("selected");
  }
  row.setAttribute("role", "option");
  row.setAttribute("data-index", String(index));

  const typeSpan = createEl(doc, "span", "clautero-mention-type");
  typeSpan.textContent = getTypeLabel(result);
  row.appendChild(typeSpan);

  const titleSpan = createEl(doc, "span", "clautero-mention-title");
  titleSpan.textContent = result.title;
  row.appendChild(titleSpan);

  if (result.subtitle) {
    const subtitleSpan = createEl(doc, "span", "clautero-mention-subtitle");
    subtitleSpan.textContent = result.subtitle;
    row.appendChild(subtitleSpan);
  }

  row.addEventListener("click", onClick);
  return row;
}

function renderResults(
  dropdown: HTMLElement,
  doc: Document,
  state: DropdownState
): void {
  while (dropdown.firstChild) {
    dropdown.removeChild(dropdown.firstChild);
  }

  if (state.results.length === 0) {
    const empty = createEl(doc, "div", "clautero-mention-no-results");
    empty.textContent = "No results found";
    dropdown.appendChild(empty);
    return;
  }

  state.results.forEach((result, index) => {
    const row = buildResultElement(
      doc,
      result,
      index,
      index === state.selectedIndex,
      () => state.onSelect?.(result)
    );
    dropdown.appendChild(row);
  });
}

function updateSelection(dropdown: HTMLElement, index: number): void {
  const items = dropdown.querySelectorAll(".clautero-mention-item");
  items.forEach((item, i) => {
    if (i === index) {
      item.classList.add("selected");
    } else {
      item.classList.remove("selected");
    }
  });
}

export function createMentionDropdown(
  container: Element,
  doc: Document
): MentionDropdownApi {
  const dropdown = createEl(doc, "div", "clautero-mention-dropdown");
  dropdown.setAttribute("role", "listbox");
  dropdown.style.display = "none";
  container.appendChild(dropdown);

  let state = createState();

  function show(
    results: readonly SearchResult[],
    onSelect: (result: SearchResult) => void
  ): void {
    state = Object.freeze({
      selectedIndex: 0,
      results: Object.freeze([...results]),
      onSelect,
    });
    renderResults(dropdown, doc, state);
    dropdown.style.display = "block";
  }

  function hide(): void {
    dropdown.style.display = "none";
    state = createState();
  }

  function isVisible(): boolean {
    return dropdown.style.display !== "none";
  }

  function navigateUp(): void {
    if (state.results.length === 0) {
      return;
    }
    const next = state.selectedIndex > 0
      ? state.selectedIndex - 1
      : state.results.length - 1;
    state = Object.freeze({ ...state, selectedIndex: next });
    updateSelection(dropdown, next);
  }

  function navigateDown(): void {
    if (state.results.length === 0) {
      return;
    }
    const next = state.selectedIndex < state.results.length - 1
      ? state.selectedIndex + 1
      : 0;
    state = Object.freeze({ ...state, selectedIndex: next });
    updateSelection(dropdown, next);
  }

  function selectCurrent(): void {
    if (state.results.length === 0 || !state.onSelect) {
      return;
    }
    const result = state.results[state.selectedIndex];
    if (result) {
      state.onSelect(result);
    }
  }

  function cleanup(): void {
    try {
      dropdown.remove();
    } catch (error) {
      Zotero.log(`[Clautero] Dropdown cleanup error: ${error}`, "warning");
    }
  }

  return { show, hide, isVisible, navigateUp, navigateDown, selectCurrent, cleanup };
}
