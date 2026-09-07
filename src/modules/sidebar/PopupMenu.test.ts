import { describe, it, expect, vi, beforeEach } from "vitest";
import { showPopupMenu, closeActivePopup, type PopupMenuItem } from "./PopupMenu";

function setup(): { anchor: HTMLElement } {
  document.body.innerHTML = '<div id="bar"><span id="anchor">label</span></div>';
  return { anchor: document.getElementById("anchor") as HTMLElement };
}

const items: PopupMenuItem[] = [
  { value: "sonnet", label: "sonnet", selected: true },
  { value: "opus", label: "opus" },
  { value: "off", label: "Grok", disabled: true, description: "Not installed" },
];

function menuEl(): HTMLElement | null {
  return document.querySelector(".clautero-popup-menu");
}

describe("PopupMenu", () => {
  beforeEach(() => {
    closeActivePopup();
    setup();
  });

  it("renders items with the current selection marked", () => {
    const { anchor } = setup();
    showPopupMenu(document, anchor, items, () => {});
    const rows = document.querySelectorAll(".clautero-popup-item");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("✓");
    expect(rows[2].textContent).toContain("Not installed");
  });

  it("invokes onSelect and closes on click", () => {
    const { anchor } = setup();
    const onSelect = vi.fn();
    showPopupMenu(document, anchor, items, onSelect);
    (document.querySelectorAll(".clautero-popup-item")[1] as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith("opus");
    expect(menuEl()).toBeNull();
  });

  it("ignores clicks on disabled items", () => {
    const { anchor } = setup();
    const onSelect = vi.fn();
    showPopupMenu(document, anchor, items, onSelect);
    (document.querySelectorAll(".clautero-popup-item")[2] as HTMLElement).click();
    expect(onSelect).not.toHaveBeenCalled();
    expect(menuEl()).not.toBeNull();
  });

  it("closes on click-away but not on the anchor's own click", () => {
    const { anchor } = setup();
    showPopupMenu(document, anchor, items, () => {});
    anchor.click();
    expect(menuEl()).not.toBeNull();
    document.body.click();
    expect(menuEl()).toBeNull();
  });

  it("closes on Escape", () => {
    const { anchor } = setup();
    showPopupMenu(document, anchor, items, () => {});
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menuEl()).toBeNull();
  });

  it("toggles closed when reopened from the same anchor, and replaces from another", () => {
    const { anchor } = setup();
    showPopupMenu(document, anchor, items, () => {});
    showPopupMenu(document, anchor, items, () => {});
    expect(menuEl()).toBeNull();

    showPopupMenu(document, anchor, items, () => {});
    const other = document.createElement("span");
    document.body.appendChild(other);
    showPopupMenu(document, other, [{ value: "x", label: "x" }], () => {});
    expect(document.querySelectorAll(".clautero-popup-menu")).toHaveLength(1);
  });
});
