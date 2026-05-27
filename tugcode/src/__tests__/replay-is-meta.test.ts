// `isMeta: true` user entries are SDK-injected bookkeeping, not user
// submissions. Surveyed shapes across the JSONL corpus include:
//   - image-attachment coordinate hints
//     (`[Image: original WxH, displayed at WxH. Multiply coordinates …]`)
//     and source-path notes (`[Image: source: /…]`) the SDK appends
//     after every image submission so the AI can map clicks back
//     to the original;
//   - skill body / `/loop` content the SDK loads when a slash command
//     is invoked ("Base directory for this skill: …");
//
// Processing any of these as a user message produces TWO defects on
// the wire:
//   (a) the orphan-synthesis rule sees the second opener and closes
//       the prior real turn as `interrupted` (bogus "Interrupted" row
//       between the real prompt and the real assistant response);
//   (b) the meta text surfaces as its own pseudo-prompt cell in the
//       transcript.
//
// Fix: skip every `isMeta: true` user entry unconditionally regardless
// of content shape.

import { describe, expect, test } from "bun:test";

import { translateJsonlSession } from "../replay.ts";
import type {
  AddUserMessage,
  AssistantText,
  OutboundMessage,
  TurnComplete,
} from "../types.ts";

async function collectSession(jsonl: string): Promise<OutboundMessage[]> {
  const out: OutboundMessage[] = [];
  for await (const m of translateJsonlSession(
    { kind: "ok", jsonl, claudeSessionId: "sess-meta" },
    { disableYield: true },
  )) {
    out.push(m);
  }
  return out;
}

const realUserText = (text: string): string =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  });

const realUserTextWithImage = (text: string): string =>
  JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "text", text },
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
        },
      ],
    },
  });

/** An `isMeta: true` user entry — the SDK's bookkeeping marker. */
const metaEntry = (text: string): string =>
  JSON.stringify({
    type: "user",
    isMeta: true,
    message: { role: "user", content: [{ type: "text", text }] },
  });

/** An `isMeta: true` user entry with bare-string content. Surveyed
 *  variant — `/loop` and some skill-loader entries persist this shape. */
const metaStringEntry = (text: string): string =>
  JSON.stringify({
    type: "user",
    isMeta: true,
    message: { role: "user", content: text },
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

describe("translateJsonlSession — isMeta:true user entries skip silently", () => {
  test("image-coordinate hint between real user and assistant: no phantom interrupted turn, no meta-text row", async () => {
    // The reproducer for the bug observed in session 29ca5872: a real
    // user prompt with two images, followed by Claude Code's
    // auto-injected `isMeta:true` image-coordinate-hint user entry,
    // followed by the assistant response. Pre-fix this produced:
    //   #0001 real user, #0002 Interrupted, #0003 meta-text user, #0004 assistant.
    // Post-fix it produces:
    //   #0001 real user, #0002 assistant.
    const jsonl = [
      realUserTextWithImage("describe this image and this one"),
      metaEntry(
        "[Image: original 1932x2576, displayed at 1500x2000. " +
          "Multiply coordinates by 1.29 to map to original image.]",
      ),
      assistantEndTurn("m1", "Image 1 — old master drawing. Image 2 — cat."),
    ].join("\n");

    const out = await collectSession(jsonl);

    // Exactly one user message — the real submission. The meta entry
    // did NOT mint a second add_user_message.
    const users = addUserMessagesOf(out);
    expect(users).toHaveLength(1);
    expect((users[0].content[0] as { text?: string }).text).toBe(
      "describe this image and this one",
    );

    // Exactly one turn_complete, and it's the clean assistant terminal.
    // No `interrupted` orphan synthesis from a phantom second opener.
    const completes = turnCompletesOf(out);
    expect(completes).toHaveLength(1);
    expect(completes[0].msg_id).toBe("m1");
    expect(completes[0].result).toBe("success");

    // The assistant text reaches the wire intact.
    const texts = assistantTextsOf(out);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe(
      "Image 1 — old master drawing. Image 2 — cat.",
    );

    // The meta string is nowhere on the wire.
    expect(
      out.some(
        (m) =>
          m.type === "assistant_text" &&
          (m as AssistantText).text.includes("Multiply coordinates"),
      ),
    ).toBe(false);
    expect(
      out.some(
        (m) =>
          m.type === "add_user_message" &&
          (m as AddUserMessage).content.some(
            (b) =>
              b.type === "text" && b.text.includes("Multiply coordinates"),
          ),
      ),
    ).toBe(false);
  });

  test("skill-body meta entry between turns: skipped, both real turns still commit", async () => {
    // Surveyed shape — Claude Code injects the skill body as an
    // isMeta:true `user` entry when a slash command is invoked.
    const jsonl = [
      realUserText("first real question"),
      assistantEndTurn("m_a", "first answer"),
      metaEntry(
        "Base directory for this skill: /Users/kocienda/Mounts/u/src/tugtool/tugplug/skills/example",
      ),
      realUserText("second real question"),
      assistantEndTurn("m_b", "second answer"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const users = addUserMessagesOf(out);
    expect(users).toHaveLength(2);
    expect((users[0].content[0] as { text?: string }).text).toBe(
      "first real question",
    );
    expect((users[1].content[0] as { text?: string }).text).toBe(
      "second real question",
    );

    const completes = turnCompletesOf(out);
    expect(completes).toHaveLength(2);
    expect(completes.every((c) => c.result === "success")).toBe(true);
    expect(completes.map((c) => c.msg_id)).toEqual(["m_a", "m_b"]);
  });

  test("isMeta with bare-string content also skipped (does not fall through to scaffolding path)", async () => {
    // Some isMeta entries carry the body as a bare string, not a block
    // array. The skip must precede the string-content branch.
    const jsonl = [
      realUserText("ask a thing"),
      metaStringEntry("# /loop — schedule a recurring or self-paced prompt"),
      assistantEndTurn("m1", "thing answered"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const users = addUserMessagesOf(out);
    expect(users).toHaveLength(1);
    expect((users[0].content[0] as { text?: string }).text).toBe("ask a thing");

    const completes = turnCompletesOf(out);
    expect(completes).toHaveLength(1);
    expect(completes[0].result).toBe("success");
  });

  test("isMeta entry at start of JSONL: assistant entry still gets its synth opener (no double meta)", async () => {
    // Defensive — when the SDK persists an isMeta entry BEFORE any
    // real user submission (e.g. session-resume context loader), the
    // assistant entry's orphan-opener path still mints exactly one
    // add_user_message{content: []}.
    const jsonl = [
      metaEntry("[Image: source: /tmp/x.png]"),
      assistantEndTurn("m1", "resumed answer"),
    ].join("\n");

    const out = await collectSession(jsonl);

    const users = addUserMessagesOf(out);
    expect(users).toHaveLength(1);
    expect(users[0].content).toEqual([]);

    const completes = turnCompletesOf(out);
    expect(completes).toHaveLength(1);
    expect(completes[0].msg_id).toBe("m1");
    expect(completes[0].result).toBe("success");
  });
});
