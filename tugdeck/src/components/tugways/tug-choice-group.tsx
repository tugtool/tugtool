/**
 * TugChoiceGroup — Mutually exclusive segment picker with sliding indicator.
 *
 * Original component — no Radix wrapper. ARIA, keyboard navigation, and focus
 * management are hand-implemented. Role="radiogroup" on root; each segment is
 * role="radio" with aria-checked. A sliding background indicator pill moves
 * imperatively via DOM refs + useLayoutEffect on value change. Supports size
 * variants (sm/md/lg), individual and group-level disable, and role-based color
 * injection for the indicator pill (same pattern as checkbox/switch/radio).
 *
 * Control semantics (L11): user activation (click or arrow key) dispatches a
 * `selectValue` action through the responder chain with the newly selected
 * segment value and a stable `sender` id. Because focus and selection are
 * coupled in this component (arrow keys move selection, not just focus),
 * arrow keys dispatch `selectValue` — no separate `focusNext`/`focusPrevious`
 * actions. Parent responders register a `selectValue` handler via
 * `useResponder` and switch on `event.sender`. There is no `onValueChange`
 * callback prop.
 *
 * NOT a tab bar — this is a value picker, not a view switcher. See roadmap doc.
 *
 * Laws: [L06] appearance via CSS/DOM refs, [L11] controls emit actions,
 *       [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide
 * Decisions: [D03] appearance via stylesheet injection, [D05] component token naming
 */

import "./tug-choice-group.css";

import React, { useCallback, useId } from "react";
import { cn } from "@/lib/utils";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import {
  TugGroupRole,
  buildRoleStyle,
  useGroupKeyboardNav,
  renderGroupItemContent,
} from "./internal/tug-group-utils";
import { useControlDispatch } from "./use-control-dispatch";
import { TUG_ACTIONS } from "./action-vocabulary";

// ---- Types ----

/** Choice group size names. */
export type TugChoiceGroupSize = "xs" | "sm" | "md" | "lg";

/**
 * Semantic role for the selected indicator color.
 *
 * Omit the role prop (or leave undefined) for the theme's accent color.
 * Explicit roles override with a semantic signal color.
 *
 * Re-exported from TugGroupRole for API consistency.
 *
 * @selector [data-role="<role>"]
 */
export type TugChoiceGroupRole = TugGroupRole;

/** A single segment item definition. */
export interface TugChoiceItem {
  /** Unique value for this segment. */
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
  /** Disables this segment individually. */
  disabled?: boolean;
}

/** TugChoiceGroup props. */
export interface TugChoiceGroupProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "role" | "defaultValue" | "onChange"> {
  /** The items to display as segments. */
  items: TugChoiceItem[];
  /**
   * Current selected value.
   * @selector [data-state="active"] on segments
   */
  value: string;
  /**
   * Stable identifier passed as `event.sender` on every `selectValue`
   * action dispatched by this group. Parent responders use this to
   * disambiguate multi-group forms in their `selectValue` handler.
   * Defaults to a `useId()`-derived unique string — set explicitly
   * when the parent needs a predictable id (e.g. for form routing
   * by semantic name).
   */
  senderId?: string;
  /**
   * Visual size.
   * @selector .tug-choice-group-xs | .tug-choice-group-sm | .tug-choice-group-md | .tug-choice-group-lg
   * @default "md"
   */
  size?: TugChoiceGroupSize;
  /**
   * Semantic role color for the selected indicator.
   * @selector [data-role="<role>"]
   */
  role?: TugChoiceGroupRole;
  /**
   * Disables all segments.
   * @selector [data-disabled]
   */
  disabled?: boolean;
  /**
   * Animate the sliding indicator between selections.
   * @default false
   */
  animated?: boolean;
  /** Accessible label for the group. */
  "aria-label"?: string;
}

// ---- TugChoiceGroup ----

export const TugChoiceGroup = React.forwardRef<HTMLDivElement, TugChoiceGroupProps>(
  function TugChoiceGroup(
    {
      items,
      value,
      senderId,
      size = "md",
      role,
      disabled = false,
      animated = false,
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
    const roleStyle = buildRoleStyle("segment", role);

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

    // Chain dispatch [L11]: targeted dispatch of `selectValue` to
    // the parent responder. Arrow keys move selection (not just
    // focus), so they also dispatch via the same handler.
    const { dispatch: controlDispatch } = useControlDispatch();
    const fallbackId = useId();
    const effectiveSenderId = senderId ?? fallbackId;
    const dispatchSelectValue = useCallback(
      (nextValue: string) => {
        controlDispatch({
          action: TUG_ACTIONS.SELECT_VALUE,
          value: nextValue,
          sender: effectiveSenderId,
          phase: "discrete",
        });
      },
      [controlDispatch, effectiveSenderId],
    );

    // ---- Keyboard navigation ----

    const handleKeyDown = useGroupKeyboardNav({
      items,
      focusedValue: value,
      onFocusChange: (nextValue) => {
        dispatchSelectValue(nextValue);
      },
      disabled: effectiveDisabled,
      itemRefs: segmentRefs,
    });

    return (
      <div
        ref={ref}
        data-slot="tug-choice-group"
        role="radiogroup"
        aria-label={ariaLabel}
        aria-disabled={effectiveDisabled || undefined}
        data-role={role}
        data-disabled={effectiveDisabled || undefined}
        className={cn(
          "tug-choice-group",
          `tug-choice-group-${size}`,
          animated && "tug-choice-group-animated",
          className,
        )}
        style={{ ...roleStyle, ...style }}
        onKeyDown={handleKeyDown}
        {...rest}
      >
        {/* Sliding indicator pill — positioned imperatively via ref [L06] */}
        <div
          ref={indicatorRef}
          className="tug-choice-group-indicator"
          aria-hidden="true"
        />

        {items.map((item, index) => {
          const isActive = item.value === value;
          const isDisabled = effectiveDisabled || item.disabled;
          const isIconOnly = item.icon && !item.label;

          return (
            <button
              key={item.value}
              ref={(el) => { segmentRefs.current[index] = el; }}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-disabled={isDisabled || undefined}
              aria-label={isIconOnly ? item["aria-label"] : undefined}
              disabled={isDisabled}
              data-state={isActive ? "active" : "inactive"}
              className={cn(
                "tug-choice-group-segment",
                isIconOnly && "tug-choice-group-segment-icon-only",
              )}
              tabIndex={isActive ? 0 : -1}
              data-tug-focus="refuse"
              onClick={() => {
                if (!isDisabled && !isActive) {
                  dispatchSelectValue(item.value);
                }
              }}
            >
              {renderGroupItemContent({ label: item.label, icon: item.icon, iconPosition: item.iconPosition })}
            </button>
          );
        })}
      </div>
    );
  },
);
