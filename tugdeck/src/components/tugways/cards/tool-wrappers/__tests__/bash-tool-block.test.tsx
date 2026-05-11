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
 *  - Footer: success-with-output paints no footer (success is
 *    implicit; `exit 0` would read as noise on every row); `exit N`
 *    (strong) when `is_error` is true and the synthesized exit code
 *    is non-zero; `interrupted` badge supersedes the exit badge when
 *    `structured_result.interrupted` is true.
 *  - Empty success path (no stdout/stderr) renders a "(no output)"
 *    hint so the row doesn't read as missing data.
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
  isUnifiedDiffOutput,
  tryParseBashDiff,
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
  test("success-with-output path: footer chrome hidden entirely (no badge, no empty bar)", () => {
    const { container } = render(<BashToolBlock {...makeProps()} />);
    // The dominant case — `echo hello` succeeded with stdout — paints
    // no exit badge (success is implicit) and no empty footer bar.
    expect(
      container.querySelector('[data-slot="tool-wrapper-footer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-slot="bash-tool-block-exit"]'),
    ).toBeNull();
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
// Unified-diff detection — `isUnifiedDiffOutput`
// ---------------------------------------------------------------------------

const GIT_SHOW_FIXTURE = `commit 1234567890abcdef1234567890abcdef12345678
Author: Test User <test@example.com>
Date:   Mon Jan 1 00:00:00 2024 -0500

    Add greeting helper

diff --git a/src/greet.ts b/src/greet.ts
index abc1234..def5678 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,5 @@
 export function greet(name: string) {
-  return "Hello " + name;
+  return \`Hello, \${name}!\`;
 }
+
+export const DEFAULT = greet("world");
`;

const GIT_DIFF_FIXTURE = `diff --git a/lib/foo.ts b/lib/foo.ts
index 1111111..2222222 100644
--- a/lib/foo.ts
+++ b/lib/foo.ts
@@ -10,7 +10,7 @@ export function foo() {
-  return 1;
+  return 2;
 }
`;

const GIT_LOG_P_FIXTURE = `commit abcdef1
Author: A <a@x.com>
Date:   Mon Jan 1 00:00:00 2024 -0500

    Bump version

diff --git a/version.txt b/version.txt
--- a/version.txt
+++ b/version.txt
@@ -1 +1 @@
-1.0.0
+1.0.1
`;

const GIT_STATUS_FIXTURE = `On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
`;

const LS_LA_FIXTURE = `total 24
drwxr-xr-x  5 user staff   160 Jan  1 00:00 .
drwxr-xr-x 10 user staff   320 Jan  1 00:00 ..
-rw-r--r--  1 user staff  1024 Jan  1 00:00 README.md
`;

describe("isUnifiedDiffOutput — positives", () => {
  test("git show output (commit + diff --git + @@) is detected", () => {
    expect(isUnifiedDiffOutput(GIT_SHOW_FIXTURE)).toBe(true);
  });

  test("git diff output (diff --git + @@, no commit header) is detected", () => {
    expect(isUnifiedDiffOutput(GIT_DIFF_FIXTURE)).toBe(true);
  });

  test("git log -p output (commit + diff --git) is detected", () => {
    expect(isUnifiedDiffOutput(GIT_LOG_P_FIXTURE)).toBe(true);
  });

  test("bare hunk header alone is enough (some pipelines pre-strip headers)", () => {
    expect(isUnifiedDiffOutput("@@ -1,2 +1,3 @@\n unchanged\n+new\n")).toBe(true);
  });
});

describe("isUnifiedDiffOutput — negatives (must not false-positive)", () => {
  test("git status is not a diff", () => {
    expect(isUnifiedDiffOutput(GIT_STATUS_FIXTURE)).toBe(false);
  });

  test("ls -la is not a diff", () => {
    expect(isUnifiedDiffOutput(LS_LA_FIXTURE)).toBe(false);
  });

  test("empty / undefined returns false", () => {
    expect(isUnifiedDiffOutput(undefined)).toBe(false);
    expect(isUnifiedDiffOutput("")).toBe(false);
  });

  test("bash output that contains '@@' literally but not as a hunk header is not a diff", () => {
    // The `@@` separator appears in some build / CI scripts — it must
    // NOT match unless followed by the full `-n,n +n,n @@` shape.
    const noise = "deploy-rev: tag@@2024-01-01\nartifact: app@@v1.2.3\nstatus: ok\n";
    expect(isUnifiedDiffOutput(noise)).toBe(false);
  });

  test("a bare 'commit' word in narrative bash output is not a diff", () => {
    expect(
      isUnifiedDiffOutput("Reminder: commit your work before lunch\n"),
    ).toBe(false);
  });

  test("scan is bounded to the first 2 KB — markers beyond it don't trigger", () => {
    const padding = "x".repeat(3000);
    expect(isUnifiedDiffOutput(`${padding}\ndiff --git a/foo b/foo\n`)).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// tryParseBashDiff — heuristic + parser composition
// ---------------------------------------------------------------------------

describe("tryParseBashDiff", () => {
  test("returns hunks for git show output", () => {
    const hunks = tryParseBashDiff(GIT_SHOW_FIXTURE);
    expect(hunks).not.toBeNull();
    expect(hunks!.length).toBeGreaterThan(0);
    expect(hunks![0]).toMatchObject({
      before_start: 1,
      before_count: 3,
      after_start: 1,
      after_count: 5,
    });
  });

  test("returns null when the heuristic matches but the parser yields zero hunks", () => {
    // `commit <sha>` alone with no diff body → heuristic true, parser → 0 hunks.
    const heuristicOnlyShape = "commit abcdefg\nAuthor: x\nDate: y\n\n    empty commit\n";
    expect(tryParseBashDiff(heuristicOnlyShape)).toBeNull();
  });

  test("returns null for plain bash output", () => {
    expect(tryParseBashDiff(GIT_STATUS_FIXTURE)).toBeNull();
    expect(tryParseBashDiff(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Body composition — DiffBlock routing
// ---------------------------------------------------------------------------

describe("BashToolBlock — body diff routing", () => {
  test("diff-shaped textOutput renders DiffBlock (not TerminalBlock)", () => {
    const props = makeProps({
      input: { command: "git show HEAD" },
      structuredResult: undefined,
      textOutput: GIT_SHOW_FIXTURE,
    });
    const { container } = render(<BashToolBlock {...props} />);
    expect(container.querySelector('[data-slot="diff-body"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="terminal-body"]')).toBeNull();
  });

  test("diff-shaped structured stdout also routes through DiffBlock", () => {
    const props = makeProps({
      input: { command: "git diff" },
      structuredResult: { stdout: GIT_DIFF_FIXTURE, stderr: "", interrupted: false },
    });
    const { container } = render(<BashToolBlock {...props} />);
    expect(container.querySelector('[data-slot="diff-body"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="terminal-body"]')).toBeNull();
  });

  test("non-diff output continues to render TerminalBlock", () => {
    const props = makeProps({
      input: { command: "git status" },
      structuredResult: { stdout: GIT_STATUS_FIXTURE, stderr: "", interrupted: false },
    });
    const { container } = render(<BashToolBlock {...props} />);
    expect(container.querySelector('[data-slot="terminal-body"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="diff-body"]')).toBeNull();
  });

  test("diff-shaped but zero parsed hunks falls back to TerminalBlock", () => {
    // `commit <sha>` alone — heuristic matches, parser yields no hunks.
    const heuristicOnly = "commit abcdef1\nAuthor: x\nDate: y\n\n    empty\n";
    const props = makeProps({
      input: { command: "git show HEAD" },
      structuredResult: { stdout: heuristicOnly, stderr: "", interrupted: false },
    });
    const { container } = render(<BashToolBlock {...props} />);
    expect(container.querySelector('[data-slot="terminal-body"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="diff-body"]')).toBeNull();
  });

  test("streaming does NOT detect / route — partial output may include stray markers", () => {
    const props = makeProps({
      status: "streaming",
      input: { command: "git show HEAD" },
      structuredResult: { stdout: GIT_SHOW_FIXTURE, stderr: "", interrupted: false },
    });
    const { container } = render(<BashToolBlock {...props} />);
    // Streaming swaps the body for the placeholder regardless of payload.
    expect(
      container.querySelector('[data-slot="tool-wrapper-streaming-placeholder"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-slot="diff-body"]')).toBeNull();
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
