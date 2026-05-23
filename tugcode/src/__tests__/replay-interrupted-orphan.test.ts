// Never-drop chain — interrupted-orphan replay shape.
//
// Scenario: user submits "hello", Cmd-Q's Tug.app before claude
// responds. Reopen. Submit "what time is it?". claude responds.
// JSONL ends up with the shape:
//
//   user "hello"                           ← orphan submission
//   user "[Request interrupted by user]"   ← claude's interrupt marker
//   user "what time is it?"                ← next submission
//   assistant msg_X "It's 6 PM" end_turn
//
// Pre-fix, the translator's `pendingUserText` accumulator concatenated
// the three user entries into a single string and emitted ONE
// `user_message_replay` keyed on the assistant's `message.id`. The
// committed TurnEntry showed: "hello[Request interrupted by user]what
// time is it?" merged into one user message — the orphan submission
// is silently absorbed into the next, the marker leaks into the
// transcript, and never-drop's "appears as its own pending entry" is
// violated.
//
// Fix: each `user` JSONL entry is its own logical submission. When a
// new user entry arrives while `pendingUserText` is non-null, flush
// the prior as an orphan committed-turn pair (`user_message_replay`
// + `turn_complete { result: "interrupted" }`) keyed on a synthetic
// id, then continue. The "[Request interrupted by user]" marker is
// recognized as a sentinel, used to trigger the flush, and dropped
// (NOT emitted as its own user-visible entry).

import { describe, expect, test } from "bun:test";

import { translateJsonlSession } from "../replay.ts";
import type {
  OutboundMessage,
  TurnComplete,
  UserMessageReplay,
} from "../types.ts";

async function collectSession(jsonl: string): Promise<OutboundMessage[]> {
  const out: OutboundMessage[] = [];
  for await (const m of translateJsonlSession(
    { kind: "ok", jsonl, claudeSessionId: "sess-orphan" },
    { disableYield: true },
  )) {
    out.push(m);
  }
  return out;
}

const userTextEntry = (text: string): string =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  });

const assistantEndTurnEntry = (msgId: string, text: string): string =>
  JSON.stringify({
    type: "assistant",
    message: {
      id: msgId,
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
    },
  });

const INTERRUPT_MARKER = "[Request interrupted by user]";

describe("translateJsonlSession — interrupted-orphan submissions", () => {
  test("orphan + marker + new submission + assistant: orphan emits its own committed-interrupted turn; marker dropped", async () => {
    const jsonl = [
      userTextEntry("hello"),
      userTextEntry(INTERRUPT_MARKER),
      userTextEntry("what time is it?"),
      assistantEndTurnEntry("msg_response", "It's 6 PM"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const userReplays = out.filter(
      (m): m is UserMessageReplay => m.type === "user_message_replay",
    );
    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );

    // TWO separate user_message_replay frames: orphan + real.
    expect(userReplays).toHaveLength(2);

    // Orphan goes first, with its own text and a synthetic msg_id.
    expect(userReplays[0].text).toBe("hello");
    expect(userReplays[0].msg_id).not.toBe("msg_response");
    expect(userReplays[0].msg_id.length).toBeGreaterThan(0);

    // The marker is NOT emitted as its own user_message_replay — it's
    // a sentinel for the prior orphan, dropped from the wire.
    expect(
      userReplays.some((m) => m.text === INTERRUPT_MARKER),
    ).toBe(false);

    // The marker is NOT concatenated onto the next submission.
    expect(userReplays[1].text).toBe("what time is it?");
    expect(userReplays[1].msg_id).toBe("msg_response");

    // TWO turn_completes: orphan's (interrupted) + real's (success).
    expect(turnCompletes).toHaveLength(2);

    // Orphan's terminal carries result != "success" so the reducer
    // commits an interrupted TurnEntry.
    const orphanTc = turnCompletes.find(
      (m) => m.msg_id === userReplays[0].msg_id,
    );
    expect(orphanTc).toBeDefined();
    expect(orphanTc?.result).not.toBe("success");

    // Real turn's terminal carries success.
    const realTc = turnCompletes.find((m) => m.msg_id === "msg_response");
    expect(realTc).toBeDefined();
    expect(realTc?.result).toBe("success");
  });

  test("two consecutive user submissions without marker: prior gets orphan-flushed", async () => {
    // Even without the explicit "[Request interrupted by user]"
    // marker, two text-bearing user entries with no assistant entry
    // between them is a structural orphan. The translator must not
    // merge them.
    const jsonl = [
      userTextEntry("first submission"),
      userTextEntry("second submission"),
      assistantEndTurnEntry("msg_real", "ok"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const userReplays = out.filter(
      (m): m is UserMessageReplay => m.type === "user_message_replay",
    );
    expect(userReplays).toHaveLength(2);
    expect(userReplays[0].text).toBe("first submission");
    expect(userReplays[1].text).toBe("second submission");
    expect(userReplays[1].msg_id).toBe("msg_real");
  });

  test("clean turn (no orphan, no marker): single user_message_replay, no orphan terminal", async () => {
    // Regression guard: the orphan-flush logic must not fire when
    // there's nothing to flush. A normal user → assistant cycle
    // produces exactly one user_message_replay and one turn_complete.
    const jsonl = [
      userTextEntry("normal submission"),
      assistantEndTurnEntry("msg_normal", "normal reply"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const userReplays = out.filter(
      (m): m is UserMessageReplay => m.type === "user_message_replay",
    );
    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(userReplays).toHaveLength(1);
    expect(turnCompletes).toHaveLength(1);
    expect(userReplays[0].text).toBe("normal submission");
    expect(turnCompletes[0].result).toBe("success");
  });

  test("standalone marker (no preceding orphan): marker is dropped, no spurious frames", async () => {
    // Defensive: a JSONL that starts with the marker (no preceding
    // user submission to flush) should drop the marker silently and
    // not emit an empty orphan turn.
    const jsonl = [
      userTextEntry(INTERRUPT_MARKER),
      userTextEntry("what time is it?"),
      assistantEndTurnEntry("msg_X", "noon"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const userReplays = out.filter(
      (m): m is UserMessageReplay => m.type === "user_message_replay",
    );
    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    // Exactly one user_message_replay (for the real submission).
    expect(userReplays).toHaveLength(1);
    expect(userReplays[0].text).toBe("what time is it?");
    expect(turnCompletes).toHaveLength(1);
  });

  // -------------------------------------------------------------------
  // Marker disambiguation — the 2026-05-23 doubled-message bug guard.
  //
  // The SDK's auto-injected sentinel comes in two suffix forms, and a
  // hypothetical real user submission might type the same text. The
  // matcher requires BOTH the wire-text prefix AND the absence of
  // `permissionMode` (which real submissions always carry); see
  // `replay.ts`'s `isInterruptMarkerEntry` for the corpus evidence.
  // -------------------------------------------------------------------

  const userTextEntryWithPermissionMode = (
    text: string,
    permissionMode: string,
  ): string =>
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      permissionMode,
    });

  test("suffix-form marker ('[Request interrupted by user for tool use]') is also dropped", async () => {
    // 2026-05-23 incident: SDK writes the longer form when the
    // interrupt fires while a permission/question is pending. The
    // original matcher only knew about the base form, so the marker
    // leaked into the transcript as a phantom user turn after
    // Developer Reload.
    const jsonl = [
      userTextEntry("plan an investigation"),
      userTextEntry("[Request interrupted by user for tool use]"),
      userTextEntry("ok now do something else"),
      assistantEndTurnEntry("msg_Z", "done"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const userReplays = out.filter(
      (m): m is UserMessageReplay => m.type === "user_message_replay",
    );
    expect(userReplays).toHaveLength(2);
    expect(userReplays[0].text).toBe("plan an investigation");
    expect(userReplays[1].text).toBe("ok now do something else");
    // The marker text itself does not appear in any submission.
    for (const r of userReplays) {
      expect(r.text.includes("[Request interrupted by user")).toBe(false);
    }
  });

  test("a real user typing the marker text verbatim is NOT dropped (permissionMode disambiguator)", async () => {
    // If a user literally types `"[Request interrupted by user]"` as
    // a chat message, their submission carries `permissionMode` (the
    // CLI's input layer stamps it on every real submission). The
    // compound matcher rejects this as a marker on the structural
    // signal and we round-trip the user's text intact.
    const jsonl = [
      userTextEntryWithPermissionMode(
        "[Request interrupted by user]",
        "default",
      ),
      assistantEndTurnEntry("msg_quoted", "ok"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const userReplays = out.filter(
      (m): m is UserMessageReplay => m.type === "user_message_replay",
    );
    expect(userReplays).toHaveLength(1);
    expect(userReplays[0].text).toBe("[Request interrupted by user]");
  });

  test("coincidental prefix in the middle of a longer message is NOT dropped", async () => {
    // Defends against a too-eager substring match. Only an entry
    // whose text BEGINS with the marker prefix and ENDS with `"]"`
    // is a candidate; everything else falls through to the normal
    // submission path.
    const jsonl = [
      userTextEntry(
        "Why does the SDK write [Request interrupted by user] in the JSONL?",
      ),
      assistantEndTurnEntry("msg_q", "because…"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const userReplays = out.filter(
      (m): m is UserMessageReplay => m.type === "user_message_replay",
    );
    expect(userReplays).toHaveLength(1);
    expect(userReplays[0].text).toContain("[Request interrupted by user]");
  });
});
