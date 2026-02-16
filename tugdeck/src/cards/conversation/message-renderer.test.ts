/**
 * Tests for message-renderer - Markdown parsing and sanitization
 * Using happy-dom for DOM environment (DOMPurify requires window/document)
 */

import { describe, test, expect } from "bun:test";
import { Window } from "happy-dom";

// Setup DOM environment BEFORE importing DOMPurify
const window = new Window();
global.window = window as any;
global.document = window.document as any;
global.DOMParser = window.DOMParser as any;

// Now import the module that uses DOMPurify
import { renderMarkdown, SANITIZE_CONFIG } from "./message-renderer";

describe("message-renderer", () => {
  describe("basic Markdown rendering", () => {
    test("heading renders as h1", () => {
      const result = renderMarkdown("# Heading");
      expect(result).toContain("<h1");
      expect(result).toContain("Heading");
    });

    test("bold renders as strong", () => {
      const result = renderMarkdown("**bold text**");
      expect(result).toContain("<strong>");
      expect(result).toContain("bold text");
    });

    test("italic renders as em", () => {
      const result = renderMarkdown("*italic text*");
      expect(result).toContain("<em>");
      expect(result).toContain("italic text");
    });

    test("unordered list renders as ul/li", () => {
      const result = renderMarkdown("- item 1\n- item 2");
      expect(result).toContain("<ul>");
      expect(result).toContain("<li>");
      expect(result).toContain("item 1");
      expect(result).toContain("item 2");
    });

    test("link renders as anchor with href", () => {
      const result = renderMarkdown("[link text](https://example.com)");
      expect(result).toContain("<a");
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain("link text");
    });
  });

  describe("DOMPurify strips dangerous content", () => {
    test("script tags are completely removed", () => {
      const result = renderMarkdown("<script>alert('xss')</script>");
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert");
    });

    test("img onerror attribute is stripped but img is preserved", () => {
      const result = renderMarkdown('<img src="test.jpg" onerror="alert(1)">');
      expect(result).toContain("<img");
      expect(result).toContain('src="test.jpg"');
      expect(result).not.toContain("onerror");
      expect(result).not.toContain("alert");
    });

    test("javascript: URLs are stripped from anchor href", () => {
      const result = renderMarkdown('<a href="javascript:alert(1)">click</a>');
      // DOMPurify strips the href or removes the tag entirely
      expect(result).not.toContain("javascript:");
      expect(result).not.toContain("alert");
    });

    test("inline event handlers are stripped", () => {
      const result = renderMarkdown('<a onclick="alert(1)">click</a>');
      expect(result).not.toContain("onclick");
      expect(result).not.toContain("alert");
    });

    test("onload event handler is stripped", () => {
      const result = renderMarkdown('<img src="x" onload="alert(1)">');
      expect(result).not.toContain("onload");
      expect(result).not.toContain("alert");
    });

    test("iframe is completely removed", () => {
      const result = renderMarkdown('<iframe src="evil.com"></iframe>');
      expect(result).not.toContain("iframe");
      expect(result).not.toContain("evil.com");
    });

    test("object is completely removed", () => {
      const result = renderMarkdown('<object data="evil.swf"></object>');
      expect(result).not.toContain("object");
      expect(result).not.toContain("evil.swf");
    });

    test("embed is completely removed", () => {
      const result = renderMarkdown('<embed src="evil.swf">');
      expect(result).not.toContain("embed");
      expect(result).not.toContain("evil.swf");
    });

    test("form is completely removed", () => {
      const result = renderMarkdown('<form action="/evil"></form>');
      expect(result).not.toContain("form");
      expect(result).not.toContain("/evil");
    });

    test("style is completely removed", () => {
      const result = renderMarkdown('<style>body{display:none}</style>');
      expect(result).not.toContain("<style");
      expect(result).not.toContain("display:none");
    });

    test("svg is completely removed", () => {
      const result = renderMarkdown('<svg><circle/></svg>');
      expect(result).not.toContain("<svg");
      expect(result).not.toContain("circle");
    });

    test("math is completely removed", () => {
      const result = renderMarkdown('<math><mi>x</mi></math>');
      expect(result).not.toContain("<math");
      expect(result).not.toContain("<mi");
    });
  });

  describe("DOMPurify preserves allowed tags", () => {
    test("h1 through h6 are preserved", () => {
      const result = renderMarkdown("# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6");
      expect(result).toContain("<h1");
      expect(result).toContain("<h2");
      expect(result).toContain("<h3");
      expect(result).toContain("<h4");
      expect(result).toContain("<h5");
      expect(result).toContain("<h6");
    });

    test("p, strong, em are preserved", () => {
      const result = renderMarkdown("Normal **bold** *italic*");
      expect(result).toContain("<p");
      expect(result).toContain("<strong>");
      expect(result).toContain("<em>");
    });

    test("a with safe href is preserved", () => {
      const result = renderMarkdown("[link](https://example.com)");
      expect(result).toContain("<a");
      expect(result).toContain('href="https://example.com"');
    });

    test("code and pre are preserved", () => {
      const result = renderMarkdown("`inline code`\n\n```\nfenced code\n```");
      expect(result).toContain("<code>");
      expect(result).toContain("<pre>");
    });

    test("ul, ol, li are preserved", () => {
      const result = renderMarkdown("- unordered\n\n1. ordered");
      expect(result).toContain("<ul>");
      expect(result).toContain("<ol>");
      expect(result).toContain("<li>");
    });

    test("blockquote is preserved", () => {
      const result = renderMarkdown("> quote");
      expect(result).toContain("<blockquote>");
    });

    test("table, thead, tbody, tr, th, td are preserved", () => {
      const result = renderMarkdown("| H1 | H2 |\n|---|---|\n| C1 | C2 |");
      expect(result).toContain("<table");
      expect(result).toContain("<thead");
      expect(result).toContain("<tbody");
      expect(result).toContain("<tr");
      expect(result).toContain("<th");
      expect(result).toContain("<td");
    });

    test("img with safe src is preserved", () => {
      const result = renderMarkdown("![alt](image.jpg)");
      expect(result).toContain("<img");
      expect(result).toContain('alt="alt"');
      expect(result).toContain('src="image.jpg"');
    });
  });

  describe("DOMPurify strips non-allowlisted tags to text content", () => {
    test("div is stripped to text content", () => {
      const result = renderMarkdown("<div>content</div>");
      // User's div should be stripped, but wrapper div is okay
      expect(result).not.toContain("<div>content</div>");
      expect(result).toContain("content");
    });

    test("span is stripped to text content", () => {
      const result = renderMarkdown("<span>content</span>");
      expect(result).not.toContain("<span");
      expect(result).toContain("content");
    });

    test("section is stripped to text content", () => {
      const result = renderMarkdown("<section>content</section>");
      expect(result).not.toContain("<section");
      expect(result).toContain("content");
    });
  });

  describe("golden test", () => {
    test("complex Markdown produces expected sanitized HTML", () => {
      const markdown = `# Heading

This is a paragraph with **bold**, *italic*, and \`inline code\`.

- List item 1
- List item 2

[Safe link](https://example.com)

\`\`\`
code block
\`\`\`

> Blockquote

<script>alert('xss')</script>
<div>stripped to text</div>`;

      const result = renderMarkdown(markdown);

      // Allowed tags present
      expect(result).toContain("<h1");
      expect(result).toContain("Heading");
      expect(result).toContain("<p");
      expect(result).toContain("<strong>");
      expect(result).toContain("bold");
      expect(result).toContain("<em>");
      expect(result).toContain("italic");
      expect(result).toContain("<code>");
      expect(result).toContain("inline code");
      expect(result).toContain("<ul>");
      expect(result).toContain("<li>");
      expect(result).toContain("List item 1");
      expect(result).toContain("<a");
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain("<pre>");
      expect(result).toContain("code block");
      expect(result).toContain("<blockquote>");
      expect(result).toContain("Blockquote");

      // Dangerous content stripped
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert");
      // Check that user's <div> was stripped but text preserved
      expect(result).toContain("stripped to text");
      expect(result).not.toContain("<div>stripped to text</div>");

      // Wrapper present
      expect(result).toContain('class="conversation-prose"');
    });
  });

  describe("SANITIZE_CONFIG matches frozen allowlist", () => {
    test("ALLOWED_TAGS matches D05 spec", () => {
      const expected = [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'p', 'br', 'hr',
        'strong', 'em', 'del', 'sup', 'sub',
        'a', 'code', 'pre',
        'ul', 'ol', 'li',
        'blockquote',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'img',
      ];
      expect(SANITIZE_CONFIG.ALLOWED_TAGS).toEqual(expected);
    });

    test("FORBID_TAGS includes dangerous elements", () => {
      const dangerous = ['script', 'iframe', 'object', 'embed', 'form'];
      for (const tag of dangerous) {
        expect(SANITIZE_CONFIG.FORBID_TAGS).toContain(tag);
      }
    });

    test("FORBID_ATTR includes event handlers", () => {
      const events = ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'];
      for (const attr of events) {
        expect(SANITIZE_CONFIG.FORBID_ATTR).toContain(attr);
      }
    });
  });
});
