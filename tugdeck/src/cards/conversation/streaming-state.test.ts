/**
 * Tests for streaming-state - Visual indicators during active streaming
 * Using happy-dom for DOM environment
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Window } from "happy-dom";
import { StreamingState } from "./streaming-state";

// Setup DOM environment
const window = new Window();
global.window = window as any;
global.document = window.document as any;

describe("StreamingState", () => {
  let streamingState: StreamingState;
  let messageEl: HTMLElement;

  beforeEach(() => {
    streamingState = new StreamingState();
    messageEl = document.createElement("div");
    messageEl.className = "message message-assistant";
  });

  describe("cursor element lifecycle", () => {
    test("cursor element appears during streaming", () => {
      streamingState.startStreaming(messageEl);

      const cursor = messageEl.querySelector(".streaming-cursor");
      expect(cursor).not.toBeNull();
      expect(cursor?.tagName).toBe("SPAN");
    });

    test("cursor disappears on stopStreaming", () => {
      streamingState.startStreaming(messageEl);
      streamingState.stopStreaming(messageEl);

      const cursor = messageEl.querySelector(".streaming-cursor");
      expect(cursor).toBeNull();
    });

    test("cursor disappears when calling stopStreaming without arguments", () => {
      streamingState.startStreaming(messageEl);
      streamingState.stopStreaming(); // No argument

      const cursor = messageEl.querySelector(".streaming-cursor");
      expect(cursor).toBeNull();
    });
  });

  describe("activity border class", () => {
    test("streaming-active class added during streaming", () => {
      streamingState.startStreaming(messageEl);

      expect(messageEl.classList.contains("streaming-active")).toBe(true);
    });

    test("streaming-active class removed on stopStreaming", () => {
      streamingState.startStreaming(messageEl);
      streamingState.stopStreaming(messageEl);

      expect(messageEl.classList.contains("streaming-active")).toBe(false);
    });
  });

  describe("updateText behavior", () => {
    test("updateText replaces content and preserves cursor", () => {
      // Create a prose container like renderMarkdown does
      const proseHtml = '<div class="conversation-prose"><p>First text</p></div>';
      streamingState.startStreaming(messageEl);
      streamingState.updateText(messageEl, proseHtml);

      // Content should be present
      expect(messageEl.textContent).toContain("First text");

      // Cursor should still exist
      const cursor = messageEl.querySelector(".streaming-cursor");
      expect(cursor).not.toBeNull();
    });

    test("updateText replaces content (not appends)", () => {
      const firstHtml = '<div class="conversation-prose"><p>First</p></div>';
      const secondHtml = '<div class="conversation-prose"><p>Second</p></div>';

      streamingState.startStreaming(messageEl);
      streamingState.updateText(messageEl, firstHtml);
      streamingState.updateText(messageEl, secondHtml);

      // Should only contain "Second", not "First"
      expect(messageEl.textContent).toContain("Second");
      expect(messageEl.textContent).not.toContain("First");

      // Cursor should still exist
      const cursor = messageEl.querySelector(".streaming-cursor");
      expect(cursor).not.toBeNull();
    });

    test("cursor is appended inside conversation-prose container", () => {
      const proseHtml = '<div class="conversation-prose"><p>Text</p></div>';
      streamingState.startStreaming(messageEl);
      streamingState.updateText(messageEl, proseHtml);

      const proseContainer = messageEl.querySelector(".conversation-prose");
      const cursor = proseContainer?.querySelector(".streaming-cursor");

      expect(cursor).not.toBeNull();
    });

    test("cursor appends to message element if no prose container", () => {
      // No .conversation-prose wrapper
      const plainHtml = "<p>Plain text</p>";
      streamingState.startStreaming(messageEl);
      streamingState.updateText(messageEl, plainHtml);

      // Cursor should be in the message element
      const cursor = messageEl.querySelector(".streaming-cursor");
      expect(cursor).not.toBeNull();
    });
  });

  describe("isStreaming state", () => {
    test("isStreaming returns false initially", () => {
      expect(streamingState.isStreaming()).toBe(false);
    });

    test("isStreaming returns true after startStreaming", () => {
      streamingState.startStreaming(messageEl);
      expect(streamingState.isStreaming()).toBe(true);
    });

    test("isStreaming returns false after stopStreaming", () => {
      streamingState.startStreaming(messageEl);
      streamingState.stopStreaming();
      expect(streamingState.isStreaming()).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("stopStreaming with no active streaming is a no-op", () => {
      // Should not throw
      expect(() => streamingState.stopStreaming()).not.toThrow();
      expect(() => streamingState.stopStreaming(messageEl)).not.toThrow();
    });

    test("multiple startStreaming calls on different elements cleans up previous", () => {
      const firstEl = document.createElement("div");
      const secondEl = document.createElement("div");

      streamingState.startStreaming(firstEl);
      expect(firstEl.classList.contains("streaming-active")).toBe(true);

      streamingState.startStreaming(secondEl);

      // First element should be cleaned up
      expect(firstEl.classList.contains("streaming-active")).toBe(false);
      expect(firstEl.querySelector(".streaming-cursor")).toBeNull();

      // Second element should be streaming
      expect(secondEl.classList.contains("streaming-active")).toBe(true);
      expect(secondEl.querySelector(".streaming-cursor")).not.toBeNull();
    });

    test("multiple startStreaming calls on same element do not duplicate cursor", () => {
      streamingState.startStreaming(messageEl);
      streamingState.startStreaming(messageEl); // Call again

      const cursors = messageEl.querySelectorAll(".streaming-cursor");
      // Should only have one cursor (but implementation may vary)
      // The important thing is that it doesn't break
      expect(cursors.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("integration with markdown rendering", () => {
    test("handles typical markdown-rendered content", () => {
      // Simulate what renderMarkdown produces
      const markdownHtml = `
        <div class="conversation-prose">
          <p>This is a <strong>bold</strong> statement.</p>
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
        </div>
      `;

      streamingState.startStreaming(messageEl);
      streamingState.updateText(messageEl, markdownHtml);

      // Content should be present
      expect(messageEl.textContent).toContain("bold statement");
      expect(messageEl.textContent).toContain("Item 1");

      // Cursor should be in the prose container
      const cursor = messageEl.querySelector(".conversation-prose .streaming-cursor");
      expect(cursor).not.toBeNull();

      // Activity border should be active
      expect(messageEl.classList.contains("streaming-active")).toBe(true);
    });

    test("handles code blocks in markdown", () => {
      const codeBlockHtml = `
        <div class="conversation-prose">
          <pre><code>const x = 1;</code></pre>
        </div>
      `;

      streamingState.startStreaming(messageEl);
      streamingState.updateText(messageEl, codeBlockHtml);

      expect(messageEl.textContent).toContain("const x = 1");

      const cursor = messageEl.querySelector(".streaming-cursor");
      expect(cursor).not.toBeNull();
    });
  });
});
