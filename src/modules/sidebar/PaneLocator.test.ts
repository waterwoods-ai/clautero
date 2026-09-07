import { describe, it, expect, beforeEach } from "vitest";
import {
  findAllSidenavs,
  findPaneTarget,
  findActivePaneTarget,
  getActiveTabType,
  ensureContextPaneOpen,
} from "./PaneLocator";

/**
 * Minimal replica of Zotero 7's main-window DOM:
 *   - library item pane with its own sidenav
 *   - reader context pane with a separate sidenav
 */
function buildZoteroDom(opts: { withContextSidenav?: boolean } = {}): Document {
  const { withContextSidenav = true } = opts;
  document.body.innerHTML = `
    <item-pane id="zotero-item-pane">
      <div id="library-content"></div>
      <item-pane-sidenav id="zotero-view-item-sidenav"></item-pane-sidenav>
    </item-pane>
    <box id="zotero-context-pane" collapsed="true">
      <vbox id="context-content"></vbox>
      ${withContextSidenav
        ? '<item-pane-sidenav id="zotero-context-pane-sidenav" hidden="true"></item-pane-sidenav>'
        : ""}
    </box>
  `;
  return document;
}

function fakeWindow(tabType: string, extra: Record<string, unknown> = {}): Window {
  return {
    document,
    Zotero_Tabs: { selectedType: tabType, selectedID: `${tabType}-1` },
    ...extra,
  } as unknown as Window;
}

describe("PaneLocator", () => {
  beforeEach(() => {
    buildZoteroDom();
  });

  describe("getActiveTabType", () => {
    it("returns the selected tab type from Zotero_Tabs", () => {
      expect(getActiveTabType(fakeWindow("reader"))).toBe("reader");
    });

    it("defaults to 'library' when Zotero_Tabs is unavailable", () => {
      const win = { document } as unknown as Window;
      expect(getActiveTabType(win)).toBe("library");
    });
  });

  describe("findAllSidenavs", () => {
    it("finds both the item-pane and context-pane sidenavs", () => {
      const ids = findAllSidenavs(document).map((s) => s.id);
      expect(ids).toEqual(["zotero-view-item-sidenav", "zotero-context-pane-sidenav"]);
    });
  });

  describe("findPaneTarget", () => {
    it("resolves the library target to the item-pane sidenav", () => {
      const target = findPaneTarget(document, "library");
      expect(target?.kind).toBe("library");
      expect(target?.sidenav.id).toBe("zotero-view-item-sidenav");
      expect(target?.host.id).toBe("zotero-item-pane");
    });

    it("resolves the reader target to the context-pane sidenav", () => {
      const target = findPaneTarget(document, "reader");
      expect(target?.kind).toBe("reader");
      expect(target?.sidenav.id).toBe("zotero-context-pane-sidenav");
      expect(target?.host.id).toBe("zotero-context-pane");
    });

    it("returns null when the requested sidenav does not exist", () => {
      buildZoteroDom({ withContextSidenav: false });
      expect(findPaneTarget(document, "reader")).toBeNull();
    });
  });

  describe("findActivePaneTarget", () => {
    it("picks the library pane when the library tab is selected", () => {
      expect(findActivePaneTarget(fakeWindow("library"))?.kind).toBe("library");
    });

    it("picks the reader context pane when a reader tab is selected", () => {
      expect(findActivePaneTarget(fakeWindow("reader"))?.kind).toBe("reader");
    });

    it("treats any non-library tab (e.g. note editor) as a context-pane tab", () => {
      expect(findActivePaneTarget(fakeWindow("note"))?.kind).toBe("reader");
    });

    it("falls back to the library pane when the context sidenav is missing", () => {
      buildZoteroDom({ withContextSidenav: false });
      expect(findActivePaneTarget(fakeWindow("reader"))?.kind).toBe("library");
    });
  });

  describe("ensureContextPaneOpen", () => {
    it("un-collapses the context pane when a reader tab is active", () => {
      const ctx = { collapsed: true };
      ensureContextPaneOpen(fakeWindow("reader", { ZoteroContextPane: ctx }));
      expect(ctx.collapsed).toBe(false);
    });

    it("leaves the context pane alone on the library tab", () => {
      const ctx = { collapsed: true };
      ensureContextPaneOpen(fakeWindow("library", { ZoteroContextPane: ctx }));
      expect(ctx.collapsed).toBe(true);
    });

    it("does not throw when ZoteroContextPane is unavailable", () => {
      expect(() => ensureContextPaneOpen(fakeWindow("reader"))).not.toThrow();
    });
  });
});
