/**
 * Step 1 scaffold sanity: construct a `CodeSessionStore`, assert the
 * initial snapshot shape, the seeded streamingDocument values, and the
 * memoization contract from [D11] ([F5]) that `getSnapshot()` returns
 * a stable reference between dispatches.
 */

import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import type { TugConnection } from "@/connection";
import { MockTugConnection } from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";

const TUG_SESSION_ID = FIXTURE_IDS.TUG_SESSION_ID;

function makeInertConnection(): TugConnection {
  return new MockTugConnection() as unknown as TugConnection;
}

describe("CodeSessionStore — Step 1 scaffold", () => {
  it("exposes the initial snapshot shape", () => {
    const store = new CodeSessionStore({
      conn: makeInertConnection(),
      tugSessionId: TUG_SESSION_ID,
    });

    const snap = store.getSnapshot();

    expect(snap.phase).toBe("idle");
    expect(snap.tugSessionId).toBe(TUG_SESSION_ID);
    expect(snap.claudeSessionId).toBeNull();
    expect(snap.displayLabel).toBe(TUG_SESSION_ID.slice(0, 8));
    expect(snap.activeMsgId).toBeNull();
    expect(snap.canSubmit).toBe(true);
    expect(snap.canInterrupt).toBe(false);
    expect(snap.pendingApproval).toBeNull();
    expect(snap.pendingQuestion).toBeNull();
    expect(snap.queuedSends).toBe(0);
    expect(snap.transcript.length).toBe(0);
    expect(snap.streamingPaths.assistant).toBe("inflight.assistant");
    expect(snap.streamingPaths.thinking).toBe("inflight.thinking");
    expect(snap.streamingPaths.tools).toBe("inflight.tools");
    expect(snap.lastCost).toBeNull();
    expect(snap.lastError).toBeNull();
  });

  it("seeds the streaming document via initialValues", () => {
    const store = new CodeSessionStore({
      conn: makeInertConnection(),
      tugSessionId: TUG_SESSION_ID,
    });

    expect(store.streamingDocument.get("inflight.assistant")).toBe("");
    expect(store.streamingDocument.get("inflight.thinking")).toBe("");
    expect(store.streamingDocument.get("inflight.tools")).toBe("[]");
  });

  it("memoizes getSnapshot between dispatches", () => {
    const store = new CodeSessionStore({
      conn: makeInertConnection(),
      tugSessionId: TUG_SESSION_ID,
    });

    const snap1 = store.getSnapshot();
    const snap2 = store.getSnapshot();

    // Reference equality — required by useSyncExternalStore (T3.4.b).
    expect(snap1).toBe(snap2);
  });

  it("respects a custom displayLabel", () => {
    const store = new CodeSessionStore({
      conn: makeInertConnection(),
      tugSessionId: TUG_SESSION_ID,
      displayLabel: "card-A",
    });

    expect(store.getSnapshot().displayLabel).toBe("card-A");
  });

  it("dispose clears in-flight paths and preserves an empty transcript", () => {
    const store = new CodeSessionStore({
      conn: makeInertConnection(),
      tugSessionId: TUG_SESSION_ID,
    });

    store.dispose();

    expect(store.streamingDocument.get("inflight.assistant")).toBe("");
    expect(store.streamingDocument.get("inflight.thinking")).toBe("");
    expect(store.streamingDocument.get("inflight.tools")).toBe("[]");
    // [L23] transcript is user-visible — dispose does not touch it.
    expect(store.getSnapshot().transcript.length).toBe(0);
  });
});
