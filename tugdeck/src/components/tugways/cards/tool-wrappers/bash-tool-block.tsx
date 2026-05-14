/**
 * `BashToolBlock` — Layer-2 wrapper for the Bash tool.
 *
 * Composes `ToolWrapperChrome` (header / footer / status) around a
 * smart-picked body kind — usually `TerminalBlock`, but `DiffBlock`
 * when the output looks like a unified diff. Per [Spec S03] / [Table
 * T02]:
 *
 *   - **Header:** terminal icon + tool name "Bash" + the shell
 *     command pulled from `input.command` (truncated with hover-
 *     expand via CSS — no JS state).
 *   - **Body:** `TerminalBlock` fed from
 *     `tool_use_structured.{stdout,stderr}` when present, otherwise
 *     falling back to the plain-text `tool_result.output`. When that
 *     stdout looks like a unified diff (i.e. `git diff`, `git show`,
 *     `git log -p`), `DiffBlock` renders instead — see the
 *     diff-routing helpers below.
 *   - **Footer badges:** non-zero exit code (red), `interrupted`
 *     indicator, "(no output)" hint for empty-success cases, and
 *     `durationMs` when known. `exit 0` is intentionally suppressed
 *     — a successful command reads more cleanly without it. The
 *     footer chrome is hidden entirely when none of these would
 *     render (the dominant `exit 0 + has output` case).
 *
 * Streaming behavior:
 *
 *   - `status === "streaming"` → header still shows whatever input
 *     fragment has arrived (typically an empty `command` until
 *     enough of the input has streamed in); body is the
 *     `<StreamingPlaceholder />` so the row reserves vertical space
 *     without flashing empty content.
 *   - `status === "ready"` → steady-state render.
 *   - `status === "error"` → chrome paints the error stripe, the
 *     plain-text `tool_result.output` (if any) renders as the inline
 *     error message, and the body still renders the structured /
 *     text output below in case it's diagnostic.
 *
 * Registration:
 *
 *   `tide-assistant-renderer-dispatch.ts` imports this module
 *   eagerly and calls `registerToolWrapper("bash", BashToolBlock)`
 *   from its own initialization block. Routing the registration
 *   through dispatch (rather than self-registering at the bottom of
 *   this module) avoids the import cycle: this module imports types
 *   from dispatch / the chrome, and the dispatch imports this
 *   wrapper — at top level, the chain has to flow one direction.
 *   Real callers reach `BashToolBlock` via
 *   `resolveToolWrapper("Bash")` from the dispatch.
 *
 * Laws:
 *  - [L06] no React state for appearance — chrome owns DOM
 *    attributes; body composition is pure props.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="bash-tool-block"` (delegated to the chrome's
 *    `rootSlot`).
 *  - [L20] reuses the chrome's `--tugx-toolblock-*` and the body's
 *    `--tugx-term-*`; introduces no new tokens beyond the
 *    bash-specific footer-badge slots already in
 *    `--tugx-term-exit-*` and `--tugx-term-interrupted-*`.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — body kind owns the prose-rendering
 *    cost, wrapper owns chrome.
 *
 * @module components/tugways/cards/tool-wrappers/bash-tool-block
 */

import "./bash-tool-block.css";

import React from "react";
import { Terminal } from "lucide-react";

import {
  TerminalBlock,
  type TerminalData,
} from "@/components/tugways/body-kinds/terminal-block";
import { DiffBlock } from "@/components/tugways/body-kinds/diff-block";
import { TugTooltip } from "@/components/tugways/tug-tooltip";
import { parseUnifiedDiffText } from "@/lib/diff/parse-unified-diff";
import type { DiffHunk } from "@/lib/diff/types";

import {
  StreamingPlaceholder,
  ToolWrapperChrome,
} from "./tool-wrapper-chrome";
import type { ToolWrapperProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowings — the structured_result for Bash carries
// stdout / stderr / interrupted + a few flags we don't surface yet.
// The shape is from the v2.1.x stream-json catalog
// (`test-09-bash-auto-approved.jsonl`) and matches Anthropic's
// CC `Bash` tool emission.
// ---------------------------------------------------------------------------

/** Bash tool input (from `tool_use.input`). */
export interface BashToolInput {
  command?: string;
  description?: string;
  /** Optional timeout in ms — not surfaced in the chrome today. */
  timeout?: number;
}

/** Bash tool structured result (from `tool_use_structured`). */
export interface BashStructuredResult {
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
  isImage?: boolean;
  noOutputExpected?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers — narrow the wrapper-side `unknown` props to the Bash shapes.
// ---------------------------------------------------------------------------

function narrowInput(value: unknown): BashToolInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    command: typeof v.command === "string" ? v.command : undefined,
    description: typeof v.description === "string" ? v.description : undefined,
    timeout: typeof v.timeout === "number" ? v.timeout : undefined,
  };
}

function narrowStructured(value: unknown): BashStructuredResult {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    stdout: typeof v.stdout === "string" ? v.stdout : undefined,
    stderr: typeof v.stderr === "string" ? v.stderr : undefined,
    interrupted:
      typeof v.interrupted === "boolean" ? v.interrupted : undefined,
    isImage: typeof v.isImage === "boolean" ? v.isImage : undefined,
    noOutputExpected:
      typeof v.noOutputExpected === "boolean" ? v.noOutputExpected : undefined,
  };
}

/**
 * Compose the `TerminalData` payload for the body. Prefer the
 * structured result; fall back to `textOutput` for `stdout` if the
 * structured shape is absent (older catalogs / drift).
 */
export function composeTerminalData(
  structured: BashStructuredResult | undefined,
  textOutput: string | undefined,
  isError: boolean,
): TerminalData {
  const stdout =
    structured?.stdout ?? (textOutput !== undefined ? textOutput : "");
  const stderr = structured?.stderr ?? "";
  const interrupted = structured?.interrupted === true;
  // Synthesize an exit code: Anthropic's Bash tool result carries
  // `is_error` rather than the underlying shell exit code, so 0
  // signals success and any other indicator (1) signals failure.
  // The actual code is unknown; the badge color is what matters
  // (zero subtle / nonzero strong per [Table T02]).
  const exitCode = interrupted ? undefined : isError ? 1 : 0;
  return {
    stdout,
    stderr,
    exitCode,
    interrupted: interrupted ? true : undefined,
  };
}

/**
 * Synthesize a footer-badge prop bundle for `TerminalBlock` to skip
 * — `BashToolBlock`'s chrome owns the post-mortem badges so we
 * deliberately do NOT pass `exitCode` / `interrupted` into the body.
 * The body just shows stdout/stderr; the chrome footer holds the
 * post-mortem signals.
 */
function bodyDataWithoutFooter(data: TerminalData): TerminalData {
  return { stdout: data.stdout, stderr: data.stderr };
}

// ---------------------------------------------------------------------------
// Unified-diff detection
//
// Smart-pick routing: when the bash output looks like a unified diff (i.e.
// the user ran `git diff`, `git show`, `git log -p`, or any pipeline that
// emits the standard diff shape), the wrapper renders `DiffBlock` instead
// of `TerminalBlock`. The check is heuristic-then-parse:
//
//  1. `isUnifiedDiffOutput(text)` — fast string scan, scoped to the first
//     ~2 KB so a 10 MB log doesn't pay the full regex cost.
//  2. `parseUnifiedDiffText(text)` — actually parses the hunks. If the
//     heuristic matched but no hunks come out (false positive), fall back
//     to `TerminalBlock` so nothing renders blank.
//
// The fallback is what makes this safe to enable by default: the worst
// case for benign bash output is "still renders as terminal" — never a
// regression. Streaming is excluded; partial output can include an `@@`
// marker mid-line and we'd rather wait for the complete payload.
// ---------------------------------------------------------------------------

/**
 * How many leading bytes of `textOutput` the detection regex inspects.
 * Bounded so a multi-MB bash log doesn't pay the full scan cost — the
 * markers we're looking for (commit header, `diff --git`, first `@@`)
 * always appear in the first few lines of a real diff.
 */
const DIFF_DETECT_SCAN_LIMIT = 2048;

/** `diff --git ` line — only `git diff` / `git show` / `git log -p` emit this. */
const DIFF_GIT_PREFIX_RE = /^diff --git /m;
/** Unified-diff hunk header — `@@ -<n>[,<n>] +<n>[,<n>] @@`. */
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m;
/** `commit <sha>` opener for `git show` / `git log -p`; 7–40 hex chars. */
const COMMIT_HEADER_RE = /^commit [0-9a-f]{7,40}\b/m;

/**
 * Heuristic gate: does the bash output look like a unified diff?
 *
 * Scans the first ~2 KB for any of three markers — `diff --git `, a
 * full `@@ -n,n +n,n @@` hunk header, or `commit <sha>` at line start.
 * The parser runs after the gate and is the source of truth — this
 * check exists only to skip the parse cost for the dominant non-diff
 * case.
 *
 * Returns false for `undefined` / empty strings.
 */
export function isUnifiedDiffOutput(text: string | undefined): boolean {
  if (text === undefined || text.length === 0) return false;
  const slice = text.length > DIFF_DETECT_SCAN_LIMIT
    ? text.slice(0, DIFF_DETECT_SCAN_LIMIT)
    : text;
  return (
    DIFF_GIT_PREFIX_RE.test(slice) ||
    HUNK_HEADER_RE.test(slice) ||
    COMMIT_HEADER_RE.test(slice)
  );
}

/**
 * Try to parse the bash output as a unified diff. Returns the hunks
 * when the heuristic matches AND the parser yields at least one hunk;
 * returns `null` when either condition fails so the caller falls
 * back to `TerminalBlock`.
 */
export function tryParseBashDiff(
  text: string | undefined,
): DiffHunk[] | null {
  if (!isUnifiedDiffOutput(text)) return null;
  const hunks = parseUnifiedDiffText(text!);
  return hunks.length > 0 ? hunks : null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const BashToolBlock: React.FC<ToolWrapperProps> = ({
  toolUseId,
  toolName,
  input,
  structuredResult,
  textOutput,
  isError = false,
  durationMs,
  status,
  caution,
}) => {
  const bashInput = React.useMemo(() => narrowInput(input), [input]);
  const structured = React.useMemo(
    () => narrowStructured(structuredResult),
    [structuredResult],
  );
  const terminalData = React.useMemo(
    () => composeTerminalData(structured, textOutput, isError),
    [structured, textOutput, isError],
  );
  const bodyData = React.useMemo(
    () => bodyDataWithoutFooter(terminalData),
    [terminalData],
  );

  const argsSummary = bashInput.command !== undefined ? (
    // `truncated` gates the tooltip on actual clipping — the `<code>`
    // is the ellipsizing element, so `TugTooltip`'s scrollWidth vs
    // clientWidth check measures it directly. A command that fits
    // gets no (redundant) tooltip.
    <TugTooltip content={bashInput.command} side="bottom" truncated>
      <code data-slot="bash-tool-block-command">{bashInput.command}</code>
    </TugTooltip>
  ) : undefined;

  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <pre
        data-slot="bash-tool-block-error-output"
        className="bash-tool-block-error-output"
      >
        {textOutput}
      </pre>
    ) : undefined;

  // Whether the footer would surface anything visible. Exit-zero is
  // intentionally NOT a footer signal — a successful command without
  // output is the dominant case and "exit 0" reads as noise.
  // Failures (`exit N`), interrupts, the explicit "(no output)" hint,
  // and durations are the only fields the footer carries.
  const noBody =
    (terminalData.stdout?.length ?? 0) === 0 &&
    (terminalData.stderr?.length ?? 0) === 0 &&
    status !== "streaming";
  const showExitBadge =
    terminalData.exitCode !== undefined &&
    terminalData.exitCode !== 0 &&
    terminalData.interrupted !== true;
  const showInterrupted = terminalData.interrupted === true;
  const showNoOutputHint =
    noBody &&
    terminalData.exitCode === 0 &&
    terminalData.interrupted !== true;
  const showDuration = durationMs !== undefined;
  const hasFooterContent =
    showExitBadge || showInterrupted || showNoOutputHint || showDuration;
  const footerBadges = hasFooterContent ? (
    <BashFooterBadges
      exitCode={terminalData.exitCode}
      durationMs={durationMs}
      interrupted={showInterrupted}
      showNoOutputHint={showNoOutputHint}
    />
  ) : undefined;

  // Body selection. On error, the chrome's error band already shows
  // the failure message (from `textOutput`); rendering a TerminalBlock
  // fed by the same `textOutput` fallback would duplicate the same
  // text. So on error, only render the body when the structured
  // result carries genuinely-distinct stdout / stderr (a process that
  // wrote to its own streams before failing).
  //
  // Diff-routing: when the (already-composed) stdout looks like a
  // unified diff AND the parser yields at least one hunk, render
  // `DiffBlock` instead of `TerminalBlock`. Excluded for streaming
  // (incomplete output may include a stray `@@` marker mid-line) and
  // for the error-with-no-body branch (chrome already shows the
  // failure text). Memoize on the body's stdout so the parse runs
  // once per result, not on every parent re-render.
  const diffHunks = React.useMemo<DiffHunk[] | null>(() => {
    if (status === "streaming") return null;
    return tryParseBashDiff(bodyData.stdout);
  }, [bodyData.stdout, status]);

  const hasStructuredBody =
    (structured.stdout !== undefined && structured.stdout.length > 0) ||
    (structured.stderr !== undefined && structured.stderr.length > 0);
  let body: React.ReactNode;
  if (status === "streaming") {
    body = <StreamingPlaceholder />;
  } else if (status === "error" && !hasStructuredBody) {
    body = null;
  } else if (diffHunks !== null) {
    body = (
      <DiffBlock
        data={{ source: "hunks", hunks: diffHunks }}
        embedded
        className="bash-tool-block-diff"
        componentStatePreservationKey={`${toolUseId}-body`}
      />
    );
  } else {
    body = (
      <TerminalBlock
        data={bodyData}
        embedded
        className="bash-tool-block-terminal"
        componentStatePreservationKey={`${toolUseId}-body`}
      />
    );
  }

  return (
    <ToolWrapperChrome
      rootSlot="bash-tool-block"
      toolName={toolName}
      toolIcon={<Terminal size={14} aria-hidden="true" />}
      argsSummary={argsSummary}
      status={status}
      caution={caution}
      errorMessage={errorMessage}
      footerBadges={footerBadges}
    >
      {body}
    </ToolWrapperChrome>
  );
};

// ---------------------------------------------------------------------------
// Footer badges — bash-specific, painted from --tugx-term-* tokens
// the body kind already declares (no new --tugx-toolblock-bash-*
// vocabulary needed; the wrapper rides the body's color tokens).
// ---------------------------------------------------------------------------

interface BashFooterBadgesProps {
  exitCode?: number;
  durationMs?: number;
  interrupted: boolean;
  showNoOutputHint: boolean;
}

/**
 * Compose the footer badge row. Three signals can land here, in
 * priority order:
 *
 *   1. `interrupted` — user / system stopped the command mid-run.
 *      Wins over the exit code (the underlying process was killed,
 *      not exited).
 *   2. Non-zero `exitCode` — the command failed. Painted with the
 *      strong-red "nonzero" variant. `exit 0` is deliberately
 *      suppressed: a successful command's success is implicit and
 *      the badge reads as noise on every successful row.
 *   3. `(no output)` hint — the command succeeded with no stdout /
 *      stderr. Surfaced so the row doesn't read as "missing data"
 *      when the command had nothing to print (e.g. `cd /tmp`).
 *
 * `durationMs` is appended on the right when known.
 *
 * The caller (`BashToolBlock`) is expected to pass `undefined` for
 * `footerBadges` when none of these would render — that hides the
 * footer chrome entirely so successful runs with output don't paint
 * an empty bar.
 */
const BashFooterBadges: React.FC<BashFooterBadgesProps> = ({
  exitCode,
  durationMs,
  interrupted,
  showNoOutputHint,
}) => {
  const elements: React.ReactNode[] = [];
  if (interrupted) {
    elements.push(
      <span
        key="interrupted"
        data-slot="bash-tool-block-interrupted"
        className="bash-tool-block-interrupted"
      >
        interrupted
      </span>,
    );
  } else if (exitCode !== undefined && exitCode !== 0) {
    elements.push(
      <span
        key="exit"
        data-slot="bash-tool-block-exit"
        data-exit="nonzero"
        className="bash-tool-block-exit bash-tool-block-exit--nonzero"
      >
        {`exit ${exitCode}`}
      </span>,
    );
  }
  if (showNoOutputHint) {
    elements.push(
      <span
        key="no-output"
        data-slot="bash-tool-block-no-output"
        className="bash-tool-block-no-output"
      >
        (no output)
      </span>,
    );
  }
  if (durationMs !== undefined) {
    elements.push(
      <span
        key="duration"
        data-slot="bash-tool-block-duration"
        className="bash-tool-block-duration"
      >
        {formatBashDuration(durationMs)}
      </span>,
    );
  }
  if (elements.length === 0) return null;
  return <>{elements}</>;
};

/** Compact duration formatter — mirrors `TerminalBlock`'s
 *  `formatDuration` semantics but inlined here so the footer doesn't
 *  cross-import a sibling body's implementation detail. */
export function formatBashDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

