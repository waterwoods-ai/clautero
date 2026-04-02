/**
 * MentionController — Orchestrates @-mention detection, search, and insertion.
 *
 * Detects '@' in the textarea, debounces search queries, displays results
 * in MentionDropdown, and manages mentioned item references for context.
 */

import { search, type SearchResult } from "./ZoteroSearchProvider";
import { createMentionDropdown, type MentionDropdownApi } from "./MentionDropdown";
import { buildContext } from "../context/ContextBuilder";

const DEBOUNCE_MS = 200;

interface MentionedItem {
  readonly id: number;
  readonly title: string;
  readonly type: "item" | "collection";
}

interface MentionState {
  readonly mentionedItems: readonly MentionedItem[];
  readonly mentionStart: number | null;
  readonly active: boolean;
}

function createMentionState(): MentionState {
  return Object.freeze({
    mentionedItems: Object.freeze([]),
    mentionStart: null,
    active: false,
  });
}

function addMentionedItem(
  state: MentionState,
  item: MentionedItem
): MentionState {
  const isDuplicate = state.mentionedItems.some((m) => m.id === item.id && m.type === item.type);
  if (isDuplicate) {
    return state;
  }
  return Object.freeze({
    ...state,
    mentionedItems: Object.freeze([...state.mentionedItems, item]),
  });
}

function extractMentionQuery(
  text: string,
  cursorPos: number
): { query: string; start: number } | null {
  const before = text.slice(0, cursorPos);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) {
    return null;
  }
  const charBeforeAt = atIndex > 0 ? before[atIndex - 1] : " ";
  if (charBeforeAt !== " " && charBeforeAt !== "\n" && atIndex !== 0) {
    return null;
  }
  return { query: before.slice(atIndex + 1), start: atIndex };
}

function insertMentionText(
  textarea: HTMLTextAreaElement,
  mentionStart: number,
  cursorPos: number,
  title: string
): void {
  const before = textarea.value.slice(0, mentionStart);
  const after = textarea.value.slice(cursorPos);
  const mentionText = `@[${title}] `;
  textarea.value = `${before}${mentionText}${after}`;
  const newCursorPos = mentionStart + mentionText.length;
  textarea.setSelectionRange(newCursorPos, newCursorPos);
}

export interface MentionControllerApi {
  getMentionedItems(): readonly MentionedItem[];
  getContext(): Promise<string>;
  handleMentionTrigger(text: string, cursorPos: number): void;
  cleanup(): void;
}

export function createMentionController(
  textarea: HTMLTextAreaElement,
  container: Element,
  doc: Document
): MentionControllerApi {
  let state = createMentionState();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const dropdown: MentionDropdownApi = createMentionDropdown(container, doc);

  function clearDebounce(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function handleSelect(result: SearchResult): void {
    if (state.mentionStart === null) {
      return;
    }
    const cursorPos = textarea.selectionStart ?? textarea.value.length;
    insertMentionText(textarea, state.mentionStart, cursorPos, result.title);

    state = addMentionedItem(
      Object.freeze({ ...state, mentionStart: null, active: false }),
      Object.freeze({ id: result.id, title: result.title, type: result.type })
    );
    dropdown.hide();
  }

  function performSearch(query: string): void {
    clearDebounce();
    debounceTimer = setTimeout(async () => {
      try {
        const results = await search(query);
        if (state.active) {
          dropdown.show(results, handleSelect);
        }
      } catch (error) {
        Zotero.log(`[Clautero] Mention search error: ${error}`, "warning");
      }
    }, DEBOUNCE_MS);
  }

  function handleMentionTrigger(text: string, cursorPos: number): void {
    const mention = extractMentionQuery(text, cursorPos);
    if (!mention) {
      dropdown.hide();
      state = Object.freeze({ ...state, active: false, mentionStart: null });
      return;
    }

    state = Object.freeze({ ...state, active: true, mentionStart: mention.start });
    performSearch(mention.query);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!dropdown.isVisible()) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      dropdown.navigateDown();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      dropdown.navigateUp();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      dropdown.selectCurrent();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      dropdown.hide();
      state = Object.freeze({ ...state, active: false, mentionStart: null });
    }
  }

  // Capture phase so we intercept before InputController
  textarea.addEventListener("keydown", handleKeydown, true);

  async function getContext(): Promise<string> {
    const itemMentions = state.mentionedItems.filter((m) => m.type === "item");
    if (itemMentions.length === 0) {
      return "";
    }
    try {
      const contextParts = await Promise.all(
        itemMentions.map(async (mention) => {
          const item = Zotero.Items.get(mention.id);
          if (!item) {
            return "";
          }
          return buildContext(item);
        })
      );
      return contextParts.filter(Boolean).join("\n\n");
    } catch (error) {
      Zotero.log(`[Clautero] Mention context build error: ${error}`, "warning");
      return "";
    }
  }

  function cleanup(): void {
    clearDebounce();
    textarea.removeEventListener("keydown", handleKeydown, true);
    dropdown.cleanup();
  }

  return {
    getMentionedItems: () => state.mentionedItems,
    getContext,
    handleMentionTrigger,
    cleanup,
  };
}
