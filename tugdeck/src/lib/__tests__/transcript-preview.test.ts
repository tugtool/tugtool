/**
 * transcript-preview — pure-function tests for the cheap preview tier.
 *
 * No React, no DOM — just the flattening + capping logic.
 */

import { describe, expect, test } from "bun:test";

import { previewTextForMessages, PREVIEW_CHAR_CAP } from "../transcript-preview";
import type { Message } from "@/lib/code-session-store/types";

const base = (over: Partial<Message> & Pick<Message, "kind">): Message =>
  ({ messageKey: "k", createdAt: 0, ...over }) as Message;

const userMsg = (text: string): Message =>
  base({ kind: "user_message", text, attachments: [], submitAt: 0 });
const assistantText = (text: string): Message =>
  base({ kind: "assistant_text", text });
const thinking = (text: string): Message =>
  base({ kind: "assistant_thinking", text });
const toolUse = (
  toolName: string,
  input: unknown,
  parentToolUseId?: string,
): Message =>
  base({
    kind: "tool_use",
    toolUseId: "t",
    toolName,
    input,
    status: "done",
    result: null,
    structuredResult: null,
    parentToolUseId,
    toolWallMs: null,
  });

describe("previewTextForMessages", () => {
  test("includes prose and the user prompt", () => {
    const out = previewTextForMessages([
      userMsg("fix the bug"),
      assistantText("Here is the fix."),
    ]);
    expect(out).toContain("fix the bug");
    expect(out).toContain("Here is the fix.");
  });

  test("summarizes a tool call as name + first string field", () => {
    const out = previewTextForMessages([
      toolUse("Read", { file_path: "/x/session.ts" }),
      toolUse("Bash", { command: "grep -rn foo ." }),
    ]);
    expect(out).toContain("Read /x/session.ts");
    expect(out).toContain("Bash grep -rn foo .");
  });

  test("falls back to the tool name when no recognized field is a string", () => {
    const out = previewTextForMessages([toolUse("Mystery", { count: 3 })]);
    expect(out).toBe("Mystery");
  });

  test("omits thinking blocks", () => {
    const out = previewTextForMessages([
      thinking("private reasoning"),
      assistantText("the answer"),
    ]);
    expect(out).not.toContain("private reasoning");
    expect(out).toContain("the answer");
  });

  test("skips nested (subagent) tool calls", () => {
    const out = previewTextForMessages([
      toolUse("Agent", { prompt: "do work" }),
      toolUse("Read", { file_path: "/nested.ts" }, "parent-id"),
    ]);
    expect(out).toContain("Agent do work");
    expect(out).not.toContain("/nested.ts");
  });

  test("collapses whitespace", () => {
    const out = previewTextForMessages([assistantText("a\n\n  b\t c")]);
    expect(out).toBe("a b c");
  });

  test("caps length with an ellipsis", () => {
    const out = previewTextForMessages([assistantText("x".repeat(1000))]);
    expect(out.length).toBeLessThanOrEqual(PREVIEW_CHAR_CAP + 1); // +1 for the ellipsis
    expect(out.endsWith("…")).toBe(true);
  });

  test("empty / text-free turn yields the empty string", () => {
    expect(previewTextForMessages([])).toBe("");
    expect(previewTextForMessages([thinking("only thinking")])).toBe("");
  });
});
