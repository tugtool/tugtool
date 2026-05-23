/**
 * `PermissionDialog` — inline chrome for a tool-permission request.
 *
 * Renders a `control_request_forward` event with `is_question: false`
 * (Claude is asking the user to allow or deny a tool call) as an
 * *inline* block in the transcript flow — never a modal overlay. The
 * dialog is *pending-only*: once the user clicks Allow / Deny the
 * reducer clears `pendingApproval`, `isPending` flips to `false`, and
 * this component returns `null`. There is no post-decision recorded
 * chrome — JSONL has no durable record to reconstruct one from on
 * cold boot, so the tool block that follows is the only post-decision
 * artifact (output on allow; `is_error` band + SDK rejection text on
 * deny). See `#step-3-5` in `roadmap/archive/tide-interactive-dialogs.md`.
 *
 * The single rendered state composes the `TideInteractiveDialog`
 * input-form primitive of the Tide interactive-dialog family (which
 * itself wraps `TugInlineDialog` — see [D08]) with
 * `iconRole="caution"` and a per-tool rich description. The body
 * picker (DiffBlock for Edit, JsonTreeBlock for the unknown-tool
 * fallback) renders inside the dialog's `children` slot. When the
 * request carries actionable `permission_suggestions`, those (plus
 * an implicit "Allow once" first option) are passed to the
 * primitive's `options` prop as a mandatory-single-select radio
 * group; the user picks the *scope*, then commits with Allow. Deny is
 * the off-ramp — clicking it ignores the chosen scope and denies the
 * request outright.
 *
 * `Deny` is a *positive decision* (`respondApproval({decision:
 * "deny"})`), not a walk-away — the dialog passes
 * `cancelRole="action"` to opt out of the interactive-dialog
 * family's danger-tone default ([D02] / [Q03] carve-out). Esc keeps
 * reaching `popInteractive` via the responder chain; that walk-away
 * cancels the running turn rather than denying the permission.
 *
 * Per-tool description (`PermissionDescription`):
 *
 *   - `Bash` →  `"This command requires approval · {Shell-icon} Bash · `{command}`"`
 *   - `Edit` / `MultiEdit` →  `"This will edit `{file_path}`."`
 *   - `Read` →  `"This will read `{file_path}` ({line range})."`  (range when set)
 *   - `Write` →  `"This will write `{file_path}`."`
 *   - default →  `"This will run `{tool_name}`."`
 *
 * The wire `decision_reason`, when present, is appended as a second
 * sentence in the same description ReactNode. The cohesive sentence
 * belongs in the description; do not fragment the same idea into
 * separate slots.
 *
 * Body picker (`PendingBody`) — only Edit and the JSON fallback need
 * a separate body in the children slot:
 *
 *   - `edit` → `DiffBlock` (`two-text` source from `(old_string,
 *     new_string)`).
 *   - `json` (unknown tool) → `JsonTreeBlock` over the raw input.
 *   - `bash` / `path` → `null`. The relevant input fragment is
 *     already in the description.
 *
 * Laws:
 *  - [L02] external state (is this request still pending?) enters
 *    React via `useSyncExternalStore` over the `CodeSessionStore`.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    this docstring.
 *  - [L20] component-token sovereignty — the visual is delegated to
 *    `TideInteractiveDialog` (which owns the family cancel-role +
 *    actions-row defaults) which in turn delegates to
 *    `TugInlineDialog` (`--tugx-idialog-*`). This dialog itself
 *    contributes only the small inline-icon + reason fragments used
 *    inside the pending description.
 *
 * @module components/tugways/chrome/tide-permission-dialog
 */

import "./tide-permission-dialog.css";

import React from "react";
import { Shell, ShieldAlert } from "lucide-react";

import { DiffBlock } from "@/components/tugways/body-kinds/diff-block";
import { JsonTreeBlock } from "@/components/tugways/body-kinds/json-tree-block";
import { TideInteractiveDialog } from "@/components/tugways/tide-interactive-dialog";
import type { TugInlineDialogOption } from "@/components/tugways/tug-inline-dialog";
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
 *   - `Bash`              → `"bash"`  (command surfaced inline in description)
 *   - `Edit` / `MultiEdit`→ `"edit"`  (`(old,new)` via `DiffBlock` in children)
 *   - `Read` / `Write`    → `"path"`  (path surfaced inline in description)
 *   - anything else       → `"json"`  (`JsonTreeBlock` over input in children)
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
 * Compose the human-readable suggestion label from the wire's
 * `behavior` + `destination` pair. Pure; exported so the test suite
 * can pin every (behavior × destination) cell.
 *
 * The dialog's *description* already names the specific tool +
 * command being asked about (e.g. "Bash · `tokei`"); the suggestion
 * button only needs to communicate the *scope* of the rule that gets
 * added — repeating the rule content here ("Allow Bash tokei (this
 * project)") read as clumsy and pushed the button width past the
 * dialog. Per the Step 18.5 design feedback we drop the wire's
 * `rules` content from the label and key off (behavior, destination)
 * alone:
 *
 *  - `allow` + `session`        → "Allow for this session"
 *  - `allow` + `project`/`localSettings`/`projectSettings`
 *                               → "Allow for this project"
 *  - `allow` + `userSettings`   → "Always allow"
 *  - `allow` + (no destination) → "Allow this action"
 *  - mirror for `deny`.
 *  - unknown destination        → `"{Verb} ({destination})"`
 *    (graceful passthrough so a forward-compat scope still reads).
 */
export function composePermissionSuggestionLabel(
  behavior: "allow" | "deny",
  destination: string | undefined,
): string {
  const verb = behavior === "allow" ? "Allow" : "Deny";
  if (destination === undefined) return `${verb} this action`;
  switch (destination) {
    case "session":
      return `${verb} for this session`;
    case "project":
    case "localSettings":
    case "projectSettings":
      return `${verb} for this project`;
    case "userSettings":
      return behavior === "allow" ? "Always allow" : "Always deny";
    default:
      return `${verb} (${destination})`;
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
 * `{ behavior, destination, rules: [{ ruleContent, toolName }], type }`.
 * The narrowed label is composed from `behavior` + `destination` only
 * (see {@link composePermissionSuggestionLabel}); the wire's `rules`
 * content is intentionally dropped from the visible label since the
 * dialog's description already carries it.
 */
export function narrowPermissionSuggestion(
  value: unknown,
): PermissionSuggestionAction | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const behavior = v.behavior;
  if (behavior !== "allow" && behavior !== "deny") return null;
  const destination =
    typeof v.destination === "string" ? v.destination : undefined;
  return {
    behavior,
    label: composePermissionSuggestionLabel(behavior, destination),
  };
}

/**
 * Stable identifier reserved for the implicit "Allow once" option that
 * heads every options list when at least one allow-scoped suggestion
 * exists. Exported so the dialog and its tests share the constant
 * verbatim — never drifting between caller and asserter.
 */
export const ALLOW_ONCE_OPTION_VALUE = "allow-once";

/** Visible label for the implicit "Allow once" option. */
export const ALLOW_ONCE_OPTION_LABEL = "Allow once";

/**
 * Description for the implicit "Allow once" option. Anchors the
 * default semantic so the user understands what happens when they
 * commit Allow without picking a more durable scope.
 */
export const ALLOW_ONCE_OPTION_DESCRIPTION =
  "Allow this single invocation. No rule is added.";

/**
 * Build the options array fed to `TugInlineDialog`'s `options` prop
 * from the narrowed allow-scoped suggestions. The implicit "Allow
 * once" option is prepended whenever at least one allow-scoped
 * suggestion exists, so the user always has the no-rule default
 * available alongside the persistent scopes Claude proposed.
 *
 * Returns an empty array when no allow-scoped suggestions are
 * present — the dialog then renders without an options block (Allow
 * defaults to the one-shot scope).
 *
 * Deny-scoped suggestions are intentionally not surfaced as scope
 * options — Deny in this dialog is always a single button that
 * skips the entire scope-picking flow. A future enhancement could
 * model deny-scope as a separate group; today it would conflate
 * "scope of allow" with "scope of deny" inside one radio group.
 *
 * Pure; exported for the test suite.
 */
export function buildPermissionOptions(
  suggestions: ReadonlyArray<PermissionSuggestionAction>,
): TugInlineDialogOption[] {
  const allowSuggestions = suggestions.filter((s) => s.behavior === "allow");
  if (allowSuggestions.length === 0) return [];
  const out: TugInlineDialogOption[] = [
    {
      value: ALLOW_ONCE_OPTION_VALUE,
      label: ALLOW_ONCE_OPTION_LABEL,
      description: ALLOW_ONCE_OPTION_DESCRIPTION,
    },
  ];
  for (const suggestion of allowSuggestions) {
    out.push({
      value: `allow:${suggestion.label}`,
      label: suggestion.label,
    });
  }
  return out;
}

/**
 * Recognise wire `decision_reason` strings that merely restate what
 * the dialog already says — "This command requires approval" /
 * "Approval required" / similar boilerplate — so the
 * description doesn't end up doubling the same sentence twice.
 *
 * The wire occasionally fills `decision_reason` with this kind of
 * generic copy when the underlying gating logic has nothing more
 * specific to add (typically Bash). When the reason carries
 * substantive context — "Path is outside allowed working
 * directories", "File is outside the workspace root" — it is kept
 * intact.
 *
 * Match is case-insensitive, trims surrounding whitespace, and
 * tolerates trailing `.` / `!` / `?`. Pure; exported for tests.
 */
export function isBoilerplateApprovalReason(reason: string): boolean {
  const stripped = reason.trim().toLowerCase().replace(/[.!?]+$/, "");
  switch (stripped) {
    case "":
    case "this command requires approval":
    case "this tool requires approval":
    case "this action requires approval":
    case "approval required":
    case "requires approval":
    case "permission requested":
    case "permission required":
      return true;
    default:
      return false;
  }
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

// ---------------------------------------------------------------------------
// Description composer
// ---------------------------------------------------------------------------

interface DescriptionProps {
  toolName: string;
  input: unknown;
  decisionReason?: string;
}

/**
 * Compose the rich-description ReactNode for the pending dialog. Per
 * [D13] / step-18-5 design feedback the description is one cohesive
 * sentence (or sentence-pair) that pulls together the prose, the tool
 * kind, and the relevant input fragment — never three loose lines.
 */
const PermissionDescription: React.FC<DescriptionProps> = ({
  toolName,
  input,
  decisionReason,
}) => {
  const kind = selectPermissionBodyKind(toolName);
  let primary: React.ReactNode;
  switch (kind) {
    case "bash": {
      const command = readStringField(input, "command");
      primary =
        command !== undefined ? (
          <>
            This command requires approval ·{" "}
            <Shell
              size={12}
              aria-hidden="true"
              className="tide-permission-dialog-inline-icon"
            />{" "}
            Bash · <code>{command}</code>
          </>
        ) : (
          <>This Bash command requires approval.</>
        );
      break;
    }
    case "edit": {
      const filePath = readStringField(input, "file_path");
      primary =
        filePath !== undefined ? (
          <>
            This will edit <code>{filePath}</code>.
          </>
        ) : (
          <>This will edit a file.</>
        );
      break;
    }
    case "path": {
      const filePath = readStringField(input, "file_path");
      const verb = toolName.toLowerCase() === "write" ? "write" : "read";
      const lineRange = composePermissionLineRange(input);
      primary =
        filePath !== undefined ? (
          <>
            This will {verb} <code>{filePath}</code>
            {lineRange !== undefined ? ` (${lineRange})` : ""}.
          </>
        ) : (
          <>This will {verb} a file.</>
        );
      break;
    }
    case "json":
    default:
      primary = (
        <>
          This will run <code>{toolName}</code>.
        </>
      );
      break;
  }
  if (decisionReason !== undefined && decisionReason !== "") {
    return (
      <>
        {primary}{" "}
        <span className="tide-permission-dialog-reason">{decisionReason}</span>
      </>
    );
  }
  return <>{primary}</>;
};

// ---------------------------------------------------------------------------
// Body picker (children slot)
// ---------------------------------------------------------------------------

interface PendingBodyProps {
  toolName: string;
  input: unknown;
}

/**
 * Render the body kind that goes inside the inline dialog's `children`
 * slot. Returns `null` when the description already carries the
 * relevant input fragment (Bash command, Read/Write path).
 */
const PendingBody: React.FC<PendingBodyProps> = ({ toolName, input }) => {
  const kind = selectPermissionBodyKind(toolName);
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
    return null;
  }
  if (kind === "json") {
    return (
      <JsonTreeBlock
        data={input}
        label="input"
        className="tide-permission-dialog-json"
      />
    );
  }
  // bash / path — description carries the relevant input fragment;
  // no body picker needed.
  return null;
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
  // `false` and the component returns `null` — leaving no post-decision
  // chrome behind. The tool block that follows is the only visible
  // artifact (see `#step-3-5`).
  const isPending = React.useSyncExternalStore(
    session.subscribe,
    React.useCallback(
      () => session.getSnapshot().pendingApproval?.request_id === requestId,
      [session, requestId],
    ),
  );

  const respond = React.useCallback(
    (next: "allow" | "deny", message?: string) => {
      // Re-check against the live store rather than the rendered
      // `isPending` — robust against a click that arrives in the same
      // tick as another responder, or a stale closure.
      const stillPending =
        session.getSnapshot().pendingApproval?.request_id === requestId;
      if (!stillPending) return;
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

  const allowOptions = React.useMemo(
    () => buildPermissionOptions(suggestions),
    [suggestions],
  );

  // Mandatory single-select: the first option (the implicit "Allow
  // once" when scopes are offered) is the default. Initialised once
  // per request from the *initial* options list — switching pending
  // requests would remount this component anyway, so the seed never
  // drifts under us.
  const [selectedOption, setSelectedOption] = React.useState<string>(
    () => allowOptions[0]?.value ?? ALLOW_ONCE_OPTION_VALUE,
  );

  const decisionReason = React.useMemo<string | undefined>(() => {
    const raw = request.decision_reason;
    if (typeof raw !== "string") return undefined;
    if (raw.trim() === "") return undefined;
    // Drop wire boilerplate that merely restates the dialog's own
    // synthesized prose ("This command requires approval"). When the
    // reason carries substantive context ("Path is outside allowed
    // working directories"), it stays.
    if (isBoilerplateApprovalReason(raw)) return undefined;
    return raw;
  }, [request.decision_reason]);

  // Allow handler — declared HERE, before the `!isPending` early
  // return, so every render of this component calls the same set of
  // hooks in the same order ([L02] / [L24] structure zone). When the
  // user clicks Allow `isPending` flips and this render returns
  // `null`; if `useCallback` were declared inside the pending render
  // body, the post-flip render would hit the early return before
  // reaching the hook and React would crash with "Rendered fewer
  // hooks than expected."
  const handleAllow = React.useCallback(() => {
    // The implicit "Allow once" maps to allow-without-scope; any
    // other selected option's label is the scope message Claude
    // reads back to bind the rule.
    if (selectedOption === ALLOW_ONCE_OPTION_VALUE) {
      respond("allow");
      return;
    }
    const chosen = allowOptions.find((o) => o.value === selectedOption);
    respond("allow", chosen?.label);
  }, [allowOptions, respond, selectedOption]);

  const handleDeny = React.useCallback(() => {
    respond("deny");
  }, [respond]);

  // The dialog has no post-decision chrome — see the module docstring
  // and `#step-3-5`. Once the user clicks (or the request resolves
  // out-of-band), `isPending` flips to `false` and the component
  // returns `null`, leaving no UI trace. The gated tool block that
  // follows is the only post-decision artifact.
  if (!isPending) {
    return null;
  }

  // ---- Pending: composed on TideInteractiveDialog -------------------------
  // Composes the Tide interactive-dialog family's input-form
  // primitive ([D01] / [D08]); the primitive delegates the visible
  // chrome to `TugInlineDialog` one layer down. The body picker
  // (DiffBlock for Edit, JsonTreeBlock for the JSON fallback) goes in
  // the primitive's `children` slot. Allow-scoped suggestions (plus
  // the implicit "Allow once" head) go on the `options` prop — a
  // mandatory single-select radio group of `TugDialogButton`s. Allow
  // commits with the chosen scope's message; Deny ignores the scope
  // and denies outright. Both handlers are stable callbacks declared
  // above the `!isPending` early return — see the comment alongside
  // `handleAllow`.
  //
  // `cancelRole="action"` opts out of the family's outlined-danger
  // default ([D03]) — see the [D02] / [Q03] carve-out: `Deny` is a
  // positive decision (`respondApproval({decision: "deny"})`), not a
  // walk-away. Keeping the cancel button outlined-action preserves
  // the existing permission-flow visual vocabulary.
  return (
    <TideInteractiveDialog
      icon={<ShieldAlert />}
      iconRole="caution"
      title="Permission requested"
      description={
        <PermissionDescription
          toolName={toolName}
          input={request.input}
          decisionReason={decisionReason}
        />
      }
      confirmLabel="Allow"
      confirmRole="action"
      cancelLabel="Deny"
      cancelRole="action"
      onConfirm={handleAllow}
      onCancel={handleDeny}
      options={allowOptions}
      selectedOption={selectedOption}
      onSelectOption={setSelectedOption}
      optionsAriaLabel="Permission scope"
      className={className}
    >
      <PendingBody toolName={toolName} input={request.input} />
    </TideInteractiveDialog>
  );
};
