/**
 * InputController — Manages the textarea and send button interactions.
 *
 * Provides keyboard shortcuts (Enter to send, Shift+Enter for newline,
 * Up-arrow for history recall) and extensible hook points for downstream units.
 */

const MAX_HISTORY = 50;

export interface InputHooks {
  onMentionTrigger: (text: string, cursorPos: number) => void;
  onSlashCommandTrigger: (text: string, cursorPos: number) => void;
  onImageDrop: (dataTransfer: DataTransfer) => void;
  onContextChange: (context: string) => void;
}

interface InputState {
  readonly history: readonly string[];
  readonly historyIndex: number;
  readonly disabled: boolean;
}

function createInputState(): InputState {
  return Object.freeze({
    history: Object.freeze([]),
    historyIndex: -1,
    disabled: false,
  });
}

function addToHistory(state: InputState, text: string): InputState {
  const trimmed = text.trim();
  if (!trimmed) {
    return state;
  }
  const filtered = state.history.filter((h) => h !== trimmed);
  const updated = [trimmed, ...filtered].slice(0, MAX_HISTORY);
  return Object.freeze({
    ...state,
    history: Object.freeze(updated),
    historyIndex: -1,
  });
}

export function createInputController(
  textarea: HTMLTextAreaElement,
  sendButton: HTMLElement
) {
  let state = createInputState();
  let onSendCallback: ((text: string) => void) | null = null;

  // Extensible hooks for downstream units (5-8)
  const hooks: InputHooks = {
    onMentionTrigger: () => {},
    onSlashCommandTrigger: () => {},
    onImageDrop: () => {},
    onContextChange: () => {},
  };

  function send(): void {
    if (state.disabled) {
      return;
    }
    const text = textarea.value.trim();
    if (!text) {
      return;
    }
    state = addToHistory(state, text);
    textarea.value = "";
    textarea.style.height = "";
    onSendCallback?.(text);
  }

  function recallHistory(direction: 1 | -1): void {
    const { history, historyIndex } = state;
    if (history.length === 0) {
      return;
    }
    const next = historyIndex + direction;
    if (next < 0 || next >= history.length) {
      return;
    }
    state = Object.freeze({ ...state, historyIndex: next });
    textarea.value = history[next];
  }

  function checkTriggers(): void {
    const text = textarea.value;
    const cursorPos = textarea.selectionStart ?? text.length;
    const beforeCursor = text.slice(0, cursorPos);

    if (beforeCursor.endsWith("@") || /@\w*$/.test(beforeCursor)) {
      hooks.onMentionTrigger(text, cursorPos);
    }
    if (beforeCursor.startsWith("/") || /\n\//.test(beforeCursor)) {
      hooks.onSlashCommandTrigger(text, cursorPos);
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
      return;
    }

    if (event.key === "ArrowUp" && textarea.selectionStart === 0) {
      event.preventDefault();
      recallHistory(1);
      return;
    }

    if (event.key === "ArrowDown" && textarea.selectionStart === 0) {
      event.preventDefault();
      recallHistory(-1);
      return;
    }
  }

  function handleInput(): void {
    checkTriggers();
  }

  function handleDrop(event: DragEvent): void {
    if (event.dataTransfer) {
      hooks.onImageDrop(event.dataTransfer);
    }
  }

  // Wire up event listeners
  textarea.addEventListener("keydown", handleKeydown);
  textarea.addEventListener("input", handleInput);
  textarea.addEventListener("drop", handleDrop);
  sendButton.addEventListener("click", send);

  function setOnSend(callback: (text: string) => void): void {
    onSendCallback = callback;
  }

  function setDisabled(disabled: boolean): void {
    state = Object.freeze({ ...state, disabled });
    textarea.disabled = disabled;
    (sendButton as HTMLButtonElement).disabled = disabled;
  }

  function focus(): void {
    textarea.focus();
  }

  function cleanup(): void {
    textarea.removeEventListener("keydown", handleKeydown);
    textarea.removeEventListener("input", handleInput);
    textarea.removeEventListener("drop", handleDrop);
    sendButton.removeEventListener("click", send);
  }

  return {
    setOnSend,
    setDisabled,
    focus,
    cleanup,
    hooks,
  };
}
