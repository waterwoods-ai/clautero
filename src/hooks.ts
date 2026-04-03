import { Addon } from "./addon";
import { initSidebarManager } from "./modules/sidebar/SidebarManager";
import { createInputController } from "./modules/chat/InputController";
import { createChatState, addMessage, type ChatStateData } from "./modules/chat/ChatState";
import { createMessageRenderer } from "./modules/chat/MessageRenderer";
import { createStreamController } from "./modules/chat/StreamController";
import { createClauteroService } from "./core/agent/ClauteroService";
import type { StreamChunk } from "./core/agent/types";
import { createContextChipsView } from "./modules/context/ContextChipsView";

export interface Hooks {
  onStartup(): Promise<void>;
  onShutdown(): void;
  onMainWindowLoad(window: Window): void;
  onMainWindowUnload(window: Window): void;
}

function resolveCliPath(): string {
  try {
    const pref = Zotero.Prefs.get("extensions.clautero.claudeCliPath", true) as string;
    return pref || "/Users/tom/.local/share/claude/versions/2.1.90";
  } catch {
    return "/Users/tom/.local/share/claude/versions/2.1.90";
  }
}

function isAutoAttachEnabled(): boolean {
  try {
    return Zotero.Prefs.get("extensions.clautero.autoAttachContext", true) !== false;
  } catch {
    return true;
  }
}

function getSelectedItem(): Zotero.Item | null {
  try {
    const pane = Zotero.getActiveZoteroPane();
    if (!pane) return null;
    const items = pane.getSelectedItems();
    if (!items || items.length === 0) return null;
    return items.find((item: Zotero.Item) =>
      item.itemType !== "attachment" && item.itemType !== "note"
    ) || null;
  } catch {
    return null;
  }
}

function doInitChat(
  win: Window,
  addon: Addon,
  elements: {
    messageArea: HTMLElement;
    textarea: HTMLTextAreaElement;
    sendButton: HTMLElement;
    contextBar: HTMLElement;
  },
  cleanupList: Array<() => void>
): void {
  const { messageArea, textarea, sendButton, contextBar } = elements;

  // Single conversation state
  let chatState: ChatStateData = createChatState();
  const renderer = createMessageRenderer(messageArea);
  cleanupList.push(() => renderer.cleanup());

  const streamController = createStreamController(
    renderer,
    () => chatState,
    (next: ChatStateData) => { chatState = next; }
  );
  cleanupList.push(() => streamController.cleanup());

  const inputController = createInputController(textarea, sendButton);
  cleanupList.push(() => inputController.cleanup());

  // Context integration
  let currentContext = "";
  const chipsView = createContextChipsView(contextBar, win.document);
  chipsView.setOnChange((ctx: string) => { currentContext = ctx; });
  cleanupList.push(() => chipsView.cleanup());

  if (isAutoAttachEnabled()) {
    const initialItem = getSelectedItem();
    if (initialItem) chipsView.update(initialItem);

    const notifierID = Zotero.Notifier.registerObserver({
      notify: (event: string, type: string) => {
        if (type === "item" && (event === "select" || event === "modify")) {
          if (isAutoAttachEnabled()) {
            chipsView.update(getSelectedItem());
          }
        }
      },
    }, ["item"], "clautero");
    cleanupList.push(() => {
      try { Zotero.Notifier.unregisterObserver(notifierID); } catch { /* ignore */ }
    });
  }

  // Claude service
  let service: ReturnType<typeof createClauteroService> | null = null;

  function getOrCreateService(): ReturnType<typeof createClauteroService> {
    if (service) return service;

    service = createClauteroService({
      cwd: addon.workspaceDir,
      cliPath: resolveCliPath(),
      onChunk: (chunk: StreamChunk) => {
        streamController.handleChunk(chunk);
        if (chunk.type === "result" || chunk.type === "error") {
          inputController.setDisabled(false);
          inputController.focus();
        }
      },
      onError: (error: Error) => {
        Zotero.log(`[Clautero] Service error: ${error.message}`, "error");
        renderer.appendTextChunk(`\nError: ${error.message}`);
        renderer.finishAssistantMessage();
        inputController.setDisabled(false);
      },
    });
    cleanupList.push(() => service?.cleanup());
    return service;
  }

  // Send handler
  inputController.setOnSend(async (text: string) => {
    // Add user message to chat
    chatState = addMessage(chatState, {
      role: "user",
      content: text,
      chunks: [],
      timestamp: Date.now(),
    });
    renderer.renderUserMessage(text);

    // Start session if needed
    const svc = getOrCreateService();
    try {
      if (svc.getState() !== "active") {
        renderer.appendTextChunk("Connecting to Claude...\n");
        await svc.startSession();
      }
    } catch (startError) {
      const msg = startError instanceof Error ? startError.message : String(startError);
      renderer.appendTextChunk(`Error: Could not start Claude. ${msg}`);
      renderer.finishAssistantMessage();
      inputController.setDisabled(false);
      return;
    }

    // Send message
    inputController.setDisabled(true);
    streamController.startStream();

    try {
      const fullMessage = currentContext ? `${currentContext}\n\n${text}` : text;
      svc.sendMessage(fullMessage);
    } catch (sendError) {
      const msg = sendError instanceof Error ? sendError.message : String(sendError);
      renderer.appendTextChunk(`Error: ${msg}`);
      renderer.finishAssistantMessage();
      inputController.setDisabled(false);
    }
  });

  Zotero.log("[Clautero] Chat system initialized (single conversation)", "info");
}

export function createHooks(addon: Addon): Hooks {
  const windowStates = new Map<Window, { cleanup: Array<() => void> }>();

  return {
    async onStartup() {
      await addon.ensureDirectories();
      Zotero.log("[Clautero] Plugin started", "info");
    },

    onShutdown() {
      for (const [, state] of windowStates) {
        for (const cleanup of state.cleanup) cleanup();
      }
      windowStates.clear();
      Zotero.log("[Clautero] Plugin shut down", "info");
    },

    onMainWindowLoad(window: Window) {
      const state = { cleanup: [] as Array<() => void> };
      windowStates.set(window, state);

      try {
        const sidebarCleanup = initSidebarManager(window, addon.rootURI);
        state.cleanup.push(sidebarCleanup);
      } catch (error) {
        Zotero.log(`[Clautero] Failed to init sidebar: ${error}`, "error");
      }

      // Poll for sidebar elements then init chat
      let chatDone = false;
      const poll = (window as any).setInterval(() => {
        if (chatDone) return;
        const sidebar = (window as any).__clauteroSidebar;
        const elements = sidebar?.getElements();
        if (!elements) return;
        chatDone = true;
        (window as any).clearInterval(poll);
        try {
          doInitChat(window, addon, elements, state.cleanup);
        } catch (error) {
          Zotero.log(`[Clautero] Failed to init chat: ${error}`, "error");
        }
      }, 500);
      state.cleanup.push(() => (window as any).clearInterval(poll));

      Zotero.log("[Clautero] Main window loaded", "info");
    },

    onMainWindowUnload(window: Window) {
      const state = windowStates.get(window);
      if (state) {
        for (const cleanup of state.cleanup) {
          try { cleanup(); } catch { /* ignore */ }
        }
        windowStates.delete(window);
      }
    },
  };
}
