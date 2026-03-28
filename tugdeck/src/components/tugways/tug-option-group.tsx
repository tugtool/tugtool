/**
 * TugOptionGroup — Multi-toggle group where each item toggles independently.
 *
 * Each item is an independent toggle button (aria-pressed). Zero or more items
 * can be active simultaneously. Keyboard navigation uses roving tabIndex:
 * arrows move focus between items; Space/Enter toggles the focused item.
 *
 * Role="toolbar" on root per WAI-ARIA spec for a collection of interactive
 * widgets. Each button uses aria-pressed to communicate on/off state.
 *
 * Laws: [L06] appearance via CSS/DOM, [L15] token-driven states,
 *       [L16] pairings declared, [L19] component authoring guide
 * Decisions: [D03] appearance via stylesheet injection, [D05] component token naming
 */

import "./tug-option-group.css";

import React from "react";
import { cn } from "@/lib/utils";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import {
  TugGroupRole,
  buildRoleStyle,
  renderGroupItemContent,
  useGroupKeyboardNav,
} from "./internal/tug-group-utils";

// ---- Types ----

/** Option group size names. */
export type TugOptionGroupSize = "sm" | "md" | "lg";

/**
 * Semantic role for the on-state indicator color.
 *
 * Omit the role prop (or leave undefined) for the theme's accent color.
 * Explicit roles override with a semantic signal color.
 *
 * Re-exported from TugGroupRole for API consistency.
 *
 * @selector [data-role="<role>"]
 */
export type { TugGroupRole as TugOptionGroupRole };

/** A single toggleable item definition. */
export interface TugOptionItem {
  /** Unique value for this item. */
  value: string;
  /** Display label. Optional — omit for icon-only items. */
  label?: string;
  /** Icon node (typically a Lucide icon). */
  icon?: React.ReactNode;
  /** Where to place the icon relative to the label.
   *  @default "left" */
  iconPosition?: "left" | "right" | "both";
  /** Accessible label — required when label is omitted (icon-only). */
  "aria-label"?: string;
  /** Disables this item individually. */
  disabled?: boolean;
}

/** TugOptionGroup props. */
export interface TugOptionGroupProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "role" | "defaultValue" | "onChange"> {
  /** The items to display as toggle buttons. */
  items: TugOptionItem[];
  /**
   * Currently active values (the items that are "on").
   * @selector [data-state="on"] on items
   */
  value: string[];
  /** Fires when the set of active values changes. */
  onValueChange: (value: string[]) => void;
  /**
   * Visual size.
   * @selector .tug-option-group-sm | .tug-option-group-md | .tug-option-group-lg
   * @default "md"
   */
  size?: TugOptionGroupSize;
  /**
   * Semantic role color for the on-state background.
   * @selector [data-role="<role>"]
   */
  role?: TugGroupRole;
  /**
   * Disables all items.
   * @selector [data-disabled]
   */
  disabled?: boolean;
  /** Accessible label for the toolbar. */
  "aria-label"?: string;
}

// ---- TugOptionGroup ----

export const TugOptionGroup = React.forwardRef<HTMLDivElement, TugOptionGroupProps>(
  function TugOptionGroup(
    {
      items,
      value,
      onValueChange,
      size = "md",
      role,
      disabled = false,
      className,
      style,
      "aria-label": ariaLabel,
      ...rest
    },
    ref,
  ) {
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // Role injection — on-state uses toggle-primary tokens. [L06]
    const roleStyle = buildRoleStyle("option", role);

    // Refs for each item button — indexed to match items array.
    const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

    // Roving tabIndex: track which item currently has tabIndex=0.
    // Initialize to the first enabled item, or first item if all disabled.
    const [focusedValue, setFocusedValue] = React.useState<string>(() => {
      const firstEnabled = items.find((item) => !item.disabled);
      return firstEnabled?.value ?? items[0]?.value ?? "";
    });

    // ---- Toggle logic ----

    const toggleItem = React.useCallback(
      (itemValue: string) => {
        if (value.includes(itemValue)) {
          // Remove — maintain order by filtering
          onValueChange(value.filter((v) => v !== itemValue));
        } else {
          // Add — append at end
          onValueChange([...value, itemValue]);
        }
      },
      [value, onValueChange],
    );

    // ---- Keyboard navigation ----
    // Roving tabIndex: arrows move focus; Space/Enter toggles via onActivate.

    const handleKeyDown = useGroupKeyboardNav({
      items,
      focusedValue,
      onFocusChange: (newValue) => {
        setFocusedValue(newValue);
      },
      onActivate: (itemValue) => {
        toggleItem(itemValue);
      },
      disabled: effectiveDisabled,
      itemRefs,
    });

    return (
      <div
        ref={ref}
        data-slot="tug-option-group"
        role="toolbar"
        aria-label={ariaLabel}
        aria-disabled={effectiveDisabled || undefined}
        data-role={role}
        data-disabled={effectiveDisabled || undefined}
        className={cn(
          "tug-option-group",
          `tug-option-group-${size}`,
          className,
        )}
        style={{ ...roleStyle, ...style }}
        onKeyDown={handleKeyDown}
        {...rest}
      >
        {items.map((item, index) => {
          const isOn = value.includes(item.value);
          const isDisabled = effectiveDisabled || item.disabled;
          const isIconOnly = item.icon && !item.label;
          const isFocused = item.value === focusedValue;

          return (
            <button
              key={item.value}
              ref={(el) => { itemRefs.current[index] = el; }}
              type="button"
              aria-pressed={isOn}
              aria-label={item["aria-label"]}
              disabled={isDisabled}
              data-state={isOn ? "on" : "off"}
              className={cn(
                "tug-option-group-item",
                isIconOnly && "tug-option-group-item-icon-only",
              )}
              tabIndex={isFocused ? 0 : -1}
              onClick={() => {
                if (!isDisabled) {
                  setFocusedValue(item.value);
                  toggleItem(item.value);
                }
              }}
              onFocus={() => {
                setFocusedValue(item.value);
              }}
            >
              {renderGroupItemContent({
                label: item.label,
                icon: item.icon,
                iconPosition: item.iconPosition,
              })}
            </button>
          );
        })}
      </div>
    );
  },
);
