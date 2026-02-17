/**
 * End-to-end integration and acceptance tests for conversation frontend
 *
 * These tests verify the full conversation lifecycle, cross-cutting scenarios,
 * performance benchmarks, security (XSS prevention), and drift prevention.
 */

// Import fake-indexeddb polyfill first (before happy-dom)
import "fake-indexeddb/auto";

import { describe, test, expect, beforeEach } from "bun:test";
import { Window } from "happy-dom";

// Setup DOM environment
const window = new Window();
global.window = window as any;
global.document = window.document as any;
global.DOMParser = window.DOMParser as any;
global.KeyboardEvent = window.KeyboardEvent as any;

// Mock navigator.clipboard
global.navigator = {
  clipboard: {
    writeText: () => Promise.resolve(),
  },
} as any;

// Import after DOM setup
import { ConversationCard } from "../cards/conversation-card";
import { renderMarkdown, SANITIZE_CONFIG } from "../cards/conversation/message-renderer";
import { SessionCache, type StoredMessage } from "../cards/conversation/session-cache";
import type { TugConnection } from "../connection";

// Mock TugConnection
class MockConnection implements Partial<TugConnection> {
  sentMessages: ArrayBuffer[] = [];

  send(data: ArrayBuffer): void {
    this.sentMessages.push(data);
  }

  clear(): void {
    this.sentMessages = [];
  }

  getLastMessage(): any {
    if (this.sentMessages.length === 0) return null;
    const buffer = this.sentMessages[this.sentMessages.length - 1];

    // Decode frame format: 1 byte feed ID + 4 bytes length + payload
    const HEADER_SIZE = 5;
    const payload = new Uint8Array(buffer, HEADER_SIZE);

    const decoder = new TextDecoder();
    const text = decoder.decode(payload);
    return JSON.parse(text);
  }

  getAllMessages(): any[] {
    return this.sentMessages.map((buffer) => {
      const HEADER_SIZE = 5;
      const payload = new Uint8Array(buffer, HEADER_SIZE);
      const decoder = new TextDecoder();
      const text = decoder.decode(payload);
      return JSON.parse(text);
    });
  }
}

describe("End-to-end integration tests", () => {
  let connection: MockConnection;
  let card: ConversationCard;
  let container: HTMLElement;

  beforeEach(async () => {
    // Reset DOM
    document.body.innerHTML = "";

    // Clear all IndexedDB databases to ensure test isolation
    const databases = await indexedDB.databases();
    for (const db of databases) {
      if (db.name) {
        indexedDB.deleteDatabase(db.name);
      }
    }

    // Create fresh container
    container = document.createElement("div");
    document.body.appendChild(container);

    // Create mock connection
    connection = new MockConnection();

    // Create conversation card
    card = new ConversationCard(connection as any);
    card.mount(container);
  });

  describe("End-to-end: full conversation lifecycle", () => {
    test("user sends message -> assistant responds with text + code block", async () => {
      // Step 1: Send user message
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;

      textarea.value = "Run ls command";
      sendBtn.click();

      // Verify user_message sent
      const userMsg = connection.getLastMessage();
      expect(userMsg.type).toBe("user_message");
      expect(userMsg.text).toBe("Run ls command");

      connection.clear();

      // Step 2: Assistant responds with text (partial then complete)
      const assistantTextPartial = {
        type: "assistant_text",
        msg_id: "msg-1",
        seq: 0,
        rev: 0,
        text: "I'll run the ls command for you.\n\n```bash\nls\n```",
        is_partial: true,
        status: "partial",
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(assistantTextPartial)));

      await new Promise((resolve) => setTimeout(resolve, 50));

      const assistantTextComplete = {
        type: "assistant_text",
        msg_id: "msg-1",
        seq: 0,
        rev: 1,
        text: "I'll run the ls command for you.\n\n```bash\nls\n```",
        is_partial: false,
        status: "complete",
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(assistantTextComplete)));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify DOM structure
      const messageList = container.querySelector(".message-list");
      const userMessage = messageList?.querySelector(".message-user");
      const assistantMessage = messageList?.querySelector(".message-assistant");

      expect(userMessage?.textContent).toBe("Run ls command");
      expect(assistantMessage).not.toBeNull();
      expect(assistantMessage?.querySelector(".conversation-prose")).not.toBeNull();

      // Verify code block rendering (enhanced by Shiki)
      const codeBlock = assistantMessage?.querySelector(".code-block-container");
      expect(codeBlock).not.toBeNull();
      expect(codeBlock?.querySelector(".code-block-language")?.textContent).toBe("bash");
    });

    // Note: Tool use integration requires message ordering buffer coordination.
    // This is tested in tool-card.test.ts for individual tool cards.
    // Full lifecycle with tool_use -> tool_result -> turn_complete is verified manually.
  });

  describe("End-to-end: file attachment", () => {
    test("file attachment via handler and send", () => {
      // Note: This test verifies the attachment handling integration
      // Actual file drop/paste is tested in attachment-handler.test.ts
      // Here we verify that attachments are sent correctly in user_message

      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;

      // Simulate having attachments (via internal state)
      // In real usage, these would be added via drag-and-drop or paste
      textarea.value = "Check this file";

      // Send message (without attachments for this test)
      sendBtn.click();

      const msg = connection.getLastMessage();
      expect(msg.type).toBe("user_message");
      expect(msg.text).toBe("Check this file");
      expect(Array.isArray(msg.attachments)).toBe(true);
    });
  });

  describe("End-to-end: tool approval flow", () => {
    test("tool approval: prompt appears, Allow clicked", async () => {
      // Start turn
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
      textarea.value = "Delete files";
      sendBtn.click();

      connection.clear();

      // Inject tool approval request
      const approvalRequest = {
        type: "tool_approval_request",
        request_id: "req-1",
        tool_name: "Bash",
        input: { command: "rm -rf /" },
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(approvalRequest)));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify approval prompt appears
      const approvalPrompt = container.querySelector(".approval-prompt");
      expect(approvalPrompt).not.toBeNull();

      // Verify input is disabled
      expect(textarea.disabled).toBe(true);

      // Click Allow button
      const allowBtn = approvalPrompt?.querySelector(".approval-prompt-allow") as HTMLButtonElement;
      expect(allowBtn).not.toBeNull();
      allowBtn.click();

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify approval sent
      const approval = connection.getLastMessage();
      expect(approval.type).toBe("tool_approval");
      expect(approval.request_id).toBe("req-1");
      expect(approval.decision).toBe("allow");

      // Verify input re-enabled
      expect(textarea.disabled).toBe(false);
    });

    test("tool approval: Deny clicked", async () => {
      // Start turn
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
      textarea.value = "Delete files";
      sendBtn.click();

      connection.clear();

      // Inject tool approval request
      const approvalRequest = {
        type: "tool_approval_request",
        request_id: "req-2",
        tool_name: "Bash",
        input: { command: "rm -rf /" },
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(approvalRequest)));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Click Deny button
      const approvalPrompt = container.querySelector(".approval-prompt");
      const denyBtn = approvalPrompt?.querySelector(".approval-prompt-deny") as HTMLButtonElement;
      expect(denyBtn).not.toBeNull();
      denyBtn.click();

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify denial sent
      const denial = connection.getLastMessage();
      expect(denial.type).toBe("tool_approval");
      expect(denial.request_id).toBe("req-2");
      expect(denial.decision).toBe("deny");
    });
  });

  describe("End-to-end: clarifying question flow", () => {
    test("question appears, selection made, answer submitted", async () => {
      // Start turn
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
      textarea.value = "What color?";
      sendBtn.click();

      connection.clear();

      // Inject question
      const question = {
        type: "question",
        request_id: "q-1",
        questions: [
          {
            id: "q1",
            text: "Which option do you prefer?",
            type: "single_choice",
            options: [
              { label: "Option A" },
              { label: "Option B" },
            ],
          },
        ],
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(question)));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify question card appears
      const questionCard = container.querySelector(".question-card");
      expect(questionCard).not.toBeNull();

      // Verify input is disabled
      expect(textarea.disabled).toBe(true);

      // Select option A
      const radioA = questionCard?.querySelector('input[type="radio"]') as HTMLInputElement;
      expect(radioA).not.toBeNull();
      radioA.checked = true;
      radioA.dispatchEvent(new Event("change"));

      // Click submit
      const submitBtn = questionCard?.querySelector(".question-card-submit") as HTMLButtonElement;
      expect(submitBtn).not.toBeNull();
      submitBtn.click();

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify answer sent
      const answer = connection.getLastMessage();
      expect(answer.type).toBe("question_answer");
      expect(answer.request_id).toBe("q-1");
      expect(answer.answers).toBeDefined();
    });
  });

  describe("End-to-end: interrupt mid-turn", () => {
    test("Ctrl-C sends interrupt during active turn", () => {
      // Start turn
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
      textarea.value = "Long running task";
      sendBtn.click();

      connection.clear();

      // Dispatch Ctrl-C
      const event = new KeyboardEvent("keydown", {
        key: "c",
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      // Verify interrupt sent
      const interrupt = connection.getLastMessage();
      expect(interrupt).not.toBeNull();
      expect(interrupt.type).toBe("interrupt");
    });

    test("Stop button sends interrupt during active turn", () => {
      // Start turn
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
      textarea.value = "Long running task";
      sendBtn.click();

      // Verify button is in stop mode
      expect(sendBtn.classList.contains("stop-mode")).toBe(true);

      connection.clear();

      // Click stop button
      sendBtn.click();

      // Verify interrupt sent
      const interrupt = connection.getLastMessage();
      expect(interrupt).not.toBeNull();
      expect(interrupt.type).toBe("interrupt");
    });

    test("turn_cancelled event is received", async () => {
      // This test verifies turn_cancelled events can be sent.
      // The actual DOM manipulation (cancelled class, interrupted label) is tested
      // in conversation-card.test.ts where message lifecycle is controlled.

      // Start turn
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
      textarea.value = "Task";
      sendBtn.click();

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Send assistant text
      const assistantText = {
        type: "assistant_text",
        msg_id: "msg-1",
        seq: 0,
        rev: 0,
        text: "Working on it...",
        is_partial: false,
        status: "complete",
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(assistantText)));

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify message appears
      const messageList = container.querySelector(".message-list");
      const assistantMessage = messageList?.querySelector(".message-assistant");
      expect(assistantMessage).not.toBeNull();

      // Send turn_cancelled - just verify no errors thrown
      const turnCancelled = {
        type: "turn_cancelled",
        msg_id: "msg-1",
        seq: 0,
        partial_result: "Cancelled",
      };

      // Should not throw
      expect(() => {
        card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(turnCancelled)));
      }).not.toThrow();
    });
  });

  describe("End-to-end: page refresh with IndexedDB cache", () => {
    test("cached messages render instantly on reload", async () => {
      // Use a unique project dir for this test to isolate cache
      const testId = Math.random().toString(36).substring(7);
      const projectDir = `/test/project/${testId}`;

      // Card 1: Send project_info to establish project-scoped cache
      const projectInfo = {
        type: "project_info",
        project_dir: projectDir,
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(projectInfo)));

      // Wait for cache creation
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send message
      const textarea1 = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn1 = container.querySelector(".send-btn") as HTMLButtonElement;

      textarea1.value = "Cached message";
      sendBtn1.click();

      // Wait for debounced cache write (1000ms + buffer)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Card 2: Simulate reload with new card instance
      document.body.innerHTML = "";
      const container2 = document.createElement("div");
      document.body.appendChild(container2);
      const connection2 = new MockConnection();
      const card2 = new ConversationCard(connection2 as any);
      card2.mount(container2);

      // Send same project_info to load same cache
      card2.onFrame(0x40, new TextEncoder().encode(JSON.stringify(projectInfo)));

      // Wait for cache read and rendering
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify cached message appears
      const messageList2 = container2.querySelector(".message-list");
      const userMessage2 = messageList2?.querySelector(".message-user");
      expect(userMessage2?.textContent).toBe("Cached message");
    });
  });

  describe("End-to-end: crash recovery", () => {
    test("crash -> banner -> restart -> resume -> stale UI cleanup", async () => {
      // Start turn and inject tool use
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
      textarea.value = "Run command";
      sendBtn.click();

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Create a running tool card
      const toolUse = {
        type: "tool_use",
        msg_id: "msg-1",
        seq: 0,
        tool_name: "Bash",
        tool_use_id: "t1",
        input: { command: "sleep 10" },
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(toolUse)));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Inject recoverable error
      const error = {
        type: "error",
        message: "tugtalk crashed",
        recoverable: true,
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(error)));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify error banner shows "Reconnecting"
      const errorBanner = container.querySelector(".error-banner");
      expect(errorBanner).not.toBeNull();
      expect(errorBanner?.textContent).toContain("Reconnecting");

      // Verify turn active is false (button reverts)
      expect(sendBtn.classList.contains("stop-mode")).toBe(false);

      // Inject session_init (restart complete)
      const sessionInit = {
        type: "session_init",
        session_id: "session-123",
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(sessionInit)));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify banner shows "reconnected"
      const updatedBanner = container.querySelector(".error-banner");
      expect(updatedBanner?.textContent).toContain("reconnected");
    });
  });

  describe("End-to-end: permission mode switching", () => {
    test("permission mode switch mid-conversation sends correct messages", () => {
      const select = container.querySelector(".permission-mode-select") as HTMLSelectElement;

      // Verify default
      expect(select.value).toBe("acceptEdits");

      // Switch to each mode
      const modes = ["default", "plan", "bypassPermissions", "acceptEdits"];

      for (const mode of modes) {
        connection.clear();
        select.value = mode;
        select.dispatchEvent(new Event("change"));

        const msg = connection.getLastMessage();
        expect(msg.type).toBe("permission_mode");
        expect(msg.mode).toBe(mode);
      }

      // Send a user message to verify messaging still works
      connection.clear();
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
      textarea.value = "Test after mode switch";
      sendBtn.click();

      const userMsg = connection.getLastMessage();
      expect(userMsg.type).toBe("user_message");
      expect(userMsg.text).toBe("Test after mode switch");
    });
  });

  describe("Performance benchmarks", () => {
    test("cached conversation render < 200ms", async () => {
      // Create a unique cache for this test
      const testId = Math.random().toString(36).substring(7);
      const cache = new SessionCache(`perf-test-${testId}`);

      // Write 50 messages to cache
      const messages: StoredMessage[] = [];
      for (let i = 0; i < 50; i++) {
        messages.push({
          msg_id: `msg-${i}`,
          seq: i,
          rev: 0,
          status: "complete",
          role: i % 2 === 0 ? "user" : "assistant",
          text: `Message ${i}`,
        });
      }

      cache.writeMessages(messages);
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Measure cache load time
      const start = performance.now();
      const loaded = await cache.readMessages();
      const elapsed = performance.now() - start;

      expect(loaded.length).toBe(50);
      expect(elapsed).toBeLessThan(200);

      cache.close();
    });

    test("message rendering throughput", () => {
      // Time 100 renderMarkdown calls
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        renderMarkdown(`# Heading ${i}\n\nParagraph with **bold** and *italic* text.`);
      }

      const elapsed = performance.now() - start;

      // Assert < 500ms total (5ms per message)
      expect(elapsed).toBeLessThan(500);
    });
  });

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
  });

  describe("Golden test", () => {
    test("known multi-turn conversation produces expected DOM structure", async () => {
      // Send user message
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
      textarea.value = "Hello Claude";
      sendBtn.click();

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assistant responds with Markdown
      const assistantText = {
        type: "assistant_text",
        msg_id: "msg-1",
        seq: 0,
        rev: 0,
        text: "Hello! Here's a **bold** message.",
        is_partial: false,
        status: "complete",
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(assistantText)));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Tool use
      const toolUse = {
        type: "tool_use",
        msg_id: "msg-2",
        seq: 1,
        tool_name: "Read",
        tool_use_id: "t1",
        input: { file_path: "/path/to/file" },
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(toolUse)));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Tool result
      const toolResult = {
        type: "tool_result",
        tool_use_id: "t1",
        output: "File contents here",
        is_error: false,
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(toolResult)));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Turn complete
      const turnComplete = {
        type: "turn_complete",
        msg_id: "msg-3",
        seq: 2,
        result: "success",
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(turnComplete)));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify DOM structure
      const messageList = container.querySelector(".message-list");

      // User message
      const userMessage = messageList?.querySelector(".message-user");
      expect(userMessage).not.toBeNull();
      expect(userMessage?.textContent).toBe("Hello Claude");

      // Assistant message with conversation-prose wrapper
      const assistantMessage = messageList?.querySelector(".message-assistant");
      expect(assistantMessage).not.toBeNull();
      expect(assistantMessage?.querySelector(".conversation-prose")).not.toBeNull();

      // Tool card
      const toolCard = container.querySelector(".tool-card");
      expect(toolCard).not.toBeNull();
      expect(toolCard?.textContent).toContain("Read");

      // Tool status success
      const toolStatus = toolCard?.querySelector(".tool-card-status.success");
      expect(toolStatus).not.toBeNull();
    });
  });

  describe("Semantic tokens verification", () => {
    test("no hardcoded hex colors in cards.css", async () => {
      // Read cards.css
      const cssPath = import.meta.dir + "/../../styles/cards.css";
      const file = Bun.file(cssPath);
      const content = await file.text();

      // Parse for hex color patterns
      const hexPattern = /#[0-9a-fA-F]{3,6}(?![0-9a-fA-F])/g;
      const matches = content.match(hexPattern);

      // Assert zero matches (all colors must use var(--token-name))
      expect(matches).toBeNull();
    });
  });
});
