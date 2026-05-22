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
import { useComponentStatePreservation } from "./use-component-state-preservation";

// ---- Types ----

/** Choice group size names. */
export type TugChoiceGroupSize = "2xs" | "xs" | "sm" | "md" | "lg";

/**
 * Visual emphasis. Selects the *paint* of the group; the *scale* is
 * controlled separately by `size`. The two compose.
 *
 *  - `"default"` — fielded look: framing pill with a saturated indicator
 *    matching the (role-aware) `--tugx-segment-on-color`. Use when the
 *    choice group is the prominent control in its region.
 *  - `"ghost"` — quiet look: no framing pill, neutral sliding indicator,
 *    uppercase/letter-spaced labels matching `TugPushButton`'s CTA
 *    typography. Pipe dividers and role-driven indicator coloring are
 *    suppressed. Use when the choice group sits next to ghost-style
 *    push buttons (e.g. action-row affordances inside a sticky header)
 *    and should read at the same visual weight as its neighbors.
 *
 * @selector [data-emphasis="<emphasis>"]
 * @default "default"
 */
export type TugChoiceGroupEmphasis = "default" | "ghost";

/**
 * Semantic role for the selected indicator color.
 *
 * Omit the role prop (or leave undefined) for the theme's accent color.
 * Explicit roles override with a semantic signal color.
 *
 * Re-exported from TugGroupRole for API consistency.
 *
 * **Interaction with `emphasis="ghost"`:** the ghost variant uses a
 * single neutral indicator color regardless of `role` — ghost emphasis
 * is for "this control is quiet" and saturated semantic coloring would
 * defeat that. The `role` prop is still accepted (the data attribute
 * is set for downstream CSS hooks) but has no visible effect on the
 * indicator pill in ghost mode.
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
   * @selector .tug-choice-group-2xs | .tug-choice-group-xs | .tug-choice-group-sm | .tug-choice-group-md | .tug-choice-group-lg
   * @default "md"
   */
  size?: TugChoiceGroupSize;
  /**
   * Visual emphasis. See {@link TugChoiceGroupEmphasis}.
   * @selector [data-emphasis="<emphasis>"]
   * @default "default"
   */
  emphasis?: TugChoiceGroupEmphasis;
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
  /**
   * Optional extra horizontal padding inside each segment, giving the
   * items more breathing room when the group should read as a touch
   * more prominent. The selection indicator covers it automatically.
   * Off by default.
   * @selector [data-side-padding="xs" | "sm" | "md"]
   */
  sidePadding?: "xs" | "sm" | "md";
  /** Accessible label for the group. */
  "aria-label"?: string;
  /**
   * Opt the choice group into the Component State Preservation
   * Protocol ([D13], [A9]). When provided (and rendered inside a
   * card), the selected value is captured into
   * `bag.components[componentStatePreservationKey]` at every save
   * trigger. On restore the component re-dispatches a `selectValue`
   * action through the responder chain so the parent (which owns the
   * `value` prop) updates its own state. The parent must register a
   * `selectValue` handler that recognizes
   * `event.sender === senderId` to honor the restore.
   *
   * `tug-choice-group` is controlled-only (`value` is required) so
   * there is no internal mirror — the parent IS the source of truth.
   */
  componentStatePreservationKey?: string;
}

/** Serialized shape of `TugChoiceGroup`'s preserved state. */
interface TugChoiceGroupState {
  value: string;
}

// ---- TugChoiceGroup ----

export const TugChoiceGroup = React.forwardRef<HTMLDivElement, TugChoiceGroupProps>(
  function TugChoiceGroup(
    {
      items,
      value,
      senderId,
      size = "md",
      emphasis = "default",
      role,
      disabled = false,
      animated = false,
      sidePadding,
      className,
      style,
      "aria-label": ariaLabel,
      componentStatePreservationKey,
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
    // Latest active value, read from the ResizeObserver callback so a
    // resize that fires after a `value` change picks up the right
    // segment without re-creating the observer.
    const activeValueRef = React.useRef(value);
    activeValueRef.current = value;
    // Stable items reference for the observer callback. Items typically
    // come from a module-level constant, but a caller passing a fresh
    // array each render must still see the correct active index in
    // resize callbacks fired between renders.
    const itemsRef = React.useRef(items);
    itemsRef.current = items;

    // Imperative measure: read the active segment's offsetLeft/Width
    // and write the indicator's transform + width. Pulled out so both
    // the value-change `useLayoutEffect` and the size-change
    // `ResizeObserver` can call it [L06].
    const measureIndicator = React.useCallback(() => {
      const liveItems = itemsRef.current;
      const liveValue = activeValueRef.current;
      const activeIndex = liveItems.findIndex((item) => item.value === liveValue);
      if (activeIndex === -1) return;
      const segEl = segmentRefs.current[activeIndex];
      const indEl = indicatorRef.current;
      if (!segEl || !indEl) return;
      // `offsetWidth` is the segment's border box — `sidePadding` widens
      // that box, so the indicator covers the extra padding for free.
      indEl.style.transform = `translateX(${segEl.offsetLeft}px)`;
      indEl.style.width = `${segEl.offsetWidth}px`;
    }, []);

    // Re-measure on every value or items change. useLayoutEffect runs
    // synchronously before paint so the indicator never flickers
    // through a stale position.
    React.useLayoutEffect(() => {
      measureIndicator();
    }, [value, items, measureIndicator]);

    // Observe size changes on every segment so the indicator stays
    // glued to the active one across font load, container resize, and
    // any layout settling that runs after first paint. Without this,
    // a choice group whose first paint happens before the surrounding
    // layout has settled (a common case when the parent component
    // mounts a substrate that imperatively inserts DOM in its own
    // layout effect — CodeMirror, Monaco, Lexical) measures its
    // segments at a tentative width and the indicator stays at width
    // 0 until the next `value`/`items` change forces a re-measure.
    // The observer fires once on attach with the current size and
    // again on every change; both paths route through
    // `measureIndicator` so the rendered indicator always reflects
    // the segment's current geometry [L06].
    React.useLayoutEffect(() => {
      const segs = segmentRefs.current.filter(
        (el): el is HTMLButtonElement => el !== null,
      );
      if (segs.length === 0) return;
      const observer = new ResizeObserver(measureIndicator);
      for (const seg of segs) observer.observe(seg);
      return () => observer.disconnect();
    }, [items, measureIndicator]);

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

    // Opt-in Component State Preservation Protocol. Hook no-ops when
    // `componentStatePreservationKey` is undefined. Controlled-only —
    // the parent responder owns `value` and carries its own saved state
    // via [A9]; it mounts in the saved selection on cold boot, which
    // flows back down here through the `value` prop. [D13] / [A9].
    useComponentStatePreservation<TugChoiceGroupState>({
      componentStatePreservationKey,
      captureState: () => ({ value }),
    });

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
        data-emphasis={emphasis}
        data-side-padding={sidePadding}
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
