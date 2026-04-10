/**
 * TugRadioGroup — Mutually exclusive selection from a set of options.
 *
 * Wraps @radix-ui/react-radio-group. Each item is a TugButton (ghost emphasis,
 * icon-text subtype) hosting a radio circle indicator in the icon slot. Size and
 * disabled state propagate from group to items via React context. Supports
 * horizontal and vertical orientation, optional visible group label, and
 * role-based color injection for the selected indicator.
 *
 * Control semantics (L11): user activation (click or Radix-managed arrow keys)
 * dispatches a `selectValue` action through the responder chain with the newly
 * selected item id as `value` and a stable `sender` id for parent
 * disambiguation. Parent responders register a `selectValue` action handler via
 * `useResponder` that switches on `event.sender` to route updates to the right
 * state. There is no `onValueChange` callback prop — the chain is the sole
 * mechanism for communicating selection changes outward.
 *
 * Composed children: TugButton (each item's click target and visual rendering) [L20].
 * Radio indicator appearance is owned by this component via radio-scoped tokens.
 * TugButton keeps its own tokens, tunable independently per theme.
 *
 * Laws: [L06] appearance via CSS, [L11] controls emit actions,
 *       [L16] pairings declared, [L19] component authoring guide,
 *       [L20] token sovereignty
 * Decisions: [D05] component token naming
 */

import "./tug-radio-group.css";

import React, { useCallback, useId } from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "@/lib/utils";
import { TugButton } from "./internal/tug-button";
import type { TugButtonSize } from "./internal/tug-button";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { TugGroupRole, buildRoleStyle } from "./internal/tug-group-utils";
import { useResponderChain } from "./responder-chain-provider";
import { TUG_ACTIONS } from "./action-vocabulary";

// ---- Types ----

/** Radio group size names — matches TugButton sizes */
export type TugRadioGroupSize = "sm" | "md" | "lg";

/**
 * Semantic role for the radio on-state color.
 *
 * Omit the role prop (or leave undefined) for the theme's accent color.
 * Explicit roles override with a semantic signal color.
 *
 * @selector [data-role="<role>"]
 */
export type TugRadioRole = TugGroupRole;

// ---- Context ----

interface TugRadioGroupContextValue {
  size: TugRadioGroupSize;
  disabled: boolean;
}

const TugRadioGroupContext = React.createContext<TugRadioGroupContextValue>({
  size: "md",
  disabled: false,
});

// ---- TugRadioGroupProps ----

/** TugRadioGroup props. */
export interface TugRadioGroupProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "role" | "defaultValue"> {
  /**
   * Current selected value.
   * @selector [data-state="checked"] on items
   */
  value?: string;
  /** Uncontrolled default value. */
  defaultValue?: string;
  /**
   * Stable identifier passed as `event.sender` on every `selectValue`
   * action dispatched by this group. Parent responders use this to
   * disambiguate multi-group forms in their `selectValue` handler.
   * Defaults to a `useId()`-derived unique string — set explicitly
   * when the parent needs a predictable id (e.g. for form routing
   * by semantic name).
   */
  senderId?: string;
  /** Visible group label rendered above the items. Falls back to aria-label for a11y. */
  label?: string;
  /**
   * Layout direction.
   * @selector .tug-radio-group-horizontal | .tug-radio-group-vertical
   * @default "vertical"
   */
  orientation?: "horizontal" | "vertical";
  /**
   * Visual size for all items.
   * @selector .tug-radio-group-sm | .tug-radio-group-md | .tug-radio-group-lg
   * @default "md"
   */
  size?: TugRadioGroupSize;
  /**
   * Semantic role color for the selected indicator.
   * @selector [data-role="<role>"]
   */
  role?: TugRadioRole;
  /** Form field name for native form submission. */
  name?: string;
  /**
   * Disables all items.
   * @selector [data-disabled]
   */
  disabled?: boolean;
  /** Accessible label when no visible label is provided. */
  "aria-label"?: string;
}

// ---- TugRadioGroup ----

export const TugRadioGroup = React.forwardRef<HTMLDivElement, TugRadioGroupProps>(
  function TugRadioGroup(
    {
      value,
      defaultValue,
      senderId,
      label,
      orientation = "vertical",
      size = "md",
      role,
      name,
      disabled = false,
      className,
      style,
      "aria-label": ariaLabel,
      children,
      dir,
      ...rest
    },
    ref,
  ) {
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // Role injection — on-state color uses toggle-primary tokens (shared with checkbox/switch). [L06]
    // No role prop = accent. Single path, zero branches.
    const roleStyle = buildRoleStyle("radio", role);

    const ctx: TugRadioGroupContextValue = { size, disabled: effectiveDisabled };

    // Chain dispatch [L11]: on user activation (click or Radix-handled
    // arrow keys), dispatch `selectValue` through the responder chain
    // with the newly selected item id as `value` and the stable sender
    // id. No-op when no ResponderChainProvider is mounted.
    const manager = useResponderChain();
    const fallbackId = useId();
    const effectiveSenderId = senderId ?? fallbackId;
    const handleValueChange = useCallback(
      (nextValue: string) => {
        if (!manager) return;
        manager.dispatch({
          action: TUG_ACTIONS.SELECT_VALUE,
          value: nextValue,
          sender: effectiveSenderId,
          phase: "discrete",
        });
      },
      [manager, effectiveSenderId],
    );

    return (
      <TugRadioGroupContext.Provider value={ctx}>
        <RadioGroupPrimitive.Root
          ref={ref}
          data-slot="tug-radio-group"
          value={value}
          defaultValue={defaultValue}
          onValueChange={handleValueChange}
          name={name}
          disabled={effectiveDisabled}
          aria-label={!label ? ariaLabel : undefined}
          aria-labelledby={label ? `tug-radio-label-${name ?? "group"}` : undefined}
          data-role={role}
          className={cn(
            "tug-radio-group",
            `tug-radio-group-${size}`,
            orientation === "horizontal"
              ? "tug-radio-group-horizontal"
              : "tug-radio-group-vertical",
            className,
          )}
          dir={dir as "ltr" | "rtl" | undefined}
          style={{ ...roleStyle, ...style }}
          {...rest}
        >
          {label && (
            <span
              id={`tug-radio-label-${name ?? "group"}`}
              className="tug-radio-group-label"
            >
              {label}
            </span>
          )}
          <div className="tug-radio-group-items">
            {children}
          </div>
        </RadioGroupPrimitive.Root>
      </TugRadioGroupContext.Provider>
    );
  },
);

/* ---------------------------------------------------------------------------
 * TugRadioItem
 * ---------------------------------------------------------------------------*/

/** TugRadioItem props. */
export interface TugRadioItemProps {
  /** The value this item represents. Required. */
  value: string;
  /** Label text. */
  children: React.ReactNode;
  /**
   * Disables this item individually.
   * @selector :disabled | [data-disabled]
   */
  disabled?: boolean;
}

export const TugRadioItem = React.forwardRef<HTMLButtonElement, TugRadioItemProps>(
  function TugRadioItem({ value, children, disabled }, ref) {
    const { size, disabled: groupDisabled } = React.useContext(TugRadioGroupContext);

    const isDisabled = disabled ?? groupDisabled;

    // Map TugRadioGroupSize → TugButtonSize (same union values)
    const buttonSize = size as TugButtonSize;

    return (
      <RadioGroupPrimitive.Item
        value={value}
        disabled={isDisabled}
        asChild
      >
        <TugButton
          ref={ref}
          data-slot="tug-radio-item"
          emphasis="ghost"
          role="action"
          size={buttonSize}
          subtype="icon-text"
          disabled={isDisabled}
          icon={
            <span className="tug-radio-indicator" aria-hidden="true">
              <span className="tug-radio-dot" />
            </span>
          }
        >
          {children}
        </TugButton>
      </RadioGroupPrimitive.Item>
    );
  },
);
