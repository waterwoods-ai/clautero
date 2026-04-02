/**
 * ZoteroSearchProvider — Searches Zotero items and collections by query.
 *
 * Uses Zotero.Search for items (title/creator/year) and filters
 * Zotero.Collections by name for collection results.
 */

const DEFAULT_LIMIT = 10;

export interface SearchResult {
  readonly id: number;
  readonly title: string;
  readonly type: "item" | "collection";
  readonly subtitle?: string;
}

function formatItemType(itemType: string): string {
  const typeMap: Record<string, string> = {
    journalArticle: "Article",
    book: "Book",
    bookSection: "Book Section",
    conferencePaper: "Conference Paper",
    thesis: "Thesis",
    report: "Report",
    webpage: "Web Page",
    preprint: "Preprint",
    manuscript: "Manuscript",
    patent: "Patent",
    letter: "Letter",
  };
  return typeMap[itemType] ?? itemType;
}

function itemToSearchResult(item: Zotero.Item): SearchResult {
  const title = (() => {
    try {
      return (item.getField("title") as string) || "Untitled";
    } catch {
      return "Untitled";
    }
  })();

  const subtitle = (() => {
    try {
      const creators = item.getCreators();
      if (creators.length === 0) {
        return formatItemType(item.itemType);
      }
      const firstAuthor = [creators[0].firstName, creators[0].lastName]
        .filter(Boolean)
        .join(" ");
      return `${formatItemType(item.itemType)} - ${firstAuthor}`;
    } catch {
      return formatItemType(item.itemType);
    }
  })();

  return Object.freeze({ id: item.id, title, type: "item" as const, subtitle });
}

export async function searchItems(
  query: string,
  limit?: number
): Promise<readonly SearchResult[]> {
  try {
    const trimmed = query.trim();
    if (!trimmed) {
      return Object.freeze([]);
    }

    const search = new Zotero.Search();
    search.addCondition("quicksearch-titleCreatorYear", "contains", trimmed);
    search.addCondition("itemType", "isNot", "attachment");

    const ids = await search.search();
    const cap = limit ?? DEFAULT_LIMIT;
    const items = Zotero.Items.get(ids.slice(0, cap));

    const results = items.map(itemToSearchResult);
    return Object.freeze(results);
  } catch (error) {
    Zotero.log(`[Clautero] Item search failed: ${error}`, "warning");
    return Object.freeze([]);
  }
}

export async function searchCollections(
  query: string
): Promise<readonly SearchResult[]> {
  try {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return Object.freeze([]);
    }

    const libraryID = Zotero.Libraries.userLibraryID;
    const allCollections = Zotero.Collections.getByLibrary(libraryID);

    const matches = allCollections
      .filter((c: Zotero.Collection) => c.name.toLowerCase().includes(trimmed))
      .slice(0, DEFAULT_LIMIT)
      .map((c: Zotero.Collection): SearchResult =>
        Object.freeze({
          id: c.id,
          title: c.name,
          type: "collection" as const,
          subtitle: `${c.getChildItems().length} items`,
        })
      );

    return Object.freeze(matches);
  } catch (error) {
    Zotero.log(`[Clautero] Collection search failed: ${error}`, "warning");
    return Object.freeze([]);
  }
}

export async function search(
  query: string,
  limit?: number
): Promise<readonly SearchResult[]> {
  try {
    const [items, collections] = await Promise.all([
      searchItems(query, limit),
      searchCollections(query),
    ]);
    const combined = [...collections, ...items].slice(0, limit ?? DEFAULT_LIMIT);
    return Object.freeze(combined);
  } catch (error) {
    Zotero.log(`[Clautero] Combined search failed: ${error}`, "warning");
    return Object.freeze([]);
  }
}
