/**
 * TugRadioGroup — Mutually exclusive selection from a set of options.
 *
 * Wraps @radix-ui/react-radio-group. Each item is a TugButton (ghost emphasis,
 * icon-text subtype) hosting a radio circle indicator in the icon slot. Size and
 * disabled state propagate from group to items via React context. Supports
 * horizontal and vertical orientation, optional visible group label, and
 * role-based color injection for the selected indicator.
 *
 * Composed children: TugButton (each item's click target and visual rendering) [L20].
 * Radio indicator appearance is owned by this component via radio-scoped tokens.
 * TugButton keeps its own tokens, tunable independently per theme.
 *
 * Laws: [L06] appearance via CSS, [L16] pairings declared,
 *       [L19] component authoring guide, [L20] token sovereignty
 * Decisions: [D05] component token naming
 */

import "./tug-radio-group.css";

import React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "@/lib/utils";
import { TugButton } from "./internal/tug-button";
import type { TugButtonSize } from "./internal/tug-button";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { TugGroupRole, buildRoleStyle } from "./internal/tug-group-utils";

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
  /** Fires when selection changes. */
  onValueChange?: (value: string) => void;
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
      onValueChange,
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

    return (
      <TugRadioGroupContext.Provider value={ctx}>
        <RadioGroupPrimitive.Root
          ref={ref}
          data-slot="tug-radio-group"
          value={value}
          defaultValue={defaultValue}
          onValueChange={onValueChange}
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
