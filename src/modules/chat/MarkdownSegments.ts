/**
 * MarkdownSegments — a code-aware markdown splitter.
 *
 * Splits markdown into text / inline-code / fenced-code segments so that
 * formatting transforms (bold, lists, line breaks…) can run on prose only,
 * never inside code. Eliminates the "regex ate my code block" bug class.
 * Modeled on Claudian's utils/markdownSegments.ts, trimmed to what
 * Clautero's renderer needs (backtick + tilde fences, inline code runs).
 */

export type SegmentKind = "text" | "inline-code" | "fence";

export interface Segment {
  readonly kind: SegmentKind;
  /** Segment content. For fences: inner lines only, no fence markers. */
  readonly content: string;
  /** Fence info string's first word (e.g. "ts"), when present. */
  readonly lang?: string;
}

export interface SegmentTransforms {
  readonly text: (content: string) => string;
  readonly inlineCode: (code: string) => string;
  readonly fence: (code: string, lang?: string) => string;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;

function splitInline(text: string, out: Segment[]): void {
  // Inline code: a run of N backticks closed by the same run length.
  const re = /(`+)([\s\S]+?)\1/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      out.push({ kind: "text", content: text.slice(last, match.index) });
    }
    out.push({ kind: "inline-code", content: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    out.push({ kind: "text", content: text.slice(last) });
  }
}

export function segmentMarkdown(markdown: string): readonly Segment[] {
  const segments: Segment[] = [];
  const lines = markdown.split("\n");

  let textBuffer: string[] = [];
  let fenceBuffer: string[] | null = null;
  let fenceMarker = "";
  let fenceLang: string | undefined;

  function flushText(trailingNewline: boolean): void {
    if (textBuffer.length === 0) return;
    const joined = textBuffer.join("\n") + (trailingNewline ? "\n" : "");
    splitInline(joined, segments);
    textBuffer = [];
  }

  for (const line of lines) {
    if (fenceBuffer !== null) {
      const closes = new RegExp(`^ {0,3}${fenceMarker[0]}{${fenceMarker.length},}[ \t]*$`).test(line);
      if (closes) {
        segments.push(Object.freeze({
          kind: "fence" as const,
          content: fenceBuffer.join("\n"),
          ...(fenceLang ? { lang: fenceLang } : {}),
        }));
        fenceBuffer = null;
        fenceLang = undefined;
        // The close-marker line consumed its newline; restore the separator
        // so a following text segment starts on its own line.
        textBuffer.push("");
      } else {
        fenceBuffer.push(line);
      }
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    if (open && !(open[1][0] === "`" && line.slice(line.indexOf(open[1]) + open[1].length).includes("`"))) {
      flushText(true);
      fenceMarker = open[1];
      fenceLang = open[2] || undefined;
      fenceBuffer = [];
      continue;
    }

    textBuffer.push(line);
  }

  // Unclosed fence at EOF still renders as code.
  if (fenceBuffer !== null) {
    segments.push(Object.freeze({
      kind: "fence" as const,
      content: fenceBuffer.join("\n"),
      ...(fenceLang ? { lang: fenceLang } : {}),
    }));
  } else {
    flushText(false);
  }

  return Object.freeze(segments);
}

/** Apply per-kind transforms and concatenate the results. */
export function transformMarkdownSegments(
  markdown: string,
  transforms: SegmentTransforms
): string {
  return segmentMarkdown(markdown)
    .map((seg) => {
      if (seg.kind === "inline-code") return transforms.inlineCode(seg.content);
      if (seg.kind === "fence") return transforms.fence(seg.content, seg.lang);
      return transforms.text(seg.content);
    })
    .join("");
}
