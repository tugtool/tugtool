/**
 * TugRadioGroup — Mutually exclusive selection from a set of options.
 *
 * Hand-rolled single-select group (no Radix): the same shape as TugChoiceGroup /
 * TugOptionGroup, rendering each item as a TugButton (ghost emphasis, icon-text
 * subtype) hosting a radio circle indicator in the icon slot. Keyboard focus is
 * **app-owned** ([P01]): the group is a single roving stop in the engine Tab walk
 * (`useRovingFocusable`), arrows move the roving cursor *and* select (the WAI-ARIA
 * radio convention: focus = selection), and the focus ring follows the arrows via
 * the engine's key-view projection. Radix's `RadioGroupPrimitive` was removed —
 * its built-in `RovingFocusGroup` cannot be disabled and would fight the engine
 * for focus/`tabIndex` ownership; the native-form `BubbleInput` it provided is
 * unused here (selection flows through the responder chain, [L11], not HTML
 * forms), so nothing of substance is lost.
 *
 * Control semantics (L11): user activation (click, Space/Enter on the focused
 * item, or arrow navigation) dispatches a `selectValue` action through the
 * responder chain with the newly selected item id as `value` and a stable
 * `sender` id. Parent responders register a `selectValue` handler via
 * `useResponder` and switch on `event.sender`. There is no `onValueChange`
 * callback prop — the chain is the sole mechanism for communicating selection
 * changes outward.
 *
 * Composed children: TugButton (each item's click target and visual rendering) [L20].
 * Radio indicator appearance is owned by this component via radio-scoped tokens.
 * TugButton keeps its own tokens, tunable independently per theme.
 *
 * Laws: [L03] registrations in useLayoutEffect, [L06] appearance via CSS/DOM,
 *       [L11] controls emit actions, [L16] pairings declared,
 *       [L19] component authoring guide, [L20] token sovereignty
 * Decisions: [D05] component token naming
 */

import "./tug-radio-group.css";

import React, { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TugButton } from "./internal/tug-button";
import type { TugButtonSize } from "./internal/tug-button";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { TugGroupRole, buildRoleStyle } from "./internal/tug-group-utils";
import { useControlDispatch } from "./use-control-dispatch";
import { useRovingFocusable } from "./use-focusable";
import type { FocusPolicy } from "./focus-manager";
import { TUG_ACTIONS } from "./action-vocabulary";
import {
  useComponentStatePreservation,
  useSavedComponentState,
} from "./use-component-state-preservation";

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
  /** The currently selected value (drives each item's checked indicator). */
  selectedValue: string;
  /** The roving-focus cursor value (drives each item's `tabIndex`). */
  focusedValue: string;
  /** Select an item (click or Space/Enter on the focused item). */
  onSelect: (value: string) => void;
}

const TugRadioGroupContext = React.createContext<TugRadioGroupContextValue>({
  size: "md",
  disabled: false,
  selectedValue: "",
  focusedValue: "",
  onSelect: () => {},
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
  /** Identifier used to derive the group's `aria-labelledby` target id. */
  name?: string;
  /**
   * Disables all items.
   * @selector [data-disabled]
   */
  disabled?: boolean;
  /** Accessible label when no visible label is provided. */
  "aria-label"?: string;
  /**
   * Opt the radio group into the Component State Preservation Protocol
   * ([D13], [A9]). When provided (and rendered inside a card), the
   * selected value is captured into
   * `bag.components[componentStatePreservationKey]` at every save
   * trigger and reapplied on the next mount. Controlled mode dispatches
   * `selectValue` on restore (best-effort, parent owns truth);
   * uncontrolled mode mirrors the value in `useState` so restore
   * can update it directly.
   */
  componentStatePreservationKey?: string;

  // ---- Focus engine ([P01], [P02]) ----

  /**
   * Focus group this radio group is authored into ([P02]). When set, the group
   * registers as a **single roving stop** in the engine's Tab walk: Tab lands on
   * the checked (or first enabled) item and arrows move between items locally;
   * when omitted, the items stay plain native focus stops. Supplied by the
   * surface that owns the Tab order.
   */
  focusGroup?: string;
  /** Order within {@link focusGroup}. Defaults to 0 (registration order breaks ties). */
  focusOrder?: number;
  /**
   * Walk policy when registered: `accept` (default) is an ordinary Tab stop;
   * `skip` is reachable only in accessibility mode.
   */
  focusPolicy?: FocusPolicy;
}

/** Serialized shape of `TugRadioGroup`'s preserved state. */
interface TugRadioGroupState {
  value: string;
}

const ARROW_KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]);

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
      componentStatePreservationKey,
      focusGroup,
      focusOrder = 0,
      focusPolicy,
      ...rest
    },
    ref,
  ) {
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // Role injection — on-state color uses toggle-primary tokens (shared with checkbox/switch). [L06]
    const roleStyle = buildRoleStyle("radio", role);

    // Chain dispatch [L11]: targeted dispatch of `selectValue` to the parent
    // responder with the newly selected item id as `value`. No-op outside a provider.
    const { dispatch: controlDispatch } = useControlDispatch();
    const fallbackId = useId();
    const effectiveSenderId = senderId ?? fallbackId;

    // Controlled/uncontrolled value, mirrored in `useState` for the uncontrolled
    // path so state preservation can read/write it.
    const isExternallyControlled = value !== undefined;
    const savedRadioGroupState = useSavedComponentState<TugRadioGroupState>(
      componentStatePreservationKey,
    );
    const [internalValue, setInternalValue] = useState<string>(
      () =>
        typeof savedRadioGroupState?.value === "string"
          ? savedRadioGroupState.value
          : (defaultValue ?? ""),
    );
    const effectiveValue = isExternallyControlled ? value : internalValue;

    const handleValueChange = useCallback(
      (nextValue: string) => {
        if (!isExternallyControlled) {
          setInternalValue(nextValue);
        }
        controlDispatch({
          action: TUG_ACTIONS.SELECT_VALUE,
          value: nextValue,
          sender: effectiveSenderId,
          phase: "discrete",
        });
      },
      [controlDispatch, effectiveSenderId, isExternallyControlled],
    );

    useComponentStatePreservation<TugRadioGroupState>({
      componentStatePreservationKey,
      captureState: () => ({ value: effectiveValue ?? "" }),
    });

    // ---- Roving focus ([P01], [P02]) ----
    //
    // The group is a single stop in the engine Tab walk; arrows move between
    // items locally (roving `tabIndex`) and the engine ring follows the cursor
    // via `setRovedElement`. One focusable id is registered for the whole group.
    const autoFocusId = useId();
    const { setRovedElement } = useRovingFocusable({
      id: autoFocusId,
      group: focusGroup ?? "",
      order: focusOrder,
      policy: focusPolicy,
      register: focusGroup !== undefined,
    });

    // Roving cursor: which item carries `tabIndex=0`. Local data ([L24]).
    const [focusedValue, setFocusedValue] = useState<string>(defaultValue ?? "");
    // Whether the last focus-moving interaction was the keyboard (arrows) vs a
    // pointer — so the projection effect picks the right ring modality.
    const lastKeyboardRef = useRef(false);

    const rootRef = useRef<HTMLDivElement | null>(null);
    const setRootRef = useCallback(
      (node: HTMLDivElement | null) => {
        rootRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref !== null && ref !== undefined) {
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
      },
      [ref],
    );

    // Ordered radio-item buttons in DOM order (all / enabled only).
    const allItems = useCallback((): HTMLElement[] => {
      const root = rootRef.current;
      if (!root) return [];
      return Array.from(root.querySelectorAll<HTMLElement>('[data-slot="tug-radio-item"]'));
    }, []);
    const enabledItems = useCallback(
      (): HTMLElement[] => allItems().filter((el) => !el.hasAttribute("disabled")),
      [allItems],
    );
    const valueOf = (el: HTMLElement): string => el.getAttribute("data-radio-value") ?? "";

    // Select an item (click or Space/Enter on the focused item) — pointer-modality.
    const onSelect = useCallback(
      (next: string) => {
        lastKeyboardRef.current = false;
        setFocusedValue(next);
        handleValueChange(next);
      },
      [handleValueChange],
    );

    // Arrow / Home / End roving over the enabled items. The radio convention is
    // focus = selection, so a move also selects. Tab itself is the engine walk's
    // job (this group is one stop); arrows move within.
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (!ARROW_KEYS.has(e.key)) return;
        const items = enabledItems();
        if (items.length === 0) return;
        const values = items.map(valueOf);
        const cur = values.indexOf(focusedValue);
        let nextIdx: number;
        switch (e.key) {
          case "ArrowUp":
          case "ArrowLeft":
            nextIdx = cur <= 0 ? values.length - 1 : cur - 1;
            break;
          case "ArrowDown":
          case "ArrowRight":
            nextIdx = cur >= values.length - 1 ? 0 : cur + 1;
            break;
          case "Home":
            nextIdx = 0;
            break;
          case "End":
            nextIdx = values.length - 1;
            break;
          default:
            return;
        }
        e.preventDefault();
        const nextValue = values[nextIdx];
        lastKeyboardRef.current = true;
        setFocusedValue(nextValue);
        items[nextIdx].focus();
        if (nextValue !== effectiveValue) {
          handleValueChange(nextValue);
        }
      },
      [enabledItems, focusedValue, effectiveValue, handleValueChange],
    );

    // Keep the roving cursor on a real enabled item and project the engine ring
    // onto it. Appearance-zone DOM only ([L06]); the keyboard flag picks whether
    // the ring follows (arrow) or clears (pointer). Resolution order: the current
    // cursor if still valid, else the checked item, else the first enabled item.
    const childCount = React.Children.count(children);
    useLayoutEffect(() => {
      const items = allItems();
      if (items.length === 0) {
        setRovedElement(null, lastKeyboardRef.current);
        return;
      }
      const values = items.map(valueOf);
      let target = focusedValue;
      if (!values.includes(target)) {
        const enabledVals = enabledItems().map(valueOf);
        target =
          effectiveValue && enabledVals.includes(effectiveValue)
            ? effectiveValue
            : (enabledVals[0] ?? "");
      }
      if (target !== focusedValue) {
        setFocusedValue(target);
        return; // re-run after the cursor state settles
      }
      const el = items.find((e) => valueOf(e) === target) ?? null;
      setRovedElement(el, lastKeyboardRef.current);
    }, [focusedValue, effectiveValue, childCount, setRovedElement, allItems, enabledItems]);

    const ctx: TugRadioGroupContextValue = {
      size,
      disabled: effectiveDisabled,
      selectedValue: effectiveValue ?? "",
      focusedValue,
      onSelect,
    };

    const labelId = `tug-radio-label-${name ?? "group"}`;

    return (
      <TugRadioGroupContext.Provider value={ctx}>
        <div
          ref={setRootRef}
          data-slot="tug-radio-group"
          role="radiogroup"
          aria-label={!label ? ariaLabel : undefined}
          aria-labelledby={label ? labelId : undefined}
          aria-disabled={effectiveDisabled || undefined}
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
          onKeyDown={handleKeyDown}
          {...rest}
        >
          {label && (
            <span id={labelId} className="tug-radio-group-label">
              {label}
            </span>
          )}
          <div className="tug-radio-group-items">{children}</div>
        </div>
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
   * Optional secondary line rendered muted below the label — the radio
   * equivalent of a list row's subtitle. When present the item is a two-line
   * stack and the dot top-aligns with the label.
   */
  description?: React.ReactNode;
  /**
   * Disables this item individually.
   * @selector :disabled | [data-disabled]
   */
  disabled?: boolean;
}

export const TugRadioItem = React.forwardRef<HTMLButtonElement, TugRadioItemProps>(
  function TugRadioItem({ value, children, description, disabled }, ref) {
    const { size, disabled: groupDisabled, selectedValue, focusedValue, onSelect } =
      React.useContext(TugRadioGroupContext);

    const isDisabled = disabled ?? groupDisabled;
    const isChecked = value === selectedValue;
    const isFocused = value === focusedValue;

    // Map TugRadioGroupSize → TugButtonSize (same union values)
    const buttonSize = size as TugButtonSize;

    // Hand-rolled radio item: the button carries the ARIA radio semantics
    // (`role="radio"` flows through TugButton's ARIA-role pass-through, since
    // "radio" is not one of TugButton's semantic theming roles), the checked
    // `data-state` the CSS keys on, and the roving `tabIndex` (the focused
    // member is the only Tab stop; the group's engine focusable lands the key
    // view here). TugButton already emits `data-tug-focus="refuse"`, so clicking
    // an item selects without stealing the key view. Selection on click /
    // Space / Enter funnels through `onSelect` (native `<button>` activation
    // fires `onClick` for Space and Enter).
    return (
      <TugButton
        ref={ref}
        role="radio"
        aria-checked={isChecked}
        value={value}
        data-slot="tug-radio-item"
        data-radio-value={value}
        data-state={isChecked ? "checked" : "unchecked"}
        data-has-description={description !== undefined ? "" : undefined}
        tabIndex={isFocused ? 0 : -1}
        emphasis="ghost"
        size={buttonSize}
        subtype="icon-text"
        disabled={isDisabled}
        onClick={() => {
          if (!isDisabled) onSelect(value);
        }}
        icon={
          <span className="tug-radio-indicator" aria-hidden="true">
            <span className="tug-radio-dot" />
          </span>
        }
      >
        {description !== undefined ? (
          <span className="tug-radio-item-text">
            <span className="tug-radio-item-label">{children}</span>
            <span className="tug-radio-item-description">{description}</span>
          </span>
        ) : (
          children
        )}
      </TugButton>
    );
  },
);
