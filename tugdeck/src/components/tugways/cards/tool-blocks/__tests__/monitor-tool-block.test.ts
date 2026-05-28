/**
 * Pure-logic tests for `MonitorToolBlock`'s wire-narrowing + header /
 * tail composition helpers, plus the dispatch-registry entry that
 * makes `Monitor` route through the bespoke wrapper.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests. The `<details>`
 * expand affordance is HTML-native and needs no test (its behaviour
 * is the browser's; the data-shape that drives it is what we pin).
 *
 * @module components/tugways/cards/tool-blocks/__tests__/monitor-tool-block
 */

import { describe, expect, test } from "bun:test";

import {
  MonitorToolBlock,
  TAIL_LINE_COUNT,
  composeMonitorHeader,
  composeMonitorTail,
  narrowMonitorInput,
} from "../monitor-tool-block";
import { BESPOKE_FACTORY_BY_NAME } from "../../dev-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// narrowMonitorInput
// ---------------------------------------------------------------------------

describe("narrowMonitorInput", () => {
  test("keeps the recognised wire fields", () => {
    expect(
      narrowMonitorInput({
        command: "tail -F /var/log/app.log",
        path: "/var/log/app.log",
        pid: 12345,
        until: "ready",
        timeout: 30000,
      }),
    ).toEqual({
      command: "tail -F /var/log/app.log",
      path: "/var/log/app.log",
      pid: 12345,
      until: "ready",
      timeout: 30000,
    });
  });

  test("returns {} for non-object input", () => {
    expect(narrowMonitorInput(null)).toEqual({});
    expect(narrowMonitorInput("string")).toEqual({});
    expect(narrowMonitorInput(42)).toEqual({});
  });

  test("drops mistyped fields silently", () => {
    expect(narrowMonitorInput({ command: 123, until: false, pid: "abc" }))
      .toEqual({
        command: undefined,
        path: undefined,
        pid: undefined,
        until: undefined,
        timeout: undefined,
      });
  });
});

// ---------------------------------------------------------------------------
// composeMonitorHeader
// ---------------------------------------------------------------------------

describe("composeMonitorHeader", () => {
  test("prefers `command` over `path` and `pid`", () => {
    expect(
      composeMonitorHeader({
        command: "tail -F log",
        path: "/var/log/app.log",
        pid: 99,
      }),
    ).toEqual({ label: "tail -F log" });
  });

  test("falls back to `path` when no command", () => {
    expect(composeMonitorHeader({ path: "/var/log/app.log" }))
      .toEqual({ label: "/var/log/app.log" });
  });

  test("falls back to `pid` when no command or path", () => {
    expect(composeMonitorHeader({ pid: 12345 }))
      .toEqual({ label: "pid 12345" });
  });

  test("returns undefined when none of the identifying fields are present", () => {
    expect(composeMonitorHeader({})).toBeUndefined();
    expect(composeMonitorHeader({ until: "done" })).toBeUndefined();
  });

  test("ignores empty-string command / path", () => {
    expect(composeMonitorHeader({ command: "", path: "/x" }))
      .toEqual({ label: "/x" });
  });
});

// ---------------------------------------------------------------------------
// composeMonitorTail
// ---------------------------------------------------------------------------

describe("composeMonitorTail", () => {
  test("returns null for undefined / empty output", () => {
    expect(composeMonitorTail(undefined)).toBeNull();
    expect(composeMonitorTail("")).toBeNull();
  });

  test("emits the whole output as tail when ≤ tailCount lines", () => {
    expect(composeMonitorTail("a\nb\nc")).toEqual({
      head: "",
      tail: "a\nb\nc",
      droppedLineCount: 0,
    });
  });

  test("splits head + tail when output exceeds tailCount", () => {
    const output = "a\nb\nc\nd\ne";
    expect(composeMonitorTail(output, 3)).toEqual({
      head: "a\nb",
      tail: "c\nd\ne",
      droppedLineCount: 2,
    });
  });

  test("treats a trailing newline as terminator, not a content line", () => {
    // 3 content lines + trailing newline → all 3 fit in the default
    // tail; no head, no drop.
    expect(composeMonitorTail("a\nb\nc\n")).toEqual({
      head: "",
      tail: "a\nb\nc\n",
      droppedLineCount: 0,
    });
  });

  test("uses the default TAIL_LINE_COUNT when no override is passed", () => {
    const output = Array.from({ length: TAIL_LINE_COUNT + 2 }, (_, i) => `l${i}`)
      .join("\n");
    const result = composeMonitorTail(output);
    expect(result).not.toBeNull();
    expect(result?.droppedLineCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// TAIL_LINE_COUNT constant — pin to surface a silent tweak in review.
// ---------------------------------------------------------------------------

describe("TAIL_LINE_COUNT", () => {
  test("3-line tail by default", () => {
    expect(TAIL_LINE_COUNT).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Dispatch registration — `monitor` maps to `MonitorToolBlock` in the
// frozen `BESPOKE_FACTORY_BY_NAME` lookup. See the note in
// `skill-tool-block.test.ts` for why we don't call `resolveToolBlock`.
// ---------------------------------------------------------------------------

describe("dispatch registration", () => {
  test("`monitor` maps to the bespoke wrapper in the immutable lookup", () => {
    expect(BESPOKE_FACTORY_BY_NAME.get("monitor")).toBe(MonitorToolBlock);
  });
});
