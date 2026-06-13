/**
 * `CronToolBlock` — Layer-2 wrapper for the three Cron family tools:
 * `CronCreate`, `CronDelete`, `CronList`.
 *
 * All three are session-scoped scheduling primitives — the assistant
 * arranging for a prompt to fire later, removing one of those
 * arrangements, or enumerating them. Volume is low (no captured
 * audit baseline at v2.1.148; this is part of the inventory's
 * "previously unknown-tool drift" set). One wrapper handling all
 * three verbs is the right granularity — the shapes are small and
 * the readers (header, schedule expression, id, count) overlap.
 *
 * The four wire names resolve through dispatch `TOOL_ALIASES` to the
 * canonical `cron` registry name (`croncreate` / `crondelete` /
 * `cronlist` → `cron`); the wrapper branches on the original
 * `toolName` to pick the verb and the body shape. Matches the
 * single-canonical pattern Worktree and TaskMgmt use.
 *
 * Composition (Spec S03, [#bk-conformance]):
 *  - `ToolBlockChrome` owns the frame: a `Clock` icon + a
 *    composed tool-name string (`Cron · create` / `Cron · delete` /
 *    `Cron · list`), the status stripe, the inline `DevCautionBadge`
 *    (when the dispatch flagged drift), and the error band.
 *  - **Header** — verb-qualified name above; the chrome's args slot
 *    carries the most-identifying field for each verb (note that
 *    cron-expression examples in the rest of this docstring use the
 *    `0 9` form to avoid putting `*` `/` adjacent inside the JSDoc
 *    comment, which would terminate it):
 *      - `create` → the cron expression (`0 9 * * *`).
 *      - `delete` → `#<id>`.
 *      - `list`   → nothing in the args slot (the count is in the
 *        result, not the input; revealing it would require
 *        result parsing that doesn't pay off — the body shows the
 *        list).
 *  - **Body — per-verb branch** (each composes `body-bits/`
 *    primitives per conformance item 10):
 *      - `create` → `cron:` / `prompt:` / optional `recurring:` /
 *        `durable:` rows + result (the returned job id).
 *      - `delete` → `id:` row + result (the confirmation status).
 *      - `list`   → result rendered as a tailed `<pre>` (the list
 *        body is whatever shape the runtime returns — typically a
 *        small text block).
 *  - **Chrome-level fold + copy** — default OPEN (the result IS the
 *    user's answer for create / delete / list — folded by default
 *    would hide the answer). Copy collects the result text.
 *
 * Streaming / error (Spec S03):
 *  - `status === "streaming"` → body is `<StreamingPlaceholder />`.
 *  - `status === "error"` → chrome paints the error band; body
 *    still renders the input rows (diagnostic context).
 *  - `status === "ready"` → header + per-verb body.
 *
 * Laws:
 *  - [L06] no React state for appearance — every render branch is
 *    a pure derivation from props.
 *  - [L19] `data-slot="cron-tool-block"` (delegated via the
 *    chrome's `rootSlot`). No paired `.css` file: like Worktree
 *    and TaskMgmt, this wrapper composes purely from `body-bits/`
 *    and owns no wrapper-local styles.
 *  - [L20] reuses the chrome's `--tugx-toolblock-*` and the
 *    body-bits' shared layout values; introduces no new tokens.
 *
 * Decisions:
 *  - [D05] two-layer hybrid.
 *  - [D16] tool-name aliasing — all three wire names resolve
 *    through `TOOL_ALIASES` to canonical `cron`.
 *  - [D101] visibility policy — `croncreate` / `crondelete` /
 *    `cronlist` move from `default-intent` to bespoke once this
 *    wrapper ships; all three policy entries are removed in the
 *    same change.
 *
 * @module components/tugways/cards/tool-blocks/cron-tool-block
 */

import React from "react";

import { TugTooltip } from "@/components/tugways/tug-tooltip";

import {
  ToolBlockBody,
  ToolBlockFieldRow,
  ToolBlockPre,
} from "./body-bits";
import { ToolBlockChrome } from "./tool-block-chrome";
import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowing
// ---------------------------------------------------------------------------

/**
 * Union narrowing for the three Cron tool inputs:
 *  - `CronCreate` — `{ cron, prompt, durable?, recurring? }`.
 *  - `CronDelete` — `{ id }`.
 *  - `CronList`   — `{}` (no input).
 *
 * The wrapper only needs to read recognised fields; the wire shape
 * for a verb that doesn't carry one leaves the corresponding field
 * `undefined`.
 */
export interface CronToolInput {
  /** Standard 5-field cron expression (CronCreate). */
  cron?: string;
  /** Prompt to enqueue at fire time (CronCreate). */
  prompt?: string;
  /** Persist to disk + survive restarts (CronCreate). */
  durable?: boolean;
  /** Fire repeatedly until delete / 7-day auto-expire (CronCreate). */
  recurring?: boolean;
  /** Job identifier (CronDelete). */
  id?: string;
}

/**
 * Narrow the wrapper-side `unknown` input to `CronToolInput`.
 * Defensive: returns `{}` for non-object inputs, drops mistyped
 * fields silently.
 */
export function narrowCronInput(value: unknown): CronToolInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    cron: typeof v.cron === "string" ? v.cron : undefined,
    prompt: typeof v.prompt === "string" ? v.prompt : undefined,
    durable: typeof v.durable === "boolean" ? v.durable : undefined,
    recurring: typeof v.recurring === "boolean" ? v.recurring : undefined,
    id: typeof v.id === "string" ? v.id : undefined,
  };
}

// ---------------------------------------------------------------------------
// Verb derivation
// ---------------------------------------------------------------------------

/** Cron action verb — one of `create`, `delete`, `list`. */
export type CronVerb = "create" | "delete" | "list";

/**
 * Pick the verb from the original tool name. Returns `null` when the
 * name is none of the three. Case-insensitive and tolerant of
 * separators (the wire name's casing has historically varied —
 * `CronCreate` / `cron_create` / `croncreate`).
 *
 * Exported for the gallery card and the tests.
 */
export function deriveCronVerb(toolName: string): CronVerb | null {
  const normalised = toolName.toLowerCase().replace(/[_-]/g, "");
  if (normalised === "croncreate") return "create";
  if (normalised === "crondelete") return "delete";
  if (normalised === "cronlist") return "list";
  return null;
}

// ---------------------------------------------------------------------------
// Header composition
// ---------------------------------------------------------------------------

/**
 * Compose the chrome's `toolName` string — `Cron · create` /
 * `Cron · delete` / `Cron · list`. Wrapper-specific knowledge (the
 * `Cron ·` prefix + the verb) lives here, not in the chrome.
 */
export function composeCronToolName(verb: CronVerb | null): string {
  if (verb === null) return "Cron";
  return `Cron · ${verb}`;
}

/**
 * Compose the chrome's args-summary label — the most-identifying
 * field for each verb. Returns `undefined` when there is nothing
 * useful to show in the header yet (early in streaming, or for
 * `list` whose count lives in the result).
 *
 * Verb-specific:
 *  - `create` → the cron expression (most-load-bearing).
 *  - `delete` → `#<id>`.
 *  - `list`   → undefined (the count would require parsing the
 *    result; the body carries the list).
 *
 * Exported for the gallery card and the tests.
 */
export function composeCronArgsLabel(
  verb: CronVerb | null,
  input: CronToolInput,
): { label: string } | undefined {
  if (verb === "create") {
    if (input.cron !== undefined && input.cron.length > 0) {
      return { label: input.cron };
    }
    return undefined;
  }
  if (verb === "delete") {
    if (input.id !== undefined && input.id.length > 0) {
      return { label: `#${input.id}` };
    }
    return undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CronToolBlock: React.FC<ToolBlockProps> = ({
  toolName,
  input,
  textOutput,
  status,
  phase,
  caution,
}) => {
  const cronInput = React.useMemo(() => narrowCronInput(input), [input]);
  const verb = deriveCronVerb(toolName);
  const composedToolName = composeCronToolName(verb);
  const argsLabel = composeCronArgsLabel(verb, cronInput);

  const argsSummary = argsLabel !== undefined ? (
    <TugTooltip content={argsLabel.label} side="bottom" truncated>
      <code data-slot="cron-tool-block-target">{argsLabel.label}</code>
    </TugTooltip>
  ) : undefined;

  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <ToolBlockPre>{textOutput}</ToolBlockPre>
    ) : undefined;

  let body: React.ReactNode;
  if (status === "streaming") {
    body = null;
  } else {
    body = renderCronBody({ verb, input: cronInput, textOutput });
  }

  // Default-open fold (result IS the user's answer) + copy of result
  // text. Same pattern as Skill / Monitor / Worktree.
  const copyText =
    textOutput !== undefined && textOutput.length > 0 ? textOutput : undefined;

  return (
    <ToolBlockChrome
      rootSlot="cron-tool-block"
      toolName={composedToolName}
      argsSummary={argsSummary}
      status={status}
      phase={phase}
      caution={caution}
      errorMessage={errorMessage}
      copyText={copyText}
    >
      {body}
    </ToolBlockChrome>
  );
};

// ---------------------------------------------------------------------------
// Per-verb body rendering
// ---------------------------------------------------------------------------

interface RenderBodyArgs {
  verb: CronVerb | null;
  input: CronToolInput;
  textOutput: string | undefined;
}

function renderCronBody({
  verb,
  input,
  textOutput,
}: RenderBodyArgs): React.ReactNode {
  if (verb === null) return null;
  switch (verb) {
    case "create":
      return renderCreateBody(input, textOutput);
    case "delete":
      return renderDeleteBody(input, textOutput);
    case "list":
      return renderListBody(textOutput);
  }
}

function renderCreateBody(
  input: CronToolInput,
  textOutput: string | undefined,
): React.ReactNode {
  const hasCron = input.cron !== undefined && input.cron.length > 0;
  const hasPrompt = input.prompt !== undefined && input.prompt.length > 0;
  const hasRecurring = input.recurring !== undefined;
  const hasDurable = input.durable !== undefined;
  const hasResult = textOutput !== undefined && textOutput.length > 0;
  if (!hasCron && !hasPrompt && !hasRecurring && !hasDurable && !hasResult) {
    return null;
  }
  return (
    <ToolBlockBody>
      {hasCron ? (
        <ToolBlockFieldRow label="cron">
          <code>{input.cron}</code>
        </ToolBlockFieldRow>
      ) : null}
      {hasPrompt ? (
        <ToolBlockFieldRow label="prompt" layout="stacked">
          <ToolBlockPre>{input.prompt}</ToolBlockPre>
        </ToolBlockFieldRow>
      ) : null}
      {hasRecurring ? (
        <ToolBlockFieldRow label="recurring">
          <code>{String(input.recurring)}</code>
        </ToolBlockFieldRow>
      ) : null}
      {hasDurable ? (
        <ToolBlockFieldRow label="durable">
          <code>{String(input.durable)}</code>
        </ToolBlockFieldRow>
      ) : null}
      {hasResult ? (
        <ToolBlockFieldRow label="result" layout="stacked">
          <ToolBlockPre>{textOutput}</ToolBlockPre>
        </ToolBlockFieldRow>
      ) : null}
    </ToolBlockBody>
  );
}

function renderDeleteBody(
  input: CronToolInput,
  textOutput: string | undefined,
): React.ReactNode {
  const hasId = input.id !== undefined && input.id.length > 0;
  const trimmedResult =
    textOutput !== undefined ? textOutput.trim() : undefined;
  const hasShortStatus =
    trimmedResult !== undefined &&
    trimmedResult.length > 0 &&
    !trimmedResult.includes("\n");
  const hasMultilineResult =
    trimmedResult !== undefined &&
    trimmedResult.length > 0 &&
    trimmedResult.includes("\n");
  if (!hasId && !hasShortStatus && !hasMultilineResult) return null;
  return (
    <ToolBlockBody>
      {hasId ? (
        <ToolBlockFieldRow label="id">
          <code>{`#${input.id}`}</code>
        </ToolBlockFieldRow>
      ) : null}
      {hasShortStatus ? (
        <ToolBlockFieldRow label="status">
          <code>{trimmedResult}</code>
        </ToolBlockFieldRow>
      ) : null}
      {hasMultilineResult ? (
        <ToolBlockFieldRow label="status" layout="stacked">
          <ToolBlockPre>{textOutput}</ToolBlockPre>
        </ToolBlockFieldRow>
      ) : null}
    </ToolBlockBody>
  );
}

function renderListBody(textOutput: string | undefined): React.ReactNode {
  const hasResult = textOutput !== undefined && textOutput.length > 0;
  if (!hasResult) return null;
  return (
    <ToolBlockBody>
      <ToolBlockPre>{textOutput}</ToolBlockPre>
    </ToolBlockBody>
  );
}
