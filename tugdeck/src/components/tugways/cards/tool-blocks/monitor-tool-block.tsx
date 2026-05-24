/**
 * `MonitorToolBlock` — Layer-2 wrapper for the `Monitor` tool.
 *
 * `Monitor` runs a long-lived watch on a command and surfaces lines
 * as they appear (typical use: `tail -F`, `journalctl -f`, a CI
 * status loop). Volume is low (0.06% per the audit), and the
 * load-bearing UX is "what's being watched, and what's the recent
 * tail?" — not the full historical buffer. The wrapper renders a
 * compact head + tail and lets the user expand to see the full
 * output if they want.
 *
 * Composition (Spec S03, [#bk-conformance]):
 *  - `ToolBlockChrome` owns the frame: a `Radar` icon + the tool
 *    name `Monitor` + an args summary that names what's being
 *    watched, the status stripe, the inline `TideCautionBadge`
 *    (when the dispatch flagged drift), and the error band.
 *  - **Header — `Monitor · <command-excerpt>`** — the args summary
 *    is the command being monitored, truncated by the chrome's
 *    args slot when long, with a hover tooltip carrying the full
 *    string. When the input carries no recognisable command but
 *    has some other identifying field (a `path`, a `pid`), the
 *    helper falls back to that — see `composeMonitorHeader`.
 *  - **Body — `until` row + tailed output**:
 *      1. If `until` is present, render a small labeled row
 *         (`until: <condition>`) so the reader knows the
 *         watch's stop predicate at a glance.
 *      2. If output is present, render the last
 *         `TAIL_LINE_COUNT` lines as a `<pre>` block. When the
 *         total line count exceeds the tail, prepend a `<details>`
 *         summary `"show <N> earlier lines"` whose body is the
 *         full output — native HTML expand, no React state, no
 *         [L06] violation.
 *      3. If neither `until` nor output is present, the body is
 *         empty (the chrome's footer / error band carries any
 *         remaining signal).
 *
 * Streaming / error (Spec S03):
 *  - `status === "streaming"` → header shows whatever fragment has
 *    arrived; body is `<StreamingPlaceholder />`.
 *  - `status === "error"` → chrome paints the error band; body
 *    still renders the args / output it has (diagnostic context).
 *  - `status === "ready"` → header + body.
 *
 * Laws:
 *  - [L06] no React state for appearance. The `<details>` expand
 *    affordance is native-HTML; the wrapper never mounts a
 *    `useState` toggle. Status / error attributes ride the chrome's
 *    DOM attributes.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="monitor-tool-block"` (delegated via the chrome's
 *    `rootSlot`).
 *  - [L20] reuses the chrome's `--tugx-toolblock-*`; the wrapper's
 *    own slots are minimal layout (no new color tokens). The
 *    inline `<pre>` uses `--tug-font-family-mono` directly so it
 *    inherits the global mono font without introducing a wrapper
 *    token alias.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — the wrapper owns chrome; the body is
 *    minimal layout over primitives (`TugLabel`, native `<pre>` +
 *    `<details>`).
 *  - [D101] visibility policy — `monitor` moves from `default-intent`
 *    to bespoke once this wrapper ships; the policy entry is
 *    removed in the same change.
 *
 * @module components/tugways/cards/tool-blocks/monitor-tool-block
 */

import "./monitor-tool-block.css";

import React from "react";
import { Radar } from "lucide-react";

import { TugTooltip } from "@/components/tugways/tug-tooltip";

import {
  ToolBlockBody,
  ToolBlockDisclosure,
  ToolBlockFieldRow,
  ToolBlockPre,
} from "./body-bits";
import { StreamingPlaceholder, ToolBlockChrome } from "./tool-block-chrome";
import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowings — `Monitor`'s input varies by what's being
// watched. The wrapper supports a small union of recognised fields
// and degrades gracefully when the assistant passes something else.
// ---------------------------------------------------------------------------

/** `Monitor` tool input (from `tool_use.input`). */
export interface MonitorToolInput {
  /** Shell command being monitored. */
  command?: string;
  /** Filesystem path being watched (alternative to `command`). */
  path?: string;
  /** Process id being monitored (alternative to `command` / `path`). */
  pid?: number;
  /** Stop predicate — typically a regex or text fragment. */
  until?: string;
  /** Optional inactivity timeout in milliseconds. */
  timeout?: number;
}

/**
 * Narrow the wrapper-side `unknown` input to `MonitorToolInput`.
 * Defensive: returns `{}` for non-object inputs, drops mistyped
 * fields silently.
 */
export function narrowMonitorInput(value: unknown): MonitorToolInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    command: typeof v.command === "string" ? v.command : undefined,
    path: typeof v.path === "string" ? v.path : undefined,
    pid: typeof v.pid === "number" ? v.pid : undefined,
    until: typeof v.until === "string" ? v.until : undefined,
    timeout: typeof v.timeout === "number" ? v.timeout : undefined,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * How many trailing output lines the body shows by default. Chosen
 * to fit the "ambient watch" feel — three lines is enough to see
 * recent activity without dominating the transcript row, and
 * matches the typical screen tail size users keep open in a real
 * `tail -f` session.
 */
export const TAIL_LINE_COUNT = 3;

// ---------------------------------------------------------------------------
// Header composition
// ---------------------------------------------------------------------------

/**
 * Compose the args-summary text for the chrome's header slot.
 * Returns `undefined` when no identifying field is present (early
 * in streaming, or for a malformed input).
 *
 * Preference order: `command` > `path` > `pid` (most → least
 * specific). Exported for the gallery card and the tests, which
 * exercise it independently of the React render.
 */
export function composeMonitorHeader(
  input: MonitorToolInput,
): { label: string } | undefined {
  if (input.command !== undefined && input.command.length > 0) {
    return { label: input.command };
  }
  if (input.path !== undefined && input.path.length > 0) {
    return { label: input.path };
  }
  if (input.pid !== undefined) {
    return { label: `pid ${input.pid}` };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Tail composition
// ---------------------------------------------------------------------------

/**
 * Split `output` into the dropped-head prefix and the visible tail.
 * `dropped` is `0` when the whole output fits in the tail (no
 * `<details>` collapse needed). Trailing empty lines from a
 * newline-terminated buffer are preserved — they're load-bearing
 * for whitespace-significant output.
 *
 * Exported for tests.
 */
export interface MonitorTailComposition {
  head: string;
  tail: string;
  droppedLineCount: number;
}

export function composeMonitorTail(
  output: string | undefined,
  tailCount: number = TAIL_LINE_COUNT,
): MonitorTailComposition | null {
  if (output === undefined || output.length === 0) return null;
  const lines = output.split("\n");
  // A trailing newline produces an empty final element; we don't
  // count that as a "line" for the dropped/tail split because the
  // user thinks of it as terminator, not content.
  const effectiveLines =
    lines.length > 0 && lines[lines.length - 1] === ""
      ? lines.slice(0, -1)
      : lines;
  if (effectiveLines.length <= tailCount) {
    return {
      head: "",
      tail: output,
      droppedLineCount: 0,
    };
  }
  const dropCount = effectiveLines.length - tailCount;
  const head = effectiveLines.slice(0, dropCount).join("\n");
  const tail = effectiveLines.slice(dropCount).join("\n");
  return {
    head,
    tail,
    droppedLineCount: dropCount,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MonitorToolBlock: React.FC<ToolBlockProps> = ({
  toolName,
  input,
  textOutput,
  status,
  caution,
}) => {
  const monitorInput = React.useMemo(() => narrowMonitorInput(input), [input]);
  const header = composeMonitorHeader(monitorInput);

  const argsSummary = header !== undefined ? (
    <TugTooltip content={header.label} side="bottom" truncated>
      <code data-slot="monitor-tool-block-target">{header.label}</code>
    </TugTooltip>
  ) : undefined;

  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <ToolBlockPre>{textOutput}</ToolBlockPre>
    ) : undefined;

  const tail = React.useMemo(
    () => composeMonitorTail(textOutput),
    [textOutput],
  );

  // Body composition. Streaming gets the shared placeholder; otherwise
  // stack: until row (if present) + output (if present).
  let body: React.ReactNode;
  if (status === "streaming") {
    body = <StreamingPlaceholder />;
  } else {
    const hasUntil =
      monitorInput.until !== undefined && monitorInput.until.length > 0;
    const hasTail = tail !== null;
    if (!hasUntil && !hasTail) {
      body = null;
    } else {
      const tailComp = tail as MonitorTailComposition | null;
      body = (
        <ToolBlockBody>
          {hasUntil ? (
            <ToolBlockFieldRow label="until">
              <code>{monitorInput.until}</code>
            </ToolBlockFieldRow>
          ) : null}
          {tailComp !== null ? (
            <div
              className="monitor-tool-block-output"
              data-slot="monitor-tool-block-output"
            >
              {tailComp.droppedLineCount > 0 ? (
                <ToolBlockDisclosure
                  summary={`show ${tailComp.droppedLineCount} earlier ${
                    tailComp.droppedLineCount === 1 ? "line" : "lines"
                  }`}
                >
                  <ToolBlockPre>{tailComp.head}</ToolBlockPre>
                </ToolBlockDisclosure>
              ) : null}
              <ToolBlockPre>{tailComp.tail}</ToolBlockPre>
            </div>
          ) : null}
        </ToolBlockBody>
      );
    }
  }

  return (
    <ToolBlockChrome
      rootSlot="monitor-tool-block"
      toolName={toolName}
      toolIcon={<Radar size={14} aria-hidden="true" />}
      argsSummary={argsSummary}
      status={status}
      caution={caution}
      errorMessage={errorMessage}
    >
      {body}
    </ToolBlockChrome>
  );
};
