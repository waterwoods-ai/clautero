/**
 * AnnotationExtractor — Extracts PDF annotations from a Zotero item's attachments.
 *
 * Retrieves highlights, notes, and other annotation types from PDF attachments
 * and formats them as structured text for Claude context.
 */

interface AnnotationData {
  readonly type: string;
  readonly text: string;
  readonly comment: string;
  readonly page: number;
}

function formatAnnotationType(type: string): string {
  const typeMap: Readonly<Record<string, string>> = Object.freeze({
    highlight: "Highlight",
    note: "Note",
    underline: "Underline",
    strikethrough: "Strikethrough",
    image: "Image",
    ink: "Ink",
    text: "Text",
  });
  return typeMap[type] || type;
}

function extractAnnotationData(annotation: Zotero.Item): AnnotationData {
  const type = (annotation as any).annotationType || "";
  const text = (annotation as any).annotationText || "";
  const comment = (annotation as any).annotationComment || "";
  const pageLabel = (annotation as any).annotationPageLabel || "";
  const page = parseInt(pageLabel, 10) || 0;

  return Object.freeze({ type, text, comment, page });
}

function formatSingleAnnotation(data: AnnotationData): string {
  const parts: string[] = [];
  const typeLabel = formatAnnotationType(data.type);

  if (data.page > 0) {
    parts.push(`[${typeLabel}, p.${data.page}]`);
  } else {
    parts.push(`[${typeLabel}]`);
  }

  if (data.text) {
    parts.push(`"${data.text}"`);
  }

  if (data.comment) {
    parts.push(`Comment: ${data.comment}`);
  }

  return parts.join(" ");
}

async function getAnnotationsFromAttachment(
  attachmentId: number
): Promise<readonly AnnotationData[]> {
  try {
    const attachment = Zotero.Items.get(attachmentId);
    if (!attachment || attachment.attachmentContentType !== "application/pdf") {
      return Object.freeze([]);
    }

    const annotationIds = attachment.getAnnotations
      ? attachment.getAnnotations()
      : [];

    if (!annotationIds || annotationIds.length === 0) {
      return Object.freeze([]);
    }

    const annotations = annotationIds.map((ann: any) => {
      const item = typeof ann === "number" ? Zotero.Items.get(ann) : ann;
      return extractAnnotationData(item);
    });

    return Object.freeze(annotations);
  } catch (error) {
    Zotero.log(
      `[Clautero] Failed to get annotations from attachment ${attachmentId}: ${error}`,
      "warning"
    );
    return Object.freeze([]);
  }
}

export async function extractAnnotations(item: Zotero.Item): Promise<string> {
  try {
    const attachmentIds = item.getAttachments();
    if (!attachmentIds || attachmentIds.length === 0) {
      return "";
    }

    const allAnnotations: AnnotationData[] = [];
    for (const id of attachmentIds) {
      const annotations = await getAnnotationsFromAttachment(id);
      allAnnotations.push(...annotations);
    }

    if (allAnnotations.length === 0) {
      return "";
    }

    const sorted = [...allAnnotations].sort((a, b) => a.page - b.page);
    const lines = sorted.map(formatSingleAnnotation);
    return lines.join("\n");
  } catch (error) {
    Zotero.log(
      `[Clautero] Failed to extract annotations: ${error}`,
      "warning"
    );
    return "";
  }
}
