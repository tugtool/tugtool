/**
 * turn-entry-markdown.test.ts — pure-logic coverage for `lastAssistantCopyText`
 * ([#step-13b1b]), the selector `/copy` uses to pick the most recent assistant
 * message's clipboard text.
 */

import { describe, expect, test } from "bun:test";
import {
  lastAssistantCopyText,
  turnEntryToMarkdown,
} from "../turn-entry-markdown";
import type { Message, TurnEntry } from "@/lib/code-session-store/types";

let seq = 0;
function assistantText(text: string): Message {
  seq += 1;
  return { kind: "assistant_text", text, messageKey: `a${seq}`, createdAt: seq };
}
function userMessage(text: string): Message {
  seq += 1;
  return {
    kind: "user_message",
    text,
    attachments: [],
    submitAt: seq,
    messageKey: `u${seq}`,
    createdAt: seq,
  };
}
// Only `messages` is read by the serializer/selector; the rest of TurnEntry is
// irrelevant here, so a partial turn is the honest fixture.
function turn(...messages: Message[]): TurnEntry {
  return { messages } as unknown as TurnEntry;
}

describe("lastAssistantCopyText", () => {
  test("returns null for an empty transcript", () => {
    expect(lastAssistantCopyText([])).toBeNull();
  });

  test("returns the most recent assistant turn's markdown", () => {
    const transcript = [
      turn(userMessage("hi"), assistantText("first reply")),
      turn(userMessage("again"), assistantText("second reply")),
    ];
    expect(lastAssistantCopyText(transcript)).toBe("second reply");
  });

  test("matches the per-row copy text (reuses turnEntryToMarkdown)", () => {
    const last = turn(userMessage("q"), assistantText("the answer"));
    const transcript = [turn(userMessage("x"), assistantText("old")), last];
    expect(lastAssistantCopyText(transcript)).toBe(turnEntryToMarkdown(last));
  });

  test("skips a trailing turn with no assistant content (interrupted)", () => {
    const transcript = [
      turn(userMessage("q"), assistantText("real answer")),
      // User submitted but the turn was interrupted before any reply.
      turn(userMessage("interrupted before reply")),
    ];
    expect(lastAssistantCopyText(transcript)).toBe("real answer");
  });

  test("returns null when no turn has assistant content", () => {
    const transcript = [turn(userMessage("only a prompt"))];
    expect(lastAssistantCopyText(transcript)).toBeNull();
  });
});
