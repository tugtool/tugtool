/**
 * TugCheckbox — Accessible checkbox with checked, unchecked, and indeterminate states.
 *
 * Wraps @radix-ui/react-checkbox. Supports three checked states (checked, unchecked,
 * indeterminate), inline label, size variants, disabled state, and role-based color
 * injection via CSS custom properties.
 *
 * Control semantics (L11): user activation dispatches a `toggle` action
 * through the responder chain with the new boolean state as `value`
 * and a stable `sender` id for parent disambiguation. Parent
 * responders register a `toggle` action handler via `useResponder`
 * that switches on `event.sender` to route updates to the right state.
 * There is no `onCheckedChange` callback prop — the chain is the sole
 * mechanism for communicating state changes outward.
 *
 * Laws: [L06] appearance via CSS, [L11] controls emit actions,
 *       [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide
 * Decisions: [D03] appearance via stylesheet injection, [D05] component token naming,
 *            [D06] components/tugways public API
 */

import "./tug-checkbox.css";

import React, { useCallback, useId } from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { useResponderChain } from "./responder-chain-provider";
import { TUG_ACTIONS } from "./action-vocabulary";

// ---- Types ----

/** Checkbox size names — matches TugInput/TugButton sizes */
export type TugCheckboxSize = "sm" | "md" | "lg";

/** Re-export Radix checked state for convenience */
export type TugCheckedState = boolean | "indeterminate";

/**
 * Semantic role for the checkbox on-state color.
 *
 * Omit the role prop (or leave undefined) for the theme's accent color.
 * Explicit roles override with a semantic signal color.
 *
 * @selector [data-role="<role>"]
 */
export type TugCheckboxRole =
  | "option"
  | "action"
  | "agent"
  | "data"
  | "success"
  | "caution"
  | "danger";

/**
 * Maps role prop values to toggle-primary token suffixes.
 * The prop API uses "action" but the token system uses "active"
 * (e.g., --tug7-surface-toggle-primary-normal-active-rest).
 * "accent" is not in this map — it's the implicit default when no role is provided.
 *
 * NOTE: the `action` key here is a role-prop value, not a chain-action
 * name from `TUG_ACTIONS`. The two `action` namespaces are unrelated;
 * audit greps for `action:\s*"…"` will surface this line as a false
 * positive — it is not a dispatch site.
 */
const ROLE_TOKEN_MAP: Record<string, string> = {
  option:  "option",
  action:  "active",
  agent:   "agent",
  data:    "data",
  success: "success",
  caution: "caution",
  danger:  "danger",
};

/** TugCheckbox props. */
export interface TugCheckboxProps {
  /**
   * Controlled checked state. Supports true, false, or "indeterminate".
   * @selector [data-state="checked"] | [data-state="unchecked"] | [data-state="indeterminate"]
   */
  checked?: TugCheckedState;
  /** Default checked state (uncontrolled). */
  defaultChecked?: TugCheckedState;
  /**
   * Stable identifier passed as `event.sender` on every `toggle`
   * action dispatched by this checkbox. Parent responders use this
   * to disambiguate multi-checkbox forms in their `toggle` handler.
   * Defaults to a `useId()`-derived unique string — set explicitly
   * when the parent needs a predictable id (e.g. for form routing
   * by semantic name).
   */
  senderId?: string;
  /** Inline label text. Renders a wrapping label element. */
  label?: string;
  /**
   * Visual size variant.
   * @selector .tug-checkbox-size-sm | .tug-checkbox-size-md | .tug-checkbox-size-lg
   * @default "md"
   */
  size?: TugCheckboxSize;
  /**
   * Disables the checkbox.
   * @selector :disabled | [data-disabled]
   * @default false
   */
  disabled?: boolean;
  /** Form field name. */
  name?: string;
  /** Form field value. */
  value?: string;
  /**
   * Marks the field as required for form validation.
   * @default false
   */
  required?: boolean;
  /** Additional CSS class names on the wrapper element. */
  className?: string;
  /** Accessibility label when no visible label is provided. */
  "aria-label"?: string;
  /**
   * Semantic role for the on-state color. Omit for the theme's accent color.
   * Injects --tugx-toggle-on-color, --tugx-toggle-on-hover-color, and
   * --tugx-toggle-disabled-color as inline CSS custom properties.
   *
   * Single path, zero branches. [L06]
   *
   * @selector [data-role="<role>"]
   */
  role?: TugCheckboxRole;
}

// ---- TugCheckbox ----

export const TugCheckbox = React.forwardRef<HTMLButtonElement, TugCheckboxProps>(
  function TugCheckbox(
    {
      checked,
      defaultChecked,
      senderId,
      label,
      size = "md",
      disabled = false,
      name,
      value,
      required = false,
      className,
      "aria-label": ariaLabel,
      role,
      ...rest
    },
    ref,
  ) {
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // Chain dispatch [L11]: on user activation, dispatch a `toggle`
    // action through the responder chain with the new boolean state
    // as `value` and a stable sender id. If no ResponderChainProvider
    // is mounted (e.g. unit tests, standalone preview), the dispatch
    // is a no-op — the Radix primitive still tracks internal state
    // for uncontrolled usage.
    const manager = useResponderChain();
    const fallbackId = useId();
    const effectiveSenderId = senderId ?? fallbackId;
    const handleCheckedChange = useCallback(
      (next: TugCheckedState) => {
        if (!manager) return;
        // Radix only emits `boolean` on user activation; the
        // "indeterminate" state is programmatic-only. Coerce
        // defensively so the `toggle` payload contract (boolean) is
        // never violated even if Radix emits it unexpectedly.
        const nextBool = next === true;
        manager.dispatch({
          action: TUG_ACTIONS.TOGGLE,
          value: nextBool,
          sender: effectiveSenderId,
          phase: "discrete",
        });
      },
      [manager, effectiveSenderId],
    );

    // Role injection — every path injects surface-toggle-primary tokens. [L06]
    // No role prop = accent. Single path, zero branches.
    const tokenSuffix = role ? (ROLE_TOKEN_MAP[role] ?? role) : "accent";
    const roleStyle = {
      "--tugx-toggle-on-color": `var(--tug7-surface-toggle-primary-normal-${tokenSuffix}-rest)`,
      "--tugx-toggle-on-hover-color": `var(--tug7-surface-toggle-primary-normal-${tokenSuffix}-hover)`,
      "--tugx-toggle-disabled-color": `var(--tug7-surface-toggle-primary-normal-${tokenSuffix}-disabled)`,
    } as React.CSSProperties;

    const checkboxNode = (
      <CheckboxPrimitive.Root
        ref={ref}
        data-slot="tug-checkbox"
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={handleCheckedChange}
        disabled={effectiveDisabled}
        name={name}
        value={value}
        required={required}
        aria-label={!label ? ariaLabel : undefined}
        className={cn("tug-checkbox", `tug-checkbox-size-${size}`, !label && className)}
        style={roleStyle}
        data-role={role}
        data-tug-focus="refuse"
        {...rest}
      >
        <CheckboxPrimitive.Indicator className="tug-checkbox-indicator">
          <span className="tug-checkbox-icon-check" aria-hidden="true">
            <Check />
          </span>
          <span className="tug-checkbox-icon-mixed" aria-hidden="true">
            <Minus />
          </span>
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );

    if (!label) {
      return checkboxNode;
    }

    return (
      <label
        className={cn(
          "tug-checkbox-wrapper",
          effectiveDisabled && "tug-checkbox-wrapper-disabled",
          className,
        )}
      >
        {checkboxNode}
        <span className={cn("tug-checkbox-label", `tug-checkbox-label-${size}`)}>
          {label}
        </span>
      </label>
    );
  },
);
