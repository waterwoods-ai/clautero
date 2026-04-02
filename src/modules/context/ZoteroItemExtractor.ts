/**
 * ZoteroItemExtractor — Extracts structured metadata from a Zotero item.
 *
 * Formats item fields (title, authors, abstract, etc.) as structured text
 * suitable for inclusion in Claude context.
 */

function formatCreators(creators: ReadonlyArray<{ firstName?: string; lastName?: string; creatorType?: string }>): string {
  if (creators.length === 0) {
    return "";
  }
  const formatted = creators.map((c) => {
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
    const role = c.creatorType && c.creatorType !== "author" ? ` (${c.creatorType})` : "";
    return `${name}${role}`;
  });
  return formatted.join("; ");
}

function safeGetField(item: Zotero.Item, field: string): string {
  try {
    const value = item.getField(field) as string;
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function buildMetadataLines(item: Zotero.Item): readonly string[] {
  const lines: string[] = [];

  const title = safeGetField(item, "title");
  if (title) {
    lines.push(`Title: ${title}`);
  }

  const itemType = item.itemType;
  if (itemType) {
    lines.push(`Type: ${itemType}`);
  }

  try {
    const creators = item.getCreators();
    const formatted = formatCreators(creators);
    if (formatted) {
      lines.push(`Authors: ${formatted}`);
    }
  } catch {
    // Item may not support getCreators
  }

  const date = safeGetField(item, "date");
  if (date) {
    lines.push(`Date: ${date}`);
  }

  const abstractNote = safeGetField(item, "abstractNote");
  if (abstractNote) {
    lines.push(`Abstract: ${abstractNote}`);
  }

  const doi = safeGetField(item, "DOI");
  if (doi) {
    lines.push(`DOI: ${doi}`);
  }

  const url = safeGetField(item, "url");
  if (url) {
    lines.push(`URL: ${url}`);
  }

  const publicationTitle = safeGetField(item, "publicationTitle");
  if (publicationTitle) {
    lines.push(`Publication: ${publicationTitle}`);
  }

  try {
    const tags = item.getTags();
    if (tags && tags.length > 0) {
      const tagNames = tags.map((t: { tag: string }) => t.tag).join(", ");
      lines.push(`Tags: ${tagNames}`);
    }
  } catch {
    // Item may not support getTags
  }

  return Object.freeze(lines);
}

export function extractItemMetadata(item: Zotero.Item): string {
  const lines = buildMetadataLines(item);
  if (lines.length === 0) {
    return "";
  }
  return lines.join("\n");
}
