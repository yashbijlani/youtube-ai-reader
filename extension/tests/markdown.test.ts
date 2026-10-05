// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/lib/markdown";

describe("renderMarkdown", () => {
  it("renders markdown basics", () => {
    const html = renderMarkdown("# Title\n\n- one\n- two\n\n**bold**");
    expect(html).toContain("<h1");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("turns [mm:ss] timestamps into clickable buttons", () => {
    const html = renderMarkdown("He argues this at [17:32] clearly.");
    expect(html).toContain('data-ts="17:32"');
    expect(html).toContain("ts-link");
  });

  it("does not linkify timestamps inside code", () => {
    const html = renderMarkdown("Use `[0:05]` and\n\n```\n[1:00]\n```\n");
    expect(html).not.toContain('data-ts="0:05"');
    expect(html).not.toContain('data-ts="1:00"');
  });

  it("sanitizes dangerous html", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">hello');
    expect(html).not.toContain("onerror");
  });
});
