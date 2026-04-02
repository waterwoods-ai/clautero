/**
 * TabBar -- Renders the horizontal tab strip at the top of the sidebar.
 *
 * All DOM is created via createElementNS (never innerHTML).
 * Supports scrolling overflow for many tabs.
 */

import type { TabInfo } from "./TabManager";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const MAX_TITLE_LENGTH = 20;

interface TabBarCallbacks {
  readonly onSwitch: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onCreate: () => void;
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

function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) {
    return title;
  }
  return title.slice(0, MAX_TITLE_LENGTH - 1) + "\u2026";
}

function buildTabElement(
  doc: Document,
  tab: TabInfo,
  isActive: boolean,
  callbacks: TabBarCallbacks
): HTMLElement {
  const className = isActive
    ? "clautero-tab active"
    : "clautero-tab";
  const tabEl = createEl(doc, "div", className);
  tabEl.setAttribute("data-tab-id", tab.id);
  tabEl.setAttribute("title", tab.title);

  const titleSpan = createEl(doc, "span", "clautero-tab-title");
  titleSpan.textContent = truncateTitle(tab.title);
  tabEl.appendChild(titleSpan);

  const closeBtn = createEl(doc, "button", "clautero-tab-close");
  closeBtn.textContent = "\u00D7";
  closeBtn.setAttribute("aria-label", `Close ${tab.title}`);
  closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    callbacks.onClose(tab.id);
  });
  tabEl.appendChild(closeBtn);

  tabEl.addEventListener("click", () => {
    callbacks.onSwitch(tab.id);
  });

  return tabEl;
}

function buildNewTabButton(
  doc: Document,
  callbacks: TabBarCallbacks
): HTMLElement {
  const btn = createEl(doc, "button", "clautero-tab-new");
  btn.textContent = "+";
  btn.setAttribute("aria-label", "New conversation");
  btn.addEventListener("click", () => {
    callbacks.onCreate();
  });
  return btn;
}

export function createTabBar(
  container: HTMLElement,
  doc: Document,
  callbacks: TabBarCallbacks
) {
  const barEl = createEl(doc, "div", "clautero-tab-bar");
  container.appendChild(barEl);

  function clearBar(): void {
    while (barEl.firstChild) {
      barEl.removeChild(barEl.firstChild);
    }
  }

  function update(tabs: readonly TabInfo[], activeId: string): void {
    clearBar();

    for (const tab of tabs) {
      const isActive = tab.id === activeId;
      const tabEl = buildTabElement(doc, tab, isActive, callbacks);
      barEl.appendChild(tabEl);
    }

    const newBtn = buildNewTabButton(doc, callbacks);
    barEl.appendChild(newBtn);
  }

  function cleanup(): void {
    clearBar();
    barEl.remove();
  }

  return { update, cleanup };
}
