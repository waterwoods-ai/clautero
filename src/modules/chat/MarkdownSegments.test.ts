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

describe("math segments", () => {
  it("extracts inline and display math with TeX content and raw source", () => {
    const segs = segmentMarkdown("energy $E = mc^2$ and $$\\int_0^1 x\\,dx$$ done");
    const inline = segs.find((s) => s.kind === "inline-math");
    const display = segs.find((s) => s.kind === "display-math");
    expect(inline).toMatchObject({ content: "E = mc^2", raw: "$E = mc^2$" });
    expect(display).toMatchObject({ content: "\\int_0^1 x\\,dx" });
  });

  it("supports \\( \\) and \\[ \\] delimiters", () => {
    const segs = segmentMarkdown("a \\(x+1\\) b \\[y^2\\] c");
    expect(segs.find((s) => s.kind === "inline-math")?.content).toBe("x+1");
    expect(segs.find((s) => s.kind === "display-math")?.content).toBe("y^2");
  });

  it("leaves currency-style dollars as text", () => {
    const segs = segmentMarkdown("costs $5 and $10 total");
    expect(segs.every((s) => s.kind === "text")).toBe(true);
  });

  it("never treats math inside code as math", () => {
    const segs = segmentMarkdown("`price = $x$` and\n```\n$y^2$\n```");
    expect(segs.some((s) => s.kind === "inline-math" || s.kind === "display-math")).toBe(false);
    expect(segs.find((s) => s.kind === "inline-code")?.content).toBe("price = $x$");
    expect(segs.find((s) => s.kind === "fence")?.content).toBe("$y^2$");
  });

  it("passes math through verbatim when no math transform is given", () => {
    const md = "see $a_1$ here";
    expect(transformMarkdownSegments(md, identity)).toBe(md);
  });

  it("routes math to the math transforms, protected from prose regexes", () => {
    const out = transformMarkdownSegments("bold **yes** $a*b*c$", {
      text: (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>"),
      inlineCode: (s) => s,
      fence: (s) => s,
      inlineMath: (tex) => `[M:${tex}]`,
      displayMath: (tex) => `[D:${tex}]`,
    });
    expect(out).toContain("<b>yes</b>");
    expect(out).toContain("[M:a*b*c]");
    expect(out).not.toContain("<em>");
  });
});

describe("table segments", () => {
  const table = "| 步骤 | A 方 |\n|---|---|\n| 1 | 初始化 $\\Theta_A$ |";

  it("detects a GFM table as one block segment", () => {
    const segs = segmentMarkdown("before\n" + table + "\nafter");
    const t = segs.find((s) => s.kind === "table");
    expect(t?.content).toBe(table);
    expect(segs.some((s) => s.kind === "inline-math")).toBe(false); // math stays inside the table block
  });

  it("requires a separator row — lone pipe lines stay text", () => {
    const segs = segmentMarkdown("| a | b |\n| c | d |");
    expect(segs.some((s) => s.kind === "table")).toBe(false);
  });

  it("never treats pipe rows inside fences as tables", () => {
    const segs = segmentMarkdown("```\n| a | b |\n|---|---|\n```");
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe("fence");
  });

  it("round-trips a table verbatim without a table transform", () => {
    const md = "x\n" + table + "\ny";
    expect(transformMarkdownSegments(md, identity)).toBe(md);
  });

  it("supports alignment separators", () => {
    const segs = segmentMarkdown("| a | b |\n|:---:|---:|\n| 1 | 2 |");
    expect(segs.find((s) => s.kind === "table")).toBeTruthy();
  });
});
