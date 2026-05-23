/**
 * `TideInteractiveDialog` — the input-form primitive for the Tide
 * interactive-dialog family.
 *
 * Composes on top of {@link TugInlineDialog} with two opinionated
 * defaults that distinguish the *interactive-dialog family*
 * (`PermissionDialog`, `QuestionDialog`) from one-shot alert / confirm
 * callsites of the underlying primitive:
 *
 *   1. `cancelRole` defaults to `"danger"` (outlined-danger), reading
 *      as a destructive-secondary "walk away from this" choice — Mac
 *      HIG `Don't Save` vocabulary.
 *   2. The actions row uses `justify-content: space-between` — the
 *      cancel button anchors the leading edge, the primary action
 *      anchors the trailing edge, with a generous gap between them
 *      so the two read as opposed choices rather than a tightly-
 *      grouped pair. CSS scopes the override via the published
 *      `[data-slot="tug-inline-dialog-actions"]` surface on
 *      `TugInlineDialog`, never the inner primitive's private class
 *      names — composition through documented surfaces only.
 *
 * Beyond those two defaults the primitive is a pure pass-through —
 * every other `TugInlineDialog` prop flows unchanged.
 *
 * **Family cancel convention.** Across the interactive-dialog family
 * the cancel callback resolves to `session.popInteractive()` — the
 * unified Stop / Esc / Cancel gesture. This primitive does not wire
 * the session reference itself (callers own that); the convention
 * lives in the callsite. The corresponding Esc handler lives on the
 * prompt entry's responder, reached via the `CANCEL_DIALOG` action.
 *
 * **Scope.** The primitive owns the *pending input-form chrome* only,
 * not lifecycle transitions. PermissionDialog's pending → resolved →
 * recorded state machine stays inside `PermissionDialog`;
 * AskUserQuestion's transcript-position rendering stays in its tool
 * block. The primitive never sees a non-pending state.
 *
 * **Carve-outs** — gestures that look like "cancel" but are not pops
 * (and therefore do not follow the family `Cancel ≡ popInteractive`
 * rule):
 *
 *   - `PermissionDialog`'s `Deny` is a *positive decision* via
 *     `respondApproval({decision: "deny"})`, not a walk-away. That
 *     callsite passes `cancelRole="action"` explicitly to opt out of
 *     the family danger-tone default, and its `onCancel` handler
 *     dispatches the deny decision rather than `popInteractive`.
 *   - `AskUserQuestionToolBlock`'s salvage UI `Cancel` is a *local
 *     dismissal* of the recovery surface — the failed tool call has
 *     already resolved with an error before the salvage UI mounts,
 *     so there is no pending interactive on the stack to pop. The
 *     salvage UI is not an input form and therefore not in this
 *     primitive's territory.
 *
 * Laws:
 *   - [L19] component-authoring guide — file pair, module docstring,
 *     exported props interface, exported pure helpers (`DEFAULT_CANCEL_ROLE`,
 *     `resolveCancelRole`). The rendered root is `TugInlineDialog`'s
 *     own root (`data-slot="tug-inline-dialog"`); the primitive
 *     contributes only the `.tide-interactive-dialog` className for
 *     CSS scoping. The family identifier is the className, not a
 *     separate data-slot, because the primitive owns no DOM of its
 *     own — it is a typed configuration layer over `TugInlineDialog`.
 *   - [L20] composition sovereignty — the primitive's CSS reaches
 *     into `TugInlineDialog`'s subtree only through the published
 *     `data-slot="tug-inline-dialog-actions"` surface, never the
 *     internal `.tug-inline-dialog-actions` class. A future
 *     refactor of `TugInlineDialog`'s class naming will not break
 *     this composition.
 *   - [L26] mount identity — the primitive is a stateless function
 *     component that returns the same React element shape every
 *     render. Consumers migrating a callsite from `TugInlineDialog`
 *     to `TideInteractiveDialog` change only the wrapping symbol;
 *     the resulting React element tree retains stable key /
 *     component-type / renderer-reference identity at the consumer's
 *     position, so React reconciliation continues to preserve any
 *     DOM- or instance-resident state inside the dialog.
 *
 * Decisions:
 *   - [D01] new primitive composes on `TugInlineDialog`; the base
 *     primitive is not modified.
 *   - [D02] cancel ≡ Esc ≡ `popInteractive` is a family convention,
 *     enforced at the callsite (where the session reference lives),
 *     not inside this primitive.
 *   - [D03] cancel button visual: outlined-danger leading edge,
 *     space-between actions row.
 *   - [D08] primitive is input-form only; no lifecycle ownership.
 *
 * @module components/tugways/tide-interactive-dialog
 */

import "./tide-interactive-dialog.css";

import React from "react";

import { cn } from "@/lib/utils";
import {
  TugInlineDialog,
  type TugInlineDialogCancelRole,
  type TugInlineDialogProps,
} from "./tug-inline-dialog";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Prop contract for `TideInteractiveDialog`. Mirrors
 * {@link TugInlineDialogProps} except `cancelRole` defaults to
 * `"danger"` (the family vocabulary) instead of `"action"`.
 *
 * Callers that need the outlined-action tone (a *positive decision*
 * rather than a walk-away — e.g., `PermissionDialog`'s `Deny`) pass
 * `cancelRole="action"` explicitly to opt out of the family default.
 */
export interface TideInteractiveDialogProps
  extends Omit<TugInlineDialogProps, "cancelRole"> {
  /**
   * Cancel-button colour domain. Defaults to `"danger"` for the
   * interactive-dialog family — read as a destructive-secondary
   * "walk away" choice. Pass `"action"` to opt out (e.g., a
   * `PermissionDialog` `Deny` that should keep the outlined-action
   * tone since it is a positive decision rather than a walk-away).
   *
   * @default "danger"
   */
  cancelRole?: TugInlineDialogCancelRole;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for the test suite.
// ---------------------------------------------------------------------------

/**
 * Default cancel-button role for the interactive-dialog family. See
 * the module docstring and `[D03]` for the rationale.
 */
export const DEFAULT_CANCEL_ROLE: TugInlineDialogCancelRole = "danger";

/**
 * Resolve the cancel-role to apply. Returns the caller's value when
 * present, the family default otherwise. Pure; exported for tests.
 */
export function resolveCancelRole(
  callerRole: TugInlineDialogCancelRole | undefined,
): TugInlineDialogCancelRole {
  return callerRole ?? DEFAULT_CANCEL_ROLE;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Input-form primitive for the Tide interactive-dialog family. See
 * module docstring for the prop contract, default-substitution
 * behaviour, family carve-outs, and tuglaw cross-check.
 */
export const TideInteractiveDialog: React.FC<TideInteractiveDialogProps> = ({
  cancelRole,
  className,
  ...rest
}) => {
  return (
    <TugInlineDialog
      {...rest}
      cancelRole={resolveCancelRole(cancelRole)}
      className={cn("tide-interactive-dialog", className)}
    />
  );
};
