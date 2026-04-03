/**
 * ContextBuilder — Assembles full XML-structured context from a Zotero item.
 *
 * Combines item metadata, annotations, and PDF file path into a single
 * context string formatted for Claude consumption.
 */

import { extractItemMetadata } from "./ZoteroItemExtractor";
import { extractAnnotations } from "./AnnotationExtractor";

const DEFAULT_MAX_CONTEXT_LENGTH = 50000;
const TRUNCATION_INDICATOR = "\n[Context truncated due to length limit]";

function getMaxContextLength(): number {
  try {
    const pref = Zotero.Prefs.get(
      "extensions.clautero.maxContextLength",
      true
    ) as number;
    return typeof pref === "number" && pref > 0
      ? pref
      : DEFAULT_MAX_CONTEXT_LENGTH;
  } catch {
    return DEFAULT_MAX_CONTEXT_LENGTH;
  }
}

function findPdfAttachmentId(item: Zotero.Item): number | null {
  try {
    const attachmentIds = item.getAttachments();
    if (!attachmentIds || attachmentIds.length === 0) {
      return null;
    }
    for (const id of attachmentIds) {
      const attachment = Zotero.Items.get(id);
      if (attachment && attachment.attachmentContentType === "application/pdf") {
        return id;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function getPdfFilePath(item: Zotero.Item): string {
  try {
    const pdfId = findPdfAttachmentId(item);
    if (pdfId === null) {
      return "";
    }
    const attachment = Zotero.Items.get(pdfId);
    if (!attachment || !attachment.getFilePath) {
      return "";
    }
    const filePath = attachment.getFilePath();
    return typeof filePath === "string" ? filePath : "";
  } catch {
    return "";
  }
}

function wrapInXml(
  metadata: string,
  annotations: string,
  pdfPath: string
): string {
  const parts: string[] = ["<zotero_item>"];

  if (metadata) {
    parts.push(`<metadata>\n${metadata}\n</metadata>`);
  }

  if (annotations) {
    parts.push(`<annotations>\n${annotations}\n</annotations>`);
  }

  if (pdfPath) {
    parts.push(`<pdf_path>${pdfPath}</pdf_path>`);
  }

  parts.push("</zotero_item>");
  return parts.join("\n");
}

function truncateIfNeeded(context: string, maxLength: number): string {
  if (context.length <= maxLength) {
    return context;
  }
  const truncateAt = maxLength - TRUNCATION_INDICATOR.length;
  return context.slice(0, truncateAt) + TRUNCATION_INDICATOR;
}

/**
 * Build context for a collection (folder) — lists all papers with metadata.
 */
export async function buildCollectionContext(
  collection: Zotero.Collection
): Promise<string> {
  try {
    const items = collection.getChildItems();
    const regularItems = items.filter(
      (item: Zotero.Item) => item.isRegularItem()
    );

    if (regularItems.length === 0) {
      return "";
    }

    const parts: string[] = [
      `<zotero_collection>`,
      `<name>${collection.name}</name>`,
      `<paper_count>${regularItems.length}</paper_count>`,
      `<papers>`,
    ];

    for (const item of regularItems) {
      const metadata = extractItemMetadata(item);
      const pdfPath = getPdfFilePath(item);
      parts.push(`<paper>`);
      parts.push(`<metadata>\n${metadata}\n</metadata>`);
      if (pdfPath) {
        parts.push(`<pdf_path>${pdfPath}</pdf_path>`);
      }
      parts.push(`</paper>`);
    }

    parts.push(`</papers>`);
    parts.push(`</zotero_collection>`);

    const context = parts.join("\n");
    const maxLength = getMaxContextLength();
    return truncateIfNeeded(context, maxLength);
  } catch (error) {
    Zotero.log(`[Clautero] Failed to build collection context: ${error}`, "warning");
    return "";
  }
}

export async function buildContext(item: Zotero.Item): Promise<string> {
  try {
    const metadata = extractItemMetadata(item);
    const annotations = await extractAnnotations(item);
    const pdfPath = getPdfFilePath(item);

    if (!metadata && !annotations && !pdfPath) {
      return "";
    }

    const context = wrapInXml(metadata, annotations, pdfPath);
    const maxLength = getMaxContextLength();
    return truncateIfNeeded(context, maxLength);
  } catch (error) {
    Zotero.log(`[Clautero] Failed to build context: ${error}`, "warning");
    return "";
  }
}
