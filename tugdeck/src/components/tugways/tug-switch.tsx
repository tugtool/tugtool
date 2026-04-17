/**
 * TugSwitch — Toggle switch with track and thumb.
 *
 * Wraps @radix-ui/react-switch. Supports size variants, inline label,
 * disabled state, and role-based color injection via CSS custom properties.
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

import "./tug-switch.css";

import React, { useCallback, useId } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { useControlDispatch } from "./use-control-dispatch";
import { TUG_ACTIONS } from "./action-vocabulary";

// ---- Types ----

/** Switch size names — matches TugCheckbox/TugInput/TugButton sizes */
export type TugSwitchSize = "xs" | "sm" | "md" | "lg";

/**
 * Semantic role for the switch on-state color.
 *
 * Omit the role prop (or leave undefined) for the theme's accent color.
 * Explicit roles override with a semantic signal color.
 *
 * @selector [data-role="<role>"]
 */
export type TugSwitchRole =
  | "option"
  | "action"
  | "agent"
  | "data"
  | "success"
  | "caution"
  | "danger";

/**
 * Maps role prop values to toggle-track token suffixes.
 * The prop API uses "action" but the token system uses "active"
 * (e.g., --tug7-surface-toggle-track-normal-active-rest).
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

/** TugSwitch props. */
export interface TugSwitchProps {
  /**
   * Controlled checked state.
   * @selector [data-state="checked"] | [data-state="unchecked"]
   */
  checked?: boolean;
  /** Default checked state (uncontrolled). */
  defaultChecked?: boolean;
  /**
   * Stable identifier passed as `event.sender` on every `toggle`
   * action dispatched by this switch. Parent responders use this to
   * disambiguate multi-switch forms in their `toggle` handler.
   * Defaults to a `useId()`-derived unique string — set explicitly
   * when the parent needs a predictable id (e.g. for form routing
   * by semantic name).
   */
  senderId?: string;
  /** Inline label text. Renders a wrapping label element. */
  label?: string;
  /**
   * Visual size variant.
   * @selector .tug-switch-size-xs | .tug-switch-size-sm | .tug-switch-size-md | .tug-switch-size-lg
   * @default "md"
   */
  size?: TugSwitchSize;
  /**
   * Disables the switch.
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
   * Semantic role for the on-state track color. Omit for the theme's accent color.
   * Injects --tugx-toggle-on-color, --tugx-toggle-on-hover-color, and
   * --tugx-toggle-disabled-color as inline CSS custom properties.
   *
   * Single path, zero branches. [L06]
   *
   * @selector [data-role="<role>"]
   */
  role?: TugSwitchRole;
}

// ---- TugSwitch ----

export const TugSwitch = React.forwardRef<HTMLButtonElement, TugSwitchProps>(
  function TugSwitch(
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

    // Chain dispatch [L11]: targeted dispatch of `toggle` to the
    // parent responder with the new boolean state as `value` and a
    // stable sender id. Outside a provider the dispatch is a no-op.
    const { dispatch: controlDispatch } = useControlDispatch();
    const fallbackId = useId();
    const effectiveSenderId = senderId ?? fallbackId;
    const handleCheckedChange = useCallback(
      (next: boolean) => {
        controlDispatch({
          action: TUG_ACTIONS.TOGGLE,
          value: next,
          sender: effectiveSenderId,
          phase: "discrete",
        });
      },
      [controlDispatch, effectiveSenderId],
    );

    // Role injection — every path injects surface-toggle-track tokens. [L06]
    // No role prop = accent. Single path, zero branches.
    const tokenSuffix = role ? (ROLE_TOKEN_MAP[role] ?? role) : "accent";
    const roleStyle = {
      "--tugx-toggle-on-color": `var(--tug7-surface-toggle-track-normal-${tokenSuffix}-rest)`,
      "--tugx-toggle-on-hover-color": `var(--tug7-surface-toggle-track-normal-${tokenSuffix}-hover)`,
      "--tugx-toggle-disabled-color": `var(--tug7-surface-toggle-track-normal-${tokenSuffix}-disabled)`,
    } as React.CSSProperties;

    const switchNode = (
      <SwitchPrimitive.Root
        ref={ref}
        data-slot="tug-switch"
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={handleCheckedChange}
        disabled={effectiveDisabled}
        name={name}
        value={value}
        required={required}
        aria-label={!label ? ariaLabel : undefined}
        className={cn("tug-switch", `tug-switch-size-${size}`, !label && className)}
        style={roleStyle}
        data-role={role}
        data-tug-focus="refuse"
        {...rest}
      >
        <SwitchPrimitive.Thumb className="tug-switch-thumb" />
      </SwitchPrimitive.Root>
    );

    if (!label) {
      return switchNode;
    }

    return (
      <label
        className={cn(
          "tug-switch-wrapper",
          effectiveDisabled && "tug-switch-wrapper-disabled",
          className,
        )}
      >
        {switchNode}
        <span className={cn("tug-switch-label", `tug-switch-label-${size}`)}>
          {label}
        </span>
      </label>
    );
  },
);
