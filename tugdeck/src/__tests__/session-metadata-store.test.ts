/**
 * session-metadata-store unit tests.
 *
 * Tests cover:
 * - Store starts with null snapshot fields and empty slashCommands array.
 * - Subscribing to a FeedStore that emits a system_metadata payload updates the snapshot correctly.
 * - getCommandCompletionProvider() filters commands by substring query.
 * - Entries without a name string are skipped during parse.
 * - Subscribers are notified on metadata change; not notified on duplicate reference.
 */

import { describe, test, expect } from "bun:test";
import { SessionMetadataStore } from "../lib/session-metadata-store";
import type { SessionMetadataSnapshot } from "../lib/session-metadata-store";

// ---------------------------------------------------------------------------
// Mock FeedStore
// ---------------------------------------------------------------------------

/**
 * A minimal FeedStore-compatible mock.
 * Holds a Map<number, unknown> and notifies listeners on emit().
 */
class MockFeedStore {
  private _data: Map<number, unknown> = new Map();
  private _listeners: Array<() => void> = [];

  subscribe(listener: () => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  getSnapshot(): Map<number, unknown> {
    return this._data;
  }

  /** Emit a new payload for the given feedId and notify all listeners. */
  emit(feedId: number, payload: unknown): void {
    const next = new Map(this._data);
    next.set(feedId, payload);
    this._data = next;
    for (const listener of this._listeners) {
      listener();
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FEED_ID = 0x40; // CODE_OUTPUT

function makeMetadataPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "system_metadata",
    session_id: "sess-abc-123",
    model: "claude-3-opus",
    permission_mode: "default",
    cwd: "/home/user/project",
    slash_commands: [
      { name: "help", description: "Show help", category: "local" },
      { name: "commit", description: "Commit changes", category: "local" },
    ],
    skills: [
      { name: "summarize", description: "Summarize content", category: "skill" },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: initial state
// ---------------------------------------------------------------------------

describe("SessionMetadataStore initial state", () => {
  test("starts with null snapshot fields and empty slashCommands", () => {
    const feedStore = new MockFeedStore();
    const store = new SessionMetadataStore(feedStore as never, FEED_ID as never);

    const snap = store.getSnapshot();
    expect(snap.sessionId).toBeNull();
    expect(snap.model).toBeNull();
    expect(snap.permissionMode).toBeNull();
    expect(snap.cwd).toBeNull();
    expect(snap.slashCommands).toEqual([]);

    store.dispose();
  });
});

// ---------------------------------------------------------------------------
// Tests: payload parsing
// ---------------------------------------------------------------------------

describe("SessionMetadataStore payload parsing", () => {
  test("updates snapshot when FeedStore emits a system_metadata payload", () => {
    const feedStore = new MockFeedStore();
    const store = new SessionMetadataStore(feedStore as never, FEED_ID as never);

    feedStore.emit(FEED_ID, makeMetadataPayload());

    const snap: SessionMetadataSnapshot = store.getSnapshot();
    expect(snap.sessionId).toBe("sess-abc-123");
    expect(snap.model).toBe("claude-3-opus");
    expect(snap.permissionMode).toBe("default");
    expect(snap.cwd).toBe("/home/user/project");

    // slash_commands + skills merged
    expect(snap.slashCommands).toHaveLength(3);
    expect(snap.slashCommands[0].name).toBe("help");
    expect(snap.slashCommands[0].category).toBe("local");
    expect(snap.slashCommands[2].name).toBe("summarize");
    expect(snap.slashCommands[2].category).toBe("skill");

    store.dispose();
  });

  test("ignores payloads with type other than system_metadata", () => {
    const feedStore = new MockFeedStore();
    const store = new SessionMetadataStore(feedStore as never, FEED_ID as never);

    feedStore.emit(FEED_ID, { type: "other_event", session_id: "should-not-appear" });

    const snap = store.getSnapshot();
    expect(snap.sessionId).toBeNull();

    store.dispose();
  });

  test("entries without a name string are skipped during parse", () => {
    const feedStore = new MockFeedStore();
    const store = new SessionMetadataStore(feedStore as never, FEED_ID as never);

    feedStore.emit(FEED_ID, makeMetadataPayload({
      slash_commands: [
        { name: "valid", description: "ok" },
        { description: "no name" },        // missing name
        { name: "", description: "empty" }, // empty name
        { name: 42 },                        // non-string name
        null,                                // null entry
      ],
      skills: [],
    }));

    const snap = store.getSnapshot();
    expect(snap.slashCommands).toHaveLength(1);
    expect(snap.slashCommands[0].name).toBe("valid");

    store.dispose();
  });

  test("defaults category to local when absent or unrecognized", () => {
    const feedStore = new MockFeedStore();
    const store = new SessionMetadataStore(feedStore as never, FEED_ID as never);

    feedStore.emit(FEED_ID, makeMetadataPayload({
      slash_commands: [
        { name: "no-cat" },
        { name: "bad-cat", category: "unknown-value" },
      ],
      skills: [],
    }));

    const snap = store.getSnapshot();
    expect(snap.slashCommands[0].category).toBe("local");
    expect(snap.slashCommands[1].category).toBe("local");

    store.dispose();
  });
});

// ---------------------------------------------------------------------------
// Tests: subscriber notifications
// ---------------------------------------------------------------------------

describe("SessionMetadataStore subscriber notifications", () => {
  test("notifies subscribers when metadata changes", () => {
    const feedStore = new MockFeedStore();
    const store = new SessionMetadataStore(feedStore as never, FEED_ID as never);

    let callCount = 0;
    store.subscribe(() => { callCount++; });

    feedStore.emit(FEED_ID, makeMetadataPayload());
    expect(callCount).toBe(1);

    store.dispose();
  });

  test("does not notify subscribers on duplicate reference", () => {
    const feedStore = new MockFeedStore();
    const store = new SessionMetadataStore(feedStore as never, FEED_ID as never);

    let callCount = 0;
    store.subscribe(() => { callCount++; });

    // Emit once — reference is new
    const payload = makeMetadataPayload();
    feedStore.emit(FEED_ID, payload);
    expect(callCount).toBe(1);

    // Manually trigger a listener call without changing the payload reference.
    // We simulate this by calling the feedStore emit with a different feedId
    // (so the CODE_OUTPUT entry in the map stays the same reference).
    feedStore.emit(0x99, { type: "irrelevant" });
    // The store reads feedId 0x40 — same payload reference as before — so no notify.
    expect(callCount).toBe(1);

    store.dispose();
  });

  test("unsubscribe stops notifications", () => {
    const feedStore = new MockFeedStore();
    const store = new SessionMetadataStore(feedStore as never, FEED_ID as never);

    let callCount = 0;
    const unsub = store.subscribe(() => { callCount++; });
    unsub();

    feedStore.emit(FEED_ID, makeMetadataPayload());
    expect(callCount).toBe(0);

    store.dispose();
  });
});

// ---------------------------------------------------------------------------
// Tests: getCommandCompletionProvider
// ---------------------------------------------------------------------------

describe("SessionMetadataStore getCommandCompletionProvider", () => {
  test("returns empty array when no commands loaded", () => {
    const feedStore = new MockFeedStore();
    const store = new SessionMetadataStore(feedStore as never, FEED_ID as never);
    const provider = store.getCommandCompletionProvider();

    const results = provider("help");
    expect(results).toEqual([]);

    store.dispose();
  });

  test("returns all commands when query is empty string", () => {
    const feedStore = new MockFeedStore();
    const store = new SessionMetadataStore(feedStore as never, FEED_ID as never);
    feedStore.emit(FEED_ID, makeMetadataPayload());

    const provider = store.getCommandCompletionProvider();
    const results = provider("");
    expect(results).toHaveLength(3);

    store.dispose();
  });

  test("filters commands by case-insensitive substring match", () => {
    const feedStore = new MockFeedStore();
    const store = new SessionMetadataStore(feedStore as never, FEED_ID as never);
    feedStore.emit(FEED_ID, makeMetadataPayload());

    const provider = store.getCommandCompletionProvider();

    // "com" matches "commit"
    const results1 = provider("com");
    expect(results1).toHaveLength(1);
    expect(results1[0].label).toBe("commit");

    // "HELP" (uppercase) matches "help"
    const results2 = provider("HELP");
    expect(results2).toHaveLength(1);
    expect(results2[0].label).toBe("help");

    // "ize" matches "summarize"
    const results3 = provider("ize");
    expect(results3).toHaveLength(1);
    expect(results3[0].label).toBe("summarize");

    // "xyz" matches nothing
    const results4 = provider("xyz");
    expect(results4).toHaveLength(0);

    store.dispose();
  });

  test("completion items have atom.type = command", () => {
    const feedStore = new MockFeedStore();
    const store = new SessionMetadataStore(feedStore as never, FEED_ID as never);
    feedStore.emit(FEED_ID, makeMetadataPayload());

    const provider = store.getCommandCompletionProvider();
    const results = provider("help");
    expect(results).toHaveLength(1);
    expect(results[0].atom.type).toBe("command");
    expect(results[0].atom.kind).toBe("atom");

    store.dispose();
  });

  test("provider reads updated snapshot after metadata changes", () => {
    const feedStore = new MockFeedStore();
    const store = new SessionMetadataStore(feedStore as never, FEED_ID as never);

    const provider = store.getCommandCompletionProvider();

    // Before metadata arrives
    expect(provider("help")).toHaveLength(0);

    // After metadata arrives
    feedStore.emit(FEED_ID, makeMetadataPayload());
    expect(provider("help")).toHaveLength(1);

    store.dispose();
  });
});
