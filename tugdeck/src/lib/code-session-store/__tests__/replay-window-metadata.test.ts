/**
 * Recency-window metadata recording — the reducer records the window a
 * `replay_complete` reports (which slice loaded; whether older turns
 * remain) onto `CodeSessionSnapshot.replayWindow`, and leaves it null on
 * a full / legacy replay that carries no window. Driven through the real
 * store + reducer via the wire-frame channel.
 */

import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import type { TugConnection } from "@/connection";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import { FeedId } from "@/protocol";

const TUG = FIXTURE_IDS.TUG_SESSION_ID;

function makeStore(): { store: CodeSessionStore; conn: TestFrameChannel } {
  const conn = new TestFrameChannel();
  const store = new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    lifecycle: new ConnectionLifecycle(),
    tugSessionId: TUG,
    sessionMode: "resume",
  });
  return { store, conn };
}

function emit(conn: TestFrameChannel, evt: Record<string, unknown>): void {
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, { ...evt, tug_session_id: TUG });
}

/** Open and close a replay window carrying the given `complete` fields. */
function replayWith(complete: Record<string, unknown>): CodeSessionStore {
  const { store, conn } = makeStore();
  emit(conn, { type: "replay_started" });
  emit(conn, { type: "replay_complete", count: 0, ...complete });
  return store;
}

describe("replay_complete — recency-window metadata", () => {
  it("records a windowed slice with older turns remaining", () => {
    // A long session: 200 total turns, the recent tail loaded → oldest
    // loaded turn is index 175.
    const store = replayWith({
      count: 25,
      firstLoadedTurnIndex: 175,
      totalTurns: 200,
      hasOlder: true,
    });
    expect(store.getSnapshot().replayWindow).toEqual({
      firstLoadedTurnIndex: 175,
      totalTurns: 200,
      hasOlder: true,
    });
  });

  it("records hasOlder:false when the whole session fits the window", () => {
    // 30 turns, window of 50 turns → all loaded.
    const store = replayWith({
      count: 30,
      firstLoadedTurnIndex: 0,
      totalTurns: 30,
      hasOlder: false,
    });
    expect(store.getSnapshot().replayWindow).toEqual({
      firstLoadedTurnIndex: 0,
      totalTurns: 30,
      hasOlder: false,
    });
  });

  it("exposes the first-loaded turn index as the addressing base", () => {
    const store = replayWith({
      count: 25,
      firstLoadedTurnIndex: 175,
      totalTurns: 200,
      hasOlder: true,
    });
    const win = store.getSnapshot().replayWindow;
    expect(win?.firstLoadedTurnIndex).toBe(175);
  });

  it("leaves replayWindow null on a full / legacy replay (no window fields)", () => {
    const store = replayWith({ count: 12 });
    expect(store.getSnapshot().replayWindow).toBeNull();
  });

  it("preserves a prior window when a later replay reports no metadata", () => {
    const { store, conn } = makeStore();
    emit(conn, { type: "replay_started" });
    emit(conn, {
      type: "replay_complete",
      count: 25,
      firstLoadedTurnIndex: 175,
      totalTurns: 200,
      hasOlder: true,
    });
    // A later windowless replay (e.g. an error or legacy reconnect)
    // must not wipe the known window.
    emit(conn, { type: "replay_started" });
    emit(conn, { type: "replay_complete", count: 0 });
    expect(store.getSnapshot().replayWindow).toEqual({
      firstLoadedTurnIndex: 175,
      totalTurns: 200,
      hasOlder: true,
    });
  });
});
