/**
 * TugSegmentedChoice — Mutually exclusive segment picker with sliding indicator.
 *
 * Original component — no Radix wrapper. ARIA, keyboard navigation, and focus
 * management are hand-implemented. Role="radiogroup" on root; each segment is
 * role="radio" with aria-checked. A sliding background indicator pill moves
 * imperatively via DOM refs + useLayoutEffect on value change. Supports size
 * variants (sm/md/lg), individual and group-level disable, and role-based color
 * injection for the indicator pill (same pattern as checkbox/switch/radio).
 *
 * NOT a tab bar — this is a value picker, not a view switcher. See roadmap doc.
 *
 * Laws: [L06] appearance via CSS/DOM refs, [L15] token-driven states,
 *       [L16] pairings declared, [L19] component authoring guide
 * Decisions: [D03] appearance via stylesheet injection, [D05] component token naming
 */

import "./tug-segmented-choice.css";

import React from "react";
import { cn } from "@/lib/utils";
import { useTugBoxDisabled } from "./internal/tug-box-context";

// ---- Types ----

/** Segmented choice size names. */
export type TugSegmentedChoiceSize = "sm" | "md" | "lg";

/**
 * Semantic role for the selected indicator color.
 *
 * Omit the role prop (or leave undefined) for the theme's accent color.
 * Explicit roles override with a semantic signal color.
 *
 * @selector [data-role="<role>"]
 */
export type TugSegmentedChoiceRole =
  | "option"
  | "action"
  | "agent"
  | "data"
  | "success"
  | "caution"
  | "danger";

/** A single segment item definition. */
export interface TugSegmentedChoiceItem {
  /** Unique value for this segment. */
  value: string;
  /** Display label. */
  label: string;
  /** Disables this segment individually. */
  disabled?: boolean;
}

/**
 * Maps role prop values to toggle-primary token suffixes.
 * The prop API uses "action" but the token system uses "active"
 * (e.g., --tug7-surface-toggle-primary-normal-active-rest).
 * "accent" is not in this map — it's the implicit default when no role is provided.
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

/** TugSegmentedChoice props. */
export interface TugSegmentedChoiceProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "role" | "defaultValue" | "onChange"> {
  /** The items to display as segments. */
  items: TugSegmentedChoiceItem[];
  /**
   * Current selected value.
   * @selector [data-state="active"] on segments
   */
  value: string;
  /** Fires when selection changes. */
  onValueChange: (value: string) => void;
  /**
   * Visual size.
   * @selector .tug-segmented-choice-sm | .tug-segmented-choice-md | .tug-segmented-choice-lg
   * @default "md"
   */
  size?: TugSegmentedChoiceSize;
  /**
   * Semantic role color for the selected indicator.
   * @selector [data-role="<role>"]
   */
  role?: TugSegmentedChoiceRole;
  /**
   * Disables all segments.
   * @selector [data-disabled]
   */
  disabled?: boolean;
  /** Accessible label for the group. */
  "aria-label"?: string;
}

// ---- TugSegmentedChoice ----

export const TugSegmentedChoice = React.forwardRef<HTMLDivElement, TugSegmentedChoiceProps>(
  function TugSegmentedChoice(
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

    // Role injection — indicator pill uses toggle-primary tokens. [L06]
    // No role prop = accent. Single path, zero branches.
    const tokenSuffix = role ? (ROLE_TOKEN_MAP[role] ?? role) : "accent";
    const roleStyle = {
      "--tugx-segment-on-color": `var(--tug7-surface-toggle-primary-normal-${tokenSuffix}-rest)`,
      "--tugx-segment-on-hover-color": `var(--tug7-surface-toggle-primary-normal-${tokenSuffix}-hover)`,
      "--tugx-segment-disabled-color": `var(--tug7-surface-toggle-primary-normal-${tokenSuffix}-disabled)`,
    } as React.CSSProperties;

    // Refs for each segment button — indexed to match items array.
    const segmentRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
    // Ref for the sliding indicator pill element.
    const indicatorRef = React.useRef<HTMLDivElement>(null);

    // Measure the active segment and apply position/width to indicator [L06].
    // useLayoutEffect runs synchronously before paint — no flicker on mount.
    React.useLayoutEffect(() => {
      const activeIndex = items.findIndex((item) => item.value === value);
      if (activeIndex === -1) return;
      const segEl = segmentRefs.current[activeIndex];
      const indEl = indicatorRef.current;
      if (!segEl || !indEl) return;
      indEl.style.transform = `translateX(${segEl.offsetLeft}px)`;
      indEl.style.width = `${segEl.offsetWidth}px`;
    }, [value, items]);

    // ---- Keyboard navigation ----

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (effectiveDisabled) return;

        const enabledItems = items.filter((item) => !item.disabled);
        const currentEnabledIndex = enabledItems.findIndex((item) => item.value === value);

        let nextItem: TugSegmentedChoiceItem | undefined;

        switch (e.key) {
          case "ArrowLeft":
          case "ArrowUp": {
            e.preventDefault();
            const prevIndex =
              currentEnabledIndex <= 0
                ? enabledItems.length - 1
                : currentEnabledIndex - 1;
            nextItem = enabledItems[prevIndex];
            break;
          }
          case "ArrowRight":
          case "ArrowDown": {
            e.preventDefault();
            const nextIndex =
              currentEnabledIndex >= enabledItems.length - 1
                ? 0
                : currentEnabledIndex + 1;
            nextItem = enabledItems[nextIndex];
            break;
          }
          case "Home": {
            e.preventDefault();
            nextItem = enabledItems[0];
            break;
          }
          case "End": {
            e.preventDefault();
            nextItem = enabledItems[enabledItems.length - 1];
            break;
          }
          default:
            return;
        }

        if (nextItem && nextItem.value !== value) {
          onValueChange(nextItem.value);
          // Move DOM focus to the newly selected segment button.
          const nextIndex = items.findIndex((item) => item.value === nextItem!.value);
          segmentRefs.current[nextIndex]?.focus();
        }
      },
      [effectiveDisabled, items, value, onValueChange],
    );

    return (
      <div
        ref={ref}
        data-slot="tug-segmented-choice"
        role="radiogroup"
        aria-label={ariaLabel}
        aria-disabled={effectiveDisabled || undefined}
        data-role={role}
        data-disabled={effectiveDisabled || undefined}
        className={cn(
          "tug-segmented-choice",
          `tug-segmented-choice-${size}`,
          className,
        )}
        style={{ ...roleStyle, ...style }}
        onKeyDown={handleKeyDown}
        {...rest}
      >
        {/* Sliding indicator pill — positioned imperatively via ref [L06] */}
        <div
          ref={indicatorRef}
          className="tug-segmented-choice-indicator"
          aria-hidden="true"
        />

        {items.map((item, index) => {
          const isActive = item.value === value;
          const isDisabled = effectiveDisabled || item.disabled;

          return (
            <button
              key={item.value}
              ref={(el) => { segmentRefs.current[index] = el; }}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-disabled={isDisabled || undefined}
              disabled={isDisabled}
              data-state={isActive ? "active" : "inactive"}
              className="tug-segmented-choice-segment"
              tabIndex={isActive ? 0 : -1}
              onClick={() => {
                if (!isDisabled && !isActive) {
                  onValueChange(item.value);
                }
              }}
            >
              <span className="tug-segmented-choice-label">{item.label}</span>
            </button>
          );
        })}
      </div>
    );
  },
);
