/**
 * command-atom — unit tests for the slash-command atom helpers.
 * Pure-logic coverage; no DOM, no async.
 */

import { describe, expect, test } from "bun:test";

import {
  commandWireText,
  commandChipLabel,
  chipDisplayLabel,
  chipStyleForType,
  detectCommandEcho,
  isLoneLeadingCommandAtom,
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

describe("commandChipLabel", () => {
  test("restores the leading slash for display", () => {
    expect(commandChipLabel("tugplug:commit")).toBe("/tugplug:commit");
  });

  test("is idempotent on a value that already carries a slash", () => {
    expect(commandChipLabel("/help")).toBe("/help");
  });
});

describe("chipDisplayLabel", () => {
  test("command chips display the slash-prefixed name", () => {
    expect(chipDisplayLabel("command", "tugplug:commit", "tugplug:commit")).toBe(
      "/tugplug:commit",
    );
  });

  test("non-command chips display their stored label verbatim", () => {
    expect(chipDisplayLabel("file", "README.md", "README.md")).toBe("README.md");
    expect(chipDisplayLabel("link", "example.com", "https://example.com")).toBe(
      "example.com",
    );
  });
});

describe("chipStyleForType", () => {
  test("command style differs from file in BOTH tokens and geometry", () => {
    const cmd = chipStyleForType("command");
    const file = chipStyleForType("file");
    expect(cmd.tokens).not.toEqual(file.tokens);
    expect(cmd.geometry.radius).not.toBe(file.geometry.radius);
  });

  test("command tokens select the `command` theme variant", () => {
    const { tokens } = chipStyleForType("command");
    expect(tokens.surface).toBe(
      "--tug7-surface-atom-primary-normal-command-rest",
    );
    expect(tokens.border).toBe("--tug7-element-atom-border-normal-command-rest");
    expect(tokens.icon).toBe("--tug7-element-atom-icon-normal-command-rest");
    expect(tokens.text).toBe("--tug7-element-atom-text-normal-command-rest");
  });

  // Regression guard: non-command types must keep today's exact tokens and
  // geometry so their appearance is byte-for-byte unchanged.
  test("non-command types resolve to the shared default (unchanged)", () => {
    const expected = {
      tokens: {
        surface: "--tug7-surface-atom-primary-normal-default-rest",
        border: "--tug7-element-atom-border-normal-default-rest",
        icon: "--tug7-element-atom-icon-normal-default-rest",
        text: "--tug7-element-atom-text-normal-default-rest",
      },
      geometry: { radius: 3, paddingX: 6, gap: 4, icon: true },
    };
    for (const type of ["file", "image", "doc", "link", "unknown"]) {
      expect(chipStyleForType(type)).toEqual(expected);
    }
  });

  test("command chip omits the icon (no double slash); others keep it", () => {
    expect(chipStyleForType("command").geometry.icon).toBe(false);
    expect(chipStyleForType("file").geometry.icon).toBe(true);
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

describe("isLoneLeadingCommandAtom", () => {
  const C = "\uFFFC";
  const cmd = { type: "command" };
  const file = { type: "file" };

  test("true for a single command atom at the message start", () => {
    expect(isLoneLeadingCommandAtom(C, [cmd], C)).toBe(true);
  });

  test("true with trailing argument text after the command", () => {
    expect(isLoneLeadingCommandAtom(`${C} one two`, [cmd], C)).toBe(true);
  });

  test("false when text leads the command (claude won't expand it)", () => {
    expect(isLoneLeadingCommandAtom(`run ${C}`, [cmd], C)).toBe(false);
  });

  test("false for more than one atom", () => {
    expect(isLoneLeadingCommandAtom(`${C}${C}`, [cmd, file], C)).toBe(false);
  });

  test("false for a non-command atom", () => {
    expect(isLoneLeadingCommandAtom(C, [file], C)).toBe(false);
  });
});
