/**
 * TextareaSizing — composer auto-grow without per-keystroke forced layout.
 *
 * Ported from Claudian's composer reflow fix (#1215), adapted for Gecko
 * (no `field-sizing: content` in Zotero's engine): the scrollHeight measure
 * still exists but is coalesced to one read/write per animation frame, and
 * the max height is recomputed only when the panel resizes — never per key.
 */

const MIN_MAX_HEIGHT = 120;
const MAX_MAX_HEIGHT = 400;
const PANEL_HEIGHT_FRACTION = 0.4;

export function installTextareaAutosize(
  textarea: HTMLTextAreaElement,
  panel: HTMLElement,
  win: Window
): () => void {
  let maxHeight = MIN_MAX_HEIGHT;
  let rafPending = false;

  function measure(): void {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + "px";
  }

  function scheduleMeasure(): void {
    if (rafPending) return;
    rafPending = true;
    win.requestAnimationFrame(() => {
      rafPending = false;
      measure();
    });
  }

  function recomputeMaxHeight(): void {
    const panelHeight = panel.clientHeight;
    if (panelHeight > 0) {
      maxHeight = Math.max(
        MIN_MAX_HEIGHT,
        Math.min(MAX_MAX_HEIGHT, Math.round(panelHeight * PANEL_HEIGHT_FRACTION))
      );
    }
    scheduleMeasure();
  }

  textarea.addEventListener("input", scheduleMeasure);

  let observer: ResizeObserver | null = null;
  const ObserverCtor = (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  if (ObserverCtor) {
    observer = new ObserverCtor(() => recomputeMaxHeight());
    observer.observe(panel);
  }
  recomputeMaxHeight();

  return () => {
    textarea.removeEventListener("input", scheduleMeasure);
    observer?.disconnect();
  };
}
