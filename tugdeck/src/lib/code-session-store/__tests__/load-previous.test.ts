/**
 * Load-previous request mapping — `store.loadPrevious(amount)` builds the
 * right windowed `request_replay` (a `turnRange`) from the current window
 * metadata, and `cancelLoadPrevious()` emits `cancel_replay`. Driven
 * through the real store + the recording connection double (the wire
 * contract the store produces, not a mock call-count).
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

/** Land a windowed replay leaving older turns unloaded. */
function primeWindow(
  conn: TestFrameChannel,
  meta: {
    firstLoadedTurnIndex: number;
    totalTurns: number;
    hasOlder: boolean;
  },
): void {
  emit(conn, { type: "replay_started" });
  emit(conn, { type: "replay_complete", count: 1, ...meta });
}

/** Decode a recorded CONTROL frame's JSON payload. */
function decodeControl(payload: unknown): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(payload as Uint8Array));
}

function controlFramesOf(conn: TestFrameChannel): Array<Record<string, unknown>> {
  return conn.recordedFrames
    .filter((f) => f.feedId === FeedId.CONTROL)
    .map((f) => decodeControl(f.decoded));
}

describe("loadPrevious — windowed request mapping", () => {
  it("maps a numeric step to turnRange [first − N, first]", () => {
    const { store, conn } = makeStore();
    primeWindow(conn, {
      firstLoadedTurnIndex: 175,
      totalTurns: 200,
      hasOlder: true,
    });

    store.loadPrevious(50);

    const replay = controlFramesOf(conn).find(
      (f) => f.action === "request_replay",
    );
    expect(replay).toBeDefined();
    // The 50 turns immediately older than the current oldest (175).
    expect(replay!.window).toEqual({ turnRange: [125, 175] });
  });

  it("maps 'all' to a turnRange reaching turn 0", () => {
    const { store, conn } = makeStore();
    primeWindow(conn, {
      firstLoadedTurnIndex: 175,
      totalTurns: 200,
      hasOlder: true,
    });

    store.loadPrevious("all");

    const replay = controlFramesOf(conn).find(
      (f) => f.action === "request_replay",
    );
    // "all older" = every turn before the window (down to turn 0).
    expect(replay!.window).toEqual({ turnRange: [0, 175] });
  });

  it("marks the bracket as a prepend (loadingPrevious flips true)", () => {
    const { store, conn } = makeStore();
    primeWindow(conn, {
      firstLoadedTurnIndex: 175,
      totalTurns: 200,
      hasOlder: true,
    });
    expect(store.getSnapshot().loadingPrevious).toBe(false);
    store.loadPrevious(50);
    expect(store.getSnapshot().loadingPrevious).toBe(true);
  });

  it("is a no-op when nothing older exists (hasOlder false)", () => {
    const { store, conn } = makeStore();
    primeWindow(conn, {
      firstLoadedTurnIndex: 0,
      totalTurns: 10,
      hasOlder: false,
    });

    store.loadPrevious(50);

    const replay = controlFramesOf(conn).find(
      (f) => f.action === "request_replay",
    );
    expect(replay).toBeUndefined();
    expect(store.getSnapshot().loadingPrevious).toBe(false);
  });

  it("is a no-op when no window was recorded (full / legacy load)", () => {
    const { store, conn } = makeStore();
    emit(conn, { type: "replay_started" });
    emit(conn, { type: "replay_complete", count: 5 });

    store.loadPrevious(50);
    expect(
      controlFramesOf(conn).find((f) => f.action === "request_replay"),
    ).toBeUndefined();
  });
});

describe("cancelLoadPrevious — abort verb", () => {
  it("emits a cancel_replay CODE_INPUT message", () => {
    const { store, conn } = makeStore();
    store.cancelLoadPrevious();
    const codeInput = conn.recordedFrames.filter(
      (f) => f.feedId === FeedId.CODE_INPUT,
    );
    expect(
      codeInput.some(
        (f) => (f.decoded as { type?: string }).type === "cancel_replay",
      ),
    ).toBe(true);
  });
});
