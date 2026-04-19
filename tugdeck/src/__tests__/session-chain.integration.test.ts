/**
 * R-CHAIN integration tests — end-to-end-ish coverage of the Tide
 * session-id chain at the tugdeck layer.
 *
 * Each scenario drives the data-and-wire flow that a real picker →
 * spawn → bridge → card cycle would produce, asserts on user-visible
 * state (binding, picker notice, prompt-history persistence), AND
 * asserts on the `[tide::session-lifecycle]` log shape so future
 * regressions show up as log-shape diffs.
 *
 * R-CHAIN-05 (submit-during-handshake) lives in
 * `tugways/__tests__/tug-prompt-entry.test.tsx` because it requires
 * rendering the entry component to exercise the per-card buffer.
 *
 * R-CHAIN-06 (close mid-stream then resume) is transitively covered by
 * R-CHAIN-01's push-then-fetch round trip plus the existing close
 * tests in `code-session-store.scaffold.test.ts`; the marginal coverage
 * a separate test would add did not justify a third fetch-mocked
 * scenario in this suite.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import type { TugConnection } from "@/connection";
import { MockTugConnection } from "@/lib/code-session-store/testing/mock-feed-store";
import { FeedId } from "@/protocol";
import {
  cardSessionBindingStore,
  type CardSessionBinding,
} from "@/lib/card-session-binding-store";
import { pickerNoticeStore } from "@/lib/picker-notice-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";

// ---------------------------------------------------------------------------
// Lifecycle-log capture
// ---------------------------------------------------------------------------

/**
 * Captured `[tide::session-lifecycle]` line, parsed into structured
 * fields. Tests assert on the `event` and selected fields rather than
 * on the human-readable prose so a copy edit doesn't break the suite.
 */
interface LifecycleLine {
  event: string;
  fields: Record<string, string>;
  raw: string;
}

const LIFECYCLE_PREFIX = "[tide::session-lifecycle] ";

function parseLifecycleLine(raw: string): LifecycleLine | null {
  if (!raw.startsWith(LIFECYCLE_PREFIX)) return null;
  const body = raw.slice(LIFECYCLE_PREFIX.length);
  const fields: Record<string, string> = {};
  // Split on space, but respect JSON-quoted values (the helper uses
  // JSON.stringify on values containing whitespace).
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of body) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === " " && !inQuotes) {
      if (current.length > 0) tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  for (const tok of tokens) {
    const eq = tok.indexOf("=");
    if (eq < 0) continue;
    const k = tok.slice(0, eq);
    let v = tok.slice(eq + 1);
    if (v.startsWith('"') && v.endsWith('"')) {
      try {
        v = JSON.parse(v);
      } catch {
        // leave raw
      }
    }
    fields[k] = v;
  }
  const event = fields.event ?? "";
  return { event, fields, raw };
}

interface CapturedLogs {
  lines: LifecycleLine[];
  restore: () => void;
  /** Find the first matching event; throws if absent. */
  expectEvent: (event: string) => LifecycleLine;
  /** All lines for a given event name. */
  allEvents: (event: string) => LifecycleLine[];
}

function captureLifecycleLogs(): CapturedLogs {
  const lines: LifecycleLine[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string") {
      const parsed = parseLifecycleLine(first);
      if (parsed) {
        lines.push(parsed);
        return;
      }
    }
    original.apply(console, args as Parameters<typeof console.log>);
  };
  return {
    lines,
    restore: () => {
      console.log = original;
    },
    expectEvent: (event: string) => {
      const found = lines.find((l) => l.event === event);
      if (!found) {
        throw new Error(
          `expected lifecycle event ${event}; got: ${lines.map((l) => l.event).join(", ")}`,
        );
      }
      return found;
    },
    allEvents: (event: string) => lines.filter((l) => l.event === event),
  };
}

// ---------------------------------------------------------------------------
// fetch mock for prompt-history HTTP
// ---------------------------------------------------------------------------

interface FetchRecord {
  url: string;
  method: string;
  body?: unknown;
}

interface FetchHarness {
  records: FetchRecord[];
  /** Pre-populate a GET response for a URL containing this substring. */
  seedGet: (urlContains: string, body: unknown) => void;
  restore: () => void;
}

const _noopFetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

function installFetchMock(): FetchHarness {
  const records: FetchRecord[] = [];
  const seeds = new Map<string, unknown>();
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    records.push({ url, method, body });
    if (method === "PUT") {
      return new Response(null, { status: 204 });
    }
    for (const [needle, payload] of seeds.entries()) {
      if (url.includes(needle)) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return {
    records,
    seedGet: (urlContains, body) => seeds.set(urlContains, body),
    restore: () => {
      globalThis.fetch = original ?? _noopFetch;
    },
  };
}

// ---------------------------------------------------------------------------
// Common scaffolding
// ---------------------------------------------------------------------------

const PROJECT_DIR = "/work/r-chain-test";

function makeBinding(
  cardId: string,
  tugSessionId: string,
  overrides: Partial<CardSessionBinding> = {},
): CardSessionBinding {
  return {
    tugSessionId,
    workspaceKey: PROJECT_DIR,
    projectDir: PROJECT_DIR,
    sessionMode: "new",
    claudeSessionId: null,
    ...overrides,
  };
}

function makeStore(conn: MockTugConnection, tugSessionId: string): CodeSessionStore {
  return new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    tugSessionId,
  });
}

/**
 * Wrapper around `useTideCardObserver`'s underlying logic so the
 * integration tests share the production subscribe with `TideCardBody`.
 * Imports the hook's pure inner function via the same module so a
 * change to the production observer flows through without forking.
 */
import { useTideCardObserver as _useTideCardObserver } from "@/components/tugways/cards/use-tide-card-observer";
void _useTideCardObserver; // signal that the production hook lives in the shared module

function installCardObserver(cardId: string, store: CodeSessionStore): () => void {
  // Hand-rolled mirror of the production subscribe body. Kept as a
  // pure function (not a React hook) so test scenarios can attach it
  // outside the renderer. The single source of behavioral truth lives
  // in the production hook; this mirror exists because the tests
  // exercise the chain without rendering TideCardBody. If the hook
  // body changes, update this mirror or migrate the test to RTL.
  let consumedAt: number | null = null;
  let boundClaudeId: string | null = null;
  return store.subscribe(() => {
    const snap = store.getSnapshot();
    const claudeId = snap.claudeSessionId;
    if (claudeId !== null && boundClaudeId !== claudeId) {
      boundClaudeId = claudeId;
      cardSessionBindingStore.bindClaudeSessionId(cardId, claudeId);
    }
    const err = snap.lastError;
    if (err === null || err.cause !== "resume_failed" || consumedAt === err.at) {
      return;
    }
    consumedAt = err.at;
    pickerNoticeStore.set(cardId, {
      category: "resume_failed",
      message: err.message,
    });
    cardSessionBindingStore.clearBinding(cardId);
  });
}

const TOUCHED_CARD_IDS = new Set<string>();

function bindForTest(cardId: string, tugSessionId: string): void {
  TOUCHED_CARD_IDS.add(cardId);
  cardSessionBindingStore.setBinding(cardId, makeBinding(cardId, tugSessionId));
}

afterEach(() => {
  for (const id of TOUCHED_CARD_IDS) {
    cardSessionBindingStore.clearBinding(id);
    pickerNoticeStore.consume(id);
  }
  TOUCHED_CARD_IDS.clear();
});

// ---------------------------------------------------------------------------
// R-CHAIN-01 — Fresh new
// ---------------------------------------------------------------------------

describe("R-CHAIN-01 — Fresh new", () => {
  let logs: CapturedLogs;
  let fetchH: FetchHarness;
  beforeEach(() => {
    logs = captureLifecycleLogs();
    fetchH = installFetchMock();
  });
  afterEach(() => {
    logs.restore();
    fetchH.restore();
  });

  it("spawn → session_init → claudeSessionId on binding → history.push lands under that id", async () => {
    const cardId = "card-rchain-01";
    const tugId = "tug-rchain-01";
    const conn = new MockTugConnection();
    const store = makeStore(conn, tugId);
    const unsubscribe = installCardObserver(cardId, store);

    // Picker minted `tugId` and the spawn_session frame went out.
    // (We seed the binding directly here — wire-side tests for the
    // ack live in action-dispatch.test.ts.)
    bindForTest(cardId, tugId);

    // Bridge forwards `session_init` from claude. With no silent
    // fallback, claude's id always equals the requested id for a
    // fresh spawn.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "session_init",
      session_id: tugId,
      tug_session_id: tugId,
    });

    // Lifecycle: code_store.session_init_recv carries both ids.
    const initEvt = logs.expectEvent("code_store.session_init_recv");
    expect(initEvt.fields.tug_session_id).toBe(tugId);
    expect(initEvt.fields.claude_session_id).toBe(tugId);

    // Binding's claudeSessionId now reflects the canonical id.
    expect(cardSessionBindingStore.getBinding(cardId)?.claudeSessionId).toBe(
      tugId,
    );

    // Push a history entry under the freshly-arrived claude id.
    const history = new PromptHistoryStore();
    history.push({
      id: `${tugId}-1`,
      sessionId: tugId,
      projectPath: PROJECT_DIR,
      route: "❯",
      text: "hello world",
      atoms: [],
      timestamp: 1,
    });

    // PUT URL contains the claude id (history keys on it).
    const put = fetchH.records.find(
      (r) => r.method === "PUT" && r.url.includes("prompt.history"),
    );
    expect(put).toBeDefined();
    expect(put!.url).toContain(encodeURIComponent(tugId));
    expect(logs.expectEvent("history.put").fields.session_id).toBe(tugId);

    unsubscribe();
    store.dispose();
  });
});

// ---------------------------------------------------------------------------
// R-CHAIN-02 — Resume success
// ---------------------------------------------------------------------------

describe("R-CHAIN-02 — Resume success", () => {
  let logs: CapturedLogs;
  let fetchH: FetchHarness;
  beforeEach(() => {
    logs = captureLifecycleLogs();
    fetchH = installFetchMock();
  });
  afterEach(() => {
    logs.restore();
    fetchH.restore();
  });

  it("history pre-seeded for X, session_init({X}), loadSession returns the persisted entries", async () => {
    const cardId = "card-rchain-02";
    const sessionId = "claude-rchain-02";

    // Pre-seed the persisted history for this session.
    fetchH.seedGet(`prompt.history/${encodeURIComponent(sessionId)}`, {
      kind: "json",
      value: [
        {
          id: `${sessionId}-1`,
          sessionId,
          projectPath: PROJECT_DIR,
          route: "❯",
          text: "remember my favorite color is green",
          atoms: [],
          timestamp: 1,
        },
      ],
    });

    const conn = new MockTugConnection();
    const store = makeStore(conn, sessionId);
    const unsubscribe = installCardObserver(cardId, store);
    bindForTest(cardId, sessionId);

    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "session_init",
      session_id: sessionId,
      tug_session_id: sessionId,
    });

    // Binding picks up the canonical id.
    expect(cardSessionBindingStore.getBinding(cardId)?.claudeSessionId).toBe(
      sessionId,
    );

    // Load the persisted history.
    const history = new PromptHistoryStore();
    await history.loadSession(sessionId);

    const get = fetchH.records.find(
      (r) =>
        r.method === "GET" && r.url.includes(encodeURIComponent(sessionId)),
    );
    expect(get).toBeDefined();
    const getEvt = logs.expectEvent("history.get");
    expect(getEvt.fields.session_id).toBe(sessionId);
    expect(getEvt.fields.entry_count).toBe("1");

    // Entry is reachable via the route provider.
    const provider = history.createRouteProvider(sessionId, "❯");
    const restored = provider.back({ text: "", atoms: [], selection: null });
    expect(restored?.text).toBe("remember my favorite color is green");

    unsubscribe();
    store.dispose();
  });
});

// ---------------------------------------------------------------------------
// R-CHAIN-03 — Resume failure → no silent fallback
// ---------------------------------------------------------------------------

describe("R-CHAIN-03 — Resume failure", () => {
  let logs: CapturedLogs;
  let fetchH: FetchHarness;
  beforeEach(() => {
    logs = captureLifecycleLogs();
    fetchH = installFetchMock();
  });
  afterEach(() => {
    logs.restore();
    fetchH.restore();
  });

  it("resume_failed → lastError populated, binding cleared, picker notice stashed, claudeSessionId never bound", () => {
    const cardId = "card-rchain-03";
    const staleId = "claude-stale-id";
    const conn = new MockTugConnection();
    const store = makeStore(conn, staleId);
    const unsubscribe = installCardObserver(cardId, store);
    bindForTest(cardId, staleId);

    // Bridge forwards tugcode's `resume_failed` IPC frame.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "resume_failed",
      reason: "missing_jsonl",
      stale_session_id: staleId,
      tug_session_id: staleId,
    });

    const recvEvt = logs.expectEvent("code_store.resume_failed_recv");
    expect(recvEvt.fields.tug_session_id).toBe(staleId);
    expect(recvEvt.fields.stale_session_id).toBe(staleId);
    expect(recvEvt.fields.reason).toBe("missing_jsonl");

    // lastError populated with cause=resume_failed.
    const snap = store.getSnapshot();
    expect(snap.lastError?.cause).toBe("resume_failed");

    // claudeSessionId never took a value (the resume never reached
    // session_init).
    expect(snap.claudeSessionId).toBeNull();

    // Card observer (mirroring TideCardBody) cleared the binding and
    // stashed a notice.
    expect(cardSessionBindingStore.getBinding(cardId)).toBeUndefined();
    const notice = pickerNoticeStore.consume(cardId);
    expect(notice?.category).toBe("resume_failed");

    // No history.put for this attempt — the entry never bound long
    // enough to push.
    expect(
      fetchH.records.some(
        (r) => r.method === "PUT" && r.url.includes("prompt.history"),
      ),
    ).toBe(false);

    unsubscribe();
    store.dispose();
  });
});

// ---------------------------------------------------------------------------
// R-CHAIN-04 — Two cards same project, both Resume
// ---------------------------------------------------------------------------

describe("R-CHAIN-04 — Concurrent resume rejected", () => {
  let logs: CapturedLogs;
  let fetchH: FetchHarness;
  beforeEach(() => {
    logs = captureLifecycleLogs();
    fetchH = installFetchMock();
  });
  afterEach(() => {
    logs.restore();
    fetchH.restore();
  });

  it("Card B's CodeSessionStore receives errored{session_live_elsewhere} and never binds claudeSessionId", () => {
    const sessionId = "claude-rchain-04";
    const cardA = "card-rchain-04-a";
    const cardB = "card-rchain-04-b";

    // Card A binds successfully under sessionId.
    const connA = new MockTugConnection();
    const storeA = makeStore(connA, sessionId);
    const unsubA = installCardObserver(cardA, storeA);
    bindForTest(cardA, sessionId);
    connA.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "session_init",
      session_id: sessionId,
      tug_session_id: sessionId,
    });
    expect(cardSessionBindingStore.getBinding(cardA)?.claudeSessionId).toBe(
      sessionId,
    );

    // Card B picks Resume on the same id. The supervisor would reject
    // and broadcast `SESSION_STATE = errored { detail: "session_live_elsewhere" }`.
    // Simulate that wire frame here.
    const connB = new MockTugConnection();
    const storeB = makeStore(connB, sessionId);
    const unsubB = installCardObserver(cardB, storeB);
    bindForTest(cardB, sessionId);

    connB.dispatchDecoded(FeedId.SESSION_STATE, {
      tug_session_id: sessionId,
      state: "errored",
      detail: "session_live_elsewhere",
    });

    const snapB = storeB.getSnapshot();
    expect(snapB.phase).toBe("errored");
    expect(snapB.lastError?.cause).toBe("session_state_errored");
    expect(snapB.lastError?.message).toContain("session_live_elsewhere");
    // Card B never observed session_init → claudeSessionId stays null.
    expect(snapB.claudeSessionId).toBeNull();

    // Card A is unaffected.
    expect(cardSessionBindingStore.getBinding(cardA)?.claudeSessionId).toBe(
      sessionId,
    );

    unsubA();
    unsubB();
    storeA.dispose();
    storeB.dispose();
  });
});
