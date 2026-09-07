import { describe, it, expect } from "vitest";
import { segmentMarkdown, transformMarkdownSegments } from "./MarkdownSegments";

const identity = {
  text: (s: string) => s,
  inlineCode: (s: string) => "`" + s + "`",
  fence: (s: string, lang?: string) => "```" + (lang ?? "") + "\n" + s + "\n```",
};

describe("segmentMarkdown", () => {
  it("splits inline code out of prose", () => {
    const segs = segmentMarkdown("use `foo()` here");
    expect(segs.map((s) => s.kind)).toEqual(["text", "inline-code", "text"]);
    expect(segs[1].content).toBe("foo()");
  });

  it("keeps multi-backtick inline runs intact", () => {
    const segs = segmentMarkdown("say ``a ` b`` ok");
    expect(segs[1]).toMatchObject({ kind: "inline-code", content: "a ` b" });
  });

  it("captures fenced blocks with language", () => {
    const segs = segmentMarkdown("before\n```ts\nconst x = 1;\n```\nafter");
    const fence = segs.find((s) => s.kind === "fence");
    expect(fence).toMatchObject({ content: "const x = 1;", lang: "ts" });
  });

  it("does not treat markdown inside a fence as anything but code", () => {
    const segs = segmentMarkdown("```\n**not bold**\n- not a list\n```");
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe("fence");
    expect(segs[0].content).toBe("**not bold**\n- not a list");
  });

  it("supports tilde fences and keeps backticks inside them", () => {
    const segs = segmentMarkdown("~~~\n`tick`\n~~~");
    expect(segs[0]).toMatchObject({ kind: "fence", content: "`tick`" });
  });

  it("treats an unclosed fence as code to EOF", () => {
    const segs = segmentMarkdown("```py\nprint(1)");
    expect(segs[0]).toMatchObject({ kind: "fence", content: "print(1)", lang: "py" });
  });
});

describe("transformMarkdownSegments", () => {
  it("only transforms prose, leaving code segments to their own transform", () => {
    const md = "**b** `**not**`\n```\n**no**\n```";
    const out = transformMarkdownSegments(md, {
      text: (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>"),
      inlineCode: (s) => `[C:${s}]`,
      fence: (s) => `[F:${s}]`,
    });
    expect(out).toContain("<b>b</b>");
    expect(out).toContain("[C:**not**]");
    expect(out).toContain("[F:**no**]");
    expect(out).not.toContain("<b>not</b>");
  });

  it("round-trips prose and fences with identity transforms", () => {
    const md = "hello `x` world\n```js\n1\n```\ntail";
    expect(transformMarkdownSegments(md, identity)).toBe(md + "");
  });
});
