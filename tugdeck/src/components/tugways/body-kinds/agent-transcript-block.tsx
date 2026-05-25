/**
 * `AgentTranscriptBlock` — Layer-1 body kind for a subagent run.
 *
 * Renders the transcript of a `Task` / `Agent` tool call: the
 * subagent's content entries (text answers and any nested tool
 * calls), wrapped in identity / status chrome. `TaskToolBlock`
 * ([#step-17]) composes it `embedded`.
 *
 * Recursion ([D17]):
 *  - The body iterates the subagent's `entries[]`. A `text` entry
 *    renders as prose; a `tool_use` entry routes back through the
 *    *same* dispatch (`dispatchToolCallState`) at `depth + 1`, so a
 *    nested tool call gets its real per-tool block — and a nested
 *    `Agent` call resolves to `TaskToolBlock` → `AgentTranscriptBlock`
 *    again, one level deeper.
 *  - Recursion is bounded by `maxDepth` (default {@link AGENT_MAX_DEPTH}
 *    = 3). An `AgentTranscriptBlock` rendered past the cap
 *    (`depth > maxDepth`) starts *collapsed* — it shows only its
 *    header plus a "+N nested calls" `BlockFoldCue`. The user can
 *    still expand it, but nothing auto-expands past the cap, so a
 *    pathologically deep input can never melt the layout. Collapse is
 *    logical UI state ([L06]) persisted through the [A9] axis.
 *
 * Composition (mirrors `JsonTreeBlock` / `FileBlock`):
 *  - Header (standalone only) — agent type + status + duration +
 *    tool-call count, and a trailing actions cluster (the fold cue +
 *    Copy). In `embedded` mode the header is suppressed (the host
 *    `ToolBlockChrome` owns identity) and the actions cluster
 *    portals into the host chrome's actions slot.
 *  - Body — the `entries[]` column, or, when collapsed, nothing (the
 *    fold cue in the actions cluster is the sole affordance).
 *  - Footer — a thin token-summary strip; renders in both modes.
 *
 * Text rendering: a `text` entry renders as pre-wrapped prose. When
 * the [#step-3] assistant-text renderer ships, text entries can route
 * through it; until then prose is honest and dependency-free — this
 * body kind deliberately does not embed the virtualized
 * `TugMarkdownView` (it owns its own scroll container and imperative
 * ref contract, wrong for short inline entries).
 *
 * What this body kind does NOT do:
 *  - Render a text-entry surface ([#bk-conformance] item 2) — it
 *    *displays* a finished subagent run, it carries no input field.
 *  - Fold `parent_tool_use_id`-tagged sibling events into `entries[]`
 *    — that association is reducer work and out of scope here. The
 *    body kind renders whatever `entries[]` the wrapper composed.
 *
 * Laws:
 *  - [L06] collapse is logical state (which rows exist) → React state;
 *    hover / status colours are pure CSS.
 *  - [L11] owns no responder. Copy is a `BlockCopyButton`; the fold
 *    cue is a `BlockFoldCue` — both self-contained controls.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="agent-transcript-body"` on the root, this docstring.
 *  - [L20] component-token sovereignty — owns `--tugx-agent-*`;
 *    consumes `--tugx-block-*` for the shared block scaffold.
 *  - [L23] collapse state survives reload via the [A9]
 *    component-state axis (`useBlockFoldState`).
 *
 * Decisions:
 *  - [D05] two-layer split: this body kind owns transcript rendering;
 *    `TaskToolBlock` owns chrome.
 *  - [D17] recursion runs through the same dispatch, depth-bounded.
 *
 * @module components/tugways/body-kinds/agent-transcript-block
 */

import "./agent-transcript-block.css";

import React from "react";
import { createPortal } from "react-dom";

import { dispatchToolCallState } from "@/components/tugways/cards/tide-assistant-renderer-dispatch";
import { useChromeActionsTarget } from "@/components/tugways/cards/tool-blocks/tool-block-chrome";
import type { ChildToolCallsMap } from "@/components/tugways/cards/tool-blocks/types";
import type { ToolUseMessage } from "@/lib/code-session-store";
import {
  BlockActionsCluster,
  BlockCopyButton,
  BlockFoldCue,
  useBlockFoldState,
} from "./affordances";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One entry in a subagent transcript — a text answer or a nested tool call. */
export type AgentTranscriptEntry =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; toolCall: ToolUseMessage };

/** Structured subagent-run data — the body's render input. */
export interface AgentTranscriptData {
  /** Subagent type, e.g. "Explore" / "Plan". */
  agentType?: string;
  /** Run status as emitted on the wire, e.g. "completed" / "in_progress". */
  status?: string;
  /** Total wall-clock duration of the subagent run, in milliseconds. */
  durationMs?: number;
  /** Total tool-call count the subagent made. */
  toolUseCount?: number;
  /** Total token spend of the subagent run. */
  totalTokens?: number;
  /** The subagent's content entries, in producer order. */
  entries: readonly AgentTranscriptEntry[];
}

export interface AgentTranscriptBlockProps {
  /**
   * The subagent-run data. When undefined (or `entries` is empty AND
   * there is no header-worthy metadata) the block renders an empty
   * `data-slot="agent-transcript-body"` marker for layout consistency.
   */
  data?: AgentTranscriptData;

  /**
   * [D17] recursion depth — `0` at the top-level `Agent` call,
   * incremented each level deeper. Drives the depth-cap collapse
   * default and is threaded onto nested `dispatchToolCallState` calls.
   *
   * @default 0
   */
  depth?: number;

  /**
   * Recursion depth past which the block starts collapsed.
   *
   * @default AGENT_MAX_DEPTH (3)
   */
  maxDepth?: number;

  /**
   * Owning turn's message id — threaded onto nested
   * `dispatchToolCallState` calls so nested wrappers carry a stable
   * identifier.
   */
  msgId?: string;

  /**
   * Subagent-nesting map ([#step-17-5]) — `parentToolUseId → children[]`,
   * built once by the transcript view. Threaded through so a
   * `tool_use` entry that is *itself* an `Agent` resolves its own
   * children when it recurses. `undefined` when this transcript has no
   * reducer-linked children to wire (gallery / standalone).
   */
  childToolCallsByParent?: ChildToolCallsMap;

  /**
   * Optional identity label shown at the leading edge of the
   * standalone header. Ignored in `embedded` mode — the host owns
   * identity there.
   */
  label?: string;

  /**
   * "Embedded" mode — composed inside a host that already paints a
   * container and a header (e.g. `ToolBlockChrome` in
   * `TaskToolBlock`). When `true` the standalone frame + header are
   * dropped and the actions cluster portals into the host chrome's
   * actions slot. MUST be used under a `ToolBlockChrome`.
   *
   * @default false
   */
  embedded?: boolean;

  /** Forwarded class name for cascade-scoped customization. */
  className?: string;

  /**
   * Opt-in key for the [A9] Component State Preservation Protocol.
   * When set, AgentTranscriptBlock persists its collapse state into
   * `bag.components` so a Developer > Reload restores it. Undefined
   * opts out (gallery, standalone).
   */
  componentStatePreservationKey?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default recursion depth past which an `AgentTranscriptBlock` starts
 * collapsed. Per [D17]: no real-session subagent depth > 1 was
 * observed in the audit corpus, so 3 is generous paranoia headroom —
 * depth 0–3 render expanded, depth 4+ start folded.
 */
export const AGENT_MAX_DEPTH = 3;

const DATA_SLOT_ROOT = "agent-transcript-body";
const DATA_SLOT_HEADER = "agent-transcript-header";
const DATA_SLOT_ENTRIES = "agent-transcript-entries";
const DATA_SLOT_FOOTER = "agent-transcript-footer";
const DATA_SLOT_ACTIONS = "agent-transcript-actions";

// ---------------------------------------------------------------------------
// Pure helpers — exported because tests pin them
// ---------------------------------------------------------------------------

/**
 * Whether an `AgentTranscriptBlock` at `depth` should *start*
 * collapsed — `true` once `depth` exceeds `maxDepth`. This is the
 * [D17] depth cap: it bounds auto-expansion, it does not hide data
 * (the user can still expand a folded block).
 */
export function shouldCollapseAgentDepth(
  depth: number,
  maxDepth: number = AGENT_MAX_DEPTH,
): boolean {
  return depth > maxDepth;
}

/** Count the nested tool-call entries in a transcript. */
export function countNestedToolCalls(data: AgentTranscriptData): number {
  let count = 0;
  for (const entry of data.entries) {
    if (entry.kind === "tool_use") count += 1;
  }
  return count;
}

/** Compose the fold-cue label, e.g. "1 nested call" / "3 nested calls". */
export function composeNestedCallsLabel(count: number): string {
  return `${count.toLocaleString()} nested ${count === 1 ? "call" : "calls"}`;
}

/** Compose the header tool-count label, e.g. "1 tool call" / "5 tool calls". */
export function composeAgentToolCountLabel(
  count: number | undefined,
): string | undefined {
  if (count === undefined) return undefined;
  return `${count.toLocaleString()} tool ${count === 1 ? "call" : "calls"}`;
}

/**
 * Compact duration label for the header — `"850 ms"`, `"3.6 s"`,
 * `"2m 05s"`. Returns `undefined` for an unknown / invalid duration.
 */
export function composeAgentDurationLabel(
  ms: number | undefined,
): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Compose the footer token-spend label. `undefined` when unknown. */
export function composeAgentTokenLabel(
  totalTokens: number | undefined,
): string | undefined {
  if (
    totalTokens === undefined ||
    !Number.isFinite(totalTokens) ||
    totalTokens < 0
  ) {
    return undefined;
  }
  return `${totalTokens.toLocaleString()} tokens`;
}

/**
 * Serialize a subagent transcript to plain text for the Copy
 * affordance — an identity line, then each entry: text verbatim, a
 * nested tool call as `[tool: {name}]`.
 */
export function composeAgentTranscriptText(data: AgentTranscriptData): string {
  const lines: string[] = [];
  const identity = [data.agentType, data.status].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  if (identity.length > 0) lines.push(identity.join(" · "));
  for (const entry of data.entries) {
    if (entry.kind === "text") {
      lines.push(entry.text);
    } else {
      lines.push(`[tool: ${entry.toolCall.toolName}]`);
    }
  }
  return lines.join("\n");
}

/** Whether `data` carries anything worth rendering (entries or metadata). */
function hasRenderableContent(data: AgentTranscriptData): boolean {
  return (
    data.entries.length > 0 ||
    data.agentType !== undefined ||
    data.status !== undefined ||
    data.durationMs !== undefined ||
    data.toolUseCount !== undefined ||
    data.totalTokens !== undefined
  );
}

// ---------------------------------------------------------------------------
// Entry renderer
// ---------------------------------------------------------------------------

interface AgentEntryViewProps {
  entry: AgentTranscriptEntry;
  /** Recursion depth of the *parent* block — nested calls dispatch at +1. */
  depth: number;
  msgId: string;
  /** Subagent-nesting map, threaded on to nested dispatch ([#step-17-5]). */
  childToolCallsByParent: ChildToolCallsMap | undefined;
}

/**
 * Render one transcript entry. A `text` entry renders as pre-wrapped
 * prose; a `tool_use` entry routes back through the same dispatch at
 * `depth + 1` so it gets its real per-tool block ([D17]) — and the
 * subagent-nesting map rides along so a nested `Agent` resolves its
 * own children ([#step-17-5]).
 */
const AgentEntryView: React.FC<AgentEntryViewProps> = ({
  entry,
  depth,
  msgId,
  childToolCallsByParent,
}) => {
  if (entry.kind === "text") {
    return (
      <div
        className="tugx-agent-text"
        data-slot="agent-transcript-text"
        data-agent-entry-kind="text"
      >
        {entry.text}
      </div>
    );
  }
  const { Component, props } = dispatchToolCallState(
    entry.toolCall,
    msgId,
    depth + 1,
    childToolCallsByParent,
  );
  return (
    <div
      className="tugx-agent-tool"
      data-slot="agent-transcript-tool"
      data-agent-entry-kind="tool_use"
    >
      <Component {...props} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

export const AgentTranscriptBlock: React.FC<AgentTranscriptBlockProps> = ({
  data,
  depth = 0,
  maxDepth = AGENT_MAX_DEPTH,
  msgId = "",
  childToolCallsByParent,
  label,
  embedded = false,
  className,
  componentStatePreservationKey,
}) => {
  // ---- Collapse state — logical UI state, React-owned per [L06] ------
  //
  // Owned by `useBlockFoldState` (shared with the other fold-bearing
  // body kinds): mount-in-saved-state, [A9] capture, and the toggle.
  // AgentTranscriptBlock is purely uncontrolled — no `collapsed` prop —
  // so it supplies only the default: collapsed once rendered past the
  // [D17] depth cap. A saved fold wins over the depth default so a
  // Developer > Reload restores the user's explicit choice.
  const { collapsed, setCollapsed } = useBlockFoldState({
    defaultCollapsed: shouldCollapseAgentDepth(depth, maxDepth),
    componentStatePreservationKey,
  });

  // ---- Copy source ---------------------------------------------------
  //
  // `dataRef` carries the live data so `BlockCopyButton`'s `getText`
  // closure reads the freshest transcript at fire time ([L07]).
  const dataRef = React.useRef<AgentTranscriptData | undefined>(data);
  React.useLayoutEffect(() => {
    dataRef.current = data;
  }, [data]);
  const getTranscriptText = React.useCallback(
    () =>
      dataRef.current === undefined
        ? ""
        : composeAgentTranscriptText(dataRef.current),
    [],
  );

  // ---- Chrome actions target (embedded composition) ------------------
  const chromeActionsTarget = useChromeActionsTarget();

  // Dev-mode misconfiguration check — `embedded={true}` requires a
  // parent `ToolBlockChrome`. Mirrors the other body kinds'
  // deferred-warn pattern.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!embedded) return;
    if (chromeActionsTarget !== null) return;
    const handle = window.setTimeout(() => {
      console.warn(
        "AgentTranscriptBlock: `embedded={true}` requires a parent " +
          "`ToolBlockChrome`. Without one the actions cluster (fold " +
          "cue, Copy) has nowhere to portal and the user loses access " +
          "to it silently. Either compose under a chrome or set " +
          "`embedded={false}`.",
      );
    }, 0);
    return () => {
      window.clearTimeout(handle);
    };
  }, [embedded, chromeActionsTarget]);

  // ---- Empty data: layout-consistent marker --------------------------
  if (data === undefined || !hasRenderableContent(data)) {
    return (
      <div
        data-slot={DATA_SLOT_ROOT}
        data-empty="true"
        data-embedded={embedded ? "true" : undefined}
        className={
          className === undefined
            ? "tugx-agent"
            : `tugx-agent ${className}`
        }
      />
    );
  }

  const rootClass =
    "tugx-agent" + (className === undefined ? "" : ` ${className}`);

  const durationLabel = composeAgentDurationLabel(data.durationMs);
  const toolCountLabel = composeAgentToolCountLabel(data.toolUseCount);
  const tokenLabel = composeAgentTokenLabel(data.totalTokens);
  const nestedCallCount = countNestedToolCalls(data);

  // The actions cluster — the fold cue + Copy. Composed once; rendered
  // inline in `.tugx-agent-header` (standalone) or portaled into the
  // host chrome's actions slot (embedded).
  const actions = (
    <>
      <BlockFoldCue
        collapsed={collapsed}
        onToggle={setCollapsed}
        collapsedLabel={composeNestedCallsLabel(nestedCallCount)}
        ariaLabelCollapse="Collapse subagent transcript"
        ariaLabelExpand="Expand subagent transcript"
        data-slot="agent-transcript-fold-cue"
        className="tugx-agent-fold-cue"
      />
      <BlockCopyButton
        data-slot="agent-transcript-copy"
        aria-label="Copy subagent transcript"
        getText={getTranscriptText}
      />
    </>
  );

  const portaledActions =
    embedded && chromeActionsTarget !== null
      ? createPortal(
          <BlockActionsCluster data-slot={DATA_SLOT_ACTIONS}>
            {actions}
          </BlockActionsCluster>,
          chromeActionsTarget,
        )
      : null;

  return (
    <div
      data-slot={DATA_SLOT_ROOT}
      data-empty="false"
      data-embedded={embedded ? "true" : undefined}
      data-collapsed={collapsed ? "true" : "false"}
      className={rootClass}
    >
      {embedded ? null : (
        <div className="tugx-agent-header" data-slot={DATA_SLOT_HEADER}>
          {label !== undefined ? (
            <span className="tugx-agent-label" data-slot="agent-transcript-label">
              {label}
            </span>
          ) : null}
          {data.agentType !== undefined ? (
            <span
              className="tugx-agent-type"
              data-slot="agent-transcript-type"
            >
              {data.agentType}
            </span>
          ) : null}
          {data.status !== undefined ? (
            <span
              className="tugx-agent-status"
              data-slot="agent-transcript-status"
              data-agent-status={data.status}
            >
              {data.status}
            </span>
          ) : null}
          {durationLabel !== undefined ? (
            <span
              className="tugx-agent-duration"
              data-slot="agent-transcript-duration"
            >
              {durationLabel}
            </span>
          ) : null}
          {toolCountLabel !== undefined ? (
            <span
              className="tugx-agent-tool-count"
              data-slot="agent-transcript-tool-count"
            >
              {toolCountLabel}
            </span>
          ) : null}
          <span className="tugx-agent-header-spacer" />
          <BlockActionsCluster data-slot={DATA_SLOT_ACTIONS}>
            {actions}
          </BlockActionsCluster>
        </div>
      )}
      {portaledActions}

      {collapsed ? null : (
        <div className="tugx-agent-entries" data-slot={DATA_SLOT_ENTRIES}>
          {data.entries.map((entry, index) => (
            <AgentEntryView
              key={
                entry.kind === "tool_use"
                  ? `tool:${entry.toolCall.toolUseId}`
                  : `text:${index}`
              }
              entry={entry}
              depth={depth}
              msgId={msgId}
              childToolCallsByParent={childToolCallsByParent}
            />
          ))}
        </div>
      )}

      {tokenLabel !== undefined ? (
        <div className="tugx-agent-footer" data-slot={DATA_SLOT_FOOTER}>
          <span
            className="tugx-agent-tokens"
            data-slot="agent-transcript-tokens"
          >
            {tokenLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
};
