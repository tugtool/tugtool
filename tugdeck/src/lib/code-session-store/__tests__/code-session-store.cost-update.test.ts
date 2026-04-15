/**
 * Step 6 — `cost_update` telemetry surface. The reducer captures
 * `total_cost_usd` into `state.lastCostUsd` with no phase transition
 * and no effect emission. Because the golden loader preprocesses
 * `"{{f64}}"` → `0`, fixture replays can only drive a `lastCostUsd
 * === 0` assertion; non-zero values use synthetic dispatches.
 */

import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import type { TugConnection } from "@/connection";
import {
  MockTugConnection,
} from "@/lib/code-session-store/testing/mock-feed-store";
import {
  FIXTURE_IDS,
  loadGoldenProbe,
} from "@/lib/code-session-store/testing/golden-catalog";
import { FeedId } from "@/protocol";

function constructStore(conn: MockTugConnection): CodeSessionStore {
  return new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
  });
}

describe("CodeSessionStore — cost_update (Step 6)", () => {
  it("captures synthetic total_cost_usd values without changing phase", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hi", []);

    // Drive submitting → awaiting_first_token → streaming.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "h",
      is_partial: true,
      rev: 0,
      seq: 0,
    });
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "assistant_text",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      msg_id: FIXTURE_IDS.MSG_ID,
      text: "i",
      is_partial: true,
      rev: 1,
      seq: 0,
    });
    expect(store.getSnapshot().phase).toBe("streaming");
    expect(store.getSnapshot().lastCostUsd).toBeNull();

    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "cost_update",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      total_cost_usd: 0.01337,
    });

    let snap = store.getSnapshot();
    expect(snap.lastCostUsd).toBe(0.01337);
    expect(snap.phase).toBe("streaming");

    // A second cost_update overwrites.
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "cost_update",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      total_cost_usd: 0.042,
    });

    snap = store.getSnapshot();
    expect(snap.lastCostUsd).toBe(0.042);
    expect(snap.phase).toBe("streaming");
  });

  it("ignores cost_update with non-numeric total_cost_usd", () => {
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hi", []);
    conn.dispatchDecoded(FeedId.CODE_OUTPUT, {
      type: "cost_update",
      tug_session_id: FIXTURE_IDS.TUG_SESSION_ID,
      // Simulate a wire-contract break.
      total_cost_usd: "not-a-number",
    });
    expect(store.getSnapshot().lastCostUsd).toBeNull();
  });

  it("captures a zero cost_update from the test-01 fixture round-trip", () => {
    const probe = loadGoldenProbe("v2.1.105", "test-01-basic-round-trip");
    const conn = new MockTugConnection();
    const store = constructStore(conn);

    store.send("hello", []);
    for (const event of probe.events) {
      conn.dispatchDecoded(FeedId.CODE_OUTPUT, event);
    }

    // The golden loader rewrites `"{{f64}}"` → `0`, so every fixture
    // cost_update resolves to total_cost_usd: 0. The reducer still
    // captures it.
    expect(store.getSnapshot().lastCostUsd).toBe(0);
  });
});
