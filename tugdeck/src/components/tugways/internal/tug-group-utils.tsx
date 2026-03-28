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
 * Generic arrow-key navigation hook for group components.
 *
 * Handles ArrowLeft/Up (previous), ArrowRight/Down (next), Home (first), End (last)
 * with wrapping. Skips disabled items. Calls onNavigate with the new value and its
 * index in the full items array, then focuses the corresponding element via itemRefs.
 *
 * tug-radio-group does NOT use this — Radix handles keyboard navigation there.
 * tug-choice-group and tug-option-group use this directly.
 */
export function useGroupKeyboardNav(opts: {
  items: { value: string; disabled?: boolean }[];
  value: string;
  onNavigate: (value: string, index: number) => void;
  disabled: boolean;
  itemRefs: React.MutableRefObject<(HTMLElement | null)[]>;
}): (e: React.KeyboardEvent) => void {
  const { items, value, onNavigate, disabled, itemRefs } = opts;

  return React.useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      const enabledItems = items.filter((item) => !item.disabled);
      const currentEnabledIndex = enabledItems.findIndex((item) => item.value === value);

      let nextValue: string | undefined;

      switch (e.key) {
        case "ArrowLeft":
        case "ArrowUp": {
          e.preventDefault();
          const prevIndex =
            currentEnabledIndex <= 0
              ? enabledItems.length - 1
              : currentEnabledIndex - 1;
          nextValue = enabledItems[prevIndex]?.value;
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
          break;
        }
        case "Home": {
          e.preventDefault();
          nextValue = enabledItems[0]?.value;
          break;
        }
        case "End": {
          e.preventDefault();
          nextValue = enabledItems[enabledItems.length - 1]?.value;
          break;
        }
        default:
          return;
      }

      if (nextValue !== undefined && nextValue !== value) {
        const fullIndex = items.findIndex((item) => item.value === nextValue);
        onNavigate(nextValue, fullIndex);
        itemRefs.current[fullIndex]?.focus();
      }
    },
    [items, value, onNavigate, disabled, itemRefs],
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
