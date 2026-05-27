// [W5a] — string-valued `message.content` normalisation.
//
// Claude Code persists a plain-text message as a bare STRING
// `message.content`, not the usual `[{ type: "text", … }]` array. A
// `user` submission with no attachments is the common case — the
// Step 20.5.B.1 corpus audit found ~280 such genuine string
// submissions. The per-entry content walk did `for (const block of
// content)` — iterating the string yields its *characters*, each a
// non-block that falls through — so the prompt text was silently
// dropped and the resumed transcript lost the turn's user message.
//
// Claude Code ALSO persists slash-command scaffolding as string-
// content `user` entries: the `<command-name>` / `<command-message>` /
// `<command-args>` markers of a slash invocation, the
// `<local-command-stdout>` / `<local-command-caveat>` output blocks,
// and the `isCompactSummary` continuation summary. Those are CLI-
// internal — surfacing them would inject junk turns into a resumed
// transcript (a `/compact` alone persists four-plus consecutive
// scaffolding strings).
//
// Fix: `contentBlocks` normalises a bare-string `message.content` into
// one synthetic text block; `isNonSubmissionUserString` recognises the
// scaffolding and the translator skips it. Genuine prompts replay;
// scaffolding does not.

import { describe, expect, test } from "bun:test";

import { translateJsonlSession } from "../replay.ts";
import type {
  AssistantText,
  OutboundMessage,
  TurnComplete,
  AddUserMessage,
} from "../types.ts";

async function collectSession(jsonl: string): Promise<OutboundMessage[]> {
  const out: OutboundMessage[] = [];
  for await (const m of translateJsonlSession(
    { kind: "ok", jsonl, claudeSessionId: "sess-string" },
    { disableYield: true },
  )) {
    out.push(m);
  }
  return out;
}

/** A `user` entry whose `message.content` is a bare string — Claude
 *  Code's persistence shape for a plain-text message. */
const userStringEntry = (content: string): string =>
  JSON.stringify({ type: "user", message: { role: "user", content } });

/** The `/compact` continuation summary: a `user` entry flagged
 *  `isCompactSummary` with a bare-string `message.content`. */
const compactSummaryEntry = (content: string): string =>
  JSON.stringify({
    type: "user",
    isCompactSummary: true,
    message: { role: "user", content },
  });

const assistantEndTurn = (msgId: string, text: string): string =>
  JSON.stringify({
    type: "assistant",
    message: {
      id: msgId,
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
    },
  });

const addUserMessagesOf = (out: OutboundMessage[]): AddUserMessage[] =>
  out.filter((m): m is AddUserMessage => m.type === "add_user_message");
const turnCompletesOf = (out: OutboundMessage[]): TurnComplete[] =>
  out.filter((m): m is TurnComplete => m.type === "turn_complete");
const assistantTextsOf = (out: OutboundMessage[]): AssistantText[] =>
  out.filter((m): m is AssistantText => m.type === "assistant_text");

// ---------------------------------------------------------------------------
// Genuine string-content submissions — the real bug
// ---------------------------------------------------------------------------

describe("translateJsonlSession — [W5a] genuine string-content prompt", () => {
  test("a bare-string user submission reaches add_user_message (not char-iterated)", async () => {
    const jsonl = [
      userStringEntry("use bash to echo hello"),
      assistantEndTurn("m1", "here it is"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const userReplays = addUserMessagesOf(out);
    expect(userReplays).toHaveLength(1);
    // The whole string is the submission text — not dropped, not
    // iterated into single-character non-blocks. No msg_id on
    // add_user_message per [D15]; turn↔msg correlation reads off
    // the matching turn_complete (msg_id "m1").
    expect(((userReplays[0].content[0] ?? {}) as { text?: string }).text).toBe("use bash to echo hello");
  });

  test("two consecutive string-content submissions orphan-flush correctly", async () => {
    // The normalised string flows through the same pending/flush path
    // as a block-array submission: a second user entry with no
    // assistant between flushes the first as an interrupted orphan.
    const jsonl = [
      userStringEntry("first prompt"),
      userStringEntry("second prompt"),
      assistantEndTurn("m1", "reply"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const userReplays = addUserMessagesOf(out);
    expect(userReplays).toHaveLength(2);
    expect(((userReplays[0].content[0] ?? {}) as { text?: string }).text).toBe("first prompt");
    expect(((userReplays[1].content[0] ?? {}) as { text?: string }).text).toBe("second prompt");
    // No msg_id on add_user_message per [D15]; orphan synthetic id
    // and real msg_id ride on the matching turn_complete frames.
    const turnCompletes = turnCompletesOf(out);
    expect(turnCompletes).toHaveLength(2);
    // Orphan synthesized opener id (`u-N` under [D13]).
    expect(turnCompletes[0].msg_id).toMatch(/^u-/);
    expect(turnCompletes[1].msg_id).toBe("m1");
  });

  test("a string-content entry that IS the interrupt marker is still a sentinel", async () => {
    // Normalisation makes the `[Request interrupted by user]` sentinel
    // detection work for the string shape too: the marker flushes the
    // prior orphan and is itself dropped, never concatenated.
    const jsonl = [
      userStringEntry("hello"),
      userStringEntry("[Request interrupted by user]"),
      userStringEntry("what now"),
      assistantEndTurn("m1", "an answer"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const userReplays = addUserMessagesOf(out);
    expect(userReplays.map((m) => ((m.content[0] ?? {}) as { text?: string }).text ?? "")).toEqual(["hello", "what now"]);
    // No msg_id on add_user_message per [D15]; the real turn's
    // msg_id ("m1") rides on the matching turn_complete frame.
  });
});

// ---------------------------------------------------------------------------
// Scaffolding — recognised and skipped, never a junk turn
// ---------------------------------------------------------------------------

describe("translateJsonlSession — [W5a] command scaffolding is skipped", () => {
  for (const scaffold of [
    "<command-name>/commit</command-name>",
    "<command-message>commit</command-message>",
    "<command-args>do the thing</command-args>",
    "<local-command-stdout>some output</local-command-stdout>",
    "<local-command-caveat>a caveat</local-command-caveat>",
  ]) {
    const tag = scaffold.slice(1, scaffold.indexOf(">"));
    test(`a <${tag}> string entry emits nothing and does not orphan-flush the real prompt`, async () => {
      const jsonl = [
        userStringEntry(scaffold),
        userStringEntry("the real prompt"),
        assistantEndTurn("m1", "reply"),
      ].join("\n");

      const out = await collectSession(jsonl);

      // Exactly one turn — the scaffolding entry produced no
      // add_user_message, so it did not strand a pending
      // submission that the real prompt would orphan-flush.
      const userReplays = addUserMessagesOf(out);
      expect(userReplays).toHaveLength(1);
      expect(((userReplays[0].content[0] ?? {}) as { text?: string }).text).toBe("the real prompt");
      // No msg_id on add_user_message per [D15]; msg_id "m1" rides
      // on the matching turn_complete.
      expect(turnCompletesOf(out)).toHaveLength(1);
    });
  }

  test("an isCompactSummary entry is skipped — the summary text never reaches the wire", async () => {
    const summary =
      "This session is being continued from a previous conversation " +
      "that ran out of context. The summary below covers …";
    const jsonl = [
      compactSummaryEntry(summary),
      assistantEndTurn("m1", "continuing the work"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const userReplays = addUserMessagesOf(out);
    expect(userReplays).toHaveLength(1);
    // The continuation turn replays with an empty user message — the
    // summary is CLI-internal and is not surfaced as transcript text.
    // Post-Step-5c the synth opener carries `content: []` (the
    // reducer's substrate synth derives `text: ""` from it).
    expect(userReplays[0].content).toEqual([]);
    expect(out.some((m) => m.type === "add_user_message" &&
      (m as AddUserMessage).content.some((b) =>
        b.type === "text" && b.text.includes("being continued")))).toBe(false);
  });

  test("a full /compact sequence: real prompts replay, scaffolding skipped, no junk turns", async () => {
    // The shape a `/compact` leaves in the JSONL: a real turn, then
    // the summary + caveat + command marker + Compacted stdout (all
    // string scaffolding), then the model's continuation turn.
    const jsonl = [
      userStringEntry("first real question"),
      assistantEndTurn("m_a", "first answer"),
      compactSummaryEntry("This session is being continued from …"),
      userStringEntry("<local-command-caveat>Caveat: …</local-command-caveat>"),
      userStringEntry(
        "<command-name>/compact</command-name>\n<command-args>continue X</command-args>",
      ),
      userStringEntry("<local-command-stdout>Compacted</local-command-stdout>"),
      assistantEndTurn("m_b", "continuation answer"),
    ].join("\n");

    const out = await collectSession(jsonl);

    // Exactly two turns — the real question and the continuation.
    // None of the four scaffolding entries became an orphan turn.
    const userReplays = addUserMessagesOf(out);
    expect(userReplays).toHaveLength(2);
    expect(userReplays[0].content).toEqual([
      { type: "text", text: "first real question" },
    ]);
    // The continuation's synth opener carries `content: []` (no
    // user prompt — the summary entry was skipped scaffolding).
    expect(userReplays[1].content).toEqual([]);
    // No msg_id on add_user_message per [D15]; msg_ids ("m_a" /
    // "m_b") ride on the matching turn_complete frames below.

    const turnCompletes = turnCompletesOf(out);
    expect(turnCompletes).toHaveLength(2);
    expect(turnCompletes[0].msg_id).toBe("m_a");
    expect(turnCompletes[1].msg_id).toBe("m_b");
    expect(turnCompletes.every((m) => m.result === "success")).toBe(true);
    // No synthetic orphan ids leaked in.
    expect(out.some((m) => m.type === "turn_complete" &&
      (m as TurnComplete).msg_id.startsWith("orphan-"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Assistant-side string content — defensive normalisation
// ---------------------------------------------------------------------------

describe("translateJsonlSession — [W5a] assistant string content", () => {
  test("a bare-string assistant message.content becomes assistant_text", async () => {
    // Not observed in the surveyed corpus (assistant content is always
    // block-array), but `contentBlocks` covers it so a future shape
    // change cannot silently drop assistant text.
    const jsonl = [
      userStringEntry("hi"),
      JSON.stringify({
        type: "assistant",
        message: {
          id: "m1",
          stop_reason: "end_turn",
          content: "bare-string assistant reply",
        },
      }),
    ].join("\n");

    const out = await collectSession(jsonl);

    const texts = assistantTextsOf(out);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe("bare-string assistant reply");
  });
});
