/**
 * `BashToolBlock` — Layer-2 wrapper tests.
 *
 * Coverage:
 *  - Header: renders the tool name, the terminal icon, and the
 *    command from `input.command` as the args summary.
 *  - Body: composes a `TerminalBlock` fed from
 *    `tool_use_structured.{stdout,stderr}` (matches the v2.1.x
 *    `test-09-bash-auto-approved.jsonl` shape) — no test rig drives
 *    the JSONL replay end-to-end; the unit test asserts the
 *    rendering against the structured-result shape directly.
 *  - Footer: synthesizes `exit 0` (subtle) when `is_error` is
 *    false and `interrupted` is absent; `exit 1` (strong) when
 *    `is_error` is true; `interrupted` badge supersedes the exit
 *    badge when `structured_result.interrupted` is true.
 *  - Empty success path (`exit 0`, no stdout/stderr) renders a
 *    "(no output)" hint so the row doesn't read as missing data.
 *  - Streaming: status="streaming" hides the body in favor of the
 *    `<StreamingPlaceholder />` so the row reserves vertical
 *    space without flashing partial content.
 *  - Error: status="error" with a plain-text `tool_result.output`
 *    (no structured_result) surfaces the chrome's error band and
 *    still renders the body if there is structured content.
 *  - Caution: dispatch surfaces `caution`; the chrome paints the
 *    inline caution badge.
 *  - Helper: `composeTerminalData` — derives the `TerminalData`
 *    payload from raw inputs.
 *  - Helper: `formatBashDuration` — covers ms / s / m formatting.
 *  - Dispatch: `resolveToolWrapper("Bash")` returns `BashToolBlock`
 *    after registration.
 */

import "../../../../../__tests__/setup-rtl";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import React from "react";

import {
  BashToolBlock,
  composeTerminalData,
  formatBashDuration,
} from "../bash-tool-block";
import {
  registerToolWrapper,
  resolveToolWrapper,
} from "../../tide-assistant-renderer-dispatch";
import type { ToolWrapperProps } from "../types";

// The dispatch test in `tide-assistant-renderer-dispatch.test.ts`
// calls `_resetToolWrapperRegistryForTests()` in its own
// `beforeEach`, which wipes the module-level
// `registerToolWrapper("bash", BashToolBlock)` registration that
// dispatch.ts performs at import time. When this test file runs
// after that one (the bun runner's filesystem ordering), the
// registry is empty. Re-register here so the dispatch-resolution
// assertions below pass independent of which sibling test files
// have run.
beforeAll(() => {
  registerToolWrapper("bash", BashToolBlock);
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("composeTerminalData", () => {
  test("uses structured stdout / stderr / interrupted when present", () => {
    const data = composeTerminalData(
      { stdout: "out", stderr: "err", interrupted: false },
      undefined,
      false,
    );
    expect(data).toEqual({
      stdout: "out",
      stderr: "err",
      exitCode: 0,
      interrupted: undefined,
    });
  });

  test("falls back to textOutput for stdout when structured is absent", () => {
    const data = composeTerminalData(undefined, "fallback", false);
    expect(data.stdout).toBe("fallback");
    expect(data.stderr).toBe("");
  });

  test("synthesizes exit 1 when is_error is true and not interrupted", () => {
    const data = composeTerminalData(
      { stdout: "", stderr: "", interrupted: false },
      undefined,
      true,
    );
    expect(data.exitCode).toBe(1);
    expect(data.interrupted).toBeUndefined();
  });

  test("interrupted suppresses the synthetic exit code", () => {
    const data = composeTerminalData(
      { stdout: "", stderr: "", interrupted: true },
      undefined,
      true,
    );
    expect(data.exitCode).toBeUndefined();
    expect(data.interrupted).toBe(true);
  });
});

describe("formatBashDuration", () => {
  test("ms / s / minutes", () => {
    expect(formatBashDuration(0)).toBe("0 ms");
    expect(formatBashDuration(428)).toBe("428 ms");
    expect(formatBashDuration(1500)).toBe("1.5 s");
    expect(formatBashDuration(15_000)).toBe("15 s");
    expect(formatBashDuration(60_000)).toBe("1m 00s");
    expect(formatBashDuration(303_000)).toBe("5m 03s");
  });

  test("non-finite / negative → empty", () => {
    expect(formatBashDuration(NaN)).toBe("");
    expect(formatBashDuration(-1)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Component — render-time assertions
// ---------------------------------------------------------------------------

function makeProps(
  overrides: Partial<ToolWrapperProps> = {},
): ToolWrapperProps {
  return {
    toolUseId: "tu-1",
    toolName: "Bash",
    msgId: "msg-1",
    seq: 0,
    input: { command: "echo 'hello from bash'" },
    structuredResult: { stdout: "hello from bash", stderr: "", interrupted: false },
    isError: false,
    status: "ready",
    ...overrides,
  };
}

describe("BashToolBlock — header", () => {
  test("renders the tool name + terminal icon + command summary", () => {
    const { container } = render(<BashToolBlock {...makeProps()} />);
    const root = container.querySelector(
      '[data-slot="bash-tool-block"]',
    ) as HTMLElement;
    expect(root).not.toBeNull();
    const header = root.querySelector(
      '[data-slot="tool-wrapper-header"]',
    ) as HTMLElement;
    expect(header.textContent).toContain("Bash");
    expect(
      header.querySelector('[data-slot="bash-tool-block-command"]')?.textContent,
    ).toBe("echo 'hello from bash'");
  });

  test("missing command field — no args summary, header still renders the name", () => {
    const props = makeProps({ input: {} });
    const { container } = render(<BashToolBlock {...props} />);
    const root = container.querySelector('[data-slot="bash-tool-block"]') as HTMLElement;
    const header = root.querySelector('[data-slot="tool-wrapper-header"]') as HTMLElement;
    expect(header.textContent).toContain("Bash");
    expect(header.querySelector('[data-slot="bash-tool-block-command"]')).toBeNull();
  });
});

describe("BashToolBlock — body composition (matches test-09-bash-auto-approved.jsonl shape)", () => {
  test("structured stdout is rendered through TerminalBlock", () => {
    const { container } = render(<BashToolBlock {...makeProps()} />);
    const body = container.querySelector(
      '[data-slot="tool-wrapper-body"]',
    ) as HTMLElement;
    const terminalRoot = body.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    expect(terminalRoot.dataset.empty).toBe("false");
    expect(terminalRoot.textContent).toContain("hello from bash");
  });

  test("textOutput fallback drives the body when structured_result is absent", () => {
    const props = makeProps({
      structuredResult: undefined,
      textOutput: "fallback content",
    });
    const { container } = render(<BashToolBlock {...props} />);
    const body = container.querySelector('[data-slot="tool-wrapper-body"]') as HTMLElement;
    expect(body.textContent).toContain("fallback content");
  });

  test("body renders nothing visible when both structured and textOutput are missing", () => {
    const props = makeProps({ structuredResult: undefined, textOutput: undefined });
    const { container } = render(<BashToolBlock {...props} />);
    const terminalRoot = container.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    expect(terminalRoot.dataset.empty).toBe("true");
  });
});

describe("BashToolBlock — footer", () => {
  test("success path: exit-zero subtle badge", () => {
    const { container } = render(<BashToolBlock {...makeProps()} />);
    const footer = container.querySelector(
      '[data-slot="tool-wrapper-footer"]',
    ) as HTMLElement;
    expect(footer).not.toBeNull();
    const exit = footer.querySelector(
      '[data-slot="bash-tool-block-exit"]',
    ) as HTMLElement;
    expect(exit.textContent).toBe("exit 0");
    expect(exit.dataset.exit).toBe("zero");
    expect(exit.classList.contains("bash-tool-block-exit--zero")).toBe(true);
  });

  test("failure path: exit-nonzero strong badge", () => {
    const props = makeProps({
      isError: true,
      structuredResult: { stdout: "", stderr: "command failed", interrupted: false },
    });
    const { container } = render(<BashToolBlock {...props} />);
    const exit = container.querySelector(
      '[data-slot="bash-tool-block-exit"]',
    ) as HTMLElement;
    expect(exit.textContent).toBe("exit 1");
    expect(exit.dataset.exit).toBe("nonzero");
    expect(exit.classList.contains("bash-tool-block-exit--nonzero")).toBe(true);
  });

  test("interrupted: badge replaces the exit code", () => {
    const props = makeProps({
      structuredResult: { stdout: "partial", stderr: "", interrupted: true },
    });
    const { container } = render(<BashToolBlock {...props} />);
    expect(
      container.querySelector('[data-slot="bash-tool-block-interrupted"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-slot="bash-tool-block-exit"]'),
    ).toBeNull();
  });

  test("(no output) hint when exit 0 and body is empty", () => {
    const props = makeProps({
      structuredResult: { stdout: "", stderr: "", interrupted: false },
    });
    const { container } = render(<BashToolBlock {...props} />);
    const hint = container.querySelector(
      '[data-slot="bash-tool-block-no-output"]',
    ) as HTMLElement;
    expect(hint).not.toBeNull();
    expect(hint.textContent).toBe("(no output)");
  });

  test("durationMs renders when supplied", () => {
    const props = makeProps({ durationMs: 428 });
    const { container } = render(<BashToolBlock {...props} />);
    const dur = container.querySelector(
      '[data-slot="bash-tool-block-duration"]',
    ) as HTMLElement;
    expect(dur.textContent).toBe("428 ms");
  });
});

describe("BashToolBlock — streaming + error states", () => {
  test("streaming renders the placeholder body, not TerminalBlock", () => {
    const props = makeProps({ status: "streaming" });
    const { container } = render(<BashToolBlock {...props} />);
    expect(
      container.querySelector('[data-slot="tool-wrapper-streaming-placeholder"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-slot="terminal-body"]'),
    ).toBeNull();
  });

  test("error status paints the chrome's error stripe + inline error message", () => {
    const props = makeProps({
      status: "error",
      isError: true,
      structuredResult: undefined,
      textOutput: "command not found: foo",
    });
    const { container } = render(<BashToolBlock {...props} />);
    const root = container.querySelector('[data-slot="bash-tool-block"]') as HTMLElement;
    expect(root.dataset.status).toBe("error");
    const errMsg = container.querySelector(
      '[data-slot="tool-wrapper-error"]',
    ) as HTMLElement;
    expect(errMsg).not.toBeNull();
    expect(errMsg.textContent).toContain("command not found: foo");
  });
});

describe("BashToolBlock — caution flag", () => {
  test("paints the inline caution badge when caution is set", () => {
    const props = makeProps({
      caution: { reason: "unknown_shape", detail: "missing structured stdout" },
    });
    const { container } = render(<BashToolBlock {...props} />);
    const root = container.querySelector('[data-slot="bash-tool-block"]') as HTMLElement;
    expect(root.dataset.caution).toBe("unknown_shape");
    const badge = container.querySelector(
      '[data-slot="tool-wrapper-caution"]',
    ) as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain("unknown shape");
  });
});

// ---------------------------------------------------------------------------
// Dispatch registration
// ---------------------------------------------------------------------------

describe("dispatch registry", () => {
  test("resolveToolWrapper('Bash') returns BashToolBlock", () => {
    expect(resolveToolWrapper("Bash")).toBe(BashToolBlock);
    expect(resolveToolWrapper("bash")).toBe(BashToolBlock);
    expect(resolveToolWrapper("BASH")).toBe(BashToolBlock);
  });
});
