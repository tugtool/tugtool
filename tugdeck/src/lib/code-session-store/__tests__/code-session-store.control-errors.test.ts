/**
 * T3.4.a.1 — CONTROL-error routing.
 *
 * Closes the gap between [§T3.4.a Spec S04](../../../../../roadmap/tide.md)
 * promised `lastError.cause` union (five members) and the three-member
 * union T3.4.a shipped. Two new causes reach the store via the CONTROL
 * feed:
 *
 * - `session_unknown`: supervisor orphan-dispatcher path. Fires when
 *   a CODE_INPUT write references a session the supervisor no longer
 *   knows about — typically a stale `tug_session_id` from tugbank
 *   after a server reconnect. The wire frame carries
 *   `tug_session_id`, so the per-card filter routes it via the normal
 *   session-match path.
 *
 * - `session_not_owned`: router P5 authz rejection path. Fires when a
 *   client sends CODE_INPUT for a session another client owns, or
 *   (more commonly) a session this client never registered via
 *   `spawn_session`. The wire frame from `router.rs` currently carries
 *   NO `tug_session_id`, so the per-card filter relaxes for CONTROL
 *   error frames and the reducer's phase gate picks the store that is
 *   actually waiting on an input response.
 *
 * Neither failure mode is covered by SESSION_STATE errored or
 * transport_close — the supervisor doesn't emit a state change, and
 * the socket stays open. Without this handling, a card with a stale
 * `tug_session_id` hits Send and sits in `submitting` forever.
 */

import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import type { TugConnection } from "@/connection";
import {
  MockTugConnection,
} from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import { FeedId } from "@/protocol";

const TUG_A = FIXTURE_IDS.TUG_SESSION_ID;
const TUG_B = "tug00000-0000-4000-8000-0000000000bb";

function constructStore(
  conn: MockTugConnection,
  tugSessionId: string = TUG_A,
): CodeSessionStore {
  return new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    tugSessionId,
  });
}

describe("CodeSessionStore — session_unknown CONTROL error (T3.4.a.1)", () => {
  it("routes to errored with cause=session_unknown when the frame matches this session", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("read something", []);
    expect(store.getSnapshot().phase).toBe("submitting");

    // Supervisor's orphan-dispatcher frame (see
    // `build_session_unknown_frame` in agent_supervisor.rs) — carries
    // `tug_session_id`, so the per-card filter routes it directly.
    conn.dispatchDecoded(FeedId.CONTROL, {
      type: "error",
      detail: "session_unknown",
      tug_session_id: TUG_A,
    });

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("errored");
    expect(snap.lastError?.cause).toBe("session_unknown");
    expect(snap.lastError?.message).toBe("session_unknown");
  });

  it("drops session_unknown while the store is idle", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    conn.dispatchDecoded(FeedId.CONTROL, {
      type: "error",
      detail: "session_unknown",
      tug_session_id: TUG_A,
    });

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.lastError).toBeNull();
  });

  it("does not route session_unknown for some other session", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hi", []);

    // Frame for a different tug_session_id — per-card filter drops it.
    conn.dispatchDecoded(FeedId.CONTROL, {
      type: "error",
      detail: "session_unknown",
      tug_session_id: TUG_B,
    });

    expect(store.getSnapshot().phase).toBe("submitting");
    expect(store.getSnapshot().lastError).toBeNull();
  });
});

describe("CodeSessionStore — session_not_owned CONTROL error (T3.4.a.1)", () => {
  it("routes to errored via the phase gate when the wire frame has no tug_session_id", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hi", []);
    expect(store.getSnapshot().phase).toBe("submitting");

    // Exactly the shape `router.rs` emits on the P5 authz reject:
    // `{type: "error", detail: "session_not_owned"}` with no tsid.
    conn.dispatchDecoded(FeedId.CONTROL, {
      type: "error",
      detail: "session_not_owned",
    });

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("errored");
    expect(snap.lastError?.cause).toBe("session_not_owned");
    expect(snap.lastError?.message).toBe("session_not_owned");
  });

  it("drops session_not_owned while the store is idle (no active send)", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    conn.dispatchDecoded(FeedId.CONTROL, {
      type: "error",
      detail: "session_not_owned",
    });

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.lastError).toBeNull();
  });

  it("drops session_not_owned once the store has received Claude tokens", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hi", []);
    // Drive past awaiting_first_token into streaming.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: TUG_A,
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "a",
      is_partial: true,
      rev: 0,
      seq: 0,
    });
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: TUG_A,
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "b",
      is_partial: true,
      rev: 1,
      seq: 0,
    });
    expect(store.getSnapshot().phase).toBe("streaming");

    // A late unrouted CONTROL error is not about THIS card's latest
    // write — this card already got a response from Claude.
    conn.dispatchDecoded(FeedId.CONTROL, {
      type: "error",
      detail: "session_not_owned",
    });

    expect(store.getSnapshot().phase).toBe("streaming");
    expect(store.getSnapshot().lastError).toBeNull();
  });
});

describe("CodeSessionStore — multi-card routing of unrouted CONTROL errors (T3.4.a.1)", () => {
  it("routes an unrouted session_not_owned only to the store in a waiting-for-response phase", () => {
    const conn = new MockTugConnection();
    const storeA = constructStore(conn, TUG_A);
    const storeB = constructStore(conn, TUG_B);

    storeA.send("from A", []);
    // storeB stays idle — it hasn't sent anything.
    expect(storeA.getSnapshot().phase).toBe("submitting");
    expect(storeB.getSnapshot().phase).toBe("idle");

    conn.dispatchDecoded(FeedId.CONTROL, {
      type: "error",
      detail: "session_not_owned",
    });

    expect(storeA.getSnapshot().phase).toBe("errored");
    expect(storeA.getSnapshot().lastError?.cause).toBe("session_not_owned");
    // storeB was never waiting on an input — the phase gate dropped
    // the frame even though the filter let it through.
    expect(storeB.getSnapshot().phase).toBe("idle");
    expect(storeB.getSnapshot().lastError).toBeNull();
  });

  it("recovers via send() from errored after a CONTROL error", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("first attempt", []);
    conn.dispatchDecoded(FeedId.CONTROL, {
      type: "error",
      detail: "session_unknown",
      tug_session_id: TUG_A,
    });
    expect(store.getSnapshot().phase).toBe("errored");
    const errAt = store.getSnapshot().lastError;
    expect(errAt).not.toBeNull();

    // The existing errored → submitting retry path already covers us.
    store.send("retry", []);
    expect(store.getSnapshot().phase).toBe("submitting");
    // lastError preserved across retry.
    expect(store.getSnapshot().lastError).toBe(errAt);

    // Successful turn clears lastError per Spec S04.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: TUG_A,
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "a",
      is_partial: true,
      rev: 0,
      seq: 0,
    });
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: TUG_A,
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "b",
      is_partial: true,
      rev: 1,
      seq: 0,
    });
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "turn_complete",
      tug_session_id: TUG_A,
      msg_id: FIXTURE_IDS.MSG_ID,
      result: "success",
    });
    expect(store.getSnapshot().phase).toBe("idle");
    expect(store.getSnapshot().lastError).toBeNull();
  });

  it("ignores non-error CONTROL frames with matching tug_session_id", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hi", []);

    // A spawn_session_ok frame for this session: the per-card filter
    // lets it through (tsid matches) but frameToEvent returns null
    // for anything that's not a CONTROL error. State untouched.
    conn.dispatchDecoded(FeedId.CONTROL, {
      type: "spawn_session_ok",
      tug_session_id: TUG_A,
      workspace_key: "ws-000",
    });

    expect(store.getSnapshot().phase).toBe("submitting");
    expect(store.getSnapshot().lastError).toBeNull();
  });

  it("ignores app-level CONTROL frames with no tug_session_id (reload, set-theme)", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hi", []);

    // App-level frames handled by action-dispatch.ts global handler.
    // The per-card filter drops them (non-error + no tsid).
    conn.dispatchDecoded(FeedId.CONTROL, { type: "reload" });
    conn.dispatchDecoded(FeedId.CONTROL, {
      type: "set-theme",
      theme: "dark",
    });

    expect(store.getSnapshot().phase).toBe("submitting");
    expect(store.getSnapshot().lastError).toBeNull();
  });
});
