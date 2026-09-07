/**
 * HistoryQuery — pure filtering/ordering for the chat-history panel.
 *
 * Search is Claudian-style (#1050 sidebar): case-folded AND of whitespace-
 * separated terms over the title. Pinned entries sort above the rest;
 * both groups are newest-first.
 */

export interface HistoryEntry {
  readonly id: string;
  readonly title: string;
  readonly created: number;
  readonly pinned?: boolean;
  readonly path: string;
}

export function filterHistory(
  entries: readonly HistoryEntry[],
  query: string
): readonly HistoryEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return entries;
  return entries.filter((entry) => {
    const haystack = entry.title.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function sortHistory(
  entries: readonly HistoryEntry[]
): readonly HistoryEntry[] {
  return [...entries].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return b.created - a.created;
  });
}
