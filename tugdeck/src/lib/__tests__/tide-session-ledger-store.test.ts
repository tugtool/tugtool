/**
 * Unit tests for `TideSessionLedgerStore`.
 *
 * Drives the store directly: a `TestFrameChannel` stands in for the wire,
 * and the events bus (`tide-session-ledger-events`) is the channel through
 * which simulated server pushes flow into the store.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { TugConnection } from "@/connection";
import { FeedId } from "@/protocol";
import type { SessionRow } from "@/protocol";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";
import {
  TideSessionLedgerStore,
} from "@/lib/tide-session-ledger-store";
import {
  _resetTideSessionLedgerEventsForTest,
  publishForgetSessionErr,
  publishForgetSessionOk,
  publishForgetWorkspaceSessionsOk,
  publishListSessionsErr,
  publishListSessionsOk,
  publishSessionUpdated,
} from "@/lib/tide-session-ledger-events";

function makeRow(partial: Partial<SessionRow> & { session_id: string }): SessionRow {
  return {
    session_id: partial.session_id,
    workspace_key: partial.workspace_key ?? "ws-1",
    project_dir: partial.project_dir ?? "/proj",
    created_at: partial.created_at ?? 1,
    last_used_at: partial.last_used_at ?? 1,
    turn_count: partial.turn_count ?? 0,
    first_user_prompt: partial.first_user_prompt ?? null,
    state: partial.state ?? "closed",
    card_id_live: partial.card_id_live ?? null,
  };
}

function newStore(): { store: TideSessionLedgerStore; conn: TestFrameChannel } {
  const conn = new TestFrameChannel();
  const store = new TideSessionLedgerStore(conn as unknown as TugConnection);
  return { store, conn };
}

describe("TideSessionLedgerStore", () => {
  beforeEach(() => {
    _resetTideSessionLedgerEventsForTest();
  });
  afterEach(() => {
    _resetTideSessionLedgerEventsForTest();
  });

  it("first call returns pending and dispatches a list_sessions request", () => {
    const { store, conn } = newStore();
    const snap = store.getSnapshot("ws-1");
    expect(snap.status).toBe("pending");
    expect(snap.rows).toEqual([]);

    // The store must have emitted a CONTROL frame.
    const frames = conn.recordedFrames.filter((f) => f.feedId === FeedId.CONTROL);
    expect(frames.length).toBe(1);
    const decoded = JSON.parse(
      new TextDecoder().decode(frames[0].decoded as Uint8Array),
    );
    expect(decoded).toEqual({
      action: "list_sessions",
      project_dir: "ws-1",
    });
    store.dispose();
  });

  it("settles to ready after list_sessions_ok", () => {
    const { store } = newStore();
    let ticks = 0;
    const unsub = store.subscribe(() => {
      ticks += 1;
    });
    store.getSnapshot("ws-1");
    publishListSessionsOk({
      project_dir: "ws-1",
      sessions: [
        makeRow({ session_id: "s1", last_used_at: 100 }),
        makeRow({ session_id: "s2", last_used_at: 200 }),
      ],
    });
    const snap = store.getSnapshot("ws-1");
    expect(snap.status).toBe("ready");
    expect(snap.rows.map((r) => r.session_id)).toEqual(["s2", "s1"]);
    expect(ticks).toBeGreaterThanOrEqual(1);
    unsub();
    store.dispose();
  });

  it("settles to error on list_sessions_err", () => {
    const { store } = newStore();
    store.getSnapshot("ws-1");
    publishListSessionsErr({ project_dir: "ws-1", reason: "ledger_read_failed" });
    const snap = store.getSnapshot("ws-1");
    expect(snap.status).toBe("error");
    expect(snap.error).toEqual({ reason: "ledger_read_failed" });
    store.dispose();
  });

  it("returns the same snapshot reference until a change lands", () => {
    const { store } = newStore();
    store.getSnapshot("ws-1");
    publishListSessionsOk({
      project_dir: "ws-1",
      sessions: [makeRow({ session_id: "s1" })],
    });
    const a = store.getSnapshot("ws-1");
    const b = store.getSnapshot("ws-1");
    expect(a).toBe(b);
    store.dispose();
  });

  it("session_updated patches a row in place and re-sorts", () => {
    const { store } = newStore();
    store.getSnapshot("ws-1");
    publishListSessionsOk({
      project_dir: "ws-1",
      sessions: [
        makeRow({ session_id: "s1", last_used_at: 100, turn_count: 0 }),
        makeRow({ session_id: "s2", last_used_at: 50, turn_count: 0 }),
      ],
    });
    publishSessionUpdated({
      session_id: "s2",
      fields: makeRow({ session_id: "s2", last_used_at: 200, turn_count: 1 }),
    });
    const snap = store.getSnapshot("ws-1");
    expect(snap.rows.map((r) => r.session_id)).toEqual(["s2", "s1"]);
    expect(snap.rows[0].turn_count).toBe(1);
    store.dispose();
  });

  it("session_updated { removed: true } drops the row", () => {
    const { store } = newStore();
    store.getSnapshot("ws-1");
    publishListSessionsOk({
      project_dir: "ws-1",
      sessions: [
        makeRow({ session_id: "s1" }),
        makeRow({ session_id: "s2" }),
      ],
    });
    publishSessionUpdated({ session_id: "s1", removed: true });
    const snap = store.getSnapshot("ws-1");
    expect(snap.rows.map((r) => r.session_id)).toEqual(["s2"]);
    store.dispose();
  });

  it("session_updated for an uncached workspace is ignored", () => {
    const { store } = newStore();
    store.getSnapshot("ws-1");
    publishListSessionsOk({ project_dir: "ws-1", sessions: [] });
    // Push for a workspace we never subscribed to.
    publishSessionUpdated({
      session_id: "other",
      fields: makeRow({ session_id: "other", workspace_key: "ws-other" }),
    });
    expect(store.getSnapshot("ws-1").rows).toEqual([]);
    store.dispose();
  });

  it("invalidateAll flips ready entries to idle and re-fetches on next getSnapshot", () => {
    const { store, conn } = newStore();
    store.getSnapshot("ws-1");
    publishListSessionsOk({
      project_dir: "ws-1",
      sessions: [makeRow({ session_id: "s1" })],
    });
    expect(store.getSnapshot("ws-1").status).toBe("ready");
    const beforeInvalidate = conn.recordedFrames.length;

    store.invalidateAll();
    // After invalidateAll, the next getSnapshot returns pending and
    // re-issues the request.
    const next = store.getSnapshot("ws-1");
    expect(next.status).toBe("pending");
    expect(conn.recordedFrames.length).toBe(beforeInvalidate + 1);
    store.dispose();
  });

  it("forgetSession resolves with the CONTROL ack", async () => {
    const { store, conn } = newStore();
    const promise = store.forgetSession("s1");

    // The store must have emitted a forget_session frame.
    const frames = conn.recordedFrames.filter((f) => f.feedId === FeedId.CONTROL);
    expect(frames.length).toBe(1);
    const decoded = JSON.parse(
      new TextDecoder().decode(frames[0].decoded as Uint8Array),
    );
    expect(decoded).toEqual({ action: "forget_session", session_id: "s1" });

    // Simulate the server's ack.
    publishForgetSessionOk({ session_id: "s1" });
    const result = await promise;
    expect(result).toEqual({ ok: true });
    store.dispose();
  });

  it("forgetSession resolves with error on _err", async () => {
    const { store } = newStore();
    const promise = store.forgetSession("live1");
    publishForgetSessionErr({ session_id: "live1", reason: "session_is_live" });
    const result = await promise;
    expect(result).toEqual({ error: { reason: "session_is_live" } });
    store.dispose();
  });

  it("forgetWorkspaceSessions resolves with the count from the ack", async () => {
    const { store, conn } = newStore();
    const promise = store.forgetWorkspaceSessions("ws-1");
    const frames = conn.recordedFrames.filter((f) => f.feedId === FeedId.CONTROL);
    expect(frames.length).toBe(1);
    const decoded = JSON.parse(
      new TextDecoder().decode(frames[0].decoded as Uint8Array),
    );
    expect(decoded).toEqual({
      action: "forget_workspace_sessions",
      workspace_key: "ws-1",
    });
    publishForgetWorkspaceSessionsOk({ workspace_key: "ws-1", count: 3 });
    const result = await promise;
    expect(result).toEqual({ ok: true, count: 3 });
    store.dispose();
  });

  it("session_updated patches across workspaces using the row payload's workspace_key", () => {
    // Even if the row's workspace isn't in the cache, the reverse index
    // remembers the location for a future lookup. Verifies the
    // bookkeeping doesn't lose track of late-arriving rows.
    const { store } = newStore();
    publishSessionUpdated({
      session_id: "s1",
      fields: makeRow({ session_id: "s1", workspace_key: "ws-2" }),
    });
    // The store hasn't fetched ws-2 yet; first getSnapshot triggers a
    // pending state. The reverse index now knows about s1, but the
    // visible snapshot remains pending until list_sessions_ok lands.
    const snap = store.getSnapshot("ws-2");
    expect(snap.status).toBe("pending");
    store.dispose();
  });
});
