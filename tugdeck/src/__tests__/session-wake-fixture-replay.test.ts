/**
 * Wake fixture-replay test for the tugdeck reducer.
 *
 * Drives the tugdeck `CodeSessionStore` with IPC frames derived from
 * the Step-1 captured raw stream-json fixture
 * (`tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/
 *  v2.1.150-spike/test-monitor-wake-raw.jsonl`) — a real Monitor
 * 5-second-timeout wake captured via `claude -p
 * --output-format=stream-json`.
 *
 * Why fixture-grounded rather than synthesized: pins the empirical
 * wire shape (task_notification payload, wake assistant text, terminal
 * msg_id) against the implementation. A regression in the SDK payload
 * shape, the wake-bracket reducer, or the empty-text marker contract
 * surfaces here against real data — not synthesized stubs.
 *
 * The fixture is raw stream-json (pre-tugcode-translation). The
 * tugcode side of the pipeline is already covered by
 * `tugcode/src/__tests__/session.test.ts:buildWakeStartedMessage`,
 * which feeds the same fixture through the detector helper. This
 * test owns the OTHER half — the tugdeck reducer's wake bracket. We
 * extract the wake's signal fields from the fixture (task_id,
 * trigger payload, terminal assistant text, terminal msg_id) and
 * synthesize the small set of IPC frames tugcode emits for the wake,
 * then drive them through the reducer.
 *
 * Two scenarios:
 *
 *   1. Live wake bracket — `wake_started` → `assistant_text` →
 *      `turn_complete`. Asserts the wake turn commits with the
 *      empty-text user marker (no phantom user bubble), the captured
 *      assistant text, and the camelCase `wakeTrigger` metadata
 *      survived the bracket.
 *
 *   2. Cold-boot replay regression — the same wake's content
 *      replayed through the JSONL replay bracket
 *      (`replay_started` → `user_message_replay` → `assistant_text` →
 *      `turn_complete` → `replay_complete`). Confirms the existing
 *      replay path still paints the assistant text correctly when
 *      the content originated from a wake. (Per [#slice-2-replay-
 *      translator] in the plan, Slice 1 deliberately does NOT
 *      preserve `wakeTrigger` across cold-boot rehydration — that's
 *      Slice 2 work — so the replay-path scenario asserts text/turn
 *      survival without asserting on `wakeTrigger`.)
 *
 * See `roadmap/tugplan-tide-session-wake.md` Step 5 + [PPF-01].
 */

import { describe, it, expect, beforeAll } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import type { TugConnection } from "@/connection";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import { committedTurnValue } from "@/lib/code-session-store/testing/inflight-paths";
import { FeedId } from "@/protocol";

const TUG = FIXTURE_IDS.TUG_SESSION_ID;
const IPC_VERSION = 2;

// -----------------------------------------------------------------------------
// Fixture loading + canonical field extraction
// -----------------------------------------------------------------------------

interface CapturedWake {
  /** From line 49 `system/task_notification` — the wake signal payload. */
  trigger: {
    task_id: string;
    tool_use_id: string;
    status: "completed" | "failed" | "stopped";
    summary: string;
    output_file: string;
  };
  /** Terminal assistant text frame's `msg_id`. */
  msgId: string;
  /** Terminal assistant text — what the wake turn says. */
  assistantText: string;
}

let captured: CapturedWake;

beforeAll(async () => {
  const fixturePath = new URL(
    "../../../tugrust/crates/tugcast/tests/fixtures/" +
      "stream-json-catalog/v2.1.150-spike/test-monitor-wake-raw.jsonl",
    import.meta.url,
  ).pathname;
  const raw = await Bun.file(fixturePath).text();
  const lines = raw.split("\n").filter((l) => l.length > 0);

  // Locate the wake signal — exactly one task_notification line.
  let trigger: CapturedWake["trigger"] | null = null;
  for (const line of lines) {
    const ev = JSON.parse(line) as Record<string, unknown>;
    if (ev.type === "system" && ev.subtype === "task_notification") {
      trigger = {
        task_id: String(ev.task_id),
        tool_use_id: String(ev.tool_use_id),
        status: ev.status as CapturedWake["trigger"]["status"],
        summary: String(ev.summary),
        output_file: String(ev.output_file),
      };
      break;
    }
  }
  if (trigger === null) {
    throw new Error("fixture missing system/task_notification line");
  }

  // The wake's terminal assistant text is the LAST `type:"assistant"`
  // message whose content contains a `type:"text"` block. Picking the
  // terminal message means we land on the wake's authoritative final
  // text (the SDK emits intermediate `assistant` snapshots; the last
  // one carries the full content).
  let msgId: string | null = null;
  let assistantText: string | null = null;
  for (const line of lines) {
    const ev = JSON.parse(line) as Record<string, unknown>;
    if (ev.type !== "assistant") continue;
    const message = ev.message as Record<string, unknown> | undefined;
    const content = message?.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        msgId = String(message?.id ?? "");
        assistantText = block.text;
      }
    }
  }
  if (msgId === null || assistantText === null) {
    throw new Error("fixture missing terminal assistant text block");
  }

  captured = { trigger, msgId, assistantText };
});

// -----------------------------------------------------------------------------
// Store + frame helpers
// -----------------------------------------------------------------------------

interface StoreFixture {
  store: CodeSessionStore;
  conn: TestFrameChannel;
}

function makeStore(): StoreFixture {
  const conn = new TestFrameChannel();
  const store = new CodeSessionStore({
    conn: conn as unknown as TugConnection,
    lifecycle: new ConnectionLifecycle(),
    tugSessionId: TUG,
    sessionMode: "new",
  });
  return { store, conn };
}

function emit(conn: TestFrameChannel, evt: Record<string, unknown>): void {
  conn.dispatchDecoded(FeedId.CODE_OUTPUT, { ...evt, tug_session_id: TUG });
}

function wakeStartedFromCaptured(): Record<string, unknown> {
  return {
    type: "wake_started",
    session_id: FIXTURE_IDS.CLAUDE_SESSION_ID,
    wake_trigger: captured.trigger,
    ipc_version: IPC_VERSION,
  };
}

function assistantTextFromCaptured(): Record<string, unknown> {
  return {
    type: "assistant_text",
    msg_id: captured.msgId,
    seq: 0,
    rev: 0,
    text: captured.assistantText,
    is_partial: false,
    status: "complete",
    ipc_version: IPC_VERSION,
  };
}

function turnComplete(msgId: string, result: "success" | "error" = "success") {
  return {
    type: "turn_complete",
    msg_id: msgId,
    seq: 1,
    result,
    ipc_version: IPC_VERSION,
  };
}

// -----------------------------------------------------------------------------
// Scenario 1 — live wake bracket
// -----------------------------------------------------------------------------

describe("session-wake fixture replay — live wake bracket [PPF-01]", () => {
  it("the captured fixture carries the expected wake signal (sanity check on extraction)", () => {
    // Pinned values from the capture — if these change, the extractor
    // above probably broke before any reducer behavior is at fault.
    expect(captured.trigger.task_id).toBe("b9klbr5tx");
    expect(captured.trigger.status).toBe("stopped");
    expect(captured.trigger.summary).toContain("kernel");
    expect(captured.msgId.length).toBeGreaterThan(0);
    expect(captured.assistantText.length).toBeGreaterThan(0);
    // The captured wake reports the Monitor's observation of
    // /var/log/system.log — the assistant text always references the
    // 5-second timeout and the kernel keyword the user asked for.
    expect(captured.assistantText).toContain("5-second");
    expect(captured.assistantText).toContain("kernel");
  });

  it("wake_started → assistant_text → turn_complete commits a wake TurnEntry with the captured trigger metadata", () => {
    const { store, conn } = makeStore();

    emit(conn, wakeStartedFromCaptured());
    // The trigger metadata is on the snapshot during the wake.
    const midWake = store.getSnapshot();
    expect(midWake.phase).toBe("waking");
    expect(midWake.wakeTrigger).toEqual({
      taskId: captured.trigger.task_id,
      toolUseId: captured.trigger.tool_use_id,
      status: captured.trigger.status,
      summary: captured.trigger.summary,
      outputFile: captured.trigger.output_file,
    });

    emit(conn, assistantTextFromCaptured());
    emit(conn, turnComplete(captured.msgId));

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.wakeTrigger).toBeNull();
    expect(snap.transcript.length).toBe(1);

    const entry = snap.transcript[0];
    // Empty-text marker is the wake sentinel (no phantom user bubble).
    expect(entry.userMessage.text).toBe("");
    expect(entry.userMessage.attachments).toEqual([]);
    expect(entry.assistant).toBe(captured.assistantText);
    expect(entry.result).toBe("success");
    // The per-turn write paths landed under the minted turnKey, so
    // the cell wrapper that subscribes to `turn.${turnKey}.assistant`
    // would render the wake's authoritative text.
    expect(committedTurnValue(store, "assistant")).toBe(
      captured.assistantText,
    );
  });
});

// -----------------------------------------------------------------------------
// Scenario 2 — cold-boot replay regression
// -----------------------------------------------------------------------------

describe("session-wake fixture replay — cold-boot replay regression", () => {
  it("a historic wake turn replayed via the JSONL replay bracket paints correctly", () => {
    // Per [#slice-2-replay-translator] in the plan, Slice 1 does NOT
    // synthesize `wake_started` frames during cold-boot rehydration —
    // the replay translator treats the wake's content as ordinary
    // user-bracketed turn data. This test pins that the existing
    // replay path still works for the same content type, so a wake
    // turn rehydrated from JSONL paints under `phase === "replaying"`
    // with the captured assistant text reaching the transcript.
    //
    // The synthesized `user_message_replay` carries the wake's prior
    // user-text — for a wake that originated mid-session this would
    // historically be the user's original send; for the captured
    // PPF-01 reproduction it's the Monitor-arming send. We supply a
    // placeholder here because Slice 1 doesn't inspect it; the test
    // owns the wake content survival assertion only.
    const { store, conn } = makeStore();

    emit(conn, {
      type: "replay_started",
      ipc_version: IPC_VERSION,
    });
    emit(conn, {
      type: "user_message_replay",
      msg_id: captured.msgId,
      text: "Use the Monitor tool to tail /var/log/system.log…",
      attachments: [],
      turnKey: `replay-key-${captured.msgId}`,
      ipc_version: IPC_VERSION,
    });
    emit(conn, assistantTextFromCaptured());
    emit(conn, turnComplete(captured.msgId));
    emit(conn, {
      type: "replay_complete",
      count: 1,
      ipc_version: IPC_VERSION,
    });

    const snap = store.getSnapshot();
    expect(snap.phase).toBe("idle");
    expect(snap.transcript.length).toBe(1);
    const entry = snap.transcript[0];
    expect(entry.assistant).toBe(captured.assistantText);
    // Slice 1: wakeTrigger metadata is NOT preserved across cold-boot
    // replay (the replay translator doesn't synthesize wake_started).
    // Slice 2 will close this gap; this assertion makes the deferred
    // work visible.
    expect(snap.wakeTrigger).toBeNull();
  });
});
