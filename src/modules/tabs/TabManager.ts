/**
 * TabManager -- Manages multiple conversation tabs, each with its own
 * ChatState, message container, and lazily-created ClauteroService.
 *
 * Immutable tab state; mutable holder pattern for the active tab map.
 */

import { createChatState, addMessage } from "../chat/ChatState";
import type { ChatStateData } from "../chat/ChatState";
import { createMessageRenderer } from "../chat/MessageRenderer";
import { createStreamController } from "../chat/StreamController";
import { createClauteroService } from "../../core/agent/ClauteroService";
import type { StreamChunk } from "../../core/agent/types";
import {
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
} from "./SessionStore";
import type { SessionMetadata } from "./SessionStore";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const MAX_TABS = 10;
const TITLE_PREVIEW_LENGTH = 40;

export interface TabInfo {
  readonly id: string;
  readonly title: string;
}

interface Tab {
  readonly id: string;
  title: string;
  chatState: ChatStateData;
  readonly messageContainer: HTMLElement;
  sessionId?: string;
  claudeSessionId?: string;
  service: ReturnType<typeof createClauteroService> | null;
  renderer: ReturnType<typeof createMessageRenderer> | null;
  streamController: ReturnType<typeof createStreamController> | null;
  linkedItemKeys: string[];
  createdAt: number;
  updatedAt: number;
}

interface TabManagerOptions {
  readonly doc: Document;
  readonly messageArea: HTMLElement;
  readonly cwd: string;
  readonly cliPath: string;
  readonly onInputDisable: (disabled: boolean) => void;
  readonly onInputFocus: () => void;
  readonly onError: (error: Error) => void;
  readonly onTabsChanged: () => void;
}

function generateTabId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `tab-${timestamp}-${random}`;
}

function deriveTitle(text: string): string {
  const trimmed = text.trim().replace(/\n/g, " ");
  if (trimmed.length <= TITLE_PREVIEW_LENGTH) {
    return trimmed || "New chat";
  }
  return trimmed.slice(0, TITLE_PREVIEW_LENGTH) + "\u2026";
}

function createMessageContainer(doc: Document): HTMLElement {
  const container = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  container.setAttribute("class", "clautero-tab-messages");
  container.setAttribute("role", "log");
  container.setAttribute("aria-live", "polite");
  container.style.display = "none";
  return container;
}

function buildSessionMetadata(tab: Tab): SessionMetadata {
  return Object.freeze({
    id: tab.id,
    title: tab.title,
    createdAt: tab.createdAt,
    updatedAt: Date.now(),
    claudeSessionId: tab.claudeSessionId,
    linkedItemKeys: Object.freeze([...tab.linkedItemKeys]),
  });
}

export function createTabManager(options: TabManagerOptions) {
  const tabs = new Map<string, Tab>();
  let activeTabId = "";

  function getTab(id: string): Tab | undefined {
    return tabs.get(id);
  }

  function showContainer(tab: Tab): void {
    tab.messageContainer.style.display = "";
  }

  function hideContainer(tab: Tab): void {
    tab.messageContainer.style.display = "none";
  }

  function initTabRenderer(tab: Tab): void {
    if (tab.renderer) {
      return;
    }
    tab.renderer = createMessageRenderer(tab.messageContainer);
    tab.streamController = createStreamController(
      tab.renderer,
      () => tab.chatState,
      (next: ChatStateData) => { tab.chatState = next; }
    );
  }

  function initTabService(tab: Tab): ReturnType<typeof createClauteroService> {
    if (tab.service) {
      return tab.service;
    }
    const service = createClauteroService({
      cwd: options.cwd,
      cliPath: options.cliPath,
      onChunk: (chunk: StreamChunk) => {
        initTabRenderer(tab);
        tab.streamController?.handleChunk(chunk);

        // Extract claude session id from system or result messages
        const metadata = chunk.metadata ?? {};
        const sid = metadata.session_id ?? metadata.sessionId;
        if ((chunk.type === "system" || chunk.type === "result") && typeof sid === "string") {
          tab.claudeSessionId = sid;
        }

        if (chunk.type === "result" || chunk.type === "error") {
          options.onInputDisable(false);
          options.onInputFocus();
          tab.updatedAt = Date.now();
          persistTab(tab);
        }
      },
      onError: (error: Error) => {
        Zotero.log(
          `[Clautero] Tab ${tab.id} service error: ${error.message}`,
          "error"
        );
        options.onInputDisable(false);
        options.onError(error);
      },
    });
    tab.service = service;
    return service;
  }

  function persistTab(tab: Tab): void {
    saveSession(buildSessionMetadata(tab)).catch((error) => {
      Zotero.log(
        `[Clautero] Failed to persist tab ${tab.id}: ${error}`,
        "warning"
      );
    });
  }

  function createTab(): string {
    if (tabs.size >= MAX_TABS) {
      Zotero.log(
        `[Clautero] Maximum of ${MAX_TABS} tabs reached`,
        "warning"
      );
      return activeTabId;
    }

    const id = generateTabId();
    const container = createMessageContainer(options.doc);
    options.messageArea.parentElement?.appendChild(container);

    const now = Date.now();
    const tab: Tab = {
      id,
      title: "New chat",
      chatState: createChatState(),
      messageContainer: container,
      service: null,
      renderer: null,
      streamController: null,
      linkedItemKeys: [],
      createdAt: now,
      updatedAt: now,
    };

    tabs.set(id, tab);
    switchTab(id);
    options.onTabsChanged();
    return id;
  }

  function closeTab(id: string): void {
    const tab = tabs.get(id);
    if (!tab) {
      return;
    }

    // Persist before removing
    persistTab(tab);
    cleanupTab(tab);
    tabs.delete(id);

    // Last tab closed -- create a fresh one
    if (tabs.size === 0) {
      createTab();
      return;
    }

    // If closing the active tab, switch to the most recent remaining
    if (activeTabId === id) {
      const remaining = Array.from(tabs.values());
      remaining.sort((a, b) => b.updatedAt - a.updatedAt);
      switchTab(remaining[0].id);
    }

    options.onTabsChanged();
  }

  function cleanupTab(tab: Tab): void {
    tab.service?.cleanup();
    tab.renderer?.cleanup();
    tab.streamController?.cleanup();
    tab.messageContainer.remove();
  }

  function switchTab(id: string): void {
    const target = tabs.get(id);
    if (!target) {
      return;
    }

    // Hide current tab
    const current = tabs.get(activeTabId);
    if (current) {
      hideContainer(current);
    }

    activeTabId = id;
    initTabRenderer(target);
    showContainer(target);
    options.onTabsChanged();
  }

  function getActiveTabId(): string {
    return activeTabId;
  }

  function getTabs(): readonly TabInfo[] {
    const result: TabInfo[] = [];
    for (const tab of tabs.values()) {
      result.push(Object.freeze({ id: tab.id, title: tab.title }));
    }
    return Object.freeze(result);
  }

  function getActiveTab(): Tab | undefined {
    return tabs.get(activeTabId);
  }

  async function sendMessage(text: string, context?: string): Promise<void> {
    const tab = getActiveTab();
    if (!tab) {
      throw new Error("No active tab");
    }

    // Auto-generate title from first user message
    if (tab.title === "New chat") {
      tab.title = deriveTitle(text);
      options.onTabsChanged();
    }

    initTabRenderer(tab);

    tab.chatState = addMessage(tab.chatState, {
      role: "user",
      content: text,
      chunks: [],
      timestamp: Date.now(),
    });
    tab.renderer?.renderUserMessage(text);

    const service = initTabService(tab);

    if (service.getState() !== "active") {
      if (tab.claudeSessionId) {
        await service.resumeSession(tab.claudeSessionId);
      } else {
        await service.startSession();
      }
    }

    options.onInputDisable(true);
    tab.streamController?.startStream();

    const messageWithContext = context ? `${context}\n\n${text}` : text;
    service.sendMessage(messageWithContext);
    tab.updatedAt = Date.now();
  }

  async function restoreTabs(): Promise<void> {
    try {
      const sessions = await listSessions();
      if (sessions.length === 0) {
        createTab();
        return;
      }

      for (const session of sessions) {
        if (tabs.size >= MAX_TABS) {
          break;
        }
        restoreTabFromSession(session);
      }

      // Activate the most recent tab
      const firstTabId = Array.from(tabs.keys())[0];
      if (firstTabId) {
        switchTab(firstTabId);
      } else {
        createTab();
      }
    } catch (error) {
      Zotero.log(
        `[Clautero] Failed to restore tabs: ${error}`,
        "warning"
      );
      createTab();
    }
  }

  function restoreTabFromSession(session: SessionMetadata): void {
    const container = createMessageContainer(options.doc);
    options.messageArea.parentElement?.appendChild(container);

    const tab: Tab = {
      id: session.id,
      title: session.title,
      chatState: createChatState(),
      messageContainer: container,
      sessionId: session.id,
      claudeSessionId: session.claudeSessionId,
      service: null,
      renderer: null,
      streamController: null,
      linkedItemKeys: [...session.linkedItemKeys],
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };

    tabs.set(session.id, tab);
  }

  function cleanup(): void {
    for (const tab of tabs.values()) {
      persistTab(tab);
      cleanupTab(tab);
    }
    tabs.clear();
    activeTabId = "";
  }

  return {
    createTab,
    closeTab,
    switchTab,
    getActiveTabId,
    getTabs,
    sendMessage,
    restoreTabs,
    cleanup,
  };
}
