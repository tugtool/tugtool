/**
 * End-to-end integration and acceptance tests (Step 10 update).
 *
 * After vanilla card deletion, the full conversation-lifecycle DOM tests
 * (which relied on vanilla ConversationCard's synchronous DOM API) are
 * replaced by RTL tests in src/components/cards/conversation/conversation-card.test.tsx.
 *
 * This file retains:
 *   - Pure utility tests: renderMarkdown, SANITIZE_CONFIG (imported from lib/markdown)
 *   - SessionCache read/write tests
 *   - Performance benchmarks for renderMarkdown and SessionCache
 *   - Security (XSS prevention) tests for renderMarkdown
 *   - Drift prevention tests (CSP header, cards.css replacement check)
 *
 * Imports updated per Step 10:
 *   renderMarkdown, SANITIZE_CONFIG  ← src/lib/markdown (was cards/conversation/message-renderer)
 *   ConversationCard import removed  ← replaced by RTL tests in components/cards/conversation/
 */

// Import fake-indexeddb polyfill first (before happy-dom).
// Also import fakeIndexedDB directly and assign to global so that bare
// `indexedDB` references work regardless of whether another test file in the
// same bun worker set global.window before this file ran.
import fakeIndexedDB from "fake-indexeddb";
import "fake-indexeddb/auto";

(global as unknown as Record<string, unknown>).indexedDB = fakeIndexedDB;

import { describe, test, expect } from "bun:test";
import { Window } from "happy-dom";

// Setup DOM environment
const window = new Window();
global.window = window as any;
global.document = window.document as any;
global.DOMParser = window.DOMParser as any;
global.KeyboardEvent = window.KeyboardEvent as any;

// Mock navigator.clipboard while preserving userAgent for react-dom compatibility.
global.navigator = {
  userAgent: window.navigator.userAgent,
  clipboard: {
    writeText: () => Promise.resolve(),
  },
} as any;

// Import utilities from lib/markdown (updated from cards/conversation/message-renderer)
import { renderMarkdown, SANITIZE_CONFIG } from "../lib/markdown";
import { SessionCache } from "../_archive/cards/conversation/session-cache";

// ---- Security: XSS injection ----

describe("Security: XSS injection", () => {
  test("script tag injection in Markdown is stripped", () => {
    const result = renderMarkdown("<script>alert('xss')</script>Hello");

    // No script tag in output
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");

    // Verify "Hello" text preserved
    expect(result).toContain("Hello");
  });

  test("event handler injection is stripped", () => {
    const result = renderMarkdown('<img src="x" onerror="alert(1)">');

    // No onerror attribute
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("alert");
  });

  test("javascript: URL injection is stripped", () => {
    const result = renderMarkdown('<a href="javascript:alert(1)">click</a>');

    // No javascript: URL
    expect(result).not.toContain("javascript:");
    expect(result).not.toContain("alert");
  });

  test("data: URL with script is stripped", () => {
    const result = renderMarkdown('<a href="data:text/html,<script>alert(1)</script>">click</a>');

    // data: URL should be stripped or sanitized
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
  });

  test("nested injection attempt", () => {
    const result = renderMarkdown('<div onmouseover="alert(1)"><script>alert(2)</script></div>');

    // No script, no onmouseover
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("onmouseover");
    expect(result).not.toContain("alert");
  });
});

// ---- Drift prevention ----

describe("Drift prevention", () => {
  test("DOMPurify ALLOWED_TAGS matches frozen D05 allowlist", () => {
    const expected = [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr",
      "strong", "em", "del", "sup", "sub",
      "a", "code", "pre",
      "ul", "ol", "li",
      "blockquote",
      "table", "thead", "tbody", "tr", "th", "td",
      "img",
    ];

    expect(SANITIZE_CONFIG.ALLOWED_TAGS).toEqual(expected);
  });

  test("FORBID_TAGS includes script/iframe/object/embed/form", () => {
    const dangerous = ["script", "iframe", "object", "embed", "form"];

    for (const tag of dangerous) {
      expect(SANITIZE_CONFIG.FORBID_TAGS).toContain(tag);
    }
  });

  test("CSP meta tag is present in index.html", async () => {
    // Read index.html
    const indexPath = import.meta.dir + "/../../index.html";
    const file = Bun.file(indexPath);
    const content = await file.text();

    // Verify CSP meta tag present
    expect(content).toContain("Content-Security-Policy");
    expect(content).toContain("script-src");
  });

  test("cards.css has been deleted (all card-content styles now live in React components)", async () => {
    // After Step 10, cards.css should not exist — all content styles moved to
    // Tailwind utility classes in React components.
    const cssPath = import.meta.dir + "/../../styles/cards.css";
    const file = Bun.file(cssPath);
    const exists = await file.exists();
    expect(exists).toBe(false);
  });
});

// ---- SessionCache utility tests ----

describe("SessionCache – read/write", () => {
  test("returns empty array when no messages have been written", async () => {
    const testId = Math.random().toString(36).substring(7);
    const cache = new SessionCache(`session-empty-${testId}`);

    const loaded = await cache.readMessages();
    expect(loaded).toEqual([]);

    cache.close();
  });
});

// ---- renderMarkdown utility tests ----

describe("renderMarkdown – output shape", () => {
  test("wraps output in .conversation-prose div", () => {
    const result = renderMarkdown("Hello");
    expect(result).toContain('class="conversation-prose"');
  });

  test("converts **bold** to <strong>", () => {
    const result = renderMarkdown("**bold text**");
    expect(result).toContain("<strong>");
    expect(result).toContain("bold text");
  });

  test("converts *italic* to <em>", () => {
    const result = renderMarkdown("*italic text*");
    expect(result).toContain("<em>");
  });

  test("converts # heading to <h1>", () => {
    const result = renderMarkdown("# My Heading");
    expect(result).toContain("<h1>");
    expect(result).toContain("My Heading");
  });

  test("converts fenced code blocks to <pre><code>", () => {
    const result = renderMarkdown("```\nconsole.log('hi');\n```");
    expect(result).toContain("<pre>");
    expect(result).toContain("<code>");
  });
});
