/**
 * tug-group-utils — Shared infrastructure for the tug-*-group family of components.
 *
 * Provides common types, constants, and helpers used across tug-radio-group,
 * tug-choice-group, and tug-option-group. Extracts duplicated ROLE_TOKEN_MAP,
 * role type unions, role style injection, keyboard navigation, and icon+label
 * layout rendering so each component can focus on its own visual identity.
 */

import "./tug-group-utils.css";

import React from "react";

// ---- Role types and token mapping ----

/**
 * Semantic role for group component on-state color.
 *
 * Omit the role prop (or leave undefined) for the theme's accent color.
 * Explicit roles override with a semantic signal color.
 */
export type TugGroupRole =
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
export const ROLE_TOKEN_MAP: Record<string, string> = {
  option:  "option",
  action:  "active",
  agent:   "agent",
  data:    "data",
  success: "success",
  caution: "caution",
  danger:  "danger",
};

/**
 * Returns the token suffix for a given role.
 * Falls back to "accent" when no role is provided (the theme's default accent color).
 */
export function getRoleTokenSuffix(role?: TugGroupRole): string {
  if (!role) return "accent";
  return ROLE_TOKEN_MAP[role] ?? role;
}

/**
 * Builds the CSS custom property object for role color injection.
 *
 * @param prefix - Component-specific CSS variable prefix (e.g., "radio", "segment", "option")
 * @param role - Optional semantic role; omit for accent color
 *
 * @example
 * buildRoleStyle("radio", "success")
 * // → { "--tugx-radio-on-color": "var(--tug7-surface-toggle-primary-normal-success-rest)", ... }
 */
export function buildRoleStyle(
  prefix: string,
  role?: TugGroupRole,
): React.CSSProperties {
  const suffix = getRoleTokenSuffix(role);
  return {
    [`--tugx-${prefix}-on-color`]: `var(--tug7-surface-toggle-primary-normal-${suffix}-rest)`,
    [`--tugx-${prefix}-on-hover-color`]: `var(--tug7-surface-toggle-primary-normal-${suffix}-hover)`,
    [`--tugx-${prefix}-disabled-color`]: `var(--tug7-surface-toggle-primary-normal-${suffix}-disabled)`,
  } as React.CSSProperties;
}

// ---- Keyboard navigation ----

/**
 * Direction of a roving-tabIndex arrow-key navigation event. Passed to
 * the hook's `onFocusChange` callback so the consumer can dispatch
 * `focusNext`/`focusPrevious` responder chain actions that match the
 * user's intent (the simple "did it go forward or backward" question
 * the key-press resolves — wrapping is transparent to the consumer).
 */
export type GroupNavDirection = "next" | "previous" | "first" | "last";

/**
 * Generic arrow-key navigation hook for group components.
 *
 * Handles ArrowLeft/Up (previous), ArrowRight/Down (next), Home (first), End (last)
 * with wrapping. Skips disabled items. Calls onFocusChange with the new value, its
 * index in the full items array, and the direction the user navigated, then focuses
 * the corresponding element via itemRefs.
 *
 * Supports two usage modes:
 *
 * 1. **choice-group** (single-select, focus = selection): Pass `focusedValue` as the
 *    currently selected value and `onFocusChange` to update selection. Do not pass
 *    `onActivate` — selection happens on navigation, not on Space/Enter.
 *
 * 2. **option-group** (multi-toggle, focus is separate from selection): Pass `focusedValue`
 *    as the currently focused item's value and `onFocusChange` to update focus state.
 *    Pass `onActivate` to handle Space/Enter toggling the focused item.
 *
 * tug-radio-group does NOT use this — Radix handles keyboard navigation there.
 * tug-choice-group and tug-option-group use this directly.
 */
export function useGroupKeyboardNav(opts: {
  items: { value: string; disabled?: boolean }[];
  focusedValue: string;
  onFocusChange: (value: string, index: number, direction: GroupNavDirection) => void;
  onActivate?: (value: string) => void;
  disabled: boolean;
  itemRefs: React.MutableRefObject<(HTMLElement | null)[]>;
}): (e: React.KeyboardEvent) => void {
  const { items, focusedValue, onFocusChange, onActivate, disabled, itemRefs } = opts;

  return React.useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      const enabledItems = items.filter((item) => !item.disabled);
      const currentEnabledIndex = enabledItems.findIndex((item) => item.value === focusedValue);

      let nextValue: string | undefined;
      let direction: GroupNavDirection | undefined;

      switch (e.key) {
        case "ArrowLeft":
        case "ArrowUp": {
          e.preventDefault();
          const prevIndex =
            currentEnabledIndex <= 0
              ? enabledItems.length - 1
              : currentEnabledIndex - 1;
          nextValue = enabledItems[prevIndex]?.value;
          direction = "previous";
          break;
        }
        case "ArrowRight":
        case "ArrowDown": {
          e.preventDefault();
          const nextIndex =
            currentEnabledIndex >= enabledItems.length - 1
              ? 0
              : currentEnabledIndex + 1;
          nextValue = enabledItems[nextIndex]?.value;
          direction = "next";
          break;
        }
        case "Home": {
          e.preventDefault();
          nextValue = enabledItems[0]?.value;
          direction = "first";
          break;
        }
        case "End": {
          e.preventDefault();
          nextValue = enabledItems[enabledItems.length - 1]?.value;
          direction = "last";
          break;
        }
        case " ":
        case "Enter": {
          if (onActivate) {
            e.preventDefault();
            const focusedItem = items.find((item) => item.value === focusedValue);
            if (focusedItem && !focusedItem.disabled) {
              onActivate(focusedValue);
            }
          }
          return;
        }
        default:
          return;
      }

      if (nextValue !== undefined && nextValue !== focusedValue && direction !== undefined) {
        const fullIndex = items.findIndex((item) => item.value === nextValue);
        onFocusChange(nextValue, fullIndex, direction);
        itemRefs.current[fullIndex]?.focus();
      }
    },
    [items, focusedValue, onFocusChange, onActivate, disabled, itemRefs],
  );
}

// ---- Item icon/label rendering ----

/** Props for rendering an icon + label layout inside a group item. */
export interface GroupItemContentProps {
  label?: string;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right" | "both";
}

/**
 * Renders the icon + label layout for group item content.
 *
 * Used by tug-choice-group and tug-option-group. tug-radio-group uses TugButton's
 * own icon rendering instead.
 *
 * Layout rules:
 * - icon only (no label): icon span with className "tug-group-item-icon"
 * - label only (no icon): label span with className "tug-group-item-label"
 * - icon + label (default left): icon span + label span
 * - icon + label (right): label span + icon span
 * - iconPosition="both": icon span + label span + icon span
 */
export function renderGroupItemContent(
  props: GroupItemContentProps,
): React.ReactNode {
  const { label, icon, iconPosition = "left" } = props;

  const iconEl = icon ? (
    <span className="tug-group-item-icon" aria-hidden="true">
      {icon}
    </span>
  ) : null;

  const labelEl = label ? (
    <span className="tug-group-item-label">{label}</span>
  ) : null;

  if (iconEl && !labelEl) {
    return iconEl;
  }
  if (labelEl && !iconEl) {
    return labelEl;
  }
  if (iconEl && labelEl) {
    if (iconPosition === "right") {
      return (
        <>
          {labelEl}
          {iconEl}
        </>
      );
    }
    if (iconPosition === "both") {
      return (
        <>
          {iconEl}
          {labelEl}
          {iconEl}
        </>
      );
    }
    // Default: "left"
    return (
      <>
        {iconEl}
        {labelEl}
      </>
    );
  }
  return null;
}
