/**
 * Tests for session cache
 */

// Import fake-indexeddb polyfill first
import "fake-indexeddb/auto";

import { describe, test, expect, beforeEach } from "bun:test";
import { SessionCache, type StoredMessage } from "./session-cache";

describe("SessionCache", () => {
  let cache: SessionCache;

  beforeEach(() => {
    // Create a new cache instance with a unique name for each test
    const testId = Math.random().toString(36).substring(7);
    cache = new SessionCache(`test-${testId}`);
  });

  test("write and read messages in seq order", async () => {
    const messages: StoredMessage[] = [
      {
        msg_id: "msg-1",
        seq: 1,
        rev: 0,
        status: "complete",
        role: "user",
        text: "Hello",
      },
      {
        msg_id: "msg-2",
        seq: 2,
        rev: 0,
        status: "complete",
        role: "assistant",
        text: "Hi there!",
      },
      {
        msg_id: "msg-3",
        seq: 3,
        rev: 0,
        status: "complete",
        role: "user",
        text: "How are you?",
      },
    ];

    // Write messages
    cache.writeMessages(messages);

    // Wait for debounce (1s + margin)
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Read messages back
    const read = await cache.readMessages();

    expect(read).toHaveLength(3);
    expect(read[0].msg_id).toBe("msg-1");
    expect(read[1].msg_id).toBe("msg-2");
    expect(read[2].msg_id).toBe("msg-3");

    cache.close();
  });

  test("reconcile keeps matching messages unchanged", async () => {
    const messages: StoredMessage[] = [
      {
        msg_id: "msg-1",
        seq: 1,
        rev: 0,
        status: "complete",
        role: "user",
        text: "Hello",
      },
      {
        msg_id: "msg-2",
        seq: 2,
        rev: 0,
        status: "complete",
        role: "assistant",
        text: "Hi there!",
      },
    ];

    const result = cache.reconcile(messages, messages);

    expect(result.keep).toHaveLength(2);
    expect(result.update).toHaveLength(0);
    expect(result.insert).toHaveLength(0);
    expect(result.remove).toHaveLength(0);

    cache.close();
  });

  test("reconcile updates changed messages in place", async () => {
    const cached: StoredMessage[] = [
      {
        msg_id: "msg-1",
        seq: 1,
        rev: 0,
        status: "partial",
        role: "assistant",
        text: "Thinking...",
      },
    ];

    const authoritative: StoredMessage[] = [
      {
        msg_id: "msg-1",
        seq: 1,
        rev: 1,
        status: "complete",
        role: "assistant",
        text: "Here's my answer!",
      },
    ];

    const result = cache.reconcile(authoritative, cached);

    expect(result.keep).toHaveLength(0);
    expect(result.update).toHaveLength(1);
    expect(result.update[0].old.text).toBe("Thinking...");
    expect(result.update[0].new.text).toBe("Here's my answer!");
    expect(result.insert).toHaveLength(0);
    expect(result.remove).toHaveLength(0);

    cache.close();
  });

  test("reconcile inserts new messages at correct position", async () => {
    const cached: StoredMessage[] = [
      {
        msg_id: "msg-1",
        seq: 1,
        rev: 0,
        status: "complete",
        role: "user",
        text: "Hello",
      },
    ];

    const authoritative: StoredMessage[] = [
      {
        msg_id: "msg-1",
        seq: 1,
        rev: 0,
        status: "complete",
        role: "user",
        text: "Hello",
      },
      {
        msg_id: "msg-2",
        seq: 2,
        rev: 0,
        status: "complete",
        role: "assistant",
        text: "Hi there!",
      },
    ];

    const result = cache.reconcile(authoritative, cached);

    expect(result.keep).toHaveLength(1);
    expect(result.update).toHaveLength(0);
    expect(result.insert).toHaveLength(1);
    expect(result.insert[0].message.msg_id).toBe("msg-2");
    expect(result.insert[0].position).toBe(1);
    expect(result.remove).toHaveLength(0);

    cache.close();
  });

  test("reconcile removes messages not in authoritative list", async () => {
    const cached: StoredMessage[] = [
      {
        msg_id: "msg-1",
        seq: 1,
        rev: 0,
        status: "complete",
        role: "user",
        text: "Hello",
      },
      {
        msg_id: "msg-2",
        seq: 2,
        rev: 0,
        status: "complete",
        role: "assistant",
        text: "Hi there!",
      },
    ];

    const authoritative: StoredMessage[] = [
      {
        msg_id: "msg-1",
        seq: 1,
        rev: 0,
        status: "complete",
        role: "user",
        text: "Hello",
      },
    ];

    const result = cache.reconcile(authoritative, cached);

    expect(result.keep).toHaveLength(1);
    expect(result.update).toHaveLength(0);
    expect(result.insert).toHaveLength(0);
    expect(result.remove).toHaveLength(1);
    expect(result.remove[0].msg_id).toBe("msg-2");

    cache.close();
  });

  test("clearHistory deletes the database", async () => {
    const messages: StoredMessage[] = [
      {
        msg_id: "msg-1",
        seq: 1,
        rev: 0,
        status: "complete",
        role: "user",
        text: "Hello",
      },
    ];

    // Write messages
    cache.writeMessages(messages);
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Verify messages exist
    let read = await cache.readMessages();
    expect(read).toHaveLength(1);

    // Clear history
    await cache.clearHistory();

    // Create new cache instance with same name
    const cache2 = new SessionCache("test-clear");
    read = await cache2.readMessages();
    expect(read).toHaveLength(0);

    cache2.close();
  });

  test("debounced write coalesces rapid calls", async () => {
    const messages1: StoredMessage[] = [
      {
        msg_id: "msg-1",
        seq: 1,
        rev: 0,
        status: "partial",
        role: "assistant",
        text: "Think",
      },
    ];

    const messages2: StoredMessage[] = [
      {
        msg_id: "msg-1",
        seq: 1,
        rev: 1,
        status: "partial",
        role: "assistant",
        text: "Thinking",
      },
    ];

    const messages3: StoredMessage[] = [
      {
        msg_id: "msg-1",
        seq: 1,
        rev: 2,
        status: "complete",
        role: "assistant",
        text: "Thinking complete",
      },
    ];

    // Make rapid calls
    cache.writeMessages(messages1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    cache.writeMessages(messages2);
    await new Promise((resolve) => setTimeout(resolve, 200));
    cache.writeMessages(messages3);

    // Wait for final debounce
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Should only have the final message
    const read = await cache.readMessages();
    expect(read).toHaveLength(1);
    expect(read[0].text).toBe("Thinking complete");

    cache.close();
  });

  test("page reload simulation - instant data availability", async () => {
    // Session 1: Write messages
    const cache1 = new SessionCache("reload-test");
    const messages: StoredMessage[] = [
      {
        msg_id: "msg-1",
        seq: 1,
        rev: 0,
        status: "complete",
        role: "user",
        text: "Hello",
      },
      {
        msg_id: "msg-2",
        seq: 2,
        rev: 0,
        status: "complete",
        role: "assistant",
        text: "Hi there!",
      },
    ];

    cache1.writeMessages(messages);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    cache1.close();

    // Session 2: Simulate page reload - create new cache instance
    const cache2 = new SessionCache("reload-test");
    const read = await cache2.readMessages();

    // Data should be immediately available
    expect(read).toHaveLength(2);
    expect(read[0].msg_id).toBe("msg-1");
    expect(read[1].msg_id).toBe("msg-2");

    cache2.close();
  });
});
