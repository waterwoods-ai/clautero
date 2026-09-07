import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getActiveReaderItem, isReaderTab } from "./ReaderItem";

interface FakeItem {
  id: number;
  itemType: string;
  parentItem?: FakeItem;
  isAttachment(): boolean;
}

function makeItem(id: number, itemType: string, parentItem?: FakeItem): FakeItem {
  return { id, itemType, parentItem, isAttachment: () => itemType === "attachment" };
}

function installFakeZotero(readerItemID: number | undefined, items: FakeItem[]): void {
  (globalThis as any).Zotero = {
    Reader: {
      getByTabID: (tabID: string) =>
        tabID === "reader-1" && readerItemID !== undefined ? { itemID: readerItemID } : null,
    },
    Items: {
      get: (id: number) => items.find((i) => i.id === id) ?? null,
    },
    log: () => {},
  };
}

function fakeWindow(tabType: string, tabID = `${tabType}-1`): Window {
  return { Zotero_Tabs: { selectedType: tabType, selectedID: tabID } } as unknown as Window;
}

describe("ReaderItem", () => {
  const paper = makeItem(10, "journalArticle");
  const pdf = makeItem(11, "attachment", paper);
  const standalonePdf = makeItem(12, "attachment");

  beforeEach(() => installFakeZotero(11, [paper, pdf, standalonePdf]));
  afterEach(() => { delete (globalThis as any).Zotero; });

  describe("isReaderTab", () => {
    it("is true only for reader tabs", () => {
      expect(isReaderTab(fakeWindow("reader"))).toBe(true);
      expect(isReaderTab(fakeWindow("library"))).toBe(false);
      expect(isReaderTab({} as Window)).toBe(false);
    });
  });

  describe("getActiveReaderItem", () => {
    it("returns the parent paper of the PDF open in the active reader tab", () => {
      expect(getActiveReaderItem(fakeWindow("reader"))).toBe(paper);
    });

    it("returns null when the library tab is active", () => {
      expect(getActiveReaderItem(fakeWindow("library"))).toBeNull();
    });

    it("returns null for a standalone attachment with no parent", () => {
      installFakeZotero(12, [standalonePdf]);
      expect(getActiveReaderItem(fakeWindow("reader"))).toBeNull();
    });

    it("returns the item itself when the reader item is already a regular item", () => {
      installFakeZotero(10, [paper]);
      expect(getActiveReaderItem(fakeWindow("reader"))).toBe(paper);
    });

    it("returns null when no reader instance exists for the tab", () => {
      expect(getActiveReaderItem(fakeWindow("reader", "reader-unknown"))).toBeNull();
    });

    it("swallows errors from the Zotero API and returns null", () => {
      (globalThis as any).Zotero.Reader.getByTabID = () => { throw new Error("boom"); };
      expect(getActiveReaderItem(fakeWindow("reader"))).toBeNull();
    });
  });
});
