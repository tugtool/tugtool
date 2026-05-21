// [replay-1] — dangling-cycle terminal synthesis.
//
// A resumed session whose JSONL ends with a cycle still open — an
// `assistant` entry that never reached `stop_reason: "end_turn"`,
// e.g. a tool call the user refused before quitting — has no
// `turn_complete` in the JSONL. Without one the reducer's
// `pendingUserMessage` never clears and the transcript row animates
// its thinking indicator forever.
//
// `translateJsonlSession`, when the caller passes
// `synthesizeDanglingTerminal: true` (a cold resume — no live
// `ActiveTurn` continues the JSONL), emits a synthetic
// `turn_complete { result: "interrupted" }` for the open cycle before
// `replay_complete`. With the option absent (reload-mid-stream — a
// live turn IS still producing the cycle) the cycle is left open for
// the live drain, exactly as before.

import { describe, expect, test } from "bun:test";

import { translateJsonlSession } from "../replay.ts";
import type {
  OutboundMessage,
  ReplayComplete,
  TurnComplete,
} from "../types.ts";

async function collectSession(
  jsonl: string,
  synthesizeDanglingTerminal: boolean,
): Promise<OutboundMessage[]> {
  const out: OutboundMessage[] = [];
  for await (const m of translateJsonlSession(
    { kind: "ok", jsonl, claudeSessionId: "sess-dangling" },
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

/** Assistant entry that never reached `end_turn` — a turn cut off
 *  mid-flight. `stop_reason: "tool_use"` is the canonical shape: the
 *  turn called a tool and the JSONL ends before the tool_result
 *  (the "refused tool usage, then quit" scenario). */
const assistantOpenEntry = (msgId: string): string =>
  JSON.stringify({
    type: "assistant",
    message: {
      id: msgId,
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "let me run that" },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Bash",
          input: { command: "ls" },
        },
      ],
    },
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

describe("translateJsonlSession — [replay-1] dangling-cycle terminal", () => {
  test("cold resume (synthesizeDanglingTerminal): open cycle gets a synthetic interrupted turn_complete", async () => {
    const jsonl = [
      userTextEntry("run a command for me"),
      assistantOpenEntry("msg_dangling"),
    ].join("\n");

    const out = await collectSession(jsonl, true);

    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnCompletes).toHaveLength(1);
    // Non-"success" result — the reducer commits it as a terminal
    // `interrupted` TurnEntry, not a protocol `error`.
    expect(turnCompletes[0].result).toBe("interrupted");
    // Keyed on the open cycle's assistant id.
    expect(turnCompletes[0].msg_id).toBe("msg_dangling");

    // The synthetic lands BEFORE the bracket-closing replay_complete.
    const tcIdx = out.findIndex((m) => m.type === "turn_complete");
    const rcIdx = out.findIndex((m) => m.type === "replay_complete");
    expect(tcIdx).toBeGreaterThanOrEqual(0);
    expect(tcIdx).toBeLessThan(rcIdx);

    // The synthetic counts as a committed turn.
    const rc = out.find(
      (m): m is ReplayComplete => m.type === "replay_complete",
    );
    expect(rc?.count).toBe(1);
  });

  test("reload-mid-stream (default): open cycle is left open — no synthetic terminal", async () => {
    // A live ActiveTurn is still producing this cycle; the live drain
    // delivers the real turn_complete. The translator must NOT
    // prematurely commit it.
    const jsonl = [
      userTextEntry("run a command for me"),
      assistantOpenEntry("msg_dangling"),
    ].join("\n");

    const out = await collectSession(jsonl, false);

    expect(out.filter((m) => m.type === "turn_complete")).toHaveLength(0);
    const rc = out.find(
      (m): m is ReplayComplete => m.type === "replay_complete",
    );
    expect(rc?.count).toBe(0);
  });

  test("clean trailing turn: synthesizeDanglingTerminal adds no extra terminal", async () => {
    // Regression guard — the synthesis fires only for an OPEN cycle.
    // A JSONL whose last turn reached `end_turn` already has its
    // terminal; no second one is fabricated.
    const jsonl = [
      userTextEntry("hello"),
      assistantEndTurnEntry("msg_clean", "hi there"),
    ].join("\n");

    const out = await collectSession(jsonl, true);

    const turnCompletes = out.filter(
      (m): m is TurnComplete => m.type === "turn_complete",
    );
    expect(turnCompletes).toHaveLength(1);
    expect(turnCompletes[0].result).toBe("success");
    expect(turnCompletes[0].msg_id).toBe("msg_clean");
  });
});
