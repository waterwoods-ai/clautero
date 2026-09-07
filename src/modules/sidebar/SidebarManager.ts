/**
 * SidebarManager — Claudian-style chat panel in Zotero's item pane.
 *
 * Layout: header → messages → session tabs → context chips → pill input → status bar
 * The panel is a single DOM node that follows the active Zotero tab:
 * library tab → item pane; PDF reader / note tabs → context pane.
 * A sidenav icon is injected into every sidenav strip to toggle it.
 */

import { installTextareaAutosize } from "./TextareaSizing";
import {
  findAllSidenavs,
  findActivePaneTarget,
  ensureContextPaneOpen,
  type PaneTarget,
} from "./PaneLocator";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

export interface SidebarElements {
  readonly messageArea: HTMLElement;
  readonly contextBar: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  readonly sendButton: HTMLElement;
  readonly statusBar: HTMLElement;
  readonly sessionBar: HTMLElement;
  readonly providerLabel: HTMLElement;
  readonly modelLabel: HTMLElement;
  readonly effortLabel: HTMLElement;
  readonly contextPct: HTMLElement;
  readonly yoloLabel: HTMLElement;
}

let registeredElements: SidebarElements | null = null;

function createXUL(doc: Document, tag: string): Element {
  if ("createXULElement" in doc) return (doc as any).createXULElement(tag);
  return doc.createElementNS(XUL_NS, tag);
}

function el(doc: Document, tag: string, style: string, cls?: string): HTMLElement {
  const e = doc.createElementNS(XHTML_NS, tag) as HTMLElement;
  e.style.cssText = style;
  if (cls) e.className = cls;
  return e;
}

function svgIcon(doc: Document, d: string, size: number, fill: string): Element {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", fill);
  path.setAttribute("d", d);
  svg.appendChild(path);
  return svg;
}

const CHAT_ICON_D = "M8 1C4.1 1 1 3.6 1 7c0 1.8 1 3.4 2.5 4.5L3 14l3-1.8c.6.2 1.3.3 2 .3 3.9 0 7-2.6 7-6S11.9 1 8 1z";

export function initSidebarManager(
  win: Window,
  rootURI: string
): () => void {
  const doc = win.document;
  let panelVisible = false;
  const cleanups: Array<() => void> = [];

  // ══════════════════════════════════════════════
  // BUILD CLAUDIAN-STYLE UI
  // ══════════════════════════════════════════════

  const container = createXUL(doc, "vbox");
  container.setAttribute("id", "clautero-sidebar");
  container.setAttribute("style", "display:none;");

  const wrapper = el(doc, "div", `
    display:flex;flex-direction:column;height:100%;width:100%;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    font-size:13px;background:#fff;color:#1a1a1a;
  `);

  // ── Header: icon + "Clautero" (no close button) ──
  const header = el(doc, "div", `
    display:flex;align-items:center;gap:8px;
    padding:10px 14px;border-bottom:1px solid #f0f0f0;flex-shrink:0;
  `);
  header.appendChild(svgIcon(doc, CHAT_ICON_D, 14, "#c47a4a"));
  const title = el(doc, "span", "font-weight:500;font-size:14px;color:#1a1a1a;");
  title.textContent = "Clautero";
  header.appendChild(title);

  // ── Message area with centered welcome ──
  const messageArea = el(doc, "div",
    "flex:1;overflow-y:auto;padding:16px;",
    "clautero-messages"
  );

  const welcomeWrap = el(doc, "div", `
    display:flex;align-items:center;justify-content:center;height:100%;
  `, "clautero-welcome");
  const greeting = el(doc, "span", `
    font-size:22px;font-weight:400;color:#1a1a1a;
    font-family:Georgia,'Times New Roman',serif;text-align:center;
  `);
  greeting.textContent = "Ask Claude about\nyour research";
  welcomeWrap.appendChild(greeting);
  messageArea.appendChild(welcomeWrap);

  // ── Bottom section ──
  const bottomSection = el(doc, "div", "flex-shrink:0;");

  // Session tab bar: [1] [2] ... [5]  [+]
  const sessionBar = el(doc, "div", `
    display:flex;align-items:center;flex-wrap:wrap;padding:4px 14px;gap:4px;
    border-top:1px solid #f0f0f0;
  `, "clautero-session-bar");

  // Tab buttons will be managed by hooks.ts session logic
  // We just create the container here

  bottomSection.appendChild(sessionBar);

  // Context chips bar
  const contextBar = el(doc, "div", "padding:2px 14px;", "clautero-context-bar");
  bottomSection.appendChild(contextBar);

  // Input area: pill-shaped textarea, hidden send button
  const inputArea = el(doc, "div", "padding:6px 14px 4px;");

  const textarea = doc.createElementNS(XHTML_NS, "textarea") as HTMLTextAreaElement;
  textarea.placeholder = "How can I help you today?";
  textarea.rows = 1;
  textarea.style.cssText = `
    width:100%;resize:none;border:1px solid #e8e8e8;border-radius:20px;
    padding:8px 14px;font-size:13px;font-family:inherit;outline:none;
    background:#f8f8f8;color:#333;overflow:hidden;max-height:120px;
    box-sizing:border-box;
  `;
  // Auto-grow is installed below via installTextareaAutosize (rAF-coalesced,
  // max height tracks panel size instead of being remeasured per keystroke).

  const sendButton = el(doc, "button", "display:none;");
  sendButton.textContent = "Send";

  inputArea.appendChild(textarea);
  inputArea.appendChild(sendButton);
  bottomSection.appendChild(inputArea);

  // Status bar — Claudian-style: Model | Thinking: Level | 🌗 N%  ... YOLO
  const statusBar = el(doc, "div", `
    display:flex;align-items:center;justify-content:space-between;
    padding:4px 14px 6px;font-size:11px;color:#888;
  `, "clautero-status-bar");

  const leftGroup = el(doc, "div", "display:flex;align-items:center;gap:6px;");

  const providerLabel = el(doc, "span", "font-weight:600;cursor:pointer;color:#c47a4a;");
  providerLabel.textContent = "Claude";
  providerLabel.setAttribute("title", "Click to switch provider");

  const sep0 = el(doc, "span", "color:#ccc;");
  sep0.textContent = "|";

  const modelLabel = el(doc, "span", "font-weight:500;cursor:pointer;");
  modelLabel.textContent = "sonnet";
  modelLabel.setAttribute("title", "Click to change model");

  const sep1 = el(doc, "span", "color:#ccc;");
  sep1.textContent = "|";

  const effortLabel = el(doc, "span", "cursor:pointer;");
  effortLabel.textContent = "Thinking: Low";
  effortLabel.setAttribute("title", "Click to change thinking level");

  const sep2 = el(doc, "span", "color:#ccc;");
  sep2.textContent = "|";

  const contextPct = el(doc, "span", "");
  contextPct.textContent = "\u25D1 0%";

  leftGroup.appendChild(providerLabel);
  leftGroup.appendChild(sep0);
  leftGroup.appendChild(modelLabel);
  leftGroup.appendChild(sep1);
  leftGroup.appendChild(effortLabel);
  leftGroup.appendChild(sep2);
  leftGroup.appendChild(contextPct);

  const rightGroup = el(doc, "div", "display:flex;align-items:center;gap:4px;");
  const yoloLabel = el(doc, "span", "cursor:pointer;font-weight:500;user-select:none;");
  yoloLabel.textContent = "YOLO \u25CB";
  yoloLabel.setAttribute("title", "Toggle YOLO mode (bypass permissions)");

  rightGroup.appendChild(yoloLabel);

  statusBar.appendChild(leftGroup);
  statusBar.appendChild(rightGroup);
  bottomSection.appendChild(statusBar);

  // Assemble
  wrapper.appendChild(header);
  wrapper.appendChild(messageArea);
  wrapper.appendChild(bottomSection);
  container.appendChild(wrapper);

  cleanups.push(installTextareaAutosize(textarea, wrapper, win));

  registeredElements = Object.freeze({
    messageArea, contextBar, textarea, sendButton, statusBar, sessionBar,
    providerLabel, modelLabel, effortLabel, contextPct, yoloLabel,
  });

  // ══════════════════════════════════════════════
  // PLACE PANEL IN THE ACTIVE PANE
  // Library tab → item pane; PDF/note tabs → reader context pane.
  // One DOM node is re-parented, so sessions survive tab switches.
  // ══════════════════════════════════════════════

  let currentTarget: PaneTarget | null = null;

  /** Re-parent the panel next to the active tab's sidenav. Idempotent. */
  function placePanel(): boolean {
    const target = findActivePaneTarget(win);
    if (!target) return false;

    const alreadyPlaced = container.parentElement === target.host
      && currentTarget?.sidenav === target.sidenav;
    if (alreadyPlaced) return true;

    target.host.style.position = "relative";
    target.host.insertBefore(container, target.sidenav);
    currentTarget = target;
    Zotero.log(`[Clautero] Panel placed in ${target.kind} pane`, "info");
    return true;
  }

  // Zotero may rebuild either pane at any time — keep the panel attached.
  const placeTimer = (win as any).setInterval(() => placePanel(), 2000);
  cleanups.push(() => (win as any).clearInterval(placeTimer));

  // Follow tab switches (library ↔ reader) as soon as Zotero announces them.
  const tabObserverID = Zotero.Notifier.registerObserver({
    notify: (event: string, type: string) => {
      if (type !== "tab" || (event !== "select" && event !== "load")) return;
      if (placePanel() && panelVisible) applyVisibleStyle();
    },
  }, ["tab"], "clautero-sidebar");
  cleanups.push(() => {
    try { Zotero.Notifier.unregisterObserver(tabObserverID); } catch { /* ignore */ }
  });

  // ══════════════════════════════════════════════
  // SIDENAV BUTTONS — one per sidenav strip
  // (library item pane + reader context pane)
  // ══════════════════════════════════════════════

  const BTN_CLASS = "clautero-sidenav-btn";
  const WATCHED_ATTR = "data-clautero-watched";

  function allSidenavButtons(): HTMLElement[] {
    return Array.from(doc.querySelectorAll(`.${BTN_CLASS}`)) as HTMLElement[];
  }

  function buildSidenavButton(): HTMLElement {
    const btn = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    btn.className = `btn ${BTN_CLASS}`;
    btn.setAttribute("title", "Clautero Chat");
    btn.style.cssText = `
      width:28px;height:28px;display:flex;align-items:center;justify-content:center;
      cursor:pointer;border-radius:4px;margin:2px 0;
    `;
    btn.appendChild(svgIcon(doc, CHAT_ICON_D, 16, "#666"));
    btn.addEventListener("click", () => togglePanel());
    return btn;
  }

  function hasSidenavButton(sidenav: HTMLElement): boolean {
    return Boolean(
      sidenav.querySelector(`.${BTN_CLASS}`)
      ?? sidenav.shadowRoot?.querySelector(`.${BTN_CLASS}`)
    );
  }

  function injectSidenavButton(sidenav: HTMLElement): void {
    if (hasSidenavButton(sidenav)) return;

    const btnContainer = sidenav.querySelector(".inherit-flex")
      ?? sidenav.shadowRoot?.querySelector(".inherit-flex")
      ?? sidenav;
    btnContainer.appendChild(buildSidenavButton());

    watchOtherButtons(sidenav);
    Zotero.log(`[Clautero] Sidenav button injected (${sidenav.id || "sidenav"})`, "info");
  }

  // Keep polling forever — Zotero may rebuild a sidenav at any time
  // (tab switch, window resize, pane refresh), destroying our button.
  const buttonTimer = (win as any).setInterval(() => {
    for (const sidenav of findAllSidenavs(doc)) injectSidenavButton(sidenav);
  }, 2000);
  cleanups.push(() => (win as any).clearInterval(buttonTimer));

  // ══════════════════════════════════════════════
  // TOGGLE LOGIC (overlay approach)
  // ══════════════════════════════════════════════

  // Leave right space for the sidenav icon strip (~40px)
  const VISIBLE_STYLE =
    "position:absolute;top:0;left:0;right:40px;bottom:0;display:flex;z-index:100;background:#fff;";

  function applyVisibleStyle(): void {
    (container as HTMLElement).style.cssText = VISIBLE_STYLE;
  }

  function setButtonsActive(active: boolean): void {
    for (const btn of allSidenavButtons()) {
      btn.style.background = active ? "rgba(0,0,0,0.08)" : "";
    }
  }

  function showChat(): void {
    panelVisible = true;
    ensureContextPaneOpen(win);
    placePanel();
    applyVisibleStyle();
    textarea.focus();
    setButtonsActive(true);
  }

  function hideChat(): void {
    panelVisible = false;
    (container as HTMLElement).style.cssText = "display:none;";
    setButtonsActive(false);
  }

  function togglePanel(): void {
    if (panelVisible) hideChat(); else showChat();
  }

  function watchOtherButtons(sidenav: HTMLElement): void {
    if (sidenav.getAttribute(WATCHED_ATTR) === "true") return;
    sidenav.setAttribute(WATCHED_ATTR, "true");
    // Only hide chat when the user clicks another SIDENAV SECTION button
    // (not when clicking items in the library list)
    sidenav.addEventListener("click", (e: Event) => {
      const target = e.target as HTMLElement;
      const btn = target.closest(".btn") as HTMLElement | null;
      // Only react to sidenav buttons that are NOT ours
      if (btn && !btn.classList.contains(BTN_CLASS)
        && !btn.hasAttribute("data-action") && panelVisible) {
        hideChat();
      }
    }, true);
  }

  // ── Keyboard shortcut ──
  const keyHandler = (e: Event) => {
    const ke = e as KeyboardEvent;
    const isMac = (typeof Zotero !== "undefined" && Zotero.isMac) || false;
    const mod = isMac ? ke.metaKey : ke.ctrlKey;
    if (mod && ke.shiftKey && ke.key === "C") { ke.preventDefault(); togglePanel(); }
  };
  win.addEventListener("keydown", keyHandler, true);
  cleanups.push(() => win.removeEventListener("keydown", keyHandler, true));

  // Expose API
  (win as any).__clauteroSidebar = Object.freeze({
    toggle: togglePanel,
    show: () => { if (!panelVisible) togglePanel(); },
    hide: () => { if (panelVisible) togglePanel(); },
    isVisible: () => panelVisible,
    getElements: () => registeredElements,
  });

  Zotero.log("[Clautero] Sidebar initialized (Claudian-style, library + reader panes)", "info");

  return () => {
    for (const fn of cleanups) fn();
    hideChat();
    container.remove();
    for (const btn of allSidenavButtons()) btn.remove();
    registeredElements = null;
    delete (win as any).__clauteroSidebar;
  };
}
