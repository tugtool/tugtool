// [W2] / [W1] — EOF orphan flush + clean-terminal recognition.
//
// Two replay-fidelity gaps the Step 20.5.B.1 corpus audit confirmed on
// real Claude Code session JSONLs:
//
//   [W2] A JSONL ending with a user submission and no following
//        `assistant` entry (the user submitted and quit before any
//        output) stranded `ctx.pendingUserText` — `flushPendingOrphan`
//        ran only from `handleUserEntry` on the *next* user entry,
//        never at EOF — so a resumed transcript silently lost the
//        user's last prompt. 9 of 282 audited sessions hit this. Fix:
//        on a cold resume (`synthesizeDanglingTerminal`), flush the
//        trailing orphan after the translate loop, ordered after the
//        dangling-cycle synthetic.
//
//   [W1] `translateJsonlEntry` closed a cycle only on
//        `stop_reason: "end_turn"`. `stop_sequence`, `max_tokens`, and
//        `refusal` are clean API terminals too; a last turn ending on
//        one was left `cycleOpen`, so [replay-1]'s synthetic committed
//        a cleanly-finished turn as `interrupted`. Fix: the
//        `TERMINAL_STOP_REASONS` set — all four close the cycle with
//        `turn_complete { result: "success" }`; `tool_use` /
//        `pause_turn` / a null stop_reason stay non-terminal.

import { describe, expect, test } from "bun:test";

import { translateJsonlSession } from "../replay.ts";
import type {
  OutboundMessage,
  ReplayComplete,
  TurnComplete,
  AddUserMessage,
} from "../types.ts";

async function collectSession(
  jsonl: string,
  synthesizeDanglingTerminal: boolean,
): Promise<OutboundMessage[]> {
  const out: OutboundMessage[] = [];
  for await (const m of translateJsonlSession(
    { kind: "ok", jsonl, claudeSessionId: "sess-eof" },
    { disableYield: true, synthesizeDanglingTerminal },
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

/** Assistant entry that reached a given `stop_reason`. A `null`
 *  stop_reason models a JSONL truncated mid-stream. */
const assistantEntry = (
  msgId: string,
  stopReason: string | null,
  text: string,
): string =>
  JSON.stringify({
    type: "assistant",
    message: {
      id: msgId,
      stop_reason: stopReason,
      content: [{ type: "text", text }],
    },
  });

/** Assistant entry that called a tool — `stop_reason: "tool_use"`, the
 *  canonical mid-cycle (non-terminal) shape: the turn is still open. */
const assistantToolUseEntry = (msgId: string): string =>
  JSON.stringify({
    type: "assistant",
    message: {
      id: msgId,
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "running it" },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Bash",
          input: { command: "ls" },
        },
      ],
    },
  });

const addUserMessagesOf = (out: OutboundMessage[]): AddUserMessage[] =>
  out.filter((m): m is AddUserMessage => m.type === "add_user_message");
const turnCompletesOf = (out: OutboundMessage[]): TurnComplete[] =>
  out.filter((m): m is TurnComplete => m.type === "turn_complete");
const replayCompleteOf = (out: OutboundMessage[]): ReplayComplete | undefined =>
  out.find((m): m is ReplayComplete => m.type === "replay_complete");

// ---------------------------------------------------------------------------
// [W2] — a trailing user-only orphan is flushed at EOF on a cold resume
// ---------------------------------------------------------------------------

describe("translateJsonlSession — [W2] EOF orphan flush", () => {
  test("cold resume: a trailing user-only entry flushes as an interrupted turn", async () => {
    const jsonl = [
      userTextEntry("hello"),
      assistantEntry("msg_1", "end_turn", "hi there"),
      userTextEntry("one more thing"),
    ].join("\n");

    const out = await collectSession(jsonl, true);

    const userReplays = addUserMessagesOf(out);
    const turnCompletes = turnCompletesOf(out);

    // Two cycles: the real turn + the flushed trailing orphan.
    expect(userReplays).toHaveLength(2);
    expect((userReplays[1].content[0] as any).text).toBe("one more thing");

    // The orphan's synthesized opener id rides on the turn_complete
    // frame per [D13] — `add_user_message` carries no `msg_id`
    // ([D15]). The orphan turn_complete is recognizable by its
    // `u-*` synthesized msg_id and `interrupted` result.
    expect(turnCompletes).toHaveLength(2);
    const orphanTc = turnCompletes.find((m) =>
      m.msg_id.startsWith("u-"),
    );
    expect(orphanTc).toBeDefined();
    expect(orphanTc?.result).toBe("interrupted");

    // The orphan add_user_message + turn_complete pair lands before
    // the bracket-closing replay_complete. Locate the second
    // add_user_message by position (sequential emit order is stable).
    const userReplayPositions = out
      .map((m, i) => (m.type === "add_user_message" ? i : -1))
      .filter((i) => i >= 0);
    const orphanIdx = userReplayPositions[1];
    const rcIdx = out.findIndex((m) => m.type === "replay_complete");
    expect(orphanIdx).toBeGreaterThanOrEqual(0);
    expect(orphanIdx).toBeLessThan(rcIdx);

    // The flushed orphan counts as a committed turn.
    expect(replayCompleteOf(out)?.count).toBe(2);
  });

  test("reload-mid-stream (synthesizeDanglingTerminal off): trailing opener emits but stays open for the live path", async () => {
    // Under [D13]'s per-entry direct emission, the trailing user
    // entry's `add_user_message` is emitted from the JSONL pass —
    // not deferred to the live `ActiveTurn` snapshot. What stays
    // deferred is the `turn_complete`: the orphan-synthesis at EOF
    // is gated on `synthesizeDanglingTerminal=true`, so an open turn
    // at EOF leaves no `turn_complete` on the wire here. The live
    // `ActiveTurn` snapshot delivers it eventually (the substrate's
    // `pendingTurn` lives in the reducer's `replaying` phase until
    // the live drain catches up).
    const jsonl = [
      userTextEntry("hello"),
      assistantEntry("msg_1", "end_turn", "hi there"),
      userTextEntry("one more thing"),
    ].join("\n");

    const out = await collectSession(jsonl, false);

    // Both add_user_messages emit (per-entry direct emission). Only
    // the first turn's turn_complete reaches the wire — the trailing
    // turn stays open at EOF.
    expect(addUserMessagesOf(out)).toHaveLength(2);
    expect(turnCompletesOf(out)).toHaveLength(1);
    expect(turnCompletesOf(out)[0].msg_id).toBe("msg_1");
    expect(turnCompletesOf(out)[0].result).toBe("success");
    expect(replayCompleteOf(out)?.count).toBe(1);
  });

  test("a JSONL that is only a user entry flushes one interrupted orphan on cold resume", async () => {
    const out = await collectSession(userTextEntry("did anyone hear me"), true);

    const userReplays = addUserMessagesOf(out);
    const turnCompletes = turnCompletesOf(out);
    expect(userReplays).toHaveLength(1);
    expect((userReplays[0].content[0] as any).text).toBe("did anyone hear me");
    // The synthesized opener id rides only on the turn_complete frame
    // per [D13] — `add_user_message` carries no `msg_id` ([D15]).
    // The `u-` prefix marks a user-text opener's synthesized id.
    expect(turnCompletes).toHaveLength(1);
    expect(turnCompletes[0].msg_id).toMatch(/^u-/);
    expect(turnCompletes[0].result).toBe("interrupted");
    expect(replayCompleteOf(out)?.count).toBe(1);
  });

  test("no trailing orphan: a clean session adds no spurious flush", async () => {
    // Regression guard — `emitOrphanIfOpen` is idempotent on no open
    // turn (`openTurnMsgId === null`), so a session whose last entry
    // closed its turn emits nothing extra at EOF even on a cold
    // resume.
    const jsonl = [
      userTextEntry("hello"),
      assistantEntry("msg_1", "end_turn", "hi"),
    ].join("\n");

    const out = await collectSession(jsonl, true);

    expect(addUserMessagesOf(out)).toHaveLength(1);
    expect(turnCompletesOf(out)).toHaveLength(1);
    expect(turnCompletesOf(out)[0].result).toBe("success");
    expect(replayCompleteOf(out)?.count).toBe(1);
  });

  test("dangling cycle AND a trailing orphan: the cycle synthetic fires first, then the orphan", async () => {
    // 4 of the 9 corpus [W2] sessions also carry a dangling tool
    // cycle. user1 → assistant(tool_use, no terminal) → user2(EOF):
    // the dangling-cycle synthetic closes the assistant's turn first,
    // then the orphan flush commits user2 as its own interrupted turn.
    const jsonl = [
      userTextEntry("first prompt"),
      assistantToolUseEntry("msg_open"),
      userTextEntry("second prompt"),
    ].join("\n");

    const out = await collectSession(jsonl, true);

    const turnCompletes = turnCompletesOf(out);
    expect(turnCompletes).toHaveLength(2);
    // First terminal closes the dangling cycle. Under [D13]'s
    // `noteContentMsgId` rule, the first assistant entry's content
    // events swapped openTurnMsgId from the synthesized `u-0` to
    // claude's real `msg_open`; the next user opener's
    // emitOrphanIfOpen carries that real id on its turn_complete.
    expect(turnCompletes[0].msg_id).toBe("msg_open");
    expect(turnCompletes[0].result).toBe("interrupted");
    // Second terminal is the EOF orphan synth, keyed on the
    // synthesized opener id (`u-N`) — no content arrived for the
    // trailing prompt, so openTurnMsgId stays the synthesized id.
    expect(turnCompletes[1].msg_id).toMatch(/^u-/);
    expect(turnCompletes[1].result).toBe("interrupted");

    const userReplays = addUserMessagesOf(out);
    expect(userReplays).toHaveLength(2);
    expect((userReplays[0].content[0] as any).text).toBe("first prompt");
    expect((userReplays[1].content[0] as any).text).toBe("second prompt");
    // Per [D15], `add_user_message` carries no `msg_id`; correlation
    // (cycle vs orphan) reads off the matching `turn_complete` above.

    expect(replayCompleteOf(out)?.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// [W1] — every clean terminal stop_reason closes a cycle; non-terminals don't
// ---------------------------------------------------------------------------

describe("translateJsonlSession — [W1] clean-terminal recognition", () => {
  for (const stop of [
    "end_turn",
    "stop_sequence",
    "max_tokens",
    "refusal",
  ] as const) {
    test(`stop_reason "${stop}" closes the cycle with a success terminal`, async () => {
      const jsonl = [
        userTextEntry("hello"),
        assistantEntry("msg_t", stop, "done"),
      ].join("\n");

      // synthesizeDanglingTerminal ON — if the cycle were left open the
      // [replay-1] synthetic would mislabel this clean turn
      // `interrupted`. A correct terminal closes the cycle so no
      // synthetic fires.
      const out = await collectSession(jsonl, true);

      const turnCompletes = turnCompletesOf(out);
      expect(turnCompletes).toHaveLength(1);
      expect(turnCompletes[0].result).toBe("success");
      expect(turnCompletes[0].msg_id).toBe("msg_t");
      expect(replayCompleteOf(out)?.count).toBe(1);
    });
  }

  for (const stop of ["tool_use", "pause_turn"] as const) {
    test(`stop_reason "${stop}" does NOT close the cycle (non-terminal)`, async () => {
      const jsonl = [
        userTextEntry("hello"),
        assistantEntry("msg_open", stop, "thinking about it"),
      ].join("\n");

      // synthesizeDanglingTerminal OFF — the open cycle stays open
      // (no synthetic). A non-terminal stop must not have emitted its
      // own `turn_complete`.
      const out = await collectSession(jsonl, false);

      expect(turnCompletesOf(out)).toHaveLength(0);
      expect(replayCompleteOf(out)?.count).toBe(0);
    });
  }

  test("a null / absent stop_reason does NOT close the cycle", async () => {
    const jsonl = [
      userTextEntry("hello"),
      assistantEntry("msg_open", null, "partial output"),
    ].join("\n");

    const out = await collectSession(jsonl, false);
    expect(turnCompletesOf(out)).toHaveLength(0);
    expect(replayCompleteOf(out)?.count).toBe(0);
  });

  test("a clean non-end_turn terminal mid-session closes its cycle so the next turn replays cleanly", async () => {
    // Regression guard for the [W1] cascade: even though the corpus
    // shows no mid-session non-`end_turn` terminal, the translator
    // must close the cycle on one — otherwise the next user
    // submission's `add_user_message` is suppressed and its text is
    // mis-flushed as an orphan, corrupting every later turn.
    const jsonl = [
      userTextEntry("first"),
      assistantEntry("msg_a", "stop_sequence", "first reply"),
      userTextEntry("second"),
      assistantEntry("msg_b", "end_turn", "second reply"),
    ].join("\n");

    const out = await collectSession(jsonl, false);

    const userReplays = addUserMessagesOf(out);
    expect(userReplays).toHaveLength(2);
    expect((userReplays[0].content[0] as any).text).toBe("first");
    expect((userReplays[1].content[0] as any).text).toBe("second");
    // Per [D15], `add_user_message` carries no `msg_id`; the
    // turn↔msg correlation reads off the matching `turn_complete`.
    const turnCompletes = turnCompletesOf(out);
    expect(turnCompletes).toHaveLength(2);
    expect(turnCompletes[0].msg_id).toBe("msg_a");
    expect(turnCompletes[1].msg_id).toBe("msg_b");
    expect(turnCompletes.every((m) => m.result === "success")).toBe(true);
    expect(replayCompleteOf(out)?.count).toBe(2);
  });
});
