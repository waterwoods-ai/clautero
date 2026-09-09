/**
 * MarkdownSegments — a code-aware markdown splitter.
 *
 * Splits markdown into text / inline-code / fenced-code segments so that
 * formatting transforms (bold, lists, line breaks…) can run on prose only,
 * never inside code. Eliminates the "regex ate my code block" bug class.
 * Modeled on Claudian's utils/markdownSegments.ts, trimmed to what
 * Clautero's renderer needs (backtick + tilde fences, inline code runs).
 */

export type SegmentKind = "text" | "inline-code" | "fence" | "inline-math" | "display-math" | "table";

export interface Segment {
  readonly kind: SegmentKind;
  /** Segment content. For fences: inner lines only. For math: the TeX. */
  readonly content: string;
  /** Fence info string's first word (e.g. "ts"), when present. */
  readonly lang?: string;
  /** Original source including delimiters (math segments). */
  readonly raw?: string;
}

export interface SegmentTransforms {
  readonly text: (content: string) => string;
  readonly inlineCode: (code: string) => string;
  readonly fence: (code: string, lang?: string) => string;
  /** LaTeX transforms; when omitted, math passes through verbatim. */
  readonly inlineMath?: (tex: string, raw: string) => string;
  readonly displayMath?: (tex: string, raw: string) => string;
  /** GFM table transform; when omitted, tables pass through verbatim. */
  readonly table?: (content: string) => string;
}

const PIPE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;

function splitMath(text: string, out: Segment[]): void {
  // Display math first ($…$ / \[…\]), then inline ($…$ / \(…\)) in the rest.
  const displayRe = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = displayRe.exec(text)) !== null) {
    if (match.index > last) {
      splitInlineMath(text.slice(last, match.index), out);
    }
    out.push({ kind: "display-math", content: (match[1] ?? match[2]).trim(), raw: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    splitInlineMath(text.slice(last), out);
  }
}

function splitInlineMath(text: string, out: Segment[]): void {
  const inlineRe = /\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = inlineRe.exec(text)) !== null) {
    const tex = match[1] ?? match[2];
    // Reject currency-style dollars: "$5 and $10" ("5 and " ends with space).
    const isDollarForm = match[1] === undefined;
    if (isDollarForm && (/^\s/.test(tex) || /\s$/.test(tex))) {
      continue; // leave for the surrounding text segment
    }
    if (match.index > last) {
      out.push({ kind: "text", content: text.slice(last, match.index) });
    }
    out.push({ kind: "inline-math", content: tex.trim(), raw: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    out.push({ kind: "text", content: text.slice(last) });
  }
}

function splitInline(text: string, out: Segment[]): void {
  // Inline code first: a run of N backticks closed by the same run length.
  // Math inside code spans stays code; math is split from the remaining text.
  const re = /(`+)([\s\S]+?)\1/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      splitMath(text.slice(last, match.index), out);
    }
    out.push({ kind: "inline-code", content: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    splitMath(text.slice(last), out);
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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

    // GFM table: a pipe row whose next line is the separator row
    if (PIPE_ROW.test(line) && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      flushText(true);
      const tableLines = [line, lines[i + 1]];
      let j = i + 2;
      while (j < lines.length && PIPE_ROW.test(lines[j])) {
        tableLines.push(lines[j]);
        j++;
      }
      segments.push(Object.freeze({ kind: "table" as const, content: tableLines.join("\n") }));
      // Restore the separator newline, as after a fence close
      textBuffer.push("");
      i = j - 1;
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
      if (seg.kind === "inline-math") {
        return transforms.inlineMath
          ? transforms.inlineMath(seg.content, seg.raw ?? seg.content)
          : (seg.raw ?? seg.content);
      }
      if (seg.kind === "display-math") {
        return transforms.displayMath
          ? transforms.displayMath(seg.content, seg.raw ?? seg.content)
          : (seg.raw ?? seg.content);
      }
      if (seg.kind === "table") {
        return transforms.table ? transforms.table(seg.content) : seg.content;
      }
      return transforms.text(seg.content);
    })
    .join("");
}
