/**
 * `ansiToHtml` — pure-function tests.
 *
 * Coverage:
 *  - Empty / whitespace input → empty result.
 *  - 16-color SGR codes emit `class="ansi-{color}-fg|bg"` so theme
 *    tokens can paint them.
 *  - Bold / underline emit inline `style` (font-weight /
 *    text-decoration). 256-color / truecolor emit inline
 *    `style="color:rgb(…)"` (out-of-theme by design — see module
 *    docstring).
 *  - HTML-escaping: source text containing `<`, `>`, `&`, quotes
 *    survives sanitize as text nodes, never as live markup.
 *  - Sanitize: malicious `<script>` / `<iframe>` / event handlers in
 *    the source text are stripped (defense-in-depth — `ansi_up`
 *    already escapes; DOMPurify is the second line).
 *  - Multi-line spans: a color started on line 1 and reset on line 2
 *    spans the newline in the output (preserves `\n` literally).
 */

import { describe, expect, test } from "bun:test";

import { ansiToHtml } from "../ansi-to-html";

describe("ansiToHtml — empty / non-string", () => {
  test("empty string → ''", () => {
    expect(ansiToHtml("")).toBe("");
  });

  test("whitespace-only passes through escaped", () => {
    expect(ansiToHtml("   ")).toBe("   ");
  });
});

describe("ansiToHtml — 16-color SGR (class-encoded)", () => {
  test("red foreground → ansi-red-fg span", () => {
    const out = ansiToHtml("\x1b[31mred\x1b[0m");
    expect(out).toContain('class="ansi-red-fg"');
    expect(out).toContain(">red</span>");
  });

  test("green background → ansi-green-bg span", () => {
    const out = ansiToHtml("\x1b[42mgrn\x1b[0m");
    expect(out).toContain('class="ansi-green-bg"');
  });

  test("combined fg + bg + bold → both classes + bold style", () => {
    const out = ansiToHtml("\x1b[1;31;42mall\x1b[0m");
    expect(out).toContain("ansi-red-fg");
    expect(out).toContain("ansi-green-bg");
    expect(out).toMatch(/font-weight:\s*bold/);
  });
});

describe("ansiToHtml — inline-style code paths", () => {
  test("bold uses inline style (no class for it)", () => {
    const out = ansiToHtml("\x1b[1mbold\x1b[0m");
    expect(out).toMatch(/font-weight:\s*bold/);
    expect(out).toContain("bold</span>");
  });

  test("underline uses text-decoration", () => {
    const out = ansiToHtml("\x1b[4mund\x1b[0m");
    expect(out).toMatch(/text-decoration:\s*underline/);
  });

  test("256-color foreground uses inline rgb()", () => {
    const out = ansiToHtml("\x1b[38;5;208morange\x1b[0m");
    expect(out).toMatch(/color:\s*rgb\(/);
    expect(out).toContain("orange");
  });

  test("truecolor (24-bit) foreground uses inline rgb()", () => {
    const out = ansiToHtml("\x1b[38;2;255;100;0morange\x1b[0m");
    expect(out).toMatch(/color:\s*rgb\(/);
  });
});

describe("ansiToHtml — escaping + sanitize", () => {
  test("source `<` `>` `&` are escaped to entities, not live markup", () => {
    const out = ansiToHtml("just text & a <tag>");
    // Either &lt; or `<` would survive; we want the escaped form so
    // user-controlled input cannot inject HTML.
    expect(out).not.toMatch(/<tag>/);
    expect(out).toContain("&lt;");
    expect(out).toContain("&gt;");
    expect(out).toContain("&amp;");
  });

  test("malicious <script> in source survives only as escaped text, not live markup", () => {
    const out = ansiToHtml("<script>alert(1)</script>");
    // `<script>` becomes `&lt;script&gt;` — the literal `<script>`
    // sequence (i.e., a real opening tag, with `<` followed by
    // `script` and a tag-close character) must not appear.
    expect(out).not.toMatch(/<script[\s>]/i);
    expect(out).toContain("&lt;script&gt;");
    // The text content "alert(1)" survives but it is no longer code,
    // just text — that's the safety guarantee.
  });

  test("malicious onerror attribute in source survives only as escaped text", () => {
    const out = ansiToHtml('<img src=x onerror="alert(1)">');
    // No live `<img>` element.
    expect(out).not.toMatch(/<img[\s>]/i);
    // The dangerous `<` is escaped, which renders the whole construct
    // inert. The `onerror=` substring may appear inside the escaped
    // text node, but it is not an attribute on a live element.
    expect(out).toContain("&lt;img");
  });
});

describe("ansiToHtml — multi-line behavior", () => {
  test("plain newlines are preserved as `\\n` (caller splits to lines)", () => {
    const out = ansiToHtml("line 1\nline 2\n");
    expect(out).toContain("line 1");
    expect(out).toContain("line 2");
    expect(out).toContain("\n");
  });

  test("a color span across a newline survives intact", () => {
    const out = ansiToHtml("\x1b[31mline 1\nline 2\x1b[0m\nline 3");
    expect(out).toMatch(/<span class="ansi-red-fg">line 1\nline 2<\/span>/);
    expect(out).toContain("line 3");
  });
});
