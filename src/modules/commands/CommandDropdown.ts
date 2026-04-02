/**
 * CommandDropdown — Floating dropdown for slash command suggestions.
 *
 * Shows available commands when `/` is typed in the input area.
 * Supports keyboard navigation (Up/Down/Enter/Escape) and mouse selection.
 * Uses createElementNS exclusively (never innerHTML).
 */

import type { SlashCommand } from "./builtInCommands";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

interface DropdownState {
  readonly visible: boolean;
  readonly selectedIndex: number;
  readonly items: readonly SlashCommand[];
}

function createInitialState(): DropdownState {
  return Object.freeze({
    visible: false,
    selectedIndex: 0,
    items: [],
  });
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

function clearContainer(el: HTMLElement): void {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

function buildCommandItem(
  doc: Document,
  command: SlashCommand,
  isSelected: boolean,
  onClick: () => void
): HTMLElement {
  const item = createHtmlEl(doc, "div", {
    class: isSelected
      ? "clautero-command-item selected"
      : "clautero-command-item",
    role: "option",
    "aria-selected": String(isSelected),
  });

  const nameSpan = createHtmlEl(doc, "span", {
    class: "clautero-command-name",
  });
  nameSpan.textContent = `/${command.name}`;
  item.appendChild(nameSpan);

  const descSpan = createHtmlEl(doc, "span", {
    class: "clautero-command-desc",
  });
  descSpan.textContent = command.description;
  item.appendChild(descSpan);

  item.addEventListener("click", onClick);

  return item;
}

function renderItems(
  dropdownEl: HTMLElement,
  doc: Document,
  state: DropdownState,
  onSelect: (command: SlashCommand) => void
): void {
  clearContainer(dropdownEl);

  state.items.forEach((cmd, index) => {
    const isSelected = index === state.selectedIndex;
    const item = buildCommandItem(doc, cmd, isSelected, () => onSelect(cmd));
    dropdownEl.appendChild(item);
  });
}

function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  if (index < 0) {
    return length - 1;
  }
  if (index >= length) {
    return 0;
  }
  return index;
}

export function createCommandDropdown(
  container: HTMLElement,
  doc: Document
) {
  let state = createInitialState();
  let onSelectCallback: ((command: SlashCommand) => void) | null = null;

  const dropdownEl = createHtmlEl(doc, "div", {
    class: "clautero-command-dropdown",
    role: "listbox",
    "aria-label": "Slash commands",
  });
  dropdownEl.style.display = "none";
  container.appendChild(dropdownEl);

  function show(
    commands: readonly SlashCommand[],
    onSelect: (command: SlashCommand) => void
  ): void {
    onSelectCallback = onSelect;
    state = Object.freeze({
      visible: true,
      selectedIndex: 0,
      items: commands,
    });
    dropdownEl.style.display = "";
    renderItems(dropdownEl, doc, state, handleSelect);
  }

  function hide(): void {
    state = Object.freeze({
      ...state,
      visible: false,
      items: [],
      selectedIndex: 0,
    });
    dropdownEl.style.display = "none";
    clearContainer(dropdownEl);
    onSelectCallback = null;
  }

  function isVisible(): boolean {
    return state.visible;
  }

  function handleSelect(command: SlashCommand): void {
    onSelectCallback?.(command);
    hide();
  }

  function navigateUp(): void {
    if (!state.visible || state.items.length === 0) {
      return;
    }
    state = Object.freeze({
      ...state,
      selectedIndex: clampIndex(state.selectedIndex - 1, state.items.length),
    });
    renderItems(dropdownEl, doc, state, handleSelect);
  }

  function navigateDown(): void {
    if (!state.visible || state.items.length === 0) {
      return;
    }
    state = Object.freeze({
      ...state,
      selectedIndex: clampIndex(state.selectedIndex + 1, state.items.length),
    });
    renderItems(dropdownEl, doc, state, handleSelect);
  }

  function selectCurrent(): void {
    if (!state.visible || state.items.length === 0) {
      return;
    }
    const selected = state.items[state.selectedIndex];
    if (selected) {
      handleSelect(selected);
    }
  }

  function cleanup(): void {
    hide();
    dropdownEl.remove();
  }

  return Object.freeze({
    show,
    hide,
    isVisible,
    navigateUp,
    navigateDown,
    selectCurrent,
    cleanup,
  });
}
