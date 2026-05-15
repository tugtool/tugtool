/**
 * `TugInlineDialog` — inline confirm/cancel dialog primitive.
 *
 * The inline counterpart to `TugAlert`: same icon-left / title +
 * description-right / actions-bottom-right proportions, but rendered
 * inline in transcript flow (or any other ambient layout) rather than
 * as an app-modal overlay. Used as the visual primitive for
 * permission prompts ([D13]), upcoming question dialogs ([#step-19]),
 * and any future inline-CTA confirm need.
 *
 * Public surface (see `TugInlineDialogProps` for the full contract):
 *
 *   - `icon` — any React node; the consumer chooses the shape.
 *   - `iconRole` — tone for the icon's `color` (one of five named
 *     roles). The fixed 48 px shape and size match `TugAlert` so the
 *     two read as the same family; the `color` token differs per role.
 *   - `title` — strong CTA, plain string, 1 rem / 600 / leading 1.4.
 *   - `description` — rich ReactNode; can carry inline icons and
 *     `<code>`. The cohesive sentence belongs here; do not fragment
 *     the same idea across multiple slots.
 *   - `children` — free-form region between description and actions
 *     (body picker, secondary buttons). Left-aligned with the
 *     description text column.
 *   - `confirmLabel` + `confirmRole` — the primary action, always
 *     right-most, filled-{role}.
 *   - `cancelLabel` + `onCancel` — the cancel action, immediately to
 *     the left of confirm; `cancelLabel: null` suppresses the cancel
 *     button entirely (single-action dialogs).
 *
 * Layout (`max-width` ~520 px via `--tugx-idialog-max-width`):
 *
 *   +------------------------------------------+
 *   | [Icon]  Title                            |
 *   |         Description (ReactNode)          |
 *   |         [children]                       |
 *   |                                          |
 *   |                  [Cancel]  [Confirm]     |
 *   +------------------------------------------+
 *
 * The dialog is centered horizontally via `margin: auto` and never
 * stretches to fill its container — uniform CTA presence wherever it
 * mounts.
 *
 * Laws:
 *  - [L06] appearance via DOM attributes (`data-icon-role`) + CSS, not
 *    React state. The `iconRole` flips a CSS selector; the icon's
 *    `color` is owned by the rule, not by inline `style`.
 *  - [L17] every `--tugx-idialog-*` slot resolves to a `--tug7-*` /
 *    `--tug-*` base token in one hop.
 *  - [L19] component authoring guide — file pair, module docstring,
 *    exported props interface, `data-slot="tug-inline-dialog"` on the
 *    root.
 *  - [L20] component-token sovereignty — owns the `--tugx-idialog-*`
 *    slot family ([Table T07]); composes no other component's tokens.
 *  - [L24] state zoning — no React state inside the primitive (it is
 *    a stateless presentation surface; consumers own the open/close
 *    lifecycle).
 *
 * Decisions:
 *  - [D13] inline (not modal) prompts; primary action focused on
 *    mount via `useLayoutEffect` so a Return key answers the prompt.
 *
 * @module components/tugways/tug-inline-dialog
 */

import "./tug-inline-dialog.css";

import React from "react";

import { cn } from "@/lib/utils";
import { TugPushButton } from "./tug-push-button";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Tone for the icon's foreground tint. Maps to a `--tugx-idialog-icon-{role}-color` slot. */
export type TugInlineDialogIconRole =
  | "default"
  | "caution"
  | "danger"
  | "success"
  | "info";

/**
 * Confirm-button color domain. `action` paints the standard primary
 * action; `danger` paints destructive-confirm chrome (Discard, Delete).
 */
export type TugInlineDialogConfirmRole = "action" | "danger";

/**
 * Descriptor for a secondary action button rendered above the
 * cancel/confirm row. Consumers (e.g. `PermissionDialog` for its
 * `permission_suggestions`, `QuestionDialog` for its `options`) pass
 * an array of these and the primitive lays them out in a balanced
 * row-grid via `partitionDialogActions` — the *primitive* owns the
 * layout, so consumers don't reinvent it.
 */
export interface TugInlineDialogAction {
  /** Visible label (`TugPushButton` will uppercase + letter-space it). */
  label: string;
  /** Click handler. */
  onClick: () => void;
  /**
   * Color domain. `action` is the default outline-action; `danger`
   * paints the destructive outline-danger.
   *
   * @default "action"
   */
  role?: "action" | "danger";
  /** Accessibility label override (icon-only / ambiguous-label cases). */
  ariaLabel?: string;
}

export interface TugInlineDialogProps {
  /**
   * Icon node — typically a Lucide component. The primitive sizes the
   * column to 48 px and tints the rendered icon's `color` via
   * `iconRole`; the consumer chooses the shape.
   */
  icon: React.ReactNode;
  /**
   * Tone for the icon's foreground tint. Maps to the
   * `--tugx-idialog-icon-{role}-color` token slots, which resolve to
   * `--tug7-*` icon / text colors in one hop.
   *
   * @default "default"
   */
  iconRole?: TugInlineDialogIconRole;
  /** Strong call-to-action title. Plain string. */
  title: string;
  /**
   * Rich description — ReactNode so consumers can embed inline icons
   * and `<code>` (e.g. `"This command requires approval · "` +
   * `<Shell />` + `" Bash · "` + `<code>tokei</code>`). The cohesive
   * sentence belongs here; do not fragment the same idea across
   * multiple slots.
   */
  description: React.ReactNode;
  /**
   * Free-form region inside the text column between the description
   * and the dialog's actions block. For an Edit confirm: a
   * `DiffBlock`. For a question: the option list. For arbitrary
   * inline content. *Buttons go on `extraActions` instead* — the
   * primitive owns their grid layout.
   *
   * Left-aligned with the description text column (not the icon).
   */
  children?: React.ReactNode;
  /**
   * Secondary action buttons. Rendered above the cancel/confirm row,
   * laid out in a balanced row-grid by {@link partitionDialogActions}
   * (1 → half-width single button, 2 → 50/50, 3 → 33/33/33,
   * 4 → 2 over 2, 5 → 3 over 2, 6 → 3 over 3, 7+ → continues the
   * same partition). Empty / omitted → no extra-actions block.
   */
  extraActions?: ReadonlyArray<TugInlineDialogAction>;
  /** Primary action label. */
  confirmLabel: string;
  /**
   * Confirm-button color domain. `action` → filled-action (default),
   * `danger` → filled-danger.
   *
   * @default "action"
   */
  confirmRole?: TugInlineDialogConfirmRole;
  /** Fired when the user clicks the confirm button. */
  onConfirm: () => void;
  /**
   * Cancel button label. Defaults to {@link DEFAULT_CANCEL_LABEL}.
   * Pass `null` to suppress the cancel button entirely.
   *
   * @default "Cancel"
   */
  cancelLabel?: string | null;
  /** Fired when the user clicks the cancel button. Ignored when `cancelLabel` is `null`. */
  onCancel?: () => void;
  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for the test suite.
// ---------------------------------------------------------------------------

/** Default cancel-button label when the consumer omits `cancelLabel`. */
export const DEFAULT_CANCEL_LABEL = "Cancel";

/** Every {@link TugInlineDialogIconRole}, in declaration order. Pinned for tests. */
export const TUG_INLINE_DIALOG_ICON_ROLES: ReadonlyArray<TugInlineDialogIconRole> =
  ["default", "caution", "danger", "success", "info"];

/**
 * Map an icon role to its `--tugx-idialog-icon-{role}-color` slot
 * name. Pure; exported so tests can pin the contract that every
 * declared role has a matching token slot.
 */
export function iconRoleSlot(role: TugInlineDialogIconRole): string {
  return `--tugx-idialog-icon-${role}-color`;
}

/**
 * Resolve the cancel-label to render. Returns `null` for the
 * "suppress the cancel button" branch (consumer passed `null`
 * explicitly), the default label when the consumer omits the prop,
 * and the consumer's value otherwise. Pure; exported for tests.
 */
export function resolveCancelLabel(
  cancelLabel: string | null | undefined,
): string | null {
  if (cancelLabel === null) return null;
  return cancelLabel ?? DEFAULT_CANCEL_LABEL;
}

/**
 * Partition `n` extra-action buttons into rows whose widths read as a
 * deliberate CTA grid rather than a chaotic wrap. The pattern caps
 * each row at 3 buttons and balances trailing partial rows so a
 * lonely last button never dangles:
 *
 *   - 1 → [1]   (one button, rendered at half-width)
 *   - 2 → [2]   (one row of two, 50/50)
 *   - 3 → [3]   (one row of three, 33/33/33)
 *   - 4 → [2,2]
 *   - 5 → [3,2]
 *   - 6 → [3,3]
 *   - 7 → [3,2,2]   (avoids a 1-button trailing row)
 *   - 8 → [3,3,2]
 *   - 9 → [3,3,3]
 *   - N → top rows of 3 with a balanced 2-row tail per the same rule.
 *
 * Pure; returns an empty array for `n <= 0`. Exported so the test
 * suite can pin every bucket.
 */
export function partitionDialogActions(n: number): number[] {
  if (n <= 0) return [];
  if (n <= 3) return [n];
  if (n === 4) return [2, 2];
  const remainder = n % 3;
  const fullRows = Math.floor(n / 3);
  if (remainder === 0) return Array(fullRows).fill(3);
  if (remainder === 2) return [...Array(fullRows).fill(3), 2];
  // remainder === 1 — replace one 3-row with two 2-rows so the last
  // row carries 2 buttons instead of dangling 1.
  return [...Array(fullRows - 1).fill(3), 2, 2];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Inline confirm/cancel dialog primitive. See module docstring for the
 * layout, prop contract, and law cross-check.
 */
export const TugInlineDialog: React.FC<TugInlineDialogProps> = ({
  icon,
  iconRole = "default",
  title,
  description,
  children,
  extraActions,
  confirmLabel,
  confirmRole = "action",
  onConfirm,
  cancelLabel,
  onCancel,
  className,
}) => {
  const confirmRef = React.useRef<HTMLButtonElement | null>(null);

  // [D13] — focus the primary action button on mount so a Return key
  // answers the prompt without an explicit click. Mount-once: the
  // primitive itself doesn't track open/close (stateless); a re-mount
  // is the consumer's signal to refocus.
  React.useLayoutEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const resolvedCancelLabel = resolveCancelLabel(cancelLabel);
  const hasChildren = children !== undefined && children !== null && children !== false;

  // Lay extra actions out into rows per `partitionDialogActions`.
  // Memoized on the array reference + length so the layout is stable
  // when the consumer's array doesn't change identity.
  const extraActionRows = React.useMemo<
    ReadonlyArray<{ count: number; entries: ReadonlyArray<TugInlineDialogAction> }>
  >(() => {
    const list = extraActions ?? [];
    if (list.length === 0) return [];
    const counts = partitionDialogActions(list.length);
    const rows: { count: number; entries: ReadonlyArray<TugInlineDialogAction> }[] = [];
    let cursor = 0;
    for (const count of counts) {
      rows.push({ count, entries: list.slice(cursor, cursor + count) });
      cursor += count;
    }
    return rows;
  }, [extraActions]);

  return (
    <div
      data-slot="tug-inline-dialog"
      data-icon-role={iconRole}
      className={cn("tug-inline-dialog", className)}
    >
      <div className="tug-inline-dialog-body-row">
        <div className="tug-inline-dialog-icon" aria-hidden="true">
          {icon}
        </div>
        <div className="tug-inline-dialog-text">
          <h3 className="tug-inline-dialog-title">{title}</h3>
          <div className="tug-inline-dialog-description">{description}</div>
          {hasChildren ? (
            <div
              className="tug-inline-dialog-children"
              data-slot="tug-inline-dialog-children"
            >
              {children}
            </div>
          ) : null}
        </div>
      </div>
      {extraActionRows.length > 0 ? (
        <div
          className="tug-inline-dialog-extra-actions"
          data-slot="tug-inline-dialog-extra-actions"
        >
          {extraActionRows.map((row, rowIdx) => (
            <div
              key={rowIdx}
              className="tug-inline-dialog-extra-actions-row"
              data-count={row.count}
            >
              {row.entries.map((action, idx) => (
                <TugPushButton
                  key={idx}
                  emphasis="outlined"
                  role={action.role ?? "action"}
                  onClick={action.onClick}
                  aria-label={action.ariaLabel}
                >
                  {action.label}
                </TugPushButton>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <div
        className="tug-inline-dialog-actions"
        data-slot="tug-inline-dialog-actions"
      >
        {resolvedCancelLabel !== null ? (
          <TugPushButton
            emphasis="outlined"
            role="action"
            onClick={onCancel}
          >
            {resolvedCancelLabel}
          </TugPushButton>
        ) : null}
        <TugPushButton
          ref={confirmRef}
          emphasis="filled"
          role={confirmRole}
          onClick={onConfirm}
        >
          {confirmLabel}
        </TugPushButton>
      </div>
    </div>
  );
};
