/**
 * Step 11 — `TideTranscriptHost` integration tests.
 *
 * Mounts the host directly (not the full `TideCardContent`) so the
 * suite exercises the new wire-up — `CodeSessionStore` → adapter →
 * `TugListView` → cell renderers — without dragging in deck/portal/
 * picker setup. The full `TideCardContent` test suite is the place
 * for binding/picker behavior.
 *
 * Coverage:
 *  - Multi-turn rendering: load a multi-turn fixture, assert N
 *    `(user, code)` row pairs in correct order.
 *  - Immediate user row on `submit`.
 *  - Streaming-to-commit body updates; on commit, no in-flight pair
 *    survives.
 *  - No empty intermediate render at the streaming → committed
 *    transition (the [#md-block-api] mount-render contract).
 *  - Identifier source: `SessionMetadataStore.model` ↔ `"Code"`
 *    fallback.
 *  - User body plain text matches `userMessage.text` verbatim.
 *  - Persistence axis: rendered scroll container has
 *    `data-tug-scroll-key="tide-card-transcript"`.
 */

import "./setup-rtl";

import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import React from "react";
import { describe, it, expect, afterEach, beforeAll, beforeEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { initSync } from "../../crates/tugmark-wasm/pkg/tugmark_wasm.js";
import { TideTranscriptHost } from "@/components/tugways/cards/tide-card-transcript";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { CodeSessionStore } from "@/lib/code-session-store";
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import type { TugConnection } from "@/connection";
import {
  TestFrameChannel,
} from "@/lib/code-session-store/testing/mock-feed-store";
import {
  FIXTURE_IDS,
  loadGoldenProbe,
} from "@/lib/code-session-store/testing/golden-catalog";
import { FeedId } from "@/protocol";
import { SessionMetadataStore } from "@/lib/session-metadata-store";
import { ResponseSettingsStore } from "@/lib/response-settings-store";

// ---------------------------------------------------------------------------
// WASM initialisation — load once. `TugMarkdownBlock` uses the markdown
// pipeline backed by `tugmark-wasm`; without the synchronous init, the
// first render throws a `wasm.__wbindgen_malloc` reference error.
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const wasmPath = join(
  __dir,
  "../../crates/tugmark-wasm/pkg/tugmark_wasm_bg.wasm",
);

beforeAll(() => {
  const wasmBytes = readFileSync(wasmPath);
  initSync({ module: wasmBytes });
});

// ---------------------------------------------------------------------------
// Mock FeedStore for SessionMetadataStore — pattern from
// session-metadata-store.test.ts.
// ---------------------------------------------------------------------------

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

  emit(feedId: number, payload: unknown): void {
    const next = new Map(this._data);
    next.set(feedId, payload);
    this._data = next;
    for (const listener of this._listeners) listener();
  }
}

const METADATA_FEED_ID = 0x40 as never;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Harness {
  conn: TestFrameChannel;
  codeSessionStore: CodeSessionStore;
  metadataFeed: MockFeedStore;
  sessionMetadataStore: SessionMetadataStore;
  flushRaf: () => void;
}

function buildHarness(
  queuedRafCallbacks: FrameRequestCallback[],
): Harness {
  const conn = new TestFrameChannel();
  const codeSessionStore = new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    lifecycle: new ConnectionLifecycle(),
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
    sessionMode: "new",
  });
  const metadataFeed = new MockFeedStore();
  const sessionMetadataStore = new SessionMetadataStore(
    metadataFeed as never,
    METADATA_FEED_ID,
  );
  const flushRaf = (): void => {
    while (queuedRafCallbacks.length > 0) {
      const cb = queuedRafCallbacks.shift();
      cb?.(performance.now());
    }
  };
  return { conn, codeSessionStore, metadataFeed, sessionMetadataStore, flushRaf };
}

function renderHost(h: Harness) {
  return render(
    <ResponderChainProvider>
      <TideTranscriptHost
        codeSessionStore={h.codeSessionStore}
        sessionMetadataStore={h.sessionMetadataStore}
        responseStore={new ResponseSettingsStore()}
      />
    </ResponderChainProvider>,
  );
}

/** Hand-craft a complete `success` turn for multi-turn tests. */
function driveSyntheticSuccessTurn(
  conn: TestFrameChannel,
  msgId: string,
  text: string,
): void {
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "assistant_text",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    text: text.slice(0, 1),
    is_partial: true,
    rev: 0,
    seq: 0,
  });
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "assistant_text",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    text: text.slice(0, Math.min(2, text.length)),
    is_partial: true,
    rev: 1,
    seq: 0,
  });
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "assistant_text",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    text,
    is_partial: false,
    rev: 0,
    seq: 1,
  });
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
    type: "turn_complete",
    tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
    msg_id: msgId,
    result: "success",
  });
}

function userBodies(container: HTMLElement): string[] {
  const nodes = container.querySelectorAll(
    '[data-testid="tide-card-transcript-user-body"]',
  );
  return Array.from(nodes).map((n) => n.textContent ?? "");
}

function codeBodies(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(".tide-card-transcript-code-body"),
  );
}

function transcriptRows(container: HTMLElement): Array<{
  participant: string | null;
  identifier: string;
  body: string;
}> {
  const entries = container.querySelectorAll<HTMLElement>(
    '[data-slot="tug-transcript-entry"]',
  );
  return Array.from(entries).map((entry) => {
    const identifier = entry.querySelector(
      ".tug-transcript-entry__identifier",
    );
    const body = entry.querySelector(".tug-transcript-entry__body");
    return {
      participant: entry.getAttribute("data-participant"),
      identifier: identifier?.textContent ?? "",
      body: body?.textContent ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// rAF capture (TugMarkdownBlock streaming uses rAF coalescing)
// ---------------------------------------------------------------------------

let originalRAF: typeof globalThis.requestAnimationFrame;
let originalCancelRAF: typeof globalThis.cancelAnimationFrame;
let queuedRafCallbacks: FrameRequestCallback[];

beforeEach(() => {
  queuedRafCallbacks = [];
  originalRAF = globalThis.requestAnimationFrame;
  originalCancelRAF = globalThis.cancelAnimationFrame;
  (globalThis as unknown as {
    requestAnimationFrame: (cb: FrameRequestCallback) => number;
  }).requestAnimationFrame = (cb: FrameRequestCallback) => {
    queuedRafCallbacks.push(cb);
    return queuedRafCallbacks.length;
  };
  (globalThis as unknown as {
    cancelAnimationFrame: (id: number) => void;
  }).cancelAnimationFrame = () => undefined;
});

afterEach(() => {
  cleanup();
  (globalThis as unknown as {
    requestAnimationFrame: typeof globalThis.requestAnimationFrame;
  }).requestAnimationFrame = originalRAF;
  (globalThis as unknown as {
    cancelAnimationFrame: typeof globalThis.cancelAnimationFrame;
  }).cancelAnimationFrame = originalCancelRAF;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TideTranscriptHost — multi-turn rendering", () => {
  it("renders N (user, code) row pairs in committed order", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const h = buildHarness(queuedRafCallbacks);

    // Turn 1 — fixture-driven, msgId = MSG_ID.
    h.codeSessionStore.send("first", []);
    for (const event of probe.events) {
      h.conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
    }
    expect(h.codeSessionStore.getSnapshot().phase).toBe("idle");

    // Turn 2 — synthetic, msgId = MSG_ID_N(2). Fully committed
    // before render so we don't have to deal with mid-flight state.
    h.codeSessionStore.send("second", []);
    driveSyntheticSuccessTurn(
      h.conn,
      FIXTURE_IDS.MSG_ID_N(2),
      "second response",
    );
    expect(h.codeSessionStore.getSnapshot().phase).toBe("idle");
    expect(h.codeSessionStore.getSnapshot().transcript.length).toBe(2);

    const { container } = renderHost(h);

    const rows = transcriptRows(container);
    expect(rows.length).toBe(4);
    expect(rows[0].participant).toBe("user");
    expect(rows[1].participant).toBe("code");
    expect(rows[2].participant).toBe("user");
    expect(rows[3].participant).toBe("code");

    // User row bodies match the submission text verbatim.
    expect(userBodies(container)).toEqual(["first", "second"]);
  });

  it("submit('hi') makes the user row appear immediately", () => {
    const h = buildHarness(queuedRafCallbacks);
    const { container } = renderHost(h);

    expect(transcriptRows(container).length).toBe(0);

    act(() => {
      h.codeSessionStore.send("hi", []);
    });

    const rows = transcriptRows(container);
    expect(rows.length).toBe(2);
    expect(rows[0].participant).toBe("user");
    // No assistant_text frames have been dispatched yet — the
    // streaming code row is mounted but its body is empty.
    expect(userBodies(container)).toEqual(["hi"]);
  });
});

describe("TideTranscriptHost — streaming → commit lifecycle", () => {
  it("clears the in-flight pair on turn_complete(success); committed pair holds final text", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const h = buildHarness(queuedRafCallbacks);
    const { container } = renderHost(h);

    act(() => {
      h.codeSessionStore.send("hi", []);
    });
    expect(transcriptRows(container).length).toBe(2);

    act(() => {
      for (const event of probe.events) {
        h.conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
      }
      h.flushRaf();
    });

    // After commit: still 2 rows (one committed pair) — the in-flight
    // pair has disappeared.
    const rows = transcriptRows(container);
    expect(rows.length).toBe(2);
    expect(rows[0].participant).toBe("user");
    expect(rows[1].participant).toBe("code");

    // The committed code row's body holds the final assistant text
    // (test-01's terminal `assistant_text` is 28 'x' chars).
    const codeBody = codeBodies(container)[0];
    expect(codeBody).toBeDefined();
    expect(codeBody.textContent).toContain("x".repeat(28));
  });

  it("commits without an empty intermediate render of the code-committed cell", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const h = buildHarness(queuedRafCallbacks);
    const { container } = renderHost(h);

    act(() => {
      h.codeSessionStore.send("hi", []);
      // Drain everything inside one act so the committed cell mounts
      // and writes its initialText in the same React commit. The
      // [#md-block-api] mount-render contract pins this: the
      // committed `TugMarkdownBlock` paints its body inside
      // `useLayoutEffect`, before the browser paints the new DOM —
      // there should be no intermediate empty body.
      for (const event of probe.events) {
        h.conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
      }
      h.flushRaf();
    });

    const codeBody = codeBodies(container)[0];
    expect(codeBody).toBeDefined();
    expect(codeBody.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it("no code-streaming cell survives turn_complete(success)", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const h = buildHarness(queuedRafCallbacks);
    const { container } = renderHost(h);

    // Mid-flight: drive partials, observe a `code-streaming` kind on
    // the rendered cell wrapper.
    act(() => {
      h.codeSessionStore.send("hi", []);
      h.conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[0]);
      h.conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[1]);
      h.conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[2]);
      h.flushRaf();
    });
    const streamingDuring = container.querySelectorAll(
      '[data-tug-list-cell-kind="code-streaming"]',
    );
    expect(streamingDuring.length).toBe(1);

    // Drain the rest and turn_complete.
    act(() => {
      for (let i = 3; i < probe.events.length; i += 1) {
        h.conn.dispatchDecoded(FeedId.CODE_OUTPUT, probe.events[i]);
      }
      h.flushRaf();
    });

    // After commit: every `code` cell is `code-committed`; no
    // `code-streaming` cell remains in the tree. The list view's cell
    // wrapper carries the kind in `data-tug-list-cell-kind`, which
    // makes this verifiable directly without reaching into the
    // markdown block's internals.
    const stillStreaming = container.querySelectorAll(
      '[data-tug-list-cell-kind="code-streaming"]',
    );
    expect(stillStreaming.length).toBe(0);
    const committedCells = container.querySelectorAll(
      '[data-tug-list-cell-kind="code-committed"]',
    );
    expect(committedCells.length).toBe(1);
  });
});

describe("TideTranscriptHost — identifier source", () => {
  it("reflects SessionMetadataStore.model when set", () => {
    const h = buildHarness(queuedRafCallbacks);
    h.codeSessionStore.send("hi", []);
    driveSyntheticSuccessTurn(h.conn, FIXTURE_IDS.MSG_ID, "ok");

    act(() => {
      h.metadataFeed.emit(METADATA_FEED_ID as unknown as number, {
        type: "system_metadata",
        session_id: FIXTURE_IDS.CLAUDE_SESSION_ID,
        model: "claude-x.test",
        permission_mode: "default",
        cwd: "/tmp",
        slash_commands: [],
        skills: [],
      });
    });

    const { container } = renderHost(h);
    const codeRow = container.querySelectorAll<HTMLElement>(
      '[data-slot="tug-transcript-entry"][data-participant="code"]',
    )[0];
    expect(codeRow).toBeDefined();
    const identifier = codeRow.querySelector(
      ".tug-transcript-entry__identifier",
    );
    expect(identifier?.textContent).toBe("claude-x.test");
  });

  it('falls back to "Code" when the metadata store has no model', () => {
    const h = buildHarness(queuedRafCallbacks);
    h.codeSessionStore.send("hi", []);
    driveSyntheticSuccessTurn(h.conn, FIXTURE_IDS.MSG_ID, "ok");

    const { container } = renderHost(h);
    const codeRow = container.querySelectorAll<HTMLElement>(
      '[data-slot="tug-transcript-entry"][data-participant="code"]',
    )[0];
    const identifier = codeRow.querySelector(
      ".tug-transcript-entry__identifier",
    );
    expect(identifier?.textContent).toBe("Code");
  });
});

describe("TideTranscriptHost — user body verbatim ([D11])", () => {
  it("renders userMessage.text verbatim, no markdown parsing", () => {
    const h = buildHarness(queuedRafCallbacks);
    const text = "hello **world** with backticks `x`";
    h.codeSessionStore.send(text, []);
    driveSyntheticSuccessTurn(h.conn, FIXTURE_IDS.MSG_ID, "ok");

    const { container } = renderHost(h);
    const userBody = container.querySelector(
      '[data-testid="tide-card-transcript-user-body"]',
    );
    expect(userBody?.textContent).toBe(text);
    // No <strong> or <code> elements injected — the raw markdown is
    // rendered as-is per [D11].
    expect(userBody?.querySelector("strong")).toBeNull();
    expect(userBody?.querySelector("code")).toBeNull();
  });
});

describe("TideTranscriptHost — persistence axis", () => {
  it('writes data-tug-scroll-key="tide-card-transcript" on the scroll container', () => {
    const h = buildHarness(queuedRafCallbacks);
    const { container } = renderHost(h);
    const scrollContainer = container.querySelector(
      '[data-tug-scroll-key="tide-card-transcript"]',
    );
    expect(scrollContainer).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Interrupted indicator — committed turns whose `result === "interrupted"`
// surface a trailing "Interrupted" badge in the code-row body. Mirrors
// Claude Code's terminal layout where "Interrupted" sits as the
// postscript line under any partial assistant output. Both CASE B
// (post-first-delta interrupt) and the CASE-A-style empty-content
// interrupted entry are covered by the same indicator path.
// ---------------------------------------------------------------------------

describe("TideTranscriptHost — interrupted indicator", () => {
  it("renders the indicator on a CASE B interrupted turn (partial content + indicator)", () => {
    const h = buildHarness(queuedRafCallbacks);
    const { container } = renderHost(h);

    act(() => {
      h.codeSessionStore.send("hi", []);
      // One partial drives `submitting → awaiting_first_token` and
      // sets `activeMsgId`, putting us past the dividing line into
      // CASE B. The wire's eventual turn_complete(error) commits a
      // TurnEntry with `result: "interrupted"` carrying the partial.
      h.conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
        type: "assistant_text",
        tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
        msg_id: "msg-interrupted",
        text: "partial reply",
        is_partial: true,
        seq: 0,
        rev: 0,
      });
      h.codeSessionStore.interrupt();
      h.conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
        type: "turn_complete",
        tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
        msg_id: "msg-interrupted",
        result: "error",
      });
      h.flushRaf();
    });

    expect(h.codeSessionStore.getSnapshot().transcript.length).toBe(1);
    expect(h.codeSessionStore.getSnapshot().transcript[0].result).toBe("interrupted");

    const indicator = container.querySelector(
      '[data-slot="tide-card-transcript-interrupted"]',
    );
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Interrupted");

    // Partial content is still visible in the body alongside the
    // indicator.
    const codeBody = codeBodies(container)[0];
    expect(codeBody?.textContent).toContain("partial reply");
  });

  it("renders the indicator on an interrupted turn with no content (CASE-A-shape entry)", () => {
    // CASE A's user-facing flow doesn't actually commit a transcript
    // entry — handleInterrupt suppresses via pendingCaseAEchoes. But
    // the cell renderer itself shouldn't care WHY a turn ended up as
    // `result: "interrupted"` with empty content; it just needs to
    // surface the indicator. This test pins that contract by directly
    // committing a synthetic interrupted turn whose scratch was empty
    // at commit time (mirrors the pre-Design-E shape that older
    // sessions on disk could carry).
    const h = buildHarness(queuedRafCallbacks);
    const { container } = renderHost(h);

    act(() => {
      h.codeSessionStore.send("hi", []);
      // No partials → activeMsgId never set; turn_complete(error) with
      // explicit msg_id flows through the standard commit path
      // (handleTurnComplete commits a TurnEntry with empty assistant
      // text and result="interrupted"). Note: this is NOT the CASE A
      // suppressed path (pendingCaseAEchoes is 0 because the user
      // never pressed Stop in this scenario — claude failed silently
      // before any content). The cell renderer's interrupted path is
      // the same regardless of WHY content is empty.
      h.conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
        type: "turn_complete",
        tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
        msg_id: "msg-empty-interrupted",
        result: "error",
      });
      h.flushRaf();
    });

    expect(h.codeSessionStore.getSnapshot().transcript.length).toBe(1);
    expect(h.codeSessionStore.getSnapshot().transcript[0].result).toBe("interrupted");

    const indicator = container.querySelector(
      '[data-slot="tide-card-transcript-interrupted"]',
    );
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Interrupted");
  });

  it("does NOT render the indicator on a successful turn", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const h = buildHarness(queuedRafCallbacks);
    const { container } = renderHost(h);

    act(() => {
      h.codeSessionStore.send("hi", []);
      for (const event of probe.events) {
        h.conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
      }
      h.flushRaf();
    });

    expect(h.codeSessionStore.getSnapshot().transcript.length).toBe(1);
    expect(h.codeSessionStore.getSnapshot().transcript[0].result).toBe("success");

    const indicator = container.querySelector(
      '[data-slot="tide-card-transcript-interrupted"]',
    );
    expect(indicator).toBeNull();
  });
});
