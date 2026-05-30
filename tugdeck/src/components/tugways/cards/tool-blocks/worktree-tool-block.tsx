/**
 * `WorktreeToolBlock` — Layer-2 wrapper for the `EnterWorktree` and
 * `ExitWorktree` tools.
 *
 * Both tools are user-initiated git-worktree management actions, each
 * vanishingly rare in practice (0.00% volume per the audit). Volume
 * is low, but the action itself is user-meaningful — "the assistant
 * entered worktree X" is a context switch the user wants to see
 * acknowledged in the transcript, not lost behind a JsonTree
 * fallback. One wrapper handles both via the existing dispatch alias
 * machinery: both `enterworktree` and `exitworktree` resolve through
 * `TOOL_ALIASES` to the canonical `worktree` registry name.
 *
 * Composition (Spec S03, [#bk-conformance]):
 *  - `ToolBlockChrome` owns the frame: a `GitBranch` icon + a
 *    composed tool-name string (`Worktree · enter` / `Worktree ·
 *    exit`), the status stripe, the inline `DevCautionBadge` (when
 *    the dispatch flagged drift), and the error band.
 *  - **Header — `Worktree · enter <branch>` / `Worktree · exit
 *    <branch>`** — the verb (`enter` / `exit`) is derived from the
 *    incoming `toolName`; the branch / path comes from the input.
 *    The chrome's `toolName` slot carries the verb-qualified name
 *    so the row reads as a single unit ("Worktree · enter feature/x")
 *    rather than as a generic "Worktree" header with the verb
 *    buried in the args.
 *  - **Body — worktree path label** — a single labeled row showing
 *    the worktree's filesystem path (`path:` / `<path>`). When the
 *    input carries only a `branch` and no path, the row shows the
 *    branch instead. Action-rather-than-data tool: no result body
 *    unless the call errored, in which case the chrome's error band
 *    carries the failure text.
 *
 * Streaming / error (Spec S03):
 *  - `status === "streaming"` → header shows the verb (always known
 *    from `toolName`) with whatever input fragment has arrived;
 *    body is `<StreamingPlaceholder />`.
 *  - `status === "error"` → chrome paints the error band from
 *    `textOutput`; body still renders the path / branch row
 *    (diagnostic context: "this enter failed against branch X").
 *  - `status === "ready"` → header + body row.
 *
 * Laws:
 *  - [L06] no React state for appearance — every render branch is
 *    a pure derivation from props.
 *  - [L19] `data-slot="worktree-tool-block"` (delegated via the
 *    chrome's `rootSlot`). No paired `.css` file: after the
 *    body-bits refactor this wrapper has zero wrapper-local styles —
 *    every visible rule lives in `tool-block-chrome.css` (the
 *    frame) or `body-bits/*.css` (the body shape). The file pair
 *    convention is "pair when you own styles"; this wrapper owns
 *    none.
 *  - [L20] reuses the chrome's `--tugx-toolblock-*` and the
 *    body-bits' shared layout values; introduces no new tokens.
 *
 * Decisions:
 *  - [D05] two-layer hybrid — the wrapper owns chrome; the body is
 *    minimal layout over `TugLabel` + an inline `<code>`.
 *  - [D16] tool-name aliasing — `enterworktree` and `exitworktree`
 *    resolve through `TOOL_ALIASES` to the canonical `worktree`
 *    name; the wrapper branches on `toolName` to pick the verb.
 *  - [D101] visibility policy — `enterworktree` / `exitworktree`
 *    move from `default-intent` to bespoke once this wrapper ships;
 *    both policy entries are removed in the same change.
 *
 * @module components/tugways/cards/tool-blocks/worktree-tool-block
 */

import React from "react";
import { GitBranch } from "lucide-react";

import { TugTooltip } from "@/components/tugways/tug-tooltip";

import { ToolBlockBody, ToolBlockFieldRow } from "./body-bits";
import { ToolBlockChrome } from "./tool-block-chrome";
import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowings — `EnterWorktree` / `ExitWorktree` inputs vary in
// shape (a branch, a path, a worktree id). The wrapper supports a small
// union and falls back gracefully when no recognised field is present.
// ---------------------------------------------------------------------------

/** Worktree tool input (from `tool_use.input`). */
export interface WorktreeToolInput {
  /** Branch the worktree is attached to. */
  branch?: string;
  /** Filesystem path of the worktree. */
  path?: string;
  /** Worktree identifier (some implementations use a server-assigned id). */
  worktreeId?: string;
}

/**
 * Narrow the wrapper-side `unknown` input to `WorktreeToolInput`.
 * Defensive: returns `{}` for non-object inputs, drops mistyped
 * fields silently.
 */
export function narrowWorktreeInput(value: unknown): WorktreeToolInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    branch: typeof v.branch === "string" ? v.branch : undefined,
    path: typeof v.path === "string" ? v.path : undefined,
    worktreeId:
      typeof v.worktreeId === "string" ? v.worktreeId : undefined,
  };
}

// ---------------------------------------------------------------------------
// Verb derivation
// ---------------------------------------------------------------------------

/**
 * Worktree action verb — `enter` or `exit`. Returned by
 * `deriveWorktreeVerb` from the original `toolName` and used to
 * compose both the header label and the body's identifier row.
 */
export type WorktreeVerb = "enter" | "exit";

/**
 * Pick the action verb from the original tool name. Returns `null`
 * when the tool name is neither variant (defensive — keeps the
 * wrapper from crashing on an unexpected alias). Case-insensitive
 * because the wire name's casing has varied across capabilities
 * versions (`EnterWorktree` / `enter_worktree` / `enterworktree`).
 *
 * Exported for the gallery card and the tests.
 */
export function deriveWorktreeVerb(toolName: string): WorktreeVerb | null {
  const lower = toolName.toLowerCase();
  if (lower.startsWith("enter")) return "enter";
  if (lower.startsWith("exit")) return "exit";
  return null;
}

// ---------------------------------------------------------------------------
// Header composition
// ---------------------------------------------------------------------------

/**
 * Compose the args-summary text for the chrome's header slot. Returns
 * `undefined` when the input carries no recognisable identifier yet
 * (early in streaming).
 *
 * Preference order: `branch` > `path` > `worktreeId`. Exported for
 * the gallery card and the tests.
 */
export function composeWorktreeHeader(
  input: WorktreeToolInput,
): { label: string } | undefined {
  if (input.branch !== undefined && input.branch.length > 0) {
    return { label: input.branch };
  }
  if (input.path !== undefined && input.path.length > 0) {
    return { label: input.path };
  }
  if (input.worktreeId !== undefined && input.worktreeId.length > 0) {
    return { label: input.worktreeId };
  }
  return undefined;
}

/**
 * Compose the chrome's `toolName` string — the header reads as
 * `Worktree · enter` / `Worktree · exit` (the args slot then carries
 * the branch / path). Done here, not in the chrome, because the
 * verb is wrapper-specific knowledge.
 */
export function composeWorktreeToolName(verb: WorktreeVerb | null): string {
  if (verb === null) return "Worktree";
  return `Worktree · ${verb}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const WorktreeToolBlock: React.FC<ToolBlockProps> = ({
  toolUseId,
  toolName,
  input,
  textOutput,
  status,
  phase,
  caution,
}) => {
  const worktreeInput = React.useMemo(
    () => narrowWorktreeInput(input),
    [input],
  );
  const verb = deriveWorktreeVerb(toolName);
  const composedToolName = composeWorktreeToolName(verb);
  const header = composeWorktreeHeader(worktreeInput);

  const argsSummary = header !== undefined ? (
    <TugTooltip content={header.label} side="bottom" truncated>
      <code data-slot="worktree-tool-block-target">{header.label}</code>
    </TugTooltip>
  ) : undefined;

  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <span data-slot="worktree-tool-block-error-output">{textOutput}</span>
    ) : undefined;

  // Body — single labeled row showing the path (preferred) or
  // branch / id fallback. Suppressed when the chrome's args slot
  // already shows the same value (avoid duplicating the identifier
  // both in the header and the body for the common single-field
  // case).
  let body: React.ReactNode;
  if (status === "streaming") {
    body = null;
  } else {
    const hasPath =
      worktreeInput.path !== undefined && worktreeInput.path.length > 0;
    const hasBranch =
      worktreeInput.branch !== undefined && worktreeInput.branch.length > 0;
    // Only show the body row when there's *additional* identifier
    // information beyond what the header already carries. If the
    // header is `branch`, body shows `path` (when present). If the
    // header is `path` (no branch), body shows nothing — the header
    // already carries everything the wire told us.
    const bodyField =
      hasBranch && hasPath
        ? { label: "path", value: worktreeInput.path as string }
        : null;
    if (bodyField === null) {
      body = null;
    } else {
      body = (
        <ToolBlockBody>
          <ToolBlockFieldRow label={bodyField.label}>
            <code>{bodyField.value}</code>
          </ToolBlockFieldRow>
        </ToolBlockBody>
      );
    }
  }

  // Fold + copy affordances. Default OPEN; worktree bodies are tiny
  // (often a single path row or nothing) but the consistency win
  // across the body-bits wrappers is worth the affordance even on a
  // small body. Fold is suppressed when there is no body.
  const hasBody = body !== null;
  const fold = hasBody && status !== "streaming"
    ? {
        defaultFolded: false,
        preservationKey: `worktree-tool-block/${toolUseId}/fold`,
        collapsedLabel: "details",
      }
    : undefined;
  const copyText =
    textOutput !== undefined && textOutput.length > 0 ? textOutput : undefined;

  return (
    <ToolBlockChrome
      rootSlot="worktree-tool-block"
      toolName={composedToolName}
      argsSummary={argsSummary}
      status={status}
      phase={phase}
      caution={caution}
      errorMessage={errorMessage}
      fold={fold}
      copyText={copyText}
    >
      {body}
    </ToolBlockChrome>
  );
};
