/**
 * Phase 5 integration tests: session scoping + crash recovery + permission switching
 *
 * These tests verify that session management features work together correctly:
 * - Session scoping by project directory (IndexedDB cache isolation)
 * - Crash recovery with reconnection flow
 * - Dynamic permission mode switching
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
import { ConversationCard } from "../conversation-card";
import type { TugConnection } from "../../connection";

// Mock TugConnection
class MockConnection implements Partial<TugConnection> {
  sentFrames: { feedId: number; payload: Uint8Array }[] = [];

  send(feedId: number, payload: Uint8Array): void {
    this.sentFrames.push({ feedId, payload });
  }

  clear(): void {
    this.sentFrames = [];
  }

  getLastMessage(): any {
    if (this.sentFrames.length === 0) return null;
    const { payload } = this.sentFrames[this.sentFrames.length - 1];
    return JSON.parse(new TextDecoder().decode(payload));
  }

  getAllMessages(): any[] {
    return this.sentFrames.map(({ payload }) =>
      JSON.parse(new TextDecoder().decode(payload))
    );
  }
}

describe("Phase 5 integration: session + crash recovery + permissions", () => {
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

  describe("session scoping", () => {
    test("project_info creates project-specific cache", async () => {
      // Use unique project paths with random suffix to avoid cross-test pollution
      const testId = Math.random().toString(36).substring(7);
      const projectDir1 = `/path/to/project1-${testId}`;
      const projectDir2 = `/path/to/project2-${testId}`;

      // Session 1: Send project_info and a message
      const projectEvent1 = {
        type: "project_info",
        project_dir: projectDir1,
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(projectEvent1)));

      // Wait for async hash computation and cache creation
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send a user message in project 1
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
      textarea.value = "Project 1 message";
      sendBtn.click();

      // Wait for debounced cache write (1000ms + buffer)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Session 2: Create a new card for project 2 (fresh DOM and card instance)
      document.body.innerHTML = "";
      const container2 = document.createElement("div");
      document.body.appendChild(container2);
      const connection2 = new MockConnection();
      const card2 = new ConversationCard(connection2 as any);
      card2.mount(container2);

      // Send project_info for project 2
      const projectEvent2 = {
        type: "project_info",
        project_dir: projectDir2,
      };
      card2.onFrame(0x40, new TextEncoder().encode(JSON.stringify(projectEvent2)));

      // Wait for cache creation and cache load attempt
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify project 2 does NOT see project 1's messages
      const messageList2 = container2.querySelector(".message-list");
      const messages2 = messageList2?.querySelectorAll(".message-user");
      expect(messages2?.length).toBe(0);
    });
  });

  describe("crash recovery", () => {
    test("error + session_init reconnect cycle", async () => {
      const sessionId = "test-session-123";

      // Send a user message
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
      textarea.value = "Test message before crash";
      sendBtn.click();

      // Wait a moment for message to render
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Inject a recoverable error event
      const errorEvent = {
        type: "error",
        message: "tugtalk crashed",
        recoverable: true,
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(errorEvent)));

      // Wait for DOM update
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify error banner appears with "Reconnecting" message
      const errorBanner = container.querySelector(".error-banner") as HTMLElement;
      expect(errorBanner).not.toBeNull();
      expect(errorBanner.textContent).toContain("Reconnecting");

      // Inject session_init event with same session_id (simulating reconnect)
      const sessionEvent = {
        type: "session_init",
        session_id: sessionId,
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(sessionEvent)));

      // Wait for DOM update
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify banner changes to "reconnected"
      const updatedBanner = container.querySelector(".error-banner") as HTMLElement;
      expect(updatedBanner).not.toBeNull();
      expect(updatedBanner.textContent).toContain("reconnected");

      // Verify the original message is still present
      const messageList = container.querySelector(".message-list");
      const userMessages = messageList?.querySelectorAll(".message-user");
      expect(userMessages?.length).toBeGreaterThanOrEqual(1);
      expect(userMessages?.[0].textContent).toBe("Test message before crash");
    });
  });

  describe("permission switching", () => {
    test("permission mode selector changes send permission_mode messages", () => {
      const select = container.querySelector(".permission-mode-select") as HTMLSelectElement;

      // Verify default is acceptEdits
      expect(select.value).toBe("acceptEdits");

      // Change to plan mode
      connection.clear();
      select.value = "plan";
      select.dispatchEvent(new Event("change"));

      let lastMsg = connection.getLastMessage();
      expect(lastMsg).not.toBeNull();
      expect(lastMsg.type).toBe("permission_mode");
      expect(lastMsg.mode).toBe("plan");

      // Change to bypassPermissions
      connection.clear();
      select.value = "bypassPermissions";
      select.dispatchEvent(new Event("change"));

      lastMsg = connection.getLastMessage();
      expect(lastMsg).not.toBeNull();
      expect(lastMsg.type).toBe("permission_mode");
      expect(lastMsg.mode).toBe("bypassPermissions");

      // Change back to acceptEdits
      connection.clear();
      select.value = "acceptEdits";
      select.dispatchEvent(new Event("change"));

      lastMsg = connection.getLastMessage();
      expect(lastMsg).not.toBeNull();
      expect(lastMsg.type).toBe("permission_mode");
      expect(lastMsg.mode).toBe("acceptEdits");
    });
  });

  describe("full sequence: session + crash recovery + permissions", () => {
    test("all three features work together in sequence", async () => {
      // Use unique project path to avoid cross-test pollution
      const testId = Math.random().toString(36).substring(7);
      const projectDir = `/path/to/test-project-${testId}`;
      const sessionId = "integration-test-session";

      // Step 1: Send project_info to establish project-scoped session
      const projectEvent = {
        type: "project_info",
        project_dir: projectDir,
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(projectEvent)));

      // Wait for async hash computation and cache creation
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Step 2: Send a user message
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const sendBtn = container.querySelector(".send-btn") as HTMLButtonElement;
      textarea.value = "First message";
      sendBtn.click();

      // Wait for message to render
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify message appears
      let messageList = container.querySelector(".message-list");
      let userMessages = messageList?.querySelectorAll(".message-user");
      expect(userMessages?.length).toBe(1);
      expect(userMessages?.[0].textContent).toBe("First message");

      // Step 3: Switch permission mode to bypassPermissions
      const select = container.querySelector(".permission-mode-select") as HTMLSelectElement;
      connection.clear();
      select.value = "bypassPermissions";
      select.dispatchEvent(new Event("change"));

      let lastMsg = connection.getLastMessage();
      expect(lastMsg.type).toBe("permission_mode");
      expect(lastMsg.mode).toBe("bypassPermissions");

      // Step 4: Inject a recoverable error
      const errorEvent = {
        type: "error",
        message: "Connection lost",
        recoverable: true,
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(errorEvent)));

      // Wait for error banner to appear
      await new Promise((resolve) => setTimeout(resolve, 50));

      let errorBanner = container.querySelector(".error-banner") as HTMLElement;
      expect(errorBanner).not.toBeNull();
      expect(errorBanner.textContent).toContain("Reconnecting");

      // Step 5: Inject session_init to simulate crash recovery
      const sessionEvent = {
        type: "session_init",
        session_id: sessionId,
      };
      card.onFrame(0x40, new TextEncoder().encode(JSON.stringify(sessionEvent)));

      // Wait for reconnection
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Step 6: Verify error banner shows "reconnected"
      errorBanner = container.querySelector(".error-banner") as HTMLElement;
      expect(errorBanner).not.toBeNull();
      expect(errorBanner.textContent).toContain("reconnected");

      // Step 7: Send another user message
      textarea.value = "Second message after recovery";
      sendBtn.click();

      // Wait for message to render
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify both messages are present
      messageList = container.querySelector(".message-list");
      userMessages = messageList?.querySelectorAll(".message-user");
      expect(userMessages?.length).toBe(2);
      expect(userMessages?.[0].textContent).toBe("First message");
      expect(userMessages?.[1].textContent).toBe("Second message after recovery");

      // Step 8: Switch permission mode back to acceptEdits
      connection.clear();
      select.value = "acceptEdits";
      select.dispatchEvent(new Event("change"));

      lastMsg = connection.getLastMessage();
      expect(lastMsg.type).toBe("permission_mode");
      expect(lastMsg.mode).toBe("acceptEdits");

      // Step 9: Verify permission selector reflects current state
      expect(select.value).toBe("acceptEdits");
    });
  });
});
