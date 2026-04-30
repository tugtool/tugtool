/**
 * Snapshot integration for `transportState` on `CodeSessionStore`.
 *
 * Where `reducer.test.ts` pins the pure state-machine logic, this file
 * drives a real store through the full `online → offline → restoring
 * → online` lifecycle and asserts that the public snapshot tracks
 * each transition — including the `canSubmit` gating from [D01],
 * which is a conjunction of `phase ∈ {idle, errored}` and
 * `transportState === "online"`.
 *
 * The store is exercised through its public API only:
 * `lifecycle.notifyConnectionDidClose()` for transport_close, and
 * direct reducer dispatch via private internals for `transport_open`
 * / `transport_settled` (those wires land in Step 5; until then the
 * tests use the same `CodeSessionEvent` vocabulary the store will
 * eventually self-dispatch).
 */

import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import type { TugConnection } from "@/connection";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import type { CodeSessionEvent } from "@/lib/code-session-store/events";

function constructStore(
  conn: TestFrameChannel,
  lifecycle: ConnectionLifecycle = new ConnectionLifecycle(),
): CodeSessionStore {
  return new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    lifecycle,
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
  });
}

/**
 * Step 5 will install lifecycle wires that translate
 * `connectionDidReconnect` → `transport_open` and a binding-arrived
 * effect → `transport_settled`. Until then, the snapshot tests reach
 * into the store via a typed cast to call its private `dispatch`. The
 * integration assertion is on the snapshot the store hands back, so
 * the entry point is incidental — the contract under test is "the
 * snapshot mirrors the reducer's transportState transitions."
 */
function dispatch(store: CodeSessionStore, event: CodeSessionEvent): void {
  (store as unknown as { dispatch(e: CodeSessionEvent): void }).dispatch(event);
}

describe("CodeSessionStore — transportState snapshot integration (Step 4)", () => {
  it("drives online → offline → restoring → online and mirrors canSubmit", () => {
    const conn = new TestFrameChannel();
    const lifecycle = new ConnectionLifecycle();
    const store = constructStore(conn, lifecycle);

    // Initial: online + idle ⇒ canSubmit = true.
    let snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transportState).toBe("online");
    expect(snap.canSubmit).toBe(true);

    // Wire drops. transportState flips to offline; canSubmit clamps
    // even though phase is still idle.
    lifecycle.notifyConnectionDidClose();
    snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transportState).toBe("offline");
    expect(snap.canSubmit).toBe(false);

    // Wire is back, but the per-card binding has not been re-acked.
    // transportState advances to restoring; canSubmit stays clamped.
    dispatch(store, { type: "transport_open" });
    snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transportState).toBe("restoring");
    expect(snap.canSubmit).toBe(false);

    // Binding lands. transportState returns to online; canSubmit
    // releases.
    dispatch(store, { type: "transport_settled" });
    snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transportState).toBe("online");
    expect(snap.canSubmit).toBe(true);
  });

  it("an errored phase with transportState=online still allows submit (retry)", () => {
    // [D01] canSubmit is the *conjunction* of phase and transport.
    // Phase=errored + transport=online means the user can retry —
    // the wire is fine; the previous turn just didn't finish cleanly.
    const conn = new TestFrameChannel();
    const lifecycle = new ConnectionLifecycle();
    const store = constructStore(conn, lifecycle);

    store.send("hi", []);
    expect(store.getSnapshot().phase).toBe("submitting");

    // Force errored without dropping the wire.
    dispatch(store, {
      type: "session_state_errored",
      detail: "boom",
    });
    const snap = store.getSnapshot();
    expect(snap.phase).toBe("errored");
    expect(snap.transportState).toBe("online");
    expect(snap.canSubmit).toBe(true);
  });

  it("an idle phase with transportState=offline blocks submit until settled", () => {
    const conn = new TestFrameChannel();
    const lifecycle = new ConnectionLifecycle();
    const store = constructStore(conn, lifecycle);

    lifecycle.notifyConnectionDidClose();
    expect(store.getSnapshot().canSubmit).toBe(false);

    dispatch(store, { type: "transport_open" });
    expect(store.getSnapshot().canSubmit).toBe(false);

    dispatch(store, { type: "transport_settled" });
    expect(store.getSnapshot().canSubmit).toBe(true);
  });
});
