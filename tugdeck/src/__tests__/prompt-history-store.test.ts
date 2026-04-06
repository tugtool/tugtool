/**
 * prompt-history-store unit tests.
 *
 * Tests cover:
 * - push() adds entry and notifies subscribers.
 * - push() enforces 200-entry cap (push 201 entries, verify oldest is dropped).
 * - createProvider() returns a HistoryProvider that navigates session entries correctly.
 * - createProvider() does not return entries from other sessions.
 * - push() calls putPromptHistory with correct sessionId and entries (mock fetch).
 */

import { describe, test, expect, afterEach, mock } from "bun:test";
import { PromptHistoryStore } from "../lib/prompt-history-store";
import type { HistoryEntry } from "../lib/prompt-history-store";
import type { TugTextEditingState } from "../lib/tug-text-engine";

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

/** Build a minimal Response-like object for mocking fetch. */
function makeResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let _entryCounter = 0;

function makeEntry(sessionId: string, text: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  _entryCounter++;
  return {
    id: `entry-${_entryCounter}`,
    sessionId,
    projectPath: "/project/test",
    route: ">",
    text,
    atoms: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

const EMPTY_STATE: TugTextEditingState = { text: "", atoms: [], selection: null };

function makeState(text: string): TugTextEditingState {
  return { text, atoms: [], selection: null };
}

// ---------------------------------------------------------------------------
// push() — basic behavior
// ---------------------------------------------------------------------------

describe("PromptHistoryStore.push", () => {
  afterEach(() => {
    mock.restore();
    _entryCounter = 0;
  });

  test("push() adds entry and notifies subscribers", async () => {
    // Stub fetch so putPromptHistory doesn't throw.
    globalThis.fetch = async () => makeResponse(200, {});

    const store = new PromptHistoryStore();
    let notifications = 0;
    const unsub = store.subscribe(() => { notifications++; });

    store.push(makeEntry("sess-1", "hello world"));

    expect(notifications).toBe(1);
    expect(store.getSnapshot().totalEntries).toBe(1);
    expect(store.getSnapshot().sessionEntries).toBe(1);

    unsub();
  });

  test("push() updates totalEntries across sessions", async () => {
    globalThis.fetch = async () => makeResponse(200, {});

    const store = new PromptHistoryStore();
    store.push(makeEntry("sess-1", "first"));
    store.push(makeEntry("sess-2", "second"));
    store.push(makeEntry("sess-1", "third"));

    expect(store.getSnapshot().totalEntries).toBe(3);
  });

  test("getSnapshot().sessionEntries tracks most recently active session", async () => {
    globalThis.fetch = async () => makeResponse(200, {});

    const store = new PromptHistoryStore();
    store.push(makeEntry("sess-1", "a"));
    store.push(makeEntry("sess-1", "b"));
    store.push(makeEntry("sess-2", "c"));

    // After pushing to sess-2, sessionEntries reflects sess-2.
    expect(store.getSnapshot().sessionEntries).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// push() — 200-entry capacity cap
// ---------------------------------------------------------------------------

describe("PromptHistoryStore capacity cap", () => {
  afterEach(() => {
    mock.restore();
    _entryCounter = 0;
  });

  test("push() enforces 200-entry cap — oldest entry is dropped at 201", async () => {
    globalThis.fetch = async () => makeResponse(200, {});

    const store = new PromptHistoryStore();
    const SID = "sess-cap";

    // Push 201 entries.
    for (let i = 0; i < 201; i++) {
      store.push(makeEntry(SID, `entry-${i}`));
    }

    // Only 200 entries should remain.
    expect(store.getSnapshot().sessionEntries).toBe(200);
    expect(store.getSnapshot().totalEntries).toBe(200);

    // The provider should return the most recent 200 (last pushed = entry-200).
    const provider = store.createProvider(SID);
    const last = provider.back(EMPTY_STATE);
    expect(last?.text).toBe("entry-200");
  });
});

// ---------------------------------------------------------------------------
// createProvider() — navigation
// ---------------------------------------------------------------------------

describe("PromptHistoryStore.createProvider", () => {
  afterEach(() => {
    mock.restore();
    _entryCounter = 0;
  });

  test("back() returns last entry first, then older entries", async () => {
    globalThis.fetch = async () => makeResponse(200, {});

    const store = new PromptHistoryStore();
    const SID = "sess-nav";
    store.push(makeEntry(SID, "first"));
    store.push(makeEntry(SID, "second"));
    store.push(makeEntry(SID, "third"));

    const provider = store.createProvider(SID);
    const current = makeState("draft");

    const result1 = provider.back(current);
    expect(result1?.text).toBe("third");

    const result2 = provider.back(current);
    expect(result2?.text).toBe("second");

    const result3 = provider.back(current);
    expect(result3?.text).toBe("first");

    // Already at oldest — back() returns null.
    const result4 = provider.back(current);
    expect(result4).toBeNull();
  });

  test("forward() returns newer entries and draft when reaching end", async () => {
    globalThis.fetch = async () => makeResponse(200, {});

    const store = new PromptHistoryStore();
    const SID = "sess-fwd";
    store.push(makeEntry(SID, "first"));
    store.push(makeEntry(SID, "second"));

    const provider = store.createProvider(SID);
    const draft = makeState("current draft");

    // Navigate back twice.
    provider.back(draft); // "second"
    provider.back(draft); // "first"

    // Navigate forward.
    const fwd1 = provider.forward();
    expect(fwd1?.text).toBe("second");

    const fwd2 = provider.forward();
    // At end — returns draft.
    expect(fwd2?.text).toBe("current draft");
  });

  test("forward() returns null when already at draft position", async () => {
    globalThis.fetch = async () => makeResponse(200, {});

    const store = new PromptHistoryStore();
    store.push(makeEntry("sess-x", "something"));
    const provider = store.createProvider("sess-x");

    // No navigation yet — forward should return null.
    const result = provider.forward();
    expect(result).toBeNull();
  });

  test("createProvider() does not return entries from other sessions", async () => {
    globalThis.fetch = async () => makeResponse(200, {});

    const store = new PromptHistoryStore();
    store.push(makeEntry("sess-A", "from session A"));
    store.push(makeEntry("sess-B", "from session B"));

    // Provider for sess-A should only see sess-A entries.
    const providerA = store.createProvider("sess-A");
    const result = providerA.back(EMPTY_STATE);
    expect(result?.text).toBe("from session A");

    // No more sess-A entries.
    const result2 = providerA.back(EMPTY_STATE);
    expect(result2).toBeNull();
  });

  test("back() returns null when session has no entries", async () => {
    globalThis.fetch = async () => makeResponse(200, {});

    const store = new PromptHistoryStore();
    const provider = store.createProvider("empty-session");
    const result = provider.back(EMPTY_STATE);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// push() — tugbank persistence (mock fetch)
// ---------------------------------------------------------------------------

describe("PromptHistoryStore tugbank persistence", () => {
  afterEach(() => {
    mock.restore();
    _entryCounter = 0;
  });

  test("push() calls putPromptHistory with correct sessionId and entries", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url as string, init: init ?? {} });
      return makeResponse(200, {});
    };

    const store = new PromptHistoryStore();
    const entry = makeEntry("sess-persist", "hello tugbank");
    store.push(entry);

    // Allow the fire-and-forget promise to complete.
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(
      `/api/defaults/dev.tugtool.prompt.history/${encodeURIComponent("sess-persist")}`
    );
    expect(calls[0].init.method).toBe("PUT");

    const body = JSON.parse(calls[0].init.body as string) as { kind: string; value: unknown };
    expect(body.kind).toBe("json");
    expect(Array.isArray(body.value)).toBe(true);
    const entries = body.value as HistoryEntry[];
    expect(entries.length).toBe(1);
    expect(entries[0].text).toBe("hello tugbank");
    expect(entries[0].sessionId).toBe("sess-persist");
  });

  test("push() includes all session entries in the PUT body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url as string, init: init ?? {} });
      return makeResponse(200, {});
    };

    const store = new PromptHistoryStore();
    store.push(makeEntry("sess-multi", "first"));
    store.push(makeEntry("sess-multi", "second"));
    store.push(makeEntry("sess-multi", "third"));

    await new Promise((r) => setTimeout(r, 0));

    // 3 pushes = 3 PUT calls; last call should have all 3 entries.
    expect(calls.length).toBe(3);
    const lastBody = JSON.parse(calls[2].init.body as string) as { kind: string; value: unknown };
    const entries = lastBody.value as HistoryEntry[];
    expect(entries.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// loadSession() — tugbank read
// ---------------------------------------------------------------------------

describe("PromptHistoryStore.loadSession", () => {
  afterEach(() => {
    mock.restore();
    _entryCounter = 0;
  });

  test("loadSession() merges persisted entries into in-memory store", async () => {
    const persistedEntries: HistoryEntry[] = [
      makeEntry("sess-load", "persisted entry A"),
      makeEntry("sess-load", "persisted entry B"),
    ];

    globalThis.fetch = async () =>
      makeResponse(200, { kind: "json", value: persistedEntries });

    const store = new PromptHistoryStore();
    await store.loadSession("sess-load");

    expect(store.getSnapshot().totalEntries).toBe(2);
  });

  test("loadSession() is a no-op when called a second time for same session", async () => {
    let fetchCount = 0;
    const persistedEntries: HistoryEntry[] = [makeEntry("sess-noop", "entry")];

    globalThis.fetch = async () => {
      fetchCount++;
      return makeResponse(200, { kind: "json", value: persistedEntries });
    };

    const store = new PromptHistoryStore();
    await store.loadSession("sess-noop");
    await store.loadSession("sess-noop"); // second call — should be no-op

    expect(fetchCount).toBe(1);
  });

  test("loadSession() returns empty array on 404", async () => {
    globalThis.fetch = async () => makeResponse(404, {});

    const store = new PromptHistoryStore();
    await store.loadSession("sess-404");

    expect(store.getSnapshot().totalEntries).toBe(0);
  });
});
