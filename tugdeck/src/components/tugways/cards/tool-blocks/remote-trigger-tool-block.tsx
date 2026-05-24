/**
 * `RemoteTriggerToolBlock` — Layer-2 wrapper for the `RemoteTrigger`
 * tool.
 *
 * `RemoteTrigger` is the in-process call to claude.ai's
 * remote-trigger API — the assistant managing routines that run on
 * claude.ai's side (separate from the local Claude Code session).
 * Five actions: `list` / `get` / `create` / `update` / `run`. The
 * result is raw JSON from the API; for `create` / `update` a summary
 * line carrying the server-parsed run time + the routine's
 * claude.ai URL is appended.
 *
 * Spike-resolution note. The plan flagged this as needing a build-
 * time spike since no captured JSONL transcript exercises the tool
 * and no system-metadata schema for it had been seen. The deferred-
 * tool schema (`ToolSearch select:RemoteTrigger`) resolved the spike:
 * the input shape is `{ action, trigger_id?, body? }`, the five
 * actions are enumerated, and the result is API JSON with a
 * summary tail for write actions. No further build-time discovery
 * is needed — the wrapper renders defensively over this shape and
 * degrades gracefully on a field that arrives in a different shape
 * than expected.
 *
 * Composition (Spec S03, [#bk-conformance]):
 *  - `ToolBlockChrome` owns the frame: a `Zap` icon + the composed
 *    tool-name (`Remote Trigger · <action>`), the status stripe,
 *    the inline `TideCautionBadge` (when the dispatch flagged
 *    drift), and the error band.
 *  - **Header** — verb-qualified tool name (`Remote Trigger ·
 *    create` etc.); the args slot carries `#<trigger_id>` when an
 *    id is present (every action except `list` / `create` may take
 *    one; `list` never does, `create` typically doesn't).
 *  - **Body** — `action:` field row + `trigger_id:` row when
 *    present + `body:` row (stacked, JSON-formatted) when present
 *    + tailed result via `ToolBlockPre`.
 *  - **Chrome-level fold + copy** — default OPEN (the API JSON +
 *    summary line IS the user's answer). Copy collects the result.
 *
 * Streaming / error (Spec S03):
 *  - `status === "streaming"` → body is `<StreamingPlaceholder />`.
 *  - `status === "error"` → chrome paints the error band; body
 *    still renders the input rows.
 *  - `status === "ready"` → header + body.
 *
 * Laws:
 *  - [L06] no React state for appearance.
 *  - [L19] `data-slot="remote-trigger-tool-block"`. No paired
 *    `.css` file: composes purely from `body-bits/`.
 *  - [L20] reuses the chrome's `--tugx-toolblock-*` and the
 *    body-bits' shared layout values; introduces no new tokens.
 *
 * Decisions:
 *  - [D05] two-layer hybrid.
 *  - [D101] visibility policy — `remotetrigger` moves from
 *    `default-intent` to bespoke once this wrapper ships.
 *
 * @module components/tugways/cards/tool-blocks/remote-trigger-tool-block
 */

import React from "react";
import { Zap } from "lucide-react";

import { TugTooltip } from "@/components/tugways/tug-tooltip";

import {
  ToolBlockBody,
  ToolBlockFieldRow,
  ToolBlockPre,
} from "./body-bits";
import { StreamingPlaceholder, ToolBlockChrome } from "./tool-block-chrome";
import type { ToolBlockProps } from "./types";

// ---------------------------------------------------------------------------
// Wire-shape narrowing
// ---------------------------------------------------------------------------

/** `RemoteTrigger` action verb — one of the five enumerated actions. */
export type RemoteTriggerAction =
  | "list"
  | "get"
  | "create"
  | "update"
  | "run";

const KNOWN_ACTIONS: ReadonlySet<string> = new Set([
  "list",
  "get",
  "create",
  "update",
  "run",
]);

/** `RemoteTrigger` tool input (from `tool_use.input`). */
export interface RemoteTriggerInput {
  /** Action — `list` / `get` / `create` / `update` / `run`. */
  action?: RemoteTriggerAction;
  /** Trigger identifier (required for `get`/`update`/`run`). */
  trigger_id?: string;
  /** Request body (required for `create`/`update`; optional for `run`). */
  body?: Record<string, unknown>;
}

/**
 * Narrow the wrapper-side `unknown` input to `RemoteTriggerInput`.
 * Defensive: returns `{}` for non-object inputs, drops mistyped
 * fields silently, drops an unrecognised action silently (so the
 * header reads neutrally rather than claiming an action the runtime
 * might not support).
 */
export function narrowRemoteTriggerInput(value: unknown): RemoteTriggerInput {
  if (value === null || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const rawAction = typeof v.action === "string" ? v.action : undefined;
  // Body is an arbitrary object — accept any non-null object,
  // including empty.
  const bodyRaw = v.body;
  const body =
    bodyRaw !== null &&
    typeof bodyRaw === "object" &&
    !Array.isArray(bodyRaw)
      ? (bodyRaw as Record<string, unknown>)
      : undefined;
  return {
    action:
      rawAction !== undefined && KNOWN_ACTIONS.has(rawAction)
        ? (rawAction as RemoteTriggerAction)
        : undefined,
    trigger_id:
      typeof v.trigger_id === "string" && v.trigger_id.length > 0
        ? v.trigger_id
        : undefined,
    body,
  };
}

// ---------------------------------------------------------------------------
// Header composition
// ---------------------------------------------------------------------------

/**
 * Compose the chrome's `toolName` string — `Remote Trigger ·
 * <action>` when an action is present, `Remote Trigger` standalone
 * otherwise. The prefix carries identity; the action is the verb.
 */
export function composeRemoteTriggerToolName(
  action: RemoteTriggerAction | undefined,
): string {
  if (action === undefined) return "Remote Trigger";
  return `Remote Trigger · ${action}`;
}

/**
 * Compose the chrome's args-summary label — the `#<trigger_id>`
 * fragment when an id is present. Returns `undefined` when there is
 * no id (the `list` action, or `create` without an explicit id).
 */
export function composeRemoteTriggerArgsLabel(
  input: RemoteTriggerInput,
): { label: string } | undefined {
  if (input.trigger_id === undefined) return undefined;
  return { label: `#${input.trigger_id}` };
}

// ---------------------------------------------------------------------------
// Body formatting — JSON pretty-print for the `body` row
// ---------------------------------------------------------------------------

/**
 * Format an arbitrary `body` object for display in the
 * stacked `body:` row. Uses two-space indentation; falls back to
 * `String(value)` if `JSON.stringify` throws (cyclic graph, exotic
 * value). Exported for tests.
 */
export function formatRemoteTriggerBody(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const RemoteTriggerToolBlock: React.FC<ToolBlockProps> = ({
  toolUseId,
  input,
  textOutput,
  status,
  caution,
}) => {
  const triggerInput = React.useMemo(
    () => narrowRemoteTriggerInput(input),
    [input],
  );
  const composedToolName = composeRemoteTriggerToolName(triggerInput.action);
  const argsLabel = composeRemoteTriggerArgsLabel(triggerInput);

  const argsSummary = argsLabel !== undefined ? (
    <TugTooltip content={argsLabel.label} side="bottom" truncated>
      <code data-slot="remote-trigger-tool-block-target">{argsLabel.label}</code>
    </TugTooltip>
  ) : undefined;

  const errorMessage =
    status === "error" && textOutput !== undefined && textOutput.length > 0 ? (
      <ToolBlockPre>{textOutput}</ToolBlockPre>
    ) : undefined;

  let body: React.ReactNode;
  if (status === "streaming") {
    body = <StreamingPlaceholder />;
  } else {
    body = renderRemoteTriggerBody({ input: triggerInput, textOutput });
  }

  const hasBody = body !== null;
  const fold = hasBody && status !== "streaming"
    ? {
        defaultFolded: false,
        preservationKey: `remote-trigger-tool-block/${toolUseId}/fold`,
        collapsedLabel: "details",
      }
    : undefined;
  const copyText =
    textOutput !== undefined && textOutput.length > 0 ? textOutput : undefined;

  return (
    <ToolBlockChrome
      rootSlot="remote-trigger-tool-block"
      toolName={composedToolName}
      toolIcon={<Zap size={14} aria-hidden="true" />}
      argsSummary={argsSummary}
      status={status}
      caution={caution}
      errorMessage={errorMessage}
      fold={fold}
      copyText={copyText}
    >
      {body}
    </ToolBlockChrome>
  );
};

interface RenderBodyArgs {
  input: RemoteTriggerInput;
  textOutput: string | undefined;
}

function renderRemoteTriggerBody({
  input,
  textOutput,
}: RenderBodyArgs): React.ReactNode {
  const hasAction = input.action !== undefined;
  const hasBody = input.body !== undefined;
  const hasResult = textOutput !== undefined && textOutput.length > 0;
  if (!hasAction && !hasBody && !hasResult) return null;
  return (
    <ToolBlockBody>
      {hasAction ? (
        <ToolBlockFieldRow label="action">
          <code>{input.action}</code>
        </ToolBlockFieldRow>
      ) : null}
      {hasBody ? (
        <ToolBlockFieldRow label="body" layout="stacked">
          <ToolBlockPre>
            {formatRemoteTriggerBody(input.body as Record<string, unknown>)}
          </ToolBlockPre>
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
