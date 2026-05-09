/**
 * `BashToolBlock` — Layer-2 wrapper for the Bash tool.
 *
 * Composes `ToolWrapperChrome` (header / footer / status) around a
 * `TerminalBlock` body. Per [Spec S03] / [Table T02]:
 *
 *   - **Header:** terminal icon + tool name "Bash" + the shell
 *     command pulled from `input.command` (truncated with hover-
 *     expand via CSS — no JS state).
 *   - **Body:** `TerminalBlock` fed from
 *     `tool_use_structured.{stdout,stderr}` when present, otherwise
 *     falling back to the plain-text `tool_result.output`.
 *   - **Footer badges:** synthesized exit code (zero subtle / nonzero
 *     strong) + `interrupted` indicator when the tool result
 *     reports it.
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
// Component
// ---------------------------------------------------------------------------

export const BashToolBlock: React.FC<ToolWrapperProps> = ({
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
    <code data-slot="bash-tool-block-command">{bashInput.command}</code>
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

  const footerBadges = (
    <BashFooterBadges
      exitCode={terminalData.exitCode}
      durationMs={durationMs}
      interrupted={terminalData.interrupted === true}
      noBody={
        (terminalData.stdout?.length ?? 0) === 0 &&
        (terminalData.stderr?.length ?? 0) === 0 &&
        status !== "streaming"
      }
    />
  );

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
      {status === "streaming" ? (
        <StreamingPlaceholder />
      ) : (
        <TerminalBlock data={bodyData} className="bash-tool-block-terminal" />
      )}
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
  noBody: boolean;
}

const BashFooterBadges: React.FC<BashFooterBadgesProps> = ({
  exitCode,
  durationMs,
  interrupted,
  noBody,
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
  } else if (exitCode !== undefined) {
    const isZero = exitCode === 0;
    elements.push(
      <span
        key="exit"
        data-slot="bash-tool-block-exit"
        data-exit={isZero ? "zero" : "nonzero"}
        className={`bash-tool-block-exit bash-tool-block-exit--${isZero ? "zero" : "nonzero"}`}
      >
        {`exit ${exitCode}`}
      </span>,
    );
  }
  if (noBody && exitCode === 0 && !interrupted) {
    // Bash succeeded with no output — surface a "(no output)" hint
    // so the row doesn't read as missing data.
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

