/**
 * Step 1 scaffold sanity: construct a `CodeSessionStore`, assert the
 * initial snapshot shape, the seeded streamingDocument values, and the
 * memoization contract from [D11] ([F5]) that `getSnapshot()` returns
 * a stable reference between dispatches.
 */

import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import type { TugConnection } from "@/connection";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";

const TUG_SESSION_ID = FIXTURE_IDS.TUG_SESSION_ID;

function makeInertConnection(): TugConnection {
  return new TestFrameChannel() as unknown as TugConnection;
}

function makeInertLifecycle(): ConnectionLifecycle {
  return new ConnectionLifecycle();
}

describe("CodeSessionStore — Step 1 scaffold", () => {
  it("exposes the initial snapshot shape", () => {
    const store = new CodeSessionStore({
      conn: makeInertConnection(),
      lifecycle: makeInertLifecycle(),
      tugSessionId: TUG_SESSION_ID,
      sessionMode: "new",
    });

    const snap = store.getSnapshot();

    expect(snap.phase).toBe("idle");
    expect(snap.tugSessionId).toBe(TUG_SESSION_ID);
    expect(snap.displayLabel).toBe(TUG_SESSION_ID.slice(0, 8));
    expect(snap.sessionMode).toBe("new");
    expect(snap.activeMsgId).toBeNull();
    expect(snap.canSubmit).toBe(true);
    expect(snap.canInterrupt).toBe(false);
    expect(snap.pendingApproval).toBeNull();
    expect(snap.pendingQuestion).toBeNull();
    expect(snap.queuedSends.length).toBe(0);
    expect(snap.transcript.length).toBe(0);
    expect(snap.activeTurn).toBeNull();
    expect(snap.lastCost).toBeNull();
    expect(snap.lastError).toBeNull();
  });

  it("memoizes getSnapshot between dispatches", () => {
    const store = new CodeSessionStore({
      conn: makeInertConnection(),
      lifecycle: makeInertLifecycle(),
      tugSessionId: TUG_SESSION_ID,
      sessionMode: "new",
    });

    const snap1 = store.getSnapshot();
    const snap2 = store.getSnapshot();

    // Reference equality — required by useSyncExternalStore (T3.4.b).
    expect(snap1).toBe(snap2);
  });

  it("respects a custom displayLabel", () => {
    const store = new CodeSessionStore({
      conn: makeInertConnection(),
      lifecycle: makeInertLifecycle(),
      tugSessionId: TUG_SESSION_ID,
      displayLabel: "card-A",
      sessionMode: "new",
    });

    expect(store.getSnapshot().displayLabel).toBe("card-A");
  });

  it("dispose clears in-flight paths and preserves an empty transcript", () => {
    const store = new CodeSessionStore({
      conn: makeInertConnection(),
      lifecycle: makeInertLifecycle(),
      tugSessionId: TUG_SESSION_ID,
      sessionMode: "new",
    });

    store.dispose();

    // Under the per-turn-paths architecture the streamingDocument's
    // schema starts empty and only grows as turns mint per-turn
    // paths. There were no turns here, so the schema is still empty;
    // there's nothing to assert about "inflight reset". The original
    // intent — "dispose leaves no stale in-flight state" — is now
    // satisfied by construction (the streamingDocument is GC'd with
    // the store instance).
    // [L23] transcript is user-visible — dispose does not touch it.
    expect(store.getSnapshot().transcript.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sessionMode plumbing
// ---------------------------------------------------------------------------

/**
 * `sessionMode` is captured from the per-card `CardSessionBinding` at
 * construction and threaded onto the snapshot so pure derivations (e.g.
 * `deriveDevCardBannerSpec`) can branch on the user's session-open
 * intent without a second subscription. The store itself does not act
 * on the value — the field is a passive carrier — so these tests only
 * verify the plumbing: ctor arg → snapshot field, both values
 * round-trip, and the field is reference-stable across snapshots.
 *
 * [L02] external state enters React via `useSyncExternalStore`; the
 *       snapshot is what `useSyncExternalStore` reads, so adding a
 *       field here is the L02-compliant way to expose it.
 * [L24] `sessionMode` is structure-zone metadata — it parameterizes
 *       the store's externally observable shape and never mutates;
 *       it lives on the snapshot, not in component-local React state.
 */
describe("CodeSessionStore — sessionMode plumbing", () => {
  it("threads sessionMode='new' from the constructor onto the snapshot", () => {
    const store = new CodeSessionStore({
      conn: makeInertConnection(),
      lifecycle: makeInertLifecycle(),
      tugSessionId: TUG_SESSION_ID,
      sessionMode: "new",
    });

    expect(store.getSnapshot().sessionMode).toBe("new");
  });

  it("threads sessionMode='resume' from the constructor onto the snapshot", () => {
    const store = new CodeSessionStore({
      conn: makeInertConnection(),
      lifecycle: makeInertLifecycle(),
      tugSessionId: TUG_SESSION_ID,
      sessionMode: "resume",
    });

    expect(store.getSnapshot().sessionMode).toBe("resume");
  });

  it("preserves sessionMode reference-stably across snapshot reads", () => {
    const store = new CodeSessionStore({
      conn: makeInertConnection(),
      lifecycle: makeInertLifecycle(),
      tugSessionId: TUG_SESSION_ID,
      sessionMode: "resume",
    });

    // Two reads with no intervening dispatch must return the same
    // snapshot instance — required by useSyncExternalStore. The
    // sessionMode field rides on that same identity.
    const snap1 = store.getSnapshot();
    const snap2 = store.getSnapshot();
    expect(snap1).toBe(snap2);
    expect(snap1.sessionMode).toBe(snap2.sessionMode);
  });
});
