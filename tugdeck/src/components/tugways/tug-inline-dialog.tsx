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
 *   - `children` — free-form region between description and any
 *     options/actions (body picker, supplementary content). Left-aligned
 *     with the description text column.
 *   - `options` + `selectedOption` + `onSelectOption` — optional radio
 *     group of `TugDialogButton`s rendered between the children slot
 *     and the actions row. Mandatory single-select: clicking a row
 *     picks it; the only escape from the choice is the cancel
 *     button. Consumers read `selectedOption` from their own state to
 *     decide what `onConfirm` should commit.
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
 *   |         [options — radio TugDialogButton]|
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
 *    lifecycle and the `selectedOption` value when options are used).
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
import { TugDialogButton } from "./tug-dialog-button";
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
 * Cancel-button color domain. Same union as confirm, but applies to
 * the leading-edge outlined button — `danger` reads as a "walk-away"
 * destructive-secondary in the Mac HIG vocabulary.
 */
export type TugInlineDialogCancelRole = "action" | "danger";

/**
 * Descriptor for a single option in the dialog's radio group. Options
 * are mandatory-single-select per the [#step-18-6] design preview:
 * one is always chosen, and the only path out of the choice is the
 * dialog's cancel button (the off-ramp).
 *
 * Consumers (e.g. `PermissionDialog`'s `permission_suggestions` flow,
 * future `QuestionDialog`'s option list) build an array of these and
 * pair it with a `selectedOption` value + `onSelectOption` callback.
 * Reading the selected value at confirm time is the consumer's job —
 * the primitive is presentational only.
 */
export interface TugInlineDialogOption {
  /** Stable identifier; matched against {@link TugInlineDialogProps.selectedOption}. */
  value: string;
  /** Sentence-case label shown on the option's row (NOT uppercased). */
  label: string;
  /**
   * Optional rich description rendered below the label, muted. ReactNode
   * so consumers can embed inline `<code>`, links, small icons.
   */
  description?: React.ReactNode;
  /**
   * Color domain for the row. `action` (default) paints the standard
   * outline; `danger` paints the destructive variant. The selection
   * affordance picks up the row's role tint per `TugDialogButton`'s
   * cascade.
   *
   * @default "action"
   */
  role?: "action" | "danger";
  /** Accessibility label override (defaults to {@link label}). */
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
   * and the dialog's options/actions block. For an Edit confirm: a
   * `DiffBlock`. For a question: supplementary context. *Choices go
   * on `options` instead* — the primitive owns the radio-group
   * layout, ARIA semantics, and selection rendering.
   *
   * Left-aligned with the description text column (not the icon).
   */
  children?: React.ReactNode;
  /**
   * Optional radio-group of choices. Rendered between the children
   * slot and the cancel/confirm row, one row per choice
   * ([#step-18-6] one-per-row pattern). When set, consumers MUST
   * also provide {@link selectedOption} + {@link onSelectOption}; the
   * group is mandatory-single-select (no toggle-off — the cancel
   * button is the off-ramp).
   */
  options?: ReadonlyArray<TugInlineDialogOption>;
  /**
   * The currently selected option's `value`. Required when {@link
   * options} is set; ignored otherwise. The primitive is fully
   * controlled — it never tracks the selection internally.
   */
  selectedOption?: string;
  /**
   * Fired when the user picks a different option. Required when
   * {@link options} is set. The handler should set the consumer's
   * state to the new `value`; do not implement a toggle-off path here
   * — radio semantics mean exactly one option is always chosen.
   */
  onSelectOption?: (value: string) => void;
  /**
   * Optional ARIA label for the radio-group container. Defaults to
   * the dialog's title when omitted. Useful when the title alone
   * isn't a faithful description of what the radio group selects
   * (e.g. "Permission requested" + a scope picker).
   */
  optionsAriaLabel?: string;
  /** Primary action label. */
  confirmLabel: string;
  /**
   * Confirm-button color domain. `action` → filled-action (default),
   * `danger` → filled-danger.
   *
   * @default "action"
   */
  confirmRole?: TugInlineDialogConfirmRole;
  /**
   * Visually + behaviorally disable the confirm button. Use this when
   * the dialog gates submission on local state (e.g. the question
   * wizard waits until all questions are answered before lighting up
   * "Submit all"). The button stays in the tab order and announces
   * `aria-disabled="true"`, mirroring TugButton's chain-action gate
   * — never the HTML `disabled` so screen readers still read the
   * label and the focus stack doesn't shift on each toggle.
   *
   * @default false
   */
  confirmDisabled?: boolean;
  /** Fired when the user clicks the confirm button. */
  onConfirm: () => void;
  /**
   * Cancel button label. Defaults to {@link DEFAULT_CANCEL_LABEL}.
   * Pass `null` to suppress the cancel button entirely.
   *
   * @default "Cancel"
   */
  cancelLabel?: string | null;
  /**
   * Cancel-button colour domain. `"action"` (the default) renders the
   * cancel as an outlined-action — same neutral tone as the existing
   * permission and alert flows. `"danger"` renders it as an
   * outlined-danger so it reads as a "walk away from this" choice
   * (Mac HIG `Don't Save` vocabulary) — the question dialog uses
   * this so the leading-edge button visibly differs from the
   * trailing-edge primary.
   *
   * @default "action"
   */
  cancelRole?: TugInlineDialogCancelRole;
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
 * Whether the options block should render. False when the array is
 * absent or empty. Pure; exported for tests.
 */
export function shouldRenderOptions(
  options: ReadonlyArray<TugInlineDialogOption> | undefined,
): boolean {
  return options !== undefined && options.length > 0;
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
  options,
  selectedOption,
  onSelectOption,
  optionsAriaLabel,
  confirmLabel,
  confirmRole = "action",
  confirmDisabled = false,
  onConfirm,
  cancelLabel,
  cancelRole = "action",
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
  const renderOptions = shouldRenderOptions(options);

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
      {renderOptions ? (
        <div
          className="tug-inline-dialog-options"
          data-slot="tug-inline-dialog-options"
          role="radiogroup"
          aria-label={optionsAriaLabel ?? title}
        >
          {options!.map((option) => (
            <TugDialogButton
              key={option.value}
              label={option.label}
              description={option.description}
              role={option.role}
              selected={selectedOption === option.value}
              selectionStyle="radio"
              ariaLabel={option.ariaLabel}
              onClick={() => onSelectOption?.(option.value)}
            />
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
            role={cancelRole}
            onClick={onCancel}
          >
            {resolvedCancelLabel}
          </TugPushButton>
        ) : null}
        <TugPushButton
          ref={confirmRef}
          emphasis="filled"
          role={confirmRole}
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </TugPushButton>
      </div>
    </div>
  );
};
