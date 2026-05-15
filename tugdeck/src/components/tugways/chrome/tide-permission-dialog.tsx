/**
 * `PermissionDialog` — inline chrome for a tool-permission request.
 *
 * Renders a `control_request_forward` event with `is_question: false`
 * (Claude is asking the user to allow or deny a tool call) as an
 * *inline* block in the transcript flow per [D13] — never a modal
 * overlay. The request appeared at a point in time; the block preserves
 * that spatial logic, and after the user responds it collapses to a
 * one-line static record so the transcript keeps a permanent artifact
 * of what was asked and how it was answered.
 *
 * Two states, mutually exclusive, driven by whether this request is
 * still the session's `pendingApproval`:
 *
 *   1. **Pending** — the interactive dialog. A header ("Permission
 *      requested" + tool icon + tool name), a body that renders the
 *      `tool_use.input` through the *most-fitting* read-only body kind
 *      (see `selectPermissionBodyKind`), the `decision_reason` line,
 *      one button per `permission_suggestion`, and the Allow / Deny
 *      pair. The primary action (Allow) takes focus on mount via
 *      `useLayoutEffect` per [D13].
 *   2. **Resolved** — a one-line record (`{tool} — Allowed/Denied`)
 *      with a chevron that expands to re-show the request body +
 *      reason, read-only. A dialog that mounts for an already-resolved
 *      request (replay, re-render after response) lands here directly.
 *
 * Why the body picker composes body kinds *standalone* (not
 * `embedded`): `embedded={true}` is the contract for a body kind sitting
 * under a `ToolWrapperChrome`, which portals affordances into the
 * chrome's actions slot. `PermissionDialog` is its own chrome variant
 * (Spec S03, chrome variant) — there is no `ToolWrapperChrome` above the
 * body, so each body kind renders in standalone mode with its own
 * identity header. Per [#bk-conformance] item 1 a `Bash` command
 * renders through `TugCodeView` (CM6 is the canonical text engine —
 * there is no standalone `CodeBlock`); item 2 is satisfied by
 * construction — the dialog carries only Allow / Deny / suggestion
 * buttons, no text-entry surface.
 *
 * Laws:
 *  - [L02] external state (is this request still pending?) enters React
 *    via `useSyncExternalStore` over the `CodeSessionStore`. The local
 *    record-expanded flag and the remembered decision are component
 *    data per [L24] and live in `useState`.
 *  - [L03] `useLayoutEffect` lands the primary-button focus before
 *    paint per [D13].
 *  - [L06] appearance (pending vs. resolved, record expanded) flows
 *    through `data-*` attributes + CSS; React state holds only logical
 *    UI state.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="tide-permission-dialog"` on the root, this docstring.
 *  - [L20] component-token sovereignty — owns the `--tugx-perm-*` slot
 *    family ([Table T07]); composes the shared `--tugx-block-*` family
 *    and never overrides it.
 *
 * Decisions:
 *  - [D13] inline (not modal) permission dialogs; collapse-to-record
 *    after response.
 *
 * @module components/tugways/chrome/tide-permission-dialog
 */

import "./tide-permission-dialog.css";

import React from "react";
import {
  Ban,
  ChevronRight,
  FilePenLine,
  FilePlus,
  FileText,
  FolderSearch,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { DiffBlock } from "@/components/tugways/body-kinds/diff-block";
import { JsonTreeBlock } from "@/components/tugways/body-kinds/json-tree-block";
import { TugCodeView } from "@/components/tugways/tug-code-view";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { MiddleEllipsisPath } from "@/components/tugways/cards/tool-wrappers/middle-ellipsis-path";
import type {
  CodeSessionStore,
  ControlRequestForward,
} from "@/lib/code-session-store";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * The `permission` `RenderInput` shape, restated locally. The dispatch
 * owns the `RenderInput` union; restating the one variant this
 * component consumes keeps the import graph one-directional (the
 * dispatch imports this component for `KIND_RENDERERS.permission`, so
 * this component must not import the dispatch).
 */
export interface PermissionRenderInput {
  kind: "permission";
  request: ControlRequestForward;
  /**
   * Set when this dialog is a *committed* transcript artifact ([D13]) —
   * the decision the user already made on a past turn. The dialog
   * mounts straight into its resolved record showing that decision.
   * Omitted for a live pending request, where the dialog drives the
   * `respondApproval` round-trip and reads the decision from the user's
   * click.
   */
  resolvedDecision?: "allow" | "deny";
}

/**
 * Context the dispatch threads through. Structurally a subset of the
 * dispatch's `DispatchContext` — only `session` is needed (the
 * permission round-trip goes through `respondApproval`).
 */
export interface PermissionDialogContext {
  session: CodeSessionStore;
}

export interface PermissionDialogProps {
  input: PermissionRenderInput;
  context: PermissionDialogContext;
  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for the pure-logic test suite.
// ---------------------------------------------------------------------------

/** Which read-only body kind best fits a tool's permission `input`. */
export type PermissionBodyKind = "bash" | "edit" | "path" | "json";

/**
 * Pick the body kind for a permission request's `tool_use.input`:
 *
 *   - `Bash`              → `"bash"`  (command via `TugCodeView`)
 *   - `Edit` / `MultiEdit`→ `"edit"`  (`(old,new)` via `DiffBlock`)
 *   - `Read` / `Write`    → `"path"`  (styled middle-ellipsis path)
 *   - anything else       → `"json"`  (`JsonTreeBlock` fallback)
 *
 * Case-insensitive; mirrors the dispatch's `multiedit → edit` alias.
 */
export function selectPermissionBodyKind(toolName: string): PermissionBodyKind {
  switch (toolName.toLowerCase()) {
    case "bash":
      return "bash";
    case "edit":
    case "multiedit":
      return "edit";
    case "read":
    case "write":
      return "path";
    default:
      return "json";
  }
}

/**
 * An actionable `permission_suggestion` narrowed to what the dialog
 * needs: a wire `behavior` the `tool_approval` round-trip can honor
 * (`allow` / `deny`) plus a human-readable button label.
 */
export interface PermissionSuggestionAction {
  behavior: "allow" | "deny";
  label: string;
}

/**
 * Render a `permission_suggestion`'s `destination` as a human phrase.
 * The wire vocabulary is Claude Code's permission-rule scope; unknown
 * values pass through verbatim so the label degrades gracefully.
 */
function describeSuggestionDestination(destination: string): string {
  switch (destination) {
    case "session":
      return "this session";
    case "project":
    case "localSettings":
    case "projectSettings":
      return "this project";
    case "userSettings":
      return "always";
    default:
      return destination;
  }
}

/**
 * Narrow one raw `permission_suggestions[]` entry. Returns `null` when
 * the entry carries no actionable `behavior` (`allow` / `deny`) — those
 * are the only behaviors the `tool_approval` wire shape can express, so
 * a non-actionable suggestion (e.g. `ask`) is dropped rather than
 * rendered as a dead button.
 *
 * The wire shape (from the v2.1.x catalog) is
 * `{ behavior, destination, rules: [{ ruleContent, toolName }], type }`;
 * the label is composed from the rules + destination.
 */
export function narrowPermissionSuggestion(
  value: unknown,
): PermissionSuggestionAction | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const behavior = v.behavior;
  if (behavior !== "allow" && behavior !== "deny") return null;

  const ruleParts: string[] = [];
  if (Array.isArray(v.rules)) {
    for (const raw of v.rules) {
      if (raw === null || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const content =
        typeof r.ruleContent === "string" ? r.ruleContent : undefined;
      const tool = typeof r.toolName === "string" ? r.toolName : undefined;
      if (content !== undefined && tool !== undefined) {
        ruleParts.push(`${tool} ${content}`);
      } else if (content !== undefined) {
        ruleParts.push(content);
      } else if (tool !== undefined) {
        ruleParts.push(tool);
      }
    }
  }

  const verb = behavior === "allow" ? "Allow" : "Deny";
  let label =
    ruleParts.length > 0
      ? `${verb} ${ruleParts.join(", ")}`
      : `${verb} this action`;
  if (typeof v.destination === "string") {
    label += ` (${describeSuggestionDestination(v.destination)})`;
  }
  return { behavior, label };
}

/**
 * The one-line summary shown in the collapsed resolved record. A
 * `null` decision is the "resolved out-of-band" case — the dialog
 * mounted for a request that was no longer pending and has no locally
 * remembered decision.
 */
export function composePermissionRecordSummary(
  toolName: string,
  decision: "allow" | "deny" | null,
): string {
  const name = toolName.trim() === "" ? "Tool" : toolName;
  if (decision === "allow") return `${name} — Allowed`;
  if (decision === "deny") return `${name} — Denied`;
  return `${name} — Resolved`;
}

/**
 * Compose the optional line-range badge for a `Read` permission
 * request whose input carried `offset` / `limit`. Mirrors
 * `ReadToolBlock`'s `composeLineRangeBadge` semantics. Returns
 * `undefined` when no window was requested.
 */
export function composePermissionLineRange(
  input: unknown,
): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const v = input as Record<string, unknown>;
  const offset = typeof v.offset === "number" ? v.offset : undefined;
  const limit = typeof v.limit === "number" ? v.limit : undefined;
  if (offset === undefined && limit === undefined) return undefined;
  if (offset !== undefined && limit !== undefined) {
    return `lines ${offset}–${offset + limit - 1}`;
  }
  if (offset !== undefined) return `from line ${offset}`;
  if (limit !== undefined) return `first ${limit} lines`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Internal narrowings
// ---------------------------------------------------------------------------

function readStringField(input: unknown, key: string): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/** Per-tool header icon. Falls back to a generic wrench for the long tail. */
function permissionToolIcon(toolName: string): React.ReactNode {
  const icon = (() => {
    switch (toolName.toLowerCase()) {
      case "bash":
        return <Terminal size={14} aria-hidden="true" />;
      case "read":
        return <FileText size={14} aria-hidden="true" />;
      case "write":
        return <FilePlus size={14} aria-hidden="true" />;
      case "edit":
      case "multiedit":
        return <FilePenLine size={14} aria-hidden="true" />;
      case "glob":
        return <FolderSearch size={14} aria-hidden="true" />;
      case "grep":
        return <Search size={14} aria-hidden="true" />;
      default:
        return <Wrench size={14} aria-hidden="true" />;
    }
  })();
  return icon;
}

// ---------------------------------------------------------------------------
// Body picker
// ---------------------------------------------------------------------------

interface PermissionBodyProps {
  toolName: string;
  input: unknown;
}

/**
 * Render a permission request's `tool_use.input` through the
 * most-fitting *read-only* body kind. Composed standalone (not
 * `embedded`) — see the module docstring.
 */
const PermissionBody: React.FC<PermissionBodyProps> = ({
  toolName,
  input,
}) => {
  const kind = selectPermissionBodyKind(toolName);

  if (kind === "bash") {
    const command = readStringField(input, "command");
    if (command !== undefined) {
      return (
        <TugCodeView
          value={command}
          language="shell"
          lineNumbers={false}
          className="tide-permission-dialog-command"
        />
      );
    }
  }

  if (kind === "edit") {
    const before = readStringField(input, "old_string");
    const after = readStringField(input, "new_string");
    if (before !== undefined && after !== undefined) {
      return (
        <DiffBlock
          data={{
            source: "two-text",
            before,
            after,
            filePath: readStringField(input, "file_path"),
          }}
          className="tide-permission-dialog-diff"
        />
      );
    }
  }

  if (kind === "path") {
    const filePath = readStringField(input, "file_path");
    if (filePath !== undefined) {
      const lineRange = composePermissionLineRange(input);
      return (
        <div
          data-slot="tide-permission-dialog-path"
          className="tide-permission-dialog-path"
        >
          <MiddleEllipsisPath path={filePath} />
          {lineRange !== undefined ? (
            <span className="tide-permission-dialog-path-range">
              {lineRange}
            </span>
          ) : null}
        </div>
      );
    }
  }

  // Fallback for every other tool — and for the narrowing-miss cases
  // above (a Bash request with no `command`, an Edit with no string
  // pair, a Read/Write with no `file_path`): the raw input as a JSON
  // tree, which never renders `[object Object]` or bleeds raw JSON.
  return (
    <JsonTreeBlock
      data={input}
      label="input"
      className="tide-permission-dialog-json"
    />
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PermissionDialog: React.FC<PermissionDialogProps> = ({
  input,
  context,
  className,
}) => {
  const { request } = input;
  const { session } = context;
  const requestId = request.request_id;
  const toolName =
    typeof request.tool_name === "string" && request.tool_name.trim() !== ""
      ? request.tool_name
      : "Tool";

  // [L02] — "is this request still the session's pendingApproval?"
  // is external state; it enters through `useSyncExternalStore`. The
  // moment `respondApproval` dispatches, the reducer clears
  // `pendingApproval` and notifies synchronously, so this flips to
  // `false` and the resolved record renders without an async gap.
  const isPending = React.useSyncExternalStore(
    session.subscribe,
    React.useCallback(
      () => session.getSnapshot().pendingApproval?.request_id === requestId,
      [session, requestId],
    ),
  );

  // Remembered decision — local UI data ([L24]). Drives the resolved
  // record's summary. Seeded from `resolvedDecision` for a committed
  // transcript artifact; stays `null` for a live request until the
  // user clicks (or for a dialog that mounted resolved out-of-band
  // with no recorded decision).
  const [decision, setDecision] = React.useState<"allow" | "deny" | null>(
    input.resolvedDecision ?? null,
  );
  // Resolved-record expand affordance. Plain React state — persists
  // for the cell's lifetime, resets on remount (mirrors
  // `TideThinkingBlock`'s collapse model).
  const [recordExpanded, setRecordExpanded] = React.useState(false);

  const allowButtonRef = React.useRef<HTMLButtonElement | null>(null);

  // [D13] — focus the primary action button on mount. Mount-once: the
  // pending/decided values are read fresh here, not tracked as deps.
  React.useLayoutEffect(() => {
    if (isPending && decision === null) {
      allowButtonRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const respond = React.useCallback(
    (next: "allow" | "deny", message?: string) => {
      // Re-check against the live store rather than the rendered
      // `isPending` — robust against a click that arrives in the same
      // tick as another responder, or a stale closure.
      const stillPending =
        session.getSnapshot().pendingApproval?.request_id === requestId;
      if (!stillPending) return;
      setDecision(next);
      session.respondApproval(
        requestId,
        message !== undefined
          ? { decision: next, message }
          : { decision: next },
      );
    },
    [session, requestId],
  );

  const suggestions = React.useMemo<PermissionSuggestionAction[]>(() => {
    const raw = request.permission_suggestions ?? [];
    const out: PermissionSuggestionAction[] = [];
    for (const entry of raw) {
      const narrowed = narrowPermissionSuggestion(entry);
      if (narrowed !== null) out.push(narrowed);
    }
    return out;
  }, [request.permission_suggestions]);

  const decisionReason =
    typeof request.decision_reason === "string" &&
    request.decision_reason.trim() !== ""
      ? request.decision_reason
      : undefined;

  const rootClassName = cn("tide-permission-dialog", className);

  // ---- Resolved record ----------------------------------------------------
  if (!isPending) {
    return (
      <div
        data-slot="tide-permission-dialog"
        data-state="resolved"
        data-decision={decision ?? undefined}
        data-collapsed={recordExpanded ? "false" : "true"}
        className={rootClassName}
      >
        <button
          type="button"
          className="tide-permission-dialog-record"
          aria-expanded={recordExpanded ? "true" : "false"}
          onClick={() => setRecordExpanded((prev) => !prev)}
        >
          <ChevronRight
            size={14}
            aria-hidden="true"
            className="tide-permission-dialog-record-chevron"
          />
          {decision === "deny" ? (
            <Ban
              size={14}
              aria-hidden="true"
              className="tide-permission-dialog-record-icon"
            />
          ) : (
            <ShieldCheck
              size={14}
              aria-hidden="true"
              className="tide-permission-dialog-record-icon"
            />
          )}
          <span className="tide-permission-dialog-record-summary">
            {composePermissionRecordSummary(toolName, decision)}
          </span>
        </button>
        {recordExpanded ? (
          <div className="tide-permission-dialog-record-detail">
            <PermissionBody toolName={toolName} input={request.input} />
            {decisionReason !== undefined ? (
              <p className="tide-permission-dialog-reason">{decisionReason}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  // ---- Pending dialog -----------------------------------------------------
  return (
    <div
      data-slot="tide-permission-dialog"
      data-state="pending"
      className={rootClassName}
    >
      <div className="tide-permission-dialog-header">
        <ShieldAlert
          size={14}
          aria-hidden="true"
          className="tide-permission-dialog-shield"
        />
        <span className="tide-permission-dialog-title">
          Permission requested
        </span>
        <span
          className="tide-permission-dialog-tool-icon"
          aria-hidden="true"
        >
          {permissionToolIcon(toolName)}
        </span>
        <span className="tide-permission-dialog-tool-name">{toolName}</span>
      </div>

      <div className="tide-permission-dialog-body">
        <PermissionBody toolName={toolName} input={request.input} />
      </div>

      {decisionReason !== undefined ? (
        <p className="tide-permission-dialog-reason">{decisionReason}</p>
      ) : null}

      {suggestions.length > 0 ? (
        <div
          className="tide-permission-dialog-suggestions"
          data-slot="tide-permission-dialog-suggestions"
        >
          {suggestions.map((suggestion, index) => (
            <TugPushButton
              key={index}
              size="sm"
              emphasis="outlined"
              role={suggestion.behavior === "deny" ? "danger" : "action"}
              onClick={() => respond(suggestion.behavior, suggestion.label)}
            >
              {suggestion.label}
            </TugPushButton>
          ))}
        </div>
      ) : null}

      <div
        className="tide-permission-dialog-actions"
        data-slot="tide-permission-dialog-actions"
      >
        <TugPushButton
          ref={allowButtonRef}
          size="sm"
          emphasis="filled"
          role="accent"
          onClick={() => respond("allow")}
        >
          Allow
        </TugPushButton>
        <TugPushButton
          size="sm"
          emphasis="outlined"
          role="danger"
          onClick={() => respond("deny")}
        >
          Deny
        </TugPushButton>
      </div>
    </div>
  );
};
