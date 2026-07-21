/**
 * command-atom — unit tests for the slash-command atom helpers.
 * Pure-logic coverage; no DOM, no async.
 */

import { describe, expect, test } from "bun:test";

import {
  commandWireText,
  chipStyle,
  chipDisplayLabel,
  chipHasIcon,
  detectCommandEcho,
  hasLeadingCommandAtom,
} from "../command-atom";
import type { ContentBlock } from "@/protocol";

function textBlocks(text: string): ContentBlock[] {
  return [{ type: "text", text }];
}

describe("commandWireText", () => {
  test("prepends the leading slash to a bare name", () => {
    expect(commandWireText("tugplug:commit")).toBe("/tugplug:commit");
  });

  test("appends trimmed argument text after a space", () => {
    expect(commandWireText("cmd", "one two")).toBe("/cmd one two");
  });

  test("ignores empty / whitespace-only args", () => {
    expect(commandWireText("cmd", "   ")).toBe("/cmd");
    expect(commandWireText("cmd", "")).toBe("/cmd");
  });

  test("is idempotent on a value that already carries a slash", () => {
    expect(commandWireText("/help")).toBe("/help");
  });
});

describe("chipStyle", () => {
  test("is the one shared appearance for every atom type (default tokens)", () => {
    expect(chipStyle()).toEqual({
      tokens: {
        surface: "--tug7-surface-atom-primary-normal-default-rest",
        key: "--tug7-surface-control-primary-filled-action-rest",
        border: "--tug7-element-atom-border-normal-default-rest",
        icon: "--tug7-element-atom-icon-normal-default-rest",
        text: "--tug7-element-atom-text-normal-default-rest",
      },
      geometry: { radius: 3, paddingX: 6, gap: 4 },
    });
  });
});

describe("chipDisplayLabel", () => {
  test("a command shows its leading slash", () => {
    expect(chipDisplayLabel("command", "tugplug:commit", "tugplug:commit")).toBe(
      "/tugplug:commit",
    );
  });

  test("a bang routing shows its `!` sigil", () => {
    for (const name of ["shell", "btw", "find", "history"]) {
      expect(chipDisplayLabel("command", name, name)).toBe(`!${name}`);
    }
  });

  test("other types show their stored label verbatim", () => {
    expect(chipDisplayLabel("file", "README.md", "README.md")).toBe("README.md");
    expect(chipDisplayLabel("link", "example.com", "https://example.com")).toBe(
      "example.com",
    );
  });
});

describe("chipHasIcon", () => {
  test("a command has no icon (the slash is its marker); others do", () => {
    expect(chipHasIcon("command")).toBe(false);
    expect(chipHasIcon("file")).toBe(true);
    expect(chipHasIcon("link")).toBe(true);
  });
});

describe("detectCommandEcho", () => {
  // Golden fixture: the exact echo claude emits for an expanded skill
  // (captured from the real CLI against a disable-model-invocation skill).
  test("recovers the bare name from a real no-args echo", () => {
    const echo =
      "<command-message>tugplug:probe-noop</command-message>\n" +
      "<command-name>/tugplug:probe-noop</command-name>";
    expect(detectCommandEcho(textBlocks(echo))).toEqual({
      value: "tugplug:probe-noop",
    });
  });

  test("recovers args from a <command-args> envelope", () => {
    const echo =
      "<command-message>tugplug:devise</command-message>\n" +
      "<command-name>/tugplug:devise</command-name>\n" +
      "<command-args>a plan for slash commands</command-args>";
    expect(detectCommandEcho(textBlocks(echo))).toEqual({
      value: "tugplug:devise",
      args: "a plan for slash commands",
    });
  });

  test("is tolerant of a name-only envelope (no command-message)", () => {
    const echo = "<command-name>/context</command-name>";
    expect(detectCommandEcho(textBlocks(echo))).toEqual({ value: "context" });
  });

  test("returns null for ordinary prose", () => {
    expect(detectCommandEcho(textBlocks("just some text"))).toBeNull();
  });

  test("returns null when the envelope is embedded in prose (false positive guard)", () => {
    const text =
      "I ran <command-name>/help</command-name> earlier and it worked.";
    expect(detectCommandEcho(textBlocks(text))).toBeNull();
  });

  test("returns null for a multi-block (e.g. image-bearing) message", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "<command-name>/help</command-name>" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "x" },
      },
    ];
    expect(detectCommandEcho(blocks)).toBeNull();
  });
});

describe("hasLeadingCommandAtom", () => {
  const C = "\uFFFC";
  const cmd = { type: "command" };
  const file = { type: "file" };

  test("true for a single command atom at the message start", () => {
    expect(hasLeadingCommandAtom(C, [cmd], C)).toBe(true);
  });

  test("true with trailing argument text after the command", () => {
    expect(hasLeadingCommandAtom(`${C} one two`, [cmd], C)).toBe(true);
  });

  test("true with a trailing argument atom (file mention) after the command", () => {
    expect(hasLeadingCommandAtom(`${C} ${C}`, [cmd, file], C)).toBe(true);
  });

  test("false when text leads the command (claude won't expand it)", () => {
    expect(hasLeadingCommandAtom(`run ${C}`, [cmd], C)).toBe(false);
  });

  test("false when a non-command atom leads", () => {
    expect(hasLeadingCommandAtom(`${C}${C}`, [file, cmd], C)).toBe(false);
  });

  test("false for a non-command atom", () => {
    expect(hasLeadingCommandAtom(C, [file], C)).toBe(false);
  });
});
